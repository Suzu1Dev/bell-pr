import assert from "node:assert/strict";
import test from "node:test";
import type { StoredExplanation } from "../shared/explanations.js";
import { dropUnansweredExplanations } from "./premise-runs.js";
import type { Run } from "./types.js";

const card = (fingerprint: string): StoredExplanation => ({
  fingerprint,
  status: "ready",
  content: {
    summary: "s",
    reason: "r",
    concept: "c",
    tip: "t",
    example: { scenario: "s", before: "b", after: "a" },
    selfCheck: { question: "q", answer: "a" },
  },
});

test("a changed verdict remakes only the explanations the person has not answered from", () => {
  const run: Pick<Run, "explanations" | "attempts" | "understanding" | "practice"> = {
    explanations: {
      "quiz.ts": card("f1"),
      "road.ts": card("f2"),
      "check.ts": card("f3"),
      "practised.ts": card("f4"),
      "unread.ts": card("f5"),
      "older.ts": card("f6"),
    },
    attempts: {
      "quiz.ts": { fingerprint: "f1", quiz: { answer: "It retries.", at: "2026-10-19T00:00:00Z" } },
      "road.ts": { fingerprint: "f2", road: { choice: "keep", at: "2026-10-19T00:00:00Z" } },
      // An answer about an earlier version of the file answered another card.
      "older.ts": { fingerprint: "f0", quiz: { answer: "x", at: "2026-10-19T00:00:00Z" } },
    },
    understanding: {
      items: [
        {
          id: "selfCheck:check.ts",
          path: "check.ts",
          fingerprint: "f3",
          source: "selfCheck",
          question: "q",
          answer: "Because the last error is kept.",
          confidence: "sure",
          lockedAt: "2026-10-19T00:00:00Z",
        },
      ],
    },
    practice: { "selfCheck:practised.ts": { box: 1, dueAt: "2026-10-20T00:00:00Z" } },
  };
  dropUnansweredExplanations(run);
  // Their cards stay, so no new question takes the place of the one they answered.
  assert.deepEqual(Object.keys(run.explanations!).sort(), [
    "check.ts",
    "practised.ts",
    "quiz.ts",
    "road.ts",
  ]);

  const untouched: Pick<Run, "explanations"> = {};
  dropUnansweredExplanations(untouched);
  assert.equal(untouched.explanations, undefined);
});
