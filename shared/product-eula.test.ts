import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { eulaVersion } from "./product.js";

test("LICENSE.md states the EULA version that the app asks users to accept", () => {
  const license = readFileSync(new URL("../LICENSE.md", import.meta.url), "utf8");
  const versionLines = license
    .split(/\r?\n/)
    .filter((line) => line.trimStart().startsWith("EULA version:"));
  // Bump shared/product.ts eulaVersion and this line together.
  assert.deepEqual(versionLines, [`EULA version: ${eulaVersion}`]);
});
