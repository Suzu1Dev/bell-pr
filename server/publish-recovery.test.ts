import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { request } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "./app.js";
import { command, git } from "./process.js";
import { Store } from "./store.js";
import { Workbench, type WorkbenchContext } from "./workbench.js";
import { AppError, type Run } from "./types.js";

interface RemoteScenario {
  branchOutput?: string;
  branchCode?: number;
  branchRepository?: string;
  branchName?: string;
  prText?: string;
  prCode?: number;
  userText?: string;
  userCode?: number;
}

async function fixture() {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "bell-publish-recovery-"),
  );
  const repository = path.join(directory, "repo");
  await mkdir(repository);
  const realGit = (await command("which", ["git"])).stdout.trim();
  await git(repository, ["init", "-b", "main"]);
  await git(repository, ["config", "user.name", "BELL Test"]);
  await git(repository, ["config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(repository, "hello.txt"), "base\n");
  await git(repository, ["add", "hello.txt"]);
  await git(repository, ["commit", "-m", "base"]);
  const baseSha = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();
  await git(repository, ["checkout", "-b", "fix/recovery"]);
  await writeFile(path.join(repository, "hello.txt"), "old publish content\n");
  await git(repository, ["commit", "-am", "old publish message"]);
  const oldCommit = (
    await git(repository, ["rev-parse", "HEAD"])
  ).stdout.trim();
  // New work after the failed publish: preserve staged, unstaged and untracked contents separately.
  await writeFile(path.join(repository, "hello.txt"), "new staged content\n");
  await git(repository, ["add", "hello.txt"]);
  await writeFile(path.join(repository, "hello.txt"), "new working content\n");
  await writeFile(path.join(repository, "notes.txt"), "untracked notes\n");
  const store = new Store(path.join(directory, "data"));
  await store.initialize();
  const workbench = new Workbench(store);
  await workbench.maintenance;
  const repo = await workbench.importRepository(repository);
  Object.assign(repo, {
    url: "https://github.com/upstream/example",
    fullName: "upstream/example",
    owner: "upstream",
    name: "example",
  });
  const run: Run = {
    id: "recovery-run",
    repoId: repo.id,
    title: "Current title",
    prompt: "Update a greeting",
    status: "approved",
    branch: "fix/recovery",
    baseBranch: "main",
    baseSha,
    worktreePath: repository,
    createdAt: new Date().toISOString(),
    agents: [],
    logs: [],
    draft: {
      title: "Current title",
      body: "Current draft with newer validation.",
      commitMessage: "new publish message",
      publishBranch: "fix/new-name",
    },
    reviewedFiles: ["hello.txt"],
    reviewedFingerprints: { "hello.txt": "a".repeat(64) },
    approvedFingerprint: "b".repeat(64),
    publishCommit: oldCommit,
    error: "Previous publish failed before choosing a push target.",
    session: {
      messages: [
        { id: "u", role: "user", content: "Keep my conversation.", at: "t" },
      ],
      revision: 1,
      updatedAt: "t",
    },
  };
  store.data.runs.push(run);
  await store.save();
  const bin = path.join(directory, "bin");
  const scenarioFile = path.join(directory, "scenario.json");
  const callsFile = path.join(directory, "calls.jsonl");
  await mkdir(bin);
  await writeFile(scenarioFile, "{}");
  await writeFile(callsFile, "");
  await writeFile(
    path.join(bin, "git"),
    `#!/usr/bin/env node
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify(['git', ...args]) + '\\n');
const scenario = JSON.parse(fs.readFileSync(${JSON.stringify(scenarioFile)}, 'utf8'));
if (args.includes('ls-remote')) {
  const repository = args.find(x => x.startsWith('https://'));
  const branch = args.at(-1);
  const matches = (!scenario.branchRepository || repository === 'https://github.com/' + scenario.branchRepository + '.git') && (!scenario.branchName || branch === 'refs/heads/' + scenario.branchName);
  if (matches) { process.stdout.write(scenario.branchOutput ?? ''); process.exit(scenario.branchCode ?? 0); }
  process.exit(0);
}
if (args.includes('push') || args.includes('fetch') || args.includes('clone')) process.exit(97);
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
const scenario = JSON.parse(fs.readFileSync(${JSON.stringify(scenarioFile)}, 'utf8'));
if (args[0] === 'api' && args[1] === 'user') { process.stdout.write(scenario.userText ?? '{"login":"test-owner"}'); process.exit(scenario.userCode ?? 0); }
if (args[0] === 'pr' && args[1] === 'list') { process.stdout.write(scenario.prText ?? '[]'); process.exit(scenario.prCode ?? 0); }
process.exit(97);
`,
    { mode: 0o700 },
  );
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath}`;
  return {
    workbench,
    store,
    run,
    repository,
    oldCommit,
    scenario: (value: RemoteScenario) =>
      writeFile(scenarioFile, JSON.stringify(value)),
    calls: async () =>
      (await readFile(callsFile, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[]),
    cleanup: async () => {
      process.env.PATH = previousPath;
      await workbench.shutdown();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

async function checkout(repository: string) {
  const read = async (args: string[]) => (await git(repository, args)).stdout;
  return {
    head: await read(["rev-parse", "HEAD"]),
    branch: await read(["symbolic-ref", "HEAD"]),
    tree: await read(["write-tree"]),
    staged: await read(["diff", "--cached", "--binary"]),
    working: await read(["diff", "--binary"]),
    untracked: await readFile(path.join(repository, "notes.txt"), "utf8"),
  };
}
const refused = (status: number) => (error: unknown) =>
  error instanceof AppError && error.statusCode === status;

test("recovery preserves the old commit, current checkout, draft, review marks and conversation", async () => {
  const f = await fixture();
  try {
    const before = await checkout(f.repository);
    const draft = structuredClone(f.run.draft);
    const session = structuredClone(f.run.session);
    const reviews = {
      files: [...f.run.reviewedFiles],
      fingerprints: { ...f.run.reviewedFingerprints },
    };
    const result = await f.workbench.recoverPublish(f.run.id, f.oldCommit);
    assert.equal(result, f.run);
    assert.equal(result.status, "review");
    assert.equal(result.publishCommit, undefined);
    assert.equal(result.error, undefined);
    assert.equal(result.approvedFingerprint, undefined);
    assert.deepEqual(await checkout(f.repository), before);
    assert.deepEqual(result.draft, draft);
    assert.deepEqual(result.session, session);
    assert.deepEqual(result.reviewedFiles, reviews.files);
    assert.deepEqual(result.reviewedFingerprints, reviews.fingerprints);
    const preserved = (
      await git(f.repository, [
        "rev-parse",
        `refs/bellpr/publish-recovery/${f.run.id}/${f.oldCommit}`,
      ])
    ).stdout.trim();
    assert.equal(preserved, f.oldCommit);
    assert.ok(result.logs.some((entry) => entry.message.includes(f.oldCommit)));
    const calls = await f.calls();
    const reads = calls.filter((args) => args.includes("ls-remote"));
    assert.equal(reads.length, 4);
    for (const repository of ["upstream/example", "test-owner/example"])
      for (const branch of ["fix/recovery", "fix/new-name"])
        assert.ok(
          reads.some(
            (args) =>
              args.includes(`https://github.com/${repository}.git`) &&
              args.at(-1) === `refs/heads/${branch}`,
          ),
        );
    const prs = calls.filter((args) => args[0] === "gh" && args[1] === "pr");
    assert.equal(prs.length, 2);
    assert.ok(
      prs.every((args) => args.includes("all") && !args.includes("open")),
    );
    assert.ok(
      !calls.some(
        (args) =>
          args.includes("push") ||
          args.includes("create") ||
          args.includes("fork"),
      ),
    );
    const persisted = JSON.parse(
      await readFile(path.join(f.store.directory, "state.json"), "utf8"),
    );
    assert.equal(persisted.runs[0].publishCommit, undefined);
  } finally {
    await f.cleanup();
  }
});

test("remote branches and any prior PR prevent recovery without changing the state", async () => {
  const f = await fixture();
  try {
    for (const scenario of [
      {
        branchOutput: `${"c".repeat(40)}\trefs/heads/fix/recovery\n`,
        branchName: "fix/recovery",
        branchRepository: "upstream/example",
      },
      {
        branchOutput: `${"d".repeat(40)}\trefs/heads/fix/new-name\n`,
        branchName: "fix/new-name",
        branchRepository: "test-owner/example",
      },
      {
        prText: JSON.stringify([
          { number: 9, state: "CLOSED", headRefOid: "e".repeat(40) },
        ]),
      },
      { prText: JSON.stringify([{ number: 10, state: "MERGED" }]) },
    ]) {
      await f.scenario(scenario);
      const before = structuredClone(f.run);
      await assert.rejects(
        f.workbench.recoverPublish(f.run.id, f.oldCommit),
        refused(409),
      );
      assert.deepEqual(f.run, before);
    }
    assert.equal(
      (
        await git(f.repository, [
          "for-each-ref",
          "--format=%(refname)",
          "refs/bellpr/publish-recovery/",
        ])
      ).stdout,
      "",
    );
  } finally {
    await f.cleanup();
  }
});

test("unreadable repositories, network failures and malformed results are never treated as absence", async () => {
  const f = await fixture();
  try {
    for (const scenario of [
      { branchCode: 128 },
      { branchCode: 128, branchRepository: "test-owner/example" },
      { branchOutput: "not a ref\n" },
      { branchOutput: `${"a".repeat(41)}\trefs/heads/fix/recovery\n` },
      { branchOutput: `${"a".repeat(40)}\trefs/heads/unexpected\n` },
      { prText: "not json" },
      { prText: "{}" },
      { prText: "null" },
      { prCode: 1 },
      { userText: "{}" },
      { userText: '{"login":"bad/name"}' },
      { userCode: 1 },
    ]) {
      await f.scenario(scenario);
      const before = structuredClone(f.run);
      await assert.rejects(
        f.workbench.recoverPublish(f.run.id, f.oldCommit),
        refused(502),
      );
      assert.deepEqual(f.run, before);
    }
  } finally {
    await f.cleanup();
  }
});

test("recorded push targets, stale expected commits and active jobs prevent recovery before remote reads", async () => {
  const f = await fixture();
  try {
    for (const key of ["headRepository", "publishedBranch", "prUrl"] as const) {
      f.run[key] =
        key === "headRepository"
          ? "test-owner/example"
          : key === "publishedBranch"
            ? "fix/recovery"
            : "https://github.com/upstream/example/pull/1";
      const before = structuredClone(f.run);
      await assert.rejects(
        f.workbench.recoverPublish(f.run.id, f.oldCommit),
        refused(409),
      );
      assert.deepEqual(f.run, before);
      delete f.run[key];
    }
    await assert.rejects(
      f.workbench.recoverPublish(f.run.id, "a".repeat(40)),
      refused(409),
    );
    f.run.session!.running = true;
    await assert.rejects(
      f.workbench.recoverPublish(f.run.id, f.oldCommit),
      refused(409),
    );
    delete f.run.session!.running;
    const ctx = (f.workbench as unknown as { context: WorkbenchContext })
      .context;
    for (const jobs of [
      ctx.sessionJobs,
      ctx.draftJobs,
      ctx.reviewJobs,
      ctx.followUpJobs,
      ctx.conflictJobs,
    ]) {
      jobs.set(f.run.id, Promise.resolve());
      await assert.rejects(
        f.workbench.recoverPublish(f.run.id, f.oldCommit),
        refused(409),
      );
      jobs.delete(f.run.id);
    }
    ctx.controllers.set(`premise:${f.run.id}`, new AbortController());
    await assert.rejects(
      f.workbench.recoverPublish(f.run.id, f.oldCommit),
      refused(409),
    );
    ctx.controllers.clear();
    f.run.publishing = true;
    await assert.rejects(
      f.workbench.recoverPublish(f.run.id, f.oldCommit),
      refused(409),
    );
    delete f.run.publishing;
    assert.equal(f.run.publishCommit, f.oldCommit);
    assert.equal(
      (await f.calls()).filter(
        (args) => args[0] === "gh" || args.includes("ls-remote"),
      ).length,
      0,
    );
  } finally {
    await f.cleanup();
  }
});

test("the recovery API requires the exact commit field and returns the recovered run", async () => {
  const f = await fixture();
  const server = createApp(f.workbench, {
    staticDirectory: path.join(os.tmpdir(), "bell-no-ui"),
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as { port: number };
  const call = (body: unknown) =>
    new Promise<{ status: number; body: { run?: Run } }>((resolve, reject) => {
      const req = request(
        `http://127.0.0.1:${port}/api/runs/${f.run.id}/publish/recover`,
        {
          method: "POST",
          headers: {
            host: "127.0.0.1:4311",
            "content-type": "application/json",
          },
        },
        (response) => {
          let text = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            text += chunk;
          });
          response.on("end", () =>
            resolve({ status: response.statusCode!, body: JSON.parse(text) }),
          );
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify(body));
    });
  try {
    for (const body of [
      {},
      { expectedCommit: f.oldCommit },
      { commit: f.oldCommit, extra: true },
      { commit: "a".repeat(41) },
      { commit: 123 },
      { commit: ` ${f.oldCommit}` },
    ])
      assert.equal((await call(body)).status, 400);
    assert.equal((await call({ commit: "b".repeat(64) })).status, 409);
    assert.equal(f.run.publishCommit, f.oldCommit);
    const recovered = await call({ commit: f.oldCommit });
    assert.equal(recovered.status, 200);
    assert.equal(recovered.body.run?.status, "review");
    assert.equal(recovered.body.run?.publishCommit, undefined);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await f.cleanup();
  }
});
