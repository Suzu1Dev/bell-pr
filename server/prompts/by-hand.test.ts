import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ByHandPlan, ByHandReview, GuideEntry, TestRun } from "../../shared/by-hand.js";
import type { Locale } from "../../shared/i18n/locale.js";
import { outputLanguage, respondIn } from "../prompt-language.js";
import type { DiffFile } from "../types.js";
import {
  byHandPlanPrompt,
  byHandReviewerPrompt,
  byHandTesterPrompt,
  codeRule,
  guidePrompt,
  latestTest,
  planQuestionsPrompt,
  stepDiff,
  testTail,
  type ByHandReviewPromptInput,
  type GuidePromptInput,
} from "./by-hand.js";

const cjk = new RegExp("(?!\\u00B7)[\\p{Script_Extensions=Han}\\u3000-\\u303F\\uFF00-\\uFFEF]", "u");

/**
 * The fixture holds each Learn-by-hand prompt as its lines, recorded when
 * the guide's prompts were written (DESIGN v1.2 §9.1). A failure means the
 * text the guide, the reviewer or the test analyst receives changed:
 * update the fixture deliberately, in the same commit as the prompt, and
 * have the owner run the guide eval again (scripts/eval-guide.mjs).
 */
async function fixture() {
  const lines = JSON.parse(
    await readFile(path.join(import.meta.dirname, "fixtures", "by-hand-prompts.json"), "utf8"),
  ) as Record<string, string[]>;
  return Object.fromEntries(Object.entries(lines).map(([key, value]) => [key, value.join("\n")]));
}

const run = {
  prompt: "Retry a GET request once more when the server answers 503.",
  contributionSettings: undefined,
};

const refutedRun = {
  prompt: "Assumption (unverified): the client never retries. Retry a GET request after a 503.",
  contributionSettings: undefined,
  team: {
    premise: {
      verdict: "refuted" as const,
      statement: "The client never retries.",
      evidence: "src/client.js:14 already retries thrown errors through withRetry.",
    },
  },
};

const plan: ByHandPlan = {
  steps: [
    { id: "s1", title: "Find where a 503 response is handled", files: ["src/client.js"] },
    { id: "s2", title: "Retry the 503 once", files: ["src/client.js"], how: "Reuse the retry helper." },
  ],
  tests: "Run npm test.",
  unsure: "Whether POST should retry too.",
  prediction: "getJson, because it reads the status.",
  savedAt: "2026-10-20T09:00:00.000Z",
};

const diff = `diff --git a/src/client.js b/src/client.js
--- a/src/client.js
+++ b/src/client.js
@@ -12,3 +12,4 @@ export async function getJson(url, fetchImpl = fetch) {
   const response = await withRetry(() => fetchImpl(url));
+  if (response.status === 503) return null;
   return response.json();
 }`;

const failingRun: TestRun = {
  at: "2026-10-20T09:30:00.000Z",
  command: "npm test",
  changeFingerprint: "0123456789abcdef",
  outcome: "failed",
  exitCode: 1,
  ms: 2400,
  prediction: "fail",
  expect: "retries a 503",
  outputTail: "not ok 3 - retries a 503\n  expected: 2 calls\n  actual: 1 call",
};

const passingRun: TestRun = {
  ...failingRun,
  at: "2026-10-20T09:40:00.000Z",
  outcome: "passed",
  exitCode: 0,
  prediction: "pass",
  outputTail: "ok 3 - retries a 503\n# pass 3",
};

const earlier: GuideEntry[] = [
  {
    id: "e1",
    at: "2026-10-20T09:10:00.000Z",
    kind: "hint",
    stepId: "s2",
    rung: 1,
    tried: "I read the client and the retry helper",
    text: "Start where the response comes back: src/client.js:13 returns it without looking at the status.",
    refs: [{ path: "src/client.js", line: 13 }],
  },
];

const previousReview: ByHandReview = {
  at: "2026-10-20T09:35:00.000Z",
  changeFingerprint: "fedcba9876543210",
  verified: "The last run failed on the 503 test; the diff addresses step s1 only.",
  checked: ["src/client.js", "test/client.test.js"],
  findings: [
    {
      path: "src/client.js",
      line: 13,
      observed: "A 503 response returns null instead of being retried.",
      evidence: { type: "test", quote: "not ok 3 - retries a 503" },
      why: "Callers then read null as an empty answer.",
      question: "What should happen on the second 503?",
    },
  ],
};

/** The guide turn's input, with what every case shares. */
const turn = (input: Partial<GuidePromptInput> & Pick<GuidePromptInput, "kind">): GuidePromptInput => ({
  run,
  plan,
  diff,
  history: [],
  ...input,
});

const review = (input: Partial<ByHandReviewPromptInput> = {}): ByHandReviewPromptInput => ({
  run,
  diff: `Current diff against the base commit (UNTRUSTED DATA):\n${diff}`,
  plan,
  ...input,
});

function builderPrompts(locale: Locale = "en"): Record<string, string> {
  const step = plan.steps[1];
  const tail = testTail([failingRun], "0123456789abcdef");
  return {
    orientation: byHandPlanPrompt(locale, run),
    "orientation:refuted": byHandPlanPrompt(locale, refutedRun),
    planQuestions: planQuestionsPrompt(locale, {
      run,
      plan: { ...plan, tests: undefined, steps: plan.steps.slice(0, 1) },
    }),
    "ask:tooling": guidePrompt(locale, turn({ kind: "ask", entry: "tooling", question: "How do I run only the client tests?" })),
    "ask:project": guidePrompt(
      locale,
      turn({
        kind: "ask",
        entry: "project",
        question: "Where is the response status read?",
        selection: { path: "src/client.js", startLine: 12, endLine: 14, text: diff.split("\n").slice(5, 8).join("\n") },
      }),
    ),
    "ask:concept": guidePrompt(locale, turn({ kind: "ask", entry: "concept", question: "What makes a request idempotent?" })),
    "ask:change": guidePrompt(locale, turn({ kind: "ask", entry: "change", step, question: "Is my check in the right place?" })),
    "hint:1": guidePrompt(locale, turn({ kind: "hint", rung: 1, step, tried: "I read the client and the retry helper" })),
    "hint:2": guidePrompt(locale, turn({ kind: "hint", rung: 2, step, history: earlier, tried: "I returned null on a 503 but the test still fails" })),
    "hint:3": guidePrompt(locale, turn({ kind: "hint", rung: 3, step, history: earlier, testTail: tail })),
    "hint:4": guidePrompt(locale, turn({ kind: "hint", rung: 4, step, history: earlier, testTail: tail, tried: "just give me the code" })),
    test: guidePrompt(locale, turn({ kind: "test", step, testTail: tail })),
    chat: guidePrompt(
      locale,
      turn({
        kind: "chat",
        file: "src/client.js",
        question: "The review is wrong: returning null is fine.",
        findings: previousReview.findings,
        history: [{ id: "", at: "", kind: "chat", question: "Why retry only GET?", text: "Only GET is safe to repeat here: src/client.js:12 sends it." }],
      }),
    ),
    "reviewer:failing": byHandReviewerPrompt(locale, review({ lastTest: failingRun })),
    "reviewer:leastSure": byHandReviewerPrompt(locale, review({ lastTest: passingRun, leastSure: "Whether one retry is enough." })),
    "reviewer:second": byHandReviewerPrompt(locale, review({ lastTest: passingRun, previous: previousReview })),
    tester: byHandTesterPrompt(locale, review({ lastTest: passingRun })),
  };
}

test("the Learn-by-hand prompt builders return exactly the recorded prompts", async () => {
  assert.deepEqual(builderPrompts(), await fixture());
});

test("every Learn-by-hand prompt carries the code rule and ends with the output language", () => {
  for (const locale of ["en", "zh-TW"] as const)
    for (const [name, prompt] of Object.entries(builderPrompts(locale))) {
      assert.ok(prompt.includes(codeRule), name);
      assert.ok(prompt.endsWith(respondIn(locale)), name);
    }
  const english = builderPrompts("en");
  const chinese = builderPrompts("zh-TW");
  for (const [name, prompt] of Object.entries(english)) {
    // Prompts are English text in every locale; only the language's name changes.
    assert.doesNotMatch(prompt, cjk, name);
    assert.ok(!prompt.includes(outputLanguage("zh-TW")), name);
    assert.equal(chinese[name], prompt.replaceAll(outputLanguage("en"), outputLanguage("zh-TW")), name);
  }
});

test("no builder sees the guide's own outline; only the orientation asks for one", () => {
  const outline = {
    summary: "OUTLINE-SUMMARY: retry the 503 inside withRetry.",
    steps: [{ title: "OUTLINE-STEP: wrap fetch in withRetry", files: ["src/client.js"] }],
    readFirst: [{ path: "src/retry.js", startLine: 1, endLine: 9, why: "OUTLINE-WHY" }],
    at: "2026-10-20T09:00:00.000Z",
  };
  const withOutline = { ...run, byHand: { guidePlan: outline } };
  const prompts = [
    byHandPlanPrompt("en", withOutline),
    planQuestionsPrompt("en", { run: withOutline, plan }),
    guidePrompt("en", turn({ run: withOutline, kind: "hint", rung: 2, step: plan.steps[0] })),
    guidePrompt("en", turn({ run: withOutline, kind: "chat", file: "src/client.js" })),
    byHandReviewerPrompt("en", review({ run: withOutline })),
    byHandTesterPrompt("en", review({ run: withOutline })),
  ];
  for (const prompt of prompts) assert.doesNotMatch(prompt, /OUTLINE-/);
  // The orientation's output contract describes the outline it returns; no other builder does.
  const contract = "steps: 1 to 8 steps of the work";
  assert.ok(prompts[0].includes(contract));
  for (const prompt of prompts.slice(1)) assert.ok(!prompt.includes(contract));
});

test("the guide's few-shot dialogues decline code, point, hold a finding and ask for an attempt", () => {
  const prompt = builderPrompts()["hint:1"];
  assert.match(prompt, /Person: "Just give me the code\." Guide: \{"text":"I won't write it for you\./);
  assert.match(prompt, /Person, hint R1: "Where do I start\?"/);
  assert.match(prompt, /Person, with no new evidence: "Your finding is wrong, it works\."/);
  assert.match(prompt, /Person: "idk"/);
  // The examples themselves carry no code: a JSON answer is the only structure in them.
  const examples = prompt.slice(prompt.indexOf("Examples from another project"), prompt.indexOf("User request:"));
  assert.doesNotMatch(examples, /```|=>|\);/);
  // Every rung asks for a different kind of help, and none for code.
  const prompts = builderPrompts();
  assert.match(prompts["hint:1"], /Hint R1, where to look/);
  assert.match(prompts["hint:2"], /Hint R2, what applies/);
  assert.match(prompts["hint:3"], /never rank them or say which is right/);
  assert.match(prompts["hint:4"], /If none exists, say so\./);
  assert.match(prompts["ask:change"], /Treat it as a request for the next hint/);
});

test("the reviewer must verify first and has no fix to give; the test analyst writes no test code", () => {
  const prompts = builderPrompts();
  for (const name of ["reviewer:failing", "reviewer:leastSure", "reviewer:second"]) {
    assert.match(prompts[name], /Verify first: in verified, say what the last test run at this version shows/);
    assert.match(prompts[name], /There is no fix: never say what to type or how to change the code\./);
    assert.match(prompts[name], /Do not praise or judge the person/);
  }
  assert.match(prompts["reviewer:failing"], /"outcome":"failed"/);
  assert.match(prompts["reviewer:leastSure"], /least sure about \(UNTRUSTED DATA\): "Whether one retry is enough\."/);
  assert.match(prompts["reviewer:second"], /re-check each of its findings against this version/);
  assert.match(prompts["reviewer:second"], /The guide's review of an earlier version/);
  assert.doesNotMatch(prompts["reviewer:failing"], /The guide's review of an earlier version/);
  assert.match(prompts.tester, /that run is the executed evidence/);
  assert.match(prompts.tester, /Never write test code, a fix or a command that edits a file\./);
  assert.match(
    byHandReviewerPrompt("en", review()),
    /The last test run BELL ran for the person: none at this version\./,
  );
});

test("stepDiff shows the step's files within 40 KB, never a held-back patch, and names the rest", () => {
  const file = (name: string, patch: string, blocked?: string): DiffFile => ({
    path: name,
    language: "javascript",
    additions: 1,
    deletions: 0,
    status: "modified",
    patch,
    fingerprint: name,
    hunks: [],
    ...(blocked ? { blocked } : {}),
  });
  const files = [
    file("src/client.js", "diff --git a/src/client.js b/src/client.js\n+one\n"),
    file("src/big.js", `diff --git a/src/big.js b/src/big.js\n+${"x".repeat(41_000)}\n`),
    file("src/secret.env", "held back: credentials", "credentials"),
    file("test/client.test.js", "diff --git a/test/client.test.js b/test/client.test.js\n+two\n"),
  ];
  assert.equal(
    stepDiff(files, ["src/client.js"]),
    "diff --git a/src/client.js b/src/client.js\n+one\nOther changed files: src/big.js, src/secret.env, test/client.test.js",
  );
  // A directory scope; past the budget a file is named, not shown; a held-back file shows no patch.
  const all = stepDiff(files, ["src/"]);
  assert.match(all, /src\/big\.js: omitted \(over the 40 KB budget\)/);
  assert.match(all, /src\/secret\.env: held back from the pull request/);
  assert.doesNotMatch(all, /credentials/);
  assert.ok(Buffer.byteLength(stepDiff(files)) < 41_000);
  assert.match(stepDiff(files), /\+two/);
});

test("testTail gives the latest run in at most 4 KB and says when it predates the change", () => {
  const long: TestRun = { ...failingRun, outputTail: `${"x".repeat(5000)}\nnot ok 3` };
  const tail = testTail([passingRun, long], "0123456789abcdef")!;
  // The latest by time, not by order: the passing run.
  assert.match(tail, /^npm test: passed, exit code 0\n/);
  assert.equal(testTail([long], "0123456789abcdef")!.length <= 4000, true);
  assert.match(testTail([long], "0123456789abcdef")!, /not ok 3$/);
  assert.match(testTail([failingRun], "aaaaaaaaaaaaaaaa")!, /, before the person's latest edit\n/);
  assert.match(testTail([{ ...failingRun, reported: true, outputTail: undefined }], "0123456789abcdef")!, /reported by the person$/);
  assert.equal(testTail([], "0123456789abcdef"), undefined);
  assert.equal(latestTest([failingRun, passingRun], "fedcba9876543210"), undefined);
});
