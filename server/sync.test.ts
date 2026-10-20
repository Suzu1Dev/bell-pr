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
import { Workbench, type WorkbenchContext } from "./workbench.js";
import { readDiff } from "./git.js";
import { checkoutTreeOnto, filesWithConflictMarkers, labelConflictMarkers, mergeCommits, snapshotCheckout } from "./sync.js";
import { AppError, type Run } from "./types.js";
import type { TeamAgentRunner } from "./team.js";
import { outputLanguage, respondIn } from "./prompt-language.js";
import { withLocale } from "./i18n/index.js";
import { after, before } from "node:test";
import { skipUnderstandingCheckInTests } from "./understanding.js";

// This file tests other behaviour; server/understanding.test.ts covers the gate.
before(() => skipUnderstandingCheckInTests(true));
after(() => skipUnderstandingCheckInTests());

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
    // BELL cloned it, but there is no GitHub source to update from.
    await assert.rejects(
      withLocale("en", () => workbench.updateRepository(localRepo.id)),
      (error: AppError) =>
        error.statusCode === 409 &&
        /has no GitHub source/.test(error.message) &&
        /import it again/.test(error.message),
    );
    // A checkout an earlier build imported in place is the person's own.
    const legacy = { ...localRepo, id: "legacy-checkout", path: local, url: "https://github.com/octo/legacy" };
    store.data.repos.push(legacy);
    await assert.rejects(
      withLocale("en", () => workbench.updateRepository(legacy.id)),
      (error: AppError) => error.statusCode === 409 && /run git pull/.test(error.message),
    );
    store.data.repos.pop();
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

test("a partial clone made by a 1.0.0-beta.0 build gets every object once and reads its history offline", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-sync-test-"));
  const github = await fakeGitHub(directory, {
    files: { "hello.ts": 'export const hello = "first";\n' },
  });
  await github.upstreamCommit({ "hello.ts": 'export const hello = "second";\n' });
  await git(directory, ["--git-dir", github.bare, "branch", "gone", "main"]);
  await github.pushToBranch("gone", { "gone.ts": "export const gone = true;\n" });
  await git(directory, ["--git-dir", github.bare, "config", "uploadpack.allowFilter", "true"]);
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const workbench = new Workbench(store);
  // How a beta build cloned it; the file transport serves the filter here.
  const partialClone = async (target: string) => {
    await rm(target, { recursive: true, force: true });
    await git(directory, [
      "-c",
      "protocol.file.allow=always",
      "clone",
      "-q",
      "--filter=blob:none",
      "--no-recurse-submodules",
      `file://${github.bare}`,
      target,
    ]);
  };
  const missing = async (cwd: string, revision = "--all") =>
    (await git(cwd, ["rev-list", "--objects", "--missing=print", revision])).stdout
      .split("\n")
      .filter((line) => line.startsWith("?")).length;
  const settings = async (cwd: string) =>
    (
      await git(cwd, ["config", "--local", "--get-regexp", "promisor|partialclone"], {
        allowedCodes: [0, 1],
      })
    ).stdout.trim();
  const refetches = async () =>
    (await github.calls()).filter((call) => call.includes("--refetch")).length;
  try {
    const repo = await workbench.importRepository(github.url);
    await partialClone(repo.path);
    assert.ok((await missing(repo.path)) > 0);
    assert.match(await settings(repo.path), /remote\.origin\.promisor true/);
    await workbench.updateRepository(repo.id);
    assert.equal(await settings(repo.path), "");
    assert.equal(await refetches(), 1);
    // Nothing is fetched on demand any more: the old contents are local.
    await git(repo.path, ["remote", "set-url", "origin", path.join(directory, "nowhere.git")]);
    assert.match(
      (await git(repo.path, ["log", "-p", "main"])).stdout,
      /hello = "first"/,
    );
    await workbench.updateRepository(repo.id);
    assert.equal(await refetches(), 1);

    // A branch of BELL's whose commit GitHub no longer has stays fetchable
    // on demand: the clone keeps its settings and gets everything else.
    const second = path.join(path.dirname(repo.path), "example-second");
    await partialClone(second);
    await git(second, ["branch", "kept", "origin/gone"]);
    await git(directory, ["--git-dir", github.bare, "branch", "-D", "gone"]);
    repo.path = second;
    await workbench.updateRepository(repo.id);
    assert.equal(await refetches(), 2);
    assert.match(await settings(second), /remote\.origin\.promisor true/);
    assert.match(await settings(second), /remote\.origin\.partialclonefilter blob:none/);
    assert.equal(await missing(second, "main"), 0);
    assert.ok((await missing(second, "kept")) > 0);
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
async function unpublishedRun(
  status: Run["status"] = "review",
  runner?: TeamAgentRunner,
) {
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
  const workbench = new Workbench(store, runner);
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
    // Once published, a sync merges into the PR; it already has the latest base.
    assert.equal((await f.workbench.syncRun(f.run.id)).updated, false);
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
    assert.deepEqual(f.run.sync!.unresolved, ["hello.ts"]);
    // A further sync waits until these conflicts are resolved.
    await f.github.upstreamCommit({ "other.ts": "other, later\n" });
    await assert.rejects(f.workbench.syncRun(f.run.id), /衝突標記：hello\.ts/);
    await f.write("hello.ts", "line one\nline two, theirs and mine\nline three\n");
    await f.workbench.diff(f.run.id);
    assert.deepEqual(f.run.sync!.unresolved, []);
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

test("a sync whose conflicts cannot be marked, or after a publish that stopped halfway, is refused and changes nothing", async () => {
  const f = await unpublishedRun();
  try {
    // The contribution deletes a file the target branch changed.
    await rm(path.join(f.run.worktreePath, "other.ts"));
    await f.write("hello.ts", "line one\nline two, mine\nline three\n");
    const oldBase = f.run.baseSha;
    await f.github.upstreamCommit({ "other.ts": "other, upstream\n" });
    await assert.rejects(
      f.workbench.syncRun(f.run.id),
      (error: AppError) =>
        error.statusCode === 409 && /無法用衝突標記表示/.test(error.message) && /other\.ts/.test(error.message),
    );
    assert.equal(f.run.baseSha, oldBase);
    assert.equal(f.run.sync, undefined);
    assert.equal((await git(f.run.worktreePath, ["rev-parse", "HEAD"])).stdout.trim(), oldBase);
    await assert.rejects(readFile(path.join(f.run.worktreePath, "other.ts")));
    assert.equal(
      (await git(f.run.worktreePath, ["rev-parse", "--verify", "-q", "refs/bellpr/sync/sync-run"], { allowedCodes: [0, 1] })).stdout,
      "",
    );
    // A commit left by a publish that failed after making it may be on GitHub already.
    f.run.publishCommit = oldBase;
    await assert.rejects(f.workbench.syncRun(f.run.id), /先前的發佈已建立提交/);
  } finally {
    await f.cleanup();
  }
});

test("a sync honours the conflict-marker-size attribute of the checkout", async () => {
  const f = await unpublishedRun();
  try {
    await f.write(".gitattributes", "*.ts conflict-marker-size=20\n");
    await f.write("hello.ts", "line one\nline two, mine\nline three\n");
    await f.github.upstreamCommit({ "hello.ts": "line one\nline two, theirs\nline three\n" });
    assert.deepEqual((await f.workbench.syncRun(f.run.id)).conflicts, ["hello.ts"]);
    const conflicted = await f.read("hello.ts");
    assert.match(conflicted, /^<{20} latest main \([0-9a-f]{7}\)$/m);
    assert.match(conflicted, /^>{20} this contribution$/m);
    assert.deepEqual(f.run.sync!.unresolved, ["hello.ts"]);
    await f.reviewAll();
    await assert.rejects(f.workbench.approve(f.run.id, { ...f.run.draft }), /衝突標記/);
    await f.write("hello.ts", "line one\nline two, theirs and mine\nline three\n");
    await f.reviewAll();
    await f.workbench.approve(f.run.id, { ...f.run.draft });
    assert.deepEqual(f.run.sync!.unresolved, []);
  } finally {
    await f.cleanup();
  }
});

test("conflict labels keep the bytes of non-UTF-8 files and CRLF line ends, at each file's marker width", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-sync-label-"));
  try {
    await git(directory, ["init", "-q"]);
    const ours = "a".repeat(40);
    const theirs = "b".repeat(40);
    const big5 = Buffer.from([0xa4, 0xa4, 0xa4, 0xe5]);
    const file = (top: string, bottom: string) =>
      Buffer.concat([
        Buffer.from(`title `),
        big5,
        Buffer.from(`\r\n<<<<<<< ${top}\r\n`),
        big5,
        Buffer.from(`\r\n=======\r\nx\r\n>>>>>>> ${bottom}\r\n`),
      ]);
    await writeFile(path.join(directory, "zh.txt"), file(ours, theirs));
    await labelConflictMarkers(directory, ["zh.txt"], {
      [ours]: "latest main (aaaaaaa)",
      [theirs]: "this contribution",
    });
    assert.deepEqual(
      await readFile(path.join(directory, "zh.txt")),
      file("latest main (aaaaaaa)", "this contribution"),
    );
    // A conflict-marker-size attribute changes the width git writes and BELL reads.
    await writeFile(path.join(directory, ".gitattributes"), "*.adoc conflict-marker-size=12\n");
    const wide = (top: string, bottom: string) =>
      `Title\n=======\n${"<".repeat(12)} ${top}\nours\n${"=".repeat(12)}\ntheirs\n${">".repeat(12)} ${bottom}\n`;
    await writeFile(path.join(directory, "doc.adoc"), wide(ours, theirs));
    await labelConflictMarkers(directory, ["doc.adoc"], {
      [ours]: "latest main (aaaaaaa)",
      [theirs]: "this contribution",
    });
    assert.equal(
      await readFile(path.join(directory, "doc.adoc"), "utf8"),
      wide("latest main (aaaaaaa)", "this contribution"),
    );
    assert.deepEqual(await filesWithConflictMarkers(directory, ["doc.adoc", "zh.txt"]), ["doc.adoc", "zh.txt"]);
    // A seven-character heading underline is not a marker in a file whose markers are wider.
    await writeFile(path.join(directory, "doc.adoc"), "Title\n=======\nresolved\n");
    assert.deepEqual(await filesWithConflictMarkers(directory, ["doc.adoc"]), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

/**
 * How long a background resolution may take before a test gives up. The
 * whole suite runs its files in parallel, and on a loaded machine the fake
 * agents, Git and the saves take far longer than alone, so the wait is
 * generous; BELLPR_AGENT_TIMEOUT_SCALE stretches it further. It ends as
 * soon as the predicate holds.
 */
const settleTimeoutMs =
  30_000 * (Number(process.env.BELLPR_AGENT_TIMEOUT_SCALE) || 1);

async function until(predicate: () => boolean) {
  const end = Date.now() + settleTimeoutMs;
  while (!predicate()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test("an agent resolves sync conflicts for review, leftover markers keep blocking, and stopping or restarting keeps the edits", async () => {
  let behaviour: "resolve" | "partial" | "commit" | "wait" = "resolve";
  let prompt = "";
  let entered = () => {};
  const f = await unpublishedRun("review", async (input) => {
    assert.equal(input.role, "sync");
    assert.equal(input.readonly, false);
    prompt = input.prompt;
    const file = path.join(input.cwd, "hello.ts");
    if (behaviour === "wait") {
      await writeFile(file, "line one\nline two, half done\nline three\n");
      entered();
      await new Promise<void>((_, reject) =>
        input.signal.addEventListener("abort", () => reject(new Error("Cancelled")), { once: true }),
      );
    }
    if (behaviour !== "partial")
      await writeFile(file, "line one\nline two, theirs and mine\nline three\n");
    if (behaviour === "commit") await git(input.cwd, ["commit", "-qam", "agent commit"]);
    return JSON.stringify({
      summary: "保留目標分支的文字，再加上這次的修改。",
      files: [{ path: "hello.ts", resolution: "兩邊的改動合併成一行。" }],
    });
  });
  try {
    await f.write("hello.ts", "line one\nline two, mine\nline three\n");
    await f.github.upstreamCommit({ "hello.ts": "line one\nline two, theirs\nline three\n" });
    await f.workbench.syncRun(f.run.id);
    // Leftover markers keep approval blocked and are named in the report.
    behaviour = "partial";
    await f.workbench.resolveConflicts(f.run.id);
    assert.equal(f.run.status, "running");
    await until(() => f.run.status === "review");
    assert.match(prompt, /hello\.ts/);
    assert.match(prompt, /latest main/);
    assert.match(f.run.sync!.report!, /仍有衝突標記：hello\.ts/);
    await f.reviewAll();
    await assert.rejects(f.workbench.approve(f.run.id, { ...f.run.draft }), /衝突標記/);
    // An agent that commits is undone; its resolution waits for review.
    behaviour = "commit";
    await f.workbench.resolveConflicts(f.run.id);
    await until(() => f.run.status === "review");
    assert.equal((await git(f.run.worktreePath, ["rev-parse", "HEAD"])).stdout.trim(), f.run.baseSha);
    assert.match(f.run.sync!.report!, /自行建立了 commit/);
    assert.deepEqual(f.run.sync!.resolutions, [{ path: "hello.ts", resolution: "兩邊的改動合併成一行。" }]);
    assert.equal(await f.read("hello.ts"), "line one\nline two, theirs and mine\nline three\n");
    await assert.rejects(f.workbench.resolveConflicts(f.run.id), /都已解決/);
    await f.reviewAll();
    await f.workbench.approve(f.run.id, { ...f.run.draft });
    assert.equal(f.run.status, "approved");

    // Stopping keeps the half-done edit and returns to review.
    await f.workbench.undoSync(f.run.id);
    await f.workbench.syncRun(f.run.id);
    behaviour = "wait";
    const started = new Promise<void>((resolve) => (entered = resolve));
    await f.workbench.resolveConflicts(f.run.id);
    await started;
    await f.workbench.cancel(f.run.id);
    assert.equal(f.run.status, "review");
    assert.match(f.run.sync!.report!, /已停止解衝突/);
    assert.equal(await f.read("hello.ts"), "line one\nline two, half done\nline three\n");

    // A restart in the middle of a resolution returns the run to review.
    f.run.status = "running";
    f.run.sync!.resolving = true;
    await f.store.save();
    const reopened = new Store(f.store.directory);
    await reopened.initialize();
    const saved = reopened.data.runs[0];
    assert.equal(saved.status, "review");
    assert.equal(saved.sync!.resolving, false);
    assert.match(saved.sync!.report!, /服務重新啟動/);
  } finally {
    await f.cleanup();
  }
});

test("a conflict resolution works in the run's locale, whatever the locale of the request that started it", async () => {
  let prompt = "";
  const f = await unpublishedRun("review", async (input) => {
    prompt = input.prompt;
    await writeFile(
      path.join(input.cwd, "hello.ts"),
      "line one\nline two, theirs and mine\nline three\n",
    );
    return JSON.stringify({
      summary: "Kept the target branch's line and added this change.",
      files: [{ path: "hello.ts", resolution: "Merged both edits into one line." }],
    });
  });
  try {
    f.run.locale = "en";
    await f.write("hello.ts", "line one\nline two, mine\nline three\n");
    await f.github.upstreamCommit({ "hello.ts": "line one\nline two, theirs\nline three\n" });
    await f.workbench.syncRun(f.run.id);
    // Requested under the zh-TW default; the agent's turn belongs to the run.
    await f.workbench.resolveConflicts(f.run.id);
    await until(() => f.run.status === "review");
    assert.match(prompt, /hello\.ts/);
    assert.ok(prompt.startsWith(respondIn("en")));
    assert.ok(!prompt.includes(outputLanguage("zh-TW")));
    // The labels written into the files stay English.
    assert.match(prompt, /labelled "latest main"/);
    assert.equal(
      f.run.logs.at(-1)?.message,
      "The agent resolved the merge conflicts; review these files one by one.",
    );
    const agent = f.run.agents.find((entry) => entry.id === "sync");
    assert.equal(agent?.detail, "Conflicts resolved; waiting for review");
    assert.equal(
      f.run.sync!.report,
      "Kept the target branch's line and added this change.",
    );
  } finally {
    await f.cleanup();
  }
});

/** A run published as a PR through the fake GitHub. */
async function publishedRun(runner?: TeamAgentRunner) {
  const f = await unpublishedRun("review", runner);
  await f.write("hello.ts", "line one\nline two, mine\nline three\n");
  await f.reviewAll();
  await f.workbench.approve(f.run.id, { ...f.run.draft });
  await f.workbench.publish(f.run.id, f.run.approvedFingerprint!, ["unchecked", "issue", "brevity"]);
  assert.equal(f.run.status, "published");
  return f;
}

const parentsOf = async (cwd: string, commit: string) =>
  (await git(cwd, ["rev-list", "--parents", "-n", "1", commit])).stdout.trim().split(/\s+/).slice(1);

test("a published PR takes the latest target branch as one reviewed merge commit, never a second PR", async () => {
  const f = await publishedRun();
  try {
    const prHead = f.run.publishCommit!;
    const upstream = await f.github.upstreamCommit({ "other.ts": "other, upstream\n" });
    const result = await f.workbench.syncRun(f.run.id);
    assert.equal(result.updated, true);
    const round = f.run.followUps!.at(-1)!;
    assert.equal(round.kind, "sync");
    assert.equal(round.mergeParent, upstream);
    assert.equal(f.run.status, "review");
    assert.equal(f.run.baseSha, upstream);
    assert.equal(f.run.draft.commitMessage, "Merge branch 'main' into fix/sync0001");
    // Measured from the merged-in target, the PR still changes only hello.ts.
    assert.deepEqual((await readDiff(f.run)).map((file) => file.path), ["hello.ts"]);
    await f.reviewAll();
    await f.workbench.approve(f.run.id, { ...f.run.draft });
    await f.workbench.publish(f.run.id, f.run.approvedFingerprint!);
    assert.equal(round.status, "published");
    const merge = await f.github.head("fix/sync0001");
    assert.equal(merge, f.run.publishCommit);
    assert.deepEqual(await parentsOf(f.repo.path, merge), [prHead, upstream]);
    const creates = (await f.github.calls()).filter((call) => call[0] === "gh" && call[2] === "create");
    assert.equal(creates.length, 1);
    assert.equal((await f.workbench.syncRun(f.run.id)).updated, false);
  } finally {
    await f.cleanup();
  }
});

test("a conflicting PR sync can be discarded, or resolved by the agent and pushed after review", async () => {
  const f = await publishedRun(async (input) => {
    assert.equal(input.role, "sync");
    await writeFile(path.join(input.cwd, "hello.ts"), "line one\nline two, theirs and mine\nline three\n");
    return JSON.stringify({ summary: "合併兩邊。", files: [{ path: "hello.ts", resolution: "合併成一行。" }] });
  });
  try {
    const prHead = f.run.publishCommit!;
    const oldBase = f.run.baseSha;
    const upstream = await f.github.upstreamCommit({ "hello.ts": "line one\nline two, theirs\nline three\n" });
    assert.deepEqual((await f.workbench.syncRun(f.run.id)).conflicts, ["hello.ts"]);
    assert.match(await f.read("hello.ts"), /^<<<<<<< this pull request$/m);
    await f.reviewAll();
    await assert.rejects(f.workbench.approve(f.run.id, { ...f.run.draft }), /衝突標記/);
    // Discarding returns to the pushed PR and its old base.
    await f.workbench.discardFollowUp(f.run.id);
    assert.equal(f.run.status, "published");
    assert.equal(f.run.baseSha, oldBase);
    assert.equal(await f.read("hello.ts"), "line one\nline two, mine\nline three\n");
    // Sync again, let the agent resolve, review and push.
    await f.workbench.syncRun(f.run.id);
    await f.workbench.resolveConflicts(f.run.id);
    await until(() => f.run.status === "review");
    const round = f.run.followUps!.at(-1)!;
    assert.deepEqual(round.resolutions, [{ path: "hello.ts", resolution: "合併成一行。" }]);
    await f.reviewAll();
    await f.workbench.approve(f.run.id, { ...f.run.draft });
    await f.workbench.publish(f.run.id, f.run.approvedFingerprint!);
    const merge = await f.github.head("fix/sync0001");
    assert.deepEqual(await parentsOf(f.repo.path, merge), [prHead, upstream]);
    assert.equal(
      (await git(f.repo.path, ["show", `${merge}:hello.ts`])).stdout,
      "line one\nline two, theirs and mine\nline three\n",
    );
  } finally {
    await f.cleanup();
  }
});

test("a PR sync takes in files the target branch added, also after the agent commits while resolving", async () => {
  const f = await publishedRun(async (input) => {
    await writeFile(path.join(input.cwd, "hello.ts"), "line one\nline two, theirs and mine\nline three\n");
    await git(input.cwd, ["commit", "-qam", "agent commit"]);
    return JSON.stringify({ summary: "合併兩邊。", files: [{ path: "hello.ts", resolution: "合併成一行。" }] });
  });
  try {
    const prHead = f.run.publishCommit!;
    const upstream = await f.github.upstreamCommit({
      "hello.ts": "line one\nline two, theirs\nline three\n",
      "brand-new.ts": "new upstream\n",
    });
    await f.workbench.syncRun(f.run.id);
    const round = f.run.followUps!.at(-1)!;
    assert.deepEqual(round.unresolved, ["hello.ts"]);
    // Upstream's new file is part of the base, not something the PR deletes.
    assert.deepEqual(
      (await readDiff(f.run)).map((file) => `${file.path}:${file.status}`),
      ["hello.ts:modified"],
    );
    await f.workbench.resolveConflicts(f.run.id);
    await until(() => f.run.status === "review");
    assert.equal((await git(f.run.worktreePath, ["rev-parse", "HEAD"])).stdout.trim(), prHead);
    assert.deepEqual(round.unresolved, []);
    assert.deepEqual(
      (await readDiff(f.run)).map((file) => `${file.path}:${file.status}`),
      ["hello.ts:modified"],
    );
    await f.reviewAll();
    await f.workbench.approve(f.run.id, { ...f.run.draft });
    await f.workbench.publish(f.run.id, f.run.approvedFingerprint!);
    const merge = await f.github.head("fix/sync0001");
    assert.deepEqual(await parentsOf(f.repo.path, merge), [prHead, upstream]);
    assert.equal((await git(f.repo.path, ["show", `${merge}:brand-new.ts`])).stdout, "new upstream\n");
    assert.equal((await git(f.run.worktreePath, ["status", "--porcelain", "--untracked-files=all"])).stdout, "");

    // A target that already holds all of the PR's changes leaves nothing to merge.
    const before = f.run.followUps!.length;
    await f.github.upstreamCommit({ "hello.ts": "line one\nline two, theirs and mine\nline three\n" });
    await assert.rejects(f.workbench.syncRun(f.run.id), /已經包含這個 PR 的全部修改/);
    assert.equal(f.run.followUps!.length, before);
    assert.equal(f.run.status, "published");

    // The target deleting a file this PR changed cannot be marked: nothing moves.
    const pushed = f.run.publishCommit!;
    await f.github.upstreamCommit({ "hello.ts": null });
    await assert.rejects(f.workbench.syncRun(f.run.id), /無法用衝突標記表示.*hello\.ts/);
    assert.equal(f.run.status, "published");
    assert.equal(f.run.followUps!.at(-1), round);
    assert.equal((await git(f.run.worktreePath, ["rev-parse", "HEAD"])).stdout.trim(), pushed);
    assert.equal((await git(f.run.worktreePath, ["status", "--porcelain", "--untracked-files=all"])).stdout, "");
  } finally {
    await f.cleanup();
  }
});

test("commits pushed to the PR branch on GitHub are taken over before a round; rewritten history is refused", async () => {
  const f = await publishedRun(async (input) => {
    await writeFile(path.join(input.cwd, "hello.ts"), "line one\nline two, reviewed\nline three\n");
    return JSON.stringify({ summary: "改了第二行。", addressed: [], notAddressed: [], checks: [], commitMessage: "Polish line two" });
  });
  try {
    const bellPush = f.run.publishCommit!;
    const theirs = await f.github.pushToBranch("fix/sync0001", { "notes.md": "Suggested on GitHub.\n" });
    const feedbackUrl = `${f.run.prUrl}#discussion_r1`;
    f.run.prFeedback = {
      fetchedAt: new Date().toISOString(),
      prNumber: 1,
      items: [
        {
          kind: "thread",
          author: "maintainer",
          authorAssociation: "MEMBER",
          body: "Polish line two.",
          path: "hello.ts",
          line: 2,
          url: feedbackUrl,
          createdAt: new Date().toISOString(),
        },
      ],
    };
    await f.workbench.startFollowUp(f.run.id, { feedbackUrls: [feedbackUrl] });
    const adopted = f.run.followUps![0];
    assert.equal(adopted.adopted, true);
    assert.equal(adopted.commit, theirs);
    assert.equal(adopted.parentCommit, bellPush);
    await until(() => f.run.status === "review");
    assert.equal(f.run.followUps![1].parentCommit, theirs);
    // Discarding the round leaves the taken-over file still to be reviewed.
    await f.workbench.discardFollowUp(f.run.id);
    assert.deepEqual(f.run.reviewedFiles, ["hello.ts"]);
    await f.workbench.startFollowUp(f.run.id, { feedbackUrls: [feedbackUrl] });
    await until(() => f.run.status === "review");
    const round = f.run.followUps![2];
    assert.equal(round.parentCommit, theirs);
    // The adopted change is reviewed together with the round's own.
    assert.deepEqual((await readDiff(f.run)).map((file) => file.path), ["hello.ts", "notes.md"]);
    await f.reviewAll();
    await f.workbench.approve(f.run.id, { ...f.run.draft });
    await f.workbench.publish(f.run.id, f.run.approvedFingerprint!);
    assert.deepEqual(await parentsOf(f.repo.path, await f.github.head("fix/sync0001")), [theirs]);

    // History that no longer contains BELL's push is refused.
    const mainHead = await f.github.head("main");
    await git(f.repo.path, ["--git-dir", f.github.bare, "update-ref", "refs/heads/fix/sync0001", mainHead]);
    await assert.rejects(
      f.workbench.startFollowUp(f.run.id, { feedbackUrls: [feedbackUrl] }),
      /改寫了 BELL PR 推送過的歷史/,
    );
    assert.equal(f.run.status, "published");
  } finally {
    await f.cleanup();
  }
});

/**
 * Runs `edit` once, right after the next repository lock a sync takes (the
 * fetch of the target branch, or of the PR branch's new commits): a change
 * the person saves in the run's folder after the sync's clean check.
 */
function savedAfterCleanCheck(f: Awaited<ReturnType<typeof publishedRun>>, edit: () => Promise<void>) {
  const ctx = (f.workbench as unknown as { context: WorkbenchContext }).context;
  const lock = ctx.lock.bind(ctx);
  let pending: (() => Promise<void>) | undefined = edit;
  ctx.lock = (async (key: string, task: () => Promise<unknown>) => {
    const result = await lock(key, task);
    if (key.startsWith("repository:") && pending) {
      const saved = pending;
      pending = undefined;
      await saved();
    }
    return result;
  }) as WorkbenchContext["lock"];
}

const indexDiffers = async (cwd: string) => (await git(cwd, ["diff", "--cached", "--quiet"], { allowedCodes: [0, 1] })).code === 1;

test("a PR sync never overwrites a change saved in the run's folder after its clean check", async () => {
  const f = await publishedRun();
  try {
    await f.github.upstreamCommit({ "other.ts": "other, upstream\n" });
    // A file the merge leaves as it is: the sync goes on, and the saved change stays for review.
    const later = "line one\nline two, mine and later\nline three\n";
    savedAfterCleanCheck(f, () => f.write("hello.ts", later));
    assert.equal((await f.workbench.syncRun(f.run.id)).updated, true);
    assert.equal(await f.read("hello.ts"), later);
    assert.equal(await f.read("other.ts"), "other, upstream\n");
  } finally {
    await f.cleanup();
  }
  const g = await publishedRun();
  try {
    await g.github.upstreamCommit({ "other.ts": "other, upstream\n" });
    // A file the merge changes: nothing moves, and the saved change stays.
    savedAfterCleanCheck(g, () => g.write("other.ts", "other, mine\n"));
    const rounds = g.run.followUps?.length ?? 0;
    const head = (await git(g.run.worktreePath, ["rev-parse", "HEAD"])).stdout.trim();
    await assert.rejects(
      withLocale("en", () => g.workbench.syncRun(g.run.id)),
      (error: unknown) => error instanceof AppError && error.statusCode === 409 && /^A file in the run's folder changed while BELL PR was syncing/.test(error.message),
    );
    assert.equal(await g.read("other.ts"), "other, mine\n");
    assert.equal(g.run.followUps?.length ?? 0, rounds);
    assert.equal(g.run.status, "published");
    assert.equal((await git(g.run.worktreePath, ["rev-parse", "HEAD"])).stdout.trim(), head);
    assert.equal(await indexDiffers(g.run.worktreePath), false);
  } finally {
    await g.cleanup();
  }
});

test("commits pushed on GitHub are taken over before a PR sync only from HEAD, never over a change saved meanwhile", async () => {
  const f = await publishedRun();
  try {
    const pushed = await f.github.pushToBranch("fix/sync0001", { "hello.ts": "line one\nline two, suggested\nline three\n" });
    const mine = "line one\nline two, mine and saved\nline three\n";
    savedAfterCleanCheck(f, () => f.write("hello.ts", mine));
    const before = f.run.publishCommit;
    await assert.rejects(
      withLocale("en", () => f.workbench.syncRun(f.run.id)),
      (error: unknown) =>
        error instanceof AppError &&
        error.statusCode === 409 &&
        // The person's words, never git's ("error: Entry … would be overwritten").
        /^Changes saved in the run's folder touch files that the new commits on fix\/sync0001 change/.test(error.message) &&
        !/error:|fatal:|Entry/.test(error.message),
    );
    assert.equal(await f.read("hello.ts"), mine);
    assert.equal(f.run.publishCommit, before);
    assert.notEqual((await git(f.run.worktreePath, ["rev-parse", "HEAD"])).stdout.trim(), pushed);
  } finally {
    await f.cleanup();
  }
});

test("writing a merged tree onto a checkout keeps a file saved after its snapshot, or refuses and moves nothing", async () => {
  const f = await unpublishedRun();
  try {
    await f.write("hello.ts", "line one\nline two, mine\nline three\n");
    const target = await f.github.upstreamCommit({ "other.ts": "other, upstream\n" });
    await git(f.repo.path, ["fetch", "-q", "origin"]);
    const snapshot = await snapshotCheckout(f.run.worktreePath, path.join(f.directory, "sync-index"));
    const merged = await mergeCommits(f.run.worktreePath, target, snapshot, f.run.baseSha);
    // Saved after the snapshot, in a file the merge changes: refused, with the checkout and its index as they were.
    await f.write("other.ts", "other, mine\n");
    await assert.rejects(
      checkoutTreeOnto(f.run.worktreePath, merged.tree, target, snapshot),
      (error: unknown) => error instanceof AppError && error.statusCode === 409,
    );
    assert.equal(await f.read("other.ts"), "other, mine\n");
    assert.equal(await f.read("hello.ts"), "line one\nline two, mine\nline three\n");
    assert.equal(await indexDiffers(f.run.worktreePath), false);
    // Saved in a file the merge leaves alone: written, and the saved change stays.
    await git(f.run.worktreePath, ["checkout", "--", "other.ts"]);
    await f.write("hello.ts", "line one\nline two, mine and later\nline three\n");
    await checkoutTreeOnto(f.run.worktreePath, merged.tree, target, snapshot);
    assert.equal(await f.read("other.ts"), "other, upstream\n");
    assert.equal(await f.read("hello.ts"), "line one\nline two, mine and later\nline three\n");
  } finally {
    await f.cleanup();
  }
});

test("a sync goes through as before when Git left unmerged entries in the run's folder index", async () => {
  // A `git stash pop` or merge that stopped on a conflict in the run's folder leaves stages 1-3 in its index.
  const f = await unpublishedRun();
  try {
    await f.write("hello.ts", "line one\nline two, mine\nline three\n");
    const blob = (await git(f.run.worktreePath, ["hash-object", "-w", "hello.ts"])).stdout.trim();
    await git(f.run.worktreePath, ["update-index", "--index-info"], {
      input: `0 ${"0".repeat(40)}\thello.ts\n${[1, 2, 3].map((stage) => `100644 ${blob} ${stage}\thello.ts`).join("\n")}\n`,
    });
    assert.notEqual((await git(f.run.worktreePath, ["ls-files", "-u"])).stdout.trim(), "");
    const upstream = await f.github.upstreamCommit({ "other.ts": "other, upstream\n" });
    assert.equal((await f.workbench.syncRun(f.run.id)).updated, true);
    assert.equal(f.run.baseSha, upstream);
    assert.equal(await f.read("hello.ts"), "line one\nline two, mine\nline three\n");
    assert.equal(await f.read("other.ts"), "other, upstream\n");
    // The index holds the new base, as every sync leaves it.
    assert.equal((await git(f.run.worktreePath, ["ls-files", "-u"])).stdout.trim(), "");
    assert.equal(await indexDiffers(f.run.worktreePath), false);
    await f.workbench.undoSync(f.run.id);
    assert.equal(await f.read("other.ts"), "other\n");
    assert.equal(await f.read("hello.ts"), "line one\nline two, mine\nline three\n");
  } finally {
    await f.cleanup();
  }
});
