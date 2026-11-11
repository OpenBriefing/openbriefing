import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchText, isHttpUrl, mapLimit, userAgent, type FetchLimits } from "../src/fetch.js";

let server: Server;
let base = "";
let seenAgent = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    seenAgent = req.headers["user-agent"] ?? "";
    if (url.pathname === "/ok") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<html><head><title>ok ✓</title></head></html>");
    } else if (url.pathname === "/hop") {
      const n = Number(url.searchParams.get("n") ?? "0");
      res.writeHead(302, { location: n > 0 ? `/hop?n=${n - 1}` : "/ok" });
      res.end();
    } else if (url.pathname === "/to-file") {
      res.writeHead(302, { location: "file:///etc/passwd" });
      res.end();
    } else if (url.pathname === "/big") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("x".repeat(5000));
    } else if (url.pathname === "/big-chunked") {
      res.writeHead(200, { "content-type": "text/html", "transfer-encoding": "chunked" });
      for (let i = 0; i < 10; i++) res.write("x".repeat(1000));
      res.end();
    } else if (url.pathname === "/slow") {
      setTimeout(() => {
        res.writeHead(200);
        res.end("late");
      }, 2000);
    } else {
      res.writeHead(404);
      res.end("no");
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

const limits = (over: Partial<FetchLimits> = {}): FetchLimits => ({ timeoutMs: 3000, maxBytes: 2000, maxRedirects: 3, userAgent: userAgent("9.9.9"), ...over });

describe("fetchText", () => {
  it("returns the text, the final address and the content type, and names itself", async () => {
    const r = await fetchText(`${base}/hop?n=1`, limits());
    expect(r).toMatchObject({ ok: true, url: `${base}/ok`, contentType: "text/html; charset=utf-8" });
    expect(r.ok && r.text).toContain("ok ✓");
    expect(seenAgent).toBe("openbriefing-check/9.9.9 (+https://openbriefingstandard.org)");
  });

  it("follows up to the redirect cap and no further", async () => {
    expect((await fetchText(`${base}/hop?n=2`, limits())).ok).toBe(true);
    expect(await fetchText(`${base}/hop?n=3`, limits())).toMatchObject({ ok: false, error: "more than 3 redirects" });
  });

  it("fetches only http and https, at the start and after a redirect", async () => {
    expect(await fetchText("file:///etc/passwd", limits())).toMatchObject({ ok: false });
    expect(await fetchText("ftp://example.test/x", limits())).toMatchObject({ ok: false });
    expect(await fetchText("not a url", limits())).toMatchObject({ ok: false });
    expect(await fetchText(`${base}/to-file`, limits())).toMatchObject({ ok: false, error: "redirected to an address that is not http or https" });
  });

  it("stops at the size cap, declared or not", async () => {
    expect(await fetchText(`${base}/big`, limits())).toMatchObject({ ok: false, error: "larger than 2000 bytes" });
    expect(await fetchText(`${base}/big-chunked`, limits())).toMatchObject({ ok: false, error: "larger than 2000 bytes" });
  });

  it("gives up at the timeout", async () => {
    expect(await fetchText(`${base}/slow`, limits({ timeoutMs: 300 }))).toMatchObject({ ok: false, error: "no answer within 0.3 s" });
  });

  it("reports an HTTP error and a dead host without throwing", async () => {
    expect(await fetchText(`${base}/missing`, limits())).toMatchObject({ ok: false, error: "HTTP 404" });
    expect((await fetchText("http://127.0.0.1:1/", limits())).ok).toBe(false);
  });
});

describe("helpers", () => {
  it("isHttpUrl", () => {
    expect(isHttpUrl("https://example.test/a")).toBe(true);
    expect(isHttpUrl("HTTP://example.test")).toBe(true);
    expect(isHttpUrl("file:///x")).toBe(false);
    expect(isHttpUrl("./post.html")).toBe(false);
    expect(isHttpUrl("-")).toBe(false);
  });

  it("mapLimit keeps order and never runs more than its width at once", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 4, 2, 3, 0], 2, async (n) => {
      peak = Math.max(peak, ++running);
      await new Promise((r) => setTimeout(r, n * 5));
      running--;
      return n * 2;
    });
    expect(out).toEqual([10, 2, 8, 4, 6, 0]);
    expect(peak).toBe(2);
    expect(await mapLimit([], 4, async (n: number) => n)).toEqual([]);
  });
});
