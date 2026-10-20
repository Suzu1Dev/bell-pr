// The walkthrough's "Check yourself" (DESIGN v1.2 D1) in shared/understanding.ts:
// a unit's question for a file without one, its graded answer as the
// file's credited attempt, and the walkthroughs a premise change keeps.
import assert from "node:assert/strict";
import test from "node:test";
import type { ChangeExplanation } from "./explanations.js";
import {
  creditedQuiz,
  keepAnsweredWalkthroughs,
  planCheck,
  walkthroughUnitKey,
  type CheckFile,
  type CheckWalkthrough,
  type FileAttempt,
} from "./understanding.js";

function file(path: string, lines: number): CheckFile {
  return { path, fingerprint: `${path}@1`, additions: lines, deletions: 0 };
}
const questions = {
  fallback: (path: string) => `In one sentence, what does the change to ${path} do, and why?`,
  untested: "What did you not test, and why?",
};
const card = (question: string, answer: string): ChangeExplanation => ({
  summary: "Retries now wait longer each time.",
  reason: "Many clients retrying together would flood the server.",
  concept: "Exponential backoff",
  tip: "Not every error deserves a retry.",
  selfCheck: { question, answer },
});
const walkthrough = (fingerprint: string, units: { name: string; startLine: number; check?: [string, string] }[]): CheckWalkthrough => ({
  fingerprint,
  status: "ready",
  content: {
    functions: units.map((unit) => ({
      name: unit.name,
      startLine: unit.startLine,
      ...(unit.check ? { selfCheck: { question: unit.check[0], answer: unit.check[1] } } : {}),
    })),
  },
});

test("a walkthrough unit's check asks for a file without one and its graded answer credits the slot (D1)", () => {
  const files = [file("src/retry.ts", 80)];
  const walkthroughs = {
    "src/retry.ts": walkthrough("src/retry.ts@1", [
      { name: "sleep", startLine: 3 },
      { name: "retry", startLine: 9, check: ["When does retry give up?", "After the third failed attempt."] },
    ]),
  };
  // Without a card question the unit's question is the file's question.
  const asked = planCheck({ files, walkthroughs, questions });
  assert.deepEqual([asked[0].id, asked[0].source, asked[0].question, asked[0].reference], [
    "selfCheck:src/retry.ts",
    "selfCheck",
    "When does retry give up?",
    "After the third failed attempt.",
  ]);
  const unit = walkthroughUnitKey({ name: "retry", startLine: 9 });
  assert.equal(unit, "retry:9");
  const attempts: Record<string, FileAttempt> = {
    "src/retry.ts": {
      fingerprint: "src/retry.ts@1",
      walkthroughs: { [unit]: { answer: "it stops after three failures", confidence: "sure", grade: "got", at: "2026-10-20T00:00:00.000Z" } },
    },
  };
  const credited = planCheck({ files, walkthroughs, attempts, questions });
  assert.deepEqual([credited[0].id, credited[0].source, credited[0].question], ["attempt:src/retry.ts", "attempt", "When does retry give up?"]);
  assert.deepEqual(creditedQuiz({ attempts, walkthroughs }, "src/retry.ts"), {
    answer: "it stops after three failures",
    confidence: "sure",
    grade: "got",
    at: "2026-10-20T00:00:00.000Z",
    unit,
    question: "When does retry give up?",
    reference: "After the third failed attempt.",
  });
  // An answer at an older version of the file, or a walkthrough for one, credits nothing.
  assert.equal(planCheck({ files, walkthroughs, attempts: { "src/retry.ts": { ...attempts["src/retry.ts"], fingerprint: "src/retry.ts@0" } }, questions })[0].source, "selfCheck");
  assert.equal(planCheck({ files, walkthroughs: { "src/retry.ts": walkthrough("src/retry.ts@0", [{ name: "retry", startLine: 9, check: ["Q?", "A."] }]) }, attempts, questions })[0].source, "fallback");
  // The card's own quiz, once graded, comes first.
  const explanations = { "src/retry.ts": { status: "ready", fingerprint: "src/retry.ts@1", content: card("What is the ceiling?", "Four seconds.") } };
  const quiz = { answer: "it waits under four seconds", confidence: "think" as const, grade: "got" as const, at: "2026-10-20T00:00:00.000Z" };
  const both = { "src/retry.ts": { ...attempts["src/retry.ts"], quiz } };
  assert.equal(planCheck({ files, explanations, walkthroughs, attempts: both, questions })[0].question, "What is the ceiling?");
  assert.deepEqual(creditedQuiz({ attempts: both, walkthroughs }, "src/retry.ts"), quiz);
});

test("a changed premise verdict keeps the walkthroughs whose units were answered", () => {
  const run = {
    walkthroughs: {
      "src/retry.ts": walkthrough("src/retry.ts@1", [{ name: "retry", startLine: 9, check: ["Q?", "A."] }]),
      "src/client.ts": walkthrough("src/client.ts@1", [{ name: "get", startLine: 2, check: ["Q?", "A."] }]),
    },
    attempts: {
      "src/retry.ts": { fingerprint: "src/retry.ts@1", walkthroughs: { "retry:9": { skipped: true, at: "2026-10-20T00:00:00.000Z" } } },
      "src/client.ts": { fingerprint: "src/client.ts@0", walkthroughs: { "get:2": { answer: "x y z", at: "2026-10-20T00:00:00.000Z" } } },
    } as Record<string, FileAttempt>,
  };
  keepAnsweredWalkthroughs(run);
  assert.deepEqual(Object.keys(run.walkthroughs), ["src/retry.ts"]);
  const none: { walkthroughs?: Record<string, CheckWalkthrough> } = { walkthroughs: { "a.ts": walkthrough("a@1", []) } };
  keepAnsweredWalkthroughs(none);
  assert.equal(none.walkthroughs, undefined);
});
