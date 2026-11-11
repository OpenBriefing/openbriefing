/**
 * `openbriefing ghost pull` and `ghost push`: briefing files to and from a
 * Ghost site, through its Admin API. Push writes one thing, the block between
 * the obs:start and obs:end comments in a post's Code injection header.
 *
 * The key comes from the environment and is never printed.
 */
import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { briefingFields, markTags, parseBriefing, postFile, readMarked, renderTags, replaceMarked } from "./briefing.js";
import { fingerprint, parseObs, type ObsBrief } from "./obs.js";

export interface GhostPost {
  id: string;
  slug: string;
  title: string;
  url: string;
  updated_at: string;
  codeinjection_head: string | null;
  plaintext?: string | null;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export interface GhostConfig {
  /** The site's address, such as https://example.com. */
  url: string;
  /** An Admin API key, "id:secret". */
  key: string;
  fetch?: FetchLike;
  now?: () => number;
}

const b64url = (input: Buffer | string): string => Buffer.from(input).toString("base64url");

/** A short-lived token for Ghost's Admin API, signed with the key's secret. */
export function ghostToken(key: string, nowMs: number = Date.now()): string {
  const [id, secret] = key.split(":");
  if (!id || !secret || !/^[0-9a-f]+$/iu.test(secret)) throw new Error("GHOST_ADMIN_API_KEY should look like id:secret, as Ghost shows it");
  const iat = Math.floor(nowMs / 1000);
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT", kid: id }));
  const body = b64url(JSON.stringify({ iat, exp: iat + 300, aud: "/admin/" }));
  const sig = createHmac("sha256", Buffer.from(secret, "hex")).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

export class Ghost {
  private readonly base: string;
  private readonly fetcher: FetchLike;
  constructor(private readonly config: GhostConfig) {
    this.base = `${config.url.replace(/\/+$/u, "")}/ghost/api/admin`;
    this.fetcher = config.fetch ?? ((url, init) => fetch(url, init));
  }

  private async call(method: string, path: string, body?: unknown): Promise<unknown> {
    const headers: Record<string, string> = {
      authorization: `Ghost ${ghostToken(this.config.key, this.config.now?.() ?? Date.now())}`,
      "accept-version": "v5.0",
      accept: "application/json",
    };
    const init: { method: string; headers: Record<string, string>; body?: string } = { method, headers };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const res = await this.fetcher(`${this.base}${path}`, init);
    if (!res.ok) {
      let detail = "";
      try {
        const err = (await res.json()) as { errors?: { message?: string }[] };
        detail = err.errors?.[0]?.message ?? "";
      } catch {
        /* the status says enough */
      }
      throw new Error(`Ghost answered ${res.status}${detail ? `: ${detail}` : ""}`);
    }
    return res.json();
  }

  /** Every published post, with its plain text. */
  async posts(slug?: string): Promise<GhostPost[]> {
    const out: GhostPost[] = [];
    const filter = slug ? `status:published+slug:${slug}` : "status:published";
    for (let page = 1; page <= 200; page++) {
      const res = (await this.call("GET", `/posts/?filter=${encodeURIComponent(filter)}&formats=plaintext&limit=50&page=${page}&order=${encodeURIComponent("published_at desc")}`)) as {
        posts?: GhostPost[];
        meta?: { pagination?: { pages?: number } };
      };
      out.push(...(res.posts ?? []));
      if (page >= (res.meta?.pagination?.pages ?? 1)) break;
    }
    return out;
  }

  /** Writes a post's Code injection header and nothing else. `updated_at` is Ghost's guard against overwriting a newer edit. */
  async setHead(post: GhostPost, head: string): Promise<void> {
    await this.call("PUT", `/posts/${post.id}/`, { posts: [{ codeinjection_head: head, updated_at: post.updated_at }] });
  }
}

const META_OBS = /[ \t]*<meta\s+(?:property|name)\s*=\s*"obs:[^"]*"\s+content\s*=\s*"[^"]*"\s*\/?>[ \t]*\r?\n?/giu;

/** The brief a post's Code injection header carries now, when it has usable tags. */
export function briefInHead(head: string, url: string): ObsBrief | undefined {
  if (!/obs:/u.test(head)) return undefined;
  return parseObs(new JSDOM(`<!doctype html><html><head>${head}</head><body></body></html>`, { url }).window.document, url).brief;
}

/**
 * The header with the new block in place. Tags written by hand outside the
 * markers are taken out first, so the page never carries two sets. Returns
 * undefined when hand-written tags remain that this cannot safely move.
 */
export function headWith(head: string, block: string): string | undefined {
  const marked = readMarked(head);
  if (marked !== undefined) {
    const outside = head.replace(marked, "");
    if (/obs:(?!start|end)/u.test(outside.replace(META_OBS, ""))) return undefined;
    return replaceMarked(head.replace(marked, "\u0000").replace(META_OBS, "").replace("\u0000", () => marked), block);
  }
  const cleaned = head.replace(META_OBS, "");
  if (/obs:/u.test(cleaned)) return undefined;
  return replaceMarked(cleaned, block);
}

export interface Line {
  slug: string;
  state: "written" | "would write" | "unchanged" | "draft" | "skipped" | "pulled" | "kept" | "error";
  note?: string;
}

const briefingFiles = (folder: string): string[] =>
  readdirSync(folder)
    .filter((f) => /\.(md|markdown|ya?ml)$/iu.test(f))
    .sort();

/** Writes one file per published post into `folder`. A file that already exists is never touched. */
export async function pull(ghost: Ghost, folder: string, slug?: string): Promise<Line[]> {
  mkdirSync(folder, { recursive: true });
  const lines: Line[] = [];
  for (const post of await ghost.posts(slug)) {
    const path = join(folder, `${post.slug}.md`);
    if (existsSync(path)) {
      lines.push({ slug: post.slug, state: "kept", note: "the file is already here" });
      continue;
    }
    // Tags already live on the post were approved by whoever put them there.
    const live = briefInHead(post.codeinjection_head ?? "", post.url);
    const obs = live ? briefingFields({ ...live, url: live.url ?? post.url }, "approved") : { url: post.url, status: "draft" };
    writeFileSync(path, postFile({ slug: post.slug, title: post.title, obs }, post.plaintext ?? ""));
    lines.push({ slug: post.slug, state: "pulled", note: live ? "with the tags the post already carries, as approved" : "a draft to fill in" });
  }
  return lines;
}

/** Writes each approved file's tags into its post. A draft is never written. */
export async function push(ghost: Ghost, folder: string, options: { slug?: string; dryRun?: boolean } = {}): Promise<Line[]> {
  const lines: Line[] = [];
  const files = briefingFiles(folder).filter((f) => options.slug === undefined || f.replace(/\.[^.]+$/u, "") === options.slug);
  if (files.length === 0) return lines;
  const posts = new Map((await ghost.posts(files.length === 1 ? files[0]!.replace(/\.[^.]+$/u, "") : undefined)).map((p) => [p.slug, p]));
  for (const file of files) {
    const briefing = parseBriefing(readFileSync(join(folder, file), "utf8"));
    const slug = briefing.slug ?? file.replace(/\.[^.]+$/u, "");
    if (briefing.status !== "approved") {
      lines.push({ slug, state: "draft", note: "not approved, so not written" });
      continue;
    }
    if (!briefing.brief) {
      lines.push({ slug, state: "error", note: briefing.errors.join("; ") });
      continue;
    }
    const post = posts.get(slug);
    if (!post) {
      lines.push({ slug, state: "error", note: "no published post has this slug" });
      continue;
    }
    const head = post.codeinjection_head ?? "";
    const marked = readMarked(head);
    const live = marked === undefined ? undefined : briefInHead(marked, post.url);
    const next = headWith(head, markTags(renderTags(briefing.brief)));
    if (next === undefined) {
      lines.push({ slug, state: "skipped", note: "the post has obs: code outside the markers that is not a plain meta tag; move it by hand" });
      continue;
    }
    const outside = marked === undefined ? head : head.replace(marked, "");
    const stray = outside.replace(META_OBS, "") !== outside;
    if (live && !stray && fingerprint(live) === fingerprint(briefing.brief)) {
      lines.push({ slug, state: "unchanged" });
      continue;
    }
    if (options.dryRun) {
      lines.push({ slug, state: "would write" });
      continue;
    }
    try {
      await ghost.setHead(post, next);
      lines.push({ slug, state: "written" });
    } catch (err) {
      lines.push({ slug, state: "error", note: err instanceof Error ? err.message : String(err) });
    }
  }
  return lines;
}
