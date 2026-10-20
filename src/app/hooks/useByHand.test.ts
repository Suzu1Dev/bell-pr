import assert from "node:assert/strict";
import test from "node:test";
import { selectionQuestion, parseDiff } from "../../review/diff";
import en from "../../i18n/en/review";
import type { DiffFile } from "../../types";
import { selectionOf } from "./useByHand";

const file: DiffFile = {
  path: "src/retry.ts",
  language: "TypeScript",
  additions: 2,
  deletions: 1,
  status: "modified",
  patch: "@@ -10,4 +10,5 @@\n const max = 3;\n-let tries = 0;\n+let tries = 1;\n+let delay = 100;\n function retry() {\n   return tries;",
};

test("a diff selection's question gives the guide its lines as path:start-end", () => {
  const lines = parseDiff(file.patch);
  const ask = (from: number, to: number) => selectionQuestion(file.path, lines.slice(from, to), en.selection);
  // The two added lines: new lines 11-12.
  assert.deepEqual(selectionOf(file, ask(3, 5)), { path: "src/retry.ts", startLine: 11, endLine: 12 });
  // Context and an added line: the new file's numbers.
  assert.deepEqual(selectionOf(file, ask(1, 4)), { path: "src/retry.ts", startLine: 10, endLine: 11 });
  // A removed line only: the old file's number.
  assert.deepEqual(selectionOf(file, ask(2, 3)), { path: "src/retry.ts", startLine: 11, endLine: 11 });
  // Lines the patch doesn't hold (read from the base) give the path alone.
  assert.deepEqual(selectionOf(file, "Explain this:\n\n```diff\n+not in the patch\n```"), { path: "src/retry.ts", startLine: 0, endLine: 0 });
});
