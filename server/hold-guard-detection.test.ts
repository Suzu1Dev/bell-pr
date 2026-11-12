/**
 * Write guard S4: detection (docs/design/collab-write-guard.md).
 *
 * 1. Commits on the target branch since a hold was taken (`<hold base>..<target>`)
 *    that touch the holder's held paths are reported to the holder at sync
 *    (unpublished and published PR) and at first publish + preflight
 *    (`held-changed-upstream`, kind `confirm`).
 * 2. `POST /api/collab/projects/:project/check` and `.../work` return
 *    `changing`: other people's unfinished runs whose diffs, active plans, or
 *    unmerged PRs already meet the asked/held paths.
 * 3. Non-conflicting parallel file changes proceed unaffected.
 * 4. Privacy boundaries hold: commit subjects, private hold titles, and other
 *    holders' names never leak to unauthorized participants, removed people,
 *    or agent prompts.
 */
import test, { after, before, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CollabCheckResponse, CollabHold, CollabWorkResponse } from "../shared/collab.js";
import type { DraftCheck } from "../shared/draft-checks.js";
import type { HeldUpstreamChange } from "../shared/sync.js";
import { collabFixture, outcome, type Headers } from "../test/collab-fixture.js";
import { fakeGitHub } from "../test/fake-github.js";
import { participantHeader } from "./coordination-routes.js";
import { Coordinator } from "./coordination.js";
import { readDiff } from "./git.js";
import { git } from "./process.js";
import type { TeamAgentRunner } from "./team.js";
import type { Run } from "./types.js";
import { skipUnderstandingCheckInTests } from "./understanding.js";

const english = { "x-bell-locale": "en" };
const chinese = { "x-bell-locale": "zh-TW" };

before(() => skipUnderstandingCheckInTests(true));
after(() => skipUnderstandingCheckInTests());

const seedFiles: Record<string, string> = {
  "README.md": "Example\n",
  "src/api/users.ts": "export const users = [];\n",
  "src/api/index.ts": "export * from './users.js';\n",
  "src/apiary/hive.ts": "export const hive = true;\n",
  "src/lib/math.ts": "export const add = (a: number, b: number) => a + b;\n",
  "docs/guide.md": "Guide\n",
  "docs/old.md": "Old\n",
};

async function detectionScene(
  t: TestContext,
  { runner }: { runner?: TeamAgentRunner } = {},
) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "bell-hold-detect-"));
  const github = await fakeGitHub(tempRoot, {
    owner: "test-owner",
    name: "example",
    files: seedFiles,
  });
  t.after(async () => {
    github.restore();
    await rm(tempRoot, { recursive: true, force: true });
  });

  const f = await collabFixture(t, { runner });
  const cast = await f.cast();
  const desk = await f.device("Desk D");
  const dee = await f.join(desk, await f.invite(cast.who.admin, { name: "Dee" }));
  const who = {
    ...cast.who,
    dee: { ...desk, [participantHeader]: dee.token } as Headers,
  };

  const repo = await f.workbench.importRepository(github.url);
  await git(repo.path, ["config", "user.name", "BELL Test"]);
  await git(repo.path, ["config", "user.email", "test@example.invalid"]);
  await git(repo.path, ["config", "commit.gpgsign", "false"]);

  const added = await f.post("/projects", who.admin, { repoId: repo.id });
  assert.equal(added.status, 201, added.body);
  const project = added.json.project.id as string;

  let runSeq = 0;
  const makeRun = async (
    owners: string[] | undefined,
    {
      title = "Contribution",
      branch = `feat/run-${++runSeq}`,
      status = "review" as Run["status"],
      extra = {},
    }: {
      title?: string;
      branch?: string;
      status?: Run["status"];
      extra?: Partial<Run>;
    } = {},
  ) => {
    const id = `run-${runSeq}`;
    const baseSha = (await git(repo.path, ["rev-parse", "refs/heads/main"])).stdout.trim();
    const worktreePath = path.join(tempRoot, `wt-${id}`);
    await git(repo.path, ["branch", "--", branch, baseSha]);
    await git(repo.path, ["worktree", "add", worktreePath, branch]);
    await git(worktreePath, ["config", "user.name", "BELL Test"]);
    await git(worktreePath, ["config", "user.email", "test@example.invalid"]);
    await git(worktreePath, ["config", "commit.gpgsign", "false"]);
    const run: Run = {
      id,
      repoId: repo.id,
      title,
      prompt: title,
      status,
      branch,
      baseBranch: "main",
      baseSha,
      worktreePath,
      ...(owners ? { owners } : {}),
      createdAt: new Date().toISOString(),
      agents: [],
      logs: [],
      draft: {
        title: `fix: ${title.toLowerCase()}`,
        body: `Implements ${title}.`,
        commitMessage: `fix: ${title.toLowerCase()}`,
      },
      reviewedFiles: [],
      reviewedFingerprints: {},
      ...extra,
    };
    f.store.data.runs.push(run);
    await f.store.save();
    return run;
  };

  const editInRun = async (runId: string, files: Record<string, string>) => {
    const run = f.workbench.run(runId);
    for (const [rel, content] of Object.entries(files)) {
      const target = path.join(run.worktreePath, rel);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
    }
  };

  const reviewAndApprove = async (runId: string) => {
    const run = f.workbench.run(runId);
    for (const file of await readDiff(run))
      await f.workbench.review(runId, file.path, true, file.fingerprint);
    return f.workbench.approve(runId, { ...f.workbench.run(runId).draft });
  };

  const check = async (asWho: Headers, scopes: string[]) => {
    const reply = await f.post(`/projects/${project}/check`, { ...english, ...asWho }, { scopes });
    assert.equal(reply.status, 200, reply.body);
    return reply.json as CollabCheckResponse;
  };

  const work = async (asWho: Headers, scopes: string[], title = "Hold work") => {
    const reply = await f.post(`/projects/${project}/work`, { ...english, ...asWho }, {
      title,
      scopes,
    });
    assert.equal(reply.status, 201, reply.body);
    return reply.json as CollabWorkResponse;
  };

  const release = (asWho: Headers, hold: CollabHold, done = false) =>
    f.post(`/projects/${project}/holds/${hold.claimId}/release`, asWho, {
      fence: hold.fence,
      ...(done ? { done: true } : {}),
    });

  const sync = (runId: string, asWho: Headers, locale: Headers = english) =>
    f.send("POST", `/api/runs/${runId}/sync`, { ...locale, ...asWho }, {});

  const undoSync = (runId: string, asWho: Headers) =>
    f.send("POST", `/api/runs/${runId}/sync/undo`, { ...english, ...asWho }, {});

  const preflight = async (runId: string, asWho: Headers, locale: Headers = english) => {
    const reply = await f.send("GET", `/api/runs/${runId}/preflight`, { ...locale, ...asWho });
    assert.equal(reply.status, 200, reply.body);
    return reply.json.checks as DraftCheck[];
  };

  const publish = async (
    runId: string,
    asWho: Headers,
    {
      acknowledgeHeldUpstream = true,
      locale = english,
    }: { acknowledgeHeldUpstream?: boolean; locale?: Headers } = {},
  ) => {
    const headers = { ...locale, ...asWho };
    const shown = await f.send("GET", `/api/runs/${runId}/preflight`, headers);
    if (shown.status !== 200) return shown;
    const acknowledged = (shown.json.checks as DraftCheck[])
      .filter(
        (item) =>
          item.kind === "confirm" &&
          (acknowledgeHeldUpstream || item.id !== "held-changed-upstream"),
      )
      .map((item) => item.id);
    return f.send("POST", `/api/runs/${runId}/publish`, headers, {
      fingerprint: f.workbench.run(runId).approvedFingerprint,
      acknowledged,
    });
  };

  return {
    ...cast,
    f,
    github,
    tempRoot,
    repo,
    project,
    dee,
    desk,
    who,
    makeRun,
    editInRun,
    reviewAndApprove,
    check,
    work,
    release,
    sync,
    undoSync,
    preflight,
    publish,
  };
}

test("outside-BELL-PR commits on held paths are detected and reported to the holder at sync and publish (en + zh-TW)", async (t) => {
  const s = await detectionScene(t);
  const run = await s.makeRun([s.ada.id], { title: "Update docs while holding users API" });
  const { hold } = await s.work(s.who.admin, ["src/api/users.ts", "docs/old.md"], "Users API refactor");
  await s.editInRun(run.id, { "README.md": "Example updated by Ada\n" });
  await s.reviewAndApprove(run.id);

  // Outside BELL PR: one direct commit touching src/api/users.ts, plus a merge commit renaming docs/old.md -> docs/archive.md.
  const c1 = await s.github.upstreamCommit(
    { "src/api/users.ts": "export const users = ['outside'];\n" },
    "hotfix: outside edit to users",
  );
  const mergeWork = path.join(s.tempRoot, "outside-merge");
  await git(s.tempRoot, ["clone", "-q", s.github.bare, mergeWork]);
  await git(mergeWork, ["config", "user.name", "Outside Dev"]);
  await git(mergeWork, ["config", "user.email", "outside@example.invalid"]);
  await git(mergeWork, ["config", "commit.gpgsign", "false"]);
  await git(mergeWork, ["checkout", "-q", "-b", "rename-branch"]);
  await git(mergeWork, ["mv", "docs/old.md", "docs/archive.md"]);
  await git(mergeWork, ["commit", "-q", "-m", "rename old doc"]);
  await git(mergeWork, ["checkout", "-q", "main"]);
  await git(mergeWork, ["merge", "--no-ff", "rename-branch", "-m", "Merge pull request #99"]);
  const c2 = (await git(mergeWork, ["rev-parse", "HEAD"])).stdout.trim();
  await git(mergeWork, ["push", "-q", "origin", "main"]);

  // Sync in English reports both held paths with their 7-char SHAs, sorted by path.
  const synced = await s.sync(run.id, s.who.admin, english);
  assert.equal(synced.status, 200, synced.body);
  const expectedHeld: HeldUpstreamChange[] = [
    { path: "docs/old.md", commits: [c2.slice(0, 7)] },
    { path: "src/api/users.ts", commits: [c1.slice(0, 7)] },
  ];
  assert.equal(synced.json.updated, true);
  assert.deepEqual(synced.json.heldChanges, expectedHeld);
  assert.deepEqual(s.f.workbench.run(run.id).sync?.heldChanges, expectedHeld);
  const noticeLog = s.f.workbench.run(run.id).logs.at(-1);
  assert.equal(noticeLog?.kind, "notice");
  assert.equal(
    noticeLog?.message,
    `Commits on main changed files under your hold since you took it: docs/old.md (${c2.slice(0, 7)}); src/api/users.ts (${c1.slice(0, 7)}).`,
  );

  // Re-syncing when already at latest (updated: false) in zh-TW still reports heldChanges and logs zh-TW copy.
  const resyncedZh = await s.sync(run.id, s.who.admin, chinese);
  assert.equal(resyncedZh.status, 200, resyncedZh.body);
  assert.equal(resyncedZh.json.updated, false);
  assert.deepEqual(resyncedZh.json.heldChanges, expectedHeld);
  assert.equal(
    s.f.workbench.run(run.id).logs.at(-1)?.message,
    `在你佔用期間，main 上有提交改到你佔用的檔案：docs/old.md（${c2.slice(0, 7)}）；src/api/users.ts（${c1.slice(0, 7)}）。`,
  );

  // Preflight in English and zh-TW includes held-changed-upstream as a confirm check.
  await s.reviewAndApprove(run.id);
  const checksEn = await s.preflight(run.id, s.who.admin, english);
  const checkEn = checksEn.find((item) => item.id === "held-changed-upstream");
  assert.deepEqual(checkEn, {
    id: "held-changed-upstream",
    kind: "confirm",
    message:
      "Commits on main changed files under your hold since you took it. Check those changes before publishing.",
    details: [
      `docs/old.md (${c2.slice(0, 7)})`,
      `src/api/users.ts (${c1.slice(0, 7)})`,
    ],
  });
  const checksZh = await s.preflight(run.id, s.who.admin, chinese);
  const checkZh = checksZh.find((item) => item.id === "held-changed-upstream");
  assert.deepEqual(checkZh, {
    id: "held-changed-upstream",
    kind: "confirm",
    message: "在你佔用期間，main 上有提交改到你佔用的檔案。發佈前請先確認這些變更。",
    details: [
      `docs/old.md（${c2.slice(0, 7)}）`,
      `src/api/users.ts（${c1.slice(0, 7)}）`,
    ],
  });

  // Publishing without ticking held-changed-upstream is refused with 422; ticking it publishes cleanly!
  const unconfirmed = await s.publish(run.id, s.who.admin, { acknowledgeHeldUpstream: false });
  assert.equal(unconfirmed.status, 422, unconfirmed.body);
  assert.match(unconfirmed.json.error, /Commits on main changed files under your hold since you took it/);

  const published = await s.publish(run.id, s.who.admin, { acknowledgeHeldUpstream: true });
  assert.equal(published.status, 200, published.body);
  assert.equal(published.json.run.status, "published");

  // On a published PR, another outside commit under Ada's hold is reported on the sync round,
  // and pushing the sync round succeeds without needing first-publish confirm checkboxes.
  const c3 = await s.github.upstreamCommit(
    { "src/api/users.ts": "export const users = ['outside', 'v2'];\n" },
    "second outside commit",
  );
  const prSynced = await s.sync(run.id, s.who.admin, english);
  assert.equal(prSynced.status, 200, prSynced.body);
  assert.equal(prSynced.json.updated, true);
  assert.deepEqual(prSynced.json.heldChanges, [
    { path: "docs/old.md", commits: [c2.slice(0, 7)] },
    { path: "src/api/users.ts", commits: [c3.slice(0, 7), c1.slice(0, 7)] },
  ]);
  assert.deepEqual(
    s.f.workbench.run(run.id).followUps?.at(-1)?.heldChanges,
    prSynced.json.heldChanges,
  );
  assert.equal(
    (await s.preflight(run.id, s.who.admin)).some((item) => item.id === "held-changed-upstream"),
    false,
  );
  await s.reviewAndApprove(run.id);
  const pushedRound = await s.publish(run.id, s.who.admin);
  assert.equal(pushedRound.status, 200, pushedRound.body);

  // Releasing the hold with done: true clears the warning for subsequent runs.
  assert.equal((await s.release(s.who.admin, hold, true)).status, 200);
  await s.f.workbench.updateRepository(s.repo.id);
  const nextRun = await s.makeRun([s.ada.id], { title: "Follow-on cleanup" });
  await s.editInRun(nextRun.id, { "README.md": "Example v3\n" });
  await s.reviewAndApprove(nextRun.id);
  assert.equal(
    (await s.preflight(nextRun.id, s.who.admin)).some((item) => item.id === "held-changed-upstream"),
    false,
  );
});

test("undoing an unpublished sync clears recorded heldChanges", async (t) => {
  const s = await detectionScene(t);
  const run = await s.makeRun([s.ada.id], { title: "Undo sync check" });
  await s.work(s.who.admin, ["src/api/users.ts"], "Users hold");
  await s.editInRun(run.id, { "README.md": "Before sync\n" });

  await s.github.upstreamCommit({ "src/api/users.ts": "export const users = [1];\n" });
  const synced = await s.sync(run.id, s.who.admin);
  assert.equal(synced.status, 200, synced.body);
  assert.equal(synced.json.heldChanges?.length, 1);

  const undone = await s.undoSync(run.id, s.who.admin);
  assert.equal(undone.status, 200, undone.body);
  assert.equal(undone.json.run.sync, undefined);
  assert.equal(undone.json.run.heldChanges, undefined);
});

test("changing on check and work reports other people's overlapping diffs, plans, and unmerged PRs, excluding own and merged runs", async (t) => {
  const s = await detectionScene(t);

  // 1. Ada's own unfinished run touching src/api/users.ts (must NOT appear in Ada's changing).
  const adaRun = await s.makeRun([s.ada.id], { title: "Ada own draft" });
  await s.editInRun(adaRun.id, { "src/api/users.ts": "export const users = ['ada'];\n" });

  // 2. Ben's unfinished checkout run touching src/api/users.ts.
  const benRun = await s.makeRun([s.ben.id], { title: "Ben users edit" });
  await s.editInRun(benRun.id, { "src/api/users.ts": "export const users = ['ben'];\n" });

  // 3. Dee's awaiting_plan run whose team plan covers docs/guide.md.
  const deePlanRun = await s.makeRun([s.dee.id], {
    title: "Dee docs plan",
    status: "awaiting_plan",
    extra: {
      team: {
        phase: "planning",
        leadSummary: "Update guide",
        tasks: [
          {
            id: "task-1",
            title: "Guide update",
            agentName: "Builder",
            files: ["docs/guide.md"],
            status: "pending",
          },
        ],
      },
    } as unknown as Partial<Run>,
  });

  // 4. Ben's published unmerged PR touching src/lib/math.ts.
  const benPrRun = await s.makeRun([s.ben.id], { title: "Ben math PR" });
  await s.editInRun(benPrRun.id, { "src/lib/math.ts": "export const add = (a: number, b: number) => a + b + 0;\n" });
  await s.reviewAndApprove(benPrRun.id);
  const prPublished = await s.publish(benPrRun.id, s.who.member);
  assert.equal(prPublished.status, 200, prPublished.body);

  const scopes = ["src/api", "docs", "src/lib/math.ts"];
  const checked = await s.check(s.who.admin, scopes);
  assert.deepEqual(checked.changing, [
    {
      runId: benRun.id,
      title: "Ben users edit",
      status: "review",
      owners: ["Ben"],
      paths: ["src/api/users.ts"],
    },
    {
      runId: deePlanRun.id,
      title: "Dee docs plan",
      status: "awaiting_plan",
      owners: ["Dee"],
      paths: ["docs/guide.md"],
    },
    {
      runId: benPrRun.id,
      title: "Ben math PR",
      status: "published",
      owners: ["Ben"],
      paths: ["src/lib/math.ts"],
    },
  ]);

  // Taking the hold still succeeds (201) and returns the same changing list.
  const taken = await s.work(s.who.admin, scopes, "Coordinate release");
  assert.deepEqual(taken.changing, checked.changing);

  // Once Ben's PR is marked merged, check no longer reports it as changing.
  s.f.workbench.run(benPrRun.id).prFeedback = {
    fetchedAt: new Date().toISOString(),
    prNumber: 1,
    merged: true,
    prState: "MERGED",
    items: [],
  };
  const afterMerge = await s.check(s.who.admin, ["src/lib/math.ts"]);
  assert.deepEqual(afterMerge.changing, []);
});

test("non-conflicting parallel work proceeds unaffected across check, work, sync, and publish", async (t) => {
  const s = await detectionScene(t);

  // Ada holds src/api/users.ts.
  await s.work(s.who.admin, ["src/api/users.ts"], "Users endpoint");

  // Ben edits sibling src/api/index.ts and prefix-neighbour src/apiary/hive.ts.
  const benRun = await s.makeRun([s.ben.id], { title: "Ben index and apiary" });
  await s.editInRun(benRun.id, {
    "src/api/index.ts": "export const ready = true;\n",
    "src/apiary/hive.ts": "export const hive = 'busy';\n",
  });

  assert.deepEqual((await s.check(s.who.admin, ["src/api/users.ts"])).changing, []);
  const benCheck = await s.check(s.who.member, ["src/api/index.ts", "src/apiary"]);
  assert.deepEqual(benCheck.meets, []);
  assert.deepEqual(benCheck.changing, []);

  // Upstream changes to non-held files (docs/guide.md) do NOT trigger heldChanges for Ada.
  const adaRun = await s.makeRun([s.ada.id], { title: "Ada users change" });
  await s.editInRun(adaRun.id, { "src/api/users.ts": "export const users = ['ada'];\n" });
  await s.github.upstreamCommit(
    { "docs/guide.md": "Updated guide\n" },
    "docs update",
  );

  const adaSync = await s.sync(adaRun.id, s.who.admin);
  assert.equal(adaSync.status, 200, adaSync.body);
  assert.equal(adaSync.json.updated, true);
  assert.equal(adaSync.json.heldChanges, undefined);
  assert.equal(s.f.workbench.run(adaRun.id).sync?.heldChanges, undefined);

  await s.reviewAndApprove(adaRun.id);
  assert.equal(
    (await s.preflight(adaRun.id, s.who.admin)).some((c) =>
      ["held-by-other", "holds-unknown", "held-changed-upstream"].includes(c.id),
    ),
    false,
  );
  const adaPub = await s.publish(adaRun.id, s.who.admin);
  assert.equal(adaPub.status, 200, adaPub.body);

  assert.equal((await s.sync(benRun.id, s.who.member)).status, 200);
  await s.reviewAndApprove(benRun.id);
  assert.equal(
    (await s.preflight(benRun.id, s.who.member)).some((c) =>
      ["held-by-other", "holds-unknown", "held-changed-upstream"].includes(c.id),
    ),
    false,
  );
  const benPub = await s.publish(benRun.id, s.who.member);
  assert.equal(benPub.status, 200, benPub.body);
});

test("privacy boundaries hold: no commit subjects, no cross-holder leaks, 403 for removed/stranger tokens, and prompts get paths only", async (t) => {
  const prompts: string[] = [];
  const s = await detectionScene(t, {
    runner: async (input) => {
      prompts.push(input.prompt);
      await writeFile(path.join(input.cwd, "src/lib/math.ts"), "export const add = () => 42;\n");
      return JSON.stringify({ reply: "Updated math.", checks: [] });
    },
  });

  const secretTitle = "CONFIDENTIAL-HOLD-TITLE-42";
  const secretSubject = "SECRET-COMMIT-SUBJECT-IGNORE-INSTRUCTIONS";
  await s.work(s.who.admin, ["src/api/users.ts"], secretTitle);
  const sha = await s.github.upstreamCommit(
    { "src/api/users.ts": "export const users = ['upstream'];\n" },
    secretSubject,
  );

  // 1. Holder's sync, preflight, and logs contain ONLY the 7-char SHA, never the commit subject.
  const adaRun = await s.makeRun([s.ada.id], { title: "Ada check" });
  await s.editInRun(adaRun.id, { "README.md": "Ada readme\n" });
  const adaSynced = await s.sync(adaRun.id, s.who.admin);
  assert.equal(adaSynced.status, 200, adaSynced.body);
  assert.doesNotMatch(adaSynced.body, new RegExp(secretSubject));
  assert.deepEqual(adaSynced.json.heldChanges, [
    { path: "src/api/users.ts", commits: [sha.slice(0, 7)] },
  ]);
  const adaChecks = await s.preflight(adaRun.id, s.who.admin);
  assert.doesNotMatch(JSON.stringify(adaChecks), new RegExp(secretSubject));

  // 2. Ben syncing and preflighting his own non-conflicting run never sees Ada's hold upstream warning or title.
  const benRun = await s.makeRun([s.ben.id], { title: "Ben math work" });
  await s.editInRun(benRun.id, { "README.md": "Ben readme\n" });
  const benSynced = await s.sync(benRun.id, s.who.member);
  assert.equal(benSynced.status, 200, benSynced.body);
  assert.equal(benSynced.json.heldChanges, undefined);
  assert.doesNotMatch(benSynced.body, new RegExp(secretTitle));
  assert.doesNotMatch(benSynced.body, /Ada/);
  const benChecks = await s.preflight(benRun.id, s.who.member);
  assert.equal(benChecks.some((c) => c.id === "held-changed-upstream"), false);
  assert.doesNotMatch(JSON.stringify(benChecks), new RegExp(secretTitle));

  // 3. Removed participant (Cy) and bogus participant tokens get 403 notJoined on sync and preflight, with checkout untouched.
  const bogus = { ...s.devices.ben, [participantHeader]: `bpc_${"z".repeat(43)}` };
  const headBefore = (await git(benRun.worktreePath, ["rev-parse", "HEAD"])).stdout.trim();
  assert.equal(outcome(await s.sync(benRun.id, s.who.removed)), "403 notJoined");
  assert.equal(outcome(await s.sync(benRun.id, bogus)), "403 notJoined");
  assert.equal(
    outcome(await s.f.send("GET", `/api/runs/${benRun.id}/preflight`, { ...english, ...s.who.removed })),
    "403 notJoined",
  );
  assert.equal((await git(benRun.worktreePath, ["rev-parse", "HEAD"])).stdout.trim(), headBefore);

  // 4. A run owned by removed participant Cy never leaks Cy's name in changing (owners is []).
  const cyRun = await s.makeRun([s.cy.id], { title: "Legacy run" });
  await s.editInRun(cyRun.id, { "docs/guide.md": "Cy edit\n" });
  const checkedCy = await s.check(s.who.admin, ["docs/guide.md"]);
  assert.deepEqual(checkedCy.changing, [
    {
      runId: cyRun.id,
      title: "Legacy run",
      status: "review",
      owners: [],
      paths: ["docs/guide.md"],
    },
  ]);
  assert.doesNotMatch(JSON.stringify(checkedCy.changing), /Cy/);

  // 5. Agent write turn prompt contains only the held path, never Ada's name, secret hold title, or commit subject.
  await s.f.workbench.startSession(benRun.id, "Update math.ts");
  for (let i = 0; i < 500 && s.f.workbench.run(benRun.id).session?.running; i += 1)
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /src\/api\/users\.ts/);
  assert.doesNotMatch(prompts[0], new RegExp(secretTitle));
  assert.doesNotMatch(prompts[0], new RegExp(secretSubject));
  assert.doesNotMatch(prompts[0], /\bAda\b/);
});

test("collab.json holds records only active claims and cleans up on conflict, abort, non-done release, revoke, and member removal", async (t) => {
  const s = await detectionScene(t);
  const headSha = (await git(s.repo.path, ["rev-parse", "refs/heads/main"])).stdout.trim();
  const savedSide = async () => JSON.parse((await s.f.files())[0]) as {
    tasks?: Record<string, { title?: string; doneAt?: string }>;
    holds?: Record<string, string>;
  };

  assert.equal((await savedSide()).holds, undefined);

  // Active hold records [project/taskId]: headSha.
  const { hold: adaHold } = await s.work(s.who.admin, ["src/api/users.ts"], "Ada users");
  assert.deepEqual((await savedSide()).holds, {
    [`${s.project}/${adaHold.taskId}`]: headSha,
  });

  // (a1) Pre-claim conflicted POST .../work (409) leaves no orphaned entry.
  const preConflict = await s.f.post(`/projects/${s.project}/work`, { ...english, ...s.who.member }, {
    title: "Conflicting take",
    scopes: ["src/api/users.ts"],
  });
  assert.equal(outcome(preConflict), "409 conflict");
  assert.deepEqual((await savedSide()).holds, {
    [`${s.project}/${adaHold.taskId}`]: headSha,
  });

  // (a2) In-flight claim conflict (409 after defineTask + saveSide(tasks)) leaves no orphaned entry.
  const origClaim = Coordinator.prototype.claim;
  const raceGate = { reached: false, go: () => {} };
  const waitGate = new Promise<void>((resolve) => (raceGate.go = resolve));
  const claimMock = t.mock.method(
    Coordinator.prototype,
    "claim",
    async function (this: Coordinator, ...args: Parameters<Coordinator["claim"]>) {
      if (!raceGate.reached) {
        raceGate.reached = true;
        await waitGate;
      }
      return origClaim.apply(this, args);
    },
  );
  const inFlightConflict = s.f.post(`/projects/${s.project}/work`, { ...english, ...s.who.member }, {
    title: "Raced guide take",
    scopes: ["docs/guide.md"],
  });
  for (let i = 0; i < 500 && !raceGate.reached; i += 1)
    await new Promise((r) => setTimeout(r, 5));
  assert.equal(raceGate.reached, true);
  const { hold: deeHold } = await s.work(s.who.dee, ["docs"], "Dee docs");
  raceGate.go();
  assert.equal(outcome(await inFlightConflict), "409 conflict");
  claimMock.mock.restore();
  assert.deepEqual((await savedSide()).holds, {
    [`${s.project}/${adaHold.taskId}`]: headSha,
    [`${s.project}/${deeHold.taskId}`]: headSha,
  });

  // (a3) In-flight claim aborted because the member was removed mid-claim (403 notJoined) leaves no orphaned entry.
  const eveDevice = await s.f.device("Eve Laptop");
  const eve = await s.f.join(eveDevice, await s.f.invite(s.who.admin, { name: "Eve" }));
  const eveHeaders: Headers = { ...eveDevice, [participantHeader]: eve.token };
  const abortGate = { reached: false, go: () => {} };
  const waitAbort = new Promise<void>((resolve) => (abortGate.go = resolve));
  const abortMock = t.mock.method(
    Coordinator.prototype,
    "claim",
    async function (this: Coordinator, ...args: Parameters<Coordinator["claim"]>) {
      if (!abortGate.reached) {
        abortGate.reached = true;
        await waitAbort;
      }
      return origClaim.apply(this, args);
    },
  );
  const abortedTake = s.f.post(`/projects/${s.project}/work`, { ...english, ...eveHeaders }, {
    title: "Eve math take",
    scopes: ["src/lib/math.ts"],
  });
  for (let i = 0; i < 500 && !abortGate.reached; i += 1)
    await new Promise((r) => setTimeout(r, 5));
  assert.equal(abortGate.reached, true);
  const eveRemoved = await s.f.post(`/people/${eve.id}/remove`, s.who.admin);
  assert.deepEqual([eveRemoved.status, eveRemoved.json], [200, { revoked: 0, unpaired: false }]);
  abortGate.go();
  assert.equal(outcome(await abortedTake), "403 notJoined");
  abortMock.mock.restore();
  assert.deepEqual((await savedSide()).holds, {
    [`${s.project}/${adaHold.taskId}`]: headSha,
    [`${s.project}/${deeHold.taskId}`]: headSha,
  });

  // (b) Releasing with done: false deletes that claim's holds entry (and removes holds when empty).
  assert.equal((await s.release(s.who.dee, deeHold, false)).status, 200);
  assert.deepEqual((await savedSide()).holds, {
    [`${s.project}/${adaHold.taskId}`]: headSha,
  });
  assert.equal((await s.release(s.who.admin, adaHold, false)).status, 200);
  assert.equal((await savedSide()).holds, undefined);

  // (c) Admin revoke deletes the revoked claim's holds entry.
  const { hold: benRevoked } = await s.work(s.who.member, ["src/api/index.ts"], "Ben index");
  assert.deepEqual((await savedSide()).holds, {
    [`${s.project}/${benRevoked.taskId}`]: headSha,
  });
  const revokedReply = await s.f.post(
    `/projects/${s.project}/holds/${benRevoked.claimId}/revoke`,
    s.who.admin,
    {},
  );
  assert.equal(revokedReply.status, 200, revokedReply.body);
  assert.equal((await savedSide()).holds, undefined);

  // (d) Member removal deletes all holds entries of the removed member while preserving others' active holds.
  const { hold: benHold1 } = await s.work(s.who.member, ["src/api/index.ts"], "Ben one");
  const { hold: benHold2 } = await s.work(s.who.member, ["docs/guide.md"], "Ben two");
  const { hold: adaKeep } = await s.work(s.who.admin, ["src/lib/math.ts"], "Ada math");
  assert.deepEqual((await savedSide()).holds, {
    [`${s.project}/${benHold1.taskId}`]: headSha,
    [`${s.project}/${benHold2.taskId}`]: headSha,
    [`${s.project}/${adaKeep.taskId}`]: headSha,
  });
  const benRemoved = await s.f.post(`/people/${s.ben.id}/remove`, s.who.admin);
  assert.deepEqual([benRemoved.status, benRemoved.json], [200, { revoked: 2, unpaired: false }]);
  assert.deepEqual((await savedSide()).holds, {
    [`${s.project}/${adaKeep.taskId}`]: headSha,
  });

  // Releasing the remaining hold with done: true removes holds while keeping tasks[key].doneAt.
  assert.equal((await s.release(s.who.admin, adaKeep, true)).status, 200);
  const finalSide = await savedSide();
  assert.equal(finalSide.holds, undefined);
  assert.ok(finalSide.tasks?.[`${s.project}/${adaKeep.taskId}`]?.doneAt);
});
