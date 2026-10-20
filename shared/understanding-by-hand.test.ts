// Explain it back in a Learn-by-hand run (DESIGN v1.2 F10), in
// shared/understanding.ts: the fixed question and the copy check against
// the AI-written part of a reference only.
import assert from "node:assert/strict";
import test from "node:test";
import type { ChangeExplanation } from "./explanations.js";
import {
  planCheck,
  understandingStatus,
  type CheckFile,
  type CheckWalkthrough,
  type RunUnderstanding,
} from "./understanding.js";

function file(path: string, lines: number): CheckFile {
  return { path, fingerprint: `${path}@1`, additions: lines, deletions: 0 };
}
const questions = {
  fallback: (path: string) => `You wrote the change to ${path}. Why this way rather than another, and what would break if it were wrong?`,
  untested: "What did you not test, and why?",
};
const card = (question: string, answer: string): ChangeExplanation => ({
  summary: "Retries now wait longer each time.",
  reason: "Many clients retrying together would flood the server.",
  concept: "Exponential backoff",
  tip: "Not every error deserves a retry.",
  selfCheck: { question, answer },
});
const ownSteps =
  "Retry a GET twice after a 503, waiting a little longer before each new attempt so the server can recover";
const finding =
  "The guide's review: A POST that meets a 503 is retried too, which can create the same resource twice on the server.";

test("in Learn by hand every file asks the fixed question and only the AI-written part counts as a copy", () => {
  const files = [file("src/retry.ts", 80), file("src/client.ts", 40)];
  const quiz = { answer: "it waits under four seconds", confidence: "think" as const, grade: "got" as const, at: "2026-10-20T00:00:00.000Z" };
  const plan = planCheck({
    files,
    // Ignored in a Learn-by-hand run: AI explanations, attempts and walkthrough credit.
    explanations: { "src/retry.ts": { status: "ready", fingerprint: "src/retry.ts@1", content: card("What is the ceiling?", "Four seconds.") } },
    attempts: { "src/retry.ts": { fingerprint: "src/retry.ts@1", quiz } },
    reports: { tester: "Untested: a server that never recovers." },
    questions,
    byHand: {
      reference: (path) => ({ own: ownSteps, ai: path === "src/retry.ts" ? finding : undefined }),
      untested: { own: "Your last test run of this version: npm test (passed).", ai: "No test covers a POST." },
    },
  });
  assert.deepEqual(
    plan.map((item) => [item.id, item.source, item.question]),
    [
      ["fallback:src/retry.ts", "fallback", questions.fallback("src/retry.ts")],
      ["fallback:src/client.ts", "fallback", questions.fallback("src/client.ts")],
      ["untested", "untested", questions.untested],
    ],
  );
  assert.equal(plan[0].reference, `${ownSteps}\n\n${finding}`);
  assert.equal(plan[0].copyReference, finding);
  assert.equal(plan[1].reference, ownSteps);
  assert.equal(plan[1].copyReference, "");
  assert.equal(plan[2].reference, "Your last test run of this version: npm test (passed).\n\nNo test covers a POST.");
  assert.equal(plan[2].copyReference, "No test covers a POST.");
  // Recalling 10+ words of one's own step is accepted; repeating 10+ words of the review is not.
  const record = (answer: string): RunUnderstanding => ({
    summary: { text: "The client now retries a GET twice after a 503 and waits longer before each new attempt.", changeFingerprint: "", at: "2026-10-20T00:00:00.000Z" },
    items: [{ id: "fallback:src/retry.ts", path: "src/retry.ts", fingerprint: "src/retry.ts@1", source: "fallback", question: plan[0].question, answer, confidence: "think", lockedAt: "2026-10-20T00:00:00.000Z", grade: "got" }],
  });
  const missingFor = (answer: string) =>
    understandingStatus({ record: record(answer), plan: plan.slice(0, 1), files: files.slice(0, 1), required: true }).missing;
  assert.ok(!missingFor(ownSteps).some((entry) => entry.part === "answer"));
  // The whole reference would have called that recall a copy.
  assert.ok(
    understandingStatus({
      record: record(ownSteps),
      plan: [{ ...plan[0], copyReference: undefined }],
      files: files.slice(0, 1),
      required: true,
    }).missing.some((entry) => entry.part === "answer"),
  );
  assert.ok(
    missingFor("A POST that meets a 503 is retried too, which can create the same resource twice.").some(
      (entry) => entry.part === "answer",
    ),
  );
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

test("a Learn-by-hand plan ignores walkthrough credit, as it ignores explanations and attempts", () => {
  const files = [file("src/retry.ts", 80)];
  const walkthroughs = { "src/retry.ts": walkthrough("src/retry.ts@1", [{ name: "retry", startLine: 9, check: ["When does retry give up?", "After three."] }]) };
  const attempts = {
    "src/retry.ts": {
      fingerprint: "src/retry.ts@1",
      walkthroughs: { "retry:9": { answer: "it stops after three failures", confidence: "sure" as const, grade: "got" as const, at: "2026-10-20T00:00:00.000Z" } },
    },
  };
  assert.equal(planCheck({ files, walkthroughs, attempts, questions })[0].source, "attempt");
  const byHand = planCheck({ files, walkthroughs, attempts, questions, byHand: { reference: () => ({}), untested: {} } });
  assert.deepEqual([byHand[0].id, byHand[0].source, byHand[0].reference, byHand[0].copyReference], ["fallback:src/retry.ts", "fallback", undefined, ""]);
});
