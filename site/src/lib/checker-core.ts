// The checker's logic, apart from the page: parse, describe, format. It uses
// the reference parser as it is, so the site and the CLI always agree.
import { countWords, fingerprint, parseFeedObs, parseObs, SIZES, type ObsBrief, type ObsSummary, type ParseResult } from "../../../packages/openbriefing/src/obs";

import { escapeAttr, renderTags } from "../../../packages/openbriefing/src/briefing";

export { fingerprint, SIZES, countWords };
export type { ObsBrief, ParseResult };

export type ParseXml = (text: string, type: "text/html" | "text/xml") => Document;

const browserParse: ParseXml = (text, type) => new DOMParser().parseFromString(text, type);

export function isFeedText(text: string, contentType = ""): boolean {
  if (/\b(rss|atom)\+xml\b/iu.test(contentType)) return true;
  const head = text.slice(0, 2000).trimStart();
  return /^(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<\?[^>]*\?>\s*)*<(rss|feed)\b/iu.test(head);
}

export interface PageCheck {
  kind: "page";
  url: string;
  /** obs:title, else og:title, else <title> (spec §4). */
  title?: string;
  titleFrom?: "obs:title" | "og:title" | "<title>";
  result: ParseResult;
}

export interface FeedCheck {
  kind: "feed";
  url: string;
  items: { title?: string; link?: string; result: ParseResult }[];
}

export type Check = PageCheck | FeedCheck;

export const NO_PAGE_TAGS = "No obs: tags on the page";
export const NO_ITEM_TAGS = "No OBS elements on the item";
export const hasNoTags = (r: ParseResult): boolean => r.brief === undefined && (r.errors[0] === NO_PAGE_TAGS || r.errors[0] === NO_ITEM_TAGS);

export function check(text: string, url: string, contentType = "", parse: ParseXml = browserParse): Check {
  if (isFeedText(text, contentType)) {
    const doc = parse(text, "text/xml");
    const nodes = [...Array.from(doc.getElementsByTagName("item")), ...Array.from(doc.getElementsByTagName("entry"))];
    return {
      kind: "feed",
      url,
      items: nodes.map((item) => {
        const out: FeedCheck["items"][number] = { result: parseFeedObs(item) };
        const title = Array.from(item.children).find((c) => c.localName === "title")?.textContent?.trim();
        if (title) out.title = title;
        const linkEl = Array.from(item.children).find((c) => c.localName === "link");
        const link = (linkEl?.getAttribute("href") ?? linkEl?.textContent ?? "").trim();
        if (link) out.link = link;
        return out;
      }),
    };
  }
  const doc = parse(text, "text/html");
  const result = parseObs(doc, url);
  const page: PageCheck = { kind: "page", url, result };
  const og = doc.querySelector('meta[property="og:title"], meta[name="og:title"]')?.getAttribute("content")?.trim();
  const plain = doc.querySelector("title")?.textContent?.trim();
  if (result.brief?.title) {
    page.title = result.brief.title;
    page.titleFrom = "obs:title";
  } else if (og) {
    page.title = og;
    page.titleFrom = "og:title";
  } else if (plain) {
    page.title = plain;
    page.titleFrom = "<title>";
  }
  return page;
}

/** How a summary sits against its tier's target, in plain words. */
export function sizeNote(s: ObsSummary): { text: string; state: "in" | "under" | "over" } {
  const [lo, hi] = SIZES.tiers[s.tier].target;
  if (s.words < lo) return { text: `${s.words} words, under the ${lo} to ${hi} this size aims for`, state: "under" };
  if (s.words > hi) return { text: `${s.words} words, over the ${lo} to ${hi} this size aims for`, state: "over" };
  return { text: `${s.words} words, within ${lo} to ${hi}`, state: "in" };
}

export const TIER_NAME = { short: "Short", medium: "Medium", long: "Long" } as const;

export const DERIVE_WORDS = {
  verbatim: "Use the words as written. Make nothing else from them.",
  anchor: "Shorter versions may be made from the summary. Nothing longer.",
  open: "Shorter versions may be made from the summary, and longer ones written from the piece around it.",
} as const;

export const MODIFIED_WORDS = {
  obs: "from obs:modified",
  article: "from the page's article:modified_time",
  feed: "from the feed item's date",
  none: "",
} as const;

/** The text the Listen button speaks: the credit, then the summary a briefing would use. */
export function listenText(brief: ObsBrief): { credit: string; summary: string; tier: ObsSummary["tier"] } {
  const pick = brief.summaries.find((s) => s.tier === "medium") ?? brief.summaries[0]!;
  const credit = brief.attribution ? `${brief.attribution.replace(/[.\s]+$/u, "")}, in the author's words.` : "In the author's words.";
  return { credit, summary: pick.text, tier: pick.tier };
}

export { escapeAttr };

/** The brief written back as meta tags, escaped, ready to paste into a page's head. */
export function tagsFor(brief: ObsBrief): string {
  // A page's language may be its <html lang>, which is not a tag to write back.
  const { lang: _lang, ...rest } = brief;
  return renderTags(rest);
}

/** Messages from the parser cite spec sections as (§4); the page links them. */
export function splitSection(message: string): { text: string; section?: string } {
  const m = /^(.*?)\s*\(§([0-9.]+)\)\s*$/u.exec(message);
  return m ? { text: m[1]!, section: m[2]! } : { text: message };
}

export const SECTION_ANCHOR: Record<string, string> = {
  "3": "3-tags",
  "3.1": "31-reading-the-tags",
  "4": "4-forms-and-lengths",
  "5": "5-derivation",
  "6": "6-keep-lines",
  "7": "7-highlights",
  "8": "8-credit",
  "9": "9-writing-the-text",
  "10": "10-language",
  "11": "11-preference",
  "12": "12-identity-and-syndication",
  "13": "13-freshness",
  "14": "14-feeds",
  "15": "15-versions-and-reserved-names",
};
