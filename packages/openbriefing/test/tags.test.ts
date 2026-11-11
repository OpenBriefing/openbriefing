import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { briefingFields, briefingYaml, frontMatterBlock, markTags, parseBriefing, readMarked, renderTags, replaceMarked } from "../src/briefing.js";
import { fingerprint, parseFeedObs, parseObs } from "../src/obs.js";
import { FIXTURES } from "./helpers.js";

const ROOT = join(FIXTURES, "..", "..");
const EXAMPLES = join(ROOT, "kit", "examples");
const example = (name: string) => readFileSync(join(EXAMPLES, name), "utf8");
const run = (...args: string[]) => spawnSync("npx", ["tsx", join("src", "cli.ts"), ...args], { encoding: "utf8", cwd: join(ROOT, "packages", "openbriefing") });

const fromHtml = (tags: string, url = "https://example.com/x/") => parseObs(new JSDOM(`<html><head>${tags}</head><body></body></html>`, { url }).window.document, url);
const fromFeed = (tags: string) => {
  const xml = `<rss version="2.0" xmlns:obs="https://openbriefingstandard.org/ns#"><channel><item>${tags}</item></channel></rss>`;
  return parseFeedObs(new JSDOM(xml, { contentType: "text/xml" }).window.document.getElementsByTagName("item")[0]!);
};

describe("the briefing file", () => {
  const names = readdirSync(EXAMPLES).filter((f) => /\.(ya?ml|md)$/u.test(f));

  it("round trips: every example's tags, as HTML and as feed elements, parse back to the same brief", () => {
    expect(names.length).toBeGreaterThanOrEqual(4);
    for (const name of names) {
      const b = parseBriefing(example(name));
      expect(b.errors, name).toEqual([]);
      const print = fingerprint(b.brief!);
      const page = fromHtml(renderTags(b.brief!, "html"));
      expect(page.errors, name).toEqual([]);
      expect(page.warnings, name).toEqual([]);
      expect(fingerprint(page.brief!), `${name} html`).toBe(print);
      const feed = fromFeed(renderTags(b.brief!, "feed"));
      expect(feed.errors, name).toEqual([]);
      expect(fingerprint(feed.brief!), `${name} feed`).toBe(print);
    }
  });

  it("escapes quotes, an ampersand and a less-than sign, and keeps a paragraph break", () => {
    const b = parseBriefing(example("quotes.yaml"));
    const html = renderTags(b.brief!);
    expect(html).toContain("&quot;the best plot under 10 m²&quot; &amp; gave it first place");
    expect(html).toContain("&lt; half");
    expect(html).toContain("year's.&#10;&#10;The club's secretary");
    expect(html.split("\n").every((l) => /^<meta property="obs:[a-z:]+" content="[^"]*">$/u.test(l))).toBe(true);
    const back = fromHtml(html).brief!;
    expect(back.summaries[0]!.text).toBe(b.brief!.summaries[0]!.text);
    expect(back.summaries[0]!.text).toContain('"the best plot under 10 m²" & gave');
    expect(back.derive.mode).toBe("verbatim");
    expect(renderTags(b.brief!, "feed")).toContain("&amp; gave it first place");
  });

  it("joins a wrapped line with a space and reads a blank line as a paragraph break", () => {
    const b = parseBriefing("summary: |\n  One line\n  wrapped here.\n\n  A second paragraph.\n");
    expect(b.brief!.summaries[0]!.text).toBe("One line wrapped here.\n\nA second paragraph.");
    expect(b.status).toBe("draft");
  });

  it("reads the front-matter form, with the post's text checked against each highlight", () => {
    const b = parseBriefing(example("post.md"));
    expect(b.status).toBe("approved");
    expect(b.slug).toBe("the-tomato-year");
    expect(b.brief!.highlights.map((h) => h.inContent)).toEqual([true, true]);
    const miss = parseBriefing(example("post.md").replace("The straw did more than the hose ever did.\n", "The club bought a tractor.\n"));
    expect(miss.brief!.highlights[1]!.inContent).toBe(false);
    expect(miss.warnings.join(" ")).toContain("is not in the post's text");
    expect(parseBriefing("---\ntitle: A post\n---\n\nText.").errors).toEqual(["The front matter has no obs: key"]);
  });

  it("reads every optional key, a keep given as one line, and yes or no", () => {
    const b = parseBriefing(
      ["summary_long: " + "word ".repeat(600), "summary: A short one.", "keep: The one line.", "highlights: [A passage.]", "derive: open", "translate: no", "combine: false", "preference: full", "lang: en-GB", "modified: 2026-11-08T14:00:00Z", "status: Approved"].join("\n"),
    );
    expect(b.errors).toEqual([]);
    expect(b.status).toBe("approved");
    const brief = b.brief!;
    expect(brief.summaries.map((s) => [s.tier, s.from])).toEqual([["short", "inferred"], ["long", "tiered"]]);
    expect(brief.keep).toEqual(["The one line."]);
    expect(brief.highlights).toEqual([{ text: "A passage.", words: 2 }]);
    expect(brief.derive).toEqual({ mode: "open", translate: false, combine: false });
    expect(brief.preference).toBe("full");
    expect(brief.lang).toBe("en-GB");
    expect(brief.modified).toBe("2026-11-08T14:00:00Z");
  });

  it("reports what it cannot use, in plain words", () => {
    expect(parseBriefing("headline: Only a headline").errors[0]).toContain("No summary");
    expect(parseBriefing("summary: [unclosed").errors[0]).toContain("not valid YAML");
    expect(parseBriefing("- a\n- b").errors[0]).toContain("Expected keys");
    const odd = parseBriefing("summary: Fine.\nsummery: Typo.\nstatus: done\ntranslate: maybe");
    expect(odd.status).toBe("draft");
    expect(odd.warnings).toEqual(["summery: is not a briefing file key; it is ignored", 'status: "done" is not draft or approved; the file is treated as a draft', "translate: is not yes or no; it is ignored"]);
  });

  it("writes a briefing file back: fields, YAML and front matter read as the same brief", () => {
    const b = parseBriefing(example("full.yaml"));
    const again = parseBriefing(briefingYaml(briefingFields(b.brief!, "approved")));
    expect(again.status).toBe("approved");
    expect(fingerprint(again.brief!)).toBe(fingerprint(b.brief!));
    expect(again.brief!.modified).toBe("2026-11-08T14:00:00Z");
    const fm = parseBriefing(`---\ntitle: A post\n${frontMatterBlock(b.brief!)}\n---\n`);
    expect(fingerprint(fm.brief!)).toBe(fingerprint(b.brief!));
    expect(fm.status).toBe("draft");
  });
});

describe("the marked block", () => {
  const block = markTags('<meta property="obs:summary" content="New.">');

  it("replaces only what is between the markers", () => {
    const head = '<style>.a{color:red}</style>\n<!-- obs:start -->\n<meta property="obs:summary" content="Old.">\n<!-- obs:end -->\n<script>track()</script>';
    const next = replaceMarked(head, block);
    expect(next).toBe(`<style>.a{color:red}</style>\n${block}\n<script>track()</script>`);
    expect(readMarked(next)).toBe(block);
    expect(replaceMarked(next, block)).toBe(next);
  });

  it("goes at the end of a field with other code, and stands alone in an empty one", () => {
    expect(replaceMarked("<style>.a{}</style>\n", block)).toBe(`<style>.a{}</style>\n${block}`);
    expect(replaceMarked("", block)).toBe(block);
    expect(readMarked("<style></style>")).toBeUndefined();
  });

  it("keeps a dollar sign in the tags as written", () => {
    const money = markTags('<meta property="obs:summary" content="It cost $1 and $& more.">');
    expect(replaceMarked(block, money)).toBe(money);
  });
});

describe("openbriefing tags", () => {
  it("prints escaped tags for an approved file and exits 0", () => {
    const r = run("tags", join(EXAMPLES, "quotes.yaml"));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('<meta property="obs:keep" content="The judge called it &quot;the best plot under 10 m²&quot;.">');
  }, 30_000);

  it("refuses a draft, and with --allow-draft marks the output as one", () => {
    const refused = run("tags", join(EXAMPLES, "draft.yaml"));
    expect(refused.status).toBe(1);
    expect(refused.stdout).toBe("");
    expect(refused.stderr).toContain("This file is a draft");
    const allowed = run("tags", join(EXAMPLES, "draft.yaml"), "--allow-draft", "--marked");
    expect(allowed.status).toBe(0);
    expect(allowed.stdout.split("\n").slice(0, 2)).toEqual(["<!-- obs:start -->", "<!-- obs: a draft, not yet approved by the author -->"]);
  }, 30_000);

  it("writes feed elements and JSON, and exits 1 with the reason when there is no summary", () => {
    const feed = run("tags", join(EXAMPLES, "full.yaml"), "--format", "feed");
    expect(feed.stdout).toContain('<obs:highlight label="On watering">We had been drowning them out of kindness.</obs:highlight>');
    expect(feed.stdout).toContain('<obs:derive translate="no">anchor</obs:derive>');
    const json = JSON.parse(run("tags", join(EXAMPLES, "full.yaml"), "--format", "json").stdout) as { status: string; fingerprint: string };
    expect(json.status).toBe("approved");
    expect(json.fingerprint).toMatch(/^[0-9a-f]{16}$/u);
    const none = spawnSync("npx", ["tsx", join("src", "cli.ts"), "tags", "-"], { input: "headline: Only this\nstatus: approved\n", encoding: "utf8", cwd: join(ROOT, "packages", "openbriefing") });
    expect(none.status).toBe(1);
    expect(none.stderr).toContain("No summary");
    expect(run("tags", join(EXAMPLES, "full.yaml"), "--format", "pdf").status).toBe(2);
  }, 30_000);
});
