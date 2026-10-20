import test from "node:test";
import assert from "node:assert/strict";
import {
  interleave,
  ladderDays,
  learningCounts,
  nextPractice,
  practiceKey,
  type CountedRun,
} from "./practice.js";
import type { UnderstandingItem } from "./understanding.js";

const now = "2026-10-15T00:00:00.000Z";
const days = (iso: string) => (Date.parse(iso) - Date.parse(now)) / 86_400_000;

test("the ladder is 1, 3, 7 and 21 days: a first Got it comes back in 3 days, a miss in 1", () => {
  assert.deepEqual([...ladderDays], [1, 3, 7, 21]);
  const first = nextPractice(undefined, "got", now, "sure");
  assert.deepEqual(first, { box: 1, dueAt: "2026-10-18T00:00:00.000Z", lastAt: now, lastGrade: "got", lastConfidence: "sure" });
  assert.equal(days(nextPractice({ box: 1 }, "got", now).dueAt), 7);
  assert.equal(days(nextPractice({ box: 2 }, "got", now).dueAt), 21);
  // Box 4 is the top: it stays there, 21 days apart.
  const top = nextPractice({ box: 3 }, "got", now);
  assert.equal(top.box, 4);
  assert.equal(days(top.dueAt), 21);
  assert.deepEqual([nextPractice({ box: 4 }, "got", now).box, days(nextPractice({ box: 4 }, "got", now).dueAt)], [4, 21]);
  // Partly keeps the box; a miss always resets to 1 day.
  assert.deepEqual([nextPractice({ box: 2 }, "partly", now).box, days(nextPractice({ box: 2 }, "partly", now).dueAt)], [2, 7]);
  for (const box of [0, 1, 2, 3, 4]) {
    const missed = nextPractice({ box }, "missed", now);
    assert.deepEqual([missed.box, days(missed.dueAt)], [0, 1]);
  }
  // A damaged box from a file is read within range.
  assert.equal(nextPractice({ box: 99 }, "got", now).box, 4);
  assert.equal(nextPractice({ box: -3 }, "partly", now).box, 0);
  assert.equal(practiceKey("check", "selfCheck:src/a.ts"), "check:selfCheck:src/a.ts");
});

test("a session interleaves repositories and taste dimensions round-robin", () => {
  const items = [
    { key: "a1", repoId: "a", dimension: "tests" as const },
    { key: "a2", repoId: "a", dimension: "tests" as const },
    { key: "a3", repoId: "a", dimension: "naming" as const },
    { key: "b1", repoId: "b", dimension: "tests" as const },
    { key: "b2", repoId: "b" },
  ];
  assert.deepEqual(interleave(items).map((item) => item.key), ["a1", "a3", "b1", "b2", "a2"]);
  assert.deepEqual(interleave([]), []);
});

const answer = (grade: UnderstandingItem["grade"], confidence: UnderstandingItem["confidence"], extra: Partial<UnderstandingItem> = {}): UnderstandingItem => ({
  id: `selfCheck:${Math.random()}`,
  source: "selfCheck",
  question: "Q?",
  answer: "an answer here",
  confidence,
  lockedAt: now,
  grade,
  ...extra,
});

test("the plain counts read every run, including runs with no explanation or note", () => {
  const runs: CountedRun[] = [
    // No explanations, no notes: it still counts.
    {
      status: "published",
      createdAt: "2026-10-01T00:00:00.000Z",
      understanding: {
        items: [
          answer("got", "sure"),
          answer("missed", "sure"),
          answer(undefined, "think", { id: "untested", source: "untested" }),
          answer(undefined, "guess", { answer: "", dontKnow: true }),
        ],
        history: [{ passedAt: "2026-10-01T01:00:00.000Z", questions: 3, misses: 2, confidentMisses: 1, seconds: 200 }],
      },
      feedbackTags: {
        "#c1": { dimension: "tests", predicted: true, at: now },
        "#c2": { dimension: "naming", predicted: false, lesson: "Name the unit.", at: now },
      },
    },
    { status: "approved", createdAt: "2026-10-02T00:00:00.000Z", understandingCheckOff: true },
    { status: "review", createdAt: "2026-10-03T00:00:00.000Z" },
    {
      status: "published",
      createdAt: "2026-10-04T00:00:00.000Z",
      understanding: { items: [answer("got", "think"), answer("partly", "think")] },
      feedbackTags: { "#c3": { dimension: "tests", at: now }, "#c4": { at: now } },
    },
  ];
  const counts = learningCounts(runs);
  assert.deepEqual(counts, {
    runs: 4,
    approved: 3,
    explainedBack: 1,
    checkOff: 1,
    graded: 5,
    byConfidence: {
      sure: { graded: 2, got: 1 },
      think: { graded: 2, got: 1 },
      guess: { graded: 1, got: 0 },
    },
    forecastHits: { hits: 1, of: 2 },
    feedback: {
      tagged: 3,
      prs: 2,
      dimensions: [
        { dimension: "tests", prs: 2 },
        { dimension: "naming", prs: 1 },
      ],
    },
    checkSeconds: { timed: 1, median: 200 },
  });
});

test("the median check time uses only the last 10 timed checks", () => {
  const history = Array.from({ length: 13 }, (_, index) => ({
    passedAt: new Date(Date.parse(now) + index * 60_000).toISOString(),
    questions: 1,
    misses: 0,
    confidentMisses: 0,
    // The 3 oldest took far longer; the last 10 took 100 to 190 s.
    seconds: index < 3 ? 5000 : 100 + (index - 3) * 10,
  }));
  const counts = learningCounts([
    { status: "approved", createdAt: now, understanding: { history: [...history.slice(0, 6), { passedAt: now, questions: 1, misses: 0, confidentMisses: 0 }] } },
    { status: "approved", createdAt: now, understanding: { history: history.slice(6) } },
  ]);
  assert.deepEqual(counts.checkSeconds, { timed: 13, median: 145 });
  assert.deepEqual(learningCounts([]).checkSeconds, { timed: 0 });
});
