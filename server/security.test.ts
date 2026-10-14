/**
 * Git hardening, the clone made for a local import, teammate checkout
 * pointers, diff path names, syncing a checkout whose attributes name
 * drivers, and the checks on what a first publish sends to GitHub.
 */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { request } from "node:http";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fakeGitHub } from "../test/fake-github.js";
import { createApp } from "./index.js";
import { git } from "./process.js";
import { readDiff, reviewFingerprint } from "./git.js";
import { adoptLegacyCheckout, createRunWorktree } from "./repositories.js";
import { publishChecks } from "./publish.js";
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
import { Workbench, type WorkbenchContext } from "./workbench.js";
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

test("a checkout an earlier build worked in keeps its diff when its .git/config sets husky's hooks path", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-security-husky-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const checkout = path.join(directory, "checkout");
  const baseSha = await repository(checkout, { "hello.ts": "before\n" });
  const marker = path.join(directory, "hook-ran");
  await mkdir(path.join(checkout, ".husky", "_"), { recursive: true });
  await writeFile(
    path.join(checkout, ".husky", "_", "pre-commit"),
    `#!/bin/sh\ntouch ${marker}\n`,
    { mode: 0o755 },
  );
  await git(checkout, ["config", "core.hooksPath", ".husky/_"]);
  // Such a run's worktree shares the person's .git/config.
  const worktreePath = path.join(directory, "worktrees", "husky-run");
  await git(checkout, ["worktree", "add", "-q", "-b", "fix/husky", worktreePath, baseSha]);
  await writeFile(path.join(worktreePath, "hello.ts"), "after\n");
  const run = baseRun({ worktreePath, baseSha, branch: "fix/husky" });
  assert.deepEqual(
    (await readDiff(run)).map((file) => file.path),
    ["hello.ts"],
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

test("a project an earlier build worked on in place moves to a clone once none of its runs works there", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-security-legacy-"));
  const legacy = path.join(directory, "legacy");
  const baseSha = await repository(legacy, { "old.ts": "old\n" });
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const workbench = new Workbench(store);
  t.after(async () => {
    await workbench.shutdown();
    await store.save();
    await rm(directory, { recursive: true, force: true });
  });
  const ctx = (workbench as unknown as { context: WorkbenchContext }).context;
  const repo = {
    id: "legacy",
    name: "legacy",
    owner: "local",
    fullName: "local/legacy",
    path: legacy,
    defaultBranch: "main",
    url: "",
  };
  store.data.repos.push(repo);
  const runOf = (id: string) =>
    baseRun({
      id,
      repoId: repo.id,
      worktreePath: path.join(store.directory, "worktrees", id),
      baseSha: "",
      branch: `fix/${id.slice(0, 8)}`,
    });
  // A run of that build still has its worktree in the person's repository.
  const old = { ...runOf("old-run1"), baseSha };
  await git(legacy, ["worktree", "add", "-q", "-b", old.branch, old.worktreePath, baseSha]);
  store.data.runs.push(old);
  const first = runOf("first-run");
  store.data.runs.push(first);
  assert.equal(await adoptLegacyCheckout(ctx, repo, first), false);
  assert.equal(repo.path, legacy);

  // Once its files are freed, the next run moves the project to a clone.
  await git(legacy, ["worktree", "remove", "--force", old.worktreePath]);
  old.workspaceRemovedAt = new Date().toISOString();
  const before = await repositoryState(legacy);
  const second = runOf("second-run");
  store.data.runs.push(second);
  assert.equal(await adoptLegacyCheckout(ctx, repo, second), true);
  assert.ok(repo.path.startsWith(path.join(store.directory, "repositories") + path.sep));
  await createRunWorktree(second, repo, new AbortController().signal);
  assert.equal(second.baseSha, baseSha);
  assert.match((await git(repo.path, ["branch", "--list"])).stdout, /fix\/second-r/);
  assert.deepEqual(await repositoryState(legacy), before);
  // The move is saved, and importing the checkout again finds the project.
  const saved = JSON.parse(await readFile(path.join(store.directory, "state.json"), "utf8"));
  assert.equal(saved.repos.find((entry: { id: string }) => entry.id === repo.id).path, repo.path);
  assert.equal((await workbench.importRepository(legacy)).id, repo.id);
  assert.equal(await adoptLegacyCheckout(ctx, repo, runOf("third-run")), false);
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

/** Commits made by BELL in these tests carry a test identity. */
function useIdentity(t: TestContext, values: Record<string, string>) {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(previous))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  });
}

/** A fake GitHub project, BELL's clone of it, and one reviewed run ready to approve. */
async function publishable(t: TestContext, changes: Record<string, string>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-security-publish-"));
  const github = await fakeGitHub(directory, {
    files: { "hello.ts": "hello\n", ".github/workflows/ci.yml": "on: push\n" },
  });
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const workbench = new Workbench(store);
  t.after(async () => {
    github.restore();
    await workbench.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  const repo = await workbench.importRepository(github.url);
  const baseSha = (await git(repo.path, ["rev-parse", "HEAD"])).stdout.trim();
  const worktreePath = path.join(store.directory, "worktrees", "publish-run");
  await git(repo.path, ["worktree", "add", "-q", "-b", "fix/publish1", worktreePath, baseSha]);
  for (const [file, content] of Object.entries(changes))
    await writeFile(path.join(worktreePath, file), content);
  const run = baseRun({
    id: "publish-run",
    repoId: repo.id,
    worktreePath,
    baseSha,
    branch: "fix/publish1",
    draft: { title: "Update hello", body: "Updates the greeting." },
  });
  store.data.runs.push(run);
  for (const file of await readDiff(run))
    await workbench.review(run.id, file.path, true, file.fingerprint);
  return { directory, store, workbench, run, repo };
}

test("publishing confirms CI changes, local paths and, once per address, a public commit e-mail", async (t) => {
  useIdentity(t, {
    ...identity,
    GIT_AUTHOR_EMAIL: "someone@company.dev",
    GIT_COMMITTER_EMAIL: "someone@company.dev",
  });
  const f = await publishable(t, {
    "hello.ts": "hello, world\n",
    ".github/workflows/ci.yml": "on: [push, pull_request]\n",
  });
  const ids = async () =>
    (await publishChecks(f.run, await readDiff(f.run), f.store.directory, "en")).map(
      (check) => [check.id, check.kind],
    );
  assert.deepEqual(await ids(), [
    ["workflows", "confirm"],
    ["author-email", "confirm"],
  ]);
  // A path from this computer in the PR text asks for confirmation as well.
  await f.workbench.draft(f.run.id, {
    title: "Update hello",
    body: `Updates the greeting.\n\nTested in ${path.join(os.homedir(), "project")} and /home/alice/src.`,
  });
  assert.deepEqual(await ids(), [
    ["local-paths", "confirm"],
    ["workflows", "confirm"],
    ["author-email", "confirm"],
  ]);
  await f.workbench.approve(f.run.id, { ...f.run.draft });

  // The publish dialog reads the same list from the server.
  const app = createApp(f.workbench, { staticDirectory: path.join(f.directory, "missing") });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.locals.insights.shutdown();
    await app.locals.discovery.shutdown();
  });
  const preflight = await new Promise<{ checks: { id: string; message: string; details: string[] }[] }>(
    (resolve, reject) => {
      request(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/runs/${f.run.id}/preflight`,
        { headers: { host: "127.0.0.1:4311", "x-bell-locale": "en" } },
        (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => (body += chunk));
          response.on("end", () => resolve(JSON.parse(body)));
        },
      )
        .on("error", reject)
        .end();
    },
  );
  assert.deepEqual(
    preflight.checks.map((check) => check.id),
    ["local-paths", "workflows", "author-email"],
  );
  assert.match(preflight.checks[2].message, /someone@company\.dev/);
  assert.ok(preflight.checks[0].details.some((detail) => detail.includes("/home/alice/")));
  assert.deepEqual(preflight.checks[1].details, ["Changed: .github/workflows/ci.yml"]);

  for (const acknowledged of [[], ["local-paths", "workflows"], ["author-email"]])
    await assert.rejects(
      f.workbench.publish(f.run.id, f.run.approvedFingerprint!, acknowledged),
      (error: unknown) => error instanceof AppError && error.statusCode === 422,
    );
  assert.equal(existsSync(path.join(f.store.directory, "author-emails.json")), false);
  await f.workbench.publish(f.run.id, f.run.approvedFingerprint!, [
    "local-paths",
    "workflows",
    "author-email",
  ]);
  assert.equal(f.run.status, "published");
  // The address is remembered as a digest, readable by the owner only.
  const saved = path.join(f.store.directory, "author-emails.json");
  const content = JSON.parse(await readFile(saved, "utf8"));
  assert.equal(content.version, 1);
  assert.equal(content.confirmed.length, 1);
  assert.match(content.confirmed[0], /^[a-f0-9]{64}$/);
  assert.doesNotMatch(await readFile(saved, "utf8"), /company/);
  assert.equal((await stat(saved)).mode & 0o777, 0o600);
  assert.ok(
    !(await publishChecks(f.run, await readDiff(f.run), f.store.directory, "en")).some(
      (check) => check.id === "author-email",
    ),
  );
  // The temporary publish index is gone.
  assert.equal(existsSync(path.join(f.store.directory, `publish-index-${f.run.id}`)), false);
  assert.equal(existsSync(path.join(f.store.directory, `publish-index-${f.run.id}.lock`)), false);
});

test("a credential in the PR text blocks approval and publishing", async (t) => {
  useIdentity(t, identity);
  const f = await publishable(t, { "hello.ts": "hello, world\n" });
  const token = `ghp_${"a".repeat(36)}`;
  for (const draft of [
    { title: "Update hello", body: `Uses ${token} for the test.` },
    { title: `Update hello ${token}`, body: "Updates the greeting." },
    { title: "Update hello", body: "Updates the greeting.", commitMessage: `Update hello\n\ntoken ${token}` },
  ]) {
    await f.workbench.draft(f.run.id, draft);
    await assert.rejects(
      withLocale("en", () => f.workbench.approve(f.run.id, { ...f.run.draft })),
      (error: unknown) =>
        error instanceof AppError && error.statusCode === 422 && /credential/.test(error.message),
    );
    // Approved before the check existed: still stopped before anything is pushed.
    f.run.status = "approved";
    f.run.approvedFingerprint = reviewFingerprint(await readDiff(f.run), f.run.draft);
    await assert.rejects(
      withLocale("en", () => f.workbench.publish(f.run.id, f.run.approvedFingerprint!)),
      (error: unknown) =>
        error instanceof AppError && error.statusCode === 422 && /credential/.test(error.message),
    );
    assert.equal(f.run.publishCommit, undefined);
    f.run.status = "review";
    delete f.run.approvedFingerprint;
  }
});
