import assert from "node:assert/strict";
import test from "node:test";
import {
  expandDiff,
  revealLines,
  languageBadge,
  languageBadges,
  parseDiff,
  selectionQuestion,
  splitDiff,
} from "./diff";
import { demoFiles } from "../demo";

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
  const question = selectionQuestion("src/example.ts", lines);
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

const oldFile = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`);
const newFile = oldFile.flatMap((line) =>
  line === "line 5" ? ["five"] : line === "line 20" ? [line, "inserted"] : [line],
);
// `git diff --no-index -U3` of the two files above.
const twoHunks = [
  "diff --git a/old.txt b/new.txt",
  "--- a/old.txt",
  "+++ b/new.txt",
  "@@ -2,7 +2,7 @@ line 1",
  " line 2",
  " line 3",
  " line 4",
  "-line 5",
  "+five",
  " line 6",
  " line 7",
  " line 8",
  "@@ -18,6 +18,7 @@ line 17",
  " line 18",
  " line 19",
  " line 20",
  "+inserted",
  " line 21",
  " line 22",
  " line 23",
].join("\n");

test("gaps around hunks are counted from the headers, and the end of the file once it is read", () => {
  const parsed = parseDiff(twoHunks);
  const gaps = (base: string[] | null) =>
    expandDiff(parsed, base, {}, true)
      .filter((line) => line.kind === "gap")
      .map((line) => line.gap);
  assert.deepEqual(gaps(null), [
    { index: 0, hidden: 1, afterChange: false, beforeChange: true },
    { index: 1, hidden: 9, afterChange: true, beforeChange: true },
    { index: 2, hidden: null, afterChange: true, beforeChange: false },
  ]);
  assert.equal(gaps(oldFile)[2]!.hidden, 7);
  // A file that cannot be read (the demo, an added file) keeps its plain hunk rows.
  const plain = expandDiff(parsed, null, {}, false);
  assert.deepEqual(plain, parsed);
});

test("revealed lines carry the old and new numbers of the gap they fill", () => {
  const shown = expandDiff(
    parseDiff(twoHunks),
    oldFile,
    { 1: { below: 2, above: 3 }, 2: { below: 2, above: 0 } },
    true,
  );
  const expanded = shown.filter((line) => line.expanded);
  assert.deepEqual(
    expanded.map((line) => [line.text, line.oldLine, line.newLine]),
    [
      ["line 9", 9, 9],
      ["line 10", 10, 10],
      ["line 15", 15, 15],
      ["line 16", 16, 16],
      ["line 17", 17, 17],
      // After the inserted line, new numbers are one ahead.
      ["line 24", 24, 25],
      ["line 25", 25, 26],
    ],
  );
  const middle = shown.find((line) => line.gap?.index === 1)!;
  assert.equal(middle.gap!.hidden, 4);
  assert.match(middle.text, /^@@ -18,6 \+18,7 @@/);
  assert.deepEqual(
    shown.map((line) => line.id),
    shown.map((_, index) => index),
  );
});

test("the whole file rebuilds both versions with every line number in order", () => {
  const shown = expandDiff(parseDiff(twoHunks), oldFile, "all", true);
  assert.ok(shown.every((line) => line.kind !== "gap" && line.kind !== "hunk"));
  const before = shown.filter((line) => line.oldLine !== null);
  const after = shown.filter((line) => line.newLine !== null);
  assert.deepEqual(before.map((line) => line.text), oldFile);
  assert.deepEqual(after.map((line) => line.text), newFile);
  assert.deepEqual(before.map((line) => line.oldLine), oldFile.map((_, index) => index + 1));
  assert.deepEqual(after.map((line) => line.newLine), newFile.map((_, index) => index + 1));
  // Split view pairs revealed lines on both sides like any unchanged line.
  const rows = splitDiff(shown);
  assert.ok(rows.every((row) => !row.hunk));
  assert.equal(rows.find((row) => row.left?.text === "line 30")?.right?.newLine, 31);
});

test("revealing a range opens upward above a change and downward below it, no further", () => {
  const parsed = parseDiff(twoHunks);
  // A function from line 14 to 26 (new numbers) wraps the second hunk (new 18–24).
  const reveal = revealLines(parsed, oldFile, {}, 14, 26);
  assert.deepEqual(reveal, {
    1: { below: 0, above: 4 },
    2: { below: 2, above: 0 },
  });
  const shown = expandDiff(parsed, oldFile, reveal, true);
  const numbers = new Set(shown.map((line) => line.newLine));
  for (let line = 14; line <= 26; line++) assert.ok(numbers.has(line), `line ${line}`);
  assert.ok(!numbers.has(12));
  assert.ok(!numbers.has(27));
  // Lines already shown leave the reveal as it was.
  assert.deepEqual(revealLines(parsed, oldFile, reveal, 15, 16), reveal);
});
