import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

  it("exits 0 for a page with one tag, and 1 for one with no summary", () => {
    const one = run("check", join(FIXTURES, "missing-modified.html"));
    expect(one.status).toBe(0);
    expect(one.stdout).toContain("modified     none");
    expect(one.stdout).toMatch(/fingerprint\s+[0-9a-f]{16}/u);
    const none = run("check", join(FIXTURES, "missing-summary.html"));
    expect(none.status).toBe(1);
    expect(none.stdout).toContain("No summary");
    expect(run("check", join(FIXTURES, "modified-from-article.html")).stdout).toContain("(from article:modified_time)");
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

// The network modes, against a local server that serves the fixtures as a small site.
describe("openbriefing check over the network", () => {
  let server: Server;
  let base = "";
  const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");
  const cwd = join(FIXTURES, "..", "..", "packages", "openbriefing");
  // spawnSync would block the server in this process, so these run async.
  const runAsync = (...args: string[]) =>
    new Promise<{ status: number | null; stdout: string; stderr: string }>((done) => {
      const child = spawn("npx", ["tsx", join("src", "cli.ts"), ...args], { cwd });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += String(d)));
      child.stderr.on("data", (d) => (stderr += String(d)));
      child.on("close", (status) => done({ status, stdout, stderr }));
    });

  beforeAll(async () => {
    server = createServer((req, res) => {
      const path = new URL(req.url ?? "/", "http://x").pathname;
      const html = (body: string) => {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(body);
      };
      const xml = (body: string, type = "application/xml") => {
        res.writeHead(200, { "content-type": type });
        res.end(body);
      };
      const page = /^\/p\/([a-z0-9-]+)\/$/u.exec(path);
      if (page) return html(fixture(`${page[1]}.html`));
      if (path === "/sitemap.xml") {
        const names = ["valid-full", "valid-minimal", "missing-modified", "no-tags", "over-sizes"];
        return xml(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${names
          .map((n) => `<url><loc>${base}/p/${n}/</loc><image:image><image:loc>${base}/img/${n}.png</image:loc></image:image></url>`)
          .join("")}<url><loc>${base}/gone/</loc></url></urlset>`);
      }
      if (path === "/sitemap-bad.xml") return xml(`<urlset><url><loc>${base}/p/valid-full/</loc></url><url><loc>${base}/p/missing-summary/</loc></url></urlset>`);
      if (path === "/sitemap-index.xml") return xml(`<sitemapindex><sitemap><loc>${base}/sitemap.xml</loc></sitemap></sitemapindex>`);
      if (path === "/feed.xml") {
        // One item whose page says the same, one whose page has no tags, one with no OBS elements.
        const full = fixture("valid-minimal.html");
        const summary = /obs:summary" content="([^"]+)"/u.exec(full)![1]!;
        return xml(
          `<?xml version="1.0"?><rss version="2.0" xmlns:obs="https://openbriefingstandard.org/ns#"><channel>
          <item><link>${base}/p/valid-minimal/</link><obs:summary>${summary}</obs:summary></item>
          <item><link>${base}/p/no-tags/</link><obs:modified>2026-11-09T09:30:00Z</obs:modified><obs:summary>A feed-only summary.</obs:summary></item>
          <item><link>${base}/p/no-tags/</link><title>Plain</title></item>
          </channel></rss>`,
          "application/rss+xml",
        );
      }
      res.writeHead(404);
      res.end("no");
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  it("checks a page by its address", async () => {
    const r = await runAsync("check", `${base}/p/valid-full/`);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`${base}/p/valid-full/`);
    expect(r.stdout).toContain("ok: usable");
  });

  it("exits 2 when the address cannot be fetched", async () => {
    const r = await runAsync("check", `${base}/gone/`);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("HTTP 404");
  });

  it("--sitemap: one line per page and a total; pages with no tags are not errors", async () => {
    const r = await runAsync("check", `${base}/sitemap.xml`, "--sitemap");
    expect(r.status).toBe(0);
    const lines = r.stdout.trim().split("\n");
    expect(lines.filter((l) => l.includes("/p/"))).toHaveLength(5);
    expect(r.stdout).not.toContain("/img/");
    expect(r.stdout).toMatch(/^ok\s+http.*\/p\/valid-full\/$/mu);
    expect(r.stdout).toMatch(/^ok\s+http.*\/p\/missing-modified\/$/mu);
    expect(r.stdout).toMatch(/^ok, \d+ warnings\s+http.*\/p\/over-sizes\/$/mu);
    expect(r.stdout).toMatch(/^no tags\s+http.*\/p\/no-tags\/$/mu);
    expect(r.stdout).toMatch(/^not fetched\s+http.*\/gone\/\s+\(HTTP 404\)$/mu);
    expect(lines.at(-1)).toBe("6 pages, 4 ok, 1 with no tags, 0 not usable, 1 not fetched");
  });

  it("--sitemap exits 1 when a page has tags that are not usable; --limit cuts the list", async () => {
    const bad = await runAsync("check", `${base}/sitemap-bad.xml`, "--sitemap");
    expect(bad.status).toBe(1);
    expect(bad.stdout).toMatch(/^not usable\s+http.*missing-summary\/\s+\(No summary/mu);
    const cutOff = await runAsync("check", `${base}/sitemap-bad.xml`, "--sitemap", "--limit", "1");
    expect(cutOff.status).toBe(0);
    expect(cutOff.stdout).toContain("1 page, 1 ok, 0 with no tags, 0 not usable (first 1 of 2)");
  });

  it("--sitemap follows a sitemap index one level", async () => {
    const r = await runAsync("check", `${base}/sitemap-index.xml`, "--sitemap", "--limit", "2");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("(first 2 of 6)");
  });

  it("--feed --pages: says which of page and feed stands, and whether they agree", async () => {
    const r = await runAsync("check", `${base}/feed.xml`, "--feed", "--pages");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("page     usable, 0 warnings; page and feed say the same; the page stands");
    expect(r.stdout).toContain("page     no tags; the feed stands");
    expect(r.stdout).toContain("item 3");
  });

  it("detects a feed by its content type and checks every item", async () => {
    const r = await runAsync("check", `${base}/feed.xml`);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("item 2");
    expect(r.stdout).toContain("(from obs:modified)");
  });

  it("rejects an unknown option and a bad --limit with usage", () => {
    expect(run("check", "x.html", "--nope").status).toBe(2);
    expect(run("check", "x.xml", "--sitemap", "--limit", "0").status).toBe(2);
  });
}, 120_000);
