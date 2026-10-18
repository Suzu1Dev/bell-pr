import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { packageRoot } from "./lib/media.mjs";

// The footage is gitignored: this runs after `npm run capture` and `npm run assets` (the 2x proxies).
const footage = existsSync(path.join(packageRoot, "public", "footage-2x"));

test("no lifted component is cropped through a glyph and no lifted line is cut by an edge (against the footage)", { skip: !footage && "no footage" }, async () => {
  const { checkDof } = await import("./check-dof.mjs");
  assert.deepEqual(await checkDof(), []);
});
