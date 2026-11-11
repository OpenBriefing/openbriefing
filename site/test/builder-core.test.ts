import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { markTags, parseBriefing, renderTags } from "../../packages/openbriefing/src/briefing";
import { fingerprint, parseFeedObs, parseObs } from "../../packages/openbriefing/src/obs";
import { approve, build, EXAMPLE, OUTPUTS } from "../src/lib/builder-core";

const EXAMPLES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "kit", "examples");
const read = (name: string) => readFileSync(join(EXAMPLES, name), "utf8");
const page = (tags: string) => parseObs(new JSDOM(`<html><head>${tags}</head><body></body></html>`, { url: "https://example.com/x/" }).window.document, "https://example.com/x/");

describe("the builder writes what openbriefing tags writes", () => {
  it("gives the package's own output for every example file, in every format", () => {
    for (const name of readdirSync(EXAMPLES).filter((f) => f !== "draft.yaml")) {
      const built = build(read(name));
      const brief = parseBriefing(read(name)).brief!;
      expect(built.outputs!.html, name).toBe(renderTags(brief, "html"));
      expect(built.outputs!.ghost, name).toBe(markTags(renderTags(brief, "html")));
      expect(built.outputs!.feed, name).toBe(renderTags(brief, "feed"));
      // Each output reads back as the same brief.
      expect(fingerprint(page(built.outputs!.html).brief!), name).toBe(fingerprint(brief));
      expect(fingerprint(page(built.outputs!.ghost).brief!), name).toBe(fingerprint(brief));
      expect(fingerprint(parseBriefing(`---\n${built.outputs!.frontmatter}\n---\n`).brief!), name).toBe(fingerprint(brief));
      const xml = `<rss version="2.0" xmlns:obs="https://openbriefingstandard.org/ns#"><channel><item>${built.outputs!.feed}</item></channel></rss>`;
      const item = new JSDOM(xml, { contentType: "text/xml" }).window.document.getElementsByTagName("item")[0]!;
      expect(fingerprint(parseFeedObs(item).brief!), name).toBe(fingerprint(brief));
    }
    expect(OUTPUTS.map((o) => o.kind)).toEqual(["html", "ghost", "frontmatter", "feed"]);
  });

  it("marks a draft's output as a draft, and approving changes only the status line", () => {
    const draft = build(EXAMPLE);
    expect(draft.briefing.status).toBe("draft");
    expect(draft.briefing.errors).toEqual([]);
    expect(draft.briefing.warnings).toEqual([]);
    expect(draft.outputs!.html.split("\n")[0]).toBe("<!-- obs: a draft, not yet approved by the author -->");
    expect(draft.outputs!.ghost.split("\n").slice(0, 2)).toEqual(["<!-- obs:start -->", "<!-- obs: a draft, not yet approved by the author -->"]);
    const approved = approve(EXAMPLE);
    expect(approved).toBe(EXAMPLE.replace("status: draft", "status: approved"));
    expect(build(approved).outputs!.html).not.toContain("a draft");
    expect(approve("summary: No status line.")).toBe("summary: No status line.\nstatus: approved\n");
    expect(approve("---\nobs:\n  summary: In front matter.\n  status: draft\n---\n")).toContain("  status: approved\n");
  });

  it("checks highlights against pasted post text, and gives no output without a summary", () => {
    const found = build(EXAMPLE, "As the secretary put it: “We had been drowning them out of kindness.”");
    expect(found.briefing.brief!.highlights[0]!.inContent).toBe(true);
    const missing = build(EXAMPLE, "A post about something else entirely.");
    expect(missing.briefing.brief!.highlights[0]!.inContent).toBe(false);
    expect(missing.briefing.warnings.join(" ")).toContain("is not in the post's text");
    const none = build("headline: Only a headline");
    expect(none.outputs).toBeUndefined();
    expect(none.briefing.errors[0]).toContain("No summary");
  });
});
