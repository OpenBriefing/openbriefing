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

  it("prints JSON with --json", () => {
    const r = run("check", join(FIXTURES, "valid-minimal.html"), "--json");
    expect(JSON.parse(r.stdout).brief.summaries[0].tier).toBe("medium");
  });
}, 60_000);
