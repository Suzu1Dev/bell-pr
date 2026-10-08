import assert from "node:assert/strict";
import test from "node:test";
import {
  applyReviewOrder,
  parseReviewOrder,
} from "../../shared/review-order";

test("the suggested review order is read from the lead report despite bullets, numbering and emphasis", () => {
  const report = [
    "Integrated three tasks.",
    "",
    "## Suggested review order:",
    "",
    "Definitions first, then callers, tests last so the behaviour is known before the spec.",
    "1. `src/types.ts` — the new option names every other file relies on.",
    "2) **src/utils/retry.ts**: implements the backoff.",
    "- src/client.ts – only GET requests opt in.",
    "* tests/retry.test.ts: read last to confirm the two cases.",
    "- src/types.ts — repeated path is ignored.",
    "README.md documents the option.",
    "",
    "## Limitations",
    "- docs/missing.md would be a path but is after the section.",
  ].join("\n");
  assert.deepEqual(parseReviewOrder(report), [
    {
      path: "src/types.ts",
      reason: "the new option names every other file relies on.",
    },
    { path: "src/utils/retry.ts", reason: "implements the backoff." },
    { path: "src/client.ts", reason: "only GET requests opt in." },
    {
      path: "tests/retry.test.ts",
      reason: "read last to confirm the two cases.",
    },
    { path: "README.md", reason: "documents the option." },
  ]);
  // Case and a plain title line without Markdown are accepted; no section means no order.
  assert.equal(
    parseReviewOrder("suggested review order\n- a/b.ts first")[0]?.path,
    "a/b.ts",
  );
  assert.deepEqual(parseReviewOrder("No order here.\n- a/b.ts"), []);
  assert.deepEqual(
    parseReviewOrder("Suggested review order:\nRead the tests first."),
    [],
  );
});

test("applying the order moves only files present in the diff and keeps the rest in git order", () => {
  const files = [
    { path: "README.md" },
    { path: "src/client.ts" },
    { path: "src/types.ts" },
    { path: "src/utils/retry.ts" },
    { path: "tests/retry.test.ts" },
  ];
  const order = parseReviewOrder(
    "Suggested review order:\n- src/types.ts\n- docs/nope.md\n- src/utils/retry.ts\n- src/client.ts",
  );
  assert.deepEqual(
    applyReviewOrder(files, order).map((file) => file.path),
    [
      "src/types.ts",
      "src/utils/retry.ts",
      "src/client.ts",
      "README.md",
      "tests/retry.test.ts",
    ],
  );
  assert.deepEqual(applyReviewOrder(files, []), files);
});
