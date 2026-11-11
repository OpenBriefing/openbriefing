/**
 * The briefing file: a small YAML file (or the same keys under `obs:` in a
 * post's front matter) that a person or an assistant writes, and the tags it
 * turns into. A tool convention, not part of the standard.
 *
 * Browser-safe: no platform API, so the site's tag builder runs the same code.
 */
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { looseText, validateObs, type ObsBrief } from "./obs.js";

export type BriefingStatus = "draft" | "approved";

export interface Briefing {
  /** "draft" unless the file says `status: approved`. */
  status: BriefingStatus;
  /** Absent when the file has no usable summary. */
  brief?: ObsBrief;
  errors: string[];
  warnings: string[];
  /** The post's slug, from the file's front matter, when given. */
  slug?: string;
  /** The post's own text, when the file is a post with front matter. */
  body?: string;
}

const KEYS = new Set([
  "url",
  "title",
  "headline",
  "summary",
  "summary_short",
  "summary_medium",
  "summary_long",
  "keep",
  "highlights",
  "attribution",
  "derive",
  "translate",
  "combine",
  "preference",
  "lang",
  "modified",
  "status",
]);

const FRONT_MATTER = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/u;

/** A block of text as one value: a wrapped line is a space, a blank line is a paragraph break. */
function paragraphs(v: string): string {
  return v
    .replace(/\r\n?/gu, "\n")
    .split(/\n[ \t]*\n+/u)
    .map((p) => p.replace(/\s*\n\s*/gu, " ").trim())
    .filter((p) => p !== "")
    .join("\n\n");
}

const yesNo = (v: unknown): boolean | undefined => {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "yes" || s === "true") return true;
    if (s === "no" || s === "false") return false;
  }
  return undefined;
};

/** Reads a briefing file, or a post whose front matter has an `obs:` key. Never throws. */
export function parseBriefing(text: string): Briefing {
  const out: Briefing = { status: "draft", errors: [], warnings: [] };
  let data: unknown;
  let fields: unknown;
  try {
    const fm = FRONT_MATTER.exec(text);
    if (fm) {
      data = parseYaml(fm[1]!);
      const body = (fm[2] ?? "").trim();
      if (body !== "") out.body = body;
      const rec = data !== null && typeof data === "object" ? (data as Record<string, unknown>) : {};
      if (rec.obs === undefined || rec.obs === null) {
        out.errors.push("The front matter has no obs: key");
        return out;
      }
      fields = rec.obs;
      if (typeof rec.slug === "string" && rec.slug.trim() !== "") out.slug = rec.slug.trim();
    } else {
      data = parseYaml(text);
      fields = data !== null && typeof data === "object" && !Array.isArray(data) && "obs" in data && Object.keys(data).length === 1 ? (data as { obs: unknown }).obs : data;
    }
  } catch (err) {
    out.errors.push(`The file is not valid YAML: ${err instanceof Error ? (err.message.split("\n")[0] ?? err.message) : String(err)}`);
    return out;
  }
  if (fields === null || typeof fields !== "object" || Array.isArray(fields)) {
    out.errors.push("Expected keys such as summary: and headline:");
    return out;
  }
  const f = fields as Record<string, unknown>;
  for (const key of Object.keys(f)) if (!KEYS.has(key)) out.warnings.push(`${key}: is not a briefing file key; it is ignored`);

  const status = typeof f.status === "string" ? f.status.trim().toLowerCase() : undefined;
  if (status === "approved") out.status = "approved";
  else if (status !== undefined && status !== "draft") out.warnings.push(`status: "${String(f.status)}" is not draft or approved; the file is treated as a draft`);

  const text1 = (key: string): string | undefined => {
    const v = f[key];
    if (v === undefined || v === null) return undefined;
    if (typeof v === "string") return paragraphs(v);
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (v instanceof Date) return v.toISOString();
    out.warnings.push(`${key}: is not text; it is ignored`);
    return undefined;
  };

  const shape: Record<string, unknown> = { version: 1 };
  for (const key of ["url", "title", "headline", "attribution", "preference", "lang", "modified"] as const) {
    const v = text1(key);
    if (v !== undefined && v !== "") shape[key] = v;
  }
  const summaries: { tier?: string; text: string; from: string }[] = [];
  const plain = text1("summary");
  if (plain) summaries.push({ text: plain, from: "inferred" });
  for (const tier of ["short", "medium", "long"] as const) {
    const v = text1(`summary_${tier}`);
    if (v) summaries.push({ tier, text: v, from: "tiered" });
  }
  shape.summaries = summaries;

  const keep = f.keep;
  if (typeof keep === "string") shape.keep = [paragraphs(keep)];
  else if (Array.isArray(keep)) shape.keep = keep.filter((k): k is string => typeof k === "string").map(paragraphs);
  else if (keep !== undefined && keep !== null) out.warnings.push("keep: is not a list of lines; it is ignored");

  const highlights = f.highlights;
  if (Array.isArray(highlights)) {
    shape.highlights = highlights.flatMap((h): { text: string; label?: string }[] => {
      if (typeof h === "string") return [{ text: paragraphs(h) }];
      if (h !== null && typeof h === "object" && typeof (h as { text?: unknown }).text === "string") {
        const rec = h as { text: string; label?: unknown };
        return [typeof rec.label === "string" ? { text: paragraphs(rec.text), label: paragraphs(rec.label) } : { text: paragraphs(rec.text) }];
      }
      out.warnings.push("A highlight has no text; it is ignored");
      return [];
    });
  } else if (highlights !== undefined && highlights !== null) out.warnings.push("highlights: is not a list; it is ignored");

  const derive: Record<string, unknown> = {};
  const mode = text1("derive");
  if (mode !== undefined) derive.mode = mode;
  for (const key of ["translate", "combine"] as const) {
    if (f[key] === undefined || f[key] === null) continue;
    const v = yesNo(f[key]);
    if (v === undefined) out.warnings.push(`${key}: is not yes or no; it is ignored`);
    else derive[key] = v;
  }
  if (Object.keys(derive).length > 0) shape.derive = derive;

  const result = validateObs(shape);
  out.errors.push(...result.errors);
  out.warnings.push(...result.warnings);
  if (result.brief) {
    out.brief = result.brief;
    // The briefing file states the language or leaves it out; there is no page to fall back on.
    if (shape.lang === undefined) delete out.brief.lang;
    if (out.body !== undefined) checkHighlights(out.brief, out.body, out.warnings);
  }
  return out;
}

/** Marks each highlight found or not found in the post's text, as `check` does for a page (§7). */
export function checkHighlights(brief: ObsBrief, postText: string, warnings: string[]): void {
  const body = looseText(postText);
  if (body === "") return;
  for (const h of brief.highlights) {
    h.inContent = body.includes(looseText(h.text));
    if (!h.inContent) {
      const head = h.text.split(/\s+/u).slice(0, 6).join(" ");
      warnings.push(`obs:highlight "${head}…" is not in the post's text (§7)`);
    }
  }
}

// ---------------------------------------------------------------------------
// Writing tags

export function escapeAttr(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/"/gu, "&quot;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/\n/gu, "&#10;");
}

const escapeXml = (value: string): string => value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
const escapeXmlAttr = (value: string): string => escapeXml(value).replace(/"/gu, "&quot;").replace(/\n/gu, "&#10;");

export type TagFormat = "html" | "feed";

/** One [property, value] pair per tag, in the order the tags are written. Defaults are left out. */
function pairs(brief: ObsBrief): [string, string][] {
  const out: [string, string][] = [];
  if (brief.version !== 1) out.push(["obs:version", String(brief.version)]);
  if (brief.title !== undefined) out.push(["obs:title", brief.title]);
  if (brief.headline !== undefined) out.push(["obs:headline", brief.headline]);
  for (const s of brief.summaries) out.push([s.from === "tiered" ? `obs:summary:${s.tier}` : "obs:summary", s.text]);
  for (const k of brief.keep) out.push(["obs:keep", k]);
  for (const h of brief.highlights) {
    out.push(["obs:highlight", h.text]);
    if (h.label !== undefined) out.push(["obs:highlight:label", h.label]);
  }
  if (brief.derive.mode !== "anchor") out.push(["obs:derive", brief.derive.mode]);
  if (!brief.derive.translate) out.push(["obs:derive:translate", "no"]);
  if (!brief.derive.combine) out.push(["obs:derive:combine", "no"]);
  if (brief.attribution !== undefined) out.push(["obs:attribution", brief.attribution]);
  if (brief.preference !== "summary") out.push(["obs:preference", brief.preference]);
  if (brief.lang !== undefined) out.push(["obs:lang", brief.lang]);
  if (brief.url !== undefined) out.push(["obs:url", brief.url]);
  if (brief.modified !== undefined && brief.modifiedFrom === "obs") out.push(["obs:modified", brief.modified]);
  return out;
}

/**
 * A brief written as tags, every character escaped: meta tags for a page's
 * head, or the elements of §14 for an RSS item or Atom entry.
 */
export function renderTags(brief: ObsBrief, format: TagFormat = "html"): string {
  const list = pairs(brief);
  if (format === "html") return list.map(([k, v]) => `<meta property="${k}" content="${escapeAttr(v)}">`).join("\n");
  const out: string[] = [];
  const derive: string[] = [];
  let mode = "";
  for (let i = 0; i < list.length; i++) {
    const [k, v] = list[i]!;
    const name = k.slice(4);
    if (k === "obs:highlight") {
      const next = list[i + 1];
      const label = next && next[0] === "obs:highlight:label" ? ` label="${escapeXmlAttr(next[1])}"` : "";
      out.push(`<obs:highlight${label}>${escapeXml(v)}</obs:highlight>`);
    } else if (k === "obs:highlight:label") continue;
    else if (k.startsWith("obs:summary:")) out.push(`<obs:summary length="${k.slice(12)}">${escapeXml(v)}</obs:summary>`);
    else if (k === "obs:derive") mode = v;
    else if (k === "obs:derive:translate" || k === "obs:derive:combine") derive.push(` ${k.slice(11)}="${v}"`);
    else out.push(`<obs:${name}>${escapeXml(v)}</obs:${name}>`);
  }
  if (mode !== "" || derive.length > 0) {
    const at = out.findIndex((l) => l.startsWith("<obs:attribution>") || l.startsWith("<obs:preference>") || l.startsWith("<obs:lang>") || l.startsWith("<obs:url>") || l.startsWith("<obs:modified>"));
    const line = `<obs:derive${derive.join("")}>${mode === "" ? "anchor" : mode}</obs:derive>`;
    if (at === -1) out.push(line);
    else out.splice(at, 0, line);
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// The marked block, for a CMS field that holds other code too

export const MARK_START = "<!-- obs:start -->";
export const MARK_END = "<!-- obs:end -->";
export const DRAFT_NOTE = "<!-- obs: a draft, not yet approved by the author -->";

const MARKED = /<!--\s*obs:start\s*-->[\s\S]*?<!--\s*obs:end\s*-->/u;

/** Tags between the obs:start and obs:end comments. */
export function markTags(tags: string, draft = false): string {
  return [MARK_START, ...(draft ? [DRAFT_NOTE] : []), tags, MARK_END].join("\n");
}

/** The marked block in a field, markers included, when there is one. */
export function readMarked(field: string): string | undefined {
  return MARKED.exec(field)?.[0];
}

/**
 * Puts a marked block into a field. An existing block is replaced where it
 * stands; otherwise the block goes at the end. Nothing outside the markers
 * changes.
 */
export function replaceMarked(field: string, block: string): string {
  if (MARKED.test(field)) return field.replace(MARKED, () => block);
  if (field.trim() === "") return block;
  return `${field.replace(/\s+$/u, "")}\n${block}`;
}

// ---------------------------------------------------------------------------
// Writing a briefing file

/** The briefing-file keys for a brief, in the order a person reads them. */
export function briefingFields(brief: ObsBrief, status: BriefingStatus): Record<string, unknown> {
  const f: Record<string, unknown> = {};
  if (brief.url !== undefined) f.url = brief.url;
  if (brief.title !== undefined) f.title = brief.title;
  if (brief.headline !== undefined) f.headline = brief.headline;
  for (const s of brief.summaries) f[s.from === "tiered" ? `summary_${s.tier}` : "summary"] = s.text;
  if (brief.keep.length > 0) f.keep = [...brief.keep];
  if (brief.highlights.length > 0) f.highlights = brief.highlights.map((h) => (h.label === undefined ? { text: h.text } : { text: h.text, label: h.label }));
  if (brief.attribution !== undefined) f.attribution = brief.attribution;
  if (brief.derive.mode !== "anchor") f.derive = brief.derive.mode;
  if (!brief.derive.translate) f.translate = false;
  if (!brief.derive.combine) f.combine = false;
  if (brief.preference !== "summary") f.preference = brief.preference;
  if (brief.lang !== undefined) f.lang = brief.lang;
  if (brief.modified !== undefined && brief.modifiedFrom === "obs") f.modified = brief.modified;
  f.status = status;
  return f;
}

const YAML_OPTIONS = { lineWidth: 0, blockQuote: "literal" } as const;

/** A briefing file's YAML for the given keys. */
export function briefingYaml(fields: Record<string, unknown>): string {
  return stringifyYaml(fields, YAML_OPTIONS);
}

/** A post file: front matter with the post's details and an `obs:` key, then the post's text. */
export function postFile(front: Record<string, unknown>, body: string): string {
  return `---\n${stringifyYaml(front, YAML_OPTIONS)}---\n\n${body.trim()}\n`;
}

/** The same keys as front matter for a static site: an `obs:` block to paste into a post. */
export function frontMatterBlock(brief: ObsBrief): string {
  const fields = briefingFields(brief, "approved");
  delete fields.status;
  return stringifyYaml({ obs: fields }, YAML_OPTIONS).trimEnd();
}
