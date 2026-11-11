import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseBriefing } from "../src/briefing.js";
import { Ghost, ghostToken, headWith, pull, push, type FetchLike, type GhostPost } from "../src/ghost.js";

// A key in Ghost's shape, made up for the test.
const KEY = `${"a1".repeat(12)}:${"0f".repeat(32)}`;

/** A stand-in for Ghost's Admin API that holds posts in memory and records every write. */
function fakeGhost(posts: GhostPost[]) {
  const writes: { id: string; body: { posts: { codeinjection_head: string; updated_at: string }[] } }[] = [];
  const auth: string[] = [];
  const fetcher: FetchLike = async (url, init) => {
    auth.push(init.headers.authorization ?? "");
    const u = new URL(url);
    const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
    if (init.method === "GET" && u.pathname === "/ghost/api/admin/posts/") {
      const slug = /slug:([a-z0-9-]+)/u.exec(u.searchParams.get("filter") ?? "")?.[1];
      const page = Number(u.searchParams.get("page"));
      const all = slug ? posts.filter((p) => p.slug === slug) : posts;
      // Two per page, so paging is exercised.
      return json(200, { posts: all.slice((page - 1) * 2, page * 2), meta: { pagination: { pages: Math.max(1, Math.ceil(all.length / 2)) } } });
    }
    const m = /^\/ghost\/api\/admin\/posts\/([^/]+)\/$/u.exec(u.pathname);
    if (init.method === "PUT" && m) {
      const post = posts.find((p) => p.id === m[1]);
      const body = JSON.parse(init.body ?? "{}") as { posts: { codeinjection_head: string; updated_at: string }[] };
      if (!post) return json(404, { errors: [{ message: "Post not found" }] });
      if (body.posts[0]!.updated_at !== post.updated_at) return json(409, { errors: [{ message: "Saving failed! Someone else is editing this post." }] });
      writes.push({ id: post.id, body });
      post.codeinjection_head = body.posts[0]!.codeinjection_head;
      post.updated_at = new Date(Date.parse(post.updated_at) + 1000).toISOString();
      return json(200, { posts: [post] });
    }
    return json(404, { errors: [{ message: "Not found" }] });
  };
  return { ghost: new Ghost({ url: "https://blog.example/", key: KEY, fetch: fetcher, now: () => 1_800_000_000_000 }), writes, auth };
}

const post = (slug: string, head: string | null, text = "The straw did more than the hose ever did. We watered once a week."): GhostPost => ({
  id: `id-${slug}`,
  slug,
  title: `Post ${slug}`,
  url: `https://blog.example/${slug}/`,
  updated_at: "2026-11-01T10:00:00.000Z",
  codeinjection_head: head,
  plaintext: text,
});

const file = (slug: string, status: string, summary = "We watered once a week and the tomatoes did better.") =>
  `---\nslug: ${slug}\ntitle: Post ${slug}\nobs:\n  url: https://blog.example/${slug}/\n  summary: ${summary}\n  status: ${status}\n---\n\nThe post's text.\n`;

const folderWith = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), "obs-ghost-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
};

describe("the Admin API token", () => {
  it("is a five-minute HS256 token for /admin/, signed with the key's secret", () => {
    const [head, body, sig] = ghostToken(KEY, 1_800_000_000_000).split(".");
    expect(JSON.parse(Buffer.from(head!, "base64url").toString())).toEqual({ alg: "HS256", typ: "JWT", kid: "a1".repeat(12) });
    expect(JSON.parse(Buffer.from(body!, "base64url").toString())).toEqual({ iat: 1_800_000_000, exp: 1_800_000_300, aud: "/admin/" });
    expect(sig).toBe(createHmac("sha256", Buffer.from("0f".repeat(32), "hex")).update(`${head}.${body}`).digest("base64url"));
  });

  it("refuses a key in the wrong shape without repeating it", () => {
    expect(() => ghostToken("not-a-key")).toThrow("should look like id:secret");
    try {
      ghostToken("abc:not-hex-secret");
    } catch (err) {
      expect(String(err)).not.toContain("not-hex-secret");
    }
  });
});

describe("ghost push", () => {
  it("writes an approved file's tags between the markers, once", async () => {
    const posts = [post("one", null), post("two", "<style>.a{color:red}</style>"), post("three", null)];
    const { ghost, writes, auth } = fakeGhost(posts);
    const dir = folderWith({ "one.md": file("one", "approved"), "two.md": file("two", "approved"), "three.md": file("three", "draft") });

    const first = await push(ghost, dir);
    expect(first.map((l) => [l.slug, l.state])).toEqual([["one", "written"], ["three", "draft"], ["two", "written"]]);
    expect(writes).toHaveLength(2);
    expect(posts[0]!.codeinjection_head).toBe(
      '<!-- obs:start -->\n<meta property="obs:summary" content="We watered once a week and the tomatoes did better.">\n<meta property="obs:url" content="https://blog.example/one">\n<!-- obs:end -->',
    );
    expect(posts[1]!.codeinjection_head!.startsWith("<style>.a{color:red}</style>\n<!-- obs:start -->")).toBe(true);
    // A draft never reaches Ghost.
    expect(posts[2]!.codeinjection_head).toBeNull();
    // The write carries the header and Ghost's collision guard, and nothing else of the post.
    expect(Object.keys(writes[0]!.body.posts[0]!).sort()).toEqual(["codeinjection_head", "updated_at"]);
    expect(auth.every((a) => /^Ghost [\w-]+\.[\w-]+\.[\w-]+$/u.test(a))).toBe(true);

    const second = await push(ghost, dir);
    expect(second.map((l) => l.state)).toEqual(["unchanged", "draft", "unchanged"]);
    expect(writes).toHaveLength(2);
  });

  it("leaves code outside the markers byte for byte, and replaces a changed summary", async () => {
    const before = "<style>\n  .a { color: red }\n</style>\n\n";
    const after = "\n\n<script>window.x = '$1 & more';</script>\n";
    const old = '<!-- obs:start -->\n<meta property="obs:summary" content="An older summary.">\n<!-- obs:end -->';
    const posts = [post("one", `${before}${old}${after}`)];
    const { ghost, writes } = fakeGhost(posts);
    const dir = folderWith({ "one.yaml": "url: https://blog.example/one/\nsummary: A corrected summary.\nstatus: approved\n" });
    expect((await push(ghost, dir)).map((l) => l.state)).toEqual(["written"]);
    const head = posts[0]!.codeinjection_head!;
    expect(head.startsWith(before)).toBe(true);
    expect(head.endsWith(after)).toBe(true);
    expect(head).toContain('content="A corrected summary."');
    expect(head).not.toContain("An older summary.");
    expect(writes).toHaveLength(1);
  });

  it("moves tags written by hand inside the markers, so the page never carries two sets", async () => {
    const hand = '<meta property="obs:summary" content="Written by hand.">\n<meta property="obs:keep" content="Keep this.">\n<link rel="me" href="https://example.social/@me">\n';
    const posts = [post("one", hand)];
    const { ghost } = fakeGhost(posts);
    const dir = folderWith({ "one.md": file("one", "approved") });
    expect((await push(ghost, dir)).map((l) => l.state)).toEqual(["written"]);
    const head = posts[0]!.codeinjection_head!;
    expect(head.match(/obs:summary/gu)).toHaveLength(1);
    expect(head).not.toContain("Written by hand.");
    expect(head.startsWith('<link rel="me" href="https://example.social/@me">\n<!-- obs:start -->')).toBe(true);
    // obs: code that is not a plain meta tag is not guessed at.
    expect(headWith("<script>/* obs:summary set below */</script>", "<!-- obs:start -->\n<!-- obs:end -->")).toBeUndefined();
  });

  it("--dry-run writes nothing; --slug takes one post; a missing post and a bad file are errors", async () => {
    const posts = [post("one", null), post("two", null)];
    const { ghost, writes } = fakeGhost(posts);
    const dir = folderWith({ "one.md": file("one", "approved"), "two.md": file("two", "approved"), "gone.md": file("gone", "approved"), "empty.yaml": "headline: No summary here\nstatus: approved\n" });
    expect((await push(ghost, dir, { dryRun: true })).map((l) => [l.slug, l.state])).toEqual([["empty", "error"], ["gone", "error"], ["one", "would write"], ["two", "would write"]]);
    expect(writes).toHaveLength(0);
    expect((await push(ghost, dir, { slug: "two" })).map((l) => [l.slug, l.state])).toEqual([["two", "written"]]);
    expect(writes.map((w) => w.id)).toEqual(["id-two"]);
  });

  it("reports Ghost's refusal when the post changed underneath it", async () => {
    const posts = [post("one", null)];
    const { ghost } = fakeGhost(posts);
    const stale = { ...posts[0]!, updated_at: "2026-10-01T00:00:00.000Z" };
    await expect(ghost.setHead(stale, "x")).rejects.toThrow("Ghost answered 409: Saving failed!");
  });
});

describe("ghost pull", () => {
  it("writes one file per published post, imports live tags as approved, and never overwrites a file", async () => {
    const live = '<!-- obs:start -->\n<meta property="obs:summary" content="Already on the page &amp; approved.">\n<meta property="obs:keep" content="Keep this.">\n<!-- obs:end -->';
    const posts = [post("one", null), post("two", live), post("three", null)];
    const { ghost, writes } = fakeGhost(posts);
    const dir = folderWith({ "three.md": "my own notes\n" });
    const lines = await pull(ghost, dir);
    expect(lines.map((l) => [l.slug, l.state])).toEqual([["one", "pulled"], ["two", "pulled"], ["three", "kept"]]);
    expect(readdirSync(dir).sort()).toEqual(["one.md", "three.md", "two.md"]);
    expect(readFileSync(join(dir, "three.md"), "utf8")).toBe("my own notes\n");
    expect(writes).toHaveLength(0);

    const one = parseBriefing(readFileSync(join(dir, "one.md"), "utf8"));
    expect(one.status).toBe("draft");
    expect(one.slug).toBe("one");
    expect(one.body).toContain("The straw did more than the hose ever did.");
    expect(one.errors[0]).toContain("No summary");

    const two = parseBriefing(readFileSync(join(dir, "two.md"), "utf8"));
    expect(two.status).toBe("approved");
    expect(two.brief!.summaries[0]!.text).toBe("Already on the page & approved.");
    expect(two.brief!.keep).toEqual(["Keep this."]);
    expect(two.brief!.url).toBe("https://blog.example/two");

    // What was pulled pushes back as one tidy write, then nothing.
    expect((await push(ghost, dir, { slug: "two" })).map((l) => l.state)).toEqual(["written"]);
    expect((await push(ghost, dir, { slug: "two" })).map((l) => l.state)).toEqual(["unchanged"]);
  });
});
