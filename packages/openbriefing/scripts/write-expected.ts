// Writes spec/fixtures/expected.json from the parser's output, for other
// implementations to compare against. The hand-written assertions in
// test/obs.test.ts are what make these results correct; this file records them.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURES, fixtureNames, readFixture } from "../test/helpers.js";

const expected: Record<string, unknown> = {};
for (const name of fixtureNames()) expected[name] = readFixture(name);
writeFileSync(join(FIXTURES, "expected.json"), JSON.stringify(expected, null, 2) + "\n");
console.log(`expected.json: ${Object.keys(expected).length} fixtures`);
