// The example pages live at the repository root (scripts/make-examples.mjs
// writes them). The site serves them at /examples/, where they have always been.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, "..", "..", "examples");
const to = join(here, "..", "public", "examples");
rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
console.log(`examples copied to ${to}`);
