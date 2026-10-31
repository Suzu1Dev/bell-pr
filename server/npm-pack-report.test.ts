import test from "node:test";
import assert from "node:assert/strict";
// Load the standalone Node script without a TypeScript declaration.
const { parsePackReport } = await import(new URL("../scripts/npm-pack-report.mjs", import.meta.url).href);

test("finds the pack report among bracketed build output", () => {
  const entry = { files: [{ path: "build/index.js" }], filename: "package.tgz" };
  const report = JSON.stringify([entry], null, 2);
  for (const stdout of [
    report,
    `[INEFFECTIVE_DYNAMIC_IMPORT] warning\n[]\n${report}\n[postpack] done\n]\n`,
    `> prepack\n[not JSON\n]\n${report}\n> postpack\n`,
    JSON.stringify([entry]),
  ]) assert.deepEqual(parsePackReport(stdout), entry);
  assert.throws(() => parsePackReport('[{"filename":"no-files.tgz"}]\n[warning]'), /could not read/);
});
