/**
 * The Open Briefing Standard, version 1: reference parser.
 *
 * Self-contained: no runtime imports. It reads a DOM `Document` or `Element`
 * (jsdom on a server, DOMParser in a browser) and never touches the network.
 * Every function here returns a result rather than throwing.
 *
 * Section numbers in comments refer to spec/v1.md.
 */

export const OBS_NS = "https://openbriefingstandard.org/ns#";

export type ObsTier = "short" | "medium" | "long";
export type DeriveMode = "verbatim" | "anchor" | "open";
export type Preference = "summary" | "full";

export interface ObsSummary {
  tier: ObsTier;
  text: string;
  words: number;
  /** "tiered" for obs:summary:{tier}; "inferred" for a bare obs:summary (§4). */
  from: "tiered" | "inferred";
}

export interface ObsHighlight {
  /** The passage, as written. */
  text: string;
  words: number;
  /** obs:highlight:label, 6 words or fewer, when given. */
  label?: string;
  /** False when the page's text does not contain the highlight (§7). Absent for feed items and empty pages. */
  inContent?: boolean;
}

export interface ObsBrief {
  version: number;
  /** obs:modified, as given (ISO 8601). */
  modified: string;
  /** obs:url, normalized, when given. */
  url?: string;
  /** False when obs:url names content other than this page (§11). */
  describesThisPage: boolean;
  title?: string;
  headline?: string;
  /** Short to long, at most one per tier, at least one. */
  summaries: ObsSummary[];
  /** Priority order, at most 3. keep[0] is the core message (§6). */
  keep: string[];
  /** Priority order, at most 5 (§7). Empty when none. */
  highlights: ObsHighlight[];
  derive: { mode: DeriveMode; translate: boolean; combine: boolean };
  attribution?: string;
  preference: Preference;
  lang?: string;
}

export interface ParseResult {
  /** Absent when nothing usable was found. */
  brief?: ObsBrief;
  /** Why the tags are unusable. */
  errors: string[];
  /** Usable, but something is off. */
  warnings: string[];
}

/** Sizes from §4, exported so tools show the same numbers. */
export const SIZES = {
  title: 12,
  headline: 40,
  keep: 40,
  attribution: 12,
  keepMax: 3,
  highlight: 60,
  highlightLabel: 6,
  highlightMax: 5,
  tiers: {
    short: { target: [40, 80] },
    medium: { target: [200, 350] },
    long: { target: [500, 800] },
  } as Record<ObsTier, { target: [number, number] }>,
  bands: { shortMax: 120, mediumMax: 500 },
} as const;

const TIERS: readonly ObsTier[] = ["short", "medium", "long"];

/** The tier for a word count, by the bands in §4. */
export function tierFor(words: number): ObsTier {
  if (words <= SIZES.bands.shortMax) return "short";
  if (words <= SIZES.bands.mediumMax) return "medium";
  return "long";
}

/** Words are runs of characters between white space (§4). */
export function countWords(text: string): number {
  const t = text.trim();
  return t === "" ? 0 : t.split(/\s+/u).length;
}

// ---------------------------------------------------------------------------
// The property bag: every carrier (page, feed, object) is turned into one,
// then a single function builds the brief, so the rules live in one place.

interface RawHighlight {
  text: string;
  label?: string;
  inContent?: boolean;
}

/**
 * Every carrier is read into one of these. Properties lose their interleaving
 * in the map, so highlights, whose labels pair by document order (§3.1), are
 * kept in a list of their own as they are met.
 */
interface Bag {
  props: Map<string, string[]>;
  highlights: RawHighlight[];
}

const newBag = (): Bag => ({ props: new Map(), highlights: [] });

const KNOWN = new Set([
  "obs:modified",
  "obs:summary",
  "obs:summary:short",
  "obs:summary:medium",
  "obs:summary:long",
  "obs:title",
  "obs:headline",
  "obs:keep",
  "obs:highlight",
  "obs:highlight:label",
  "obs:derive",
  "obs:derive:translate",
  "obs:derive:combine",
  "obs:attribution",
  "obs:preference",
  "obs:lang",
  "obs:url",
  "obs:version",
]);

function put(bag: Bag, key: string, value: string): void {
  const list = bag.props.get(key);
  if (list) list.push(value);
  else bag.props.set(key, [value]);
}

/** Files one property, routing highlights and their labels to the ordered list (§3.1). */
function collect(bag: Bag, key: string, value: string, warnings: string[]): void {
  if (key === "obs:highlight") {
    bag.highlights.push({ text: value });
  } else if (key === "obs:highlight:label") {
    const last = bag.highlights[bag.highlights.length - 1];
    if (last === undefined) warnings.push("obs:highlight:label before any obs:highlight; it is ignored (§3.1)");
    else if (last.label === undefined) last.label = value;
    else warnings.push(`obs:highlight #${bag.highlights.length} has two labels; the first is used (§3.1)`);
  } else {
    put(bag, key, value);
  }
}

const isEmpty = (bag: Bag): boolean => bag.props.size === 0 && bag.highlights.length === 0;

interface Context {
  /** The URL the tags were read from, used to resolve and compare obs:url. */
  canonical?: string;
  /** Fallback language (<html lang>). */
  lang?: string;
}

function first(bag: Bag, key: string, warnings: string[]): string | undefined {
  const list = bag.props.get(key);
  if (!list || list.length === 0) return undefined;
  if (list.length > 1 && key !== "obs:keep") {
    warnings.push(`${key} appears ${list.length} times; the first is used (§3.1)`);
  }
  return list[0];
}

const TAG_RE = /<[^>]*>/gu;
const URL_RE = /\b(?:https?:\/\/|www\.)\S+/iu;

/** Plain-text rules of §8: strip markup, warn about URLs, trim. */
function cleanText(key: string, raw: string, warnings: string[]): string | undefined {
  let text = raw;
  if (TAG_RE.test(text)) {
    text = text.replace(TAG_RE, "");
    warnings.push(`${key}: HTML removed; values are plain text (§9)`);
  }
  TAG_RE.lastIndex = 0;
  text = text.replace(/\r\n?/gu, "\n").trim();
  if (text === "") return undefined;
  if (URL_RE.test(text)) warnings.push(`${key}: contains a URL; summaries should not (§9)`);
  return text;
}

function enumValue<T extends string>(
  key: string,
  raw: string | undefined,
  allowed: readonly T[],
  fallback: T,
  warnings: string[],
): T {
  if (raw === undefined) return fallback;
  const v = raw.trim().toLowerCase();
  if ((allowed as readonly string[]).includes(v)) return v as T;
  warnings.push(`${key}: "${raw}" is not one of ${allowed.join(", ")}; the default "${fallback}" applies`);
  return fallback;
}

/** ISO 8601 date-time, with a time and an offset or Z. */
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/u;

function validModified(v: string): boolean {
  return ISO_RE.test(v) && !Number.isNaN(Date.parse(v));
}

const TRACKING = /^(?:utm_.*|fbclid|gclid)$/iu;

/** URL comparison of §12: scheme and host case, trailing slash, tracking parameters. */
export function normalizeUrl(input: string, base?: string): string | undefined {
  let u: URL;
  try {
    u = base ? new URL(input, base) : new URL(input);
  } catch {
    return undefined;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
  u.hash = "";
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  let path = u.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.replace(/\/+$/u, "");
  const query = u.searchParams.toString();
  return `${u.protocol}//${u.host.toLowerCase()}${path}${query ? `?${query}` : ""}`;
}

function sizeWarning(key: string, words: number, max: number, warnings: string[]): void {
  if (words > max) warnings.push(`${key}: ${words} words, over its size of ${max} (§4)`);
}

function build(bag: Bag, ctx: Context, extraWarnings: string[] = []): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [...extraWarnings];

  for (const key of bag.props.keys()) {
    if (KNOWN.has(key)) continue;
    if (key.startsWith("obs:audio:") || key === "obs:audio") continue; // reserved, §15
    if (key === "obs:highlight:start" || key === "obs:highlight:end") continue; // reserved, §15
    warnings.push(`${key} is not an OBS v1 property and is ignored (§3.1)`);
  }

  // Text values, cleaned once.
  const text = (key: string): string | undefined => {
    const raw = first(bag, key, warnings);
    return raw === undefined ? undefined : cleanText(key, raw, warnings);
  };

  // obs:version
  let version = 1;
  const rawVersion = first(bag, "obs:version", warnings);
  if (rawVersion !== undefined) {
    const n = Number.parseInt(rawVersion.trim(), 10);
    if (!Number.isInteger(n) || n < 1 || String(n) !== rawVersion.trim()) {
      warnings.push(`obs:version: "${rawVersion}" is not a whole number; 1 is assumed`);
    } else {
      version = n;
      if (n > 1) warnings.push(`obs:version ${n} is newer than this reader (v1); unknown tags are ignored`);
    }
  }

  // obs:modified (required)
  const modified = first(bag, "obs:modified", warnings)?.trim();
  if (modified === undefined || modified === "") {
    errors.push("obs:modified is missing; it is required (§3)");
  } else if (!validModified(modified)) {
    errors.push(`obs:modified: "${modified}" is not an ISO 8601 date and time (§3)`);
  }

  // Summaries (§4)
  const tiered = new Map<ObsTier, ObsSummary>();
  for (const tier of TIERS) {
    const t = text(`obs:summary:${tier}`);
    if (t === undefined) continue;
    const words = countWords(t);
    tiered.set(tier, { tier, text: t, words, from: "tiered" });
    sizeWarning(`obs:summary:${tier}`, words, SIZES.tiers[tier].target[1], warnings);
  }
  const bare = text("obs:summary");
  if (bare !== undefined) {
    const words = countWords(bare);
    const tier = tierFor(words);
    if (tiered.has(tier)) {
      warnings.push(`obs:summary (${words} words) falls in the ${tier} tier, which obs:summary:${tier} already fills; it is set aside (§4)`);
    } else {
      tiered.set(tier, { tier, text: bare, words, from: "inferred" });
      sizeWarning("obs:summary", words, SIZES.tiers[tier].target[1], warnings);
    }
  }
  const summaries = TIERS.flatMap((t) => (tiered.has(t) ? [tiered.get(t)!] : []));
  if (summaries.length === 0) errors.push("No summary: obs:summary or a tiered summary is required (§3)");

  if (errors.length > 0) return { errors, warnings };

  // Optional forms
  const title = text("obs:title");
  if (title !== undefined) sizeWarning("obs:title", countWords(title), SIZES.title, warnings);
  const headline = text("obs:headline");
  if (headline !== undefined) sizeWarning("obs:headline", countWords(headline), SIZES.headline, warnings);

  // Keep lines (§6)
  const keepAll = (bag.props.get("obs:keep") ?? [])
    .map((raw) => cleanText("obs:keep", raw, warnings))
    .filter((v): v is string => v !== undefined);
  if (keepAll.length > SIZES.keepMax) {
    warnings.push(`obs:keep appears ${keepAll.length} times; only the first ${SIZES.keepMax} are used (§3)`);
  }
  const keep = keepAll.slice(0, SIZES.keepMax);
  keep.forEach((k, i) => sizeWarning(`obs:keep #${i + 1}`, countWords(k), SIZES.keep, warnings));

  // Highlights (§7)
  const highlightsAll: ObsHighlight[] = [];
  for (const raw of bag.highlights) {
    const t = cleanText("obs:highlight", raw.text, warnings);
    if (t === undefined) continue;
    const h: ObsHighlight = { text: t, words: countWords(t) };
    if (raw.label !== undefined) {
      const label = cleanText("obs:highlight:label", raw.label, warnings);
      if (label !== undefined) h.label = label;
    }
    if (typeof raw.inContent === "boolean") h.inContent = raw.inContent;
    highlightsAll.push(h);
  }
  if (highlightsAll.length > SIZES.highlightMax) {
    warnings.push(`obs:highlight appears ${highlightsAll.length} times; only the first ${SIZES.highlightMax} are used (§3)`);
  }
  const highlights = highlightsAll.slice(0, SIZES.highlightMax);
  highlights.forEach((h, i) => {
    sizeWarning(`obs:highlight #${i + 1}`, h.words, SIZES.highlight, warnings);
    if (h.label !== undefined) sizeWarning(`obs:highlight:label #${i + 1}`, countWords(h.label), SIZES.highlightLabel, warnings);
  });

  // Derivation (§5)
  const mode = enumValue("obs:derive", first(bag, "obs:derive", warnings), ["verbatim", "anchor", "open"] as const, "anchor", warnings);
  const translate = enumValue("obs:derive:translate", first(bag, "obs:derive:translate", warnings), ["yes", "no"] as const, "yes", warnings) === "yes";
  const combine = enumValue("obs:derive:combine", first(bag, "obs:derive:combine", warnings), ["yes", "no"] as const, "yes", warnings) === "yes";

  const attribution = text("obs:attribution");
  if (attribution !== undefined) sizeWarning("obs:attribution", countWords(attribution), SIZES.attribution, warnings);

  const preference = enumValue("obs:preference", first(bag, "obs:preference", warnings), ["summary", "full"] as const, "summary", warnings);

  const lang = first(bag, "obs:lang", warnings)?.trim() || ctx.lang || undefined;

  // Identity (§12)
  let url: string | undefined;
  let describesThisPage = true;
  const rawUrl = first(bag, "obs:url", warnings)?.trim();
  if (rawUrl) {
    url = normalizeUrl(rawUrl, ctx.canonical);
    if (url === undefined) {
      warnings.push(`obs:url: "${rawUrl}" is not an http or https URL; it is ignored`);
    } else if (ctx.canonical !== undefined) {
      describesThisPage = url === normalizeUrl(ctx.canonical);
    }
  }

  const brief: ObsBrief = {
    version,
    modified: modified!,
    describesThisPage,
    summaries,
    keep,
    highlights,
    derive: { mode, translate, combine },
    preference,
  };
  if (url !== undefined) brief.url = url;
  if (title !== undefined) brief.title = title;
  if (headline !== undefined) brief.headline = headline;
  if (attribution !== undefined) brief.attribution = attribution;
  if (lang !== undefined) brief.lang = lang;
  return { brief, errors, warnings };
}

/**
 * The loose comparison of §7: compatibility forms, straight quotes for curly,
 * one kind of dash, one kind of space, one case. Words themselves must match.
 */
export function looseText(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u201a\u201b\u2032]/gu, "'")
    .replace(/[\u201c\u201d\u201e\u201f\u2033]/gu, '"')
    .replace(/[\u2010-\u2015\u2212]/gu, "-")
    .replace(/\s*-\s*/gu, "-")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

/** Sets inContent on each highlight from the page's text; skipped when the body is empty (§7). */
function checkContent(brief: ObsBrief, bodyText: string | undefined, warnings: string[]): void {
  const body = bodyText === undefined ? "" : looseText(bodyText);
  if (body === "") return;
  for (const h of brief.highlights) {
    h.inContent = body.includes(looseText(h.text));
    if (!h.inContent) {
      const head = h.text.split(/\s+/u).slice(0, 6).join(" ");
      warnings.push(`obs:highlight "${head}…" is not in the page's text (§7)`);
    }
  }
}

function guard(fn: () => ParseResult): ParseResult {
  try {
    return fn();
  } catch (err) {
    return { errors: [`Could not read the tags: ${err instanceof Error ? err.message : String(err)}`], warnings: [] };
  }
}

// ---------------------------------------------------------------------------
// Pages (§3.1)

/**
 * Reads a page's obs: meta tags. `pageUrl` is where the page was fetched
 * from; the page's <link rel="canonical"> takes precedence for §11.
 */
export function parseObs(doc: Document, pageUrl: string): ParseResult {
  return guard(() => {
    const bag = newBag();
    const warnings: string[] = [];
    let inBody = false;
    for (const meta of Array.from(doc.getElementsByTagName("meta"))) {
      const key = (meta.getAttribute("property") ?? meta.getAttribute("name") ?? "").trim().toLowerCase();
      if (!key.startsWith("obs:")) continue;
      const content = meta.getAttribute("content");
      if (content === null) continue;
      if (content.trim() === "") continue;
      if (!inBody && doc.body && doc.body.contains(meta)) inBody = true;
      collect(bag, key, content, warnings);
    }
    if (isEmpty(bag)) return { errors: ["No obs: tags on the page"], warnings };
    if (inBody) warnings.push("Some obs: tags are in <body>; they belong in <head> (§3.1)");

    const canonicalHref = doc.querySelector('link[rel~="canonical"]')?.getAttribute("href") ?? undefined;
    const canonical = (canonicalHref && normalizeUrl(canonicalHref, pageUrl)) || normalizeUrl(pageUrl) || undefined;
    const lang = doc.documentElement?.getAttribute("lang")?.trim() || undefined;
    const ctx: Context = {};
    if (canonical !== undefined) ctx.canonical = canonical;
    if (lang !== undefined) ctx.lang = lang;
    const result = build(bag, ctx, warnings);
    if (result.brief) checkContent(result.brief, doc.body?.textContent ?? undefined, result.warnings);
    return result;
  });
}

// ---------------------------------------------------------------------------
// Feeds (§14)

function obsChildren(item: Element): Element[] {
  return Array.from(item.children).filter((el) => {
    if (el.namespaceURI === OBS_NS) return true;
    // Lenient: a feed that forgot to declare the namespace but used the prefix.
    return el.namespaceURI === null && el.tagName.toLowerCase().startsWith("obs:");
  });
}

function localName(el: Element): string {
  const name = el.namespaceURI === OBS_NS ? el.localName : el.tagName.slice(4);
  return name.toLowerCase();
}

function itemLink(item: Element): string | undefined {
  for (const el of Array.from(item.children)) {
    if (el.namespaceURI === OBS_NS) continue;
    if (el.localName !== "link") continue;
    const href = el.getAttribute("href");
    if (href !== null) {
      const rel = el.getAttribute("rel");
      if (rel === null || rel === "alternate") return href.trim();
    } else if (el.textContent?.trim()) {
      return el.textContent.trim();
    }
  }
  return undefined;
}

/**
 * Reads the OBS elements of one RSS <item> or Atom <entry>. `itemUrl`
 * overrides the item's own link when given.
 */
export function parseFeedObs(item: Element, itemUrl?: string): ParseResult {
  return guard(() => {
    const bag = newBag();
    const warnings: string[] = [];
    for (const el of obsChildren(item)) {
      const name = localName(el);
      const value = el.textContent ?? "";
      if (name === "highlight") {
        collect(bag, "obs:highlight", value, warnings);
        const label = el.getAttribute("label");
        if (label !== null) collect(bag, "obs:highlight:label", label, warnings);
      } else if (name === "summary") {
        const length = el.getAttribute("length")?.trim().toLowerCase();
        if (length === undefined || length === "") put(bag, "obs:summary", value);
        else if ((TIERS as readonly string[]).includes(length)) put(bag, `obs:summary:${length}`, value);
        else warnings.push(`<obs:summary length="${length}"> is not short, medium or long; it is ignored`);
      } else if (name === "derive") {
        if (value.trim() !== "") put(bag, "obs:derive", value);
        const tr = el.getAttribute("translate");
        if (tr !== null) put(bag, "obs:derive:translate", tr);
        const co = el.getAttribute("combine");
        if (co !== null) put(bag, "obs:derive:combine", co);
      } else {
        put(bag, `obs:${name}`, value);
      }
    }
    if (isEmpty(bag)) return { errors: ["No OBS elements on the item"], warnings };
    const link = itemUrl ?? itemLink(item);
    const canonical = link ? normalizeUrl(link) : undefined;
    const ctx: Context = {};
    if (canonical !== undefined) ctx.canonical = canonical;
    return build(bag, ctx, warnings);
  });
}

// ---------------------------------------------------------------------------
// Objects already in the ObsBrief shape (an ingest payload, a JSON file)

/** Checks an object in the ObsBrief shape and rebuilds it under the same rules. */
export function validateObs(input: unknown): ParseResult {
  return guard(() => {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      return { errors: ["Expected an object in the ObsBrief shape"], warnings: [] };
    }
    const o = input as Record<string, unknown>;
    const bag = newBag();
    const warnings: string[] = [];
    const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
    const set = (key: string, v: unknown) => {
      const s = str(v);
      if (s !== undefined) put(bag, key, s);
      else if (v !== undefined && v !== null) warnings.push(`${key} is not a string; it is ignored`);
    };
    set("obs:modified", o.modified);
    if (typeof o.version === "number") put(bag, "obs:version", String(o.version));
    set("obs:url", o.url);
    set("obs:title", o.title);
    set("obs:headline", o.headline);
    set("obs:attribution", o.attribution);
    set("obs:preference", o.preference);
    set("obs:lang", o.lang);
    if (Array.isArray(o.summaries)) {
      for (const s of o.summaries) {
        if (s && typeof s === "object") {
          const rec = s as Record<string, unknown>;
          const tier = str(rec.tier);
          const t = str(rec.text);
          if (t === undefined) continue;
          // A summary whose tier was inferred is re-inferred from its words.
          if (rec.from === "inferred" || tier === undefined) put(bag, "obs:summary", t);
          else if ((TIERS as readonly string[]).includes(tier)) put(bag, `obs:summary:${tier}`, t);
          else warnings.push(`A summary has tier "${tier}"; it is ignored`);
        }
      }
    }
    if (Array.isArray(o.keep)) for (const k of o.keep) set("obs:keep", k);
    if (Array.isArray(o.highlights)) {
      for (const h of o.highlights) {
        if (!h || typeof h !== "object") continue;
        const rec = h as Record<string, unknown>;
        const t = str(rec.text);
        if (t === undefined) {
          warnings.push("A highlight has no text; it is ignored");
          continue;
        }
        const raw: RawHighlight = { text: t };
        const label = str(rec.label);
        if (label !== undefined) raw.label = label;
        // The producer saw the page; its verdict is carried through.
        if (typeof rec.inContent === "boolean") raw.inContent = rec.inContent;
        bag.highlights.push(raw);
      }
    }
    if (o.derive && typeof o.derive === "object") {
      const d = o.derive as Record<string, unknown>;
      set("obs:derive", d.mode);
      if (typeof d.translate === "boolean") put(bag, "obs:derive:translate", d.translate ? "yes" : "no");
      if (typeof d.combine === "boolean") put(bag, "obs:derive:combine", d.combine ? "yes" : "no");
    }
    const result = build(bag, {}, warnings);
    if (result.brief && typeof o.describesThisPage === "boolean") {
      result.brief.describesThisPage = o.describesThisPage;
    }
    return result;
  });
}

// ---------------------------------------------------------------------------
// Feed against page (§14)

/** The later obs:modified stands; on a tie, the page stands. */
export function mergeObs(page?: ObsBrief, feed?: ObsBrief): ObsBrief | undefined {
  if (!page) return feed;
  if (!feed) return page;
  return Date.parse(feed.modified) > Date.parse(page.modified) ? feed : page;
}
