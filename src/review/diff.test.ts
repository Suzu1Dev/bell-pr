import assert from "node:assert/strict";
import test from "node:test";
import {
  languageBadge,
  languageBadges,
  parseDiff,
  selectionQuestion,
  splitDiff,
} from "./diff";
import { getDemo } from "../demo";
import en from "../i18n/en";
import zhTW from "../i18n/zh-TW";
import { assertNoHan } from "../test-utils/render";

// These tests pin zh-TW, the language their assertions were written in.
const demoFiles = getDemo("zh-TW").files;

test("unified diff preserves independent old and new line offsets across hunks", () => {
  const lines = parseDiff(
    "diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -10,3 +20,4 @@ function example()\n same\n-before\n+after\n+extra\n end\n@@ -80 +91 @@\n-old\n+new\n",
  );
  assert.deepEqual(
    lines
      .filter((line) => line.kind !== "hunk")
      .map(({ kind, oldLine, newLine }) => [kind, oldLine, newLine]),
    [
      ["context", 10, 20],
      ["removed", 11, null],
      ["added", null, 21],
      ["added", null, 22],
      ["context", 12, 23],
      ["removed", 80, null],
      ["added", null, 91],
    ],
  );
});

test("addition content resembling a file header is not discarded", () => {
  const lines = parseDiff(
    '@@ -0,0 +1,2 @@\n+++ value\n+<script>alert("example")</script>\n\\ No newline at end of file\n',
  );
  assert.equal(lines[1].text, "++ value");
  assert.equal(lines[2].text, '<script>alert("example")</script>');
  assert.equal(lines[2].newLine, 2);
  assert.equal(lines[3].kind, "note");
});

test("split view aligns replacements and preserves unmatched additions", () => {
  const rows = splitDiff(
    parseDiff("@@ -4,2 +4,3 @@\n-before\n+after\n+extra\n same\n"),
  );
  assert.equal(rows[1].left?.text, "before");
  assert.equal(rows[1].right?.text, "after");
  assert.equal(rows[2].left, undefined);
  assert.equal(rows[2].right?.text, "extra");
  assert.equal(rows[3].left?.oldLine, 5);
  assert.equal(rows[3].right?.newLine, 6);
});

test("non-text diffs do not create selectable code lines", () => {
  assert.deepEqual(
    parseDiff("diff --git a/image.png b/image.png\nBinary files differ\n"),
    [],
  );
});

test("selection questions preserve old/new references and fit the chat API limit", () => {
  const lines = parseDiff(
    `@@ -8,2 +12,2 @@\n context\n-old\n+${"a".repeat(9000)}\n`,
  ).filter((line) => line.kind !== "hunk");
  const question = selectionQuestion(
    "src/example.ts",
    lines,
    zhTW.review.selection,
  );
  assert.ok(question.length <= 8000);
  assert.match(question, /內容已節錄/);
  assert.match(question, /原有 舊 L8／新 L12: context/);
  assert.match(question, /刪除 舊 L9: old/);
  assert.match(question, /新增 新 L13: a/);
});

test("demo diff counts match their displayed patches and hunk line counts", () => {
  for (const file of demoFiles) {
    const lines = parseDiff(file.patch);
    assert.equal(
      lines.filter((line) => line.kind === "added").length,
      file.additions,
      file.path,
    );
    assert.equal(
      lines.filter((line) => line.kind === "removed").length,
      file.deletions,
      file.path,
    );
    const header = /@@ -\d+,(\d+) \+\d+,(\d+) @@/.exec(file.patch)!;
    assert.equal(
      lines.filter((line) => line.oldLine !== null).length,
      Number(header[1]),
      file.path,
    );
    assert.equal(
      lines.filter((line) => line.newLine !== null).length,
      Number(header[2]),
      file.path,
    );
  }
});

test("language badges stay within three characters and keep JSON apart from JavaScript", () => {
  for (const badge of Object.values(languageBadges))
    assert.ok(badge.length <= 3, badge);
  assert.equal(languageBadge("TypeScript"), "TS");
  assert.equal(languageBadge("Markdown"), "MD");
  assert.notEqual(languageBadge("JSON"), languageBadge("JavaScript"));
  assert.equal(languageBadge("Text"), "TXT");
  // server/git.ts returns the raw extension for languages it does not name.
  assert.equal(languageBadge("toml"), "TO");
  assert.equal(languageBadge(""), "");
});

test("selection questions are written in the UI language", () => {
  const lines = parseDiff(
    `@@ -8,2 +12,2 @@\n context\n-old\n+${"a".repeat(9000)}\n`,
  ).filter((line) => line.kind !== "hunk");
  const question = selectionQuestion("src/example.ts", lines, en.review.selection);
  assertNoHan(question);
  assert.ok(question.length <= 8000);
  assert.match(
    question,
    /^Explain the 3 selected lines of code in src\/example\.ts in plain language/,
  );
  assert.match(question, /\[Excerpt\]/);
  assert.match(question, /Unchanged, old L8 \/ new L12: context/);
  assert.match(question, /Removed, old L9: old/);
  assert.match(question, /Added, new L13: a/);
  const single = selectionQuestion(
    "src/example.ts",
    lines.slice(0, 1),
    en.review.selection,
  );
  assert.match(single, /^Explain the selected line of code in src\/example\.ts/);
  assert.doesNotMatch(single, /\[Excerpt\]/);
});
