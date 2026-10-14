import test from "node:test";
import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { git } from "./process.js";
import { Store } from "./store.js";
import { Workbench } from "./workbench.js";
import { runJanitor } from "./janitor.js";
import type { Repository, Run } from "./types.js";

const exists = (target: string) =>
  lstat(target).then(
    () => true,
    () => false,
  );

const worktreeList = async (repoPath: string) =>
  (await git(repoPath, ["worktree", "list", "--porcelain"])).stdout
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));

/** A data directory with one repository and the leftovers a crash leaves. */
async function plantedDataDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-janitor-test-"));
  const dataDir = path.join(directory, "state");
  const repoPath = path.join(directory, "repo");
  await mkdir(repoPath, { recursive: true });
  await git(repoPath, ["init", "-b", "main"]);
  await git(repoPath, ["config", "user.name", "BELL Test"]);
  await git(repoPath, ["config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(repoPath, "hello.ts"), "export const hello = 1;\n");
  await git(repoPath, ["add", "hello.ts"]);
  await git(repoPath, ["commit", "-m", "initial"]);
  const baseSha = (await git(repoPath, ["rev-parse", "HEAD"])).stdout.trim();
  const repo: Repository = {
    id: "13131313-1313-4131-8131-131313131313",
    name: "repo",
    owner: "local",
    fullName: "local/repo",
    path: repoPath,
    defaultBranch: "main",
    url: "",
  };
  const kept: Run = {
    id: "kept-run",
    repoId: repo.id,
    title: "Kept",
    prompt: "Kept run",
    status: "review",
    branch: "fix/kept",
    baseBranch: "main",
    baseSha,
    worktreePath: path.join(dataDir, "worktrees", "kept-run"),
    createdAt: "2026-10-12T00:00:00.000Z",
    agents: [],
    logs: [],
    draft: { title: "Kept", body: "" },
    reviewedFiles: [],
    reviewedFingerprints: {},
  };
  const store = new Store(dataDir);
  await store.initialize();
  store.data.repos.push(repo);
  store.data.runs.push(kept);
  await store.save();
  // Git worktrees: the run's own, and one whose run no longer exists.
  await mkdir(path.join(dataDir, "worktrees"), { recursive: true });
  await git(repoPath, ["worktree", "add", "-b", kept.branch, kept.worktreePath, baseSha]);
  const orphan = path.join(dataDir, "worktrees", "deleted-run");
  await git(repoPath, ["worktree", "add", "--detach", orphan, baseSha]);
  // A teammate checkout of a deleted run and one of the kept run.
  const orphanTeam = path.join(dataDir, "team-worktrees", "deleted-run", "task-1");
  const keptTeam = path.join(dataDir, "team-worktrees", "kept-run", "task-1");
  for (const target of [orphanTeam, keptTeam])
    await mkdir(target, { recursive: true });
  // A run quarantined at an earlier start keeps its worktree for a repair.
  const quarantined = path.join(dataDir, "worktrees", "quarantined-run");
  await mkdir(quarantined, { recursive: true });
  await writeFile(
    path.join(dataDir, "state.quarantine.json"),
    JSON.stringify({
      version: 1,
      repos: [],
      runs: [{ reason: "agents: Expected array", run: { id: "quarantined-run" } }],
    }),
  );
  const leftovers = [
    "state.json.4242.0123456789ab.tmp",
    "discovery.json.tmp",
    "team-index-7b1f",
    "team-index-7b1f.lock",
    "publish-index-kept-run",
    "sync-index-kept-run",
    "insights/0a1b.json.99.abcdef012345.tmp",
  ];
  for (const name of leftovers) {
    await mkdir(path.dirname(path.join(dataDir, name)), { recursive: true });
    await writeFile(path.join(dataDir, name), "partial");
  }
  await mkdir(path.join(dataDir, "insights", "analysis-Xy12ab", "nested"), {
    recursive: true,
  });
  await writeFile(
    path.join(dataDir, "insights", "analysis-Xy12ab", "response-schema.json"),
    "{}",
  );
  const keep = [
    "state.json",
    "state.json.bak.1",
    "discovery.json",
    "model-settings.json",
    "bellpr.lock",
    "children.json",
    "insights/0a1b.json",
  ];
  for (const name of keep.slice(2))
    await writeFile(path.join(dataDir, name), "{}");
  await writeFile(path.join(dataDir, "state.json.bak.1"), "{}");
  return {
    directory,
    dataDir,
    repoPath,
    store,
    kept,
    orphan,
    orphanTeam,
    keptTeam,
    quarantined,
    leftovers: [...leftovers, "insights/analysis-Xy12ab"],
    keep,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

/** Moves every planted entry back an hour, as leftovers of an earlier start. */
async function age(dataDir: string, entries: string[]) {
  const earlier = new Date(Date.now() - 60 * 60 * 1000);
  for (const entry of entries)
    await utimes(path.join(dataDir, entry), earlier, earlier);
}

test("the janitor removes crash leftovers and unreferenced worktrees, and prunes Git's records", async (t) => {
  const p = await plantedDataDirectory();
  t.after(p.cleanup);
  const removed = await runJanitor(
    { store: p.store, lock: (_id, task) => task() },
    { startedAt: Date.now() + 1000 },
  );
  for (const name of p.leftovers)
    assert.equal(await exists(path.join(p.dataDir, name)), false, name);
  assert.equal(await exists(p.orphan), false);
  assert.equal(await exists(path.dirname(p.orphanTeam)), false);
  for (const name of p.keep)
    assert.equal(await exists(path.join(p.dataDir, name)), true, name);
  assert.equal(await exists(p.kept.worktreePath), true);
  assert.equal(await exists(p.keptTeam), true);
  assert.equal(await exists(p.quarantined), true);
  assert.deepEqual(
    removed.sort(),
    [
      ...p.leftovers,
      path.join("team-worktrees", "deleted-run"),
      path.join("worktrees", "deleted-run"),
    ].sort(),
  );
  // Git forgot the deleted worktree and still knows the kept one.
  assert.deepEqual(await worktreeList(p.repoPath), [
    await realpath(p.repoPath),
    await realpath(p.kept.worktreePath),
  ]);
});

test("after a restore from a backup, worktrees of runs the backup does not know are kept", async (t) => {
  const p = await plantedDataDirectory();
  t.after(p.cleanup);
  p.store.recovery = { restoredFrom: "state.json.bak.1", quarantinedRuns: 0 };
  const removed = await runJanitor(
    { store: p.store, lock: (_id, task) => task() },
    { startedAt: Date.now() + 1000 },
  );
  assert.equal(await exists(p.orphan), true);
  assert.equal(await exists(p.orphanTeam), true);
  // Temporary files still go.
  assert.deepEqual(removed.sort(), [...p.leftovers].sort());
});

test("entries newer than the start are left alone", async (t) => {
  const p = await plantedDataDirectory();
  t.after(p.cleanup);
  const removed = await runJanitor(
    { store: p.store, lock: (_id, task) => task() },
    { startedAt: Date.now() - 60 * 60 * 1000 },
  );
  assert.deepEqual(removed, []);
  for (const name of p.leftovers)
    assert.equal(await exists(path.join(p.dataDir, name)), true, name);
  assert.equal(await exists(p.orphan), true);
});

test("the Workbench runs the janitor when it starts", async (t) => {
  const p = await plantedDataDirectory();
  await age(p.dataDir, [
    ...p.leftovers,
    path.relative(p.dataDir, p.orphan),
    path.relative(p.dataDir, path.dirname(p.orphanTeam)),
  ]);
  const workbench = new Workbench(p.store);
  t.after(async () => {
    await workbench.shutdown();
    await p.cleanup();
  });
  await workbench.maintenance;
  for (const name of p.leftovers)
    assert.equal(await exists(path.join(p.dataDir, name)), false, name);
  assert.equal(await exists(p.orphan), false);
  assert.equal(await exists(p.kept.worktreePath), true);
});
