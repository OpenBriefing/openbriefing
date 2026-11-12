import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { Ghost, type FetchLike, type GhostPost } from "../src/ghost.js";
import { autoTag, decide, draftAll, draftingPrompt, hookServer, registerWebhooks, slugOf, verifySignature, type Drafter } from "../src/hook.js";

const KEY = `${"a1".repeat(12)}:${"0f".repeat(32)}`;
const SECRET = "a made-up webhook secret";

const QUOTE = "The straw did more than the hose ever did.";
const TEXT = `${QUOTE} We watered once a week. ${"The beds stayed damp under the mulch through August. ".repeat(30)}`;

const post = (slug: string, head: string | null, extra: Partial<GhostPost> = {}): GhostPost => ({
  id: `id-${slug}`,
  slug,
  title: `Post ${slug}`,
  url: `https://blog.example/${slug}/`,
  updated_at: "2026-11-01T10:00:00.000Z",
  codeinjection_head: head,
  plaintext: TEXT,
  visibility: "public",
  ...extra,
});

function fakeGhost(posts: GhostPost[], options: { conflictOnce?: boolean } = {}) {
  const writes: string[] = [];
  const webhooks: { event: string; target_url: string; secret: string }[] = [];
  let conflict = options.conflictOnce ?? false;
  const fetcher: FetchLike = async (url, init) => {
    const u = new URL(url);
    const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
    if (init.method === "GET" && u.pathname === "/ghost/api/admin/posts/") {
      const slug = /slug:([a-z0-9-]+)/u.exec(u.searchParams.get("filter") ?? "")?.[1];
      return json(200, { posts: (slug ? posts.filter((p) => p.slug === slug) : posts).map((p) => ({ ...p })), meta: { pagination: { pages: 1 } } });
    }
    const m = /^\/ghost\/api\/admin\/posts\/([^/]+)\/$/u.exec(u.pathname);
    if (init.method === "PUT" && m) {
      const found = posts.find((p) => p.id === m[1])!;
      const sent = (JSON.parse(init.body ?? "{}") as { posts: { codeinjection_head: string; updated_at: string }[] }).posts[0]!;
      if (conflict) {
        conflict = false;
        found.updated_at = "2026-11-01T10:05:00.000Z";
        return json(409, { errors: [{ message: "Saving failed! Someone else is editing this post." }] });
      }
      if (sent.updated_at !== found.updated_at) return json(409, { errors: [{ message: "Saving failed!" }] });
      writes.push(sent.codeinjection_head);
      found.codeinjection_head = sent.codeinjection_head;
      found.updated_at = new Date(Date.parse(found.updated_at) + 1000).toISOString();
      return json(200, { posts: [found] });
    }
    if (init.method === "POST" && u.pathname === "/ghost/api/admin/webhooks/") {
      const hook = (JSON.parse(init.body ?? "{}") as { webhooks: { event: string; target_url: string; secret: string }[] }).webhooks[0]!;
      if (webhooks.some((w) => w.event === hook.event && w.target_url === hook.target_url)) return json(422, { errors: [{ message: "Target URL has already been used for this event." }] });
      webhooks.push(hook);
      return json(201, { webhooks: [hook] });
    }
    return json(404, { errors: [{ message: "Not found" }] });
  };
  return { ghost: new Ghost({ url: "https://blog.example/", key: KEY, fetch: fetcher, now: () => 1_800_000_000_000 }), writes, webhooks };
}

const draft = (highlights: string[] = [QUOTE]) =>
  `url: https://elsewhere.example/not-this-post\nheadline: Mulch beat watering.\nsummary: |\n  We watered once a week and the tomatoes did better. Straw kept the beds damp.\nkeep:\n  - We watered once a week and the tomatoes did better.\nhighlights:\n${highlights.map((h) => `  - text: "${h}"\n    label: The straw`).join("\n")}\nstatus: draft\n`;

function drafterOf(...answers: string[]): Drafter & { calls: number } {
  const fn = (async () => {
    fn.calls++;
    return answers[Math.min(fn.calls - 1, answers.length - 1)]!;
  }) as unknown as Drafter & { calls: number };
  fn.calls = 0;
  return fn;
}

describe("the publish hook", () => {
  it("drafts a new post's tags and writes them with its stamp", async () => {
    const posts = [post("one", "<style>.a{color:red}</style>")];
    const { ghost, writes } = fakeGhost(posts);
    const drafter = drafterOf("```yaml\n" + draft() + "```");
    expect(await autoTag(ghost, "one", drafter)).toEqual({ slug: "one", state: "written", note: "drafted" });
    const head = posts[0]!.codeinjection_head!;
    expect(head).toMatch(/^<style>\.a\{color:red\}<\/style>\n<!-- obs:start -->\n<!-- obs:auto [0-9a-f]{16} -->\n/u);
    expect(head).toContain('<meta property="obs:summary" content="We watered once a week and the tomatoes did better. Straw kept the beds damp.">');
    expect(head).toContain(`<meta property="obs:highlight" content="${QUOTE}">`);
    // The address is the post's own, whatever the draft said.
    expect(head).toContain('content="https://blog.example/one"');
    expect(head).not.toContain("elsewhere.example");

    // Its own write comes back as an edit webhook, and nothing happens.
    expect(await autoTag(ghost, "one", drafter)).toEqual({ slug: "one", state: "kept", note: "the tags are current" });
    expect(writes).toHaveLength(1);
    expect(drafter.calls).toBe(1);
  });

  it("drops a highlight the post does not contain, and tries again after an unusable draft", async () => {
    const posts = [post("one", null)];
    const { ghost } = fakeGhost(posts);
    const drafter = drafterOf("headline: no summary at all\n", draft([QUOTE, "A sentence the post never says."]));
    expect((await autoTag(ghost, "one", drafter)).state).toBe("written");
    expect(drafter.calls).toBe(2);
    expect(posts[0]!.codeinjection_head!.match(/obs:highlight"/gu)).toHaveLength(1);

    const never = drafterOf("not: a briefing\n");
    const posts2 = [post("two", null)];
    const line = await autoTag(fakeGhost(posts2).ghost, "two", never);
    expect(line.state).toBe("error");
    expect(posts2[0]!.codeinjection_head).toBeNull();
  });

  it("never writes to a post once the author has edited its tags, or wrote their own", async () => {
    const posts = [post("one", null), post("hand", '<meta property="obs:summary" content="Written by hand.">')];
    const { ghost, writes } = fakeGhost(posts);
    await autoTag(ghost, "one", drafterOf(draft()));
    posts[0]!.codeinjection_head = posts[0]!.codeinjection_head!.replace("Straw kept the beds damp.", "Straw did the work.");
    const drafter = drafterOf(draft());
    expect(await autoTag(ghost, "one", drafter)).toEqual({ slug: "one", state: "kept", note: "the author's own tags" });
    expect(await autoTag(ghost, "hand", drafter)).toEqual({ slug: "hand", state: "kept", note: "the author's own tags" });
    expect(drafter.calls).toBe(0);
    expect(writes).toHaveLength(1);
  });

  it("redoes its own tags when the post changes under a quote", async () => {
    const posts = [post("one", null)];
    const { ghost, writes } = fakeGhost(posts);
    await autoTag(ghost, "one", drafterOf(draft()));
    posts[0]!.plaintext = TEXT.replace(QUOTE, "Straw did more than the hose.");
    expect(decide(posts[0]!)).toEqual({ act: "redraft" });
    const line = await autoTag(ghost, "one", drafterOf(draft(["Straw did more than the hose."])));
    expect(line).toEqual({ slug: "one", state: "written", note: "redone, the post changed under a quote" });
    expect(writes).toHaveLength(2);
    expect(posts[0]!.codeinjection_head!.match(/obs:start/gu)).toHaveLength(1);
  });

  it("leaves a short post and a members-only post alone", () => {
    expect(decide(post("short", null, { plaintext: "A note." }))).toEqual({ act: "leave", why: "the post is under 200 words" });
    expect(decide(post("paid", null, { visibility: "paid" }))).toEqual({ act: "leave", why: "the post is not public" });
  });

  it("reads the post again when it was saved while the draft was written", async () => {
    const posts = [post("one", null)];
    const { ghost, writes } = fakeGhost(posts, { conflictOnce: true });
    expect((await autoTag(ghost, "one", drafterOf(draft()))).state).toBe("written");
    expect(writes).toHaveLength(1);
  });

  it("drafts the backlog one post at a time, up to a limit, and --dry-run writes nothing", async () => {
    const posts = [post("one", null), post("two", null), post("three", '<meta property="obs:summary" content="By hand.">'), post("four", null)];
    const { ghost, writes } = fakeGhost(posts);
    const dry = drafterOf(draft());
    expect((await draftAll(ghost, dry, { dryRun: true })).map((l) => l.state)).toEqual(["would write", "would write", "kept", "would write"]);
    expect(dry.calls).toBe(0);
    expect((await draftAll(ghost, drafterOf(draft()), { limit: 2 })).map((l) => [l.slug, l.state])).toEqual([["one", "written"], ["two", "written"]]);
    expect(writes).toHaveLength(2);
  });
});

describe("the webhook", () => {
  const sign = (body: string, ts: number, secret = SECRET) => `sha256=${createHmac("sha256", secret).update(`${body}${ts}`).digest("hex")}, t=${ts}`;

  it("accepts Ghost's signature, and nothing else", () => {
    const body = '{"post":{"current":{"slug":"one"}}}';
    expect(verifySignature(body, sign(body, 1_000_000), SECRET, 1_000_500)).toBe(true);
    expect(verifySignature(body, sign(body, 1_000_000, "another secret"), SECRET, 1_000_500)).toBe(false);
    expect(verifySignature(`${body} `, sign(body, 1_000_000), SECRET, 1_000_500)).toBe(false);
    expect(verifySignature(body, sign(body, 1_000_000), SECRET, 1_000_000 + 6 * 60_000)).toBe(false);
    expect(verifySignature(body, undefined, SECRET)).toBe(false);
    expect(verifySignature(body, sign(body, 1_000_000, ""), "", 1_000_500)).toBe(false);
  });

  it("takes only a plain slug from the payload", () => {
    expect(slugOf('{"post":{"current":{"slug":"one"}}}')).toBe("one");
    expect(slugOf('{"post":{"current":{"slug":"../../etc"}}}')).toBeUndefined();
    expect(slugOf('{"post":{"current":{"slug":"a+status:draft"}}}')).toBeUndefined();
    expect(slugOf("not json")).toBeUndefined();
  });

  it("answers 202 at once and then writes the tags; an unsigned call is refused", async () => {
    const posts = [post("one", null)];
    const { ghost, writes } = fakeGhost(posts);
    const log: string[] = [];
    const server = hookServer({ ghost, secret: SECRET, drafter: drafterOf(draft()), log: (m) => log.push(m) });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const body = JSON.stringify({ post: { current: { slug: "one" } } });
      expect((await fetch(`${base}/healthz`)).status).toBe(200);
      expect((await fetch(`${base}/ghost`, { method: "POST", body })).status).toBe(401);
      expect(writes).toHaveLength(0);
      const signed = { method: "POST", body, headers: { "x-ghost-signature": sign(body, Date.now()) } };
      // The publish and the edit that follows it, back to back.
      expect((await fetch(`${base}/ghost`, signed)).status).toBe(202);
      expect((await fetch(`${base}/ghost`, signed)).status).toBe(202);
      await server.idle();
      expect(writes).toHaveLength(1);
      expect(log).toEqual(["written one (drafted)", "kept one (the tags are current)"]);
    } finally {
      server.close();
    }
  });

  it("registers its two webhooks, and a second run changes nothing", async () => {
    const { ghost, webhooks } = fakeGhost([]);
    expect(await registerWebhooks(ghost, "https://hook.example/ghost", SECRET)).toEqual(["post.published: registered", "post.published.edited: registered"]);
    expect(await registerWebhooks(ghost, "https://hook.example/ghost", SECRET)).toEqual(["post.published: already registered", "post.published.edited: already registered"]);
    expect(webhooks.map((w) => w.event)).toEqual(["post.published", "post.published.edited"]);
  });
});

describe("the drafting prompt", () => {
  it("is the kit's prompt", () => {
    expect(draftingPrompt()).toContain("Always end the file with `status: draft`");
  });
});

describe("the publisher's own key", () => {
  it("the hook will not start without ANTHROPIC_API_KEY, and says whose key it is", async () => {
    const { spawnSync } = await import("node:child_process");
    const env = { ...process.env, GHOST_URL: "https://blog.example", GHOST_ADMIN_API_KEY: KEY, GHOST_WEBHOOK_SECRET: SECRET, ANTHROPIC_API_KEY: "" };
    const out = spawnSync("npx", ["tsx", "src/cli.ts", "ghost", "hook"], { encoding: "utf8", cwd: new URL("..", import.meta.url), env });
    expect(out.status).toBe(2);
    expect(out.stderr).toContain("your own Anthropic API key");
  }, 30_000);
});
