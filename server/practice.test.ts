// The practice deck built from a person's records: which items exist,
// their order and interleaving, the 1-3-7-21 day ladder, and that only
// grades are stored. Pure functions on in-memory runs; no CLI, no network.
import test from "node:test";
import assert from "node:assert/strict";
import { withLocale } from "./i18n/index.js";
import {
  capPractice,
  dueItems,
  practiceCandidates,
  practiceKeysPerRun,
  recordPracticeAnswer,
} from "./practice.js";
import { AppError, type Repository, type Run } from "./types.js";
import type { StoredExplanation } from "../shared/explanations.js";
import type { UnderstandingItem } from "../shared/understanding.js";
import { assertNoHan } from "../src/test-utils/render.js";

const now = "2026-10-15T12:00:00.000Z";
const day = 24 * 60 * 60 * 1000;
const later = (days: number) => new Date(Date.parse(now) + days * day).toISOString();
const fingerprint = (path: string) => `${path}@1`;

function explanation(path: string): StoredExplanation {
  return {
    fingerprint: fingerprint(path),
    status: "ready",
    generatedAt: "2026-10-10T00:00:00.000Z",
    content: {
      summary: `Summary of ${path}.`,
      reason: `Reason for ${path}.`,
      concept: "Concept",
      tip: "Tip",
      example: { scenario: "s", before: "b", after: "a" },
      selfCheck: { question: `What does ${path} change?`, answer: `The answer for ${path}.` },
    },
  };
}

function item(
  path: string,
  fields: Partial<UnderstandingItem> & Pick<UnderstandingItem, "confidence">,
): UnderstandingItem {
  return {
    id: `selfCheck:${path}`,
    path,
    fingerprint: fingerprint(path),
    source: "selfCheck",
    question: `What does ${path} change?`,
    answer: "My own answer to it.",
    lockedAt: "2026-10-11T00:00:00.000Z",
    gradedAt: "2026-10-11T00:01:00.000Z",
    ...fields,
  };
}

function run(fields: Partial<Run> & Pick<Run, "id" | "repoId">): Run {
  return {
    title: `Run ${fields.id}`,
    prompt: "Do it.",
    status: "published",
    branch: "fix/x",
    baseBranch: "main",
    baseSha: "",
    worktreePath: `/data/worktrees/${fields.id}`,
    createdAt: "2026-10-10T00:00:00.000Z",
    agents: [],
    logs: [],
    draft: { title: "t", body: "b" },
    reviewedFiles: [],
    reviewedFingerprints: {},
    ...fields,
  };
}

const prUrl = "https://github.com/acme/widgets/pull/3";
const comment = (id: number, path?: string) => ({
  kind: path ? ("thread" as const) : ("review" as const),
  author: "maintainer",
  authorAssociation: "MEMBER",
  body: `Maintainer comment ${id}.`,
  ...(path ? { path } : {}),
  url: `${prUrl}#discussion_r${id}`,
  createdAt: "2026-10-12T00:00:00Z",
});

/** Two projects: a published run with every kind of record, and a run still in review. */
function records() {
  const published = run({
    id: "published",
    repoId: "repo-a",
    title: "Retry failed requests",
    prUrl,
    createdAt: "2026-10-10T00:00:00.000Z",
    explanations: Object.fromEntries(
      ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts", "src/f.ts"].map(
        (path) => [path, explanation(path)],
      ),
    ),
    understanding: {
      items: [
        // A confident miss, with the person's correction.
        item("src/a.ts", { confidence: "sure", grade: "missed", correction: "The delay doubles, it does not add." }),
        // A fallback question missed while guessing.
        item("src/b.ts", {
          id: "fallback:src/b.ts",
          source: "fallback",
          question: "In one sentence, what does the change to src/b.ts do, and why?",
          confidence: "guess",
          grade: "partly",
          correction: "It also logs the retry.",
        }),
        // Got it: nothing to practise.
        item("src/c.ts", { confidence: "think", grade: "got" }),
        // "I don't know" counts as missed.
        { id: "untested", source: "untested", question: "What did you not test, and why?", answer: "The network.", confidence: "sure", lockedAt: "2026-10-11T00:00:00.000Z" },
      ],
    },
    attempts: {
      // A quiz missed at "Think so": a confident miss.
      "src/d.ts": { fingerprint: fingerprint("src/d.ts"), quiz: { answer: "Some guess here.", confidence: "think", grade: "missed", at: "2026-10-10T10:00:00.000Z" } },
      // Skipped: the self-check was never attempted.
      "src/e.ts": { fingerprint: fingerprint("src/e.ts"), quiz: { skipped: true, at: "2026-10-10T10:00:00.000Z" } },
    },
    prFeedback: {
      fetchedAt: "2026-10-12T00:00:00.000Z",
      prNumber: 3,
      items: [comment(1, "src/a.ts"), comment(2), comment(3)],
    },
    feedbackTags: {
      [comment(1, "src/a.ts").url]: { dimension: "tests", predicted: false, lesson: "Test the last attempt.", at: "2026-10-12T01:00:00.000Z" },
      [comment(2).url]: { dimension: "naming", predicted: true, at: "2026-10-12T01:00:00.000Z" },
      // Surprised, but no lesson written yet.
      [comment(3).url]: { predicted: false, at: "2026-10-12T01:00:00.000Z" },
    },
  });
  const inReview = run({
    id: "in-review",
    repoId: "repo-b",
    status: "review",
    createdAt: "2026-10-13T00:00:00.000Z",
    explanations: { "lib/x.py": explanation("lib/x.py"), "lib/y.py": explanation("lib/y.py") },
    attempts: {
      "lib/x.py": { fingerprint: fingerprint("lib/x.py"), quiz: { answer: "A guess of mine.", confidence: "guess", grade: "partly", at: "2026-10-13T01:00:00.000Z" } },
    },
  });
  const repos: Repository[] = [
    {
      id: "repo-a",
      name: "widgets",
      owner: "acme",
      fullName: "acme/widgets",
      path: "/data/repos/widgets",
      defaultBranch: "main",
      url: "https://github.com/acme/widgets",
      debriefs: [
        {
          at: "2026-10-14T00:00:00.000Z",
          locale: "en",
          runIds: ["published"],
          recurring: { dimension: "tests", quotes: ["Maintainer comment 1."] },
          drills: [
            { context: "How retries wait.", optionA: "A fixed second.", optionB: "A doubling ceiling.", question: "Which fits this project, and why?", reveal: "The doubling ceiling spreads retries." },
          ],
          nextStep: "Write the last-attempt test first.",
        },
      ],
    },
  ];
  return { runs: [published, inReview], repos };
}

test("the deck holds misses, surprising comments with a lesson, unattempted self-checks and drills", () => {
  const { runs, repos } = records();
  const candidates = withLocale("en", () => practiceCandidates(runs, repos, now));
  const byKey = new Map(candidates.map((candidate) => [candidate.item.key, candidate.item]));
  assert.deepEqual([...byKey.keys()].sort(), [
    "check:fallback:src/b.ts",
    "check:selfCheck:src/a.ts",
    `drill:2026-10-14T00:00:00.000Z:0`,
    `feedback:${prUrl}#discussion_r1`,
    "quiz:lib/x.py",
    "quiz:src/d.ts",
    // Neither asked in the check nor attempted (src/e.ts was skipped, and
    // src/b.ts was asked the fallback question before its card was ready);
    // the run in review has no self-check items yet.
    "selfCheck:src/b.ts",
    "selfCheck:src/e.ts",
    "selfCheck:src/f.ts",
  ]);
  const confident = byKey.get("check:selfCheck:src/a.ts")!;
  assert.equal(confident.reference, "The answer for src/a.ts.");
  assert.equal(confident.earlier, "The delay doubles, it does not add.");
  assert.deepEqual([confident.lastGrade, confident.lastConfidence], ["missed", "sure"]);
  // A fallback question compares with the card's summary and reason, as the check did.
  assert.equal(byKey.get("check:fallback:src/b.ts")!.reference, "Summary of src/b.ts.\n\nReason for src/b.ts.");
  const quiz = byKey.get("quiz:src/d.ts")!;
  assert.deepEqual([quiz.question, quiz.reference], ["What does src/d.ts change?", "The answer for src/d.ts."]);
  const surprise = byKey.get(`feedback:${prUrl}#discussion_r1`)!;
  assert.equal(
    surprise.question,
    'A maintainer commented on src/a.ts in "Retry failed requests". What did they ask for, and what will you do differently next time?',
  );
  assert.deepEqual(
    [surprise.reference, surprise.earlier, surprise.dimension, surprise.path],
    ["Maintainer comment 1.", "Test the last attempt.", "tests", "src/a.ts"],
  );
  const drill = byKey.get("drill:2026-10-14T00:00:00.000Z:0")!;
  assert.equal(drill.runId, "published");
  assert.equal(
    drill.question,
    "How retries wait.\n\nA: A fixed second.\n\nB: A doubling ceiling.\n\nWhich fits this project, and why?",
  );
  assert.equal(drill.reference, "The doubling ceiling spreads retries.");
  for (const entry of byKey.values()) {
    assert.equal(entry.codeAvailable, true);
    assertNoHan(entry.question);
  }
  // A run whose working files were cleaned up keeps its cards; the code is gone.
  runs[0].workspaceRemovedAt = "2026-10-14T00:00:00.000Z";
  assert.ok(
    practiceCandidates(runs, repos, now)
      .filter((candidate) => candidate.item.runId === "published")
      .every((candidate) => candidate.item.codeAvailable === false),
  );
});

test("a session takes the most useful due items first, interleaved across projects and dimensions, at most 5", () => {
  const { runs, repos } = records();
  const session = withLocale("en", () => dueItems(runs, repos, now));
  assert.deepEqual(
    session.items.map((entry) => entry.key),
    [
      // The five most useful: the confident misses (the longest waiting
      // first), the surprising comment, then the other misses of both
      // projects; the self-checks and the drill wait for a later session.
      // Shown interleaved: project A, its Tests comment, project B, then A.
      "quiz:src/d.ts",
      `feedback:${prUrl}#discussion_r1`,
      "quiz:lib/x.py",
      "check:selfCheck:src/a.ts",
      "check:fallback:src/b.ts",
    ],
  );
  assert.equal(session.nextDueAt, undefined);
  // Scheduled items wait for their day; the earliest one is announced.
  runs[0].practice = {
    "check:selfCheck:src/a.ts": { box: 1, dueAt: later(3), lastAt: now, lastGrade: "got" },
    "quiz:src/d.ts": { box: 0, dueAt: later(1), lastAt: now, lastGrade: "missed" },
    // Due already: it stays in the session.
    "selfCheck:src/e.ts": { box: 2, dueAt: later(-1), lastAt: later(-8), lastGrade: "got" },
  };
  const next = withLocale("en", () => dueItems(runs, repos, now));
  assert.ok(!next.items.some((entry) => ["check:selfCheck:src/a.ts", "quiz:src/d.ts"].includes(entry.key)));
  assert.equal(next.nextDueAt, later(1));
  assert.equal(next.items.length, 5);
  // A session later in time has them due again.
  const afterwards = withLocale("en", () => dueItems(runs, repos, later(4)));
  assert.ok(afterwards.items.some((entry) => entry.key === "check:selfCheck:src/a.ts"));
  // Nothing recorded: nothing to practise and nothing waiting.
  assert.deepEqual(dueItems([], [], now), { items: [] });
});

test("an answer moves the item along the 1, 3, 7 and 21 day ladder, and a miss resets it to 1 day", () => {
  const { runs, repos } = records();
  const target = runs[0];
  const record = (grade: "got" | "partly" | "missed", at: string) =>
    recordPracticeAnswer(
      target,
      practiceCandidates(runs, repos, at),
      { key: "check:selfCheck:src/a.ts", confidence: "think", grade },
      at,
    );
  const days = (state: { dueAt: string }, from: string) =>
    (Date.parse(state.dueAt) - Date.parse(from)) / day;
  const steps: [grade: "got" | "partly" | "missed", box: number, wait: number][] = [
    ["missed", 0, 1],
    ["got", 1, 3],
    ["got", 2, 7],
    ["partly", 2, 7],
    ["got", 3, 21],
    ["got", 4, 21],
    ["missed", 0, 1],
  ];
  let at = now;
  for (const [grade, box, wait] of steps) {
    const state = record(grade, at);
    assert.deepEqual([state.box, days(state, at)], [box, wait], `${grade} at ${at}`);
    assert.deepEqual(Object.keys(state).sort(), ["box", "dueAt", "lastAt", "lastConfidence", "lastGrade"]);
    at = state.dueAt;
  }
  // Only items of this run can be recorded on it.
  assert.throws(
    () =>
      recordPracticeAnswer(target, practiceCandidates(runs, repos, now), { key: "quiz:lib/x.py", confidence: "sure", grade: "got" }, now),
    (error: AppError) => error.statusCode === 404,
  );
  assert.throws(
    () =>
      recordPracticeAnswer(target, practiceCandidates(runs, repos, now), { key: "check:selfCheck:src/c.ts", confidence: "sure", grade: "got" }, now),
    (error: AppError) => error.statusCode === 404,
  );
});

test("a run keeps at most 40 schedules: gone items first, then the ones practised longest ago", () => {
  const { runs, repos } = records();
  const target = runs[0];
  target.practice = Object.fromEntries(
    Array.from({ length: practiceKeysPerRun + 3 }, (_, index) => [
      `check:gone-${index}`,
      { box: 1, dueAt: later(1), lastAt: later(-index) },
    ]),
  );
  target.practice["selfCheck:src/f.ts"] = { box: 1, dueAt: later(1), lastAt: later(-100) };
  recordPracticeAnswer(target, practiceCandidates(runs, repos, now), { key: "quiz:src/d.ts", confidence: "sure", grade: "got" }, now);
  const keys = Object.keys(target.practice);
  assert.equal(keys.length, practiceKeysPerRun);
  // The live items stay even when they are the oldest; the oldest gone ones went.
  assert.ok(keys.includes("selfCheck:src/f.ts") && keys.includes("quiz:src/d.ts"));
  for (const gone of [42, 41, 40, 39, 38]) assert.ok(!keys.includes(`check:gone-${gone}`), String(gone));
  assert.ok(keys.includes("check:gone-0"));
  // Under the limit nothing goes.
  const small = run({ id: "small", repoId: "repo-a", practice: { "check:x": { box: 0, dueAt: now } } });
  capPractice(small, new Set());
  assert.deepEqual(Object.keys(small.practice!), ["check:x"]);
});

test("values a later build stored and this build does not know are ignored, not shown", () => {
  const { runs, repos } = records();
  const target = runs[0];
  // Read leniently from state.json: vocabularies are plain text there.
  const loose = target as unknown as {
    feedbackTags: Record<string, { dimension?: string }>;
    practice: Record<string, { box: number; dueAt: string; lastGrade?: string; lastConfidence?: string }>;
  };
  loose.feedbackTags[`${prUrl}#discussion_r1`].dimension = "vibes";
  loose.practice = {
    "check:selfCheck:src/a.ts": { box: 2, dueAt: later(-1), lastGrade: "perfect", lastConfidence: "certain" },
    // A schedule without a readable time counts as never scheduled.
    "quiz:src/d.ts": { box: 1, dueAt: "soon" },
  };
  const items = new Map(practiceCandidates(runs, repos, now).map((candidate) => [candidate.item.key, candidate.item]));
  assert.equal(items.get(`feedback:${prUrl}#discussion_r1`)!.dimension, undefined);
  const check = items.get("check:selfCheck:src/a.ts")!;
  // The schedule's unknown grade and confidence fall back to the check's own.
  assert.deepEqual([check.lastGrade, check.lastConfidence], ["missed", "sure"]);
  assert.equal(items.get("quiz:src/d.ts")!.dueAt <= now, true);
});

test("in Chinese the questions BELL writes follow the request's locale", () => {
  const { runs, repos } = records();
  const items = withLocale("zh-TW", () => practiceCandidates(runs, repos, now));
  const surprise = items.find((candidate) => candidate.item.kind === "feedback")!.item;
  assert.equal(
    surprise.question,
    "維護者在「Retry failed requests」對 src/a.ts 留了言。他們要求什麼？下次你會怎麼做？",
  );
  const drill = items.find((candidate) => candidate.item.kind === "drill")!.item;
  assert.match(drill.question, /\n\nA：A fixed second\.\n\nB：A doubling ceiling\.\n\n/);
});
