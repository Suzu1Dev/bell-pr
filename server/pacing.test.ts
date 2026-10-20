// The person's pace in one repository from one aliased GraphQL answer, and
// what the respect checks make of it: a confirm at the budget, a block at
// twice it, nothing for people with write access. Canned answers; no gh.
import test from "node:test";
import assert from "node:assert/strict";
import { draftPreflight } from "../shared/draft-checks.js";
import type { PacingFacts } from "../shared/contribution.js";
import { FactError } from "./issue-check.js";
import { pacingQuery, pacingSearches, readPacing, readViewerLogin } from "./pacing.js";

const now = Date.parse("2026-10-15T12:00:00Z");
const repository = { owner: "acme", name: "widgets", fullName: "acme/widgets" };

const answer = (counts: { open: number; merged: number; waiting?: string[]; permission?: string | null }) => ({
  data: {
    repository: { viewerPermission: counts.permission === undefined ? "READ" : counts.permission },
    open: { issueCount: counts.open },
    merged: { issueCount: counts.merged },
    waiting: {
      issueCount: counts.waiting?.length ?? 0,
      nodes: (counts.waiting ?? []).map((url) => ({ url })),
    },
  },
});

test("one aliased call counts open, merged and waiting pull requests by the person", async () => {
  const calls: string[][] = [];
  const read = await readPacing(
    async (args) => {
      calls.push(args);
      return answer({ open: 1, merged: 0, waiting: ["https://github.com/acme/widgets/pull/7", "https://github.com/evil/other/pull/1"] });
    },
    repository,
    "learner",
    now,
  );
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes("open=repo:acme/widgets is:pr author:learner is:open"));
  assert.ok(calls[0].includes("merged=repo:acme/widgets is:pr author:learner is:merged"));
  assert.ok(
    calls[0].includes("waiting=repo:acme/widgets is:pr author:learner is:open review:changes_requested updated:<2026-10-08"),
  );
  for (const alias of ["open: search(", "merged: search(", "waiting: search(", "viewerPermission"])
    assert.ok(pacingQuery.includes(alias), alias);
  // Only this repository's pull requests are linked, on the run's facts too.
  assert.deepEqual(read.facts, {
    openPrs: 1,
    mergedPrs: 0,
    waitingPrs: 2,
    waitingUrls: ["https://github.com/acme/widgets/pull/7"],
    viewerPermission: "READ",
  });
  assert.equal(read.budget, 1);
  assert.equal(read.writeAccess, false);
  assert.deepEqual(read.waiting, ["https://github.com/acme/widgets/pull/7"]);
});

test("the budget is 1 before a merged pull request here and 2 after; write access is exempt", async () => {
  const read = (counts: Parameters<typeof answer>[0]) => readPacing(async () => answer(counts), repository, "learner", now);
  assert.equal((await read({ open: 0, merged: 3 })).budget, 2);
  for (const permission of ["WRITE", "MAINTAIN", "ADMIN"])
    assert.equal((await read({ open: 9, merged: 0, permission })).writeAccess, true, permission);
  assert.equal((await read({ open: 9, merged: 0, permission: "TRIAGE" })).writeAccess, false);
  assert.equal("viewerPermission" in (await read({ open: 0, merged: 0, permission: null })).facts, false);
});

const pacingChecks = (pacing: PacingFacts) =>
  draftPreflight({ body: "Fixes it.", facts: { checkedAt: "2026-10-15T00:00:00.000Z", pacing } })
    .filter((check) => check.id === "pacing" || check.id === "pacing-max")
    .map((check) => [check.id, check.kind]);

test("pacing at the budget asks to confirm, at twice the budget blocks, and never applies with write access", async () => {
  const facts = async (counts: Parameters<typeof answer>[0]) =>
    (await readPacing(async () => answer(counts), repository, "learner", now)).facts;
  assert.deepEqual(pacingChecks(await facts({ open: 0, merged: 0 })), []);
  // A first-time contributor here: budget 1.
  assert.deepEqual(pacingChecks(await facts({ open: 1, merged: 0 })), [["pacing", "confirm"]]);
  assert.deepEqual(pacingChecks(await facts({ open: 2, merged: 0 })), [["pacing-max", "block"]]);
  // After a merged pull request: budget 2.
  assert.deepEqual(pacingChecks(await facts({ open: 1, merged: 1 })), []);
  assert.deepEqual(pacingChecks(await facts({ open: 2, merged: 1 })), [["pacing", "confirm"]]);
  assert.deepEqual(pacingChecks(await facts({ open: 4, merged: 1 })), [["pacing-max", "block"]]);
  // A maintainer waiting on the person is a confirm too.
  assert.deepEqual(
    pacingChecks(await facts({ open: 0, merged: 1, waiting: ["https://github.com/acme/widgets/pull/7"] })),
    [["pacing", "confirm"]],
  );
  // WRITE, MAINTAIN and ADMIN are exempt, however many are open.
  assert.deepEqual(pacingChecks(await facts({ open: 9, merged: 0, permission: "WRITE" })), []);
});

test("unreadable counts and logins are failures, never zero", async () => {
  await assert.rejects(
    readPacing(async () => ({ data: { open: {}, merged: { issueCount: 0 }, waiting: { issueCount: 0 } } }), repository, "learner", now),
    (error: FactError) => error.reason === "invalid-answer",
  );
  await assert.rejects(readPacing(async () => ({}), repository, "learner", now), (error: FactError) => error.reason === "invalid-answer");
  await assert.rejects(readPacing(async () => answer({ open: 0, merged: 0 }), repository, "not a login", now));
  assert.equal(await readViewerLogin(async () => ({ data: { viewer: { login: "learner" } } })), "learner");
  await assert.rejects(readViewerLogin(async () => ({ data: { viewer: null } })), (error: FactError) => error.reason === "invalid-answer");
  assert.deepEqual(pacingSearches("acme/widgets", "learner", now).waiting.split(" ").at(-1), "updated:<2026-10-08");
});
