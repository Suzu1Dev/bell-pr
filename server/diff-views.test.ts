import assert from "node:assert/strict";
import { once } from "node:events";
import { request } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "./app.js";
import { readDiffView } from "./diff-views.js";
import { readDiff } from "./git.js";
import { git } from "./process.js";
import { AppError, type Run } from "./types.js";
import { Workbench } from "./workbench.js";

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-diff-views-"));
  await git(directory, ["init", "-q", "-b", "main"]);
  await git(directory, ["config", "user.name", "BELL Test"]);
  await git(directory, ["config", "user.email", "test@example.invalid"]);
  const commit = async (files: Record<string, string>, message: string) => {
    for (const [file, content] of Object.entries(files))
      await writeFile(path.join(directory, file), content);
    await git(directory, ["add", "-A"]);
    await git(directory, ["commit", "-qm", message]);
    return (await git(directory, ["rev-parse", "HEAD"])).stdout.trim();
  };
  const base = await commit({ "a.ts": "base\n" }, "base");
  const initial = await commit(
    { "a.ts": "initial\n", "first.ts": "first round\n" },
    "initial contribution",
  );
  const second = await commit(
    { "a.ts": "second\n", "second.ts": "second round\n" },
    "review feedback",
  );
  await commit({ "third.ts": "remote suggestion\n" }, "remote suggestion");
  const adopted = await commit(
    { "fourth.ts": "another remote suggestion\n" },
    "another remote suggestion",
  );
  const run: Run = {
    id: "diff-run",
    repoId: "repo",
    title: "Change greeting",
    prompt: "Change greeting",
    branch: "main",
    baseBranch: "main",
    baseSha: base,
    worktreePath: directory,
    status: "approved",
    createdAt: new Date().toISOString(),
    locale: "en",
    agents: [],
    logs: [],
    draft: { title: "Current title", body: "Current body" },
    reviewedFiles: ["a.ts"],
    reviewedFingerprints: { "a.ts": "saved-review" },
    approvedFingerprint: "saved-approval",
    error: "Preserve this message",
    prUrl: "https://github.com/test-owner/example/pull/1",
    publishCommit: adopted,
    followUps: [
      {
        id: "second-round",
        status: "published",
        parentCommit: initial,
        commit: second,
        requestedAt: "",
        feedbackUrls: [],
      },
      {
        id: "adopted-round",
        kind: "sync",
        adopted: true,
        status: "published",
        parentCommit: second,
        commit: adopted,
        requestedAt: "",
        feedbackUrls: [],
      },
      {
        id: "current-round",
        status: "review",
        parentCommit: adopted,
        requestedAt: "",
        feedbackUrls: [],
      },
    ],
  };
  await writeFile(path.join(directory, "a.ts"), "staged current\n");
  await git(directory, ["add", "a.ts"]);
  await writeFile(path.join(directory, "a.ts"), "working current\n");
  await rm(path.join(directory, "first.ts"));
  await writeFile(path.join(directory, "current.txt"), "untracked current\n");
  let locks = 0;
  const workbench = {
    store: {
      directory,
      data: { runs: [run], repos: [] },
      save: async () => assert.fail("A history read must not save state"),
    },
    run: (id: string) => {
      assert.equal(id, run.id);
      return run;
    },
    lock: async (_id: string, task: () => Promise<unknown>) => {
      locks++;
      return task();
    },
    diff: async () =>
      assert.fail("A history read must not synchronize the live diff"),
    diffView: Workbench.prototype.diffView,
  } as unknown as Workbench;
  return {
    directory,
    run,
    base,
    initial,
    second,
    adopted,
    workbench,
    locks: () => locks,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

const paths = (files: Awaited<ReturnType<typeof readDiff>>) =>
  files.map((file) => file.path);
const missing = (error: unknown) =>
  error instanceof AppError && error.statusCode === 404;

async function checkout(directory: string) {
  return {
    head: (await git(directory, ["rev-parse", "HEAD"])).stdout,
    index: (await git(directory, ["write-tree"])).stdout,
    status: (await git(directory, ["status", "--porcelain=v1", "-z"])).stdout,
    content: await readFile(path.join(directory, "a.ts"), "utf8"),
  };
}

test("current, cumulative, initial and published round diffs stay separate and history reads preserve state", async () => {
  const f = await fixture();
  try {
    const before = structuredClone(f.run);
    const beforeCheckout = await checkout(f.directory);
    const current = await readDiff(f.run);
    assert.deepEqual(paths(current), ["a.ts", "current.txt", "first.ts"]);
    assert.match(current[0].patch, /-second\n\+working current/);
    assert.equal(
      current.find((file) => file.path === "first.ts")?.status,
      "deleted",
    );
    const all = await f.workbench.diffView(f.run.id, "all");
    assert.equal(all.baseSha, f.base);
    assert.equal(all.headSha, undefined);
    assert.deepEqual(paths(all.files), [
      "a.ts",
      "current.txt",
      "fourth.ts",
      "second.ts",
      "third.ts",
    ]);
    assert.match(all.files[0].patch, /-base\n\+working current/);
    const second = await f.workbench.diffView(f.run.id, "second-round");
    assert.deepEqual(paths(second.files), ["a.ts", "second.ts"]);
    assert.equal(second.baseSha, f.initial);
    assert.equal(second.headSha, f.second);
    assert.match(second.files[0].patch, /-initial\n\+second/);
    const adopted = await f.workbench.diffView(f.run.id, "adopted-round");
    assert.deepEqual(paths(adopted.files), ["fourth.ts", "third.ts"]);
    assert.equal(adopted.baseSha, f.second);
    assert.equal(adopted.headSha, f.adopted);
    const initial = await f.workbench.diffView(f.run.id, "initial");
    assert.deepEqual(paths(initial.files), ["a.ts", "first.ts"]);
    assert.equal(initial.baseSha, f.base);
    assert.equal(initial.headSha, f.initial);
    assert.match(initial.files[0].patch, /-base\n\+initial/);
    assert.deepEqual(f.run, before);
    assert.deepEqual(await checkout(f.directory), beforeCheckout);
    assert.equal(f.locks(), 4);
    // A later upstream sync moves baseSha; the initial comparison still uses its own parent.
    f.run.baseSha = f.second;
    assert.deepEqual(await readDiffView(f.run, "initial"), initial);
  } finally {
    await f.cleanup();
  }
});

test("ordinary review fingerprints bind the round and base while initial and sync fingerprints stay compatible", async () => {
  const f = await fixture();
  try {
    const current = (await readDiff(f.run)).find(
      (file) => file.path === "a.ts",
    )!;
    const last = f.run.followUps!.at(-1)!;
    const next = (
      await readDiff({ ...f.run, followUps: [{ ...last, id: "next-round" }] })
    ).find((file) => file.path === "a.ts")!;
    const differentBase = (
      await readDiff({
        ...f.run,
        followUps: [{ ...last, parentCommit: f.second }],
      })
    ).find((file) => file.path === "a.ts")!;
    assert.equal(next.patch, current.patch);
    assert.equal(differentBase.patch, current.patch);
    assert.notEqual(next.fingerprint, current.fingerprint);
    assert.notEqual(differentBase.fingerprint, current.fingerprint);
    const cumulative = await readDiff({ ...f.run, followUps: undefined });
    assert.deepEqual(
      await readDiff({ ...f.run, followUps: [{ ...last, kind: "sync" }] }),
      cumulative,
    );
    const preview = await readDiff({
      ...f.run,
      baseSha: f.adopted,
      followUps: undefined,
    });
    assert.equal(preview[0].patch, current.patch);
    assert.notEqual(preview[0].fingerprint, current.fingerprint);
  } finally {
    await f.cleanup();
  }
});

test("history permits only recorded published commit ranges and hides sensitive content", async () => {
  const f = await fixture();
  try {
    for (const scope of [
      "current-round",
      "current",
      "unknown",
      f.initial,
      "HEAD",
      "--help",
    ])
      await assert.rejects(readDiffView(f.run, scope), missing);
    await assert.rejects(
      readDiffView({ ...f.run, prUrl: undefined }, "all"),
      missing,
    );
    await assert.rejects(
      readDiffView({ ...f.run, publishCommit: undefined }, "initial"),
      missing,
    );
    for (const commit of [
      "HEAD",
      "a".repeat(40),
      (await git(f.directory, ["rev-parse", `${f.second}:a.ts`])).stdout.trim(),
    ]) {
      const changed = structuredClone(f.run);
      changed.followUps![0].commit = commit;
      await assert.rejects(readDiffView(changed, "second-round"), missing);
    }
    const discarded = structuredClone(f.run);
    discarded.followUps![0].status = "discarded";
    await assert.rejects(readDiffView(discarded, "second-round"), missing);
    await git(f.directory, ["reset", "--hard", f.adopted]);
    await writeFile(path.join(f.directory, ".env"), "PASSWORD=private\n");
    await writeFile(
      path.join(f.directory, "token.ts"),
      'const token = "' + "ghp_" + "a".repeat(36) + '";\n',
    );
    await git(f.directory, ["add", ".env", "token.ts"]);
    await git(f.directory, ["commit", "-qm", "sensitive example"]);
    const sensitive = (
      await git(f.directory, ["rev-parse", "HEAD"])
    ).stdout.trim();
    f.run.followUps!.push({
      id: "sensitive",
      status: "published",
      parentCommit: f.adopted,
      commit: sensitive,
      feedbackUrls: [],
      requestedAt: "",
    });
    f.run.publishCommit = sensitive;
    const files = (await readDiffView(f.run, "sensitive")).files;
    assert.deepEqual(paths(files), [".env", "token.ts"]);
    assert.ok(
      files.every(
        (file) =>
          file.blocked &&
          !file.patch.includes("PASSWORD=private") &&
          !file.patch.includes("ghp_"),
      ),
    );
  } finally {
    await f.cleanup();
  }
});

test("the diff view API strictly validates its query and never updates the run", async () => {
  const f = await fixture();
  const server = createApp(f.workbench).listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as { port: number };
  const call = (query: string) =>
    new Promise<{ status: number; body: Record<string, unknown> }>(
      (resolve, reject) => {
        const req = request(
          `http://127.0.0.1:${port}/api/runs/${f.run.id}/diff-view${query}`,
          { headers: { host: "127.0.0.1:4311" } },
          (response) => {
            let body = "";
            response.setEncoding("utf8");
            response.on("data", (part) => {
              body += part;
            });
            response.on("end", () =>
              resolve({ status: response.statusCode!, body: JSON.parse(body) }),
            );
          },
        );
        req.on("error", reject);
        req.end();
      },
    );
  try {
    const before = structuredClone(f.run);
    for (const query of [
      "",
      "?round=",
      "?round=all&extra=1",
      "?round=all&round=initial",
    ])
      assert.equal((await call(query)).status, 400);
    assert.equal((await call("?round=current-round")).status, 404);
    assert.equal((await call("?round=unknown")).status, 404);
    const initial = await call("?round=initial");
    assert.equal(initial.status, 200);
    assert.equal(initial.body.baseSha, f.base);
    assert.equal(initial.body.headSha, f.initial);
    assert.ok(Array.isArray(initial.body.files));
    assert.deepEqual(f.run, before);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await f.cleanup();
  }
});
