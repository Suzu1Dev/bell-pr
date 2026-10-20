import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { request } from "node:http";
import os from "node:os";
import path from "node:path";
import { commitDetail, listCommits } from "./commits.js";
import { createApp } from "./index.js";
import { git } from "./process.js";
import { Store } from "./store.js";
import { Workbench } from "./workbench.js";
import type { AppError, Run } from "./types.js";
import { withLocale } from "./i18n/index.js";

const identity = {
  GIT_AUTHOR_NAME: "Sample Author",
  GIT_AUTHOR_EMAIL: "author@example.invalid",
  GIT_COMMITTER_NAME: "Sample Author",
  GIT_COMMITTER_EMAIL: "author@example.invalid",
};

test("a published contribution lists its first push, review rounds, syncs and GitHub commits, oldest first", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-commits-test-"));
  const repository = path.join(directory, "repo");
  const commit = async (files: Record<string, string>, message: string, ...parents: string[]) => {
    for (const [file, content] of Object.entries(files))
      await writeFile(path.join(repository, file), content);
    await git(repository, ["add", "-A"]);
    const tree = (await git(repository, ["write-tree"])).stdout.trim();
    return (
      await git(repository, ["commit-tree", tree, ...parents.flatMap((parent) => ["-p", parent])], {
        input: `${message}\n`,
        env: { ...process.env, ...identity },
      })
    ).stdout.trim();
  };
  try {
    await git(directory, ["init", "-q", "-b", "main", repository]);
    const base = await commit({ "a.ts": "a\n", "b.ts": "b\n" }, "base");
    const first = await commit({ "a.ts": "a1\n", ".env": "PASSWORD=x\n" }, "fix: first push\n\nWhy it matters.", base);
    const review = await commit({ "a.ts": "a2\n" }, "Address review", first);
    await git(repository, ["read-tree", base]);
    const target = await commit({ "b.ts": "b upstream\n" }, "upstream", base);
    await git(repository, ["read-tree", review]);
    const merge = await commit({ "b.ts": "b upstream\n" }, "Merge branch 'main' into fix/x", review, target);
    const github = await commit({ "c.ts": "suggested\n" }, "Apply suggestion from review", merge);
    const run = {
      worktreePath: repository,
      baseSha: target,
      publishCommit: github,
      followUps: [
        { id: "1", requestedAt: "", feedbackUrls: [], status: "published", parentCommit: first, commit: review },
        { id: "2", kind: "sync", requestedAt: "", feedbackUrls: [], status: "published", parentCommit: review, commit: merge, mergeParent: target },
        { id: "3", kind: "sync", adopted: true, requestedAt: "", feedbackUrls: [], status: "published", parentCommit: merge, commit: github },
        // A discarded round never reaches the branch.
        { id: "4", requestedAt: "", feedbackUrls: [], status: "discarded", parentCommit: github },
      ],
    } as Pick<Run, "worktreePath" | "baseSha" | "publishCommit" | "followUps">;

    const commits = await listCommits(run);
    assert.deepEqual(
      commits.map((entry) => [entry.subject, entry.source, entry.round ?? null, entry.parents.length]),
      [
        ["fix: first push", "initial", null, 1],
        ["Address review", "review", 1, 1],
        ["Merge branch 'main' into fix/x", "sync", null, 2],
        ["Apply suggestion from review", "adopted", null, 1],
      ],
    );
    // The target branch's own commit is part of the base, not of the PR.
    assert.ok(!commits.some((entry) => entry.sha === target));
    assert.equal(commits[0].body, "Why it matters.");
    assert.equal(commits[0].author, "Sample Author");
    assert.deepEqual([commits[0].files, commits[0].additions, commits[0].deletions], [2, 2, 1]);
    // A merge counts what it brought in against the PR's previous head.
    assert.deepEqual([commits[2].files, commits[2].additions], [1, 1]);

    const detail = await commitDetail(run, first);
    assert.equal(detail.omitted, 0);
    const byPath = Object.fromEntries(detail.files.map((entry) => [entry.path, entry]));
    assert.equal(byPath["a.ts"].status, "modified");
    assert.match(byPath["a.ts"].patch, /^-a\n\+a1$/m);
    assert.equal(byPath[".env"].status, "added");
    assert.equal(byPath[".env"].patch, "");
    assert.match(byPath[".env"].blocked!, /敏感檔案/);
    await assert.rejects(commitDetail(run, target), (error: AppError) => error.statusCode === 404);
    assert.deepEqual(await listCommits({ ...run, publishCommit: undefined }), []);

    // Over HTTP: a run, its commits, and a malformed commit id refused.
    const store = new Store(path.join(directory, "state"));
    await store.initialize();
    const workbench = new Workbench(store);
    store.data.runs.push({
      id: "commits-run",
      repoId: "r",
      title: "t",
      prompt: "p",
      status: "published",
      branch: "fix/x",
      baseBranch: "main",
      createdAt: "",
      agents: [],
      logs: [],
      draft: { title: "t", body: "b" },
      reviewedFiles: [],
      reviewedFingerprints: {},
      ...run,
    } as Run);
    const server = createApp(workbench, { staticDirectory: path.join(directory, "missing") }).listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing server port");
      const get = (url: string) =>
        new Promise<{ status: number; body: string }>((resolve, reject) => {
          request(`http://127.0.0.1:${address.port}${url}`, { headers: { host: "127.0.0.1:4311" } }, (response) => {
            let body = "";
            response.setEncoding("utf8");
            response.on("data", (chunk) => (body += chunk));
            response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
          })
            .on("error", reject)
            .end();
        });
      const listed = await get("/api/runs/commits-run/commits");
      assert.equal(listed.status, 200);
      assert.equal(JSON.parse(listed.body).commits.length, 4);
      assert.equal((await get(`/api/runs/commits-run/commits/${review}`)).status, 200);
      assert.equal((await get("/api/runs/commits-run/commits/HEAD")).status, 400);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await workbench.shutdown();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("why a commit's file is not shown is worded in the reader's language", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-commits-locale-"));
  const repository = path.join(directory, "repo");
  try {
    await git(directory, ["init", "-q", "-b", "main", repository]);
    const env = { ...process.env, ...identity };
    await writeFile(path.join(repository, "a.ts"), "a\n");
    await git(repository, ["add", "-A"]);
    await git(repository, ["commit", "-qm", "base"], { env });
    const base = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();
    await writeFile(path.join(repository, ".env"), "PASSWORD=x\n");
    await git(repository, ["add", "-A"]);
    await git(repository, ["commit", "-qm", "add env"], { env });
    const head = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();
    const run = { worktreePath: repository, baseSha: base, publishCommit: head, followUps: [] };
    const detail = await withLocale("en", () => commitDetail(run, head));
    assert.equal(detail.files[0].blocked, "A sensitive file or build artifact; its content is not shown.");
    await assert.rejects(
      withLocale("en", () => commitDetail(run, base)),
      (error: AppError) => error.statusCode === 404 && error.message === "This commit is not part of the contribution.",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
