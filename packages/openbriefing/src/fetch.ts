/**
 * The network code for `openbriefing check`. Kept apart from obs.ts so the
 * parser stays usable in a browser, with no platform API.
 *
 * Everything fetched is untrusted. The limits here bound time, size and
 * redirects; callers escape control characters before printing.
 */

export interface FetchLimits {
  /** Whole-request budget in milliseconds, redirects included. */
  timeoutMs: number;
  /** The body is cut off, and the fetch fails, past this many bytes. */
  maxBytes: number;
  maxRedirects: number;
  userAgent: string;
}

export const DEFAULT_LIMITS: Omit<FetchLimits, "userAgent"> = {
  timeoutMs: 10_000,
  maxBytes: 5 * 1024 * 1024,
  maxRedirects: 5,
};

export type FetchResult =
  | { ok: true; url: string; contentType: string; text: string }
  | { ok: false; url: string; error: string };

export function userAgent(version: string): string {
  return `openbriefing-check/${version} (+https://openbriefingstandard.org)`;
}

/** True for an absolute http or https URL. */
export function isHttpUrl(input: string): boolean {
  try {
    const u = new URL(input);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Fetches a page's text within the limits. Never throws. */
export async function fetchText(input: string, limits: FetchLimits): Promise<FetchResult> {
  if (!isHttpUrl(input)) return { ok: false, url: input, error: "only http and https addresses are fetched" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limits.timeoutMs);
  let url = input;
  try {
    for (let hop = 0; ; hop++) {
      const res = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": limits.userAgent, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5" },
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        await res.body?.cancel();
        if (!location) return { ok: false, url, error: `HTTP ${res.status} with no Location` };
        if (hop >= limits.maxRedirects) return { ok: false, url, error: `more than ${limits.maxRedirects} redirects` };
        const next = new URL(location, url).href;
        if (!isHttpUrl(next)) return { ok: false, url, error: "redirected to an address that is not http or https" };
        url = next;
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel();
        return { ok: false, url, error: `HTTP ${res.status}` };
      }
      const declared = Number(res.headers.get("content-length") ?? "");
      if (Number.isFinite(declared) && declared > limits.maxBytes) {
        await res.body?.cancel();
        return { ok: false, url, error: `larger than ${limits.maxBytes} bytes` };
      }
      const contentType = res.headers.get("content-type") ?? "";
      const text = await readCapped(res, limits.maxBytes);
      if (text === undefined) return { ok: false, url, error: `larger than ${limits.maxBytes} bytes` };
      return { ok: true, url, contentType, text };
    }
  } catch (err) {
    const aborted = controller.signal.aborted;
    return { ok: false, url, error: aborted ? `no answer within ${limits.timeoutMs / 1000} s` : err instanceof Error ? cause(err) : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

function cause(err: Error): string {
  const c = (err as { cause?: unknown }).cause;
  if (c instanceof Error && c.message) return c.message;
  return err.message;
}

async function readCapped(res: Response, maxBytes: number): Promise<string | undefined> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
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

/** Runs `fn` over `items`, at most `width` at a time, keeping the order of results. */
export async function mapLimit<T, R>(items: readonly T[], width: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker));
  return out;
}
