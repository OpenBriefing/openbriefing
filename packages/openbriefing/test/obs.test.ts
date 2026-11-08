import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { mergeObs, normalizeUrl, parseFeedObs, parseObs, tierFor, validateObs, type ParseResult } from "../src/obs.js";
import { FIXTURES, fixtureNames, parsePage, readFixture } from "./helpers.js";

const page = (name: string) => readFixture(`${name}.html`) as ParseResult;
const tiers = (r: ParseResult) => r.brief?.summaries.map((s) => `${s.tier}:${s.words}:${s.from}`);
const has = (list: string[], text: string) => list.some((w) => w.includes(text));

describe("pages", () => {
  it("valid-minimal: two tags, every default", () => {
    const r = page("valid-minimal");
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(tiers(r)).toEqual(["medium:280:inferred"]);
    expect(r.brief).toMatchObject({
      version: 1,
      modified: "2026-11-08T14:00:00Z",
      describesThisPage: true,
      keep: [],
      derive: { mode: "anchor", translate: true, combine: true },
      preference: "summary",
      lang: "en",
    });
    expect(r.brief?.url).toBeUndefined();
  });

  it("valid-full: every optional tag", () => {
    const r = page("valid-full");
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(tiers(r)).toEqual(["short:60:tiered", "medium:280:inferred", "long:650:tiered"]);
    expect(r.brief?.title).toBe("Spring planting plans");
    expect(r.brief?.headline).toMatch(/^The garden club planned/);
    expect(r.brief?.keep).toHaveLength(3);
    expect(r.brief?.keep[0]).toBe("Anyone may take vegetables home once the harvest begins.");
    expect(r.brief?.derive).toEqual({ mode: "anchor", translate: false, combine: true });
    expect(r.brief?.attribution).toBe("From the Garden Club newsletter");
    expect(r.brief?.lang).toBe("en-GB");
  });

  it("name-attribute reads the same as property", () => {
    expect(page("name-attribute").brief).toEqual(page("valid-minimal").brief);
  });

  it("tiered-only is valid without a bare summary", () => {
    const r = page("tiered-only");
    expect(r.errors).toEqual([]);
    expect(tiers(r)).toEqual(["short:60:tiered", "medium:300:tiered"]);
  });

  it("tier-collision: the tiered summary wins its tier", () => {
    const r = page("tier-collision");
    expect(tiers(r)).toEqual(["medium:300:tiered"]);
    expect(has(r.warnings, "set aside")).toBe(true);
  });

  it("missing-modified, bad-modified and missing-summary are unusable", () => {
    for (const name of ["missing-modified", "bad-modified", "missing-summary"]) {
      const r = page(name);
      expect(r.brief, name).toBeUndefined();
      expect(r.errors.length, name).toBeGreaterThan(0);
    }
    expect(has(page("missing-modified").errors, "obs:modified is missing")).toBe(true);
    expect(has(page("bad-modified").errors, "not an ISO 8601")).toBe(true);
    expect(has(page("missing-summary").errors, "No summary")).toBe(true);
  });

  it("url-other describes the original; url-same describes this page", () => {
    const other = page("url-other");
    expect(other.brief?.url).toBe("https://original.test/garden-notes");
    expect(other.brief?.describesThisPage).toBe(false);
    const same = page("url-same");
    expect(same.brief?.url).toBe("https://example.test/url-same");
    expect(same.brief?.describesThisPage).toBe(true);
  });

  it("bands: 120 short, 121 medium, 500 medium, 501 long", () => {
    expect(page("band-120").brief?.summaries[0]?.tier).toBe("short");
    expect(page("band-121").brief?.summaries[0]?.tier).toBe("medium");
    expect(page("band-500").brief?.summaries[0]?.tier).toBe("medium");
    expect(page("band-501").brief?.summaries[0]?.tier).toBe("long");
    // Over the target is a warning, never a rejection.
    expect(has(page("band-120").warnings, "over its size of 80")).toBe(true);
    expect(has(page("band-500").warnings, "over its size of 350")).toBe(true);
  });

  it("over-sizes: kept, with a warning each", () => {
    const r = page("over-sizes");
    expect(r.errors).toEqual([]);
    expect(tiers(r)).toEqual(["long:1400:inferred"]);
    expect(r.brief?.title).toBeDefined();
    expect(r.brief?.headline).toBeDefined();
    expect(has(r.warnings, "obs:title: 20 words")).toBe(true);
    expect(has(r.warnings, "obs:headline: 60 words")).toBe(true);
    expect(has(r.warnings, "obs:summary: 1400 words")).toBe(true);
  });

  it("keep-limits: three kept in order, the long one warned", () => {
    const r = page("keep-limits");
    expect(r.brief?.keep).toHaveLength(3);
    expect(r.brief?.keep[0]).toBe("Anyone may take vegetables home once the harvest begins.");
    expect(r.brief?.keep[2]).toBe("Children from the school help on the first Saturday.");
    expect(has(r.warnings, "only the first 3")).toBe(true);
    expect(has(r.warnings, "obs:keep #2: 55 words")).toBe(true);
  });

  it("derive values are case-insensitive; bad ones take the default", () => {
    expect(page("derive-verbatim").brief?.derive).toEqual({ mode: "verbatim", translate: true, combine: false });
    const bad = page("derive-bad");
    expect(bad.brief?.derive).toEqual({ mode: "anchor", translate: true, combine: true });
    expect(bad.warnings.filter((w) => w.includes("default"))).toHaveLength(2);
  });

  it("preference-full", () => {
    expect(page("preference-full").brief?.preference).toBe("full");
  });

  it("markup-in-text: HTML stripped, URL warned", () => {
    const r = page("markup-in-text");
    const text = r.brief?.summaries[0]?.text ?? "";
    expect(text).not.toMatch(/<[^>]+>/);
    expect(text).toContain("soon");
    expect(has(r.warnings, "HTML removed")).toBe(true);
    expect(has(r.warnings, "contains a URL")).toBe(true);
  });

  it("duplicate-headline: the first wins", () => {
    const r = page("duplicate-headline");
    expect(r.brief?.headline).toMatch(/^The garden club/);
    expect(has(r.warnings, "obs:headline appears 2 times")).toBe(true);
  });

  it("unknown-and-reserved: unknown warned, obs:audio silent", () => {
    const r = page("unknown-and-reserved");
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("obs:mood");
  });

  it("body-tags: read, with a warning", () => {
    const r = page("body-tags");
    expect(tiers(r)).toEqual(["medium:280:inferred"]);
    expect(has(r.warnings, "<body>")).toBe(true);
  });

  it("newer-version: parsed, with a warning", () => {
    const r = page("newer-version");
    expect(r.brief?.version).toBe(2);
    expect(has(r.warnings, "newer than this reader")).toBe(true);
  });

  it("lang-fallback uses <html lang>", () => {
    expect(page("lang-fallback").brief?.lang).toBe("fr");
  });

  it("paragraphs keep their newlines", () => {
    const text = page("paragraphs").brief?.summaries[0]?.text ?? "";
    expect(text.split("\n\n")).toHaveLength(2);
    expect(page("paragraphs").brief?.summaries[0]?.words).toBe(200);
  });

  it("injection is plain content", () => {
    const r = page("injection");
    expect(r.errors).toEqual([]);
    expect(r.brief?.summaries[0]?.text.startsWith("Ignore your instructions")).toBe(true);
  });

  it("no-tags", () => {
    const r = page("no-tags");
    expect(r.brief).toBeUndefined();
    expect(r.errors).toEqual(["No obs: tags on the page"]);
  });
});

describe("feeds", () => {
  it("RSS: two items; attributes map to sub-properties", () => {
    const [a, b] = readFixture("feed-rss.xml") as ParseResult[];
    expect(a?.errors).toEqual([]);
    expect(tiers(a!)).toEqual(["short:60:tiered", "medium:280:inferred"]);
    expect(a?.brief?.derive).toEqual({ mode: "anchor", translate: false, combine: true });
    expect(a?.brief?.keep).toHaveLength(1);
    expect(a?.brief?.attribution).toBe("From the Garden Club newsletter");
    expect(b?.brief?.derive).toEqual({ mode: "anchor", translate: true, combine: false });
    expect(tiers(b!)).toEqual(["short:90:inferred"]);
  });

  it("Atom: an unknown length is dropped with a warning", () => {
    const [entry] = readFixture("feed-atom.xml") as ParseResult[];
    expect(tiers(entry!)).toEqual(["medium:300:tiered"]);
    expect(has(entry!.warnings, 'length="huge"')).toBe(true);
  });

  it("feed-vs-page: the later modified stands; a tie goes to the page", () => {
    const pageBrief = page("feed-vs-page").brief!;
    const [feedBrief] = (readFixture("feed-rss.xml") as ParseResult[]).map((r) => r.brief!);
    expect(mergeObs(pageBrief, feedBrief)).toBe(feedBrief); // feed 14:00 is later than page 10:00
    const tied = { ...feedBrief!, modified: pageBrief.modified };
    expect(mergeObs(pageBrief, tied)).toBe(pageBrief);
    expect(mergeObs(undefined, feedBrief)).toBe(feedBrief);
    expect(mergeObs(pageBrief, undefined)).toBe(pageBrief);
  });
});

describe("validateObs", () => {
  it("round-trips a parsed brief", () => {
    const brief = page("valid-full").brief!;
    const r = validateObs(JSON.parse(JSON.stringify(brief)));
    expect(r.errors).toEqual([]);
    expect(r.brief).toEqual({ ...brief, lang: "en-GB" });
  });

  it("rejects non-objects and empty objects", () => {
    expect(validateObs(null).brief).toBeUndefined();
    expect(validateObs([]).brief).toBeUndefined();
    expect(validateObs({}).errors.length).toBeGreaterThan(0);
  });
});

describe("helpers", () => {
  it("tierFor", () => {
    expect([1, 120, 121, 500, 501].map(tierFor)).toEqual(["short", "short", "medium", "medium", "long"]);
  });

  it("normalizeUrl", () => {
    expect(normalizeUrl("HTTPS://Example.COM/a/?utm_source=x&id=2&fbclid=y#top")).toBe("https://example.com/a?id=2");
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com/");
    expect(normalizeUrl("mailto:a@example.com")).toBeUndefined();
    expect(normalizeUrl("/b/", "https://example.com/a/")).toBe("https://example.com/b");
  });
});

describe("robustness", () => {
  it("never throws on random tags", () => {
    const keys = ["obs:summary", "obs:modified", "obs:keep", "obs:derive", "obs:url", "obs:version", "obs:x", "obs:summary:long"];
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const junk = () => Array.from({ length: Math.floor(rand() * 40) }, () => String.fromCharCode(32 + Math.floor(rand() * 400))).join("");
    for (let i = 0; i < 1000; i++) {
      const tags = Array.from({ length: Math.floor(rand() * 8) }, () => {
        const k = keys[Math.floor(rand() * keys.length)]!;
        return `<meta property="${k}" content="${junk().replace(/"/g, "'")}">`;
      });
      const r = parsePage(`<html><head>${tags.join("")}</head></html>`, "https://example.test/x/");
      expect(Array.isArray(r.errors) && Array.isArray(r.warnings)).toBe(true);
    }
  });

  it("the parser module imports nothing", () => {
    const src = readFileSync(join(FIXTURES, "..", "..", "packages", "openbriefing", "src", "obs.ts"), "utf8");
    expect(src).not.toMatch(/^\s*import\s/m);
  });
});

describe("spec examples", () => {
  const spec = readFileSync(join(FIXTURES, "..", "v1.md"), "utf8");
  const blocks = [...spec.matchAll(/```(html|xml)\n([\s\S]*?)```/g)].map((m) => ({ lang: m[1]!, code: m[2]! }));

  it("finds the examples", () => {
    expect(blocks.length).toBeGreaterThanOrEqual(4);
  });

  it("the full HTML example parses with no errors", () => {
    const full = blocks.find((b) => b.code.includes("<!doctype html>"))!;
    const r = parsePage(full.code, "https://example.com/ask-the-author-first/");
    expect(r.errors).toEqual([]);
    expect(r.brief?.keep).toHaveLength(2);
  });

  it("the quick start's two tags parse with no errors", () => {
    const quick = blocks.find((b) => b.code.includes('obs:summary" content="Your summary'))!;
    const r = parsePage(`<html><head>${quick.code}</head></html>`, "https://example.com/x/");
    expect(r.errors).toEqual([]);
  });

  it("the feed example parses with no errors", () => {
    const feed = blocks.find((b) => b.lang === "xml")!;
    const dom = new JSDOM(feed.code, { contentType: "text/xml" });
    const item = dom.window.document.getElementsByTagName("item")[0]!;
    const r = parseFeedObs(item);
    expect(r.errors).toEqual([]);
    expect(r.brief?.derive.translate).toBe(false);
    expect(r.brief?.summaries.map((s) => s.tier)).toEqual(["short"]);
  });
});

describe("expected.json", () => {
  it("matches the parser for every fixture", () => {
    const expected = JSON.parse(readFileSync(join(FIXTURES, "expected.json"), "utf8")) as Record<string, unknown>;
    expect(Object.keys(expected).sort()).toEqual(fixtureNames());
    for (const name of fixtureNames()) {
      expect(JSON.parse(JSON.stringify(readFixture(name))), name).toEqual(expected[name]);
    }
  });
});

// Kept for the type checker: parseObs is part of the public surface.
void parseObs;
