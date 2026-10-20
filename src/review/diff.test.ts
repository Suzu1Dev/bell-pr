import assert from "node:assert/strict";
import test from "node:test";
import {
  expandDiff,
  revealLines,
  groupHunks,
  hunkStart,
  isCodeLine,
  languageBadge,
  languageBadges,
  markdownCode,
  parseDiff,
  selectionQuestion,
  splitDiff,
} from "./diff";
import { demoAnswer, getDemo } from "../demo";
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

/** The fenced block of a question: its fence, info string and code lines. */
function fencedBlock(question: string) {
  const match = /\n(`{3,})diff\n([^]*)\n\1$/.exec(question);
  assert.ok(match, question);
  return { fence: match[1], lines: match[2].split("\n") };
}

test("selection questions send the lines as a diff block with old/new references, within the chat API limit", () => {
  const lines = parseDiff(
    `@@ -8,2 +12,2 @@\n context\n-old\n+${"a".repeat(9000)}\n`,
  ).filter((line) => line.kind !== "hunk");
  const question = selectionQuestion(
    "src/example.ts",
    lines,
    zhTW.review.selection,
  );
  assert.ok(question.length <= 8000, String(question.length));
  // The request, the excerpt note, the file and line numbers, then the code.
  assert.ok(
    question.startsWith(
      "請用白話解釋 `src/example.ts` 中選取的 3 行程式碼，說明它們的用途、變更原因與需要注意的地方。\n\n[內容已節錄]",
    ),
    question.slice(0, 200),
  );
  assert.ok(question.includes("\n\n`src/example.ts`，舊版第 8–9 行，新版第 12–13 行：\n\n```diff\n"));
  // Cut inside the block, which still closes.
  const block = fencedBlock(question);
  assert.equal(block.fence, "```");
  assert.deepEqual(block.lines.slice(0, 2), [" context", "-old"]);
  assert.match(block.lines[2], /^\+a{1000,}$/);
  assert.ok(block.lines[2].length < 9001);
});

test("a selection question keeps each line's indentation and prefix, and a fence the code cannot close", () => {
  const lines = parseDiff(
    "@@ -10,3 +10,4 @@\n   if (retry) {\n-\t\treturn delay;\n+\t\treturn delay * 2;\n+    // ```js\n }\r\n",
  ).filter((line) => line.kind !== "hunk");
  const question = selectionQuestion("src/utils/retry.ts", lines, en.review.selection);
  assertNoHan(question);
  assert.equal(
    question,
    [
      "Explain the 5 selected lines of code in `src/utils/retry.ts` in plain language: what they do, why they changed and what to watch out for.",
      "",
      "`src/utils/retry.ts`, old lines 10–12, new lines 10–13:",
      "",
      "````diff",
      "   if (retry) {",
      "-\t\treturn delay;",
      "+\t\treturn delay * 2;",
      "+    // ```js",
      " }",
      "````",
    ].join("\n"),
  );
  // Only added lines, or only removed lines, name one version; one line says "line".
  const added = parseDiff("@@ -3,0 +4,2 @@\n+one\n+two\n").filter((line) => line.kind !== "hunk");
  assert.match(selectionQuestion("a.ts", added, en.review.selection), /\n\n`a\.ts`, new lines 4–5:\n\n/);
  const removed = parseDiff("@@ -7 +6,0 @@\n-gone\n").filter((line) => line.kind !== "hunk");
  assert.match(selectionQuestion("a.ts", removed, en.review.selection), /\n\n`a\.ts`, old line 7:\n\n```diff\n-gone\n```$/);
  assert.match(selectionQuestion("a.ts", removed, zhTW.review.selection), /`a\.ts`，舊版第 7 行：/);
});

test("a path is Markdown code, so underscores and backticks in it stay literal", () => {
  assert.equal(markdownCode("pkg/__init__.py"), "`pkg/__init__.py`");
  assert.equal(markdownCode("odd`name.ts"), "``odd`name.ts``");
  assert.equal(markdownCode("`edge"), "`` `edge ``");
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
    /^Explain the 3 selected lines of code in `src\/example\.ts` in plain language/,
  );
  assert.match(question, /\n\n\[Excerpt\]/);
  assert.match(question, /\n\n`src\/example\.ts`, old lines 8–9, new lines 12–13:\n\n```diff\n context\n-old\n\+a+\n```$/);
  const single = selectionQuestion(
    "src/example.ts",
    lines.slice(0, 1),
    en.review.selection,
  );
  assert.equal(
    single,
    "Explain the selected line of code in `src/example.ts` in plain language: what it does, why it changed and what to watch out for.\n\n`src/example.ts`, old line 8, new line 12:\n\n```diff\n context\n```",
  );
});

test("the sample's canned answers match a selection question as they matched its request and code", () => {
  for (const locale of ["en", "zh-TW"] as const) {
    const messages = (locale === "en" ? en : zhTW).review.selection;
    for (const file of getDemo(locale).files) {
      const code = parseDiff(file.patch).filter(isCodeLine);
      for (let start = 0; start < code.length; start++) {
        const lines = code.slice(start, start + 3);
        // What the matching saw before: the request and the code's text.
        const words = [
          messages.question({ path: file.path, count: lines.length }),
          ...lines.map((line) => line.text),
        ].join("\n");
        assert.equal(
          demoAnswer(file, selectionQuestion(file.path, lines, messages), locale),
          demoAnswer(file, words, locale),
          `${locale} ${file.path} from line ${start}`,
        );
      }
    }
  }
});

test("hunks group the lines under each header, notes included, and only code lines are selectable", () => {
  const lines = parseDiff(
    "@@ -1,2 +1,2 @@ first()\n same\n-old\n+new\n\\ No newline at end of file\n@@ -9 +9 @@\n+tail\n",
  );
  const hunks = groupHunks(lines);
  assert.equal(hunks.length, 2);
  assert.equal(hunks[0].header?.text, "@@ -1,2 +1,2 @@ first()");
  assert.deepEqual(
    hunks[0].lines.map((line) => line.kind),
    ["context", "removed", "added", "note"],
  );
  assert.deepEqual(hunks[1].lines.map((line) => line.text), ["tail"]);
  assert.deepEqual(
    lines.filter(isCodeLine).map((line) => line.text),
    ["same", "old", "new", "tail"],
  );
  // Grouping keeps every line once and in order.
  assert.deepEqual(
    hunks.flatMap((hunk) => [hunk.header!, ...hunk.lines]),
    lines,
  );
  assert.deepEqual(groupHunks([]), []);
  const headless = groupHunks([{ id: 0, kind: "added", text: "x", oldLine: null, newLine: 1 }]);
  assert.equal(headless[0].header, undefined);
  assert.equal(headless[0].lines.length, 1);
});

test("a hunk header gives where its lines start and the code it names", () => {
  assert.deepEqual(hunkStart("@@ -10,3 +20,4 @@ function example()"), {
    oldLine: 10,
    newLine: 20,
    context: "function example()",
  });
  assert.deepEqual(hunkStart("@@ -80 +91 @@"), { oldLine: 80, newLine: 91, context: "" });
  assert.equal(hunkStart("not a header"), undefined);
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

test("a gap row heads the hunk below it, like the header it replaces", () => {
  const shown = expandDiff(parseDiff(twoHunks), null, {}, true);
  const groups = groupHunks(shown);
  assert.deepEqual(
    groups.map((group) => [group.header?.kind, group.header?.gap?.index]),
    [
      ["gap", 0],
      ["gap", 1],
      ["gap", 2],
    ],
  );
  // The gap before a change carries its header, for the group's name.
  assert.match(groups[1].header!.text, /^@@ -18,6 \+18,7 @@/);
  assert.equal(groups[2].header!.text, "");
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
