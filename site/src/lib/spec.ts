// Reads spec/v1.md at build time: the rendered spec, its sections and its tag table.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { marked, type Tokens } from "marked";

const REPO = "https://github.com/OpenBriefing/openbriefing";

function findRoot(): string {
  // Works from src/lib during dev and from the build output, wherever that lands.
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    try {
      readFileSync(join(dir, "spec", "v1.md"));
      return dir;
    } catch {
      dir = dirname(dir);
    }
  }
  return join(process.cwd(), "..");
}

export const ROOT = findRoot();
export const specSource = (): string => readFileSync(join(ROOT, "spec", "v1.md"), "utf8");

/** GitHub's heading slug, so the spec's own #links keep working. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/gu, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/gu, "-");
}

export interface Section {
  id: string;
  title: string;
  depth: number;
}

export interface TagRow {
  name: string;
  required: string;
  meaning: string;
}

const inline = (s: string): string => marked.parseInline(s, { async: false }) as string;

/** The table in §3, one row per tag. */
export function tagRows(source = specSource()): TagRow[] {
  const rows: TagRow[] = [];
  for (const line of source.split("\n")) {
    const m = /^\| `(obs:[a-z:]+)` \| ([^|]+) \| (.+) \|\s*$/u.exec(line);
    if (m && rows.every((r) => r.name !== m[1])) rows.push({ name: m[1]!, required: inline(m[2]!.trim()), meaning: inline(m[3]!.trim()) });
    if (line.startsWith("### 3.1")) break;
  }
  return rows;
}

export function statusLine(source = specSource()): string {
  const m = /^\*\*Status:\*\*\s*(.+)$/mu.exec(source);
  return m ? m[1]!.replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1") : "";
}

export interface RenderedSpec {
  title: string;
  /** The lines between the title and the first rule: status, namespace, licence. */
  front: string;
  body: string;
  appendix: string;
  sections: Section[];
}

export function renderSpec(source = specSource()): RenderedSpec {
  const sections: Section[] = [];
  const renderer = new marked.Renderer();
  renderer.heading = function ({ tokens, depth }: Tokens.Heading): string {
    const html = this.parser.parseInline(tokens);
    const id = slug(html);
    if (depth === 2 || depth === 3) sections.push({ id, title: html.replace(/<[^>]+>/gu, ""), depth });
    return `<h${depth} id="${id}"><a class="anchor" href="#${id}">${html}</a></h${depth}>\n`;
  };
  renderer.link = function ({ href, title, tokens }: Tokens.Link): string {
    const text = this.parser.parseInline(tokens);
    let to = href;
    if (to.startsWith("../")) to = `${REPO}/blob/main/${to.slice(3)}`;
    const t = title ? ` title="${title}"` : "";
    return `<a href="${to}"${t}>${text}</a>`;
  };
  renderer.table = function (token: Tokens.Table): string {
    const head = token.header.map((c) => `<th>${this.parser.parseInline(c.tokens)}</th>`).join("");
    const rows = token.rows.map((r) => `<tr>${r.map((c) => `<td>${this.parser.parseInline(c.tokens)}</td>`).join("")}</tr>`).join("\n");
    return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>\n${rows}\n</tbody></table></div>\n`;
  };

  const titleMatch = /^# (.+)$/mu.exec(source);
  const title = titleMatch ? titleMatch[1]! : "Open Briefing Standard";
  const afterTitle = source.slice(source.indexOf("\n", source.indexOf("# ")) + 1);
  const firstRule = afterTitle.indexOf("\n---\n");
  const front = afterTitle.slice(0, firstRule);
  const rest = afterTitle.slice(firstRule + 5);
  const appendixAt = rest.indexOf("\n---\n");
  const main = appendixAt === -1 ? rest : rest.slice(0, appendixAt);
  const appendix = appendixAt === -1 ? "" : rest.slice(appendixAt + 5);
  const render = (md: string): string => marked.parse(md, { renderer, async: false, gfm: true }) as string;
  return { title, front: render(front), body: render(main), appendix: render(appendix), sections };
}
