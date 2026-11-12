/**
 * Write guard S2 recovery (`server/hold-recovery.ts`, `docs/design/collab-write-guard.md`):
 *
 * 1. `run.heldPaths` records conflicting checkout paths (never holder names or
 *    hold titles) when a write turn in `run.worktreePath` stops on `heldByOther`
 *    (session, setup-session, follow-up, sync conflict resolution), persists
 *    across restarts, is exposed on run detail (`GET /api/runs/:id`) and omitted
 *    from run summaries (`GET /api/runs`), and clears when a subsequent write
 *    turn completes without conflict, on `discardFollowUp`, or on `undoSync`.
 * 2. Legacy runs saved before `heldPaths` existed (`turnHeldByOther` text in
 *    `en` or `zh-TW`) never leak holder names or hold titles into subsequent
 *    session or PR draft prompts, and still recover cleanly via `restore` and
 *    `recheck`.
 * 3. `POST /api/runs/:id/holds/restore` ("Put these files back") restores
 *    modified, added (tracked/staged and untracked), deleted, and renamed held
 *    or recorded paths back to the run's review base (`run.baseSha` or
 *    `round.parentCommit`), prunes empty directories, leaves non-conflicting
 *    changes untouched, refuses symlink/traversal escapes with 422 before
 *    mutating anything, clears hold-stop state, transitions `failed -> review`
 *    when reviewable changes remain (without prematurely promoting incomplete
 *    team runs), and logs localized notices (`en` and `zh-TW`, paths only).
 * 4. `POST /api/runs/:id/holds/recheck` ("Check again") returns 409
 *    `heldByOther` while conflicts remain without modifying checkout files,
 *    updates `run.heldPaths` as partial holds end, and clears hold-stop state
 *    once released or revoked.
 * 5. Group auth (`403 notJoined`), stopped group (`503 holdsUnknown`),
 *    removed workspace (`410 workspace_removed`), invalid body (`400`),
 *    disallowed/busy run states (`409`), non-conflicting parallel work, and
 *    privacy boundaries hold across all recovery paths.
 */
import test, { after, before, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { CollabHold } from "../shared/collab.js";
import type { DraftCheck } from "../shared/draft-checks.js";
import type { HoldRecheckResponse, HoldRestoreResponse } from "../shared/types.js";
import { collabFixture, outcome, type Headers } from "../test/collab-fixture.js";
import { fakeGitHub } from "../test/fake-github.js";
import { participantHeader } from "./coordination-routes.js";
import { readDiff } from "./git.js";
import { sm, withLocale } from "./i18n/index.js";
import { command, git } from "./process.js";
import type { TeamAgentInput, TeamAgentRunner } from "./team.js";
import type { Run } from "./types.js";
import { skipUnderstandingCheckInTests } from "./understanding.js";

const english = { "x-bell-locale": "en" };
const chinese = { "x-bell-locale": "zh-TW" };

const agentsReady = async () => ({
  codex: true,
  codexAuthenticated: true,
  github: false,
  claude: false,
  claudeAuthenticated: false,
});

async function waitUntil(predicate: () => boolean, what: string) {
  const end = Date.now() + 20_000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await delay(10);
  }
}

const seedFiles: Record<string, string> = {
  "README.md": "Example\n",
  "src/api/users.ts": "export const users = [];\n",
  "src/api/legacy.ts": "export const legacy = true;\n",
  "src/api/old-route.ts": "export const route = '/v1';\n",
  "src/api/index.ts": "export * from './users.js';\n",
  "src/free/keep.ts": "export const keep = 1;\n",
  "docs/guide.md": "Guide\n",
  "docs/obsolete.md": "Obsolete\n",
};

async function exists(filePath: string) {
  return Boolean(await lstat(filePath).catch(() => undefined));
}

async function write(cwd: string, rel: string, content: string) {
  const full = path.join(cwd, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content);
}

async function localScene(
  t: TestContext,
  agents: (input: TeamAgentInput) => Promise<string> = async () => "Done.",
) {
  const previousPath = process.env.PATH;
  const bin = await mkdtemp(path.join(os.tmpdir(), "bell-hold-rec-bin-"));
  const realGit = (await command("which", ["git"])).stdout.trim();
  const sh = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  await writeFile(
    path.join(bin, "git"),
    `#!/bin/sh
for arg in "$@"; do
  case $arg in
    push|fetch|ls-remote|http://*|https://*|ssh://*|git://*|*@github.com:*) exit 98 ;;
  esac
done
exec ${sh(realGit)} "$@"
`,
    { mode: 0o700 },
  );
  await writeFile(path.join(bin, "gh"), "#!/bin/sh\nexit 97\n", { mode: 0o700 });
  process.env.PATH = `${bin}${path.delimiter}${previousPath}`;
  t.after(async () => {
    process.env.PATH = previousPath;
    await rm(bin, { recursive: true, force: true });
  });

  const turns: TeamAgentInput[] = [];
  const runner: TeamAgentRunner = async (input) => {
    turns.push(input);
    return agents(input);
  };
  const f = await collabFixture(t, { runner });
  f.workbench.status = agentsReady;
  const cast = await f.cast();
  const desk = await f.device("Desk D");
  const dee = await f.join(desk, await f.invite(cast.who.admin, { name: "Dee" }));
  const who = {
    ...cast.who,
    dee: { ...desk, [participantHeader]: dee.token } as Headers,
  };

  const sources = await mkdtemp(path.join(os.tmpdir(), "bell-hold-rec-src-"));
  t.after(() => rm(sources, { recursive: true, force: true }));
  const repoRoot = path.join(sources, "example");
  await mkdir(repoRoot);
  await git(repoRoot, ["init", "-q", "-b", "main"]);
  await git(repoRoot, ["config", "user.name", "BELL Test"]);
  await git(repoRoot, ["config", "user.email", "test@example.invalid"]);
  await git(repoRoot, ["config", "commit.gpgsign", "false"]);
  for (const [rel, content] of Object.entries(seedFiles)) await write(repoRoot, rel, content);
  await git(repoRoot, ["add", "--", "."]);
  await git(repoRoot, ["commit", "-q", "-m", "initial"]);

  const repo = await f.workbench.importRepository(repoRoot);
  const added = await f.post("/projects", who.admin, { repoId: repo.id });
  assert.equal(added.status, 201, added.body);
  const project = added.json.project.id as string;

  let seq = 0;
  const makeRun = async (
    owners?: string[],
    extra: Partial<Run> = {},
    targetRepoId = repo.id,
    sourceRepoPath = repo.path,
  ) => {
    const n = ++seq;
    const id = extra.id ?? `rec-run-${n}`;
    const branch = extra.branch ?? `feat/rec-${n}`;
    const baseSha = extra.baseSha ?? (await git(sourceRepoPath, ["rev-parse", "HEAD"])).stdout.trim();
    const worktreePath = extra.worktreePath ?? path.join(sources, `wt-${id}`);
    if (!extra.worktreePath) {
      await git(sourceRepoPath, ["branch", "--", branch, baseSha]);
      await git(sourceRepoPath, ["worktree", "add", worktreePath, branch]);
      await git(worktreePath, ["config", "user.name", "BELL Test"]);
      await git(worktreePath, ["config", "user.email", "test@example.invalid"]);
      await git(worktreePath, ["config", "commit.gpgsign", "false"]);
    }
    const made: Run = {
      id,
      repoId: targetRepoId,
      title: `Run ${n}`,
      prompt: `Implement run ${n}`,
      status: "review",
      branch,
      baseBranch: "main",
      baseSha,
      worktreePath,
      createdAt: new Date().toISOString(),
      locale: "en",
      agents: [],
      logs: [],
      draft: {
        title: `fix: run ${n}`,
        body: "## Problem\nNeed changes.\n\n## Changes\nUpdated files.\n\n## Validation\nRan checks.\n\n## Limitations\nNone.",
        commitMessage: `fix: run ${n}`,
      },
      reviewedFiles: [],
      reviewedFingerprints: {},
      ...(owners ? { owners } : {}),
      ...extra,
    };
    f.store.data.runs.push(made);
    await f.store.save();
    return made;
  };

  const hold = async (asWho: Headers, scopes: string[], title = "Users API"): Promise<CollabHold> => {
    const made = await f.post(`/projects/${project}/work`, asWho, { title, scopes });
    assert.equal(made.status, 201, made.body);
    return made.json.hold as CollabHold;
  };
  const release = async (asWho: Headers, held: CollabHold) => {
    const reply = await f.post(`/projects/${project}/holds/${held.claimId}/release`, asWho, {
      fence: held.fence,
    });
    assert.equal(reply.status, 200, reply.body);
  };
  const revoke = async (asWho: Headers, held: CollabHold) => {
    const reply = await f.post(`/projects/${project}/holds/${held.claimId}/revoke`, asWho, {});
    assert.equal(reply.status, 200, reply.body);
  };
  const restore = (id: string, asWho: Headers, locale: Headers = english, body: unknown = {}) =>
    f.send("POST", `/api/runs/${id}/holds/restore`, { ...locale, ...asWho }, body);
  const recheck = (id: string, asWho: Headers, locale: Headers = english, body: unknown = {}) =>
    f.send("POST", `/api/runs/${id}/holds/recheck`, { ...locale, ...asWho }, body);
  const session = async (id: string, content: string) => {
    const beforeCount = f.workbench.run(id).session?.messages.length ?? 0;
    await f.workbench.startSession(id, content);
    await waitUntil(
      () =>
        !f.workbench.run(id).session?.running &&
        (f.workbench.run(id).session?.messages.length ?? 0) >= beforeCount + 2,
      "session turn",
    );
    return f.workbench.run(id).session!.messages.at(-1)!;
  };

  return {
    ...cast,
    f,
    dee,
    desk,
    who,
    turns,
    sources,
    repo,
    project,
    makeRun,
    hold,
    release,
    revoke,
    restore,
    recheck,
    session,
  };
}

before(() => skipUnderstandingCheckInTests(true));
after(() => skipUnderstandingCheckInTests());

test("session and setup write turns record run.heldPaths (paths only), expose it on detail only, persist across restart, and clear when a later write turn succeeds", async (t) => {
  const s = await localScene(t, async (input) => {
    if (input.role === "session") {
      if (input.prompt.includes("Touch held") || input.prompt.includes("setupToHandle")) {
        await write(input.cwd, "src/api/users.ts", "export const users = ['ben'];\n");
      } else {
        await write(input.cwd, "README.md", "Updated cleanly\n");
      }
      return JSON.stringify({
        reply: "Edited.",
        questions: [],
        notRun: [],
        setup: [],
        setupResults: [{ command: "npm test", status: "done", summary: "Ran tests" }],
        limitations: "",
        validation: "",
      });
    }
    return "Reviewed.";
  });

  const secretTitle = "SECRET-ADA-HOLD-TITLE";
  const adaHold = await s.hold(s.who.admin, ["src/api/users.ts"], secretTitle);

  // 1. Session turn stopping on Ada's hold records run.heldPaths (paths only) and exposes it on detail, not list summary.
  const sessionRun = await s.makeRun([s.ben.id]);
  const stopped = await s.session(sessionRun.id, "Touch held");
  assert.equal(stopped.failed, true);
  assert.deepEqual(s.f.workbench.run(sessionRun.id).heldPaths, ["src/api/users.ts"]);
  assert.equal(JSON.stringify(s.f.workbench.run(sessionRun.id).heldPaths).includes("Ada"), false);
  assert.equal(JSON.stringify(s.f.workbench.run(sessionRun.id).heldPaths).includes(secretTitle), false);

  const detail = await s.f.send("GET", `/api/runs/${sessionRun.id}`, { ...english, ...s.who.member });
  assert.equal(detail.status, 200, detail.body);
  assert.deepEqual(detail.json.run.heldPaths, ["src/api/users.ts"]);

  const list = await s.f.send("GET", "/api/runs", { ...english, ...s.who.member });
  assert.equal(list.status, 200, list.body);
  const summary = (list.json.runs as Record<string, unknown>[]).find(
    (entry) => entry.id === sessionRun.id,
  );
  assert.ok(summary);
  assert.equal("heldPaths" in summary, false);

  // Persists across restart.
  await s.f.start();
  s.f.workbench.status = agentsReady;
  assert.deepEqual(s.f.workbench.run(sessionRun.id).heldPaths, ["src/api/users.ts"]);

  // Once Ada releases the hold, a subsequent write turn in run.worktreePath passes assertNotHeld and clears run.heldPaths.
  await s.release(s.who.admin, adaHold);
  const cleanTurn = await s.session(sessionRun.id, "Clean follow-up edit");
  assert.equal(cleanTurn.failed, undefined, cleanTurn.content);
  assert.equal(s.f.workbench.run(sessionRun.id).heldPaths, undefined);

  // 2. Setup hand-off turn stopping on a newly held path also records run.heldPaths, and a completed-team
  //    failed run restores its conflicting file and transitions failed -> review when reviewable changes remain.
  const adaHold2 = await s.hold(s.who.admin, ["src/api/users.ts"], secretTitle);
  const setupRun = await s.makeRun([s.ben.id], {
    modelExecution: { source: "cli-default", agentAccess: "full" },
    team: {
      phase: "complete",
      config: { maxTeammates: 2, requirePlanApproval: false, provider: "codex", protocol: "bell-shared-tasks", messageDelivery: "between-turns" },
      planSummary: "Done",
      tasks: [
        {
          id: "t-setup",
          title: "Task",
          description: "Desc",
          owner: "teammate-1",
          files: ["README.md"],
          dependsOn: [],
          status: "complete",
          setup: [{ need: "Run tests", command: "npm test", reason: "Verify" }],
        },
      ],
      messages: [],
    },
  });
  await s.f.workbench.startSetupSession(setupRun.id, ["npm test"]);
  await waitUntil(
    () => !s.f.workbench.run(setupRun.id).session?.running && (s.f.workbench.run(setupRun.id).session?.messages.length ?? 0) >= 2,
    "setup session stop",
  );
  assert.deepEqual(s.f.workbench.run(setupRun.id).heldPaths, ["src/api/users.ts"]);

  const completedTeamFailed = await s.makeRun([s.ben.id], {
    status: "failed",
    error: withLocale("en", () =>
      sm().run.local.turnHeldByOther({ items: ["src/api/users.ts — Ada"] }),
    ),
    heldPaths: ["src/api/users.ts"],
    team: {
      phase: "integrating",
      config: { maxTeammates: 2, requirePlanApproval: false, provider: "codex", protocol: "bell-shared-tasks", messageDelivery: "between-turns" },
      planSummary: "All tasks integrated",
      tasks: [
        {
          id: "safe-keep",
          title: "Update keep.ts",
          description: "Update keep.ts",
          owner: "teammate-1",
          files: ["src/free/keep.ts"],
          dependsOn: [],
          status: "complete",
        },
      ],
      messages: [],
    },
  });
  await write(completedTeamFailed.worktreePath, "src/free/keep.ts", "export const keep = 10;\n");
  await write(completedTeamFailed.worktreePath, "src/api/users.ts", "export const users = ['bad'];\n");

  const restored = await s.restore(completedTeamFailed.id, s.who.member);
  assert.equal(restored.status, 200, restored.body);
  const body = restored.json as HoldRestoreResponse;
  assert.deepEqual(body.restored, ["src/api/users.ts"]);
  assert.equal(body.run.status, "review");
  assert.equal(body.run.team?.phase, "complete");
  assert.equal(body.run.error, undefined);
  assert.equal(body.run.heldPaths, undefined);
  assert.equal(
    await readFile(path.join(completedTeamFailed.worktreePath, "src/free/keep.ts"), "utf8"),
    "export const keep = 10;\n",
  );
  assert.equal(
    await readFile(path.join(completedTeamFailed.worktreePath, "src/api/users.ts"), "utf8"),
    seedFiles["src/api/users.ts"],
  );
  await s.release(s.who.admin, adaHold2);
});

test("POST /api/runs/:id/holds/restore restores modified, deleted, untracked, staged-added, and renamed held paths while preserving non-conflicting changes and logging localized notices", async (t) => {
  const s = await localScene(t);
  const adaHold = await s.hold(s.who.admin, ["src/api"], "API overhaul");
  const deeHold = await s.hold(s.who.dee, ["docs/guide.md"], "Guide rewrite");

  const run = await s.makeRun([s.ben.id], {
    status: "failed",
    error: withLocale("en", () =>
      sm().run.local.turnHeldByOther({ items: ["src/api/users.ts — Ada"] }),
    ),
    // What the stop records: every changed path under someone else's hold.
    heldPaths: [
      "docs/guide.md",
      "src/api/legacy.ts",
      "src/api/nested/staged-new.ts",
      "src/api/new-route.ts",
      "src/api/old-route.ts",
      "src/api/untracked-new.ts",
      "src/api/users.ts",
    ],
  });

  // Conflicting modifications, deletions, untracked additions, staged additions, and renames under held scopes:
  await write(run.worktreePath, "src/api/users.ts", "export const users = ['conflicting'];\n");
  await unlink(path.join(run.worktreePath, "src/api/legacy.ts"));
  await write(run.worktreePath, "src/api/untracked-new.ts", "export const u = 1;\n");
  await write(run.worktreePath, "src/api/nested/staged-new.ts", "export const s = 2;\n");
  await git(run.worktreePath, ["add", "--", "src/api/nested/staged-new.ts"]);
  await rename(
    path.join(run.worktreePath, "src/api/old-route.ts"),
    path.join(run.worktreePath, "src/api/new-route.ts"),
  );
  await write(run.worktreePath, "docs/guide.md", "Conflicting guide edit\n");

  // Non-conflicting edits that MUST remain untouched:
  await write(run.worktreePath, "README.md", "Ben's safe README change\n");
  await write(run.worktreePath, "src/free/added-safe.ts", "export const safe = true;\n");
  await unlink(path.join(run.worktreePath, "docs/obsolete.md"));

  const reply = await s.restore(run.id, s.who.member, english);
  assert.equal(reply.status, 200, reply.body);
  const payload = reply.json as HoldRestoreResponse;
  assert.deepEqual(
    payload.restored,
    [
      "docs/guide.md",
      "src/api/legacy.ts",
      "src/api/nested/staged-new.ts",
      "src/api/new-route.ts",
      "src/api/old-route.ts",
      "src/api/untracked-new.ts",
      "src/api/users.ts",
    ],
  );
  assert.equal(payload.run.status, "review");
  assert.equal(payload.run.error, undefined);
  assert.equal(payload.run.heldPaths, undefined);

  // Conflicting paths restored to base, staged/untracked additions deleted, empty nested dir pruned:
  assert.equal(
    await readFile(path.join(run.worktreePath, "src/api/users.ts"), "utf8"),
    seedFiles["src/api/users.ts"],
  );
  assert.equal(
    await readFile(path.join(run.worktreePath, "src/api/legacy.ts"), "utf8"),
    seedFiles["src/api/legacy.ts"],
  );
  assert.equal(
    await readFile(path.join(run.worktreePath, "src/api/old-route.ts"), "utf8"),
    seedFiles["src/api/old-route.ts"],
  );
  assert.equal(await exists(path.join(run.worktreePath, "src/api/new-route.ts")), false);
  assert.equal(await exists(path.join(run.worktreePath, "src/api/untracked-new.ts")), false);
  assert.equal(await exists(path.join(run.worktreePath, "src/api/nested/staged-new.ts")), false);
  assert.equal(await exists(path.join(run.worktreePath, "src/api/nested")), false);
  assert.equal(
    await readFile(path.join(run.worktreePath, "docs/guide.md"), "utf8"),
    seedFiles["docs/guide.md"],
  );

  // Non-conflicting paths untouched:
  assert.equal(
    await readFile(path.join(run.worktreePath, "README.md"), "utf8"),
    "Ben's safe README change\n",
  );
  assert.equal(
    await readFile(path.join(run.worktreePath, "src/free/added-safe.ts"), "utf8"),
    "export const safe = true;\n",
  );
  assert.equal(await exists(path.join(run.worktreePath, "docs/obsolete.md")), false);
  assert.deepEqual(
    (await readDiff(s.f.workbench.run(run.id))).map((f) => f.path).sort(),
    ["README.md", "docs/obsolete.md", "src/free/added-safe.ts"],
  );

  // English notice contains paths only, never holder names or hold titles.
  const enNotice = s.f.workbench.run(run.id).logs.at(-1);
  assert.equal(enNotice?.kind, "notice");
  assert.equal(
    enNotice?.message,
    withLocale("en", () => sm().run.local.heldPathsRestored({ files: payload.restored })),
  );
  for (const secret of ["Ada", "Dee", "API overhaul", "Guide rewrite"]) {
    assert.equal(enNotice?.message.includes(secret), false, secret);
  }

  // Also verify recorded `heldPaths` restore after the hold has already been released (and zh-TW locale notice),
  // plus approved -> review downgrade and empty-diff failed run staying failed!
  await s.release(s.who.admin, adaHold);
  await s.release(s.who.dee, deeHold);

  const approvedRun = await s.makeRun([s.ben.id], {
    status: "approved",
    approvedFingerprint: "deadbeef",
    heldPaths: ["src/api/users.ts"],
  });
  await write(approvedRun.worktreePath, "src/api/users.ts", "export const users = ['stale'];\n");
  await write(approvedRun.worktreePath, "README.md", "Still changed\n");
  const zhReply = await s.restore(approvedRun.id, s.who.member, chinese);
  assert.equal(zhReply.status, 200, zhReply.body);
  assert.deepEqual((zhReply.json as HoldRestoreResponse).restored, ["src/api/users.ts"]);
  assert.equal((zhReply.json as HoldRestoreResponse).run.status, "review");
  assert.equal((zhReply.json as HoldRestoreResponse).run.approvedFingerprint, undefined);
  assert.equal(
    s.f.workbench.run(approvedRun.id).logs.at(-1)?.message,
    "已將 1 個佔用檔案還原到任務基準：src/api/users.ts。",
  );

  // Failed run whose ONLY change was the held file stays failed (no empty review), and incomplete team run stays failed.
  const emptyAfter = await s.makeRun([s.ben.id], {
    status: "failed",
    error: withLocale("en", () => sm().run.local.turnHeldByOther({ items: ["src/api/users.ts"] })),
    heldPaths: ["src/api/users.ts"],
  });
  await write(emptyAfter.worktreePath, "src/api/users.ts", "export const users = ['only'];\n");
  const emptyRestored = await s.restore(emptyAfter.id, s.who.member, english);
  assert.equal(emptyRestored.status, 200, emptyRestored.body);
  assert.equal((emptyRestored.json as HoldRestoreResponse).run.status, "failed");
  assert.equal((emptyRestored.json as HoldRestoreResponse).run.heldPaths, undefined);
  assert.equal((emptyRestored.json as HoldRestoreResponse).run.error, undefined);

  const incompleteTeam = await s.makeRun([s.ben.id], {
    status: "failed",
    heldPaths: ["src/api/users.ts"],
    team: {
      phase: "developing",
      config: { maxTeammates: 2, requirePlanApproval: false, provider: "codex", protocol: "bell-shared-tasks", messageDelivery: "between-turns" },
      planSummary: "Incomplete team",
      tasks: [
        {
          id: "t1",
          title: "Task 1",
          description: "Desc",
          owner: "teammate-1",
          files: ["src/api/users.ts"],
          dependsOn: [],
          status: "failed",
        },
      ],
      messages: [],
    },
  });
  await write(incompleteTeam.worktreePath, "src/api/users.ts", "export const users = ['bad'];\n");
  await write(incompleteTeam.worktreePath, "README.md", "Keep\n");
  const teamRestored = await s.restore(incompleteTeam.id, s.who.member, english);
  assert.equal(teamRestored.status, 200, teamRestored.body);
  assert.equal((teamRestored.json as HoldRestoreResponse).run.status, "failed");
});

test("POST /api/runs/:id/holds/restore puts back only the recorded paths, and recovery returns only a hold-stopped run to review", async (t) => {
  const s = await localScene(t);
  await s.hold(s.who.admin, ["src/api"], "API overhaul");
  // Only a case-sensitive file system can keep ".Git/notes.txt" beside the checkout's own ".git".
  const odd = process.platform === "linux" ? [".Git/notes.txt"] : [];
  const run = await s.makeRun([s.ben.id], {
    status: "failed",
    error: withLocale("en", () => sm().run.local.turnHeldByOther({ items: ["src/api/users.ts"] })),
    // ".Git/notes.txt" cannot be compared with a hold: it names itself only, not every changed file.
    heldPaths: [".Git/notes.txt", "src/api/users.ts"],
  });
  for (const file of odd) await write(run.worktreePath, file, "notes\n");
  await write(run.worktreePath, "src/api/users.ts", "export const users = ['conflicting'];\n");
  // Changed under the hold after the stop, so the run page has not listed it yet.
  await write(run.worktreePath, "src/api/later.ts", "export const later = 1;\n");
  await write(run.worktreePath, "README.md", "Ben's README\n");

  const first = await s.restore(run.id, s.who.member, english);
  assert.equal(outcome(first), "409 heldByOther");
  assert.deepEqual(s.f.workbench.run(run.id).heldPaths, ["src/api/later.ts"]);
  // What was put back is in the run's log also when the answer is 409.
  assert.equal(
    s.f.workbench.run(run.id).logs.at(-1)?.message,
    withLocale("en", () =>
      sm().run.local.heldPathsRestored({ files: [...odd, "src/api/users.ts"] }),
    ),
  );
  assert.equal(await exists(path.join(run.worktreePath, ".Git/notes.txt")), false);
  assert.equal(
    await readFile(path.join(run.worktreePath, "src/api/users.ts"), "utf8"),
    seedFiles["src/api/users.ts"],
  );
  assert.equal(
    await readFile(path.join(run.worktreePath, "src/api/later.ts"), "utf8"),
    "export const later = 1;\n",
  );
  assert.equal(await readFile(path.join(run.worktreePath, "README.md"), "utf8"), "Ben's README\n");

  const second = await s.restore(run.id, s.who.member, english);
  assert.equal(second.status, 200, second.body);
  assert.deepEqual((second.json as HoldRestoreResponse).restored, ["src/api/later.ts"]);
  assert.equal((second.json as HoldRestoreResponse).run.status, "review");

  // A run that failed for another reason keeps its status when its holds are checked.
  const otherFailure = await s.makeRun([s.ben.id], { status: "failed", error: "The agent stopped." });
  await write(otherFailure.worktreePath, "README.md", "Half done\n");
  const rechecked = await s.recheck(otherFailure.id, s.who.member, english);
  assert.equal(rechecked.status, 200, rechecked.body);
  assert.equal(rechecked.json.run.status, "failed");
  assert.equal(rechecked.json.run.error, "The agent stopped.");
});

test("POST /api/runs/:id/holds/restore refuses symlink and path-traversal escapes with 422 without modifying external files", async (t) => {
  const s = await localScene(t);
  await s.hold(s.who.admin, ["src/api/users.ts"], "Users hold");

  const outsideDir = await mkdtemp(path.join(os.tmpdir(), "bell-hold-outside-"));
  t.after(() => rm(outsideDir, { recursive: true, force: true }));
  const outsideFile = path.join(outsideDir, "precious.txt");
  await writeFile(outsideFile, "DO NOT TOUCH\n");

  // 1. Leaf symlink pointing outside worktreePath.
  const leafRun = await s.makeRun([s.ben.id], { heldPaths: ["src/api/users.ts"] });
  await unlink(path.join(leafRun.worktreePath, "src/api/users.ts"));
  await symlink(outsideFile, path.join(leafRun.worktreePath, "src/api/users.ts"));
  const leafReply = await s.restore(leafRun.id, s.who.member);
  assert.equal(leafReply.status, 422, leafReply.body);
  assert.equal(await readFile(outsideFile, "utf8"), "DO NOT TOUCH\n");
  assert.equal((await lstat(path.join(leafRun.worktreePath, "src/api/users.ts"))).isSymbolicLink(), true);

  // 2. Ancestor directory replaced by symlink pointing outside worktreePath.
  const outsideSub = path.join(outsideDir, "api-dir");
  await mkdir(outsideSub);
  await writeFile(path.join(outsideSub, "users.ts"), "EXTERNAL DIR FILE\n");
  const dirRun = await s.makeRun([s.ben.id], { heldPaths: ["src/api/users.ts"] });
  await rm(path.join(dirRun.worktreePath, "src/api"), { recursive: true, force: true });
  await symlink(outsideSub, path.join(dirRun.worktreePath, "src/api"));
  const dirReply = await s.restore(dirRun.id, s.who.member);
  assert.equal(dirReply.status, 422, dirReply.body);
  assert.equal(await readFile(path.join(outsideSub, "users.ts"), "utf8"), "EXTERNAL DIR FILE\n");

  // 3. Traversal or `.git` path recorded in `run.heldPaths`.
  for (const unsafePath of ["../precious.txt", ".git/config"]) {
    const unsafeRun = await s.makeRun([s.ben.id], { heldPaths: [unsafePath] });
    // Where "../precious.txt" leads from the checkout.
    const beside = path.join(path.dirname(unsafeRun.worktreePath), "precious.txt");
    await writeFile(beside, "DO NOT TOUCH\n");
    await write(unsafeRun.worktreePath, "README.md", "Safe local edit\n");
    const unsafeReply = await s.restore(unsafeRun.id, s.who.member);
    assert.equal(unsafeReply.status, 422, `${unsafePath}: ${unsafeReply.body}`);
    assert.equal(await readFile(path.join(unsafeRun.worktreePath, "README.md"), "utf8"), "Safe local edit\n");
    assert.equal(await readFile(beside, "utf8"), "DO NOT TOUCH\n");
  }
});

test("POST /api/runs/:id/holds/recheck returns 409 heldByOther without modifying files while held, updates heldPaths on partial release, and clears state once released or revoked", async (t) => {
  const s = await localScene(t);
  const adaHold = await s.hold(s.who.admin, ["src/api/users.ts"], "Users lock");
  const deeHold = await s.hold(s.who.dee, ["docs/guide.md"], "Guide lock");

  const run = await s.makeRun([s.ben.id], {
    status: "failed",
    error: withLocale("en", () =>
      sm().run.local.turnHeldByOther({ items: ["src/api/users.ts", "docs/guide.md"] }),
    ),
    heldPaths: ["docs/guide.md", "src/api/users.ts"],
  });
  await write(run.worktreePath, "src/api/users.ts", "export const users = ['ben-kept'];\n");
  await write(run.worktreePath, "docs/guide.md", "Ben's guide kept\n");

  // 1. Both held -> 409 heldByOther, checkout untouched.
  const first = await s.recheck(run.id, s.who.member, english);
  assert.equal(outcome(first), "409 heldByOther");
  assert.equal(first.json.held.length, 2);
  assert.equal(await readFile(path.join(run.worktreePath, "src/api/users.ts"), "utf8"), "export const users = ['ben-kept'];\n");
  assert.equal(await readFile(path.join(run.worktreePath, "docs/guide.md"), "utf8"), "Ben's guide kept\n");
  assert.equal(s.f.workbench.run(run.id).status, "failed");

  // 2. Ada releases src/api/users.ts while Dee still holds docs/guide.md -> 409 naming only docs/guide.md, and heldPaths narrows.
  await s.release(s.who.admin, adaHold);
  const second = await s.recheck(run.id, s.who.member, chinese);
  assert.equal(outcome(second), "409 heldByOther");
  assert.deepEqual(
    second.json.held.map((h: { path: string }) => h.path),
    ["docs/guide.md"],
  );
  assert.match(second.json.error, /^Agent 改到別人佔用的檔案/);
  assert.deepEqual(s.f.workbench.run(run.id).heldPaths, ["docs/guide.md"]);

  // 3. Admin Ada revokes Dee's hold -> 200, files stay as Ben edited them, failed -> review, localized notice logged.
  await s.revoke(s.who.admin, deeHold);
  const third = await s.recheck(run.id, s.who.member, english);
  assert.equal(third.status, 200, third.body);
  const cleared = (third.json as HoldRecheckResponse).run;
  assert.equal(cleared.status, "review");
  assert.equal(cleared.error, undefined);
  assert.equal(cleared.heldPaths, undefined);
  assert.equal(await readFile(path.join(run.worktreePath, "src/api/users.ts"), "utf8"), "export const users = ['ben-kept'];\n");
  assert.equal(await readFile(path.join(run.worktreePath, "docs/guide.md"), "utf8"), "Ben's guide kept\n");
  assert.equal(
    s.f.workbench.run(run.id).logs.at(-1)?.message,
    "Checked file holds again: no changed files are held by someone else.",
  );

  // Verify zh-TW recheck notice as well.
  const zhRun = await s.makeRun([s.ben.id], { heldPaths: ["README.md"] });
  await write(zhRun.worktreePath, "README.md", "Updated\n");
  const zhRecheck = await s.recheck(zhRun.id, s.who.member, chinese);
  assert.equal(zhRecheck.status, 200, zhRecheck.body);
  assert.equal(
    s.f.workbench.run(zhRun.id).logs.at(-1)?.message,
    "已重新檢查檔案佔用：目前改到的檔案都沒有被其他人佔用。",
  );
});

for (const locale of ["en", "zh-TW"] as const) {
  test(`legacy runs saved before heldPaths existed never leak holder names or hold titles to agents and still clear hold-stop errors on restore/recheck (${locale})`, async (t) => {
    const s = await localScene(t, async (input) => {
      if (input.role === "session") {
        await write(input.cwd, "README.md", `Updated in ${locale}\n`);
        return JSON.stringify({
          reply: "Updated README.",
          questions: [],
          notRun: [],
          setup: [],
          limitations: "",
          validation: "",
        });
      }
      if (input.role === "draft") {
        return JSON.stringify({
          title: "fix: update readme",
          body: "## Problem\nP\n\n## Changes\nC\n\n## Validation\nV\n\n## Limitations\nL",
          policy: "repository",
          summary: "Summary",
          rules: [],
        });
      }
      return "Done.";
    });

    const secretTitle = `LEGACY-SECRET-TITLE-${locale}`;
    const legacyText = withLocale(locale, () =>
      sm().run.local.turnHeldByOther({
        items: [`src/api/users.ts — Ada: “${secretTitle}”`],
      }),
    );
    // The person quoting the stop: their own words reach the agent as written.
    const quoted = withLocale(locale, () =>
      sm().run.local.turnHeldByOther({ items: ["what does this stop mean?"] }),
    );

    const run = await s.makeRun([s.ben.id], {
      status: "failed",
      error: legacyText,
      sync: {
        at: new Date().toISOString(),
        from: "0".repeat(40),
        to: "1".repeat(40),
        snapshot: "2".repeat(40),
        conflicts: [],
        report: legacyText,
      },
      session: {
        running: false,
        revision: 1,
        updatedAt: new Date().toISOString(),
        messages: [
          { id: "m1", role: "user", content: "Change users", at: new Date().toISOString() },
          {
            id: "m2",
            role: "agent",
            content: legacyText,
            at: new Date().toISOString(),
            failed: true,
            changedFiles: ["src/api/users.ts"],
          },
          { id: "m3", role: "user", content: quoted, at: new Date().toISOString() },
        ],
      },
    });
    await write(run.worktreePath, "README.md", "Existing reviewable change\n");

    // Simulate reload from disk with no `heldPaths` anywhere.
    await s.f.start();
    s.f.workbench.status = agentsReady;
    assert.equal(s.f.workbench.run(run.id).heldPaths, undefined);
    assert.equal(s.f.workbench.run(run.id).session?.messages.length, 3);
    assert.equal(s.f.workbench.run(run.id).session?.messages[1].heldPaths, undefined);

    // Recheck clears legacy `run.error` and `run.sync.report` and transitions failed -> review.
    const checked = await s.recheck(run.id, s.who.member);
    assert.equal(checked.status, 200, checked.body);
    assert.equal(s.f.workbench.run(run.id).status, "review");
    assert.equal(s.f.workbench.run(run.id).error, undefined);
    assert.equal(s.f.workbench.run(run.id).sync?.report, undefined);

    // Subsequent session turn and PR draft generation receive `legacyHeldStop` and NEVER Ada or secretTitle!
    const genericLine =
      "BELL stopped this turn because it changed files other people hold; the changes are still in the checkout.";
    await s.session(run.id, "Update README cleanly");
    await s.f.workbench.prepareDraft(run.id);
    const sessionPromptText = s.turns.find((turn) => turn.role === "session")!.prompt;
    const draftPromptText = s.turns.filter((turn) => turn.role === "draft").at(-1)!.prompt;
    assert.equal(sessionPromptText.includes(genericLine), true);
    assert.equal(sessionPromptText.includes("what does this stop mean?"), true);
    assert.equal(draftPromptText.includes(genericLine), true);
    for (const turn of s.turns) {
      for (const secret of ["Ada", secretTitle]) {
        assert.equal(turn.prompt.includes(secret), false, `${locale} ${turn.role}: ${secret}`);
      }
    }
  });
}

test("follow-up rounds (restore against round.parentCommit & discardFollowUp) and sync conflict resolution (undoSync, including stopped group) maintain heldPaths accurately", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "bell-hold-rec-gh-"));
  const github = await fakeGitHub(tempRoot, {
    owner: "test-owner",
    name: "example",
    files: seedFiles,
  });
  t.after(async () => {
    github.restore();
    await rm(tempRoot, { recursive: true, force: true });
  });

  const f = await collabFixture(t, {
    runner: async (input) => {
      if (input.role === "followup") {
        await write(input.cwd, "src/api/users.ts", "export const users = ['followup-held'];\n");
        await write(input.cwd, "README.md", "Follow-up safe note\n");
        return JSON.stringify({
          summary: "Addressed review comment.",
          commitMessage: "fix: address review",
          addressed: [],
          notAddressed: [],
          setup: [],
        });
      }
      if (input.role === "sync") {
        await write(input.cwd, "README.md", "Resolved README conflict\n");
        await write(input.cwd, "src/api/users.ts", "export const users = ['sync-held'];\n");
        return JSON.stringify({
          summary: "Resolved conflict.",
          resolutions: [{ path: "README.md", resolution: "Combined both sides." }],
        });
      }
      return "Done.";
    },
  });
  f.workbench.status = agentsReady;
  const cast = await f.cast();
  const repo = await f.workbench.importRepository(github.url);
  await git(repo.path, ["config", "user.name", "BELL Test"]);
  await git(repo.path, ["config", "user.email", "test@example.invalid"]);
  await git(repo.path, ["config", "commit.gpgsign", "false"]);
  const added = await f.post("/projects", cast.who.admin, { repoId: repo.id });
  assert.equal(added.status, 201, added.body);
  const project = added.json.project.id as string;

  const holdRes = await f.post(`/projects/${project}/work`, cast.who.admin, {
    title: "Hold users",
    scopes: ["src/api/users.ts"],
  });
  assert.equal(holdRes.status, 201, holdRes.body);

  // --- Part A: Sync conflict resolution + undoSync ---
  const baseSha = (await git(repo.path, ["rev-parse", "refs/heads/main"])).stdout.trim();
  const syncWt = path.join(tempRoot, "wt-sync");
  await git(repo.path, ["branch", "--", "feat/sync-rec", baseSha]);
  await git(repo.path, ["worktree", "add", syncWt, "feat/sync-rec"]);
  await git(syncWt, ["config", "user.name", "BELL Test"]);
  await git(syncWt, ["config", "user.email", "test@example.invalid"]);
  await git(syncWt, ["config", "commit.gpgsign", "false"]);
  const syncRunObj: Run = {
    id: "sync-rec-run",
    repoId: repo.id,
    title: "Sync recovery",
    prompt: "Update README",
    status: "review",
    branch: "feat/sync-rec",
    baseBranch: "main",
    baseSha,
    worktreePath: syncWt,
    owners: [cast.ben.id],
    createdAt: new Date().toISOString(),
    agents: [],
    logs: [],
    draft: { title: "docs: readme", body: "Update readme.", commitMessage: "docs: readme" },
    reviewedFiles: [],
    reviewedFingerprints: {},
  };
  f.store.data.runs.push(syncRunObj);
  await f.store.save();
  await write(syncWt, "README.md", "Ben's local README line\n");
  await github.upstreamCommit({ "README.md": "Upstream README line\n" }, "upstream readme");

  const synced = await f.send("POST", `/api/runs/${syncRunObj.id}/sync`, { ...english, ...cast.who.member }, {});
  assert.equal(synced.status, 200, synced.body);
  assert.deepEqual(synced.json.conflicts, ["README.md"]);

  const resolveStarted = await f.send(
    "POST",
    `/api/runs/${syncRunObj.id}/sync/resolve`,
    { ...english, ...cast.who.member },
    {},
  );
  assert.equal(resolveStarted.status, 200, resolveStarted.body);
  await waitUntil(
    () => !f.workbench.run(syncRunObj.id).sync?.resolving && f.workbench.run(syncRunObj.id).status === "review",
    "conflict resolution stop",
  );
  assert.deepEqual(f.workbench.run(syncRunObj.id).heldPaths, ["src/api/users.ts"]);
  assert.match(f.workbench.run(syncRunObj.id).sync?.report ?? "", /The agent changed files someone else holds/);

  // Undo sync clears `run.heldPaths` because pre-sync snapshot only touched README.md!
  const undone = await f.send("POST", `/api/runs/${syncRunObj.id}/sync/undo`, { ...english, ...cast.who.member }, {});
  assert.equal(undone.status, 200, undone.body);
  assert.equal(f.workbench.run(syncRunObj.id).heldPaths, undefined);
  assert.equal(await readFile(path.join(syncWt, "src/api/users.ts"), "utf8"), seedFiles["src/api/users.ts"]);

  // --- Part B: Published PR follow-up round restore (against round.parentCommit) & discardFollowUp ---
  const pubWt = path.join(tempRoot, "wt-pub");
  const latestMain = await github.head("main");
  await git(repo.path, ["fetch", "-q", "origin", "main"]);
  await git(repo.path, ["branch", "--", "feat/pub-rec", latestMain]);
  await git(repo.path, ["worktree", "add", pubWt, "feat/pub-rec"]);
  await git(pubWt, ["config", "user.name", "BELL Test"]);
  await git(pubWt, ["config", "user.email", "test@example.invalid"]);
  await git(pubWt, ["config", "commit.gpgsign", "false"]);
  const pubRun: Run = {
    id: "pub-rec-run",
    repoId: repo.id,
    title: "Safe helper PR",
    prompt: "Update keep.ts",
    status: "review",
    branch: "feat/pub-rec",
    baseBranch: "main",
    baseSha: latestMain,
    worktreePath: pubWt,
    owners: [cast.ben.id],
    createdAt: new Date().toISOString(),
    agents: [],
    logs: [],
    draft: { title: "feat: update keep", body: "Updates keep.ts.", commitMessage: "feat: update keep" },
    reviewedFiles: [],
    reviewedFingerprints: {},
  };
  f.store.data.runs.push(pubRun);
  await f.store.save();
  await write(pubWt, "src/free/keep.ts", "export const keep = 2;\n");
  for (const file of await readDiff(f.workbench.run(pubRun.id))) {
    await f.workbench.review(pubRun.id, file.path, true, file.fingerprint);
  }
  await f.workbench.approve(pubRun.id, { ...f.workbench.run(pubRun.id).draft });
  const pre = await f.send("GET", `/api/runs/${pubRun.id}/preflight`, { ...english, ...cast.who.member });
  assert.equal(pre.status, 200, pre.body);
  const ack = (pre.json.checks as DraftCheck[]).filter((c) => c.kind === "confirm").map((c) => c.id);
  const pub = await f.send("POST", `/api/runs/${pubRun.id}/publish`, { ...english, ...cast.who.member }, {
    fingerprint: f.workbench.run(pubRun.id).approvedFingerprint,
    acknowledged: ack,
  });
  assert.equal(pub.status, 200, pub.body);

  // Start follow-up round 1: touches held src/api/users.ts + safe README.md; restore puts src/api/users.ts back to round.parentCommit while keeping src/free/keep.ts (PR commit) and README.md (round change)!
  const r1 = await f.send("POST", `/api/runs/${pubRun.id}/follow-ups`, { ...english, ...cast.who.member }, {
    feedbackUrls: [],
    note: "Please update docs too",
  });
  assert.equal(r1.status, 200, r1.body);
  await waitUntil(
    () =>
      f.workbench.run(pubRun.id).status === "review" &&
      f.workbench.run(pubRun.id).agents.find((a) => a.id === "followup")?.status === "failed",
    "follow-up round 1 stop",
  );
  await delay(20);
  assert.deepEqual(f.workbench.run(pubRun.id).heldPaths, ["src/api/users.ts"]);
  assert.match(f.workbench.run(pubRun.id).followUps![0].error ?? "", /The agent changed files someone else holds/);

  const restoredRound = await f.send(
    "POST",
    `/api/runs/${pubRun.id}/holds/restore`,
    { ...english, ...cast.who.member },
    {},
  );
  assert.equal(restoredRound.status, 200, restoredRound.body);
  assert.deepEqual((restoredRound.json as HoldRestoreResponse).restored, ["src/api/users.ts"]);
  assert.equal(f.workbench.run(pubRun.id).heldPaths, undefined);
  assert.equal(f.workbench.run(pubRun.id).followUps![0].error, undefined);
  // PR commit on src/free/keep.ts AND round edit on README.md both stay!
  assert.equal(await readFile(path.join(pubWt, "src/free/keep.ts"), "utf8"), "export const keep = 2;\n");
  assert.equal(await readFile(path.join(pubWt, "README.md"), "utf8"), "Follow-up safe note\n");
  assert.equal(await readFile(path.join(pubWt, "src/api/users.ts"), "utf8"), seedFiles["src/api/users.ts"]);

  // Discard round 1, then run round 2 so it stops on heldPaths again, and verify discardFollowUp clears run.heldPaths!
  const disc1 = await f.send("POST", `/api/runs/${pubRun.id}/follow-ups/discard`, { ...english, ...cast.who.member }, {});
  assert.equal(disc1.status, 200, disc1.body);

  const r2 = await f.send("POST", `/api/runs/${pubRun.id}/follow-ups`, { ...english, ...cast.who.member }, {
    feedbackUrls: [],
    note: "Try again",
  });
  assert.equal(r2.status, 200, r2.body);
  await waitUntil(
    () =>
      f.workbench.run(pubRun.id).status === "review" &&
      f.workbench.run(pubRun.id).agents.find((a) => a.id === "followup")?.status === "failed",
    "follow-up round 2 stop",
  );
  await delay(20);
  assert.deepEqual(f.workbench.run(pubRun.id).heldPaths, ["src/api/users.ts"]);
  const disc2 = await f.send("POST", `/api/runs/${pubRun.id}/follow-ups/discard`, { ...english, ...cast.who.member }, {});
  assert.equal(disc2.status, 200, disc2.body);
  assert.equal(f.workbench.run(pubRun.id).heldPaths, undefined);
  assert.equal(f.workbench.run(pubRun.id).status, "published");

  // Published PR with NO open follow-up round refuses restore/recheck with 409.
  assert.equal(
    (await f.send("POST", `/api/runs/${pubRun.id}/holds/restore`, { ...english, ...cast.who.member }, {})).status,
    409,
  );
  assert.equal(
    (await f.send("POST", `/api/runs/${pubRun.id}/holds/recheck`, { ...english, ...cast.who.member }, {})).status,
    409,
  );

  // Undo sync while group work is stopped does NOT abort local undo, and keeps heldPaths fail-closed.
  const syncedAgain = await f.send("POST", `/api/runs/${syncRunObj.id}/sync`, { ...english, ...cast.who.member }, {});
  assert.equal(syncedAgain.status, 200, syncedAgain.body);
  f.workbench.run(syncRunObj.id).heldPaths = ["src/api/users.ts"];
  await f.store.save();
  f.lock.release();
  assert.equal(f.collab.status().state, "stopped");
  const undoneWhileStopped = await f.send(
    "POST",
    `/api/runs/${syncRunObj.id}/sync/undo`,
    { ...english, ...cast.who.member },
    {},
  );
  assert.equal(undoneWhileStopped.status, 200, undoneWhileStopped.body);
  assert.deepEqual(f.workbench.run(syncRunObj.id).heldPaths, ["src/api/users.ts"]);
});

test("auth, stopped group, workspace_removed, busy/disallowed states, non-group repos, parallel runs, and privacy boundaries hold", async (t) => {
  const s = await localScene(t);
  const secretTitle = "TOP-SECRET-HOLD-TITLE-99";
  await s.hold(s.who.admin, ["src/api/users.ts"], secretTitle);

  // Outside-group repository is unaffected even when group work stops later.
  const outsideFolder = path.join(s.sources, "outside-repo");
  await mkdir(outsideFolder);
  await git(outsideFolder, ["init", "-q", "-b", "main"]);
  await git(outsideFolder, ["config", "user.name", "BELL Test"]);
  await git(outsideFolder, ["config", "user.email", "test@example.invalid"]);
  await git(outsideFolder, ["config", "commit.gpgsign", "false"]);
  await write(outsideFolder, "src/api/users.ts", "export const u = 0;\n");
  await git(outsideFolder, ["add", "--", "."]);
  await git(outsideFolder, ["commit", "-q", "-m", "init"]);
  const outsideRepo = await s.f.workbench.importRepository(outsideFolder);
  const outsideRun = await s.makeRun([s.ben.id], { heldPaths: ["src/api/users.ts"] }, outsideRepo.id, outsideRepo.path);
  await write(outsideRun.worktreePath, "src/api/users.ts", "export const u = 1;\n");

  // Parallel non-conflicting run in the group repository proceeds unaffected.
  const parallelRun = await s.makeRun([s.ben.id]);
  await write(parallelRun.worktreePath, "src/free/keep.ts", "export const keep = 99;\n");
  for (const file of await readDiff(s.f.workbench.run(parallelRun.id))) {
    await s.f.workbench.review(parallelRun.id, file.path, true, file.fingerprint);
  }
  const approvedParallel = await s.f.workbench.approve(parallelRun.id, {
    ...s.f.workbench.run(parallelRun.id).draft,
  });
  assert.equal(approvedParallel.status, "approved");

  // Conflicting run for guard checks.
  const run = await s.makeRun([s.ben.id], { heldPaths: ["src/api/users.ts"] });
  await write(run.worktreePath, "src/api/users.ts", "export const users = ['guard-check'];\n");

  // 1. 404 for unknown run ID and 400 for invalid body.
  assert.equal((await s.restore("missing-run-id", s.who.member)).status, 404);
  assert.equal((await s.recheck("missing-run-id", s.who.member)).status, 404);
  assert.equal((await s.restore(run.id, s.who.member, english, { unexpected: 1 })).status, 400);
  assert.equal((await s.recheck(run.id, s.who.member, english, { unexpected: 1 })).status, 400);

  // 2. 403 notJoined for unknown or removed participant tokens BEFORE touching checkout, with zero leak of Ada or secretTitle!
  const bogus = { ...s.devices.ben, [participantHeader]: `bpc_${"k".repeat(43)}` };
  for (const badCaller of [s.who.removed, bogus]) {
    for (const call of [s.restore(run.id, badCaller), s.recheck(run.id, badCaller)]) {
      const res = await call;
      assert.equal(outcome(res), "403 notJoined");
      assert.equal(res.body.includes("Ada"), false);
      assert.equal(res.body.includes(secretTitle), false);
    }
  }
  assert.equal(
    await readFile(path.join(run.worktreePath, "src/api/users.ts"), "utf8"),
    "export const users = ['guard-check'];\n",
  );

  // 3. 410 workspace_removed and 409 for disallowed/busy/missing-checkout states.
  const removedWs = await s.makeRun([s.ben.id], { workspaceRemovedAt: new Date().toISOString() });
  assert.equal((await s.restore(removedWs.id, s.who.member)).status, 410);
  assert.equal((await s.recheck(removedWs.id, s.who.member)).status, 410);

  for (const badStatus of ["queued", "running", "awaiting_plan", "cancelled"] as const) {
    const r = await s.makeRun([s.ben.id], { status: badStatus });
    assert.equal((await s.restore(r.id, s.who.member)).status, 409, badStatus);
    assert.equal((await s.recheck(r.id, s.who.member)).status, 409, badStatus);
  }

  const mergedPr = await s.makeRun([s.ben.id], {
    status: "review",
    prUrl: "https://github.com/test-owner/example/pull/1",
    prFeedback: {
      prNumber: 1,
      fetchedAt: new Date().toISOString(),
      prState: "MERGED",
      merged: true,
      items: [],
    },
  });
  assert.equal((await s.restore(mergedPr.id, s.who.member)).status, 409);
  assert.equal((await s.recheck(mergedPr.id, s.who.member)).status, 409);

  const busySession = await s.makeRun([s.ben.id], {
    session: { running: true, revision: 0, updatedAt: new Date().toISOString(), messages: [] },
  });
  assert.equal((await s.restore(busySession.id, s.who.member)).status, 409);
  assert.equal((await s.recheck(busySession.id, s.who.member)).status, 409);

  const missingDir = await s.makeRun([s.ben.id], {
    worktreePath: path.join(s.sources, "does-not-exist"),
  });
  assert.equal((await s.restore(missingDir.id, s.who.member)).status, 409);
  assert.equal((await s.recheck(missingDir.id, s.who.member)).status, 409);

  // 4. Stopped group work -> 503 holdsUnknown for group repository, checkout untouched; outside-group repository still works!
  s.f.lock.release();
  assert.equal(s.f.collab.status().state, "stopped");
  const stoppedRestore = await s.restore(run.id, s.who.member);
  assert.equal(outcome(stoppedRestore), "503 holdsUnknown");
  const stoppedRecheck = await s.recheck(run.id, s.who.member);
  assert.equal(outcome(stoppedRecheck), "503 holdsUnknown");
  assert.equal(
    await readFile(path.join(run.worktreePath, "src/api/users.ts"), "utf8"),
    "export const users = ['guard-check'];\n",
  );

  const outsideRecheck = await s.recheck(outsideRun.id, s.who.member);
  assert.equal(outsideRecheck.status, 200, outsideRecheck.body);
  assert.equal(s.f.workbench.run(parallelRun.id).status, "approved");
});

test("recheck and restore work during refreshAfterSession background draft/explanations while still blocking active checkout jobs", async (t) => {
  let releaseBackground!: () => void;
  const backgroundGate = new Promise<void>((resolve) => {
    releaseBackground = resolve;
  });
  let draftStarted = false;
  let explanationsStarted = false;

  const s = await localScene(t, async (input) => {
    if (input.role === "session") {
      await write(input.cwd, "src/api/users.ts", "export const users = ['session-conflict'];\n");
      await write(input.cwd, "src/free/keep.ts", "export const keep = 77;\n");
      return "Updated users and keep.";
    }
    if (input.role === "draft") {
      draftStarted = true;
      await backgroundGate;
      return JSON.stringify({
        title: "feat: stale draft",
        body: "## Problem\nOld.\n\n## Changes\nOld.\n\n## Validation\nOld.\n\n## Limitations\nNone.",
        policy: "repository",
        summary: "Old summary.",
        rules: [],
        checklist: [],
        templateSourceId: "",
        commitMessageSuggestion: null,
      });
    }
    if (input.role === "explanations") {
      explanationsStarted = true;
      await backgroundGate;
      return JSON.stringify({
        files: [
          {
            path: "src/api/users.ts",
            summary: "Changed users",
            reason: "Testing users",
            concept: "Array literal",
            tip: "Check users",
            example: { scenario: "Users list", before: "[]", after: "['session-conflict']" },
            alternatives: "Keep empty",
            lookup: ["array"],
            selfCheck: { question: "What changed?", answer: "Users list." },
          },
          {
            path: "src/free/keep.ts",
            summary: "Changed keep",
            reason: "Testing keep",
            concept: "Constant export",
            tip: "Check keep",
            example: { scenario: "Keep value", before: "1", after: "77" },
            alternatives: "Leave 1",
            lookup: ["const"],
            selfCheck: { question: "What is keep?", answer: "77." },
          },
        ],
      });
    }
    return "Done.";
  });

  const adaHold = await s.hold(s.who.admin, ["src/api/users.ts"], "Users lock");
  const run = await s.makeRun([s.ben.id]);
  const reply = await s.session(run.id, "Update both files");
  assert.match(reply.content, /someone else holds/);
  assert.deepEqual(s.f.workbench.run(run.id).heldPaths, ["src/api/users.ts"]);

  // Wait until refreshAfterSession has launched both isolated read-only jobs.
  await waitUntil(() => draftStarted && explanationsStarted, "background draft and explanations start");
  const internalCtx = (s.f.workbench as unknown as { context: { controllers: Map<string, AbortController>; jobs: Set<Promise<unknown>> } }).context;
  assert.equal(internalCtx.controllers.has(`draft:${run.id}`), true);
  assert.equal(internalCtx.controllers.has(`explanations:${run.id}`), true);
  internalCtx.controllers.set(`walkthrough:src/free/keep.ts:${run.id}`, new AbortController());

  // Genuine checkout readers/writers must still block with 409 holdRecoveryBusy.
  for (const blockingKey of [run.id, `premise:${run.id}`, `tests:${run.id}`, `guide:${run.id}`, `review:${run.id}`]) {
    internalCtx.controllers.set(blockingKey, new AbortController());
    try {
      const blockedRecheck = await s.recheck(run.id, s.who.member);
      assert.equal(blockedRecheck.status, 409, blockingKey);
      assert.match(blockedRecheck.json.error ?? "", /Work is still running/);
      const blockedRestore = await s.restore(run.id, s.who.member);
      assert.equal(blockedRestore.status, 409, blockingKey);
      assert.match(blockedRestore.json.error ?? "", /Work is still running/);
    } finally {
      internalCtx.controllers.delete(blockingKey);
    }
  }

  // With only refreshAfterSession (draft + explanations) + walkthrough active:
  // 1. Recheck runs immediately and returns 409 heldByOther (not holdRecoveryBusy).
  const stillHeld = await s.recheck(run.id, s.who.member);
  assert.equal(stillHeld.status, 409, stillHeld.body);
  assert.equal(stillHeld.json.reason, "heldByOther");

  // 2. Restore runs immediately, puts src/api/users.ts back, and keeps src/free/keep.ts.
  const restored = await s.restore(run.id, s.who.member);
  assert.equal(restored.status, 200, restored.body);
  assert.deepEqual((restored.json as HoldRestoreResponse).restored, ["src/api/users.ts"]);
  assert.equal(s.f.workbench.run(run.id).heldPaths, undefined);
  assert.equal(await readFile(path.join(run.worktreePath, "src/api/users.ts"), "utf8"), seedFiles["src/api/users.ts"]);
  assert.equal(await readFile(path.join(run.worktreePath, "src/free/keep.ts"), "utf8"), "export const keep = 77;\n");

  internalCtx.controllers.delete(`walkthrough:src/free/keep.ts:${run.id}`);
  releaseBackground();
  await Promise.allSettled([...internalCtx.jobs]);

  // Background explanations kept the surviving file and skipped the reverted one; pre-restore draft became stale.
  const finalRun = s.f.workbench.run(run.id);
  assert.equal(finalRun.explanations?.["src/free/keep.ts"]?.status, "ready");
  assert.equal(finalRun.explanations?.["src/api/users.ts"], undefined);
  assert.equal(finalRun.draftPreparation?.status, "stale");
  await s.release(s.who.admin, adaHold);
});
