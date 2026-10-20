import assert from "node:assert/strict";
import test from "node:test";
import { asksOnItsOwn } from "./useExplanations";

test("a stopped agent run asks for its explanations and walkthroughs on its own, as before", () => {
  assert.equal(asksOnItsOwn({}, false, false), true);
  // The sample's are prewritten, and a running run's diff still moves.
  assert.equal(asksOnItsOwn({}, true, false), false);
  assert.equal(asksOnItsOwn({}, false, true), false);
});

test("a Learn-by-hand run never asks on its own, on load or on a refresh", () => {
  // Before Ready the server refuses; after it, each file is asked for on a click.
  assert.equal(asksOnItsOwn({ learnByHand: true }, false, false), false);
  assert.equal(asksOnItsOwn({ learnByHand: true }, false, true), false);
});
