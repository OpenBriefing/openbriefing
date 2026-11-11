/**
 * Which addresses the checker will fetch. Pure, with no platform API beyond
 * URL, so the Worker and the site's own form share one rule.
 */

export type Guard = { ok: true; url: URL } | { ok: false; reason: string };

const PRIVATE_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".corp", ".intranet", ".test", ".invalid", ".example", ".onion"];

/** Accepts an http or https address with a public host name. */
export function guardUrl(input: string): Guard {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { ok: false, reason: "That is not a web address. Start it with https://" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "Only http and https addresses can be checked." };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, reason: "Addresses with a user name or password are not fetched." };
  }
  if (url.port !== "" && url.port !== "80" && url.port !== "443") {
    return { ok: false, reason: "Only the standard web ports are fetched." };
  }
  // URL has already folded odd IPv4 spellings (0x7f.1, 2130706433) into dotted form.
  const host = url.hostname.toLowerCase().replace(/\.$/u, "");
  if (host.startsWith("[") || host.includes(":")) {
    return { ok: false, reason: "Numeric addresses are not fetched. Use the site's name." };
  }
  if (/^[0-9.]+$/u.test(host)) {
    return { ok: false, reason: "Numeric addresses are not fetched. Use the site's name." };
  }
  if (host === "localhost" || !host.includes(".")) {
    return { ok: false, reason: "That host is not on the public web. To check a local page, paste its source." };
  }
  if (PRIVATE_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, reason: "That host is not on the public web. To check a local page, paste its source." };
  }
  const tld = host.slice(host.lastIndexOf(".") + 1);
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/u.test(tld)) {
    return { ok: false, reason: "That host is not on the public web. To check a local page, paste its source." };
  }
  return { ok: true, url };
}

const TYPES = ["text/html", "application/xhtml+xml", "application/xml", "text/xml", "application/rss+xml", "application/atom+xml"];

/** Pages and feeds only. */
export function allowedType(contentType: string): boolean {
  const type = contentType.split(";")[0]!.trim().toLowerCase();
  return TYPES.includes(type);
}
