import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { tsImport } from "tsx/esm/api";
import { packageRoot } from "./lib/media.mjs";

// The footage is gitignored: this runs after `npm run capture`.
const still = path.join(packageRoot, "public", "footage", "v-rules-card", "overview.png");

test("the film's box for the app's own bell is where the capture shows it (measured by its moments)", { skip: !existsSync(still) && "no footage" }, async () => {
  const { measureBell } = await import("./measure-bell.mjs");
  const { FOOTAGE_BELL } = await tsImport("../src/bell.ts", import.meta.url);
  const measured = await measureBell();
  // Within 0.1 capture px (0.09 screen px at the landing) and 0.5% in size.
  assert.ok(Math.abs(measured.x - FOOTAGE_BELL.x) <= 0.1, `x ${measured.x.toFixed(3)} against ${FOOTAGE_BELL.x}`);
  assert.ok(Math.abs(measured.y - FOOTAGE_BELL.y) <= 0.1, `y ${measured.y.toFixed(3)} against ${FOOTAGE_BELL.y}`);
  assert.ok(Math.abs(measured.size / FOOTAGE_BELL.size - 1) <= 0.005, `size ${measured.size.toFixed(3)} against ${FOOTAGE_BELL.size}`);
});
