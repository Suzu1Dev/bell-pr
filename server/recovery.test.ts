import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { request } from "node:http";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { command, git } from "./process.js";
import { readDiff } from "./git.js";
import { Store } from "./store.js";
import { Workbench } from "./workbench.js";
import { createApp } from "./app.js";
import { withLocale } from "./i18n/index.js";
import type { TeamAgentRunner } from "./team.js";
import type { Database, Repository, Run } from "./types.js";
import { after, before } from "node:test";
import { skipUnderstandingCheckInTests } from "./understanding.js";

// This file tests other behaviour; server/understanding.test.ts covers the gate.
before(() => skipUnderstandingCheckInTests(true));
after(() => skipUnderstandingCheckInTests());

const prUrl = "https://github.com/test-owner/example/pull/1";

async function waitUntil(predicate: () => boolean, message: string) {
  const end = Date.now() + 10_000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${message}`);
    await delay(10);
  }
}

/** A temporary directory with a Git repository holding hello.ts on main. */
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-recovery-test-"));
  const repository = path.join(directory, "repo");
  await mkdir(repository);
  await git(repository, ["init", "-b", "main"]);
  await git(repository, ["config", "user.name", "BELL Test"]);
  await git(repository, ["config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(repository, "hello.ts"), 'export const hello = "before";\n');
  await git(repository, ["add", "hello.ts"]);
  await git(repository, ["commit", "-m", "initial"]);
  const baseSha = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();
  const dataDir = path.join(directory, "state");
  const previousPath = process.env.PATH;
  const deferred: (() => Promise<unknown>)[] = [];
  return {
    directory,
    repository,
    baseSha,
    dataDir,
    statePath: path.join(dataDir, "state.json"),
    /** Puts stand-in executables first on PATH until cleanup. */
    async binaries(scripts: Record<string, string>) {
      const bin = path.join(directory, "bin");
      await mkdir(bin, { recursive: true });
      for (const [name, source] of Object.entries(scripts))
        await writeFile(path.join(bin, name), source, { mode: 0o700 });
      process.env.PATH = `${bin}${path.delimiter}${previousPath}`;
    },
    /** Runs `fn` at cleanup, before the directory goes (last added, first run). */
    defer(fn: () => Promise<unknown>) {
      deferred.unshift(fn);
    },
    cleanup: async () => {
      for (const fn of deferred) await fn();
      process.env.PATH = previousPath;
      await rm(directory, { recursive: true, force: true });
    },
  };
}

/** Answers every CLI probe of GET /api/status without a real agent CLI. */
const statusClis = {
  codex: "#!/bin/sh\necho 'codex-cli 0.0.0-test'\n",
  claude: "#!/bin/sh\necho '0.0.0-test (Claude Code)'\n",
  gh: "#!/bin/sh\necho test-owner\n",
};

function repository(repoPath: string): Repository {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "greeting",
    owner: "local",
    fullName: "local/greeting",
    path: repoPath,
    defaultBranch: "main",
    url: "",
  };
}

/** A run in the shape Workbench writes, in review. */
function reviewRun(id: string, repo: Repository, worktreePath: string, baseSha: string): Run {
  return {
    id,
    repoId: repo.id,
    title: "Improve greeting",
    prompt: "Improve the greeting text",
    status: "review",
    branch: `fix/${id.slice(0, 8)}`,
    baseBranch: "main",
    baseSha,
    worktreePath,
    createdAt: "2026-10-12T00:00:00.000Z",
    locale: "en",
    agents: [
      { id: "lead", name: "Atlas", role: "Team lead", status: "complete", detail: "Done" },
    ],
    logs: [{ time: "2026-10-12T00:00:01.000Z", agent: "lead", message: "Started" }],
    draft: { title: "Improve greeting", body: "A clearer greeting." },
    reviewedFiles: [],
    reviewedFingerprints: {},
    reports: {},
  };
}

/** A run that was created and queued but never started. */
function queuedRun(id: string, repo: Repository, dataDir: string, createdAt: string): Run {
  return {
    id,
    repoId: repo.id,
    title: `Queued ${id}`,
    prompt: "Improve the greeting text",
    status: "queued",
    branch: `fix/${id.slice(0, 8)}`,
    baseBranch: "main",
    baseSha: "",
    worktreePath: path.join(dataDir, "worktrees", id),
    createdAt,
    locale: "en",
    agents: [
      { id: "lead", name: "Atlas", role: "Team lead", status: "waiting", detail: "Waiting" },
      { id: "reviewer", name: "Lens", role: "Reviewer", status: "waiting", detail: "Waiting" },
      { id: "tester", name: "Scout", role: "Test analyst", status: "waiting", detail: "Waiting" },
    ],
    logs: [],
    draft: { title: `Queued ${id}`, body: "" },
    reviewedFiles: [],
    reviewedFingerprints: {},
    reports: {},
    modelExecution: { provider: "codex", source: "cli-default" },
    team: {
      config: {
        maxTeammates: 2,
        requirePlanApproval: true,
        provider: "codex",
        protocol: "bell-shared-tasks",
        messageDelivery: "between-turns",
      },
      phase: "planning",
      planSummary: "",
      tasks: [],
      messages: [],
    },
  };
}

async function writeState(dataDir: string, state: unknown) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, "state.json"), JSON.stringify(state));
}

/** GET or a JSON request through the app on a free port. */
async function call(
  app: ReturnType<typeof createApp>,
  method: string,
  url: string,
  body?: unknown,
) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are read field by field
    return await new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = request(
        `http://127.0.0.1:${address.port}${url}`,
        {
          method,
          headers: {
            host: "127.0.0.1:4311",
            "content-type": "application/json",
            "x-bell-locale": "en",
          },
        },
        (response) => {
          let text = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => (text += chunk));
          response.on("end", () =>
            resolve({ status: response.statusCode!, body: JSON.parse(text) }),
          );
        },
      );
      req.on("error", reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("a truncated state.json comes back from the newest valid backup and /api/status shows the recovery", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const repo = repository(f.repository);
  const state: Database = {
    version: 1,
    repos: [repo],
    runs: [reviewRun("run-a", repo, f.repository, f.baseSha)],
  };
  await writeState(f.dataDir, state);
  // Two earlier starts left two backups; the newer one is damaged too.
  for (let start = 0; start < 2; start++) await new Store(f.dataDir).initialize();
  assert.deepEqual(
    (await readdir(f.dataDir)).filter((name) => name.includes(".bak.")).sort(),
    ["state.json.bak.1", "state.json.bak.2"],
  );
  const written = await readFile(f.statePath, "utf8");
  await writeFile(f.statePath, written.slice(0, Math.floor(written.length / 2)));
  await writeFile(`${f.statePath}.bak.1`, "");

  const store = new Store(f.dataDir);
  await store.initialize();
  assert.deepEqual(store.recovery, {
    restoredFrom: "state.json.bak.2",
    quarantinedRuns: 0,
  });
  assert.deepEqual(store.data, state);
  // The broken file is kept for inspection, and state.json is whole again.
  const corrupt = (await readdir(f.dataDir)).filter((name) =>
    name.startsWith("state.json.corrupt-"),
  );
  assert.equal(corrupt.length, 1);
  assert.equal(
    await readFile(path.join(f.dataDir, corrupt[0]), "utf8"),
    written.slice(0, Math.floor(written.length / 2)),
  );
  assert.deepEqual(JSON.parse(await readFile(f.statePath, "utf8")), state);

  await f.binaries(statusClis);
  const workbench = new Workbench(store);
  f.defer(() => workbench.shutdown());
  const status = await call(createApp(workbench), "GET", "/api/status");
  assert.equal(status.status, 200);
  assert.deepEqual(status.body.recovery, {
    restoredFrom: "state.json.bak.2",
    quarantinedRuns: 0,
  });
  assert.equal(status.body.codex, true);

  // The next start is clean and shows no notice.
  const next = new Store(f.dataDir);
  await next.initialize();
  assert.equal(next.recovery, undefined);
});

test("without a readable backup a damaged state.json still stops the start and stays in place", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  await writeState(f.dataDir, { version: 1, repos: [], runs: [] });
  await writeFile(f.statePath, '{"version":1,"repos":[');
  await writeFile(`${f.statePath}.bak.1`, "{ not json");
  await assert.rejects(new Store(f.dataDir).initialize(), /state\.json/);
  assert.equal(await readFile(f.statePath, "utf8"), '{"version":1,"repos":[');
  assert.ok(
    !(await readdir(f.dataDir)).some((name) => name.includes("corrupt")),
  );
});

test("one malformed run is quarantined while the others load", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const repo = repository(f.repository);
  const good = reviewRun("run-good", repo, f.repository, f.baseSha);
  const other = { ...reviewRun("run-other", repo, f.repository, f.baseSha), status: "published" as const, prUrl };
  const broken = {
    ...reviewRun("run-broken", repo, f.repository, f.baseSha),
    agents: "not a list",
  };
  const unknownStatus = { ...reviewRun("run-status", repo, f.repository, f.baseSha), status: "paused" };
  await writeState(f.dataDir, {
    version: 1,
    repos: [repo],
    runs: [good, broken, other, unknownStatus],
  });
  const store = new Store(f.dataDir);
  await withLocale("en", () => store.initialize());
  assert.deepEqual(
    store.data.runs.map((run) => run.id),
    ["run-good", "run-other"],
  );
  assert.deepEqual(store.recovery, { quarantinedRuns: 2 });
  const quarantine = JSON.parse(
    await readFile(path.join(f.dataDir, "state.quarantine.json"), "utf8"),
  );
  assert.deepEqual(
    quarantine.runs.map((entry: { run: { id: string } }) => entry.run.id),
    ["run-broken", "run-status"],
  );
  // The whole record is kept, with the reason and without data loss.
  assert.deepEqual(quarantine.runs[0].run, broken);
  assert.match(quarantine.runs[0].reason, /^agents: /);
  assert.match(quarantine.runs[1].reason, /^status: /);
  assert.ok(quarantine.runs[0].quarantinedAt);
  // state.json no longer holds them, so the next start is clean.
  const saved = JSON.parse(await readFile(f.statePath, "utf8")) as Database;
  assert.deepEqual(saved.runs.map((run) => run.id), ["run-good", "run-other"]);
  const next = new Store(f.dataDir);
  await next.initialize();
  assert.equal(next.recovery, undefined);
  assert.equal(next.data.runs.length, 2);
  // A later quarantine adds to the file instead of replacing it.
  await writeState(f.dataDir, {
    ...saved,
    repos: [...saved.repos, { id: "bad-repo" }],
    runs: [...saved.runs, { id: "run-later" }],
  });
  const third = new Store(f.dataDir);
  await third.initialize();
  assert.deepEqual(third.recovery, { quarantinedRuns: 1, quarantinedRepos: 1 });
  assert.deepEqual(third.data.repos.map((value) => value.id), [repo.id]);
  const grown = JSON.parse(
    await readFile(path.join(f.dataDir, "state.quarantine.json"), "utf8"),
  );
  assert.deepEqual(
    grown.runs.map((entry: { run: { id: string } }) => entry.run.id),
    ["run-broken", "run-status", "run-later"],
  );
  assert.deepEqual(grown.repos.map((entry: { repo: { id: string } }) => entry.repo.id), ["bad-repo"]);
});

test("fields from a newer build survive a load, an edit and a save at every level", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const repo = { ...repository(f.repository), futureRepoField: { kept: 1 } };
  const run = {
    ...reviewRun("run-future", repo, f.repository, f.baseSha),
    futureRunField: ["kept"],
    agents: [
      {
        id: "lead",
        name: "Atlas",
        role: "Team lead",
        status: "complete",
        detail: "Done",
        futureAgentField: true,
      },
    ],
    draft: { title: "Improve greeting", body: "A clearer greeting.", futureDraftField: "x" },
    explanations: {
      "hello.ts": { fingerprint: "a".repeat(64), status: "pending", futureExplanationField: 2 },
    },
    team: {
      config: {
        maxTeammates: 2,
        requirePlanApproval: true,
        provider: "codex",
        protocol: "bell-shared-tasks",
        messageDelivery: "between-turns",
        futureConfigField: "x",
      },
      phase: "complete",
      planSummary: "One task",
      tasks: [
        {
          id: "task-1",
          title: "Greeting",
          description: "Change hello.ts",
          owner: "member-1",
          files: ["hello.ts"],
          dependsOn: [],
          status: "complete",
          futureTaskField: { deep: [1, 2] },
        },
      ],
      messages: [],
    },
    followUps: [
      {
        id: "round-1",
        requestedAt: "2026-10-12T00:00:02.000Z",
        feedbackUrls: [],
        status: "discarded",
        parentCommit: f.baseSha,
        futureRoundField: "kept",
      },
    ],
  };
  const state = { version: 1, futureTopField: { kept: true }, repos: [repo], runs: [run] };
  await writeState(f.dataDir, state);
  const store = new Store(f.dataDir);
  await store.initialize();
  assert.deepEqual(store.data, state);
  // An edit through the Workbench writes every unknown field back.
  const workbench = new Workbench(store);
  f.defer(() => workbench.shutdown());
  await writeFile(path.join(f.repository, "hello.ts"), 'export const hello = "after";\n');
  await workbench.saveNote("run-future", "hello.ts", "Greets more clearly.");
  const reopened = new Store(f.dataDir);
  await reopened.initialize();
  const [saved] = reopened.data.runs as unknown as (typeof run & { notes: unknown })[];
  assert.deepEqual(saved.futureRunField, ["kept"]);
  assert.equal(saved.agents[0].futureAgentField, true);
  assert.equal(saved.draft.futureDraftField, "x");
  assert.equal(saved.team.config.futureConfigField, "x");
  assert.deepEqual(saved.team.tasks[0].futureTaskField, { deep: [1, 2] });
  assert.equal(saved.followUps[0].futureRoundField, "kept");
  assert.ok(saved.notes);
  assert.deepEqual(
    (reopened.data as unknown as typeof state).futureTopField,
    { kept: true },
  );
  assert.deepEqual(
    (reopened.data.repos[0] as unknown as typeof repo).futureRepoField,
    { kept: 1 },
  );
});

/** Stand-ins for every remote git and gh call of a first publish. */
function publishBinaries(f: Awaited<ReturnType<typeof fixture>>, realGit: string) {
  const calls = path.join(f.directory, "remote-calls");
  const snapshot = path.join(f.directory, "crash-snapshot.json");
  const crashed = path.join(f.directory, "crashed");
  return {
    calls,
    snapshot,
    scripts: {
      git: `#!/usr/bin/env node
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args.includes('push') || args.includes('ls-remote')) {
  fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(['git', ...args]) + '\\n');
  process.exit(0);
}
if (args.includes('fetch') || args.includes('clone')) process.exit(98);
const result = spawnSync(${JSON.stringify(realGit)}, args, { stdio: 'inherit', env: process.env });
process.exit(result.status ?? 1);
`,
      gh: `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(['gh', ...args]) + '\\n');
if (args[0] === 'api' && args[1] === 'user') console.log('test-owner');
else if (args[0] === 'api') console.log(${JSON.stringify(f.baseSha)});
else if (args[0] === 'repo' && args[1] === 'view') console.log(JSON.stringify({viewerPermission:'WRITE',defaultBranchRef:{name:'main'}}));
else if (args[0] === 'pr' && args[1] === 'list') {
  // The first time, the server "crashes" here: after the push, before the PR.
  if (!fs.existsSync(${JSON.stringify(crashed)})) {
    fs.copyFileSync(${JSON.stringify(f.statePath)}, ${JSON.stringify(snapshot)});
    fs.writeFileSync(${JSON.stringify(crashed)}, '1');
    process.exit(1);
  }
  console.log('[]');
}
else if (args[0] === 'pr' && args[1] === 'create') console.log(${JSON.stringify(prUrl)});
else process.exit(97);
`,
    },
  };
}

test("a run interrupted while publishing is approved again after a restart and then publishes", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const realGit = (await command("which", ["git"])).stdout.trim();
  const remote = publishBinaries(f, realGit);
  await f.binaries(remote.scripts);
  const store = new Store(f.dataDir);
  await store.initialize();
  const workbench = new Workbench(store);
  // Imported in place by an earlier build: the run works in the checkout.
  const repo = Object.assign(repository(f.repository), {
    url: "https://github.com/test-owner/example",
    fullName: "test-owner/example",
    owner: "test-owner",
    name: "example",
  });
  store.data.repos.push(repo);
  const run = reviewRun("run-publish", repo, f.repository, f.baseSha);
  run.draft.commitMessage = "Improve the greeting";
  store.data.runs.push(run);
  await git(f.repository, ["checkout", "-q", "-b", run.branch]);
  await writeFile(path.join(f.repository, "hello.ts"), 'export const hello = "after";\n');
  for (const file of await readDiff(run))
    await workbench.review(run.id, file.path, true, file.fingerprint);
  await workbench.approve(run.id, { ...run.draft });
  const approved = run.approvedFingerprint!;
  await assert.rejects(workbench.publish(run.id, approved));
  await workbench.shutdown();

  // Restart from the disk as the crash left it: pushed, PR not yet created.
  const crashState = JSON.parse(await readFile(remote.snapshot, "utf8")) as Database;
  assert.equal(crashState.runs[0].publishing, true);
  assert.ok(crashState.runs[0].publishCommit);
  await copyFile(remote.snapshot, f.statePath);
  const restarted = new Store(f.dataDir);
  await withLocale("zh-TW", () => restarted.initialize());
  const [recovered] = restarted.data.runs;
  assert.equal(recovered.status, "approved");
  assert.equal(recovered.publishing, false);
  assert.equal(recovered.approvedFingerprint, approved);
  // Worded in the run's language, whatever the server's default.
  assert.equal(
    recovered.error,
    "Publishing was interrupted. Check GitHub, then publish again.",
  );
  const pushedCommit = recovered.publishCommit;

  const second = new Workbench(restarted);
  f.defer(() => second.shutdown());
  await second.publish(recovered.id, approved);
  assert.equal(recovered.status, "published");
  assert.equal(recovered.prUrl, prUrl);
  assert.equal(recovered.error, undefined);
  // The same reviewed commit went out again; no second commit was made.
  assert.equal(recovered.publishCommit, pushedCommit);
  const pushes = (await readFile(remote.calls, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as string[])
    .filter((call) => call.includes("push"));
  assert.equal(pushes.length, 2);
  assert.equal(pushes[0].at(-1), pushes[1].at(-1));
});

test("a queued run resumes after a restart, oldest first, while a started one fails as before", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const repo = repository(f.repository);
  const newer = queuedRun("bbbbbbbb-0000-4000-8000-000000000002", repo, f.dataDir, "2026-10-12T00:00:02.000Z");
  const older = queuedRun("aaaaaaaa-0000-4000-8000-000000000001", repo, f.dataDir, "2026-10-12T00:00:01.000Z");
  // Queued again after its plan was approved: it has a worktree already.
  const started = {
    ...queuedRun("cccccccc-0000-4000-8000-000000000003", repo, f.dataDir, "2026-10-12T00:00:00.000Z"),
    baseSha: f.baseSha,
  };
  // Its project is gone, so it cannot start.
  const orphaned = {
    ...queuedRun("eeeeeeee-0000-4000-8000-000000000005", repo, f.dataDir, "2026-10-12T00:00:03.000Z"),
    repoId: "missing-repository",
  };
  await writeState(f.dataDir, {
    version: 1,
    repos: [repo],
    runs: [newer, older, started, orphaned],
  });
  const store = new Store(f.dataDir);
  await store.initialize();
  const byId = (id: string) => store.data.runs.find((run) => run.id === id)!;
  assert.equal(byId(newer.id).status, "queued");
  assert.equal(byId(older.id).status, "queued");
  assert.equal(byId(started.id).status, "failed");
  assert.equal(byId(orphaned.id).status, "queued");

  const order: string[] = [];
  const plan = JSON.stringify({
    summary: "Update the greeting.",
    revisionNotes: null,
    tasks: [
      {
        id: "greeting",
        title: "Update greeting",
        description: "Change the greeting in hello.ts.",
        files: ["hello.ts"],
        dependsOn: [],
      },
    ],
  });
  const runner: TeamAgentRunner = async (input) => {
    assert.equal(input.role, "lead");
    order.push(path.basename(input.cwd));
    return plan;
  };
  const workbench = new Workbench(store, runner, { maxActiveRuns: 1 });
  f.defer(() => workbench.shutdown());
  await waitUntil(
    () => byId(newer.id).status === "awaiting_plan" && byId(older.id).status === "awaiting_plan",
    "both queued runs to reach their plans",
  );
  assert.deepEqual(order, [older.id, newer.id]);
  assert.equal(byId(orphaned.id).status, "failed");
  assert.equal(byId(orphaned.id).error, "Repository not found.");
  const resumed = byId(older.id);
  assert.equal(resumed.baseSha, f.baseSha);
  assert.equal(resumed.team?.tasks.length, 1);
  assert.equal(resumed.logs[0].message, "The service restarted; this run is queued again.");
  // The worktree was created by the resumed run.
  assert.equal(
    (await git(resumed.worktreePath, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim(),
    resumed.branch,
  );
});

test("a run left without a plan retries from planning", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const repo = repository(f.repository);
  const failed: Run = {
    ...queuedRun("dddddddd-0000-4000-8000-000000000004", repo, f.dataDir, "2026-10-12T00:00:00.000Z"),
    status: "failed",
    error: "The service restarted, so the run stopped.",
  };
  failed.agents[0].status = "failed";
  failed.team!.phase = "failed";
  await writeState(f.dataDir, { version: 1, repos: [repo], runs: [failed] });
  const store = new Store(f.dataDir);
  await store.initialize();
  const prompts: string[] = [];
  const workbench = new Workbench(store, async (input) => {
    prompts.push(input.prompt);
    return JSON.stringify({
      summary: "Update the greeting.",
      revisionNotes: null,
      tasks: [
        { id: "greeting", title: "Greeting", description: "Change hello.ts.", files: ["hello.ts"], dependsOn: [] },
      ],
    });
  });
  f.defer(() => workbench.shutdown());
  const run = store.data.runs[0];
  await withLocale("en", () => workbench.retryTeam(run.id, "Keep the change small."));
  assert.equal(run.error, undefined);
  assert.equal(run.logs.at(-1)?.message, "Retrying the run: the lead plans the task again.");
  await waitUntil(() => run.status === "awaiting_plan", "the new plan");
  assert.equal(run.team?.phase, "awaiting_approval");
  assert.match(prompts[0], /Keep the change small\./);
});

/** Stand-ins for a published PR's remote: push and ls-remote record, gh answers. */
function roundBinaries(f: Awaited<ReturnType<typeof fixture>>, realGit: string) {
  const remoteHead = path.join(f.directory, "remote-head");
  const snapshot = path.join(f.directory, "round-snapshot.json");
  const crashAt = path.join(f.directory, "crash-at-push");
  return {
    remoteHead,
    snapshot,
    crashAt,
    scripts: {
      git: `#!/usr/bin/env node
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args.includes('push')) {
  if (fs.existsSync(${JSON.stringify(crashAt)})) {
    fs.rmSync(${JSON.stringify(crashAt)});
    fs.copyFileSync(${JSON.stringify(f.statePath)}, ${JSON.stringify(snapshot)});
    process.exit(1);
  }
  fs.writeFileSync(${JSON.stringify(remoteHead)}, args.at(-1).split(':')[0]);
  process.exit(0);
}
if (args.includes('ls-remote')) {
  const head = fs.existsSync(${JSON.stringify(remoteHead)}) ? fs.readFileSync(${JSON.stringify(remoteHead)}, 'utf8') : '';
  if (head) console.log(head + '\\t' + args.at(-1));
  process.exit(0);
}
if (args.includes('fetch') || args.includes('clone')) process.exit(98);
const result = spawnSync(${JSON.stringify(realGit)}, args, { stdio: 'inherit', env: process.env });
process.exit(result.status ?? 1);
`,
      gh: `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'api' && args[1] === 'user') console.log('test-owner');
else if (args[0] === 'api' && String(args[1]).endsWith('/pulls/1/commits')) console.log('');
else if (args[0] === 'api') console.log(${JSON.stringify(f.baseSha)});
else if (args[0] === 'repo' && args[1] === 'view') console.log(JSON.stringify({viewerPermission:'WRITE',defaultBranchRef:{name:'main'}}));
else if (args[0] === 'pr' && args[1] === 'list') console.log('[]');
else if (args[0] === 'pr' && args[1] === 'create') console.log(${JSON.stringify(prUrl)});
else if (args[0] === 'pr' && args[1] === 'view') console.log('OPEN');
else process.exit(97);
`,
    },
  };
}

test("a restart during a round's push reopens the round for review with the PR intact, and it can be pushed again", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const realGit = (await command("which", ["git"])).stdout.trim();
  const remote = roundBinaries(f, realGit);
  await f.binaries(remote.scripts);
  const runner: TeamAgentRunner = async (input) => {
    await writeFile(path.join(input.cwd, "hello.ts"), 'export const hello = "world";\n');
    return JSON.stringify({
      summary: "Changed the greeting to world.",
      addressed: [],
      notAddressed: [],
      checks: [],
      commitMessage: "Greet the world",
    });
  };
  const store = new Store(f.dataDir);
  await store.initialize();
  const workbench = new Workbench(store, runner);
  // Imported in place by an earlier build: the run works in the checkout.
  const repo = Object.assign(repository(f.repository), {
    url: "https://github.com/test-owner/example",
    fullName: "test-owner/example",
    owner: "test-owner",
    name: "example",
  });
  store.data.repos.push(repo);
  const run = reviewRun("run-round", repo, f.repository, f.baseSha);
  run.draft.commitMessage = "Improve the greeting";
  store.data.runs.push(run);
  await git(f.repository, ["checkout", "-q", "-b", run.branch]);
  const reviewAll = async (bench: Workbench, target: Run) => {
    for (const file of await readDiff(target))
      await bench.review(target.id, file.path, true, file.fingerprint);
  };
  await writeFile(path.join(f.repository, "hello.ts"), 'export const hello = "after";\n');
  await reviewAll(workbench, run);
  await workbench.approve(run.id, { ...run.draft });
  await workbench.publish(run.id, run.approvedFingerprint!);
  assert.equal(run.status, "published");
  const firstCommit = run.publishCommit!;
  await workbench.startFollowUp(run.id, { feedbackUrls: [], note: "Greet the world." });
  await waitUntil(() => run.status !== "running", "the round");
  assert.equal(run.status, "review");
  await reviewAll(workbench, run);
  await workbench.approve(run.id, { ...run.draft });
  await writeFile(remote.crashAt, "1");
  await assert.rejects(workbench.publish(run.id, run.approvedFingerprint!));
  await workbench.shutdown();

  const crashState = JSON.parse(await readFile(remote.snapshot, "utf8")) as Database;
  assert.equal(crashState.runs[0].publishing, true);
  await copyFile(remote.snapshot, f.statePath);
  const restarted = new Store(f.dataDir);
  await restarted.initialize();
  const [recovered] = restarted.data.runs;
  const round = recovered.followUps!.at(-1)!;
  assert.equal(recovered.status, "review");
  assert.equal(recovered.publishing, false);
  assert.equal(recovered.approvedFingerprint, undefined);
  assert.equal(recovered.prUrl, prUrl);
  assert.equal(recovered.publishCommit, firstCommit);
  assert.equal(round.status, "review");
  assert.ok(round.commit);
  // The first-publish text never replaces a round's own state.
  assert.notEqual(recovered.error, "Publishing was interrupted. Check GitHub, then publish again.");

  const second = new Workbench(restarted, runner);
  f.defer(() => second.shutdown());
  await reviewAll(second, recovered);
  await second.approve(recovered.id, { ...recovered.draft });
  await second.publish(recovered.id, recovered.approvedFingerprint!);
  assert.equal(recovered.status, "published");
  assert.equal(round.status, "published");
  assert.equal(recovered.publishCommit, round.commit);
  assert.equal(await readFile(remote.remoteHead, "utf8"), round.commit);
});

test("a restart during a conflict resolution reopens the run in review and the conflicts read again", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const repo = repository(f.repository);
  await writeFile(
    path.join(f.repository, "hello.ts"),
    '<<<<<<< latest main\nexport const hello = "main";\n=======\nexport const hello = "mine";\n>>>>>>> this contribution\n',
  );
  const run = {
    ...reviewRun("run-conflict", repo, f.repository, f.baseSha),
    status: "running" as const,
    agents: [
      { id: "sync", name: "Weave", role: "Merge conflicts", status: "running" as const, detail: "Resolving" },
    ],
    sync: {
      at: "2026-10-12T00:00:03.000Z",
      from: "b".repeat(40),
      to: f.baseSha,
      snapshot: "c".repeat(40),
      conflicts: ["hello.ts"],
      resolving: true,
    },
  };
  await writeState(f.dataDir, { version: 1, repos: [repo], runs: [run] });
  const store = new Store(f.dataDir);
  await store.initialize();
  assert.equal(store.recovery, undefined);
  const [loaded] = store.data.runs;
  assert.equal(loaded.status, "review");
  assert.equal(loaded.sync?.resolving, false);
  assert.equal(
    loaded.sync?.report,
    "The service restarted, so resolving the conflicts stopped; the edited files are kept, and you can finish yourself or ask the agent again.",
  );
  assert.equal(loaded.agents[0].status, "failed");
  const workbench = new Workbench(store);
  f.defer(() => workbench.shutdown());
  await workbench.diff(loaded.id);
  assert.deepEqual(loaded.sync?.unresolved, ["hello.ts"]);
});
