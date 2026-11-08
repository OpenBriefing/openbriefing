#!/usr/bin/env node
/**
 * openbriefing check <file | -> [--url <page url>] [--json]
 *
 * Checks a local HTML page or an RSS/Atom feed for Open Briefing Standard
 * tags and prints what a reader sees. Exits 1 when the tags are unusable.
 * Version 0.1 reads local files and standard input only; it makes no
 * network requests.
 */
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import { countWords, parseFeedObs, parseObs, SIZES, type ObsBrief, type ParseResult } from "./obs.js";

const USAGE = `Usage: openbriefing check <file | -> [--url <page url>] [--json]

Checks a page or a feed for Open Briefing Standard tags.
  --url   the page's address, used when the page has no canonical link
  --json  print the parsed result as JSON
Spec: https://openbriefingstandard.org`;

interface Args {
  command?: string;
  file?: string;
  url?: string;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--json") args.json = true;
    else if (a === "--url") args.url = argv[++i];
    else if (a === "-h" || a === "--help") args.command = "help";
    else if (args.command === undefined) args.command = a;
    else if (args.file === undefined) args.file = a;
  }
  return args;
}

function readInput(file: string): string {
  return file === "-" ? readFileSync(0, "utf8") : readFileSync(file, "utf8");
}

function isFeed(text: string, file: string): boolean {
  if (/\.(xml|rss|atom)$/iu.test(file)) return true;
  const head = text.slice(0, 500).trimStart();
  return head.startsWith("<?xml") ? /<(rss|feed)\b/iu.test(text.slice(0, 2000)) : /^<(rss|feed)\b/iu.test(head);
}

const cut = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s).replace(/\n/gu, " ");

function describe(label: string, r: ParseResult): string {
  const lines: string[] = [label];
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
    row("derive", `${b.derive.mode}; translate ${b.derive.translate ? "yes" : "no"}; combine ${b.derive.combine ? "yes" : "no"}`);
    if (b.attribution !== undefined) row("attribution", b.attribution);
    row("preference", b.preference);
    if (b.lang !== undefined) row("lang", b.lang);
    row("modified", b.modified);
    if (b.url !== undefined) row("url", `${b.url}${b.describesThisPage ? "" : "  (describes another page)"}`);
  }
  for (const e of r.errors) lines.push(`  error    ${e}`);
  for (const w of r.warnings) lines.push(`  warning  ${w}`);
  lines.push(b ? `  ok: usable, ${r.warnings.length} warning${r.warnings.length === 1 ? "" : "s"}` : "  not usable");
  return lines.join("\n");
}

function check(args: Args): number {
  if (!args.file) {
    console.error(USAGE);
    return 2;
  }
  let text: string;
  try {
    text = readInput(args.file);
  } catch (err) {
    console.error(`Cannot read ${args.file}: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
  const pageUrl = args.url ?? (args.file === "-" ? "https://localhost/" : pathToFileURL(resolve(args.file)).href);
  const label = args.file === "-" ? "(standard input)" : basename(args.file);

  if (isFeed(text, args.file)) {
    const doc = new JSDOM(text, { contentType: "text/xml" }).window.document;
    const items = [...Array.from(doc.getElementsByTagName("item")), ...Array.from(doc.getElementsByTagName("entry"))];
    const results = items.map((item) => parseFeedObs(item));
    if (args.json) console.log(JSON.stringify(results, null, 2));
    else results.forEach((r, i) => console.log(describe(`${label}, item ${i + 1}`, r)));
    if (items.length === 0) {
      if (!args.json) console.log(`${label}\n  not usable: no <item> or <entry> elements`);
      return 1;
    }
    return results.every((r) => r.brief) ? 0 : 1;
  }

  const doc = new JSDOM(text, { url: pageUrl }).window.document;
  const r = parseObs(doc, pageUrl);
  console.log(args.json ? JSON.stringify(r, null, 2) : describe(label, r));
  return r.brief ? 0 : 1;
}

function main(argv: string[]): number {
  const args = parseArgs(argv);
  if (args.command === "check") return check(args);
  console.error(USAGE);
  return args.command === "help" ? 0 : 2;
}

process.exitCode = main(process.argv.slice(2));
