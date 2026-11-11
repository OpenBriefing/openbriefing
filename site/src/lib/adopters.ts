import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { ROOT } from "./spec";

export interface Adopter {
  name: string;
  url: string;
  example?: string;
  since?: string;
  note?: string;
}

export function readAdopters(): { publishers: Adopter[]; consumers: Adopter[] } {
  const data = parse(readFileSync(join(ROOT, "adopters.yml"), "utf8")) as { publishers?: Adopter[]; consumers?: Adopter[] } | null;
  const clean = (list: Adopter[] | undefined) => (list ?? []).filter((a) => a && typeof a.name === "string" && /^https?:\/\//u.test(String(a.url)));
  return { publishers: clean(data?.publishers), consumers: clean(data?.consumers) };
}

export const host = (url: string): string => new URL(url).host.replace(/^www\./u, "");
