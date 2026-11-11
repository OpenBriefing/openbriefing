/**
 * GET /?url=<address> returns { ok, url, contentType, text } for a public page
 * or feed, to the Open Briefing Standard site only.
 *
 * Limits: http and https, public host names, at most 3 redirects (each one
 * checked again), 2 MB, 8 seconds, HTML and XML types. Nothing is stored and
 * no address is logged.
 */
import { allowedType, guardUrl } from "./guard.js";

export interface Env {
  ALLOWED_ORIGINS: string;
  USER_AGENT: string;
  LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

export const MAX_BYTES = 2 * 1024 * 1024;
export const TIMEOUT_MS = 8000;
export const MAX_REDIRECTS = 3;

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

function reply(status: number, body: Record<string, unknown>, origin: string | undefined): Response {
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    vary: "Origin",
  };
  if (origin !== undefined) headers["access-control-allow-origin"] = origin;
  return new Response(JSON.stringify(body), { status, headers });
}

const fail = (status: number, error: string, origin: string | undefined) => reply(status, { ok: false, error }, origin);

async function readCapped(res: Response): Promise<string | undefined> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder("utf-8").decode(all);
}

export async function handle(request: Request, env: Env, fetcher: Fetcher = (input, init) => fetch(input, init)): Promise<Response> {
  const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  const requestOrigin = request.headers.get("origin") ?? undefined;
  const origin = requestOrigin !== undefined && allowed.includes(requestOrigin) ? requestOrigin : undefined;

  if (request.method === "OPTIONS") {
    if (origin === undefined) return new Response(null, { status: 403 });
    return new Response(null, {
      status: 204,
      headers: { "access-control-allow-origin": origin, "access-control-allow-methods": "GET", "access-control-max-age": "86400", vary: "Origin" },
    });
  }
  if (request.method !== "GET") return fail(405, "Only GET is answered.", origin);
  // The helper serves the site's checker, not the web at large.
  if (origin === undefined) return fail(403, "This helper answers the Open Briefing Standard site only. To check a page, use https://openbriefingstandard.org/check or `npx openbriefing check <address>`.", undefined);

  const target = new URL(request.url).searchParams.get("url");
  if (target === null || target.trim() === "") return fail(400, "Give the page's address as ?url=", origin);

  if (env.LIMITER) {
    const key = request.headers.get("cf-connecting-ip") ?? "unknown";
    const { success } = await env.LIMITER.limit({ key });
    if (!success) return fail(429, "Too many checks from your address in the last minute. Wait a minute, or paste the page's source.", origin);
  }

  let guard = guardUrl(target);
  if (!guard.ok) return fail(400, guard.reason, origin);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let url = guard.url.href;
    for (let hop = 0; ; hop++) {
      const res = await fetcher(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": env.USER_AGENT, accept: "text/html,application/xhtml+xml,application/xml;q=0.9" },
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        await res.body?.cancel();
        if (!location) return fail(502, `The page answered ${res.status} with nowhere to go.`, origin);
        if (hop >= MAX_REDIRECTS) return fail(502, `The page redirected more than ${MAX_REDIRECTS} times.`, origin);
        guard = guardUrl(new URL(location, url).href);
        if (!guard.ok) return fail(400, `The page redirects somewhere that is not fetched. ${guard.reason}`, origin);
        url = guard.url.href;
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel();
        return fail(502, `The page answered ${res.status}.`, origin);
      }
      const contentType = res.headers.get("content-type") ?? "";
      if (!allowedType(contentType)) {
        await res.body?.cancel();
        return fail(415, "That address is not a web page or a feed.", origin);
      }
      const declared = Number(res.headers.get("content-length") ?? "");
      if (Number.isFinite(declared) && declared > MAX_BYTES) {
        await res.body?.cancel();
        return fail(413, "The page is larger than 2 MB.", origin);
      }
      const text = await readCapped(res);
      if (text === undefined) return fail(413, "The page is larger than 2 MB.", origin);
      return reply(200, { ok: true, url, contentType, text }, origin);
    }
  } catch {
    return fail(504, controller.signal.aborted ? "The page did not answer within 8 seconds." : "The page could not be reached.", origin);
  } finally {
    clearTimeout(timer);
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env);
  },
};
