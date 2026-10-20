// The Explain-it-back question of a Learn-by-hand run is shown as plain
// text (the check renders no Markdown), so it names the file without code
// marks: no raw backticks around the path, in either language.
import assert from "node:assert/strict";
import test from "node:test";
import { sm, withLocale } from "./i18n/index.js";

test("a Learn-by-hand check question names the file as plain text, without backticks, in both languages", () => {
  for (const locale of ["en", "zh-TW"] as const) {
    const question = withLocale(locale, () => sm().understanding.byHandQuestion({ path: "src/retry.ts" }));
    assert.match(question, /src\/retry\.ts/);
    assert.doesNotMatch(question, /`/, `${locale}: ${question}`);
  }
  assert.equal(
    withLocale("en", () => sm().understanding.byHandQuestion({ path: "src/retry.ts" })),
    "You wrote the change to src/retry.ts. Why this way rather than another, and what would break if it were wrong?",
  );
});
