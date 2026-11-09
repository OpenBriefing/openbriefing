import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES } from "./helpers.js";

const run = (...args: string[]) =>
  spawnSync("npx", ["tsx", join("src", "cli.ts"), ...args], { encoding: "utf8", cwd: join(FIXTURES, "..", "..", "packages", "openbriefing") });

describe("openbriefing check", () => {
  it("exits 0 and prints every form for valid-full", () => {
    const r = run("check", join(FIXTURES, "valid-full.html"));
    expect(r.status).toBe(0);
    for (const s of ["title", "headline", "short", "medium", "long", "keep (core)", "translate no", "From the Garden Club"]) expect(r.stdout).toContain(s);
  });

  it("lists highlights with their words and labels, and names one not in the text", () => {
    const r = run("check", join(FIXTURES, "highlights.html"));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("highlight 1");
    expect(r.stdout).toContain("(9/60 words, On the harvest)");
    const missing = run("check", join(FIXTURES, "highlight-not-in-text.html"));
    expect(missing.status).toBe(0);
    expect(missing.stdout).toContain("not in the text");
    expect(missing.stdout).toContain('obs:highlight "The club bought a tractor for…" is not in the page\'s text');
  });

  it("exits 1 for missing-modified", () => {
    const r = run("check", join(FIXTURES, "missing-modified.html"));
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("obs:modified is missing");
  });

  it("checks every item of a feed", () => {
    const r = run("check", join(FIXTURES, "feed-rss.xml"));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("item 2");
  });

  it("never sends control characters from a page to the terminal", () => {
    const html = '<html><head><meta property="obs:modified" content="2026-11-08T14:00:00Z"><meta property="obs:summary" content="Hello \u001b[31mred\u001b]0;pwned\u0007 world"><meta property="obs:attribution" content="From \u001b[2Jus"><meta property="obs:mood" content="x"></head></html>';
    const r = spawnSync("npx", ["tsx", join("src", "cli.ts"), "check", "-"], { encoding: "utf8", input: html, cwd: join(FIXTURES, "..", "..", "packages", "openbriefing") });
    expect(r.status).toBe(0);
    expect(r.stdout).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u);
    expect(r.stdout).toContain("\\x1b");
  });

  it("prints JSON with --json", () => {
    const r = run("check", join(FIXTURES, "valid-minimal.html"), "--json");
    expect(JSON.parse(r.stdout).brief.summaries[0].tier).toBe("medium");
    expect(JSON.parse(run("check", join(FIXTURES, "highlights.html"), "--json").stdout).brief.highlights).toHaveLength(3);
  });
}, 60_000);
