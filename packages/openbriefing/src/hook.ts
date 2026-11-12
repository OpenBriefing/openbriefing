/**
 * `openbriefing ghost hook` and `ghost draft`: tags written for a post when it
 * is published, with no step for the author.
 *
 * The hook drafts the summary with a model, checks every highlight against the
 * post's text, and writes the marked block into the post's Code injection
 * header. The block carries a stamp, `<!-- obs:auto <fingerprint> -->`. While
 * the tags still match the stamp the block is the hook's; once the author
 * edits them it is theirs, and the hook never writes to that post again.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { checkHighlights, MARK_END, MARK_START, parseBriefing, readMarked, renderTags } from "./briefing.js";
import { briefInHead, headWith, SLUG, type Ghost, type GhostPost, type Line } from "./ghost.js";
import { countWords, fingerprint, type ObsBrief } from "./obs.js";

/** Writes a briefing file (YAML) for a post. */
export type Drafter = (post: { title: string; url: string; text: string }) => Promise<string>;

/** A post shorter than this has nothing for a 200-word summary to shorten. */
export const MIN_WORDS = 200;

const STAMP = /<!--\s*obs:auto\s+([0-9a-f]{16})\s*-->/u;
const MAX_AGE_MS = 5 * 60 * 1000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;

/** The drafting prompt, the kit's `prompt.md`. */
export function draftingPrompt(): string {
  // Packed beside dist/ when published; at the repository's root when run from source.
  for (const rel of ["../kit/prompt.md", "../../../kit/prompt.md"]) {
    const path = new URL(rel, import.meta.url);
    if (existsSync(path)) return readFileSync(path, "utf8");
  }
  throw new Error("The drafting prompt (kit/prompt.md) is missing from this install");
}

/** A drafter that asks Claude. The key comes from ANTHROPIC_API_KEY. */
export function claudeDrafter(options: { model?: string } = {}): Drafter {
  const system = draftingPrompt();
  return async (post) => {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    // A key that is not tied to one workspace needs the workspace named.
    const workspace = process.env.ANTHROPIC_WORKSPACE_ID;
    const client = new Anthropic(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {});
    const response = await client.beta.messages.create({
      model: options.model ?? "claude-opus-5-5",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      messages: [{ role: "user", content: `Address: ${post.url}\nTitle: ${post.title}\n\n${post.text}` }],
    });
    if (response.stop_reason === "refusal") throw new Error("the model declined to draft this post");
    if (response.stop_reason === "max_tokens") throw new Error("the draft was cut off");
    return response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
  };
}

/** The marked block for a brief the hook wrote, with its stamp. */
export function autoBlock(brief: ObsBrief, url: string): string {
  const tags = renderTags(brief);
  // The stamp is taken from the tags as a reader parses them, so it holds for exactly what is on the page.
  const read = briefInHead(tags, url);
  return [MARK_START, `<!-- obs:auto ${fingerprint(read ?? brief)} -->`, tags, MARK_END].join("\n");
}

export type Decision = { act: "draft" | "redraft" } | { act: "leave"; why: string };

/** What the hook does for a post, from the post alone. */
export function decide(post: GhostPost): Decision {
  if (post.visibility !== undefined && post.visibility !== "public") return { act: "leave", why: "the post is not public" };
  const text = post.plaintext ?? "";
  if (countWords(text) < MIN_WORDS) return { act: "leave", why: `the post is under ${MIN_WORDS} words` };
  const head = post.codeinjection_head ?? "";
  if (!/obs:/u.test(head)) return { act: "draft" };
  const marked = readMarked(head);
  const stamp = marked === undefined ? undefined : STAMP.exec(marked)?.[1];
  const live = marked === undefined ? undefined : briefInHead(marked, post.url);
  if (stamp === undefined || !live || fingerprint(live) !== stamp || head.replace(marked!, "").includes("obs:")) return { act: "leave", why: "the author's own tags" };
  // Still the hook's block. It is redone only when the post changed under a quote.
  checkHighlights(live, text, []);
  if (live.highlights.some((h) => h.inContent === false)) return { act: "redraft" };
  return { act: "leave", why: "the tags are current" };
}

const unfence = (text: string): string =>
  text
    .trim()
    .replace(/^```[a-z]*\r?\n/iu, "")
    .replace(/\r?\n```$/u, "");

/** A drafted brief for a post, with any highlight the post does not contain taken out. */
export async function draftBrief(post: GhostPost, drafter: Drafter): Promise<ObsBrief> {
  const text = post.plaintext ?? "";
  let problem = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const briefing = parseBriefing(unfence(await drafter({ title: post.title, url: post.url, text })));
    if (!briefing.brief) {
      problem = briefing.errors.join("; ") || "no summary";
      continue;
    }
    const brief = briefing.brief;
    checkHighlights(brief, text, []);
    brief.highlights = brief.highlights.filter((h) => h.inContent !== false);
    // The address is the post's, whatever the draft said.
    const withUrl = parseBriefing(JSON.stringify({ ...draftFields(brief), url: post.url })).brief;
    return withUrl ?? brief;
  }
  throw new Error(`the draft was not usable: ${problem}`);
}

function draftFields(brief: ObsBrief): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (brief.title) out.title = brief.title;
  if (brief.headline) out.headline = brief.headline;
  for (const s of brief.summaries) out[s.from === "inferred" ? "summary" : `summary_${s.tier}`] = s.text;
  if (brief.keep.length > 0) out.keep = brief.keep;
  if (brief.highlights.length > 0) out.highlights = brief.highlights.map((h) => (h.label ? { text: h.text, label: h.label } : { text: h.text }));
  return out;
}

/** Drafts and writes one post's tags, when the post is the hook's to write. */
export async function autoTag(ghost: Ghost, slug: string, drafter: Drafter, options: { dryRun?: boolean } = {}): Promise<Line> {
  if (!SLUG.test(slug)) return { slug, state: "error", note: "not a post slug" };
  try {
    let post = (await ghost.posts(slug))[0];
    if (!post) return { slug, state: "skipped", note: "no published post has this slug" };
    const decision = decide(post);
    if (decision.act === "leave") return { slug, state: "kept", note: decision.why };
    if (options.dryRun) return { slug, state: "would write" };
    const brief = await draftBrief(post, drafter);
    for (let attempt = 0; ; attempt++) {
      const next = headWith(post.codeinjection_head ?? "", autoBlock(brief, post.url));
      if (next === undefined) return { slug, state: "kept", note: "the author's own tags" };
      try {
        await ghost.setHead(post, next);
        return { slug, state: "written", note: decision.act === "redraft" ? "redone, the post changed under a quote" : "drafted" };
      } catch (err) {
        // The post was saved while the draft was being written: read it again, once.
        if (attempt > 0 || !(err instanceof Error) || !err.message.includes("409")) throw err;
        const fresh = (await ghost.posts(slug))[0];
        if (!fresh || decide(fresh).act === "leave") return { slug, state: "kept", note: "the post changed while the draft was written" };
        post = fresh;
      }
    }
  } catch (err) {
    return { slug, state: "error", note: err instanceof Error ? err.message : String(err) };
  }
}

/** Drafts tags for every published post that has none. One post at a time. */
export async function draftAll(ghost: Ghost, drafter: Drafter, options: { slug?: string; limit?: number; dryRun?: boolean; onLine?: (line: Line) => void } = {}): Promise<Line[]> {
  const lines: Line[] = [];
  let written = 0;
  for (const post of await ghost.posts(options.slug)) {
    if (options.limit !== undefined && written >= options.limit) break;
    const opts = options.dryRun === undefined ? {} : { dryRun: options.dryRun };
    const line = await autoTag(ghost, post.slug, drafter, opts);
    if (line.state === "written" || line.state === "would write") written++;
    lines.push(line);
    options.onLine?.(line);
  }
  return lines;
}

/** Ghost signs a webhook as `sha256=<hex HMAC of body + t>, t=<ms>`. */
export function verifySignature(body: string, header: string | undefined, secret: string, now: number = Date.now()): boolean {
  const match = /^sha256=([0-9a-f]{64}), t=(\d+)$/u.exec(header ?? "");
  if (!match || secret === "") return false;
  const [, sig, ts] = match;
  if (Math.abs(now - Number(ts)) > MAX_AGE_MS) return false;
  const expected = createHmac("sha256", secret).update(`${body}${ts}`).digest();
  return timingSafeEqual(Buffer.from(sig!, "hex"), expected);
}

/** The slug a webhook is about. The payload is untrusted; the post itself is read from Ghost. */
export function slugOf(body: string): string | undefined {
  try {
    const slug = (JSON.parse(body) as { post?: { current?: { slug?: unknown } } }).post?.current?.slug;
    return typeof slug === "string" && SLUG.test(slug) ? slug : undefined;
  } catch {
    return undefined;
  }
}

export const HOOK_EVENTS = ["post.published", "post.published.edited"] as const;

/** Registers the hook's webhooks on the integration the Admin API key belongs to. Safe to repeat. */
export async function registerWebhooks(ghost: Ghost, target: string, secret: string): Promise<string[]> {
  const out: string[] = [];
  for (const event of HOOK_EVENTS) {
    try {
      await ghost.addWebhook(event, target, secret);
      out.push(`${event}: registered`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Ghost answers 422 when this address already has the event.
      out.push(message.includes("422") ? `${event}: already registered` : `${event}: ${message}`);
    }
  }
  return out;
}

export interface HookOptions {
  ghost: Ghost;
  secret: string;
  drafter: Drafter;
  log?: (message: string) => void;
  now?: () => number;
}

/**
 * An HTTP server for Ghost's webhooks: POST /ghost and GET /healthz. Ghost
 * gives up after two seconds, so the hook answers 202 and then does the work.
 */
export function hookServer(options: HookOptions): Server & { idle(): Promise<void> } {
  const log = options.log ?? ((m: string) => console.log(m));
  // One post at a time per slug: a publish and the edit that follows it never race.
  const busy = new Map<string, Promise<void>>();
  const run = (slug: string): void => {
    const next = (busy.get(slug) ?? Promise.resolve())
      .then(() => autoTag(options.ghost, slug, options.drafter))
      .then((line) => log(`${line.state} ${slug}${line.note ? ` (${line.note})` : ""}`))
      .catch((err: unknown) => log(`error ${slug} (${err instanceof Error ? err.message : String(err)})`))
      .finally(() => {
        if (busy.get(slug) === next) busy.delete(slug);
      });
    busy.set(slug, next);
  };
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      return;
    }
    if (req.method !== "POST" || req.url !== "/ghost") {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        res.writeHead(413).end();
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (size > MAX_BODY_BYTES) return;
      const body = Buffer.concat(chunks).toString("utf8");
      const header = req.headers["x-ghost-signature"];
      if (!verifySignature(body, typeof header === "string" ? header : undefined, options.secret, options.now?.() ?? Date.now())) {
        res.writeHead(401).end();
        return;
      }
      const slug = slugOf(body);
      if (slug === undefined) {
        res.writeHead(400).end();
        return;
      }
      res.writeHead(202).end();
      run(slug);
    });
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  return Object.assign(server, { idle: async () => void (await Promise.all([...busy.values()])) });
}
