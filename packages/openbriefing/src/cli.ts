#!/usr/bin/env node
/**
 * openbriefing check <url | file | -> [--url <page url>] [--json]
 * openbriefing check <feed url | file> --feed [--pages]
 * openbriefing check <sitemap url | file> --sitemap [--limit <n>]
 *
 * Checks a page, a feed or a whole sitemap for Open Briefing Standard tags
 * and prints what a reader sees. Exits 1 when tags are present but unusable.
 */
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import { DEFAULT_LIMITS, fetchText, isHttpUrl, mapLimit, userAgent, type FetchLimits } from "./fetch.js";
import { countWords, fingerprint, mergeObs, parseFeedObs, parseObs, SIZES, type ObsBrief, type ParseResult } from "./obs.js";

const VERSION: string = (() => {
  try {
    return (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
  } catch {
    return "0";
  }
})();

const LIMITS: FetchLimits = { ...DEFAULT_LIMITS, userAgent: userAgent(VERSION) };

const USAGE = `Usage:
  openbriefing check <url | file | -> [--url <page url>] [--json]
  openbriefing check <feed url | file> --feed [--pages]
  openbriefing check <sitemap url | file> --sitemap [--limit <n>]

Checks a page, a feed or a sitemap for Open Briefing Standard tags.
  --url      the page's address, when checking a file with no canonical link
  --feed     treat the input as an RSS or Atom feed (detected when omitted)
  --pages    with a feed: also fetch each item's page and say which one stands
  --sitemap  check every page a sitemap lists, one line each
  --limit    with a sitemap: check only the first <n> pages
  --json     print the parsed result as JSON
Spec: https://openbriefingstandard.org`;

interface Args {
  command?: string;
  target?: string;
  url?: string;
  json: boolean;
  feed: boolean;
  pages: boolean;
  sitemap: boolean;
  limit?: number;
  bad?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { json: false, feed: false, pages: false, sitemap: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--json") args.json = true;
    else if (a === "--feed") args.feed = true;
    else if (a === "--pages") args.pages = true;
    else if (a === "--sitemap") args.sitemap = true;
    else if (a === "--url") {
      const v = argv[++i];
      if (v === undefined) args.bad = "--url needs an address";
      else args.url = v;
    } else if (a === "--limit") {
      const n = Number.parseInt(argv[++i] ?? "", 10);
      if (!Number.isInteger(n) || n < 1) args.bad = "--limit needs a whole number above 0";
      else args.limit = n;
    } else if (a === "-h" || a === "--help") args.command = "help";
    else if (a === "-v" || a === "--version") args.command = "version";
    else if (a.startsWith("--")) args.bad = `unknown option ${a}`;
    else if (args.command === undefined) args.command = a;
    else if (args.target === undefined) args.target = a;
  }
  return args;
}

/** Page text is untrusted: show control characters (ANSI escapes and the like) instead of sending them to the terminal. */
const safe = (s: string) =>
  s.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/gu, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`);

const cut = (s: string, n = 60) => safe((s.length > n ? `${s.slice(0, n - 1)}…` : s).replace(/\n/gu, " "));

const MODIFIED_FROM = { obs: "obs:modified", article: "article:modified_time", feed: "the feed item's date", none: "" } as const;

function describe(label: string, r: ParseResult): string {
  const lines: string[] = [safe(label)];
  const b: ObsBrief | undefined = r.brief;
  if (b) {
    const row = (k: string, v: string) => lines.push(`  ${k.padEnd(12)} ${v}`);
    if (b.title !== undefined) row("title", `${cut(b.title)}  (${countWords(b.title)}/${SIZES.title} words)`);
    if (b.headline !== undefined) row("headline", `${cut(b.headline)}  (${countWords(b.headline)}/${SIZES.headline} words)`);
    for (const s of b.summaries) {
      const [lo, hi] = SIZES.tiers[s.tier].target;
      row(`summary`, `${s.tier.padEnd(6)} ${String(s.words).padStart(5)} words  (target ${lo}–${hi})  ${s.from}`);
    }
    b.keep.forEach((k, i) => row(i === 0 ? "keep (core)" : `keep ${i + 1}`, cut(k)));
    b.highlights.forEach((h, i) => {
      const notes = [`${h.words}/${SIZES.highlight} words`];
      if (h.label !== undefined) notes.push(cut(h.label, 30));
      if (h.inContent === false) notes.push("not in the text");
      row(`highlight ${i + 1}`, `${cut(h.text)}  (${notes.join(", ")})`);
    });
    row("derive", `${b.derive.mode}; translate ${b.derive.translate ? "yes" : "no"}; combine ${b.derive.combine ? "yes" : "no"}`);
    if (b.attribution !== undefined) row("attribution", cut(b.attribution));
    row("preference", b.preference);
    if (b.lang !== undefined) row("lang", safe(b.lang));
    row("modified", b.modified === undefined ? "none; readers compare the text of the tags" : `${safe(b.modified)}  (from ${MODIFIED_FROM[b.modifiedFrom]})`);
    row("fingerprint", fingerprint(b));
    if (b.url !== undefined) row("url", `${safe(b.url)}${b.describesThisPage ? "" : "  (describes another page)"}`);
  }
  for (const e of r.errors) lines.push(`  error    ${safe(e)}`);
  for (const w of r.warnings) lines.push(`  warning  ${safe(w)}`);
  lines.push(b ? `  ok: usable, ${r.warnings.length} warning${r.warnings.length === 1 ? "" : "s"}` : "  not usable");
  return lines.join("\n");
}

interface Loaded {
  text: string;
  /** The address the text came from, after redirects; a file: URL for a local file. */
  url: string;
  label: string;
  contentType: string;
}

async function load(target: string, urlOverride?: string): Promise<Loaded | { error: string }> {
  if (isHttpUrl(target)) {
    const res = await fetchText(target, LIMITS);
    if (!res.ok) return { error: `Cannot fetch ${safe(target)}: ${safe(res.error)}` };
    return { text: res.text, url: urlOverride ?? res.url, label: res.url, contentType: res.contentType };
  }
  try {
    const text = target === "-" ? readFileSync(0, "utf8") : readFileSync(target, "utf8");
    const url = urlOverride ?? (target === "-" ? "https://localhost/" : pathToFileURL(resolve(target)).href);
    return { text, url, label: target === "-" ? "(standard input)" : basename(target), contentType: "" };
  } catch (err) {
    return { error: `Cannot read ${safe(target)}: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function looksLikeFeed(text: string, name: string, contentType: string): boolean {
  if (/\b(rss|atom)\+xml\b/iu.test(contentType)) return true;
  if (/\.(rss|atom)$/iu.test(name)) return true;
  const head = text.slice(0, 2000).trimStart();
  return /^(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<\?[^>]*\?>\s*)*<(rss|feed)\b/iu.test(head);
}

const parsePage = (text: string, url: string): ParseResult => parseObs(new JSDOM(text, { url }).window.document, url);

function feedItems(text: string): Element[] {
  const doc = new JSDOM(text, { contentType: "text/xml" }).window.document;
  return [...Array.from(doc.getElementsByTagName("item")), ...Array.from(doc.getElementsByTagName("entry"))];
}

function itemLink(item: Element): string | undefined {
  for (const el of Array.from(item.children)) {
    if (el.localName !== "link" || el.namespaceURI === "https://openbriefingstandard.org/ns#") continue;
    const href = el.getAttribute("href");
    if (href !== null) {
      const rel = el.getAttribute("rel");
      if (rel === null || rel === "alternate") return href.trim();
    } else if (el.textContent?.trim()) return el.textContent.trim();
  }
  return undefined;
}

const NO_PAGE_TAGS = "No obs: tags on the page";
const NO_ITEM_TAGS = "No OBS elements on the item";
const hasNoTags = (r: ParseResult) => r.brief === undefined && (r.errors[0] === NO_PAGE_TAGS || r.errors[0] === NO_ITEM_TAGS);

async function checkFeed(args: Args, loaded: Loaded): Promise<number> {
  const items = feedItems(loaded.text);
  if (items.length === 0) {
    if (args.json) console.log("[]");
    else console.log(`${safe(loaded.label)}\n  not usable: no <item> or <entry> elements`);
    return 1;
  }
  const results = items.map((item) => parseFeedObs(item));
  if (!args.pages) {
    if (args.json) console.log(JSON.stringify(results, null, 2));
    else results.forEach((r, i) => console.log(describe(`${loaded.label}, item ${i + 1}`, r)));
    return results.some((r) => r.brief === undefined && !hasNoTags(r)) || results.every((r) => r.brief === undefined) ? 1 : 0;
  }

  // --pages: fetch each item's page and apply the feed-against-page rule (§14).
  const rows = await mapLimit(items, 4, async (item, i) => {
    const feed = results[i]!;
    const link = itemLink(item);
    if (link === undefined || !isHttpUrl(link)) return { link, feed, note: "the item has no link to fetch" };
    const res = await fetchText(link, LIMITS);
    if (!res.ok) return { link, feed, note: `page not fetched: ${res.error}` };
    const page = parsePage(res.text, res.url);
    const stands = mergeObs(page.brief, feed.brief);
    const which = stands === undefined ? "neither" : stands === page.brief ? "page" : "feed";
    const same = page.brief && feed.brief ? fingerprint(page.brief) === fingerprint(feed.brief) : undefined;
    return { link, feed, page, stands: which, same };
  });
  if (args.json) console.log(JSON.stringify(rows, null, 2));
  else {
    rows.forEach((row, i) => {
      console.log(describe(`${loaded.label}, item ${i + 1}${row.link ? `  ${row.link}` : ""}`, row.feed));
      if ("note" in row) console.log(`  page     ${safe(row.note ?? "")}`);
      else {
        const p = row.page;
        const state = p.brief ? `usable, ${p.warnings.length} warning${p.warnings.length === 1 ? "" : "s"}` : hasNoTags(p) ? "no tags" : "not usable";
        const agree = row.same === undefined ? "" : row.same ? "; page and feed say the same" : "; page and feed differ";
        console.log(`  page     ${state}${agree}; the ${row.stands} stands`);
        if (!p.brief && !hasNoTags(p)) for (const e of p.errors) console.log(`  page error  ${safe(e)}`);
      }
    });
  }
  const broken = rows.some((row) => (row.feed.brief === undefined && !hasNoTags(row.feed)) || ("page" in row && row.page !== undefined && row.page.brief === undefined && !hasNoTags(row.page)));
  return broken ? 1 : 0;
}

const unescapeXml = (s: string) => s.replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&quot;/gu, '"').replace(/&apos;/gu, "'").replace(/&amp;/gu, "&");

function locs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/giu)].map((m) => unescapeXml(m[1]!));
}

/** Image and video sitemaps nest their own <loc> elements; only a <url>'s direct one is a page. */
function pageLocs(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/giu)) {
    const inner = m[1]!.replace(/<(image|video|news):[a-z]+\b[\s\S]*?<\/\1:[a-z]+>/giu, "");
    const first = locs(inner)[0];
    if (first !== undefined) out.push(first);
  }
  return out;
}

async function checkSitemap(args: Args, loaded: Loaded): Promise<number> {
  let pages: string[];
  if (/<sitemapindex\b/iu.test(loaded.text)) {
    const children = locs(loaded.text).filter(isHttpUrl).slice(0, 50);
    const sets = await mapLimit(children, 4, async (child) => {
      const res = await fetchText(child, LIMITS);
      return res.ok ? pageLocs(res.text) : [];
    });
    pages = sets.flat();
  } else {
    pages = pageLocs(loaded.text);
  }
  pages = [...new Set(pages.filter(isHttpUrl))];
  const total = pages.length;
  if (args.limit !== undefined) pages = pages.slice(0, args.limit);
  if (pages.length === 0) {
    if (args.json) console.log("[]");
    else console.log(`${safe(loaded.label)}\n  no page addresses found`);
    return 1;
  }

  type Row = { url: string; status: "ok" | "no tags" | "not usable" | "not fetched"; warnings: number; detail?: string; result?: ParseResult };
  const rows = await mapLimit(pages, 4, async (url): Promise<Row> => {
    const res = await fetchText(url, LIMITS);
    if (!res.ok) return { url, status: "not fetched", warnings: 0, detail: res.error };
    const result = parsePage(res.text, res.url);
    if (result.brief) return { url, status: "ok", warnings: result.warnings.length, result };
    if (hasNoTags(result)) return { url, status: "no tags", warnings: 0, result };
    return { url, status: "not usable", warnings: result.warnings.length, detail: result.errors.join("; "), result };
  });

  const count = (s: Row["status"]) => rows.filter((r) => r.status === s).length;
  if (args.json) console.log(JSON.stringify(rows, null, 2));
  else {
    for (const r of rows) {
      const state = r.status === "ok" && r.warnings > 0 ? `ok, ${r.warnings} warning${r.warnings === 1 ? "" : "s"}` : r.status;
      console.log(`${state.padEnd(16)} ${safe(r.url)}${r.detail && r.status !== "ok" ? `  (${safe(r.detail)})` : ""}`);
    }
    const parts = [`${rows.length} page${rows.length === 1 ? "" : "s"}`, `${count("ok")} ok`, `${count("no tags")} with no tags`, `${count("not usable")} not usable`];
    if (count("not fetched") > 0) parts.push(`${count("not fetched")} not fetched`);
    console.log(`\n${parts.join(", ")}${rows.length < total ? ` (first ${rows.length} of ${total})` : ""}`);
  }
  return count("not usable") > 0 ? 1 : 0;
}

async function check(args: Args): Promise<number> {
  if (!args.target || args.bad) {
    if (args.bad) console.error(`${args.bad}\n`);
    console.error(USAGE);
    return 2;
  }
  const loaded = await load(args.target, args.url);
  if ("error" in loaded) {
    console.error(loaded.error);
    return 2;
  }
  if (args.sitemap) return checkSitemap(args, loaded);
  if (args.feed || looksLikeFeed(loaded.text, args.target, loaded.contentType)) return checkFeed(args, loaded);

  const r = parsePage(loaded.text, loaded.url);
  console.log(args.json ? JSON.stringify(r, null, 2) : describe(loaded.label, r));
  return r.brief ? 0 : 1;
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.command === "check") return check(args);
  if (args.command === "version") {
    console.log(VERSION);
    return 0;
  }
  console.error(USAGE);
  return args.command === "help" ? 0 : 2;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 2;
  },
);
