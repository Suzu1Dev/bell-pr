import assert from "node:assert/strict";
import test from "node:test";
import type { LearnerNote, StoredExplanation } from "./explanations.js";
import { runDetailFields, summarizeRun } from "./runs.js";
import type { RunCore } from "./types.js";

const paths = [
  "src/client.ts",
  "src/retry.ts",
  "src/types.ts",
  "src/index.ts",
  "test/retry.test.ts",
  "test/client.test.ts",
  "README.md",
  "docs/retries.md",
];

/** A ready explanation with every card the explanation prompt asks for. */
function explanation(path: string): StoredExplanation {
  return {
    fingerprint: `sha256:${path}`,
    status: "ready",
    generatedAt: "2026-10-05T08:00:00.000Z",
    content: {
      summary: `${path} retries idempotent GET requests with exponential backoff and stops after the configured attempt limit.`,
      reason:
        "Temporary network failures made the client give up on the first error, so every caller wrapped it in its own loop. One policy in the client keeps the behaviour consistent and testable.",
      concept:
        "Exponential backoff\nEach failure doubles the wait before the next attempt, so a busy service gets time to recover instead of receiving a burst of retries. A cap keeps the wait bounded, and jitter spreads clients out so they do not retry in lockstep.",
      tip: "Write the test for the last allowed attempt first: off-by-one mistakes in retry limits are the most common bug in this kind of change.",
      example: {
        scenario: "The server answers 503 twice and then 200.",
        before: "The first 503 rejects the promise and the caller sees an error.",
        after: "The client waits 100 ms, then 200 ms, and resolves with the 200 response.",
      },
      alternatives:
        "A retry wrapper in each caller would avoid touching the client, but every call site would need its own limits and tests; prefer it only when a few calls need a different policy.",
      lookup: ["exponential backoff", "jitter", "idempotency"],
      selfCheck: {
        question: "Why are POST requests not retried?",
        answer: "They are not idempotent: a retry could create the resource twice.",
      },
    },
  };
}

function note(path: string): LearnerNote {
  return {
    text: `Check how ${path} behaves when the attempt limit is zero, and ask the maintainers whether the default delay should be configurable per request.`,
    fingerprint: `sha256:${path}`,
    updatedAt: "2026-10-05T09:00:00.000Z",
  };
}

const run: RunCore = {
  id: "8f6c2d1e-4b7a-4c3e-9f10-2a5b6c7d8e9f",
  repoId: "1d2c3b4a-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  title: "Retry idempotent GET requests with backoff",
  prompt: "Add a retry policy to the HTTP client for temporary failures.",
  status: "review",
  branch: "fix/8f6c2d1e",
  baseBranch: "main",
  createdAt: "2026-10-05T07:00:00.000Z",
  agents: [
    { id: "lead", name: "Atlas", role: "Team lead", status: "complete", detail: "Planned and integrated the work." },
  ],
  logs: [],
  draft: { title: "Retry idempotent GET requests with backoff", body: "" },
  reviewedFiles: ["src/client.ts"],
  reports: {},
  explanations: Object.fromEntries(paths.map((path) => [path, explanation(path)])),
  notes: Object.fromEntries(paths.map((path) => [path, note(path)])),
};

test("the run list leaves out explanations and notes, and the JSON shrinks by half or more", () => {
  const summary = summarizeRun(run) as Record<string, unknown>;
  assert.equal("explanations" in summary, false);
  assert.equal("notes" in summary, false);
  const full = JSON.stringify(run).length;
  const listed = JSON.stringify(summary).length;
  assert.ok(
    listed <= full / 2,
    `the summary is ${listed} of ${full} characters (${Math.round((listed / full) * 100)} %)`,
  );
});

test("the summary keeps what the lists show and leaves the run unchanged", () => {
  const before = structuredClone(run);
  const summary = summarizeRun(run);
  assert.deepEqual(run, before);
  assert.equal(summary.id, run.id);
  assert.equal(summary.title, run.title);
  assert.equal(summary.status, run.status);
  assert.equal(summary.branch, run.branch);
  assert.equal(summary.repoId, run.repoId);
  assert.deepEqual(summary.draft, run.draft);
  assert.deepEqual(summary.reviewedFiles, run.reviewedFiles);
});

test("every detail field is left out", () => {
  const detailed = {
    ...run,
    ...Object.fromEntries(runDetailFields.map((field) => [field, { large: true }])),
  };
  const summary = summarizeRun(detailed) as Record<string, unknown>;
  for (const field of runDetailFields)
    assert.equal(field in summary, false, field);
  assert.deepEqual(
    [...runDetailFields].sort(),
    [
      "attempts",
      "byHand",
      "contributionFacts",
      "conversations",
      "draftPreparation",
      "explanations",
      "feedbackTags",
      "followUps",
      "guardOverrides",
      "logs",
      "notes",
      "prFeedback",
      "practice",
      "reports",
      "reviewability",
      "sync",
      "understanding",
      "walkthroughs",
    ],
  );
});

test("the list keeps the understanding-check-off mark, which its badge needs", () => {
  const summary = summarizeRun({ ...run, understandingCheckOff: true });
  assert.equal(summary.understandingCheckOff, true);
});

test("the list keeps the Learn-by-hand mark, which its chip needs, and leaves the record out", () => {
  const summary = summarizeRun({ ...run, learnByHand: true, byHand: { agentWrites: 0 } });
  assert.equal(summary.learnByHand, true);
  assert.equal("byHand" in summary, false);
});
