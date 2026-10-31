// The worktree a run starts in: a checkout that fails or is cancelled
// leaves no branch, checkout or base commit behind, so the next attempt
// starts again instead of running agents in a folder that is not there.
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { git, recordedGitDir, locateWorktreeGitDir } from "./process.js";
import { createRunWorktree } from "./repositories.js";
import { AppError, type Repository, type Run } from "./types.js";

const identity = {
  GIT_AUTHOR_NAME: "Worktree Test",
  GIT_AUTHOR_EMAIL: "worktree@example.invalid",
  GIT_COMMITTER_NAME: "Worktree Test",
  GIT_COMMITTER_EMAIL: "worktree@example.invalid",
};

/** A local project with one commit on main, and a run that has no worktree yet. */
async function fixture(t: TestContext) {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "bell-run-worktree-")));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const checkout = path.join(directory, "repo");
  await git(directory, ["init", "-q", "-b", "main", checkout]);
  await writeFile(path.join(checkout, "app.ts"), "app\n");
  await git(checkout, ["add", "-A"]);
  await git(checkout, ["commit", "-q", "-m", "initial"], { env: { ...process.env, ...identity } });
  const baseSha = (await git(checkout, ["rev-parse", "HEAD"])).stdout.trim();
  const repo: Repository = {
    id: "repo",
    name: "repo",
    owner: "local",
    fullName: "local/repo",
    path: checkout,
    defaultBranch: "main",
    url: "",
  };
  const run = {
    id: "worktree-run",
    branch: "fix/worktree",
    baseBranch: "main",
    baseSha: "",
    worktreePath: path.join(directory, "worktrees", "worktree-run"),
  } as Run;
  return { directory, repo, run, baseSha };
}

/**
 * Puts a git first on PATH whose `git <first> <second>` (`worktree add`, say)
 * runs the real one and then does `then` (shell): what the command makes
 * exists, but the command fails or still runs.
 */
async function gitWhose(
  t: TestContext,
  directory: string,
  [first, second]: [string, string],
  then: string,
) {
  const realGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
  const bin = path.join(directory, "bin");
  await mkdir(bin);
  // git() puts its own -c settings first, so the pair is looked for anywhere in the arguments.
  await writeFile(
    path.join(bin, "git"),
    `#!/bin/sh
for arg in "$@"; do
  if [ "$previous" = "${first}" ] && [ "$arg" = "${second}" ]; then
    '${realGit}' "$@" >/dev/null 2>&1
    ${then}
  fi
  previous="$arg"
done
exec '${realGit}' "$@"
`,
    { mode: 0o755 },
  );
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath}`;
  const restore = () => {
    process.env.PATH = previousPath;
  };
  t.after(restore);
  return restore;
}

/** Nothing of the attempt is left: no run branch, no checkout, no registered worktree. */
async function assertNothingLeft(repo: Repository, run: Run) {
  assert.equal(run.baseSha, "");
  assert.equal(existsSync(run.worktreePath), false);
  assert.equal((await git(repo.path, ["branch", "--list", "fix/*"])).stdout.trim(), "");
  const worktrees = (await git(repo.path, ["worktree", "list", "--porcelain"])).stdout;
  assert.equal(worktrees.match(/^worktree /gm)?.length, 1);
}

/** The next attempt, with a git that works, makes the worktree on the run's branch. */
async function assertRetryWorks(repo: Repository, run: Run, baseSha: string) {
  await createRunWorktree(run, repo, new AbortController().signal);
  assert.equal(run.baseSha, baseSha);
  assert.equal(
    (await git(run.worktreePath, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim(),
    run.branch,
  );
}

test("a run worktree whose checkout fails leaves nothing behind, and the next attempt makes it", { skip: process.platform === "win32" }, async (t) => {
  const { directory, repo, run, baseSha } = await fixture(t);
  const restore = await gitWhose(t, directory, ["worktree", "add"], `echo "fatal: disk full" >&2; exit 128`);

  await assert.rejects(createRunWorktree(run, repo, new AbortController().signal), /disk full/);

  restore();
  await assertNothingLeft(repo, run);
  await assertRetryWorks(repo, run, baseSha);
});

test("a run worktree cancelled during its checkout leaves nothing behind, and the next attempt makes it", { skip: process.platform === "win32" }, async (t) => {
  const { directory, repo, run, baseSha } = await fixture(t);
  const restore = await gitWhose(t, directory, ["worktree", "add"], "exec sleep 30");
  const controller = new AbortController();

  const attempt = createRunWorktree(run, repo, controller.signal);
  // Cancel once the checkout is there, while its command still runs.
  const checkedOut = path.join(run.worktreePath, ".git");
  for (let waited = 0; !existsSync(checkedOut) && waited < 10_000; waited += 50) await sleep(50);
  assert.ok(existsSync(checkedOut));
  controller.abort();
  await assert.rejects(attempt, (error: unknown) => error instanceof AppError && error.statusCode === 409);

  restore();
  await assertNothingLeft(repo, run);
  await assertRetryWorks(repo, run, baseSha);
});

test("a run worktree cancelled while its branch is made leaves nothing behind, and the next attempt makes it", { skip: process.platform === "win32" }, async (t) => {
  const { directory, repo, run, baseSha } = await fixture(t);
  const restore = await gitWhose(t, directory, ["branch", "--"], "exec sleep 2");
  const controller = new AbortController();

  const attempt = createRunWorktree(run, repo, controller.signal);
  // Cancel once the branch is there, while its command still runs.
  const branchMade = () =>
    git(repo.path, ["rev-parse", "--verify", "--quiet", `refs/heads/${run.branch}`]).then(
      () => true,
      () => false,
    );
  for (let waited = 0; !(await branchMade()) && waited < 10_000; waited += 50) await sleep(50);
  assert.ok(await branchMade());
  controller.abort();
  await assert.rejects(attempt, (error: unknown) => error instanceof AppError && error.statusCode === 409);

  restore();
  await assertNothingLeft(repo, run);
  await assertRetryWorks(repo, run, baseSha);
});

test("a run created through a symlinked data directory is recorded under both paths", { skip: process.platform === "win32" }, async (t) => {
  const { directory, repo, run, baseSha } = await fixture(t);
  const alias = `${directory}-alias`;
  await symlink(directory, alias, "dir");
  t.after(() => rm(alias, { force: true }));
  repo.path = path.join(alias, "repo");
  run.worktreePath = path.join(alias, "worktrees", run.id);
  await assertRetryWorks(repo, run, baseSha);
  const physical = await realpath(run.worktreePath);
  assert.equal(recordedGitDir(physical), run.gitDir);
  assert.equal(await locateWorktreeGitDir(path.join(repo.path, ".git"), physical), run.gitDir);
  assert.equal(recordedGitDir(run.worktreePath), run.gitDir);
  assert.equal((await git(physical, ["rev-parse", "HEAD"])).stdout.trim(), baseSha);
  // A different directory copying the genuine pointer is still unrecorded.
  const impostor = path.join(alias, "worktrees", "impostor");
  await mkdir(impostor);
  await writeFile(path.join(impostor, ".git"), `gitdir: ${run.gitDir}\n`);
  await assert.rejects(git(impostor, ["status"]), (error: unknown) =>
    error instanceof AppError && error.statusCode === 409);
});
