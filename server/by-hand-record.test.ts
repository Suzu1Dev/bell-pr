// The help events of a Learn-by-hand run (server/by-hand-record.ts): the
// kind from the source, the model and CLI from the run, at most 300 kept,
// and the backstop of a fitted run's help set.
import test from "node:test";
import assert from "node:assert/strict";
import { helpKinds, type HelpLock } from "../shared/by-hand.js";
import { assertHelpAllowed, recordHelp } from "./by-hand-record.js";
import { withLocale } from "./i18n/index.js";
import { AppError, type Run } from "./types.js";

function lbhRun(helpLock?: HelpLock): Run {
  return {
    id: "record-run",
    repoId: "repo",
    title: "Retry twice",
    prompt: "Retry a GET twice after a 503.",
    status: "review",
    branch: "main",
    baseBranch: "main",
    baseSha: "a".repeat(40),
    worktreePath: "/nonexistent",
    createdAt: "2026-10-20T00:00:00.000Z",
    locale: "en",
    learnByHand: true,
    modelExecution: {
      provider: "claude",
      model: "sonnet",
      source: "selected",
      reported: { model: "claude-sonnet-4-5-20250929", cliVersion: "2.1.292" },
    },
    agents: [],
    logs: [],
    draft: { title: "Retry twice", body: "" },
    reviewedFiles: [],
    reviewedFingerprints: {},
    ...(helpLock ? { byHand: { helpLock } } : {}),
  };
}

const lock: HelpLock = {
  kinds: ["explain", "answer", "test"],
  at: "2026-10-20T00:00:00.000Z",
  rulesCheckedAt: "2026-10-19T00:00:00.000Z",
  rules: [],
};

test("recordHelp records the kind, the model the CLI reported and the CLI, newest 300 kept", () => {
  const run = lbhRun();
  const event = recordHelp(run, { source: "hint", rung: 3, stepId: "s1", removed: 2, at: "2026-10-20T01:00:00.000Z" });
  assert.deepEqual(event, {
    at: "2026-10-20T01:00:00.000Z",
    kind: "plan",
    source: "hint",
    rung: 3,
    stepId: "s1",
    model: "claude-sonnet-4-5-20250929",
    cli: "claude 2.1.292",
    removed: 2,
  });
  assert.deepEqual(run.byHand?.events, [event]);
  // Codex reports no model: the one requested is recorded; none when the CLI default ran.
  run.modelExecution = { provider: "codex", source: "cli-default" };
  assert.deepEqual(recordHelp(run, { source: "premise", at: "2026-10-20T00:01:00.000Z" }), {
    at: "2026-10-20T00:01:00.000Z",
    kind: "explain",
    source: "premise",
    cli: "codex",
  });
  for (let index = 0; index < 305; index++) recordHelp(run, { source: "ask", at: `2026-10-20T02:00:${String(index % 60).padStart(2, "0")}.000Z` });
  assert.equal(run.byHand?.events?.length, 300);
  // The oldest answers went; the only plan and explain events stay, so the record keeps every kind used.
  assert.deepEqual(run.byHand?.events?.slice(0, 3).map((event) => event.source), ["hint", "premise", "ask"]);
  assert.deepEqual(helpKinds(run), ["explain", "answer", "plan"]);
});

test("in a fitted run recordHelp records nothing outside the help set and refuses with 409", () => {
  const run = lbhRun(lock);
  assert.equal(recordHelp(run, { source: "test" }).kind, "test");
  assert.equal(recordHelp(run, { source: "hint", rung: 2 }).kind, "explain");
  for (const [source, rung, kind] of [
    ["hint", 3, "help with planning"],
    ["outline", undefined, "help with planning"],
    ["review", undefined, "reviews"],
  ] as const)
    assert.throws(
      () => withLocale("en", () => recordHelp(run, { source, rung })),
      (error: AppError) =>
        error.statusCode === 409 &&
        error.message === `Not offered in this run: the project's text it is fitted to doesn't name ${kind}.`,
    );
  assert.deepEqual(run.byHand?.events?.map((event) => event.kind), ["test", "explain"]);
  // The same check, for a route before it starts a turn; a run without a lock allows every kind.
  assert.throws(() => assertHelpAllowed(run, "review"), (error: AppError) => error.statusCode === 409);
  assert.doesNotThrow(() => assertHelpAllowed(lbhRun(), "review"));
});
