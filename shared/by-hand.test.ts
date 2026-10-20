import assert from "node:assert/strict";
import test from "node:test";
import {
  allHelpKinds,
  attemptSince,
  byHandClean,
  byHandPreflight,
  byHandSummary,
  helpAllowed,
  helpKindOf,
  helpKinds,
  needsWhy,
  nextRungAllowed,
  readyNow,
  repeatFailure,
  type ByHandRunFacts,
  type HelpLock,
  type HintState,
  type TestRun,
} from "./by-hand.js";
import { changeFingerprint } from "./understanding.js";

/** A Learn-by-hand run as createRun makes it: the guide, the reviewer and the test analyst, no tasks. */
function lbhRun(overrides: Partial<ByHandRunFacts> = {}): ByHandRunFacts {
  return {
    learnByHand: true,
    createdAt: "2026-10-20T00:00:00.000Z",
    agents: [{ id: "lead" }, { id: "reviewer" }, { id: "tester" }],
    team: { tasks: [] },
    ...overrides,
  };
}

test("byHandClean holds for a run whose history has only the guide, the reviewer and the test analyst", () => {
  assert.deepEqual(byHandClean(lbhRun()), { clean: true });
  // A sync round without resolutions merges the target branch; no agent wrote anything.
  assert.deepEqual(byHandClean(lbhRun({ followUps: [{ kind: "sync" }] })), { clean: true });
  assert.deepEqual(byHandClean(lbhRun({ byHand: { agentWrites: 0 } })), { clean: true });
});

test("byHandClean withdraws the claim for each of the five facts of an agent's work", () => {
  const cases: [string, ByHandRunFacts][] = [
    ["agent-writes", lbhRun({ byHand: { agentWrites: 1 } })],
    // Teammates are added with their owner id when an older build planned the run.
    ["agents", lbhRun({ agents: [{ id: "lead" }, { id: "member-1" }, { id: "reviewer" }, { id: "tester" }] })],
    ["tasks", lbhRun({ team: { tasks: [{ id: "task-1" }] } })],
    // An absent kind is a review round: an agent edited the change.
    ["rounds", lbhRun({ followUps: [{}] })],
    ["rounds", lbhRun({ followUps: [{ kind: "review" }] })],
    ["resolutions", lbhRun({ sync: { resolutions: [{ path: "a.ts" }] } })],
    ["resolutions", lbhRun({ followUps: [{ kind: "sync", resolutions: [] }] })],
  ];
  for (const [reason, run] of cases)
    assert.deepEqual(byHandClean(run), { clean: false, reason }, reason);
});

test("byHandClean stays withdrawn after a later sync cleared the conflict agent's resolutions", () => {
  // resolveConflicts pushed the `sync` card; a later sync deleted the resolutions, never the card.
  const run = lbhRun({ agents: [{ id: "lead" }, { id: "reviewer" }, { id: "tester" }, { id: "sync" }] });
  assert.deepEqual(byHandClean(run), { clean: false, reason: "agents" });
  // The round agent stays on the run the same way.
  assert.deepEqual(
    byHandClean(lbhRun({ agents: [{ id: "lead" }, { id: "followup" }] })),
    { clean: false, reason: "agents" },
  );
});

test("readyNow compares the ready fingerprint with the current change", () => {
  const files = [{ path: "src/a.ts", fingerprint: "a".repeat(64) }];
  const ready = { at: "2026-10-20T01:00:00.000Z", changeFingerprint: changeFingerprint(files), review: true };
  assert.equal(readyNow({ learnByHand: true, byHand: { ready } }, files), true);
  assert.equal(readyNow({ learnByHand: true, byHand: { ready } }, [{ path: "src/a.ts", fingerprint: "b".repeat(64) }]), false);
  assert.equal(readyNow({ byHand: { ready } }, files), false);
  assert.equal(readyNow({ learnByHand: true }, files), false);
});

test("helpKindOf follows the help table and helpKinds lists the kinds used, in order", () => {
  assert.equal(helpKindOf("premise"), "explain");
  assert.equal(helpKindOf("explanation"), "explain");
  assert.equal(helpKindOf("walkthrough"), "explain");
  assert.equal(helpKindOf("hint", 2), "explain");
  assert.equal(helpKindOf("ask"), "answer");
  assert.equal(helpKindOf("chat"), "answer");
  assert.equal(helpKindOf("hint", 1), "answer");
  assert.equal(helpKindOf("hint", 3), "plan");
  assert.equal(helpKindOf("hint", 4), "plan");
  assert.equal(helpKindOf("outline"), "plan");
  assert.equal(helpKindOf("plan"), "plan");
  assert.equal(helpKindOf("review"), "review");
  assert.equal(helpKindOf("test"), "test");
  assert.equal(helpKindOf("something-later"), undefined);
  const events = ["test", "answer", "explain", "answer", "later-kind"].map((kind) => ({
    at: "2026-10-20T01:00:00.000Z",
    kind,
    source: "ask",
  }));
  assert.deepEqual(helpKinds({ byHand: { events } }), ["explain", "answer", "test"]);
  assert.deepEqual(helpKinds({}), []);
  assert.deepEqual([...allHelpKinds], ["explain", "answer", "plan", "review", "test"]);
});

test("helpAllowed allows every kind without a lock, and only the locked kinds with one", () => {
  for (const kind of allHelpKinds) assert.equal(helpAllowed({}, kind), true, kind);
  const helpLock: HelpLock = {
    kinds: ["explain", "answer", "test"],
    at: "2026-10-20T00:00:00.000Z",
    rulesCheckedAt: "2026-10-19T00:00:00.000Z",
    rules: [],
  };
  assert.equal(helpAllowed({ byHand: { helpLock } }, "test"), true);
  assert.equal(helpAllowed({ byHand: { helpLock } }, "answer"), true);
  assert.equal(helpAllowed({ byHand: { helpLock } }, "plan"), false);
  assert.equal(helpAllowed({ byHand: { helpLock } }, "review"), false);
  assert.equal(helpAllowed({ byHand: { helpLock } }, undefined), false);
});

test("attemptSince needs a change, a test run or a new 'what I tried' of five words since the last hint", () => {
  const hint: HintState = { rung: 1, at: "2026-10-20T01:00:00.000Z", fingerprint: "0123456789abcdef", tried: "I added a log line" };
  const same = { fingerprint: "0123456789abcdef" };
  assert.equal(attemptSince(undefined, same), true);
  assert.equal(attemptSince(hint, same), false);
  assert.equal(attemptSince(hint, { fingerprint: "fedcba9876543210" }), true);
  assert.equal(attemptSince(hint, { ...same, tests: [{ at: "2026-10-20T02:00:00.000Z" }] }), true);
  // A run before the hint, or one the person only reported, is not an attempt BELL saw.
  assert.equal(attemptSince(hint, { ...same, tests: [{ at: "2026-10-20T00:30:00.000Z" }] }), false);
  assert.equal(attemptSince(hint, { ...same, tests: [{ at: "2026-10-20T02:00:00.000Z", reported: true }] }), false);
  assert.equal(attemptSince(hint, { ...same, tried: "moved the check" }), false);
  assert.equal(attemptSince(hint, { ...same, tried: "I moved the retry check before the loop" }), true);
  assert.equal(attemptSince(hint, { ...same, tried: "I added a log line." }), false);
  // The previous "what I tried" the caller passes wins over the one on the hint.
  assert.equal(attemptSince(hint, { ...same, tried: "I added a log line", previousTried: "something else entirely here" }), true);
  assert.equal(attemptSince(hint, { ...same, tried: "I printed the delay value", previousTried: "I printed the delay value" }), false);
  // One CJK character is one word.
  assert.equal(attemptSince(hint, { ...same, tried: "我把檢查移到迴圈前面" }), true);
});

test("nextRungAllowed climbs one rung at a time up to R4, and needsWhy follows R3", () => {
  assert.equal(nextRungAllowed(undefined, 1), true);
  assert.equal(nextRungAllowed(undefined, 2), false);
  const hint: HintState = { rung: 2, at: "2026-10-20T01:00:00.000Z", fingerprint: "0123456789abcdef" };
  assert.equal(nextRungAllowed(hint, 3), true);
  assert.equal(nextRungAllowed(hint, 1), true);
  assert.equal(nextRungAllowed(hint, 4), false);
  assert.equal(nextRungAllowed({ ...hint, rung: 4 }, 5), false);
  assert.equal(nextRungAllowed(hint, 0), false);
  assert.equal(nextRungAllowed(hint, 2.5), false);
  assert.equal(needsWhy({}), false);
  assert.equal(needsWhy({ maxRung: 2 }), false);
  assert.equal(needsWhy({ maxRung: 3 }), true);
  assert.equal(needsWhy({ maxRung: 4 }), true);
});

test("repeatFailure needs the same exit code and output three BELL runs in a row", () => {
  const run = (at: string, overrides: Partial<TestRun> = {}): TestRun => ({
    at,
    command: "npm test",
    changeFingerprint: "0123456789abcdef",
    outcome: "failed",
    exitCode: 1,
    ms: 1000,
    tailHash: "h1",
    ...overrides,
  });
  const three = [run("2026-10-20T01:00:00Z"), run("2026-10-20T02:00:00Z"), run("2026-10-20T03:00:00Z")];
  assert.equal(repeatFailure(three), true);
  assert.equal(repeatFailure(three.slice(1)), false);
  assert.equal(repeatFailure([...three, run("2026-10-20T04:00:00Z", { tailHash: "h2" })]), false);
  assert.equal(repeatFailure([...three.slice(0, 2), run("2026-10-20T03:00:00Z", { exitCode: 2 })]), false);
  assert.equal(repeatFailure(three.map((test) => ({ ...test, outcome: "passed", exitCode: 0 }))), false);
  // A result the person reported is not one of BELL's runs.
  assert.equal(repeatFailure([...three.slice(0, 2), run("2026-10-20T03:00:00Z", { reported: true })]), false);
  assert.equal(repeatFailure(undefined), false);
});

test("repeatFailure fires for a crash loop with no exit code, never for timeouts, stops or errors", () => {
  // A signal BELL did not send ends a run `failed` with no exit code (W2C).
  const run = (at: string, overrides: Partial<TestRun> = {}): TestRun => ({
    at,
    command: "npm test",
    changeFingerprint: "0123456789abcdef",
    outcome: "failed",
    ms: 1000,
    tailHash: "h1",
    ...overrides,
  });
  const crashes = [run("2026-10-20T01:00:00Z"), run("2026-10-20T02:00:00Z"), run("2026-10-20T03:00:00Z")];
  assert.equal(repeatFailure(crashes), true);
  assert.equal(repeatFailure([...crashes.slice(0, 2), run("2026-10-20T03:00:00Z", { exitCode: 1 })]), false);
  assert.equal(repeatFailure([...crashes.slice(0, 2), run("2026-10-20T03:00:00Z", { tailHash: "h2" })]), false);
  for (const outcome of ["timeout", "stopped", "error"]) {
    assert.equal(repeatFailure(crashes.map((test) => ({ ...test, outcome }))), false, outcome);
    assert.equal(repeatFailure(crashes.map((test) => ({ ...test, outcome, exitCode: 1 }))), false, outcome);
  }
});

test("byHandSummary counts help per request and only the first prediction after each change", () => {
  const entry = (kind: string, rung: number | undefined, stepId: string, removed = 0) => ({
    id: `${kind}-${stepId}-${rung}`,
    at: "2026-10-20T01:00:00.000Z",
    kind,
    stepId,
    ...(rung === undefined ? {} : { rung }),
    text: "Look at src/retry.ts:12.",
    ...(removed ? { removed } : {}),
  });
  const test = (at: string, fingerprint: string, prediction: string, outcome: string, extra: Partial<TestRun> = {}): TestRun => ({
    at,
    command: "npm test",
    changeFingerprint: fingerprint,
    outcome,
    ms: 10,
    prediction,
    ...extra,
  });
  const summary = byHandSummary({
    byHand: {
      plan: {
        steps: [
          { id: "s1", title: "Read the retry loop", maxRung: 1 },
          { id: "s2", title: "Add the backoff" },
        ],
        savedAt: "2026-10-20T00:10:00.000Z",
        outlineBeforeDraft: true,
      },
      thread: [
        entry("hint", 1, "s1"),
        entry("hint", 2, "s2"),
        entry("hint", 3, "s2", 2),
        entry("ask", undefined, "s1"),
      ],
      talks: [{ stepId: "s1", at: "2026-10-20T00:20:00.000Z" }],
      tests: [
        test("2026-10-20T02:00:00Z", "f1", "fail", "failed", { expect: "retries twice", outputTail: "not ok 3 - retries twice" }),
        // A re-run at the same version does not count again.
        test("2026-10-20T02:05:00Z", "f1", "pass", "failed"),
        test("2026-10-20T03:00:00Z", "f2", "pass", "passed"),
        test("2026-10-20T04:00:00Z", "f3", "unsure", "failed"),
        test("2026-10-20T05:00:00Z", "f4", "pass", "failed"),
      ],
      events: [
        { at: "2026-10-20T00:00:00Z", kind: "explain", source: "premise" },
        { at: "2026-10-20T01:00:00Z", kind: "answer", source: "hint", rung: 1 },
        { at: "2026-10-20T01:00:00Z", kind: "answer", source: "ask" },
      ],
      ready: { at: "2026-10-20T06:00:00Z", changeFingerprint: "f4", review: true },
      readyHistory: [{ at: "2026-10-20T05:30:00Z", changeFingerprint: "f3", review: true }],
      reviews: [
        { at: "2026-10-20T05:31:00Z", changeFingerprint: "f3", verified: "Fails 1 test.", checked: ["tests"], findings: [] },
        {
          at: "2026-10-20T06:01:00Z",
          changeFingerprint: "f4",
          verified: "Fails 1 test.",
          checked: ["tests"],
          findings: [
            { path: "src/retry.ts", observed: "x", evidence: { type: "test" }, why: "y", question: "z" },
          ],
        },
      ],
      removedTotal: 2,
      exits: [{ exit: "talk", at: "2026-10-20T00:20:00Z" }],
    },
  });
  assert.deepEqual(summary.helps, { explain: 1, answer: 2 });
  assert.equal(summary.hintRequests, 4);
  assert.equal(summary.lowRungRequests, 2);
  assert.deepEqual(summary.highestRungs, [
    { stepId: "s1", rung: 1 },
    { stepId: "s2", rung: 3 },
  ]);
  assert.deepEqual(summary.predictions, { judged: 3, right: 2, unsure: 1 });
  assert.equal(summary.namedTests, 1);
  assert.equal(summary.readyVersions, 2);
  assert.deepEqual(summary.reviewFindings, [0, 1]);
  assert.equal(summary.removedAnswers, 1);
  assert.equal(summary.removedTotal, 2);
  assert.equal(summary.outlineBeforeDraft, true);
  assert.equal(summary.exits, 1);
  assert.equal(summary.left, false);
  assert.equal(summary.fittedKinds, undefined);
  assert.deepEqual(byHandSummary({}).predictions, { judged: 0, right: 0, unsure: 0 });
});

test("byHandPreflight gives the respect checks' input only for a clean Learn-by-hand run", () => {
  const helpLock: HelpLock = {
    kinds: ["explain", "answer"],
    at: "2026-10-20T00:00:00.000Z",
    rulesCheckedAt: "2026-10-19T00:00:00.000Z",
    rules: [],
  };
  const events = [{ at: "2026-10-20T00:00:00Z", kind: "explain", source: "premise" }];
  const now = "2026-10-21T00:00:00.000Z";
  assert.deepEqual(byHandPreflight(lbhRun({ byHand: { events, helpLock } }), now, { createdAt: true }), {
    helps: ["explain"],
    helpLock,
    createdAt: "2026-10-20T00:00:00.000Z",
    now,
  });
  // Approval passes no createdAt: "rules read during this run" is asked where publishing is.
  assert.deepEqual(byHandPreflight(lbhRun({ byHand: { events } }), now), { helps: ["explain"], now });
  assert.equal(byHandPreflight(lbhRun({ byHand: { agentWrites: 1 } }), now), undefined);
  assert.equal(byHandPreflight({ ...lbhRun(), learnByHand: undefined }, now), undefined);
});
