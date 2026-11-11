import { describe, expect, it } from "vitest";
import { allowedType, guardUrl } from "../src/guard.js";
import { handle, MAX_BYTES, type Env } from "../src/index.js";

const SITE = "https://openbriefingstandard.org";
const env: Env = { ALLOWED_ORIGINS: SITE, USER_AGENT: "openbriefing-check/test" };

const ask = (target: string | undefined, init: { origin?: string; method?: string } = {}, fetcher?: Parameters<typeof handle>[2], e: Env = env) => {
  const url = new URL("https://fetch.openbriefingstandard.org/");
  if (target !== undefined) url.searchParams.set("url", target);
  const headers = new Headers();
  const origin = "origin" in init ? init.origin : SITE;
  if (origin !== undefined) headers.set("origin", origin);
  return handle(new Request(url, { method: init.method ?? "GET", headers }), e, fetcher);
};

const page = (body: string, type = "text/html; charset=utf-8", extra: Record<string, string> = {}) =>
  new Response(body, { status: 200, headers: { "content-type": type, ...extra } });

const never = async () => {
  throw new Error("fetched when it should not have");
};

describe("guardUrl", () => {
  it("accepts public http and https addresses", () => {
    for (const u of ["https://example.com/a-post/", "http://blog.example.co.uk/x?y=1", "https://xn--bcher-kva.de/", "https://example.com:443/"]) {
      expect(guardUrl(u).ok, u).toBe(true);
    }
  });

  it("refuses everything that is not a public host name", () => {
    const refused = [
      "http://127.0.0.1/", "http://localhost/", "http://169.254.169.254/", "http://intranet/", "file:///etc/passwd",
      "http://10.0.0.1/", "http://192.168.1.1/", "http://[::1]/", "http://[fd00::1]/", "http://0x7f.0.0.1/", "http://2130706433/",
      "http://0177.0.0.1/", "http://127.1/", "http://app.localhost/", "http://printer.local/", "http://db.internal/", "http://localhost./",
      "ftp://example.com/", "javascript:alert(1)", "data:text/html,x", "https://user:pw@example.com/", "https://example.com:8080/",
      "https://example.com:22/", "not a url", "", "http://example.123/",
    ];
    for (const u of refused) expect(guardUrl(u).ok, u).toBe(false);
  });

  it("allowedType passes pages and feeds only", () => {
    for (const t of ["text/html", "TEXT/HTML; charset=utf-8", "application/xhtml+xml", "application/rss+xml", "application/atom+xml; charset=utf-8", "text/xml", "application/xml"]) expect(allowedType(t), t).toBe(true);
    for (const t of ["application/json", "image/png", "application/pdf", "text/plain", "", "application/octet-stream"]) expect(allowedType(t), t).toBe(false);
  });
});

describe("the fetch helper", () => {
  it("returns a page's text to the site, with CORS for the site only", async () => {
    let agent = "";
    const res = await ask("https://example.com/a/", {}, async (_url, init) => {
      agent = new Headers(init.headers).get("user-agent") ?? "";
      return page("<html><title>Hi ✓</title></html>");
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(SITE);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, url: "https://example.com/a/", contentType: "text/html; charset=utf-8", text: "<html><title>Hi ✓</title></html>" });
    expect(agent).toBe("openbriefing-check/test");
  });

  it("answers no other origin, and nothing without one", async () => {
    for (const origin of ["https://evil.example", "http://openbriefingstandard.org", "https://openbriefingstandard.org.evil.example", undefined]) {
      const res = await ask("https://example.com/", { origin }, never);
      expect(res.status, String(origin)).toBe(403);
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    }
  });

  it("answers a preflight for the site and refuses others", async () => {
    const ok = await ask(undefined, { method: "OPTIONS" }, never);
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe(SITE);
    expect((await ask(undefined, { method: "OPTIONS", origin: "https://evil.example" }, never)).status).toBe(403);
    expect((await ask("https://example.com/", { method: "POST" }, never)).status).toBe(405);
  });

  it("refuses each private or malformed address without fetching", async () => {
    for (const u of ["http://127.0.0.1/", "http://localhost/", "http://169.254.169.254/", "http://intranet/", "file:///etc/passwd"]) {
      const res = await ask(u, {}, never);
      expect(res.status, u).toBe(400);
      expect(((await res.json()) as { ok: boolean }).ok).toBe(false);
    }
    expect((await ask(undefined, {}, never)).status).toBe(400);
  });

  it("checks every redirect again, and stops after three", async () => {
    for (const to of ["http://127.0.0.1/", "http://localhost/", "http://169.254.169.254/latest/meta-data/", "http://intranet/", "file:///etc/passwd"]) {
      let calls = 0;
      const res = await ask("https://example.com/", {}, async () => {
        calls++;
        return new Response(null, { status: 302, headers: { location: to } });
      });
      expect(res.status, to).toBe(400);
      expect(calls, to).toBe(1);
    }
    let hops = 0;
    const looping = await ask("https://example.com/0", {}, async () => new Response(null, { status: 301, headers: { location: `https://example.com/${++hops}` } }));
    expect(looping.status).toBe(502);
    expect(hops).toBe(4);
    const followed = await ask("https://example.com/", {}, async (url) => (url.endsWith("/final") ? page("done") : new Response(null, { status: 302, headers: { location: "/final" } })));
    expect(await followed.json()).toMatchObject({ ok: true, url: "https://example.com/final", text: "done" });
  });

  it("passes pages and feeds, and nothing else", async () => {
    expect((await ask("https://example.com/feed", {}, async () => page("<rss/>", "application/rss+xml"))).status).toBe(200);
    for (const type of ["application/json", "image/png", "application/pdf", "text/plain"]) {
      expect((await ask("https://example.com/x", {}, async () => page("x", type))).status, type).toBe(415);
    }
  });

  it("stops at 2 MB, declared or not", async () => {
    const declared = await ask("https://example.com/big", {}, async () => page("x", "text/html", { "content-length": String(MAX_BYTES + 1) }));
    expect(declared.status).toBe(413);
    const streamed = await ask("https://example.com/big", {}, async () => page("x".repeat(MAX_BYTES + 10)));
    expect(streamed.status).toBe(413);
    expect((await ask("https://example.com/ok", {}, async () => page("x".repeat(MAX_BYTES)))).status).toBe(200);
  });

  it("reports an upstream error and an unreachable host plainly", async () => {
    const missing = await ask("https://example.com/gone", {}, async () => new Response("no", { status: 404 }));
    expect(missing.status).toBe(502);
    expect(await missing.json()).toEqual({ ok: false, error: "The page answered 404." });
    const dead = await ask("https://example.com/", {}, async () => {
      throw new TypeError("connect failed");
    });
    expect(dead.status).toBe(504);
    expect(JSON.stringify(await dead.json())).not.toContain("connect failed");
  });

  it("rate limits by address when the binding is present", async () => {
    let n = 0;
    const limited: Env = { ...env, LIMITER: { limit: async () => ({ success: ++n <= 2 }) } };
    const go = () => ask("https://example.com/", {}, async () => page("ok"), limited);
    expect((await go()).status).toBe(200);
    expect((await go()).status).toBe(200);
    const third = await go();
    expect(third.status).toBe(429);
    expect(third.headers.get("access-control-allow-origin")).toBe(SITE);
  });
});
