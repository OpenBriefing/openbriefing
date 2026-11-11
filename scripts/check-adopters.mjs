// Reads adopters.yml and checks each publisher's `example` page with the built
// CLI. Prints a short Markdown report; exits 1 when any page is not usable.
// Usage: node scripts/check-adopters.mjs   (after `npm run build` in the package)
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "packages", "openbriefing", "dist", "cli.js");

/** The file is a fixed, simple shape, so it is read without a YAML library. */
export function readAdopters(text) {
  const out = { publishers: [], consumers: [] };
  let section;
  let entry;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+#.*$/u, "").trimEnd();
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const top = /^([a-z]+):\s*$/u.exec(line);
    if (top) {
      section = out[top[1]] ?? (out[top[1]] = []);
      entry = undefined;
      continue;
    }
    const field = /^\s+(-\s+)?([a-z_]+):\s*(.*)$/u.exec(line);
    if (!field || !section) continue;
    if (field[1]) section.push((entry = {}));
    if (entry) entry[field[2]] = field[3].replace(/^["']|["']$/gu, "");
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { publishers } = readAdopters(readFileSync(join(root, "adopters.yml"), "utf8"));
  let failed = 0;
  const lines = ["The weekly check of `adopters.yml` found a publisher whose example page is not usable.", ""];
  for (const p of publishers) {
    if (!p.example) {
      lines.push(`- **${p.name}**: no \`example\` page listed`);
      failed++;
      continue;
    }
    const r = spawnSync("node", [cli, "check", p.example], { encoding: "utf8" });
    const ok = r.status === 0;
    if (!ok) failed++;
    lines.push(`- **${p.name}** ${p.example}: ${ok ? "ok" : "not usable"}`);
    if (!ok) lines.push("", "```", (r.stdout + r.stderr).trim().slice(0, 3000), "```", "");
  }
  console.log(lines.join("\n"));
  process.exitCode = failed > 0 ? 1 : 0;
}
