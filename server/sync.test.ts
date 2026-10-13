import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { request } from "node:http";
import os from "node:os";
import path from "node:path";
import { fakeGitHub } from "../test/fake-github.js";
import { createApp } from "./index.js";
import { git } from "./process.js";
import { Store } from "./store.js";
import { Workbench } from "./workbench.js";
import { readDiff } from "./git.js";
import { AppError, type Run } from "./types.js";

async function getJson(url: string) {
  return new Promise<any>((resolve, reject) => {
    request(url, { headers: { host: "127.0.0.1:4311" } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => (body += chunk));
      response.on("end", () => resolve(JSON.parse(body)));
    })
      .on("error", reject)
      .end();
  });
}

test("BELL's clone of a GitHub repository updates to the latest default branch; a local import is never changed", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-sync-test-"));
  const github = await fakeGitHub(directory, {
    files: { "hello.ts": 'export const hello = "before";\n' },
  });
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const workbench = new Workbench(store);
  try {
    const repo = await workbench.importRepository(github.url);
    assert.ok(workbench.managedClone(repo));
    const first = await workbench.updateRepository(repo.id);
    assert.equal(first.updated, false);
    assert.equal(first.from, first.to);
    const upstream = await github.upstreamCommit({ "hello.ts": 'export const hello = "after";\n' });
    const second = await workbench.updateRepository(repo.id);
    assert.equal(second.updated, true);
    assert.equal(second.to, upstream);
    assert.equal((await git(repo.path, ["rev-parse", "HEAD"])).stdout.trim(), upstream);
    assert.equal(
      (await git(repo.path, ["symbolic-ref", "--short", "HEAD"])).stdout.trim(),
      "main",
    );
    assert.ok(repo.updatedAt);

    // A local import is the person's own checkout.
    const local = path.join(directory, "local");
    await mkdir(local);
    await git(local, ["init", "-q", "-b", "main"]);
    await git(local, ["config", "user.name", "Local"]);
    await git(local, ["config", "user.email", "local@example.invalid"]);
    await writeFile(path.join(local, "a.txt"), "a\n");
    await git(local, ["add", "."]);
    await git(local, ["commit", "-qm", "local"]);
    const localRepo = await workbench.importRepository(local);
    assert.equal(workbench.managedClone(localRepo), false);
    const localHead = (await git(local, ["rev-parse", "HEAD"])).stdout.trim();
    await assert.rejects(
      workbench.updateRepository(localRepo.id),
      (error: AppError) => error.statusCode === 409 && /git pull/.test(error.message),
    );
    assert.equal((await git(local, ["rev-parse", "HEAD"])).stdout.trim(), localHead);

    // The list tells the UI which repositories BELL may update.
    const app = createApp(workbench, { staticDirectory: path.join(directory, "missing") });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing port");
    try {
      const { repos } = await getJson(`http://127.0.0.1:${address.port}/api/repos`);
      const updatable = Object.fromEntries(
        repos.map((entry: { id: string; updatable: boolean }) => [entry.id, entry.updatable]),
      );
      assert.deepEqual(updatable, { [repo.id]: true, [localRepo.id]: false });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  } finally {
    github.restore();
    await workbench.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});

const identity = {
  GIT_AUTHOR_NAME: "Sync Test",
  GIT_AUTHOR_EMAIL: "sync@example.invalid",
  GIT_COMMITTER_NAME: "Sync Test",
  GIT_COMMITTER_EMAIL: "sync@example.invalid",
};

/** An unpublished run on BELL's clone of a fake GitHub repository. */
async function unpublishedRun(status: Run["status"] = "review") {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-sync-run-"));
  const github = await fakeGitHub(directory, {
    files: {
      "hello.ts": "line one\nline two\nline three\n",
      "other.ts": "other\n",
    },
  });
  const previousIdentity = Object.fromEntries(
    Object.keys(identity).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, identity);
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const workbench = new Workbench(store);
  const repo = await workbench.importRepository(github.url);
  const baseSha = (await git(repo.path, ["rev-parse", "HEAD"])).stdout.trim();
  const worktreePath = path.join(store.directory, "worktrees", "sync-run");
  await git(repo.path, ["worktree", "add", "-q", "-b", "fix/sync0001", worktreePath, baseSha]);
  const run: Run = {
    id: "sync-run",
    repoId: repo.id,
    title: "Update hello",
    prompt: "Update hello",
    status,
    branch: "fix/sync0001",
    baseBranch: "main",
    baseSha,
    worktreePath,
    createdAt: new Date().toISOString(),
    agents: [],
    logs: [],
    draft: { title: "fix: update hello", body: "Changes the second line of hello." },
    reviewedFiles: [],
    reviewedFingerprints: {},
  };
  store.data.runs.push(run);
  const reviewAll = async () => {
    for (const file of await readDiff(run))
      await workbench.review(run.id, file.path, true, file.fingerprint);
  };
  return {
    directory,
    github,
    store,
    workbench,
    repo,
    run,
    reviewAll,
    read: (file: string) => readFile(path.join(worktreePath, file), "utf8"),
    write: (file: string, content: string) => writeFile(path.join(worktreePath, file), content),
    cleanup: async () => {
      github.restore();
      for (const [key, value] of Object.entries(previousIdentity))
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      await workbench.shutdown();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("an unpublished run syncs onto the latest target branch, keeps its changes and reviews, then publishes on the new base", async () => {
  const f = await unpublishedRun();
  try {
    await f.write("hello.ts", "line one\nline two, mine\nline three\n");
    await f.reviewAll();
    await f.workbench.approve(f.run.id, { ...f.run.draft });
    const upstream = await f.github.upstreamCommit({ "other.ts": "other, upstream\n" });
    // The target branch moved: publishing points the person to the sync.
    await assert.rejects(
      f.workbench.publish(f.run.id, f.run.approvedFingerprint!),
      /同步到最新目標分支/,
    );
    const reviewedBefore = f.run.reviewedFingerprints["hello.ts"];
    const result = await f.workbench.syncRun(f.run.id);
    assert.equal(result.updated, true);
    assert.deepEqual(result.conflicts, []);
    assert.equal(f.run.baseSha, upstream);
    assert.equal(f.run.status, "review");
    assert.equal((await git(f.run.worktreePath, ["rev-parse", "HEAD"])).stdout.trim(), upstream);
    assert.equal(await f.read("hello.ts"), "line one\nline two, mine\nline three\n");
    assert.equal(await f.read("other.ts"), "other, upstream\n");
    // Upstream did not touch hello.ts, so its reviewed diff is unchanged.
    assert.deepEqual((await readDiff(f.run)).map((file) => file.path), ["hello.ts"]);
    assert.equal(f.run.reviewedFingerprints["hello.ts"], reviewedBefore);
    assert.equal((await f.workbench.syncRun(f.run.id)).updated, false);
    await f.workbench.approve(f.run.id, { ...f.run.draft });
    await f.workbench.publish(f.run.id, f.run.approvedFingerprint!, ["unchecked", "issue", "brevity"]);
    assert.equal(f.run.status, "published");
    const pushed = await f.github.head("fix/sync0001");
    assert.equal((await git(f.repo.path, ["rev-parse", `${pushed}^`])).stdout.trim(), upstream);
    await assert.rejects(f.workbench.syncRun(f.run.id), /修正輪/);
  } finally {
    await f.cleanup();
  }
});

test("sync conflicts are labelled, block approval until resolved, and the sync can be undone", async () => {
  const f = await unpublishedRun();
  try {
    await f.write("hello.ts", "line one\nline two, mine\nline three\n");
    await f.reviewAll();
    const before = { ...f.run.reviewedFingerprints };
    const oldBase = f.run.baseSha;
    await f.github.upstreamCommit({ "hello.ts": "line one\nline two, theirs\nline three\n" });
    const result = await f.workbench.syncRun(f.run.id);
    assert.deepEqual(result.conflicts, ["hello.ts"]);
    const conflicted = await f.read("hello.ts");
    assert.match(conflicted, /^<<<<<<< latest main \([0-9a-f]{7}\)$/m);
    assert.match(conflicted, /^>>>>>>> this contribution$/m);
    await f.reviewAll();
    await assert.rejects(
      f.workbench.approve(f.run.id, { ...f.run.draft }),
      (error: AppError) => error.statusCode === 409 && /hello\.ts/.test(error.message),
    );
    // Undo returns the old base, the contribution and its review marks.
    await f.workbench.undoSync(f.run.id);
    assert.equal(f.run.baseSha, oldBase);
    assert.equal(f.run.sync, undefined);
    assert.equal(await f.read("hello.ts"), "line one\nline two, mine\nline three\n");
    assert.deepEqual(f.run.reviewedFingerprints, before);
    await assert.rejects(f.workbench.undoSync(f.run.id), /沒有可以復原/);
    // Sync again and resolve by hand: approval then goes through.
    await f.workbench.syncRun(f.run.id);
    await f.write("hello.ts", "line one\nline two, theirs and mine\nline three\n");
    await f.reviewAll();
    await f.workbench.approve(f.run.id, { ...f.run.draft });
    assert.equal(f.run.status, "approved");
  } finally {
    await f.cleanup();
  }
});

test("a run still waiting for plan approval moves to the latest base with nothing to merge", async () => {
  const f = await unpublishedRun("awaiting_plan");
  try {
    const upstream = await f.github.upstreamCommit({ "other.ts": "other, upstream\n" });
    const result = await f.workbench.syncRun(f.run.id);
    assert.deepEqual(result, { run: f.run, updated: true, conflicts: [] });
    assert.equal(f.run.status, "awaiting_plan");
    assert.equal(f.run.baseSha, upstream);
    assert.deepEqual(await readDiff(f.run), []);
    assert.equal(await f.read("other.ts"), "other, upstream\n");
  } finally {
    await f.cleanup();
  }
});
