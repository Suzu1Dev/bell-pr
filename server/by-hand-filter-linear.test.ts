// The code filter (shared/by-hand-filter.ts) reads every agent text of a
// Learn-by-hand run, up to 80,000 characters of an answer, against cited
// files of up to 1 MB at base and in the worktree: none of it may hold the
// server. Each field here is one shape that made a pattern read the rest of
// the text again from each character (letters, identifiers, runs of
// backticks, brackets or start tags, long lines of spaces in a file); each
// must be filtered in linear time, and the test analyst's report is kept
// at a few thousand characters.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { filterAgentText, filterCodeField, filterGuideOutput, type FilterSources } from "../shared/by-hand-filter.js";
import { byHandLimits } from "../shared/by-hand.js";
import { reviewInput, storedReview, type GuideRun } from "./by-hand-guide.js";
import { git } from "./process.js";

const fill = (unit: string, length = 80_000) => unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
/** The fastest of `runs` runs, in ms, so a busy machine's pause doesn't count. */
const timed = (fn: () => unknown, runs = 2) => {
  let fastest = Infinity;
  for (let run = 0; run < runs; run++) {
    const start = performance.now();
    fn();
    fastest = Math.min(fastest, performance.now() - start);
  }
  return fastest;
};

const small: FilterSources = {
  base: { "src/retry.ts": ["export const attempts = 1;"] },
  worktree: { "src/retry.ts": ["export const attempts = 3;"] },
  diff: "+export const attempts = 3;",
  protectedFiles: ["src/retry.ts"],
};

/** 80,000-character agent fields, each a shape a pattern used to read again from every character. */
const fields: [string, string][] = [
  ["letters", fill("a")],
  ["identifiers", fill("retry_after_503_")],
  ["camelCase", fill("retryAfter")],
  ["dotted names", fill("a.")],
  ["member increments", `${fill("a.")}++x`],
  ["calls", fill("f(")],
  ["index brackets", fill("a[")],
  ["braces", `{${fill(":")}`],
  ["backticks", fill("`")],
  ["backtick pairs", fill("``a")],
  ["tildes", fill("~")],
  ["start tags", fill("<pre")],
  ["tags", fill("<a")],
  ["dots", `${fill("a....")}x`],
  ["closing brackets", `${fill(")")}x`],
  ["spaces", `a${fill(" ")}= b`],
  ["tabs", `a${fill("\t")}*2`],
  ["expressions", fill("a = b ")],
  ["a fence left open", `\`\`\`\n${fill("a\n")}`],
  ["indented lines", `\n${fill("    a\n")}`],
];

test("an agent field of 80,000 characters of any one shape is filtered in under 200 ms", () => {
  for (const [name, text] of fields)
    for (const options of [{}, { tooling: true, refs: [{ path: "src/retry.ts", line: 1 }] }]) {
      const ms = timed(() => filterAgentText(text, small, options));
      assert.ok(ms < 200, `${name}${options.tooling ? " (tooling)" : ""}: ${ms.toFixed(0)} ms`);
    }
});

test("a guide answer citing ten files with 1 MB lines of spaces is filtered in under 200 ms", () => {
  const lines = (padding: string) => [`${padding.repeat(1_000_000)}x`, "export const attempts = 1;", `y${padding.repeat(1_000_000)}`];
  const files = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`src/f${index}.ts`, lines(index % 2 ? "\t" : " ")]));
  const sources: FilterSources = { base: files, worktree: files, diff: "+export const attempts = 3;" };
  const answer = {
    text: "Look at `attempts` in src/f0.ts:2:\n```ts\nexport const attempts = 1;\n```\n```\nreturn retry(fn, 3);\n```",
    question: "Why is `attempts` 1?",
    refs: [{ path: "src/f0.ts", line: 2, endLine: null }],
    quotes: [{ path: "src/f0.ts", startLine: 2, endLine: 2, from: "base", anchor: "attempts" }],
    options: [
      { name: "Raise `attempts`", tradeoff: "One line: `export const attempts = 1;`." },
      { name: "Loop", tradeoff: "A `for` loop around the call." },
    ],
    topic: "project",
    askedForCode: false,
  };
  const ms = timed(() => filterGuideOutput(answer, sources));
  assert.ok(ms < 200, `filterGuideOutput: ${ms.toFixed(0)} ms`);
  const filtered = filterGuideOutput(answer, sources).value;
  assert.match(filtered.text, /```ts\nexport const attempts = 1;\n```/);
  assert.doesNotMatch(filtered.text, /return retry/);
  assert.ok(timed(() => filterCodeField("export const attempts = 1;\nexport const attempts = 1;", sources)) < 200);
});

test("the test analyst's report at Ready is kept at the length of a test run's output, filtered in linear time", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-filter-linear-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "retry.ts"), "export const attempts = 1;\n");
  await git(directory, ["init", "-q", "-b", "main"]);
  await git(directory, ["config", "user.name", "BELL Test"]);
  await git(directory, ["config", "user.email", "test@example.invalid"]);
  await git(directory, ["add", "-A"]);
  await git(directory, ["commit", "-qm", "initial"]);
  const baseSha = (await git(directory, ["rev-parse", "HEAD"])).stdout.trim();
  const run = { prompt: "Retry a 503.", baseSha, worktreePath: directory, byHand: {} } as GuideRun;
  const reviewer = JSON.stringify({ verified: "No test ran at this version.", checked: ["retry.ts"], findings: [] });
  for (const tester of [fill("retry_after_503_", 100_000), `No test sends two 503s. ${fill("a", 100_000)}`]) {
    const start = performance.now();
    const stored = await storedReview(run, [], reviewInput(run, []), { reviewer, tester });
    const ms = performance.now() - start;
    assert.ok(ms < 500, `storedReview: ${ms.toFixed(0)} ms`);
    assert.ok(stored.tester.length <= byHandLimits.tailChars, `${stored.tester.length} characters kept`);
  }
});
