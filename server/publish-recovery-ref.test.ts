import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readDiff } from "./git.js";
import { command, git } from "./process.js";
import { Store } from "./store.js";
import type { Repository, Run } from "./types.js";
import { skipUnderstandingCheckInTests } from "./understanding.js";
import { Workbench } from "./workbench.js";

before(() => skipUnderstandingCheckInTests(true));
after(() => skipUnderstandingCheckInTests());

const prUrl = "https://github.com/test-owner/example/pull/7";

function reviewRun(
  id: string,
  repo: Repository,
  worktreePath: string,
  baseSha: string,
): Run {
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
      {
        id: "lead",
        name: "Atlas",
        role: "Team lead",
        status: "complete",
        detail: "Done",
      },
    ],
    logs: [
      { time: "2026-10-12T00:00:01.000Z", agent: "lead", message: "Started" },
    ],
    draft: { title: "Improve greeting", body: "A clearer greeting." },
    reviewedFiles: [],
    reviewedFingerprints: {},
    reports: {},
  };
}

async function recoveryRefs(repository: string) {
  return (
    await git(repository, [
      "for-each-ref",
      "--format=%(refname) %(objectname)",
      "refs/bellpr/publish-recovery/",
    ])
  ).stdout.trim();
}

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-publish-ref-"));
  const seed = path.join(directory, "seed");
  const bare = path.join(directory, "remote.git");
  const repository = path.join(directory, "repo");
  await mkdir(seed);
  await git(seed, ["init", "-b", "main"]);
  await git(seed, ["config", "user.name", "BELL Test"]);
  await git(seed, ["config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(seed, "hello.ts"), 'export const hello = "before";\n');
  await git(seed, ["add", "hello.ts"]);
  await git(seed, ["commit", "-m", "base"]);
  await git(directory, ["clone", "--bare", seed, "remote.git"]);
  await git(directory, ["clone", bare, "repo"]);
  await git(repository, ["config", "user.name", "BELL Test"]);
  await git(repository, ["config", "user.email", "test@example.invalid"]);
  const baseSha = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();
  const realGit = (await command("which", ["git"])).stdout.trim();
  const bin = path.join(directory, "bin");
  const modeFile = path.join(directory, "mode");
  const callsFile = path.join(directory, "calls.jsonl");
  const remoteHeadFile = path.join(directory, "remote-head");
  await mkdir(bin);
  await writeFile(modeFile, "fork-fail");
  await writeFile(callsFile, "");
  await writeFile(
    path.join(bin, "git"),
    `#!/usr/bin/env node
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify(['git', ...args]) + '\\n');
if (args.includes('ls-remote')) {
  try { process.stdout.write(fs.readFileSync(${JSON.stringify(remoteHeadFile)}, 'utf8')); } catch (error) {}
  process.exit(0);
}
if (args.includes('push')) process.exit(0);
if (args.includes('fetch') || args.includes('clone')) process.exit(98);
const result = spawnSync(${JSON.stringify(realGit)}, args, { stdio: 'inherit', env: process.env });
process.exit(result.status ?? 1);
`,
    { mode: 0o700 },
  );
  await writeFile(
    path.join(bin, "gh"),
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify(['gh', ...args]) + '\\n');
const mode = fs.readFileSync(${JSON.stringify(modeFile)}, 'utf8').trim();
if (args[0] === 'api' && args[1] === 'user' && args.includes('--jq')) { console.log('test-owner'); process.exit(0); }
if (args[0] === 'api' && args[1] === 'user') { console.log('{"login":"test-owner"}'); process.exit(0); }
if (args[0] === 'repo' && args[1] === 'view') {
  console.log(JSON.stringify({ viewerPermission: mode === 'write' ? 'WRITE' : 'READ', defaultBranchRef: { name: 'main' } }));
  process.exit(0);
}
if (args[0] === 'repo' && args[1] === 'fork') process.exit(mode === 'fork-fail' ? 1 : 0);
if (args[0] === 'api' && String(args[1]).includes('/git/ref/')) { console.log(${JSON.stringify(baseSha)}); process.exit(0); }
if (args[0] === 'pr' && args[1] === 'list') { console.log('[]'); process.exit(0); }
if (args[0] === 'pr' && args[1] === 'create') { console.log(${JSON.stringify(prUrl)}); process.exit(0); }
process.exit(97);
`,
    { mode: 0o700 },
  );
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath}`;
  let workbench: Workbench | undefined;
  try {
    const store = new Store(path.join(directory, "data"));
    await store.initialize();
    workbench = new Workbench(store);
    const repo: Repository = {
      id: "11111111-1111-4111-8111-111111111111",
      name: "example",
      owner: "test-owner",
      fullName: "test-owner/example",
      path: repository,
      defaultBranch: "main",
      url: "https://github.com/test-owner/example",
    };
    store.data.repos.push(repo);
    const run = reviewRun("ref-run1", repo, repository, baseSha);
    run.draft.commitMessage = "Improve the greeting";
    store.data.runs.push(run);
    await git(repository, ["checkout", "-q", "-b", run.branch]);
    await writeFile(
      path.join(repository, "hello.ts"),
      'export const hello = "after";\n',
    );
    for (const file of await readDiff(run))
      await workbench.review(run.id, file.path, true, file.fingerprint);
    await workbench.approve(run.id, { ...run.draft });
    const calls = async () =>
      (await readFile(callsFile, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[]);
    const opened = workbench;
    return {
      repository,
      workbench: opened,
      run,
      baseSha,
      calls,
      mode: (value: string) => writeFile(modeFile, value),
      remoteHead: (value: string) => writeFile(remoteHeadFile, value),
      cleanup: async () => {
        process.env.PATH = previousPath;
        await opened.shutdown();
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    process.env.PATH = previousPath;
    if (workbench) await workbench.shutdown().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

test("a publish that fails after the commit and before a push target is archived by recovery, and a retry reuses that ref", async () => {
  const f = await fixture();
  try {
    const approved = f.run.approvedFingerprint!;
    await assert.rejects(
      f.workbench.publish(f.run.id, approved, ["facts-unknown"]),
    );
    const commit = f.run.publishCommit;
    assert.ok(commit);
    assert.equal(f.run.headRepository, undefined);
    assert.equal(f.run.publishedBranch, undefined);
    assert.equal(f.run.prUrl, undefined);
    assert.equal(f.run.status, "approved");
    assert.equal(
      (await git(f.repository, ["rev-parse", "HEAD"])).stdout.trim(),
      commit,
    );
    assert.equal(
      (await git(f.repository, ["rev-parse", "HEAD^"])).stdout.trim(),
      f.baseSha,
    );
    assert.equal(
      await readFile(path.join(f.repository, "hello.ts"), "utf8"),
      'export const hello = "after";\n',
    );
    const ref = `refs/bellpr/publish-recovery/${f.run.id}/${commit}`;
    assert.equal(await recoveryRefs(f.repository), "");
    const pushed = (await f.calls()).some((args) => args.includes("push"));
    assert.equal(pushed, false);
    await f.workbench.recoverPublish(f.run.id, commit);
    assert.equal(await recoveryRefs(f.repository), `${ref} ${commit}`);
    assert.equal(f.run.status, "review");
    assert.equal(f.run.publishCommit, undefined);
    assert.equal(
      (await git(f.repository, ["rev-parse", "HEAD"])).stdout.trim(),
      commit,
    );
    f.run.publishCommit = commit;
    f.run.status = "approved";
    f.run.approvedFingerprint = approved;
    f.run.error = "The unfinished publish is still the same commit.";
    await f.workbench.recoverPublish(f.run.id, commit);
    assert.equal(await recoveryRefs(f.repository), `${ref} ${commit}`);
    assert.equal(
      (await git(f.repository, ["rev-parse", "HEAD"])).stdout.trim(),
      commit,
    );
    assert.equal(
      await readFile(path.join(f.repository, "hello.ts"), "utf8"),
      'export const hello = "after";\n',
    );
  } finally {
    await f.cleanup();
  }
});

test("the recovery ref is removed after a later publish succeeds", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      f.workbench.publish(f.run.id, f.run.approvedFingerprint!, [
        "facts-unknown",
      ]),
    );
    const commit = f.run.publishCommit;
    assert.ok(commit);
    const ref = `refs/bellpr/publish-recovery/${f.run.id}/${commit}`;
    await f.workbench.recoverPublish(f.run.id, commit);
    assert.equal(await recoveryRefs(f.repository), `${ref} ${commit}`);
    // The old commit is the remote branch head, so it is not the only copy.
    await f.remoteHead(`${commit}\trefs/heads/${f.run.branch}\n`);
    await f.mode("write");
    await f.workbench.approve(f.run.id, { ...f.run.draft });
    const published = await f.workbench.publish(
      f.run.id,
      f.run.approvedFingerprint!,
      ["facts-unknown"],
    );
    assert.equal(published.status, "published");
    assert.equal(published.prUrl, prUrl);
    assert.notEqual(published.publishCommit, commit);
    assert.equal(await recoveryRefs(f.repository), "");
    await f.workbench.publish(
      f.run.id,
      published.approvedFingerprint!,
      ["facts-unknown"],
    );
    assert.equal(await recoveryRefs(f.repository), "");
  } finally {
    await f.cleanup();
  }
});

test("the recovery ref is removed when the run is removed", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      f.workbench.publish(f.run.id, f.run.approvedFingerprint!, [
        "facts-unknown",
      ]),
    );
    const commit = f.run.publishCommit;
    assert.ok(commit);
    const ref = `refs/bellpr/publish-recovery/${f.run.id}/${commit}`;
    await f.workbench.recoverPublish(f.run.id, commit);
    assert.equal(await recoveryRefs(f.repository), `${ref} ${commit}`);
    await f.workbench.removeRun(f.run.id);
    assert.equal(await recoveryRefs(f.repository), "");
    assert.equal(
      (await git(f.repository, ["rev-parse", f.run.branch])).stdout.trim(),
      commit,
    );
  } finally {
    await f.cleanup();
  }
});

test("the recovery ref of an unpushed commit is kept, including when the run is removed", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      f.workbench.publish(f.run.id, f.run.approvedFingerprint!, [
        "facts-unknown",
      ]),
    );
    const commit = f.run.publishCommit;
    assert.ok(commit);
    const ref = `refs/bellpr/publish-recovery/${f.run.id}/${commit}`;
    await f.workbench.recoverPublish(f.run.id, commit);
    assert.equal(await recoveryRefs(f.repository), `${ref} ${commit}`);
    await git(f.repository, ["update-ref", `refs/heads/${f.run.branch}`, f.baseSha]);
    const fingerprint = "c".repeat(64);
    f.run.approvedFingerprint = fingerprint;
    f.run.status = "published";
    f.run.prUrl = prUrl;
    f.run.headRepository = "test-owner/example";
    f.run.publishedBranch = f.run.branch;
    await f.workbench.publish(f.run.id, fingerprint, ["facts-unknown"]);
    assert.equal(await recoveryRefs(f.repository), `${ref} ${commit}`);
    await f.workbench.removeRun(f.run.id);
    assert.equal(await recoveryRefs(f.repository), `${ref} ${commit}`);
    const logs = path.join(f.workbench.store.directory, "logs");
    const text = (
      await Promise.all(
        (await readdir(logs))
          .filter((name) => name.endsWith(".log"))
          .map((name) => readFile(path.join(logs, name), "utf8")),
      )
    ).join("\n");
    assert.match(
      text,
      new RegExp(`Keeping ${ref}: ${commit} is not reachable`),
    );
  } finally {
    await f.cleanup();
  }
});

test("a sync snapshot does not count as another copy of an unpushed recovery commit", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      f.workbench.publish(f.run.id, f.run.approvedFingerprint!, [
        "facts-unknown",
      ]),
    );
    const commit = f.run.publishCommit;
    assert.ok(commit);
    const ref = `refs/bellpr/publish-recovery/${f.run.id}/${commit}`;
    await f.workbench.recoverPublish(f.run.id, commit);
    await git(f.repository, ["update-ref", `refs/heads/${f.run.branch}`, f.baseSha]);
    const tree = (
      await git(f.repository, ["rev-parse", `${commit}^{tree}`])
    ).stdout.trim();
    const snapshot = (
      await git(f.repository, ["commit-tree", tree, "-p", commit], {
        input: "BELL: checkout before syncing with the target branch\n",
      })
    ).stdout.trim();
    const syncRef = `refs/bellpr/sync/${f.run.id}`;
    await git(f.repository, ["update-ref", syncRef, snapshot]);
    const fingerprint = "d".repeat(64);
    f.run.approvedFingerprint = fingerprint;
    f.run.status = "published";
    f.run.prUrl = prUrl;
    f.run.headRepository = "test-owner/example";
    f.run.publishedBranch = f.run.branch;
    await f.workbench.publish(f.run.id, fingerprint, ["facts-unknown"]);
    assert.equal(await recoveryRefs(f.repository), `${ref} ${commit}`);
    f.run.worktreePath = path.join(
      f.workbench.store.directory,
      "worktrees",
      f.run.id,
    );
    await f.workbench.removeWorkspace(f.run.id);
    assert.equal(await recoveryRefs(f.repository), `${ref} ${commit}`);
    assert.equal(
      (
        await git(f.repository, ["show-ref", "--verify", "--quiet", syncRef], {
          allowedCodes: [0, 1],
        })
      ).code,
      1,
    );
  } finally {
    await f.cleanup();
  }
});

test("another run's sync snapshot does not count as another copy of an unpushed recovery commit", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      f.workbench.publish(f.run.id, f.run.approvedFingerprint!, [
        "facts-unknown",
      ]),
    );
    const commit = f.run.publishCommit;
    assert.ok(commit);
    const ref = `refs/bellpr/publish-recovery/${f.run.id}/${commit}`;
    await f.workbench.recoverPublish(f.run.id, commit);
    await git(f.repository, ["update-ref", `refs/heads/${f.run.branch}`, f.baseSha]);
    const tree = (
      await git(f.repository, ["rev-parse", `${commit}^{tree}`])
    ).stdout.trim();
    const snapshot = (
      await git(f.repository, ["commit-tree", tree, "-p", commit], {
        input: "BELL: checkout before syncing with the target branch\n",
      })
    ).stdout.trim();
    await git(f.repository, ["update-ref", "refs/bellpr/sync/other-run", snapshot]);
    const fingerprint = "e".repeat(64);
    f.run.approvedFingerprint = fingerprint;
    f.run.status = "published";
    f.run.prUrl = prUrl;
    f.run.headRepository = "test-owner/example";
    f.run.publishedBranch = f.run.branch;
    await f.workbench.publish(f.run.id, fingerprint, ["facts-unknown"]);
    assert.equal(await recoveryRefs(f.repository), `${ref} ${commit}`);
    f.run.worktreePath = path.join(
      f.workbench.store.directory,
      "worktrees",
      f.run.id,
    );
    await f.workbench.removeWorkspace(f.run.id);
    assert.equal(await recoveryRefs(f.repository), `${ref} ${commit}`);
  } finally {
    await f.cleanup();
  }
});
