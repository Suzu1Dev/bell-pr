// The code filter's rules (DESIGN v1.2 F7) on adversarial guide answers:
// code reaches the person only as quotes BELL cuts from the base commit or
// the person's own files.
import assert from "node:assert/strict";
import test from "node:test";
import {
  cutQuote,
  filterAgentText,
  filterCodeField,
  filterGuideOutput,
  type FilterSources,
  type GuideOutput,
} from "./by-hand-filter.js";

const base = [
  "export async function retry(fn, attempts) {",
  "  for (let attempt = 1; attempt <= attempts; attempt++) {",
  "    try {",
  "      return await fn();",
  "    } catch (error) {",
  "      if (attempt === attempts) throw error;",
  "    }",
  "  }",
  "}",
];
// The person's own edit so far: a delay constant.
const worktree = [...base.slice(0, 1), "  const delayMs = 100;", ...base.slice(1)];
const testFile = ["import { retry } from '../src/retry';", "test('retries a 503', async () => {", "});"];
const diff = "--- a/src/retry.ts\n+++ b/src/retry.ts\n@@ -1,1 +1,2 @@\n export async function retry(fn, attempts) {\n+  const delayMs = 100;";
const sources: FilterSources = {
  base: { "src/retry.ts": base, "test/retry.test.ts": testFile },
  worktree: { "src/retry.ts": worktree, "test/retry.test.ts": testFile },
  diff,
  protectedFiles: ["src/retry.ts"],
};
/** The hidden good diff the guide must never hand over (its added lines). */
const solution = [
  "      await new Promise((resolve) => setTimeout(resolve, backoffDelay(attempt)));",
  "export function backoffDelay(attempt) {",
  "  return delayMs * 2 ** attempt;",
];

const answer = (overrides: Partial<GuideOutput>): GuideOutput => ({
  text: "Look at the catch block.",
  question: null,
  refs: [{ path: "src/retry.ts", line: 5, endLine: 6 }],
  quotes: [],
  options: null,
  topic: "change",
  askedForCode: false,
  ...overrides,
});

test("a code fence stays only when it is a contiguous run of a file's lines", () => {
  const quoted = filterAgentText(`The loop:\n\n\`\`\`ts\n${base.slice(1, 4).join("\n")}\n\`\`\`\n`, sources);
  assert.equal(quoted.removed, 0);
  assert.ok(quoted.value.includes(base[3]));
  // The person's own line in the worktree counts as well.
  assert.equal(filterAgentText("```\n  const delayMs = 100;\n```", sources).removed, 0);
  for (const text of [
    `Try this:\n\n\`\`\`ts\n${solution.join("\n")}\n\`\`\`\nThen run the tests.`,
    `~~~\n${solution[0]}\n~~~`,
    // Lines of the file, but not contiguous.
    `\`\`\`\n${base[1]}\n${base[5]}\n\`\`\``,
    // An unclosed fence runs to the end.
    `Here:\n\`\`\`js\n${solution[2]}`,
  ]) {
    const filtered = filterAgentText(text, sources);
    assert.equal(filtered.removed, 1, text);
    for (const line of solution) assert.ok(!filtered.value.includes(line.trim()), text);
  }
});

test("a fake quote, wrong line numbers and anchor drift past 3 lines are dropped", () => {
  const filtered = filterGuideOutput(
    answer({
      quotes: [
        // A fake quote: the anchor is the solution, which is not in the file.
        { path: "src/retry.ts", startLine: 5, endLine: 6, from: "base", anchor: "backoffDelay(attempt)" },
        // Lines past the end of the file.
        { path: "src/retry.ts", startLine: 40, endLine: 44, from: "base", anchor: null },
        // A file the answer may not quote.
        { path: "/etc/passwd", startLine: 1, endLine: 1, from: "base", anchor: null },
        // Anchor 4 lines away from the range.
        { path: "src/retry.ts", startLine: 1, endLine: 1, from: "base", anchor: "} catch (error) {" },
        // Anchor 2 lines away: shifted.
        { path: "src/retry.ts", startLine: 1, endLine: 1, from: "base", anchor: "try {" },
        // The person's own line, quoted from the change.
        { path: "src/retry.ts", startLine: 2, endLine: 2, from: "change", anchor: "delayMs" },
      ],
      refs: [
        { path: "src/retry.ts", line: 6, endLine: null },
        { path: "src/retry.ts", line: 99, endLine: null },
        { path: "src/missing.ts", line: 1, endLine: null },
        { path: "src/retry.ts", line: 3, endLine: 2 },
      ],
    }),
    sources,
  );
  assert.equal(filtered.dropped, 4 + 3);
  assert.deepEqual(filtered.value.refs, [{ path: "src/retry.ts", line: 6 }]);
  assert.deepEqual(filtered.value.quotes, [
    { path: "src/retry.ts", from: "base", startLine: 3, endLine: 3, text: base[2] },
    { path: "src/retry.ts", from: "change", startLine: 2, endLine: 2, text: "  const delayMs = 100;" },
  ]);
});

test("cutQuote shifts up to 3 lines to its anchor, never 4, and cuts at most 15 lines", () => {
  const lines = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`);
  assert.deepEqual(cutQuote(lines, { startLine: 10, endLine: 11, anchor: "line 12" }), {
    startLine: 11,
    endLine: 12,
    text: "line 11\nline 12",
  });
  assert.deepEqual(cutQuote(lines, { startLine: 10, endLine: 10, anchor: "line 8" })?.startLine, 8);
  assert.equal(cutQuote(lines, { startLine: 10, endLine: 10, anchor: "line 14" }), undefined);
  assert.equal(cutQuote(lines, { startLine: 10, endLine: 10, anchor: "line 6" }), undefined);
  const long = cutQuote(lines, { startLine: 1, endLine: 30 });
  assert.equal(long?.endLine, 15);
  assert.equal(long?.text.split("\n").length, 15);
  assert.equal(cutQuote(lines, { startLine: 0, endLine: 2 }), undefined);
  assert.equal(cutQuote(lines, { startLine: 39, endLine: 41 }), undefined);
  assert.equal(cutQuote(undefined, { startLine: 1, endLine: 1 }), undefined);
});

test("a tooling answer keeps a one-line command, never one that edits a step file", () => {
  const tooling = (text: string) =>
    filterGuideOutput(answer({ topic: "tooling", text, refs: [] }), sources).value.text;
  assert.equal(tooling("Run `npm test -- retry` to run only these tests."), "Run `npm test -- retry` to run only these tests.");
  assert.equal(tooling("Then `sed -i 's/attempts/max/' src/retry.ts` and rerun."), "Then … and rerun.");
  assert.equal(tooling("Or `npm test -- retry > out.log`."), "Or `npm test -- retry > out.log`.");
  assert.equal(tooling("Or `echo x >> src/retry.ts`."), "Or ….");
  // A long span is not a command, whatever the topic.
  const long = `\`${"node -e 'retryWithBackoff(" + "x".repeat(110) + ")'"}\``;
  assert.equal(tooling(`Paste ${long}.`), "Paste ….");
  // Outside tooling a command that occurs nowhere is code: removed.
  assert.equal(
    filterGuideOutput(answer({ text: "Run `npm test -- retry`." }), sources).value.text,
    "Run ….",
  );
});

test("an inline span stays when it occurs in a cited file or the diff; an invented identifier goes", () => {
  const text =
    "The loop in `retry` stops when `attempt === attempts`, and you added `const delayMs = 100;`. Call backoffDelay(attempt) and wait_for_retry first, see https://example.com/retry_policy and src/retry_policy.ts.";
  const filtered = filterAgentText(text, sources);
  assert.equal(
    filtered.value,
    "The loop in `retry` stops when `attempt === attempts`, and you added `const delayMs = 100;`. Call …(attempt) and … first, see https://example.com/retry_policy and src/retry_policy.ts.",
  );
  assert.equal(filtered.removed, 2);
  assert.equal(filterAgentText("Use `setTimeout(resolve, backoffDelay(attempt))` there.", sources).value, "Use … there.");
  // Words that exist in the project's code stay, camelCase or not, and so does prose with dashes and slashes.
  assert.equal(filterAgentText("The delayMs constant feeds retry(fn, attempts).", sources).removed, 0);
  assert.equal(filterAgentText("The loop - and the catch block - decide; pass / fail is up to the tests.", sources).removed, 0);
  assert.equal(filterAgentText("It stops when attempt === attempts.", sources).removed, 0);
  assert.equal(filterAgentText("Make it delayMs * 2 ** attempt; then test.", sources).value, "Make it … then test.");
});

test("a code field stays only when verbatim in base or worktree", () => {
  assert.deepEqual(filterCodeField(solution.slice(1).join("\n"), sources), { value: undefined, removed: 0, dropped: 1 });
  const before = base.slice(4, 6).join("\n");
  assert.deepEqual(filterCodeField(before, sources), { value: before, removed: 0, dropped: 0 });
  assert.deepEqual(filterCodeField(undefined, sources), { value: undefined, removed: 0, dropped: 0 });
});

test("an answer of nothing but code becomes the pointers of its valid refs", () => {
  const filtered = filterGuideOutput(
    answer({
      text: `\`\`\`ts\n${solution.join("\n")}\n\`\`\``,
      refs: [
        { path: "src/retry.ts", line: 5, endLine: 6 },
        { path: "test/retry.test.ts", line: 2, endLine: null },
      ],
      question: "Does `backoffDelay(attempt)` cover the last attempt?",
      options: [
        { name: "Delay in the loop", tradeoff: "Every caller waits; a test needs `useFakeTimers()`." },
        { name: "A wrapper", tradeoff: "Callers opt in." },
      ],
    }),
    sources,
  );
  assert.equal(filtered.value.text, "src/retry.ts:5-6\ntest/retry.test.ts:2");
  assert.equal(filtered.value.question, "Does … cover the last attempt?");
  assert.equal(filtered.value.options?.[0].tradeoff, "Every caller waits; a test needs ….");
  assert.equal(filtered.removed, 3);
});

test("no added line of the hidden diff survives unless it is a verbatim quote of base or worktree", () => {
  // The person already wrote one line of the solution in their worktree.
  const written = {
    ...sources,
    worktree: { ...sources.worktree, "src/retry.ts": [...worktree.slice(0, 2), solution[2], ...worktree.slice(2)] },
  };
  const outputs: GuideOutput[] = solution.flatMap((line) => [
    answer({ text: `\`\`\`\n${line}\n\`\`\`` }),
    answer({ text: `Write \`${line.trim()}\` there.` }),
    answer({ text: `Write ${line.trim()} there.` }),
    answer({ text: "Two ways.", options: [{ name: line.trim(), tradeoff: `Then ${line.trim()}` }, { name: "B", tradeoff: "C" }] }),
    answer({ question: `What if you wrote ${line.trim()}?` }),
    answer({ quotes: [{ path: "src/retry.ts", startLine: 2, endLine: 3, from: "base", anchor: line.trim().slice(0, 80) }] }),
    answer({ topic: "tooling", text: `Run \`${line.trim()}\`.` }),
  ]);
  for (const filterSources of [sources, written])
    for (const output of outputs) {
      const stored = filterGuideOutput(output, filterSources).value;
      const visible = [stored.text, stored.question ?? "", ...(stored.options ?? []).flatMap((option) => [option.name, option.tradeoff]), ...stored.quotes.map((quote) => quote.text)].join("\n");
      for (const line of solution) {
        const verbatim = Object.values(filterSources.worktree).some((lines) => lines?.includes(line));
        if (!verbatim) assert.ok(!visible.includes(line.trim()), `${line.trim()} survived in ${JSON.stringify(stored)}`);
      }
    }
});

test("a list of * or + items is prose: an operator joins operands on one line only", () => {
  for (const text of ["Steps:\n* Read the loop\n* Run the tests", "Two ideas\n+ ask a maintainer\n+ read the issue again"])
    assert.deepEqual(filterAgentText(text, sources), { value: text, removed: 0, dropped: 0 });
  assert.equal(filterAgentText("Then delayMs * attempt;", sources).value, "Then …");
});

test("code in other Markdown shapes goes too: indented blocks, prefixed fences, HTML code and diff lines", () => {
  const leaks = {
    "an indented code block": "Try this:\n\n    if (attempt < attempts) {\n      await sleep(delayMs * attempt);\n    }\n\nThen test.",
    "a tab-indented block": "Try:\n\n\tconst wait = 100 * attempt;\n\tawait sleep(wait);\n",
    "an indented block inside a list item": "1. Add a delay:\n\n        const wait = 100 * attempt;\n        await sleep(wait);\n",
    "an unclosed fence in a list item": "1. Add:\n    ```js\n    const wait = 100 * attempt;\n    await sleep(wait);",
    "an unclosed fence in a quote": "> ```js\n> const wait = 100 * attempt;\n> await sleep(wait);\n",
    "an HTML pre element": "Use this:\n<pre>\nfor (const item of items) {\n  total += item.price;\n}\n</pre>\n",
    "an HTML code element": "Write <code>return fn().catch(handle);</code> in the catch block.",
    "a diff hunk": "Change it like this:\n@@ -4,1 +4,2 @@\n       return await fn();\n+      await new Promise((resolve) => setTimeout(resolve, 100));\n",
    "added diff lines without a hunk": "Change:\n- return await fn();\n+ return await fn().catch(handle);\n",
  };
  for (const [name, text] of Object.entries(leaks)) {
    const filtered = filterAgentText(text, sources);
    assert.ok(filtered.removed >= 1, name);
    for (const code of ["attempt < attempts", "delayMs * attempt", "100 * attempt", "await sleep", "total += item.price", "catch(handle)", "setTimeout(resolve"])
      assert.ok(!filtered.value.includes(code), `${name}: ${code} survived in ${JSON.stringify(filtered.value)}`);
  }
  // Verbatim lines of the project's files stay in each of these shapes.
  for (const text of [
    `The loop:\n\n    ${base[1]}\n    ${base[2]}\n\nRead it.`,
    `> \`\`\`ts\n> ${base[3]}\n> \`\`\``,
    `<pre>\n${base[5]}\n</pre>`,
    `@@ -5,2 +5,2 @@\n ${base[4]}\n-${base[5]}\n+${base[5]}`,
  ])
    assert.equal(filterAgentText(text, sources).removed, 0, text);
  // Prose keeps its lists, its quoted lines and its "+1".
  for (const text of [
    "1. Read the loop.\n\n   Then the catch block decides.\n2. Run the tests.",
    "- Read the loop\n- Run the tests\n+ One more idea: ask a maintainer.",
    "> The project says to keep pull requests small.",
  ])
    assert.equal(filterAgentText(text, sources).removed, 0, text);
});

test("an identifier counts only as a whole word of the sources, not as part of a longer one", () => {
  // "wait" is part of "await", "tempt" of "attempt": neither is a word the project has.
  assert.equal(filterAgentText("Then return wait(attempt) from tempt_next.", sources).value, "Then return …(attempt) from ….");
  assert.equal(filterAgentText("Keep retry(fn, attempts) as it is.", sources).removed, 0);
});

test("encoded payloads and BELL's own placeholder characters never carry code through", () => {
  const encoded = Buffer.from("const wait = 100 * attempt;\nawait sleep(wait);").toString("base64");
  for (const text of [
    `Decode ${encoded} and paste it.`,
    `Open https://example.com/?code=${encoded} to see it.`,
  ]) {
    const filtered = filterAgentText(text, sources);
    assert.equal(filtered.removed, 1, text);
    assert.ok(!filtered.value.includes(encoded.slice(0, 20)), text);
  }
  // A commit hash and an ordinary link stay.
  assert.equal(filterAgentText("See 3f9c2a1b7d4e5f60718293a4b5c6d7e8f9012345 and https://example.com/docs/retry.", sources).removed, 0);
  // A character BELL uses to hold kept text aside can't pull that text in twice or turn into "undefined".
  const held = filterAgentText("0 `retry` and 1", sources);
  assert.equal(held.value, "0 `retry` and 1");
});
