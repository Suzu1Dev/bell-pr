import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.join(import.meta.dirname, "..");
const names: Record<string, string> = {
  chrome: "Chrome",
  edge: "Edge",
  firefox: "Firefox",
  safari: "Safari",
};

test("docs/development.md names each browser version in vite.config.ts build.target", () => {
  const config = readFileSync(path.join(root, "vite.config.ts"), "utf8");
  const listed = config.match(/target:\s*\[([^\]]*)\]/);
  assert.ok(listed, "build.target array in vite.config.ts");
  const entries = [...listed[1].matchAll(/"([a-z]+)(\d+(?:\.\d+)?)"/g)];
  assert.ok(entries.length > 0, "build.target entries");
  const docs = readFileSync(path.join(root, "docs/development.md"), "utf8");
  const missing: string[] = [];
  for (const [, id, version] of entries) {
    const name = names[id];
    assert.ok(name, id);
    const exact = version.includes(".")
      ? `${version.replaceAll(".", "\\.")}(?!\\d)`
      : `${version}(?![\\d.])`;
    const mentioned = new RegExp(
      `\\b${name}\\b[^\\n]{0,60}${exact}|${exact}[^\\n]{0,60}\\b${name}\\b`,
    ).test(docs);
    if (!mentioned) missing.push(`${name} ${version}`);
  }
  assert.deepEqual(missing, []);
});
