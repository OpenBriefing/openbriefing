import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { check, escapeAttr, fingerprint, hasNoTags, isFeedText, listenText, SECTION_ANCHOR, sizeNote, splitSection, tagsFor, type ParseXml } from "../src/lib/checker-core";
import { renderSpec, slug, statusLine, tagRows } from "../src/lib/spec";
import { readAdopters } from "../src/lib/adopters";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURES = join(ROOT, "spec", "fixtures");
const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");
const expected = JSON.parse(fixture("expected.json")) as Record<string, unknown>;
// jsdom stands in for the browser's DOMParser.
const parse: ParseXml = (text, type) => new JSDOM(text, { contentType: type === "text/xml" ? "text/xml" : "text/html" }).window.document;
const pageUrl = (name: string) => `https://example.test/${name.replace(/\.html$/u, "")}/`;
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as unknown;

describe("the checker agrees with the reference parser", () => {
  const names = readdirSync(FIXTURES).filter((f) => f.endsWith(".html") || f.endsWith(".xml")).sort();

  it("gives expected.json's result for every fixture, fingerprint included", () => {
    expect(names.length).toBeGreaterThan(40);
    for (const name of names) {
      const c = check(fixture(name), pageUrl(name), "", parse);
      const withPrint = (r: import("../src/lib/checker-core").ParseResult) => (r.brief ? { ...r, fingerprint: fingerprint(r.brief) } : r);
      if (name.endsWith(".xml")) {
        expect(c.kind, name).toBe("feed");
        expect(json(c.kind === "feed" ? c.items.map((i) => withPrint(i.result)) : null), name).toEqual(expected[name]);
      } else {
        expect(c.kind, name).toBe("page");
        expect(json(c.kind === "page" ? withPrint(c.result) : null), name).toEqual(expected[name]);
      }
    }
  });

  it("a page with only obs:summary is usable, with no modified time", () => {
    const c = check('<html><head><title>T</title><meta property="obs:summary" content="A summary."></head><body><p>x</p></body></html>', "https://example.test/x/", "", parse);
    expect(c.kind === "page" && c.result.brief?.modifiedFrom).toBe("none");
    expect(c.kind === "page" && c.result.errors).toEqual([]);
    expect(c.kind === "page" && c.titleFrom).toBe("<title>");
  });

  it("the title falls back from obs:title to og:title to <title>", () => {
    const base = (head: string) => check(`<html><head>${head}<meta property="obs:summary" content="S."></head></html>`, "https://example.test/x/", "", parse);
    const a = base('<title>Plain</title><meta property="og:title" content="Og"><meta property="obs:title" content="Obs">');
    expect(a.kind === "page" && [a.title, a.titleFrom]).toEqual(["Obs", "obs:title"]);
    const b = base('<title>Plain</title><meta property="og:title" content="Og">');
    expect(b.kind === "page" && [b.title, b.titleFrom]).toEqual(["Og", "og:title"]);
  });

  it("tells a page with no tags from one with broken tags", () => {
    const none = check(fixture("no-tags.html"), pageUrl("no-tags.html"), "", parse);
    expect(none.kind === "page" && hasNoTags(none.result)).toBe(true);
    const broken = check(fixture("missing-summary.html"), pageUrl("missing-summary.html"), "", parse);
    expect(broken.kind === "page" && hasNoTags(broken.result)).toBe(false);
  });

  it("detects feeds by content type or by their root element", () => {
    expect(isFeedText("<html></html>", "application/rss+xml; charset=utf-8")).toBe(true);
    expect(isFeedText(fixture("feed-atom.xml"))).toBe(true);
    expect(isFeedText(fixture("feed-rss.xml"))).toBe(true);
    expect(isFeedText(fixture("valid-full.html"))).toBe(false);
    expect(isFeedText('<?xml version="1.0"?><urlset></urlset>')).toBe(false);
    const feed = check(fixture("feed-rss.xml"), "https://example.test/feed.xml", "", parse);
    expect(feed.kind === "feed" && feed.items.map((i) => [i.title, i.link])).toEqual([
      ["Spring planting", "https://example.test/spring-planting/"],
      ["Tools and compost", "https://example.test/tools/"],
    ]);
  });
});

describe("tags for copying", () => {
  it("round-trips every usable page fixture through the parser", () => {
    for (const name of readdirSync(FIXTURES).filter((f) => f.endsWith(".html"))) {
      const first = check(fixture(name), pageUrl(name), "", parse);
      if (first.kind !== "page" || !first.result.brief) continue;
      const html = `<html><head><link rel="canonical" href="${pageUrl(name)}">${tagsFor(first.result.brief)}</head></html>`;
      const second = check(html, pageUrl(name), "", parse);
      expect(second.kind === "page" && second.result.brief && fingerprint(second.result.brief), name).toBe(fingerprint(first.result.brief));
    }
  });

  it("escapes quotes, ampersands, angle brackets and paragraph breaks", () => {
    expect(escapeAttr('She said "no" & left <early>\nNext.')).toBe("She said &quot;no&quot; &amp; left &lt;early&gt;&#10;Next.");
    const c = check('<html><head><meta property="obs:summary" content="She said &quot;no&quot; &amp; left.&#10;&#10;Next."></head></html>', "https://example.test/q/", "", parse);
    const tags = c.kind === "page" && c.result.brief ? tagsFor(c.result.brief) : "";
    expect(tags).toBe('<meta property="obs:summary" content="She said &quot;no&quot; &amp; left.&#10;&#10;Next.">');
  });

  it("writes obs:modified only when the page itself gave one", () => {
    const article = check(fixture("modified-from-article.html"), pageUrl("modified-from-article.html"), "", parse);
    expect(article.kind === "page" && tagsFor(article.result.brief!)).not.toContain("obs:modified");
    const own = check(fixture("valid-minimal.html"), pageUrl("valid-minimal.html"), "", parse);
    expect(own.kind === "page" && tagsFor(own.result.brief!)).toContain('<meta property="obs:modified" content="2026-11-08T14:00:00Z">');
  });
});

describe("what the page says", () => {
  it("sizeNote names under, within and over in words", () => {
    const s = (words: number) => sizeNote({ tier: "medium", text: "", words, from: "inferred" });
    expect(s(150)).toEqual({ text: "150 words, under the 200 to 350 this size aims for", state: "under" });
    expect(s(291)).toEqual({ text: "291 words, within 200 to 350", state: "in" });
    expect(s(420).state).toBe("over");
  });

  it("listenText speaks the credit, then the medium summary when there is one", () => {
    const full = check(fixture("valid-full.html"), pageUrl("valid-full.html"), "", parse);
    const briefOf = (c: ReturnType<typeof check>) => (c.kind === "page" ? c.result.brief! : undefined)!;
    const l = listenText(briefOf(full));
    expect(l.tier).toBe("medium");
    expect(l.credit).toBe("From the Garden Club newsletter, in the author's words.");
    const bare = check('<html><head><meta property="obs:summary" content="Short one."></head></html>', "https://example.test/x/", "", parse);
    expect(listenText(briefOf(bare))).toEqual({ credit: "In the author's words.", summary: "Short one.", tier: "short" });
  });

  it("splitSection lifts the spec reference off a message, and every reference has an anchor in the spec", () => {
    expect(splitSection("obs:title: 14 words, over its size of 12 (§4)")).toEqual({ text: "obs:title: 14 words, over its size of 12", section: "4" });
    expect(splitSection("No obs: tags on the page")).toEqual({ text: "No obs: tags on the page" });
    const ids = new Set(renderSpec().sections.map((s) => s.id));
    for (const [section, anchor] of Object.entries(SECTION_ANCHOR)) expect(ids.has(anchor), `§${section} → #${anchor}`).toBe(true);
    const cited = new Set([...readFileSync(join(ROOT, "packages", "openbriefing", "src", "obs.ts"), "utf8").matchAll(/\(§([0-9.]+)\)/gu)].map((m) => m[1]!));
    for (const section of cited) expect(SECTION_ANCHOR[section], `§${section} is cited by the parser`).toBeDefined();
  });
});

describe("build-time readers", () => {
  it("tagRows reads all 18 tags from the spec's table, obs:summary first", () => {
    const rows = tagRows();
    expect(rows).toHaveLength(18);
    expect(rows[0]!.name).toBe("obs:summary");
    expect(rows.find((r) => r.name === "obs:modified")!.required).toContain("recommended");
    expect(rows.every((r) => r.meaning.length > 10)).toBe(true);
  });

  it("renderSpec gives every section an id, keeps the spec's own links working and splits off the appendix", () => {
    const spec = renderSpec();
    expect(spec.title).toBe("Open Briefing Standard, version 1");
    expect(spec.sections.filter((s) => s.depth === 2).length).toBeGreaterThanOrEqual(17);
    expect(spec.body).toContain('href="#appendix-a-informative-honouring-publisher-intent"');
    expect(spec.appendix).toContain('id="appendix-a-informative-honouring-publisher-intent"');
    expect(spec.body).not.toContain("Appendix A (informative)</a></h2>");
    expect(spec.front).toContain("https://github.com/OpenBriefing/openbriefing/blob/main/LICENSE-SPEC");
    expect(spec.front + spec.body + spec.appendix).not.toContain('href="../');
    expect(statusLine()).toContain("The tag names are fixed");
    expect(slug("3.1 Reading the tags")).toBe("31-reading-the-tags");
  });

  it("readAdopters lists at least one publisher with an example page and one consumer", () => {
    const { publishers, consumers } = readAdopters();
    expect(publishers.length).toBeGreaterThan(0);
    expect(publishers.every((p) => p.example && /^https:\/\//u.test(p.example))).toBe(true);
    expect(consumers.length).toBeGreaterThan(0);
  });
});
