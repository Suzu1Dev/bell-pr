/**
 * Git hardening: repository configuration that could run programs, the
 * clone made for a local import, teammate checkout pointers, diff path
 * names, and syncing a checkout whose attributes name drivers.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { git } from "./process.js";
import { readDiff } from "./git.js";
import { createRunWorktree } from "./repositories.js";
import {
  checkoutTreeOnto,
  filesWithConflictMarkers,
  labelConflictMarkers,
  mergeCommits,
  snapshotCheckout,
} from "./sync.js";
import { assertTeammateWorktree, integrateTeamTask } from "./team-workspace.js";
import { Store } from "./store.js";
import { AppError, type Run } from "./types.js";
import { Workbench } from "./workbench.js";
import { withLocale } from "./i18n/index.js";
import type { TeamTask } from "../shared/team.js";

const identity = {
  GIT_AUTHOR_NAME: "Security Test",
  GIT_AUTHOR_EMAIL: "security@example.invalid",
  GIT_COMMITTER_NAME: "Security Test",
  GIT_COMMITTER_EMAIL: "security@example.invalid",
};
const withIdentity = { env: { ...process.env, ...identity } };

/** A repository with one commit holding `files`. */
async function repository(directory: string, files: Record<string, string>) {
  await mkdir(directory, { recursive: true });
  await git(directory, ["init", "-q", "-b", "main"]);
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
    await writeFile(path.join(directory, file), content);
  }
  await git(directory, ["add", "-A"], withIdentity);
  await git(directory, ["commit", "-q", "-m", "initial"], withIdentity);
  return (await git(directory, ["rev-parse", "HEAD"])).stdout.trim();
}

const unsafeConfig = (error: unknown) =>
  error instanceof AppError &&
  error.code === "git_config_unsafe" &&
  error.statusCode === 409;

function baseRun(fields: Partial<Run> & Pick<Run, "worktreePath" | "baseSha">): Run {
  return {
    id: "security-run",
    repoId: "repo",
    title: "Change",
    prompt: "Change",
    status: "review",
    branch: "fix/security",
    baseBranch: "main",
    createdAt: new Date().toISOString(),
    agents: [],
    logs: [],
    draft: { title: "Change", body: "A change." },
    reviewedFiles: [],
    reviewedFingerprints: {},
    locale: "en",
    ...fields,
  };
}

test("a filter in .git/config stops the diff and the publish before Git runs it", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-security-config-"));
  const checkout = path.join(directory, "checkout");
  const baseSha = await repository(checkout, { "hello.ts": "before\n" });
  const marker = path.join(directory, "filter-ran");
  await writeFile(path.join(checkout, ".gitattributes"), "* filter=x\n");
  await writeFile(path.join(checkout, "hello.ts"), "after\n");
  await git(checkout, ["config", "filter.x.clean", `touch ${marker}; cat`]);
  const run = baseRun({ worktreePath: checkout, baseSha });
  await assert.rejects(readDiff(run), unsafeConfig);

  // Publishing an approved run stops at the same check, before anything reaches GitHub.
  const bin = path.join(directory, "bin");
  await mkdir(bin);
  const ghCalled = path.join(directory, "gh-called");
  await writeFile(path.join(bin, "gh"), `#!/bin/sh\ntouch ${ghCalled}\nexit 1\n`, { mode: 0o755 });
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath}`;
  t.after(() => {
    process.env.PATH = previousPath;
  });
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const workbench = new Workbench(store);
  t.after(async () => {
    await workbench.shutdown();
    await store.save();
    await rm(directory, { recursive: true, force: true });
  });
  store.data.repos.push({
    id: "repo",
    name: "example",
    owner: "test-owner",
    fullName: "test-owner/example",
    path: checkout,
    defaultBranch: "main",
    url: "https://github.com/test-owner/example",
  });
  const approved = baseRun({
    worktreePath: checkout,
    baseSha,
    status: "approved",
    approvedFingerprint: "a".repeat(64),
  });
  store.data.runs.push(approved);
  await assert.rejects(workbench.publish(approved.id, "a".repeat(64)), unsafeConfig);
  assert.equal(approved.publishing, undefined);
  assert.equal(existsSync(ghCalled), false);
  assert.equal(existsSync(marker), false);

  // Removing the setting lets the diff through again.
  await git(checkout, ["config", "--unset", "filter.x.clean"]);
  assert.deepEqual(
    (await readDiff(run)).map((file) => file.path),
    [".gitattributes", "hello.ts"],
  );
  assert.equal(existsSync(marker), false);
});

test("a teammate checkout whose .git pointer was forged is not used", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-security-team-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const runCheckout = path.join(directory, "worktrees", "run");
  const baseSha = await repository(runCheckout, { "a.ts": "a\n" });
  const run = baseRun({ worktreePath: runCheckout, baseSha });
  const taskPath = path.join(directory, "team-worktrees", "run", "task-1");
  await mkdir(path.dirname(taskPath), { recursive: true });
  await git(runCheckout, ["worktree", "add", "-q", "--detach", taskPath, baseSha]);
  const task = {
    id: "task-1",
    title: "Task",
    owner: "member-1",
    status: "running",
    files: ["a.ts"],
    worktreePath: taskPath,
    baseSha,
  } as unknown as TeamTask;
  await assertTeammateWorktree(run, taskPath);
  assert.deepEqual(await integrateTeamTask(run, task), []);

  const pointerPath = path.join(taskPath, ".git");
  const genuine = await readFile(pointerPath, "utf8");
  const forged = (error: unknown) =>
    error instanceof AppError && error.statusCode === 409 && /checkout/.test(error.message);
  // Another repository's worktree with a believable name.
  const other = path.join(directory, "other");
  const otherSha = await repository(other, { "b.ts": "b\n" });
  const otherTask = path.join(directory, "other-task");
  await git(other, ["worktree", "add", "-q", "--detach", otherTask, otherSha]);
  const common = path.join(runCheckout, ".git");
  for (const pointer of [
    `gitdir: ${path.join(other, ".git", "worktrees", "other-task")}\n`,
    // The repository itself, not one of its worktrees.
    `gitdir: ${common}\n`,
    `gitdir: ${path.join(common, "worktrees")}\n`,
    // Extra lines or keys around a genuine pointer.
    `${genuine}gitdir: ${common}\n`,
    `# comment\n${genuine}`,
    "",
  ]) {
    await writeFile(pointerPath, pointer);
    await assert.rejects(
      withLocale("en", () => integrateTeamTask(run, task)),
      forged,
      JSON.stringify(pointer),
    );
  }
  // A second checkout claiming the teammate's Git directory: Git's record points elsewhere.
  await writeFile(pointerPath, genuine);
  const impostor = path.join(directory, "impostor");
  await mkdir(impostor);
  await writeFile(path.join(impostor, ".git"), genuine);
  await assert.rejects(
    withLocale("en", () => assertTeammateWorktree(run, impostor)),
    forged,
  );
  // A .git that is a symlink or a whole repository is refused too.
  await rm(pointerPath);
  await symlink(path.join(other, ".git"), pointerPath);
  await assert.rejects(withLocale("en", () => integrateTeamTask(run, task)), forged);
  await rm(pointerPath);
  await writeFile(pointerPath, genuine);
  await assertTeammateWorktree(run, taskPath);
});

/** The person's own repository, as `git worktree list` and the refs show it. */
async function repositoryState(directory: string) {
  const [worktrees, refs, config] = await Promise.all([
    git(directory, ["worktree", "list", "--porcelain"]),
    git(directory, ["for-each-ref", "--format=%(refname) %(objectname)"]),
    readFile(path.join(directory, ".git", "config"), "utf8"),
  ]);
  return { worktrees: worktrees.stdout, refs: refs.stdout, config };
}

test("a local import is cloned, so runs never add worktrees or branches to the person's repository", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-security-import-"));
  const own = path.join(directory, "own");
  await repository(own, { "app.ts": "app\n" });
  await git(own, ["branch", "feature"]);
  await git(own, ["config", "user.name", "Owner"]);
  const before = await repositoryState(own);
  const branches = (await git(own, ["branch", "--list"])).stdout;

  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const workbench = new Workbench(store);
  t.after(async () => {
    await workbench.shutdown();
    await store.save();
    await rm(directory, { recursive: true, force: true });
  });
  const repo = await workbench.importRepository(own);
  assert.ok(repo.path.startsWith(path.join(store.directory, "repositories") + path.sep));
  assert.equal(repo.url, "");
  assert.equal(repo.fullName, "local/own");
  assert.equal(repo.defaultBranch, "main");
  assert.equal(workbench.managedClone(repo), false);
  // Every branch came along; the clone keeps no remote pointing at the checkout.
  assert.match((await git(repo.path, ["branch", "--list"])).stdout, /feature/);
  assert.equal((await git(repo.path, ["remote"])).stdout.trim(), "");
  assert.equal((await git(repo.path, ["config", "--get", "user.name"], { allowedCodes: [0, 1] })).stdout, "");
  // Importing the same checkout again finds the clone.
  assert.equal((await workbench.importRepository(own)).id, repo.id);

  const run = baseRun({
    id: "import-run",
    repoId: repo.id,
    worktreePath: path.join(store.directory, "worktrees", "import-run"),
    baseSha: "",
    branch: "fix/importrn",
  });
  await createRunWorktree(run, repo, new AbortController().signal);
  assert.match((await git(repo.path, ["branch", "--list"])).stdout, /fix\/importrn/);
  assert.deepEqual(await repositoryState(own), before);
  assert.equal((await git(own, ["branch", "--list"])).stdout, branches);

  // A checkout of a GitHub project: BELL's clone points at GitHub and may be updated.
  const github = path.join(directory, "github-checkout");
  await repository(github, { "lib.ts": "lib\n" });
  await git(github, ["remote", "add", "origin", "https://github.com/test-owner/example.git"]);
  const githubBefore = await repositoryState(github);
  const cloned = await workbench.importRepository(github);
  assert.equal(cloned.url, "https://github.com/test-owner/example");
  assert.equal(cloned.fullName, "test-owner/example");
  assert.equal(workbench.managedClone(cloned), true);
  assert.equal(
    (await git(cloned.path, ["remote", "get-url", "origin"])).stdout.trim(),
    "https://github.com/test-owner/example.git",
  );
  assert.deepEqual(await repositoryState(github), githubBefore);

  // A checkout imported by an earlier build keeps working where it is, without migration.
  const legacy = path.join(directory, "legacy");
  await repository(legacy, { "old.ts": "old\n" });
  store.data.repos.push({
    id: "legacy",
    name: "legacy",
    owner: "local",
    fullName: "local/legacy",
    path: legacy,
    defaultBranch: "main",
    url: "",
  });
  assert.equal((await workbench.importRepository(legacy)).id, "legacy");
});

test("diff paths that would reach an object prototype are refused", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-security-proto-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const checkout = path.join(directory, "checkout");
  const baseSha = await repository(checkout, { "constructor/x.ts": "x\n" });
  const run = baseRun({ worktreePath: checkout, baseSha });
  await writeFile(path.join(checkout, "__proto__"), "polluted\n");
  await assert.rejects(
    readDiff(run),
    (error: unknown) => error instanceof AppError && error.statusCode === 422,
  );
  await rm(path.join(checkout, "__proto__"));
  await writeFile(path.join(checkout, "constructor", "x.ts"), "changed\n");
  await assert.rejects(
    readDiff(run),
    (error: unknown) => error instanceof AppError && error.statusCode === 422,
  );
});

test("syncing a checkout whose .gitattributes names merge drivers and filters runs nothing", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-security-sync-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const checkout = path.join(directory, "checkout");
  const marker = path.join(directory, "driver-ran");
  const base = await repository(checkout, {
    ".gitattributes": "* merge=evil filter=evil diff=evil\n",
    "hello.ts": "one\ntwo\nthree\n",
  });
  await writeFile(path.join(checkout, "hello.ts"), "one\ntwo, ours\nthree\n");
  await git(checkout, ["commit", "-qam", "ours"], withIdentity);
  const ours = (await git(checkout, ["rev-parse", "HEAD"])).stdout.trim();
  await git(checkout, ["checkout", "-q", "-b", "theirs", base]);
  await writeFile(path.join(checkout, "hello.ts"), "one\ntwo, theirs\nthree\n");
  await git(checkout, ["commit", "-qam", "theirs"], withIdentity);
  const theirs = (await git(checkout, ["rev-parse", "HEAD"])).stdout.trim();
  await git(checkout, ["checkout", "-q", "main"]);
  await writeFile(path.join(checkout, "new.ts"), "new\n");

  // The attributes name drivers that no configuration defines: Git's own merge applies.
  const indexPath = path.join(directory, "sync-index-run");
  const snapshot = await snapshotCheckout(checkout, indexPath);
  assert.match(snapshot, /^[0-9a-f]{40,64}$/);
  const merged = await mergeCommits(checkout, ours, theirs, base);
  assert.deepEqual(merged.conflicts, ["hello.ts"]);
  await checkoutTreeOnto(checkout, merged.tree, ours);
  assert.match(await readFile(path.join(checkout, "hello.ts"), "utf8"), /^<{7} /m);
  assert.equal(existsSync(marker), false);
  assert.equal(existsSync(indexPath), false);
  assert.equal(existsSync(`${indexPath}.lock`), false);

  // Configuration that defines them is refused before any of these commands runs.
  for (const [key, value] of [
    ["merge.evil.driver", `touch ${marker}; false`],
    ["filter.evil.clean", `touch ${marker}; cat`],
    ["diff.evil.textconv", `touch ${marker}; cat`],
  ]) {
    await git(checkout, ["config", key, value]);
    await writeFile(`${indexPath}.lock`, "stale");
    await assert.rejects(snapshotCheckout(checkout, indexPath), unsafeConfig, key);
    assert.equal(existsSync(indexPath), false);
    assert.equal(existsSync(`${indexPath}.lock`), false);
    await assert.rejects(mergeCommits(checkout, ours, theirs, base), unsafeConfig, key);
    await assert.rejects(checkoutTreeOnto(checkout, merged.tree, ours), unsafeConfig, key);
    await git(checkout, ["config", "--unset", key]);
  }
  assert.equal(existsSync(marker), false);
});

test("conflict paths outside the checkout, and symlinks, are never read or rewritten", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-security-conflict-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const checkout = path.join(directory, "checkout");
  await repository(checkout, { "a.ts": "a\n" });
  const commit = "a".repeat(40);
  const conflicted = `<<<<<<< ${commit}\nmine\n=======\ntheirs\n>>>>>>> ${commit}\n`;
  const outside = path.join(directory, "x");
  await writeFile(outside, conflicted);
  await symlink(outside, path.join(checkout, "linked.ts"));
  await writeFile(path.join(checkout, "inside.ts"), conflicted);
  const files = ["../x", "a/../../x", outside, "linked.ts", "inside.ts"];
  assert.deepEqual(await filesWithConflictMarkers(checkout, files), ["inside.ts"]);
  await labelConflictMarkers(checkout, files, { [commit]: "your version" });
  assert.equal(await readFile(outside, "utf8"), conflicted);
  assert.ok((await lstat(path.join(checkout, "linked.ts"))).isSymbolicLink());
  assert.match(await readFile(path.join(checkout, "inside.ts"), "utf8"), /^<{7} your version$/m);
});
