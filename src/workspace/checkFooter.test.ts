import assert from "node:assert/strict";
import test from "node:test";
import { checkFooter } from "./checkFooter";

const review = { status: "review" as const };
const required = { required: true, passed: false };

test("once every file is ticked, a required check that has not passed comes first", () => {
  assert.deepEqual(checkFooter(review, true, required), {
    explainFirst: true,
    status: "allReviewed",
    needsReview: "needsReviewAndCheck",
  });
  // Before the ticks are done, the tooltip names both remaining steps.
  assert.deepEqual(checkFooter(review, false, required), {
    explainFirst: false,
    status: "learning",
    needsReview: "needsReviewAndCheck",
  });
  // An approved run that the setting holds to the check again.
  assert.equal(checkFooter({ status: "approved" }, true, required).explainFirst, true);
});

test("a passed or switched-off check leaves approval as it was", () => {
  assert.deepEqual(checkFooter(review, true, { required: true, passed: true }), {
    explainFirst: false,
    status: "passed",
    needsReview: "needsReview",
  });
  assert.deepEqual(checkFooter(review, true, { required: false, passed: false }), {
    explainFirst: false,
    status: "checkOff",
    needsReview: "needsReview",
  });
});

test("runs that take no check now never ask for one", () => {
  for (const run of [
    { status: "running" as const },
    { status: "approved" as const, publishing: true },
    { status: "published" as const },
  ]) {
    const footer = checkFooter(run, true, required);
    assert.equal(footer.explainFirst, false, run.status);
    assert.equal(footer.needsReview, "needsReview", run.status);
  }
  assert.equal(checkFooter({ status: "published" }, true, required).status, "allReviewed");
});
