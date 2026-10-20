// The Learn-by-hand UI contract (DESIGN v1.2 §11.1): the one lazy chunk's
// entry re-exports every component. Every component is built now; their
// tests are in src/byhand/write/, src/byhand/record/ and
// src/byhand/ModeChoice.test.ts.
import assert from "node:assert/strict";
import test from "node:test";
import * as lazy from "./lazy";

test("the lazy chunk's entry has every Learn-by-hand component", () => {
  assert.deepEqual(Object.keys(lazy).sort(), [
    "ByHandRecord",
    "DraftHelpers",
    "GuidePanel",
    "PlanWithGuide",
    "ReadyDialog",
    "YourTurn",
  ]);
});
