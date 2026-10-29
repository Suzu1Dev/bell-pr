import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  mkdir,
  symlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { request } from "node:http";
import { command, git, redact } from "./process.js";
import {
  parseGitHubIssueUrl,
  parseGitHubSource,
  readDiff,
  reviewFingerprint,
  synchronizeReview,
  sensitivePath,
} from "./git.js";
import { Store } from "./store.js";
import { AgentSlots } from "./agent-slots.js";
import { Workbench } from "./workbench.js";
import { createApp } from "./index.js";
import { AppError, type Run } from "./types.js";
import { defaultContributionSettings } from "../shared/insights.js";
import { draftFingerprint } from "./drafts.js";
import { withLocale } from "./i18n/index.js";
import { after, before } from "node:test";
import { skipUnderstandingCheckInTests } from "./understanding.js";

// This file tests other behaviour; server/understanding.test.ts covers the gate.
before(() => skipUnderstandingCheckInTests(true));
after(() => skipUnderstandingCheckInTests());

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

test("a local project imports from the path the import dialog suggests, ~/projects/repository", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-pr-home-import-"));
  const previousHome = process.env.HOME;
  try {
    // The home directory of the user BELL PR runs as.
    const home = path.join(directory, "home");
    const checkout = path.join(home, "projects", "repository");
    await mkdir(checkout, { recursive: true });
    await git(checkout, ["init", "-b", "main"]);
    await git(checkout, ["config", "user.name", "BELL Test"]);
    await git(checkout, ["config", "user.email", "test@example.invalid"]);
    await writeFile(path.join(checkout, "README.md"), "# Repository\n");
    await git(checkout, ["add", "--", "README.md"]);
    await git(checkout, ["commit", "-m", "initial"]);
    process.env.HOME = home;
    assert.equal(os.homedir(), home);
    const store = new Store(path.join(directory, "state"));
    await store.initialize();
    const repo = await new Workbench(store).importRepository("~/projects/repository");
    assert.equal(repo.fullName, "local/repository");
    assert.equal(repo.defaultBranch, "main");
    // BELL PR works in its own clone; the person's folder stays as it is.
    assert.ok(repo.path.startsWith(path.join(store.directory, "repositories") + path.sep), repo.path);
    assert.equal(
      (await git(repo.path, ["log", "-1", "--format=%s"])).stdout.trim(),
      "initial",
    );
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    await rm(directory, { recursive: true, force: true });
  }
});

test("GitHub issue URLs are parsed to owner, repository and number; anything else is rejected", () => {
  assert.deepEqual(
    parseGitHubIssueUrl("https://github.com/openai/codex/issues/1234/"),
    {
      owner: "openai",
      name: "codex",
      number: 1234,
      url: "https://github.com/openai/codex/issues/1234",
    },
  );
  for (const invalid of [
    "https://github.com/openai/codex/pull/1234",
    "https://github.com/openai/codex/issues/0",
    "https://github.com/openai/codex/issues/12#issuecomment-1",
    "https://github.com/openai/codex/issues",
    "http://github.com/openai/codex/issues/12",
    "https://api.github.com/repos/openai/codex/issues/12",
    "https://user:password@github.com/openai/codex/issues/12",
    "--config=whatever",
  ])
    assert.equal(parseGitHubIssueUrl(invalid), null, invalid);
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

test("the base version around a modified file is served only for the current, reviewable diff", async () => {
  const f = await fixture();
  const app = createApp(f.workbench, {
    staticDirectory: path.join(f.directory, "missing"),
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing server port");
  const url = `http://127.0.0.1:${address.port}/api/runs/${f.run.id}/context`;
  const local = { host: "127.0.0.1:4311" };
  try {
    await writeFile(
      path.join(f.repository, "hello.ts"),
      'export const hello = "after";\n',
    );
    await writeFile(path.join(f.repository, "new.ts"), "export const n = 1;\n");
    await writeFile(path.join(f.repository, ".env"), "PASSWORD=private-value");
    const files = await readDiff(f.run);
    const print = (file: string) =>
      files.find((entry) => entry.path === file)!.fingerprint;
    const query = (file: string, fingerprint: string, base = f.run.baseSha!) =>
      `${url}?${new URLSearchParams({ path: file, fingerprint, base })}`;

    const ok = await http(query("hello.ts", print("hello.ts")), { headers: local });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { lines: ['export const hello = "before";'] });
    // An older diff, a whole new file, a blocked file and an unknown path are refused.
    const stale = await http(query("hello.ts", "0".repeat(64)), { headers: local });
    assert.equal(stale.status, 409);
    // A base that moved since the diff was read (a sync) is refused too.
    const moved = await http(query("hello.ts", print("hello.ts"), "a".repeat(40)), { headers: local });
    assert.equal(moved.status, 409);
    assert.equal((await http(query("new.ts", print("new.ts")), { headers: local })).status, 409);
    assert.equal((await http(query(".env", print(".env")), { headers: local })).status, 409);
    assert.equal((await http(query("missing.ts", print("hello.ts")), { headers: local })).status, 404);
    assert.equal((await http(`${url}?path=hello.ts`, { headers: local })).status, 400);
    assert.equal(
      (await http(`${url}?${new URLSearchParams({ path: "hello.ts", fingerprint: print("hello.ts") })}`, { headers: local })).status,
      400,
    );
    assert.equal(
      (await http(`${query("hello.ts", print("hello.ts"))}&extra=1`, { headers: local })).status,
      400,
    );

    // A credential in an unchanged part of the file never leaves the server.
    const secret = path.join(f.repository, "secret.ts");
    const body = Array.from({ length: 12 }, (_, index) => `const line${index} = ${index};`);
    await writeFile(
      secret,
      [`const token = "${"ghp_" + "a".repeat(36)}";`, ...body].join("\n") + "\n",
    );
    await git(f.repository, ["add", "--", "secret.ts"]);
    await git(f.repository, ["commit", "-m", "secret"]);
    f.run.baseSha = (await git(f.repository, ["rev-parse", "HEAD"])).stdout.trim();
    await writeFile(
      secret,
      [`const token = "${"ghp_" + "a".repeat(36)}";`, ...body.slice(0, -1), "const last = 0;"].join("\n") + "\n",
    );
    const changed = (await readDiff(f.run)).find((entry) => entry.path === "secret.ts")!;
    assert.equal(changed.blocked, undefined);
    await assert.rejects(
      f.workbench.contextLines(f.run.id, "secret.ts", changed.fingerprint, f.run.baseSha!),
      (error: AppError) => error.statusCode === 422 && /憑證/.test(error.message),
    );

    // A password assignment is not a blocking secret, but it is masked line by line.
    const config = path.join(f.repository, "config.ts");
    const settings = ['const password = "hunter2-correct-horse";', ...body];
    await writeFile(config, settings.join("\n") + "\n");
    await git(f.repository, ["add", "--", "config.ts"]);
    await git(f.repository, ["commit", "-m", "config"]);
    f.run.baseSha = (await git(f.repository, ["rev-parse", "HEAD"])).stdout.trim();
    await writeFile(config, [...settings.slice(0, -1), "const last = 0;"].join("\n") + "\n");
    const configured = (await readDiff(f.run)).find((entry) => entry.path === "config.ts")!;
    const { lines } = await f.workbench.contextLines(f.run.id, "config.ts", configured.fingerprint, f.run.baseSha!);
    assert.equal(lines.length, settings.length);
    assert.doesNotMatch(lines[0], /hunter2/);
    assert.match(lines[0], /\[REDACTED\]/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await f.cleanup();
  }
});

test("a held-back file's reason follows the run's locale, so reading the diff in another language changes no fingerprint", async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.repository, ".env"), "PASSWORD=private-value");
    // An untracked symbolic link has no patch: its reason is its fingerprint.
    await symlink("hello.ts", path.join(f.repository, "link.ts"));
    f.run.locale = "zh-TW";
    const chinese = await readDiff(f.run);
    const english = await withLocale("en", () => readDiff(f.run));
    assert.deepEqual(english, chinese);
    assert.equal(
      chinese.find((file) => file.path === ".env")?.blocked,
      "敏感檔案或產物不會被加入 PR；請先從本次變更移除。",
    );
    assert.equal(
      draftFingerprint(f.run, english),
      draftFingerprint(f.run, chinese),
    );
    // An English run words them in English under any request locale.
    f.run.locale = "en";
    const held = await readDiff(f.run);
    assert.deepEqual(
      held.filter((file) => file.blocked).map(({ path, blocked, patch }) => ({ path, blocked, patch })),
      [
        {
          path: ".env",
          blocked:
            "Sensitive files and build artifacts are never added to the PR; remove this file from the changes first.",
          patch:
            "Publishing this file is on hold: Sensitive files and build artifacts are never added to the PR; remove this file from the changes first.",
        },
        {
          path: "link.ts",
          blocked:
            "A new file must be a regular file; symbolic links need manual handling.",
          patch:
            "Publishing this file is on hold: A new file must be a regular file; symbolic links need manual handling.",
        },
      ],
    );
  } finally {
    await f.cleanup();
  }
});

test("a run saved without a locale keeps its zh-TW held-back reasons, so its draft fingerprint holds in any request locale", async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.repository, ".env"), "PASSWORD=private-value");
    await symlink("hello.ts", path.join(f.repository, "link.ts"));
    assert.equal(f.run.locale, undefined);
    const english = await withLocale("en", () => readDiff(f.run));
    const chinese = await withLocale("zh-TW", () => readDiff(f.run));
    assert.deepEqual(english, chinese);
    // The wording every build before runs recorded a locale fingerprinted.
    assert.equal(
      english.find((file) => file.path === "link.ts")?.blocked,
      "新檔案必須是一般檔案；符號連結需要手動處理。",
    );
    assert.equal(
      draftFingerprint(f.run, english),
      draftFingerprint(f.run, chinese),
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

test("GET /api/status reports the configured run, process and queue limits", async () => {
  const f = await fixture();
  const workbench = new Workbench(f.store, undefined, {
    agentSlots: new AgentSlots(5),
    maxActiveRuns: 3,
  });
  // Stub the CLI probes so the test never spawns codex, claude or gh.
  workbench.status = async () => ({
    codex: false,
    codexAuthenticated: false,
    claude: false,
    claudeAuthenticated: false,
    github: false,
  });
  const app = createApp(workbench, {
    staticDirectory: path.join(f.directory, "missing"),
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing server port");
  try {
    const response = await http(`http://127.0.0.1:${address.port}/api/status`, {
      headers: { host: "127.0.0.1:4311" },
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { codex: boolean; limits: unknown };
    assert.equal(body.codex, false);
    assert.deepEqual(body.limits, {
      maxActiveRuns: 3,
      maxAgentProcesses: 5,
      maxQueued: 8,
    });
    assert.deepEqual(new Workbench(f.store).limits, {
      maxActiveRuns: 2,
      maxAgentProcesses: 3,
      maxQueued: 8,
    });
    assert.equal(
      new Workbench(f.store, undefined, { maxActiveRuns: 6 }).limits.maxQueued,
      12,
    );
  } finally {
    server.close();
    await rm(f.directory, { recursive: true, force: true });
  }
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
    f.run.followUps = [
      {
        id: "r1",
        requestedAt: new Date().toISOString(),
        feedbackUrls: [],
        note: "Rename it.",
        status: "failed",
        parentCommit: f.baseSha,
      },
    ];
    const list = await http(`${url}/api/runs`, { headers: local });
    assert.equal(list.status, 200);
    const [summary] = list.json().runs as Record<string, unknown>[];
    assert.equal(summary.id, f.run.id);
    for (const field of ["logs", "reports", "draftPreparation", "conversations", "followUps"])
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

/** Han characters and CJK punctuation; the Latin middle dot is not one. */
const cjk = /(?!\u00B7)[\p{Script_Extensions=Han}\u3000-\u303F\uFF00-\uFFEF]/u;

test("HTTP errors follow X-Bell-Locale: validation, the guard, the error handler and refusals", async () => {
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
  const headers = (locale: string, extra: Record<string, string> = {}) => ({
    host: "127.0.0.1:4311",
    "content-type": "application/json",
    "x-bell-locale": locale,
    ...extra,
  });
  const errorOf = async (
    locale: string,
    pathname: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {},
  ) => {
    const response = await http(`${url}${pathname}`, {
      method: options.method ?? "POST",
      headers: headers(locale, options.headers),
      body: options.body,
    });
    return { status: response.status, error: String(response.json().error) };
  };
  try {
    // A request that fails validation answers in English, joined the English way.
    const invalidRun = JSON.stringify({ repoId: "not-a-uuid", prompt: "short" });
    const english = await errorOf("en", "/api/runs", { body: invalidRun });
    assert.equal(english.status, 400);
    assert.match(english.error, /^repoId: Invalid UUID, prompt: Too small: expected string to have >=10 characters/);
    assert.doesNotMatch(english.error, cjk);
    const chinese = await errorOf("zh-TW", "/api/runs", { body: invalidRun });
    assert.match(chinese.error, /^repoId: Invalid UUID、prompt: /);
    // The refinements the routes define are worded at request time.
    const control = JSON.stringify({
      title: "Improve greeting",
      body: "A tested greeting improvement.",
      commitMessage: "Fix x\u001b]8;;https://evil.example\u0007click",
    });
    assert.deepEqual(
      await errorOf("en", `/api/runs/${f.run.id}/draft`, { method: "PATCH", body: control }),
      { status: 400, error: "commitMessage: A commit message may only contain text and line breaks." },
    );
    assert.deepEqual(
      await errorOf("zh-TW", `/api/runs/${f.run.id}/draft`, { method: "PATCH", body: control }),
      { status: 400, error: "commitMessage: 提交訊息只能包含文字與換行。" },
    );
    const branch = JSON.stringify({
      title: "Improve greeting",
      body: "A tested greeting improvement.",
      publishBranch: "fix..bad",
    });
    assert.deepEqual(
      await errorOf("en", `/api/runs/${f.run.id}/draft`, { method: "PATCH", body: branch }),
      {
        status: 400,
        error:
          "publishBranch: A GitHub branch name may only use letters, digits and . _ - /, must not contain .., and must not end with . or .lock.",
      },
    );
    // The error handler and the guard.
    assert.deepEqual(await errorOf("en", "/api/repos", { body: "{" }), {
      status: 400,
      error: "The request body is not valid JSON.",
    });
    assert.deepEqual(
      await errorOf("en", "/api/repos", {
        body: JSON.stringify({ source: "x".repeat(200_000) }),
      }),
      { status: 413, error: "The request body is too large." },
    );
    assert.deepEqual(
      await errorOf("en", "/api/repos", {
        body: "text",
        headers: { "content-type": "text/plain" },
      }),
      { status: 415, error: "Requests that change data must use application/json." },
    );
    assert.deepEqual(
      await errorOf("en", "/api/repos", { headers: { host: "invalid.example:4311" } }),
      { status: 403, error: "This service address is not allowed." },
    );
    assert.deepEqual(
      await errorOf("en", "/api/repos", { headers: { origin: "https://invalid.example" } }),
      { status: 403, error: "Cross-origin requests are not allowed." },
    );
    assert.deepEqual(
      await errorOf("en", "/api/models?provider=unknown", { method: "GET" }),
      { status: 400, error: "This agent type is not supported." },
    );
    // Refusals from the Workbench and its modules.
    assert.deepEqual(await errorOf("en", "/api/runs/missing", { method: "GET" }), {
      status: 404,
      error: "Run not found.",
    });
    assert.deepEqual(await errorOf("en", `/api/runs/${f.run.id}/cancel`, { body: "{}" }), {
      status: 409,
      error: "Only runs that are queued, running or waiting for plan approval can be cancelled.",
    });
    assert.deepEqual(await errorOf("zh-TW", `/api/runs/${f.run.id}/cancel`, { body: "{}" }), {
      status: 409,
      error: "只有排隊、等待計畫核准或執行中的工作可取消。",
    });
    assert.deepEqual(await errorOf("en", `/api/runs/${f.run.id}/approve`, {
      body: JSON.stringify({ draft: f.run.draft }),
    }), {
      status: 409,
      error: "Review every latest change and remove the blocked files first.",
    });
    assert.deepEqual(await errorOf("en", `/api/runs/${f.run.id}/publish`, {
      body: JSON.stringify({ fingerprint: "a".repeat(64) }),
    }), {
      status: 409,
      error: "The approved version changed or expired; reload, review and approve again before you send the PR.",
    });
    assert.deepEqual(await errorOf("en", "/api/repos", {
      body: JSON.stringify({ source: "./relative/path" }),
    }), {
      status: 400,
      error: "Enter a GitHub HTTPS URL or the absolute path of a local repository.",
    });
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

test("commit message edits invalidate approval like title edits, are validated over HTTP and keep old fingerprints valid", async () => {
  const f = await fixture();
  const app = createApp(f.workbench, {
    staticDirectory: path.join(f.directory, "missing"),
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing server port");
  const url = `http://127.0.0.1:${address.port}/api/runs/${f.run.id}`;
  const headers = {
    host: "127.0.0.1:4311",
    "content-type": "application/json",
  };
  try {
    await writeFile(
      path.join(f.repository, "hello.ts"),
      'export const hello = "after";\n',
    );
    const files = await readDiff(f.run);
    // Runs approved before the field existed must still match their fingerprint.
    const legacy = reviewFingerprint(files, { ...f.run.draft });
    assert.equal(
      reviewFingerprint(files, { ...f.run.draft, commitMessage: "" }),
      legacy,
    );
    assert.equal(
      reviewFingerprint(files, { ...f.run.draft, commitMessage: "  \n" }),
      legacy,
    );
    assert.notEqual(
      reviewFingerprint(files, { ...f.run.draft, commitMessage: "fix: x" }),
      legacy,
    );
    await f.workbench.review(f.run.id, "hello.ts", true, files[0].fingerprint);
    await f.workbench.approve(f.run.id, { ...f.run.draft });
    const approved = f.run.approvedFingerprint!;
    assert.equal(approved, legacy);
    for (const commitMessage of ["fix: x\tbad", "fix: x\r\nbody", "a".repeat(4001)]) {
      const rejected = await http(`${url}/draft`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ ...f.run.draft, commitMessage }),
      });
      assert.equal(rejected.status, 400, commitMessage.slice(0, 12));
    }
    assert.equal(f.run.status, "approved");
    const edited = await http(`${url}/draft`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        ...f.run.draft,
        commitMessage: "fix(hello): update the greeting\n\nBecause.\n",
      }),
    });
    assert.equal(edited.status, 200);
    assert.equal(
      edited.json().run.draft.commitMessage,
      "fix(hello): update the greeting\n\nBecause.",
    );
    assert.equal(f.run.status, "review");
    assert.equal(f.run.approvedFingerprint, undefined);
    const stale = await http(`${url}/publish`, {
      method: "POST",
      headers,
      body: JSON.stringify({ fingerprint: approved }),
    });
    assert.equal(stale.status, 409);
    // Approval must see the message the person is looking at.
    await assert.rejects(
      f.workbench.approve(f.run.id, {
        title: f.run.draft.title,
        body: f.run.draft.body,
      }),
      /草稿已更新/,
    );
    await f.workbench.approve(f.run.id, { ...f.run.draft });
    assert.notEqual(f.run.approvedFingerprint, approved);
    // Clearing the message returns to the title-only fingerprint.
    await f.workbench.draft(f.run.id, { ...f.run.draft, commitMessage: "" });
    assert.equal(f.run.draft.commitMessage, undefined);
    await f.workbench.approve(f.run.id, { ...f.run.draft });
    assert.equal(f.run.approvedFingerprint, legacy);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await f.cleanup();
  }
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
    // The person's own message, including their sign-off, becomes the commit message.
    const commitMessage =
      "fix(greeting): update the exported greeting\n\nThe old text was out of date.\n\nSigned-off-by: BELL Test <test@example.invalid>";
    await f.workbench.draft(f.run.id, {
      ...f.run.draft,
      commitMessage: `${commitMessage}\n`,
    });
    assert.equal(f.run.draft.commitMessage, commitMessage);
    await f.workbench.approve(f.run.id, { ...f.run.draft });
    process.env.PATH = `${bin}${path.delimiter}${previousPath}`;
    const displayedFingerprint = f.run.approvedFingerprint!;
    await assert.rejects(
      f.workbench.publish(f.run.id, displayedFingerprint, ["facts-unknown"]),
      /simulated PR creation failure/,
    );
    const firstCommit = f.run.publishCommit;
    assert.ok(firstCommit);
    assert.equal(f.run.status, "approved");
    assert.equal(f.run.publishing, false);
    // The push went through, so a retry must reuse that branch or it would open a second PR.
    assert.equal(f.run.publishedBranch, f.run.branch);
    await assert.rejects(
      f.workbench.draft(f.run.id, { ...f.run.draft, publishBranch: "other-branch" }),
      (error: AppError) => error.statusCode === 409 && /不能改分支/.test(error.message),
    );
    // The pushed commit cannot take a different message; the person must restore it or start over.
    await f.workbench.draft(f.run.id, {
      ...f.run.draft,
      commitMessage: `${commitMessage}\n\nAmended after the push.`,
    });
    await f.workbench.approve(f.run.id, { ...f.run.draft });
    await assert.rejects(
      f.workbench.publish(f.run.id, f.run.approvedFingerprint!, ["facts-unknown"]),
      /提交訊息/,
    );
    assert.equal(f.run.publishCommit, firstCommit);
    await f.workbench.draft(f.run.id, { ...f.run.draft, commitMessage });
    await f.workbench.approve(f.run.id, { ...f.run.draft });
    const published = await f.workbench.publish(
      f.run.id,
      f.run.approvedFingerprint!,
      ["facts-unknown"],
    );
    assert.equal(published.status, "published");
    assert.equal(published.publishCommit, firstCommit);
    assert.equal(
      (
        await git(f.repository, ["log", "-1", "--format=%B", firstCommit])
      ).stdout.trim(),
      commitMessage,
    );
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

test("publish validates the real gh fork parent shape and reuses the commit after a rejected fork", async () => {
  const f = await fixture();
  const previousPath = process.env.PATH;
  try {
    const realGit = (await command("which", ["git"])).stdout.trim();
    const bin = path.join(f.directory, "bin");
    const callsFile = path.join(f.directory, "fork-calls.jsonl");
    const forkFile = path.join(f.directory, "fork.json");
    await mkdir(bin);
    await writeFile(callsFile, "");
    // Every remote operation is intercepted; these tests never publish to GitHub.
    await writeFile(
      path.join(bin, "git"),
      `#!/usr/bin/env node
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify(['git', ...args]) + '\\n');
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
fs.appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify(['gh', ...args]) + '\\n');
if (args[0] === 'api' && args[1] === 'user') console.log('test-owner');
else if (args[0] === 'api' && args[1] === 'repos/test-upstream/example/git/ref/heads/main') console.log(${JSON.stringify(f.baseSha)});
else if (args[0] === 'repo' && args[1] === 'fork') process.exit(0);
else if (args[0] === 'repo' && args[1] === 'view' && args[2] === 'test-owner/example') process.stdout.write(fs.readFileSync(${JSON.stringify(forkFile)}, 'utf8'));
else if (args[0] === 'repo' && args[1] === 'view' && args[2] === 'test-upstream/example') console.log(JSON.stringify({viewerPermission:'READ',defaultBranchRef:{name:'main'}}));
else if (args[0] === 'pr' && args[1] === 'list') console.log('[]');
else if (args[0] === 'pr' && args[1] === 'create') console.log('https://github.com/test-upstream/example/pull/1');
else process.exit(97);
`,
      { mode: 0o700 },
    );
    Object.assign(f.workbench.repo(f.run.repoId), {
      url: "https://github.com/test-upstream/example",
      fullName: "test-upstream/example",
      owner: "test-upstream",
      name: "example",
    });
    await git(f.repository, ["checkout", "-b", "fix/fork-parent"]);
    f.run.branch = "fix/fork-parent";
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
    const commitMessage =
      "fix: update the greeting\n\nKeep the reviewed message exactly.";
    await f.workbench.draft(f.run.id, { ...f.run.draft, commitMessage });
    await f.workbench.approve(f.run.id, { ...f.run.draft });
    process.env.PATH = `${bin}${path.delimiter}${previousPath}`;
    const calls = async () =>
      (await readFile(callsFile, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[]);
    let firstCommit: string | undefined;
    for (const fork of [
      null,
      {},
      { parent: null },
      { parent: {} },
      { parent: { name: "example" } },
      { parent: { name: "example", owner: {} } },
      { parent: { name: "example", owner: null } },
      { parent: { name: "example", owner: { login: 123 } } },
      { parent: { name: 123, owner: { login: "test-upstream" } } },
      { parent: { name: "other-project", owner: { login: "test-upstream" } } },
      { parent: { name: "example", owner: { login: "unrelated-owner" } } },
    ]) {
      await writeFile(forkFile, JSON.stringify(fork));
      await assert.rejects(
        f.workbench.publish(f.run.id, f.run.approvedFingerprint!, [
          "facts-unknown",
        ]),
        (error: unknown) =>
          error instanceof AppError && error.statusCode === 409,
      );
      firstCommit ??= f.run.publishCommit;
      assert.ok(firstCommit);
      assert.equal(f.run.publishCommit, firstCommit);
      assert.equal(f.run.status, "approved");
      assert.equal(f.run.publishing, false);
      assert.equal(f.run.headRepository, undefined);
      assert.equal(f.run.publishedBranch, undefined);
      assert.equal(f.run.prUrl, undefined);
      assert.ok(
        !(await calls()).some(
          (args) => args.includes("push") || args.includes("create"),
        ),
      );
    }
    // gh repo view --json parent returns owner.login + name, not parent.nameWithOwner.
    await writeFile(
      forkFile,
      JSON.stringify({
        nameWithOwner: "test-owner/example",
        isFork: true,
        parent: {
          id: "parent-id",
          name: "EXAMPLE",
          owner: { id: "owner-id", login: "Test-Upstream" },
        },
      }),
    );
    const published = await f.workbench.publish(
      f.run.id,
      f.run.approvedFingerprint!,
      ["facts-unknown"],
    );
    assert.equal(published.status, "published");
    assert.equal(published.publishCommit, firstCommit);
    assert.equal(published.headRepository, "test-owner/example");
    assert.equal(published.publishedBranch, "fix/fork-parent");
    assert.equal(
      published.prUrl,
      "https://github.com/test-upstream/example/pull/1",
    );
    assert.equal(
      (
        await git(f.repository, ["log", "-1", "--format=%B", firstCommit!])
      ).stdout.trim(),
      commitMessage,
    );
    assert.equal(
      (await git(f.repository, ["rev-parse", "HEAD^"])).stdout.trim(),
      f.baseSha,
    );
    const operations = await calls();
    assert.equal(
      operations.filter((args) => args.includes("commit-tree")).length,
      1,
    );
    const pushes = operations.filter((args) => args.includes("push"));
    assert.equal(pushes.length, 1);
    assert.ok(pushes[0].includes("https://github.com/test-owner/example.git"));
    assert.ok(pushes[0].includes(`${firstCommit}:refs/heads/fix/fork-parent`));
    const create = operations.find(
      (args) => args[0] === "gh" && args.includes("create"),
    )!;
    assert.equal(
      create[create.indexOf("--head") + 1],
      "test-owner:fix/fork-parent",
    );
  } finally {
    process.env.PATH = previousPath;
    await f.workbench.shutdown();
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

test("the review rerun route exists and is gated on the run status", async () => {
  const f = await fixture();
  const app = createApp(f.workbench, {
    staticDirectory: path.join(f.directory, "missing"),
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing server port");
  try {
    // A running team already owns the reviewers; no agent CLI is started here.
    f.run.status = "running";
    const response = await http(
      `http://127.0.0.1:${address.port}/api/runs/${f.run.id}/review/rerun`,
      {
        method: "POST",
        headers: { host: "127.0.0.1:4311", "content-type": "application/json" },
        body: "{}",
      },
    );
    assert.equal(response.status, 409);
    assert.match(response.json().error, /只有審閱中或已核准/);
    assert.equal(f.run.reports, undefined);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await f.cleanup();
  }
});

test("a Claude Code turn that lost the OAuth refresh lock and exited non-zero is retried with the slot released, counted as a failed call and cancellable while waiting", async () => {
  const f = await fixture();
  try {
    await writeFile(
      path.join(f.repository, "hello.ts"),
      'export const hello = "after";\n',
    );
    f.run.modelExecution = { source: "cli-default", provider: "claude" };
    // The mentor has no agent card in real runs; one is added here to observe the status line.
    f.run.agents.push({
      id: "guide",
      name: "Guide",
      role: "mentor",
      status: "waiting",
      detail: "",
    });
    const refreshRace =
      "Failed to refresh OAuth token: another Claude Code process is refreshing it or exited mid-refresh. This is usually transient; retry in a minute, and if it persists close other Claude Code processes or sign in again";
    const notice =
      "Claude Code 正在更新登入憑證（其他行程持有更新鎖），15 秒後重試（第 2/3 次）。";
    type Options = NonNullable<Parameters<typeof command>[2]>;
    const emit = (options: Options, event: unknown) =>
      options.onLine?.(JSON.stringify(event), "stdout");
    const emitRace = (options: Options) => {
      emit(options, {
        type: "assistant",
        message: { content: [{ type: "text", text: refreshRace }] },
        error: "server_error",
        is_api_error_message: true,
      });
      emit(options, {
        type: "result",
        subtype: "success",
        is_error: true,
        terminal_reason: "api_error",
        duration_api_ms: 0,
        num_turns: 1,
        result: refreshRace,
        usage: {
          input_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens: 0,
        },
        modelUsage: {},
      });
    };
    // command() flushes the events above through onLine, then rejects on claude's exit code 1.
    const exitFailure = (tail: string) =>
      new AppError(`claude 執行失敗：${tail}`, 422);
    const slots = new AgentSlots(1);
    const waits: number[] = [];
    const prompts: string[] = [];
    const workbench = new Workbench(f.store, undefined, {
      agentSlots: slots,
      sleep: async (ms) => {
        waits.push(ms);
        // Waiting holds no slot, so other agents keep running; the card shows the wait.
        assert.equal(slots.active, 0);
        assert.equal(f.run.agents[0].detail, notice);
      },
      command: async (executable, args, options = {}) => {
        assert.equal(executable, "claude");
        assert.equal(args[0], "-p");
        assert.equal(slots.active, 1);
        prompts.push(options.input!);
        if (prompts.length === 1) {
          emitRace(options);
          throw exitFailure(refreshRace);
        } else
          emit(options, {
            type: "result",
            subtype: "success",
            is_error: false,
            result: "這一行改了匯出的字串。",
            usage: {
              input_tokens: 10,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 5,
              output_tokens: 4,
            },
          });
        return { stdout: "", stderr: "", code: 0 };
      },
    });
    const answer = await workbench.chat(f.run.id, "hello.ts", "這個檔案改了什麼？");
    assert.equal(answer, "這一行改了匯出的字串。");
    // The same call is repeated: identical prompt, one wait of the first backoff step.
    assert.equal(prompts.length, 2);
    assert.equal(prompts[0], prompts[1]);
    assert.deepEqual(waits, [15_000]);
    assert.ok(
      f.run.logs.some(
        (entry) =>
          entry.agent === "guide" &&
          entry.kind === "notice" &&
          entry.message === notice,
      ),
    );
    assert.equal(f.run.efficiency?.calls, 2);
    assert.equal(f.run.efficiency?.failedCalls, 1);
    assert.equal(f.run.efficiency?.completedCalls, 1);
    assert.equal(f.run.efficiency?.inputTokens, 15);
    assert.equal(f.run.efficiency?.byRole?.guide.calls, 2);
    assert.equal(
      f.run.conversations?.["hello.ts"]?.messages.at(-1)?.content,
      answer,
    );
    assert.equal(f.run.agents[0].detail, "已完成，報告可供審閱");

    // Any other API error still fails the turn at once, with the error claude
    // reported rather than the raw JSON tail command() keeps.
    let invocations = 0;
    waits.length = 0;
    const plain = new Workbench(f.store, undefined, {
      sleep: async (ms) => {
        waits.push(ms);
      },
      command: async (_executable, _args, options = {}) => {
        invocations++;
        emit(options, {
          type: "result",
          subtype: "success",
          is_error: true,
          terminal_reason: "api_error",
          result: "API Error: 500 Internal server error",
        });
        throw exitFailure(`{"type":"result","is_error":true,"result":"API Error: 500 Internal server error","session_id":"s"}`);
      },
    });
    await assert.rejects(
      plain.chat(f.run.id, "hello.ts", "再問一次"),
      (error: unknown) =>
        error instanceof AppError &&
        error.statusCode === 422 &&
        error.message === "claude 執行失敗：API Error: 500 Internal server error",
    );
    assert.equal(invocations, 1);
    assert.equal(waits.length, 0);
    assert.equal(f.run.efficiency?.failedCalls, 2);

    // Stopping during the second wait cancels the turn with 409 and starts no third invocation.
    invocations = 0;
    const racing = new Workbench(f.store, undefined, {
      sleep: async (ms) => {
        waits.push(ms);
        if (waits.length === 2) await racing.shutdown();
      },
      command: async (_executable, _args, options = {}) => {
        invocations++;
        emitRace(options);
        throw exitFailure(refreshRace);
      },
    });
    await assert.rejects(
      racing.chat(f.run.id, "hello.ts", "第三次"),
      (error: unknown) =>
        error instanceof AppError &&
        error.statusCode === 409 &&
        error.message === "工作已取消。",
    );
    assert.equal(invocations, 2);
    assert.deepEqual(waits, [15_000, 45_000]);
    assert.equal(f.run.efficiency?.calls, 5);
    assert.equal(f.run.efficiency?.failedCalls, 4);
    assert.equal(f.run.efficiency?.completedCalls, 1);
  } finally {
    await f.cleanup();
  }
});

test("agent turns use the Codex read budget by default and a longer, announced one for Claude Code at xhigh", async () => {
  const f = await fixture();
  try {
    await writeFile(
      path.join(f.repository, "hello.ts"),
      'export const hello = "after";\n',
    );
    const timeouts: number[] = [];
    let timeOut = false;
    const workbench = new Workbench(f.store, undefined, {
      command: async (executable, _args, options = {}) => {
        timeouts.push(options.timeoutMs!);
        if (timeOut) throw new AppError(`${executable} 執行逾時。`, 504);
        options.onLine?.(
          JSON.stringify(
            executable === "claude"
              ? {
                  type: "result",
                  subtype: "success",
                  is_error: false,
                  result: "改了匯出的字串。",
                }
              : {
                  type: "item.completed",
                  item: { type: "agent_message", text: "改了匯出的字串。" },
                },
          ),
          "stdout",
        );
        return { stdout: "", stderr: "", code: 0 };
      },
    });
    await workbench.chat(f.run.id, "hello.ts", "這個檔案改了什麼？");
    assert.deepEqual(timeouts, [600_000]);
    const started = () =>
      f.run.logs.filter(
        (entry) => entry.agent === "guide" && entry.message.includes("開始工作"),
      );
    assert.doesNotMatch(started().at(-1)!.message, /最多等待/);

    f.run.modelExecution = {
      source: "selected",
      provider: "claude",
      model: "opus",
      reasoningEffort: "xhigh",
    };
    await workbench.chat(f.run.id, "hello.ts", "再問一次");
    // 600 s × 2.5 (Claude) × 1.5 (xhigh) = 2250 s.
    assert.deepEqual(timeouts, [600_000, 2_250_000]);
    assert.match(started().at(-1)!.message, /；最多等待 37\.5 分鐘。/);

    timeOut = true;
    await assert.rejects(
      workbench.chat(f.run.id, "hello.ts", "第三次"),
      (error: unknown) =>
        error instanceof AppError &&
        error.statusCode === 504 &&
        error.message ===
          "claude 執行逾時（已等待 37.5 分鐘）。較高的思考強度或大型專案需要更久；可降低思考強度、改用較快的模型，或提高 BELLPR_AGENT_TIMEOUT_SCALE。",
    );

    const scaled = new Workbench(f.store, undefined, {
      agentTimeoutScale: 4,
      command: async (_executable, _args, options = {}) => {
        timeouts.push(options.timeoutMs!);
        options.onLine?.(
          JSON.stringify({
            type: "result",
            subtype: "success",
            is_error: false,
            result: "改了匯出的字串。",
          }),
          "stdout",
        );
        return { stdout: "", stderr: "", code: 0 };
      },
    });
    await scaled.chat(f.run.id, "hello.ts", "第四次");
    // 2250 s × 4 = 9000 s, clamped to two hours.
    assert.equal(timeouts.at(-1), 7_200_000);
  } finally {
    await f.cleanup();
  }
});

test("approval blocks unfinished PR text, publish needs the person's confirmations and pushes the chosen GitHub branch", async () => {
  const f = await fixture();
  const previousPath = process.env.PATH;
  try {
    const realGit = (await command("which", ["git"])).stdout.trim();
    const bin = path.join(f.directory, "bin");
    await mkdir(bin);
    const calls = path.join(f.directory, "remote-calls");
    // Local stand-ins record every remote operation; nothing reaches GitHub.
    await writeFile(
      path.join(bin, "git"),
      `#!/usr/bin/env node
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args.includes('push')) { fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(['git', ...args]) + '\\n'); process.exit(0); }
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
  fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(['gh', ...args]) + '\\n');
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
    const template =
      "### Issue for this PR\n\nCloses #\n\n### Type of change\n\n- [ ] Bug fix\n- [ ] Documentation\n";
    const proposalBody =
      "### Issue for this PR\n\n_TODO: link an issue_\n\n### Type of change\n\n- [ ] Bug fix\n- [ ] Documentation\n";
    f.run.draftPreparation = {
      status: "ready",
      fingerprint: "f".repeat(64),
      context: {
        checkedAt: new Date().toISOString(),
        baseSha: f.baseSha,
        warnings: [],
        sources: [
          {
            id: "base:CONTRIBUTING.md",
            kind: "contributing",
            label: "CONTRIBUTING.md",
            content: "All PRs must reference an existing issue.",
          },
          {
            id: "base:.github/pull_request_template.md",
            kind: "template",
            label: ".github/pull_request_template.md",
            content: template,
          },
        ],
      },
      proposal: {
        title: "fix: update the greeting",
        body: proposalBody,
        policy: "repository",
        summary: "依專案範本整理。",
        rules: [],
        checklist: ["請先開 issue。"],
        templateSourceId: "base:.github/pull_request_template.md",
      },
    };
    await writeFile(
      path.join(f.repository, "hello.ts"),
      'export const hello = "after";\n',
    );
    const files = await readDiff(f.run);
    await f.workbench.review(f.run.id, "hello.ts", true, files[0].fingerprint);
    // Text meant for the person cannot be approved.
    await f.workbench.draft(f.run.id, { title: "fix: update the greeting", body: proposalBody });
    await assert.rejects(
      f.workbench.approve(f.run.id, { ...f.run.draft }),
      (error: AppError) => error.statusCode === 422 && /待填寫/.test(error.message),
    );
    assert.equal(f.run.status, "review");
    assert.equal(f.run.approvedFingerprint, undefined);
    // A run approved before this check existed is still stopped before anything is pushed.
    f.run.approvedFingerprint = reviewFingerprint(files, f.run.draft);
    f.run.status = "approved";
    process.env.PATH = `${bin}${path.delimiter}${previousPath}`;
    await assert.rejects(
      f.workbench.publish(f.run.id, f.run.approvedFingerprint),
      /待填寫/,
    );
    assert.ok(!f.run.publishing);
    assert.equal(f.run.publishCommit, undefined);
    // GitHub branch names are validated and empty means the run's own branch.
    await assert.rejects(
      f.workbench.draft(f.run.id, { ...f.run.draft, publishBranch: "feat/" }),
      /分支名稱/,
    );
    // The target branch itself would skip the PR: the push would fast-forward it.
    f.run.branch = "bellpr-test0001";
    await assert.rejects(
      f.workbench.draft(f.run.id, { ...f.run.draft, publishBranch: "Main" }),
      (error: AppError) => error.statusCode === 422 && /目標分支/.test(error.message),
    );
    // A saved draft from elsewhere is still stopped before anything is pushed.
    const saved = { ...f.run.draft };
    f.run.draft = {
      title: f.run.draft.title,
      body: template.replace("Closes #", "No issue is linked yet."),
      publishBranch: "main",
    };
    f.run.approvedFingerprint = reviewFingerprint(files, f.run.draft);
    await assert.rejects(
      f.workbench.publish(f.run.id, f.run.approvedFingerprint),
      /目標分支/,
    );
    assert.ok(!f.run.publishing);
    f.run.draft = saved;
    f.run.branch = "main";
    const finished = template.replace("Closes #", "No issue is linked yet.");
    await f.workbench.draft(f.run.id, {
      title: "fix: update the greeting",
      body: finished,
      publishBranch: " update-greeting ",
    });
    assert.equal(f.run.draft.publishBranch, "update-greeting");
    // The branch is part of what the person approves.
    await assert.rejects(
      f.workbench.approve(f.run.id, { ...f.run.draft, publishBranch: "" }),
      /草稿已更新/,
    );
    await f.workbench.approve(f.run.id, { ...f.run.draft });
    assert.notEqual(
      f.run.approvedFingerprint,
      reviewFingerprint(files, { ...f.run.draft, publishBranch: undefined }),
    );
    const fingerprint = f.run.approvedFingerprint!;
    // Empty boxes and the missing issue each need the person's confirmation.
    for (const acknowledged of [[], ["unchecked"], ["issue", "unknown"]])
      await assert.rejects(
        f.workbench.publish(f.run.id, fingerprint, acknowledged),
        (error: AppError) =>
          error.statusCode === 422 && /逐項確認/.test(error.message),
      );
    assert.ok(!f.run.publishing);
    assert.equal(f.run.publishCommit, undefined);
    await assert.rejects(readFile(calls, "utf8"), /ENOENT/);
    const published = await f.workbench.publish(f.run.id, fingerprint, [
      "unchecked",
      "issue",
      "facts-unknown",
    ]);
    assert.equal(published.status, "published");
    assert.equal(published.publishedBranch, "update-greeting");
    const remote = (await readFile(calls, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    assert.ok(
      remote[0].at(-1)!.endsWith(":refs/heads/update-greeting"),
      remote[0].join(" "),
    );
    const create = remote.find((call) => call[0] === "gh")!;
    assert.equal(create[create.indexOf("--head") + 1], "test-owner:update-greeting");
    // The local review branch keeps its name.
    assert.equal(
      (await git(f.repository, ["symbolic-ref", "--short", "HEAD"])).stdout.trim(),
      f.run.branch,
    );
  } finally {
    process.env.PATH = previousPath;
    await f.cleanup();
  }
});

test("the GitHub branch field is validated over HTTP and leaves older approval fingerprints unchanged", async () => {
  const f = await fixture();
  const app = createApp(f.workbench, {
    staticDirectory: path.join(f.directory, "missing"),
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing server port");
  const url = `http://127.0.0.1:${address.port}/api/runs/${f.run.id}`;
  const headers = {
    host: "127.0.0.1:4311",
    "content-type": "application/json",
  };
  try {
    const files = await readDiff(f.run);
    const legacy = reviewFingerprint(files, { ...f.run.draft });
    assert.equal(
      reviewFingerprint(files, { ...f.run.draft, publishBranch: "" }),
      legacy,
    );
    for (const publishBranch of ["bad name", "a..b", "x.lock", "HEAD", "a".repeat(101)]) {
      const rejected = await http(`${url}/draft`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ ...f.run.draft, publishBranch }),
      });
      assert.equal(rejected.status, 400, publishBranch.slice(0, 12));
    }
    const saved = await http(`${url}/draft`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ ...f.run.draft, publishBranch: "readme-startup" }),
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.json().run.draft.publishBranch, "readme-startup");
    const cleared = await http(`${url}/draft`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ ...f.run.draft, publishBranch: "" }),
    });
    assert.equal("publishBranch" in cleared.json().run.draft, false);
    const malformed = await http(`${url}/publish`, {
      method: "POST",
      headers,
      body: JSON.stringify({ fingerprint: "a".repeat(64), acknowledged: "issue" }),
    });
    assert.equal(malformed.status, 400);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await f.cleanup();
  }
});
