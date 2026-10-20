import assert from "node:assert/strict";
import test from "node:test";
import type { ContributionRecommendation } from "../shared/insights.js";
import {
  moveRecommendation,
  orderedRecommendations,
} from "../src/mission/recommendation-preferences.js";

test("saved order skips removed IDs and appends new suggestions in source order", () => {
  const ideas = ["a", "b", "c", "new"].map((id) => ({ id }) as ContributionRecommendation);
  assert.deepEqual(
    orderedRecommendations(ideas, { order: ["c", "old", "a", "c"], hidden: ["b"] }).map((idea) => idea.id),
    ["c", "a", "b", "new"],
  );
});

test("visible moves support both directions while hidden cards retain their slots", () => {
  const original = ["a", "hidden", "b", "c"];
  assert.deepEqual(moveRecommendation(original, ["hidden"], "c", "a", "before"), ["c", "hidden", "a", "b"]);
  assert.deepEqual(moveRecommendation(original, ["hidden"], "a", "c", "after"), ["b", "hidden", "c", "a"]);
  assert.deepEqual(moveRecommendation(original, ["hidden"], "a", "b", "before"), original);
  assert.deepEqual(moveRecommendation(original, ["hidden"], "hidden", "a", "before"), original);
  assert.deepEqual(moveRecommendation(original, ["hidden"], "a", "missing", "after"), original);
  assert.deepEqual(original, ["a", "hidden", "b", "c"]);
});
