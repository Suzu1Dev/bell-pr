import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { packageRoot } from "./lib/media.mjs";

// The footage is gitignored: this runs after `npm run capture` and `npm run assets` (the 2x proxies).
const footage = existsSync(path.join(packageRoot, "public", "footage-2x"));

test("every click the film shows is inside its recorded target, and that target is where the footage shows the control", { skip: !footage && "no footage" }, async () => {
  const { checkClickTargets } = await import("./pointer-spots.mjs");
  assert.deepEqual(await checkClickTargets(), []);
});
