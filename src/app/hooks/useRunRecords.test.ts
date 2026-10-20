import assert from "node:assert/strict";
import test from "node:test";
import { feedbackTagPatch, withFeedbackTag } from "./useRunRecords";

const url = "https://github.com/o/r/pull/1#discussion_r1";
const other = "https://github.com/o/r/pull/1#discussion_r2";
const at = "2026-10-15T00:00:00.000Z";

test("un-pressing a chip sends null, which the merge-style route reads as unset", () => {
  // JSON drops undefined keys, and the route keeps a field it is not sent.
  const body = JSON.parse(JSON.stringify(feedbackTagPatch(url, { predicted: true })));
  assert.deepEqual(body, { url, dimension: null, predicted: true, lesson: null });
  // Un-pressing the last chip clears the whole tag instead of a 400.
  assert.deepEqual(JSON.parse(JSON.stringify(feedbackTagPatch(url, {}))), {
    url,
    dimension: null,
    predicted: null,
    lesson: null,
  });
  assert.deepEqual(feedbackTagPatch(url, { predicted: false, lesson: "  Ask first.  " }), {
    url,
    dimension: null,
    predicted: false,
    lesson: "Ask first.",
  });
  assert.equal(feedbackTagPatch(url, { predicted: false, lesson: "   " }).lesson, null);
});

test("the sample drops a tag once nothing is left on it, as the server does", () => {
  const tags = {
    [url]: { dimension: "scope" as const, predicted: false, lesson: "Ask first.", at },
    [other]: { predicted: true, at },
  };
  assert.deepEqual(withFeedbackTag(tags, url, { predicted: false, lesson: "Ask first." }, at), {
    [url]: { predicted: false, lesson: "Ask first.", at },
    [other]: { predicted: true, at },
  });
  assert.deepEqual(withFeedbackTag(tags, url, {}, at), { [other]: { predicted: true, at } });
  assert.deepEqual(withFeedbackTag(undefined, url, { dimension: "tests" }, at), {
    [url]: { dimension: "tests", at },
  });
});
