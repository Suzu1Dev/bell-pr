import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { request } from "node:http";
import { command, git, redact } from "./process.js";
import {
  parseGitHubSource,
  readDiff,
  reviewFingerprint,
  synchronizeReview,
  sensitivePath,
} from "./git.js";
import { Store } from "./store.js";
import { Workbench } from "./workbench.js";
import { createApp } from "./index.js";
import { AppError, type Run } from "./types.js";
import { defaultContributionSettings } from "../shared/insights.js";

async function http(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
) {
  return new Promise<{
    status: number;
    headers: Record<string, string | string[] | undefined>;
    json: () => any;
    text: () => string;
  }>((resolve, reject) => {
    const req = request(
      url,
      { method: options.method, headers: options.headers },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () =>
          resolve({
            status: response.statusCode!,
            headers: response.headers,
            json: () => JSON.parse(body),
            text: () => body,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
}

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-pr-test-"));
  const repository = path.join(directory, "repo");
  await mkdir(repository);
  await git(repository, ["init", "-b", "main"]);
  await git(repository, ["config", "user.name", "BELL Test"]);
  await git(repository, ["config", "user.email", "test@example.invalid"]);
  await writeFile(
    path.join(repository, "hello.ts"),
    'export const hello = "before";\n',
  );
  await writeFile(
    path.join(repository, "[id].ts"),
    "export const literal = 1;\n",
  );
  await writeFile(path.join(repository, "i.ts"), "export const other = 1;\n");
  await git(repository, ["add", "--", "hello.ts", "[id].ts", "i.ts"]);
  await git(repository, ["commit", "-m", "initial"]);
  const baseSha = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const workbench = new Workbench(store);
  const repo = await workbench.importRepository(repository);
  const run: Run = {
    id: "test-run",
    repoId: repo.id,
    title: "Improve greeting",
    prompt: "Improve greeting",
    status: "review",
    branch: "main",
    baseBranch: "main",
    baseSha,
    worktreePath: repository,
    createdAt: new Date().toISOString(),
    agents: [],
    logs: [],
    draft: {
      title: "Improve greeting",
      body: "A tested greeting improvement.",
    },
    reviewedFiles: [],
    reviewedFingerprints: {},
  };
  store.data.runs.push(run);
  return {
    directory,
    repository,
    baseSha,
    run,
    store,
    workbench,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

test("GitHub sources are normalized and remote option-like inputs rejected", () => {
  assert.equal(
    parseGitHubSource("https://github.com/openai/codex.git")?.fullName,
    "openai/codex",
  );
  assert.equal(
    parseGitHubSource("git@github.com:openai/codex.git")?.url,
    "https://github.com/openai/codex",
  );
  assert.equal(
    parseGitHubSource("https://github.com/openai/codex/extra"),
    null,
  );
  assert.equal(
    parseGitHubSource("https://user:password@github.com/openai/codex"),
    null,
  );
  assert.equal(parseGitHubSource("--config=whatever"), null);
  assert.equal(parseGitHubSource("https://example.com/openai/codex"), null);
});

test("real Git diffs include tracked, added and literal bracket paths, with stable staged patches", async () => {
  const f = await fixture();
  try {
    await writeFile(
      path.join(f.repository, "hello.ts"),
      'export const hello = "after";\n',
    );
    await writeFile(
      path.join(f.repository, "new file.ts"),
      "export const added = true;\n",
    );
    await writeFile(
      path.join(f.repository, "[id].ts"),
      "export const literal = 2;\n",
    );
    await writeFile(
      path.join(f.repository, "i.ts"),
      "export const other = 2;\n",
    );
    const files = await readDiff(f.run);
    assert.equal(files.length, 4);
    assert.equal(
      files.find((file) => file.path === "new file.ts")?.status,
      "added",
    );
    const bracket = files.find((file) => file.path === "[id].ts")!;
    assert.match(bracket.patch, /literal = 2/);
    assert.doesNotMatch(bracket.patch, /other = 2/);
    assert.equal(bracket.hunks.length, 1);
    assert.equal(bracket.additions, 1);
    await git(f.repository, [
      "--literal-pathspecs",
      "add",
      "--",
      ...files.map((file) => file.path),
    ]);
    const staged = await readDiff(f.run);
    assert.deepEqual(
      staged.map((file) => file.fingerprint),
      files.map((file) => file.fingerprint),
    );
    for (const file of files) {
      const patch = (
        await git(f.repository, [
          "--literal-pathspecs",
          "diff",
          "--cached",
          "--no-ext-diff",
          "--no-textconv",
          "--no-renames",
          f.baseSha,
          "--",
          file.path,
        ])
      ).stdout;
      assert.equal(patch, file.patch);
    }
  } finally {
    await f.cleanup();
  }
});

test("approval requires current per-file reviews and is invalidated by later edits", async () => {
  const f = await fixture();
  try {
    await writeFile(
      path.join(f.repository, "hello.ts"),
      'export const hello = "after";\n',
    );
    await assert.rejects(
      f.workbench.approve(f.run.id, { ...f.run.draft }),
      /審閱所有/,
    );
    await f.workbench.review(
      f.run.id,
      "hello.ts",
      true,
      (await readDiff(f.run))[0].fingerprint,
    );
    await f.workbench.approve(f.run.id, { ...f.run.draft });
    assert.equal(f.run.status, "approved");
    const approved = f.run.approvedFingerprint;
    await writeFile(
      path.join(f.repository, "hello.ts"),
      'export const hello = "changed again";\n',
    );
    await f.workbench.diff(f.run.id);
    assert.equal(f.run.status, "review");
    assert.equal(f.run.approvedFingerprint, undefined);
    assert.deepEqual(f.run.reviewedFiles, []);
    assert.notEqual(
      reviewFingerprint(await readDiff(f.run), f.run.draft),
      approved,
    );
    await assert.rejects(f.workbench.publish(f.run.id, approved!), /核准/);
  } finally {
    await f.cleanup();
  }
});

test("draft changes clear approval while preserving unchanged file reviews", async () => {
  const f = await fixture();
  try {
    await writeFile(
      path.join(f.repository, "hello.ts"),
      'export const hello = "after";\n',
    );
    await f.workbench.review(
      f.run.id,
      "hello.ts",
      true,
      (await readDiff(f.run))[0].fingerprint,
    );
    await f.workbench.approve(f.run.id, { ...f.run.draft });
    await f.workbench.draft(f.run.id, {
      title: "Edited title",
      body: "Updated body",
    });
    assert.equal(f.run.status, "review");
    assert.equal(f.run.approvedFingerprint, undefined);
    assert.deepEqual(f.run.reviewedFiles, ["hello.ts"]);
  } finally {
    await f.cleanup();
  }
});

test("review rejects a changed file when the user submits the fingerprint of an older displayed diff", async () => {
  const f = await fixture();
  try {
    await writeFile(
      path.join(f.repository, "hello.ts"),
      'export const hello = "displayed version";\n',
    );
    const displayedFile = (await f.workbench.diff(f.run.id))[0];
    await writeFile(
      path.join(f.repository, "hello.ts"),
      'export const hello = "unseen newer version";\n',
    );
    await assert.rejects(
      f.workbench.review(
        f.run.id,
        displayedFile.path,
        true,
        displayedFile.fingerprint,
      ),
      (error) =>
        error instanceof AppError &&
        error.statusCode === 409 &&
        /重新載入/.test(error.message),
    );
    assert.deepEqual(f.run.reviewedFiles, []);
    assert.equal(f.run.reviewedFingerprints[displayedFile.path], undefined);
    const reloadedFile = (await f.workbench.diff(f.run.id))[0];
    await f.workbench.review(
      f.run.id,
      reloadedFile.path,
      true,
      reloadedFile.fingerprint,
    );
    assert.equal(
      f.run.reviewedFingerprints[reloadedFile.path],
      reloadedFile.fingerprint,
    );
  } finally {
    await f.cleanup();
  }
});

test("approval rejects an unseen draft and publish rejects an older approved preview", async () => {
  const f = await fixture();
  try {
    await writeFile(
      path.join(f.repository, "hello.ts"),
      'export const hello = "after";\n',
    );
    const file = (await f.workbench.diff(f.run.id))[0];
    await f.workbench.review(f.run.id, file.path, true, file.fingerprint);
    const displayedDraft = { ...f.run.draft };
    await f.workbench.approve(f.run.id, displayedDraft);
    const previousApproval = f.run.approvedFingerprint!;
    await f.workbench.draft(f.run.id, {
      title: "Changed in another tab",
      body: "New draft content.",
    });
    await assert.rejects(
      f.workbench.approve(f.run.id, displayedDraft),
      (error) =>
        error instanceof AppError &&
        error.statusCode === 409 &&
        /草稿已更新/.test(error.message),
    );
    assert.equal(f.run.status, "review");
    assert.equal(f.run.approvedFingerprint, undefined);
    await f.workbench.approve(f.run.id, { ...f.run.draft });
    assert.notEqual(f.run.approvedFingerprint, previousApproval);
    await assert.rejects(
      f.workbench.publish(f.run.id, previousApproval),
      (error) =>
        error instanceof AppError &&
        error.statusCode === 409 &&
        /核准版本已更新/.test(error.message),
    );
    assert.equal(f.run.publishCommit, undefined);
    assert.equal(f.run.publishing, undefined);
  } finally {
    await f.cleanup();
  }
});

test("sensitive files and credential-like diff content are blocked and hidden", async () => {
  const f = await fixture();
  try {
    assert.equal(sensitivePath(".env"), true);
    assert.equal(sensitivePath(".env.local"), true);
    assert.equal(sensitivePath(".env.example"), false);
    await writeFile(path.join(f.repository, ".env"), "PASSWORD=private-value");
    await writeFile(
      path.join(f.repository, "hello.ts"),
      'export const key = "' + "ghp_" + "a".repeat(36) + '";\n',
    );
    const files = await readDiff(f.run);
    assert.equal(files.length, 2);
    assert.ok(files.every((file) => file.blocked));
    assert.ok(
      files.every(
        (file) =>
          !file.patch.includes("private-value") &&
          !file.patch.includes("a".repeat(36)),
      ),
    );
    await assert.rejects(
      f.workbench.review(
        f.run.id,
        ".env",
        true,
        files.find((file) => file.path === ".env")!.fingerprint,
      ),
    );
  } finally {
    await f.cleanup();
  }
});

test("store preserves state and marks interrupted work as failed on restart", async () => {
  const f = await fixture();
  try {
    f.run.status = "running";
    await f.store.save();
    const reopened = new Store(f.store.directory);
    await reopened.initialize();
    assert.equal(reopened.data.repos.length, 1);
    assert.equal(reopened.data.runs[0].status, "failed");
    assert.match(reopened.data.runs[0].error!, /中斷/);
  } finally {
    await f.cleanup();
  }
});

test("process output is bounded and cancellation terminates a running command", async () => {
  await assert.rejects(
    command(
      process.execPath,
      ["-e", 'process.stdout.write("x".repeat(4096))'],
      { maxBytes: 64 },
    ),
    /輸出超過/,
  );
  const controller = new AbortController();
  const running = command(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    { signal: controller.signal },
  );
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(running, /取消/);
  assert.equal(redact("ghp_" + "a".repeat(36)), "[REDACTED]");
});

test("HTTP API restricts localhost origins, requires JSON mutations, and validates input", async () => {
  const f = await fixture();
  const app = createApp(f.workbench, {
    staticDirectory: path.join(f.directory, "missing"),
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing server port");
  const url = `http://127.0.0.1:${address.port}`;
  const local = { host: "127.0.0.1:4311" };
  try {
    const good = await http(`${url}/api/repos`, { headers: local });
    assert.equal(good.status, 200);
    assert.equal(((await good.json()) as { repos: unknown[] }).repos.length, 1);
    const badHost = await http(`${url}/api/repos`, {
      headers: { host: "invalid.example:4311" },
    });
    assert.equal(badHost.status, 403);
    const crossSite = await http(`${url}/api/repos`, {
      headers: { ...local, origin: "https://invalid.example" },
    });
    assert.equal(crossSite.status, 403);
    const plain = await http(`${url}/api/repos`, {
      method: "POST",
      headers: local,
      body: "text",
    });
    assert.equal(plain.status, 415);
    const invalid = await http(`${url}/api/repos`, {
      method: "POST",
      headers: { ...local, "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(invalid.status, 400);
    const absent = await http(`${url}/api/runs/missing`, { headers: local });
    assert.equal(absent.status, 404);
    // The list carries summaries; the single run and the export keep the detail.
    f.run.reports = { reviewer: "靜態審查報告" };
    f.run.conversations = {
      "hello.ts": {
        fingerprint: "f1",
        updatedAt: new Date().toISOString(),
        messages: [
          { role: "user", content: "這段在做什麼？", fingerprint: "f1" },
          { role: "assistant", content: "回傳問候語。", fingerprint: "f1" },
        ],
      },
    };
    const list = await http(`${url}/api/runs`, { headers: local });
    assert.equal(list.status, 200);
    const [summary] = list.json().runs as Record<string, unknown>[];
    assert.equal(summary.id, f.run.id);
    for (const field of ["logs", "reports", "draftPreparation", "conversations"])
      assert.equal(field in summary, false, field);
    for (const field of ["title", "repoId", "branch", "status", "createdAt"])
      assert.ok(field in summary, field);
    const single = await http(`${url}/api/runs/${f.run.id}`, {
      headers: local,
    });
    assert.deepEqual(single.json().run.logs, []);
    assert.equal(
      single.json().run.conversations["hello.ts"].messages.length,
      2,
    );
    const exported = await http(`${url}/api/runs/${f.run.id}/export.md`, {
      headers: local,
    });
    assert.equal(exported.status, 200);
    assert.match(String(exported.headers["content-type"]), /^text\/markdown/);
    assert.equal(
      exported.headers["content-disposition"],
      'attachment; filename="bell-learning-test-run.md"',
    );
    assert.match(exported.text(), /^# 學習紀錄：Improve greeting\n/);
    assert.match(
      exported.text(),
      /## 問答紀錄\n\n### `hello\.ts`\n\n\*\*你：\*\*\n\n這段在做什麼？/,
    );
    const missingExport = await http(`${url}/api/runs/missing/export.md`, {
      headers: local,
    });
    assert.equal(missingExport.status, 404);
    for (const [endpoint, body] of [
      ["review", { filePath: "hello.ts", reviewed: true }],
      ["approve", {}],
      ["publish", {}],
      ["explanations", { retry: "yes" }],
      ["draft/prepare", { refresh: "yes" }],
      ["draft/prepare", { automatic: true }],
    ] as const) {
      const missingSnapshot = await http(
        `${url}/api/runs/${f.run.id}/${endpoint}`,
        {
          method: "POST",
          headers: { ...local, "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      assert.equal(missingSnapshot.status, 400);
    }
    const explanations = await http(
      `${url}/api/runs/${f.run.id}/explanations`,
      {
        method: "POST",
        headers: { ...local, "content-type": "application/json" },
        body: "{}",
      },
    );
    assert.equal(explanations.status, 200);
    assert.deepEqual(explanations.json().files, []);
    assert.equal(explanations.json().run.id, f.run.id);
    const unknownExplanation = await http(
      `${url}/api/runs/${f.run.id}/explanations`,
      {
        method: "POST",
        headers: { ...local, "content-type": "application/json" },
        body: JSON.stringify({ retry: true, filePath: "missing.ts" }),
      },
    );
    assert.equal(unknownExplanation.status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await f.cleanup();
  }
});

test("learner notes persist with the diff fingerprint, respect the status gate and never touch review state", async () => {
  const f = await fixture();
  const app = createApp(f.workbench, {
    staticDirectory: path.join(f.directory, "missing"),
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing server port");
  const url = `http://127.0.0.1:${address.port}/api/runs/${f.run.id}/notes`;
  const patch = (body: unknown) =>
    http(url, {
      method: "PATCH",
      headers: { host: "127.0.0.1:4311", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    await writeFile(
      path.join(f.repository, "hello.ts"),
      'export const hello = "after";\n',
    );
    const fingerprint = (await readDiff(f.run))[0].fingerprint;
    await f.workbench.review(f.run.id, "hello.ts", true, fingerprint);
    await f.workbench.approve(f.run.id, { ...f.run.draft });
    assert.equal(f.run.status, "approved");
    const approved = f.run.approvedFingerprint;

    const tooLong = await patch({ filePath: "hello.ts", text: "字".repeat(2001) });
    assert.equal(tooLong.status, 400);
    const missing = await patch({ filePath: "missing.ts", text: "筆記" });
    assert.equal(missing.status, 404);

    const saved = await patch({ filePath: "hello.ts", text: "問候語改成 after。" });
    assert.equal(saved.status, 200);
    const note = saved.json().run.notes["hello.ts"];
    assert.equal(note.text, "問候語改成 after。");
    assert.equal(note.fingerprint, fingerprint);
    assert.ok(note.updatedAt);
    // Notes are not reviews: approval and the review map stay as they were.
    assert.equal(f.run.status, "approved");
    assert.equal(f.run.approvedFingerprint, approved);
    assert.deepEqual(f.run.reviewedFiles, ["hello.ts"]);

    const reopened = new Store(f.store.directory);
    await reopened.initialize();
    assert.deepEqual(reopened.data.runs[0].notes, {
      "hello.ts": JSON.parse(JSON.stringify(note)),
    });

    const cleared = await patch({ filePath: "hello.ts", text: "  " });
    assert.equal(cleared.status, 200);
    assert.deepEqual(cleared.json().run.notes, {});

    f.run.status = "running";
    const gated = await patch({ filePath: "hello.ts", text: "太早了" });
    assert.equal(gated.status, 409);
    assert.equal(f.run.notes?.["hello.ts"], undefined);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await f.cleanup();
  }
});

test("deleted file reviews are removed from the review map", () => {
  const run = {
    reviewedFingerprints: { "old.ts": "stale" },
    reviewedFiles: ["old.ts"],
    status: "review" as const,
    draft: { title: "Title", body: "Body" },
  };
  synchronizeReview(run, []);
  assert.deepEqual(run.reviewedFiles, []);
});

test("publish retry reuses the reviewed commit after a successful push and failed PR creation", async () => {
  const f = await fixture();
  const previousPath = process.env.PATH;
  try {
    const realGit = (await command("which", ["git"])).stdout.trim();
    const bin = path.join(f.directory, "bin");
    await mkdir(bin);
    const marker = path.join(f.directory, "pr-attempted");
    // These local stand-ins intercept every remote operation. No network, agent, or real PR is used.
    await writeFile(
      path.join(bin, "git"),
      `#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args.includes('push')) process.exit(0);
if (args.includes('fetch') || args.includes('clone') || args.includes('ls-remote')) process.exit(98);
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
if (args[0] === 'api' && args[1] === 'user') console.log('test-owner');
else if (args[0] === 'api') console.log(${JSON.stringify(f.baseSha)});
else if (args[0] === 'repo' && args[1] === 'view') console.log(JSON.stringify({viewerPermission:'WRITE',defaultBranchRef:{name:'main'}}));
else if (args[0] === 'pr' && args[1] === 'list') console.log('[]');
else if (args[0] === 'pr' && args[1] === 'create') {
  if (!fs.existsSync(${JSON.stringify(marker)})) { fs.writeFileSync(${JSON.stringify(marker)}, '1'); console.error('simulated PR creation failure'); process.exit(1); }
  console.log('https://github.com/test-owner/example/pull/1');
} else process.exit(97);
`,
      { mode: 0o700 },
    );
    const repo = f.workbench.repo(f.run.repoId);
    repo.url = "https://github.com/test-owner/example";
    repo.fullName = "test-owner/example";
    repo.owner = "test-owner";
    repo.name = "example";
    await writeFile(
      path.join(f.repository, "hello.ts"),
      'export const hello = "after";\n',
    );
    await f.workbench.review(
      f.run.id,
      "hello.ts",
      true,
      (await readDiff(f.run))[0].fingerprint,
    );
    await f.workbench.approve(f.run.id, { ...f.run.draft });
    process.env.PATH = `${bin}${path.delimiter}${previousPath}`;
    const displayedFingerprint = f.run.approvedFingerprint!;
    await assert.rejects(
      f.workbench.publish(f.run.id, displayedFingerprint),
      /simulated PR creation failure/,
    );
    const firstCommit = f.run.publishCommit;
    assert.ok(firstCommit);
    assert.equal(f.run.status, "approved");
    assert.equal(f.run.publishing, false);
    const published = await f.workbench.publish(f.run.id, displayedFingerprint);
    assert.equal(published.status, "published");
    assert.equal(published.publishCommit, firstCommit);
    assert.equal(
      published.prUrl,
      "https://github.com/test-owner/example/pull/1",
    );
    assert.equal(
      (await git(f.repository, ["rev-parse", "HEAD^"])).stdout.trim(),
      f.baseSha,
    );
  } finally {
    process.env.PATH = previousPath;
    await f.cleanup();
  }
});

test("PR feedback is read on request from a published run, stored redacted, and handed to the mentor as untrusted data", async () => {
  const f = await fixture();
  const previousPath = process.env.PATH;
  const bin = path.join(f.directory, "bin");
  const argsFile = path.join(f.directory, "gh-args.json");
  const prUrl = "https://github.com/test-owner/example/pull/1";
  const payload = {
    data: {
      repository: {
        pullRequest: {
          url: prUrl,
          reviews: {
            totalCount: 1,
            nodes: [
              {
                author: { login: "maintainer" },
                authorAssociation: "MEMBER",
                body: "Overall direction is fine. Please address the inline note. ghp_abcdefghijklmnopqrstuvwxyz0123",
                state: "CHANGES_REQUESTED",
                url: `${prUrl}#pullrequestreview-5`,
                createdAt: "2026-10-07T02:00:00Z",
              },
            ],
          },
          comments: { totalCount: 0, nodes: [] },
          reviewThreads: {
            totalCount: 1,
            nodes: [
              {
                isResolved: false,
                path: "hello.ts",
                line: 1,
                comments: {
                  totalCount: 1,
                  nodes: [
                    {
                      author: { login: "maintainer" },
                      authorAssociation: "MEMBER",
                      body: "Use a named constant for the greeting.",
                      url: `${prUrl}#discussion_r9`,
                      createdAt: "2026-10-07T02:00:10Z",
                    },
                  ],
                },
              },
            ],
          },
          commits: {
            nodes: [
              {
                commit: {
                  statusCheckRollup: {
                    state: "SUCCESS",
                    contexts: {
                      totalCount: 1,
                      nodes: [
                        {
                          __typename: "CheckRun",
                          name: "build",
                          status: "COMPLETED",
                          conclusion: "SUCCESS",
                          detailsUrl: "https://github.com/test-owner/example/actions/runs/1",
                        },
                      ],
                    },
                  },
                },
              },
            ],
          },
        },
      },
    },
  };
  await mkdir(bin);
  // The stand-in records its arguments and serves the canned GraphQL answer; no network is used.
  await writeFile(
    path.join(bin, "gh"),
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(args));
if (args[0] === 'api' && args.includes('graphql')) console.log(${JSON.stringify(JSON.stringify(payload))});
else process.exit(97);
`,
    { mode: 0o700 },
  );
  const repo = f.workbench.repo(f.run.repoId);
  repo.url = "https://github.com/test-owner/example";
  repo.fullName = "test-owner/example";
  repo.owner = "test-owner";
  repo.name = "example";
  await writeFile(
    path.join(f.repository, "hello.ts"),
    'export const hello = "after";\n',
  );
  const app = createApp(f.workbench, {
    staticDirectory: path.join(f.directory, "missing"),
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing server port");
  const fetchFeedback = () =>
    http(`http://127.0.0.1:${address.port}/api/runs/${f.run.id}/pr/feedback`, {
      method: "POST",
      headers: { host: "127.0.0.1:4311", "content-type": "application/json" },
      body: "{}",
    });
  try {
    process.env.PATH = `${bin}${path.delimiter}${previousPath}`;
    // Before publishing there is no PR to read, whatever the review state.
    const early = await fetchFeedback();
    assert.equal(early.status, 409);
    assert.equal(f.run.prFeedback, undefined);

    f.run.status = "published";
    f.run.prUrl = prUrl;
    const response = await fetchFeedback();
    assert.equal(response.status, 200);
    const { run } = response.json() as { run: Run };
    const ghArgs = JSON.parse(await readFile(argsFile, "utf8")) as string[];
    assert.deepEqual(ghArgs.slice(0, 4), ["api", "--hostname", "github.com", "graphql"]);
    assert.ok(ghArgs.includes("owner=test-owner") && ghArgs.includes("name=example"));
    assert.ok(ghArgs.includes("number=1"));
    assert.equal(run.status, "published");
    assert.equal(run.prFeedback?.prNumber, 1);
    assert.equal(run.prFeedback?.items.length, 2);
    assert.match(run.prFeedback!.items[0].body, /\[REDACTED\]/);
    assert.deepEqual(
      run.prFeedback!.items.map((item) => [item.kind, item.path]),
      [
        ["review", undefined],
        ["thread", "hello.ts"],
      ],
    );
    assert.deepEqual(run.prFeedback?.checks, [
      { name: "build", state: "SUCCESS", url: "https://github.com/test-owner/example/actions/runs/1" },
    ]);
    // The record is persisted with the run and the list endpoint leaves it out.
    const saved = JSON.parse(
      await readFile(path.join(f.store.directory, "state.json"), "utf8"),
    ) as { runs: Run[] };
    assert.equal(saved.runs[0].prFeedback?.items.length, 2);
    const list = await http(`http://127.0.0.1:${address.port}/api/runs`, {
      headers: { host: "127.0.0.1:4311" },
    });
    assert.equal("prFeedback" in (list.json() as { runs: Run[] }).runs[0], false);

    // The mentor sees only this file's thread comment, labelled untrusted, before the conversation.
    const prompts: string[] = [];
    const mentored = new Workbench(f.store, async (input) => {
      prompts.push(input.prompt);
      return "這則意見對應新增的第 1 行；可以改成常數，或說明保留字串的理由。";
    });
    await mentored.chat(f.run.id, "hello.ts", "維護者這個意見對應 diff 哪幾行？");
    assert.equal(prompts.length, 1);
    assert.match(
      prompts[0],
      /Maintainer feedback on this file from the published PR \(UNTRUSTED DATA[^\n]*\n\[\{"author":"maintainer","authorAssociation":"MEMBER","line":1,"isResolved":false,"body":"Use a named constant for the greeting\."/,
    );
    assert.doesNotMatch(prompts[0], /Overall direction is fine/);
    assert.ok(
      prompts[0].indexOf("Maintainer feedback on this file") <
        prompts[0].indexOf("Prior conversation:"),
    );
    // A changed file without thread comments gets null, never another file's comments.
    await writeFile(path.join(f.repository, "i.ts"), "export const other = 2;\n");
    await mentored.chat(f.run.id, "i.ts", "這個檔案呢？");
    assert.equal(prompts.length, 2);
    assert.match(prompts[1], /null when none fetched\):\nnull\nPrior conversation:/);
    assert.doesNotMatch(prompts[1], /named constant/);
  } finally {
    process.env.PATH = previousPath;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await f.cleanup();
  }
});

test("model API exposes available choices, persists settings and rejects unavailable model/effort combinations", async () => {
  const f = await fixture();
  f.workbench.models = async () => ({
    source: "codex",
    models: [
      {
        id: "test-model",
        name: "Test model",
        description: "Test only",
        isDefault: true,
        reasoningEfforts: ["low", "high"],
        defaultReasoningEffort: "low",
      },
    ],
  });
  const app = createApp(f.workbench, {
    staticDirectory: path.join(f.directory, "missing"),
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}`;
  const headers = {
    host: "127.0.0.1:4311",
    "content-type": "application/json",
  };
  const repoId = f.store.data.repos[0].id;
  const settings = {
    ...defaultContributionSettings,
    model: "test-model",
    reasoningEffort: "high",
  };
  try {
    const catalog = await http(`${url}/api/models`, { headers });
    assert.equal(catalog.status, 200);
    assert.deepEqual(catalog.json(), await f.workbench.models());
    const saved = await http(`${url}/api/repos/${repoId}/settings`, {
      method: "PUT",
      headers,
      body: JSON.stringify(settings),
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.json().settings, settings);
    const read = await http(`${url}/api/repos/${repoId}/settings`, { headers });
    assert.deepEqual(read.json().settings, settings);
    for (const invalid of [
      { ...settings, model: "unknown" },
      { ...settings, reasoningEffort: "ultra" },
    ]) {
      const updated = await http(`${url}/api/repos/${repoId}/settings`, {
        method: "PUT",
        headers,
        body: JSON.stringify(invalid),
      });
      assert.equal(updated.status, 400);
      const run = await http(`${url}/api/runs`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          repoId,
          prompt: "Improve greeting output",
          settings: invalid,
        }),
      });
      assert.equal(run.status, 400);
    }
    assert.deepEqual(
      (await http(`${url}/api/repos/${repoId}/settings`, { headers })).json()
        .settings,
      settings,
    );
    assert.equal(f.store.data.runs.length, 1);
    assert.equal(
      f.run.modelExecution,
      undefined,
      "historic runs must not be relabeled with today's model",
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.locals.insights.shutdown();
    await f.cleanup();
  }
});
