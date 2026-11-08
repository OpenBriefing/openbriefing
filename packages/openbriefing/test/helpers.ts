import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { parseFeedObs, parseObs, type ParseResult } from "../src/obs.js";

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "spec", "fixtures");

export function fixtureNames(): string[] {
  return readdirSync(FIXTURES).filter((f) => f.endsWith(".html") || f.endsWith(".xml")).sort();
}

export function pageUrlFor(name: string): string {
  return `https://example.test/${name.replace(/\.html$/u, "")}/`;
}

export function parsePage(html: string, url: string): ParseResult {
  const dom = new JSDOM(html, { url });
  return parseObs(dom.window.document, url);
}

export function parseFeed(xml: string): ParseResult[] {
  const dom = new JSDOM(xml, { contentType: "text/xml" });
  const doc = dom.window.document;
  const items = [...Array.from(doc.getElementsByTagName("item")), ...Array.from(doc.getElementsByTagName("entry"))];
  return items.map((item) => parseFeedObs(item));
}

/** Every fixture's result, keyed by file name. A feed gives one result per item. */
export function readFixture(name: string): ParseResult | ParseResult[] {
  const text = readFileSync(join(FIXTURES, name), "utf8");
  return name.endsWith(".xml") ? parseFeed(text) : parsePage(text, pageUrlFor(name));
}
