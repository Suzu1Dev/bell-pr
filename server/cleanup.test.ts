import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { request } from "node:http";
import os from "node:os";
import path from "node:path";
import { git } from "./process.js";
import { secretInPatch } from "./secrets.js";
import { Store } from "./store.js";
import { Workbench } from "./workbench.js";
import { createApp } from "./app.js";
import { log } from "./log.js";
import { withLocale } from "./i18n/index.js";
import {
  insightsCachePath,
  retentionDays,
  setRetentionDaysSource,
} from "./cleanup.js";
import { learningPageSize } from "./routes/learning.js";
import type { Repository, Run } from "./types.js";

const dayMs = 24 * 60 * 60 * 1000;
const token = `ghp_${"Z9y8X7w6".repeat(4)}`;

const exists = (target: string) =>
  lstat(target).then(
    () => true,
    () => false,
  );

/** A data directory with a Store and Workbench, and stand-in CLIs first on PATH. */
async function fixture(options: { login?: string } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-cleanup-test-"));
  const dataDir = path.join(directory, "state");
  const bin = path.join(directory, "bin");
  await mkdir(bin, { recursive: true });
  const scripts: Record<string, string> = {
    codex: "#!/bin/sh\necho 'codex-cli 0.0.0-test'\n",
    claude: "#!/bin/sh\necho '0.0.0-test (Claude Code)'\n",
    gh: `#!/bin/sh\necho '${options.login ?? "test-owner"}'\n`,
  };
  for (const [name, source] of Object.entries(scripts))
    await writeFile(path.join(bin, name), source, { mode: 0o700 });
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath}`;
  const store = new Store(dataDir);
  await store.initialize();
  const workbench = new Workbench(store);
  await workbench.maintenance;
  const app = createApp(workbench, { staticDirectory: path.join(directory, "missing") });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  /**
   * An API call as the browser makes it, in English. The guard wants a JSON
   * body on every request that changes data, DELETE included.
   */
  const call = (method: string, url: string, body?: unknown) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are read field by field
    new Promise<{ status: number; body: any; text: string }>((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = request(
        `http://127.0.0.1:${address.port}${url}`,
        {
          method,
          headers: {
            host: "127.0.0.1:4311",
            "content-type": "application/json",
            "x-bell-locale": "en",
            ...(payload === undefined
              ? {}
              : { "content-length": String(Buffer.byteLength(payload)) }),
          },
        },
        (response) => {
          let text = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => (text += chunk));
          response.on("end", () =>
            resolve({ status: response.statusCode!, body: JSON.parse(text), text }),
          );
        },
      );
      req.on("error", reject);
      req.end(payload);
    });
  return {
    directory,
    dataDir,
    store,
    workbench,
    call,
    cleanup: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await workbench.shutdown();
      process.env.PATH = previousPath;
      await rm(directory, { recursive: true, force: true });
    },
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

/** A Git repository with one commit at `repoPath`, optionally with a GitHub origin. */
async function gitRepository(repoPath: string, origin?: string) {
  await mkdir(repoPath, { recursive: true });
  await git(repoPath, ["init", "-b", "main"]);
  await git(repoPath, ["config", "user.name", "BELL Test"]);
  await git(repoPath, ["config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(repoPath, "hello.ts"), 'export const hello = "before";\n');
  await git(repoPath, ["add", "hello.ts"]);
  await git(repoPath, ["commit", "-m", "initial"]);
  if (origin) await git(repoPath, ["remote", "add", "origin", origin]);
  return (await git(repoPath, ["rev-parse", "HEAD"])).stdout.trim();
}

/**
 * The project record for `repoPath` itself. An import clones a local
 * checkout, so a test that needs the record to point at a given folder
 * (BELL's clone, or a checkout an earlier build worked in) adds it directly.
 */
function addRepository(f: Fixture, repoPath: string, url = ""): Repository {
  const github = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(url);
  const name = github?.[2] ?? path.basename(repoPath);
  const repo: Repository = {
    id: randomUUID(),
    name,
    owner: github?.[1] ?? "local",
    fullName: github ? `${github[1]}/${name}` : `local/${name}`,
    path: repoPath,
    defaultBranch: "main",
    url,
  };
  f.store.data.repos.unshift(repo);
  return repo;
}

function run(id: string, repo: Repository, fields: Partial<Run> = {}): Run {
  return {
    id,
    repoId: repo.id,
    title: `Run ${id}`,
    prompt: "Improve the greeting",
    status: "published",
    branch: `fix/${id.slice(0, 8)}`,
    baseBranch: "main",
    baseSha: "",
    worktreePath: "",
    createdAt: new Date().toISOString(),
    agents: [],
    logs: [],
    draft: { title: `Run ${id}`, body: "" },
    reviewedFiles: [],
    reviewedFingerprints: {},
    ...fields,
  };
}

/**
 * A run with a real worktree under <data>/worktrees, a teammate checkout
 * under <data>/team-worktrees, its branch and a sync ref.
 */
async function runWithWorkspace(
  f: Fixture,
  repo: Repository,
  baseSha: string,
  id: string,
  fields: Partial<Run> = {},
) {
  const worktreePath = path.join(f.dataDir, "worktrees", id);
  const value = run(id, repo, { baseSha, worktreePath, ...fields });
  await mkdir(path.dirname(worktreePath), { recursive: true });
  await git(repo.path, ["worktree", "add", "-b", value.branch, worktreePath, baseSha]);
  await writeFile(path.join(worktreePath, "hello.ts"), 'export const hello = "after";\n');
  const teamPath = path.join(f.dataDir, "team-worktrees", id, "task-1");
  await mkdir(path.dirname(teamPath), { recursive: true });
  await git(worktreePath, ["worktree", "add", "--detach", teamPath, baseSha]);
  await git(worktreePath, ["update-ref", `refs/bellpr/sync/${id}`, baseSha]);
  await writeFile(path.join(f.dataDir, `publish-index-${id}`), "index");
  f.store.data.runs.push(value);
  return value;
}

const worktreeList = async (repoPath: string) =>
  (await git(repoPath, ["worktree", "list", "--porcelain"])).stdout
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));

test("freeing a run's workspace removes its directories, Git records, branch and sync ref, and the diff then answers 410", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  // BELL's own clone of a GitHub project, under <data>/repositories.
  const clonePath = path.join(f.dataDir, "repositories", "test-owner-example-1a2b3c4d");
  const baseSha = await gitRepository(clonePath, "https://github.com/test-owner/example.git");
  const repo = addRepository(f, clonePath, "https://github.com/test-owner/example");
  assert.equal(f.workbench.managedClone(repo), true);
  const value = await runWithWorkspace(f, repo, baseSha, "aaaaaaaa-1111-4111-8111-111111111111", {
    prUrl: "https://github.com/test-owner/example/pull/1",
  });
  const teamDir = path.join(f.dataDir, "team-worktrees", value.id);
  assert.equal((await worktreeList(clonePath)).length, 3);

  const removed = await f.call("DELETE", `/api/runs/${value.id}/workspace`, {});
  assert.equal(removed.status, 200);
  assert.ok(removed.body.run.workspaceRemovedAt);
  assert.ok(removed.body.run.workspaceBytes > 0);
  assert.equal(await exists(value.worktreePath), false);
  assert.equal(await exists(teamDir), false);
  assert.equal(await exists(path.join(f.dataDir, `publish-index-${value.id}`)), false);
  assert.deepEqual(await worktreeList(clonePath), [await realpath(clonePath)]);
  assert.equal((await git(clonePath, ["branch", "--list", value.branch])).stdout.trim(), "");
  assert.equal(
    (await git(clonePath, ["show-ref", "--", `refs/bellpr/sync/${value.id}`], { allowedCodes: [0, 1] })).stdout.trim(),
    "",
  );
  assert.match(value.logs.at(-1)!.message, /^Removed this run's working files and freed \d/);
  // The run and its record stay; reading the diff says why it is gone.
  const diff = await f.call("GET", `/api/runs/${value.id}/diff`);
  assert.equal(diff.status, 410);
  assert.equal(diff.body.code, "workspace_removed");
  assert.equal(
    diff.body.error,
    "Files for this run were cleaned up to free disk space. Reports and notes are kept.",
  );
  assert.equal((await f.call("GET", `/api/runs/${value.id}`)).status, 200);
  // Work in the checkout answers the same instead of a Git error.
  for (const action of ["sync", "sync/undo", "sync/resolve"]) {
    const refused = await f.call("POST", `/api/runs/${value.id}/${action}`, {});
    assert.equal(refused.status, 410, action);
    assert.equal(refused.body.code, "workspace_removed", action);
    // The published PR's checkout is gone: say what that means for it.
    assert.match(refused.body.error, /can no longer be synced or given a follow-up round here/, action);
  }
  // Freeing it again changes nothing.
  const again = await f.call("DELETE", `/api/runs/${value.id}/workspace`, {});
  assert.equal(again.status, 200);
  assert.equal(again.body.run.workspaceRemovedAt, removed.body.run.workspaceRemovedAt);
  // A run without files cannot be retried.
  value.status = "failed";
  value.team = {
    config: { maxTeammates: 2, requirePlanApproval: true, provider: "codex", protocol: "bell-shared-tasks", messageDelivery: "between-turns" },
    phase: "failed",
    planSummary: "",
    tasks: [],
    messages: [],
  };
  const retry = await f.call("POST", `/api/runs/${value.id}/team/retry`, {});
  assert.equal(retry.status, 410);
});

test("a repository on the person's disk keeps the run's branch, and active or outside workspaces are refused", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const userRepo = path.join(f.directory, "my-project");
  const baseSha = await gitRepository(userRepo, "https://github.com/test-owner/example.git");
  // Imported in place by an earlier build.
  const repo = addRepository(f, userRepo, "https://github.com/test-owner/example");
  assert.equal(f.workbench.managedClone(repo), false);
  const value = await runWithWorkspace(f, repo, baseSha, "bbbbbbbb-2222-4222-8222-222222222222");
  const busy = await runWithWorkspace(f, repo, baseSha, "cccccccc-3333-4333-8333-333333333333", {
    status: "running",
  });
  const outside = run("dddddddd-4444-4444-8444-444444444444", repo, {
    baseSha,
    worktreePath: userRepo,
    status: "failed",
  });
  f.store.data.runs.push(outside);

  assert.equal((await f.call("DELETE", `/api/runs/${value.id}/workspace`, {})).status, 200);
  assert.equal(await exists(value.worktreePath), false);
  // The person's own branch list is never changed.
  assert.equal(
    (await git(userRepo, ["branch", "--list", value.branch])).stdout.trim(),
    value.branch,
  );
  assert.equal(
    (await git(userRepo, ["show-ref", "--", `refs/bellpr/sync/${value.id}`], { allowedCodes: [0, 1] })).stdout.trim(),
    "",
  );
  const refused = await f.call("DELETE", `/api/runs/${busy.id}/workspace`, {});
  assert.equal(refused.status, 409);
  assert.equal(
    refused.body.error,
    "This run is still working. Stop it or wait until it finishes, then try again.",
  );
  assert.equal(await exists(busy.worktreePath), true);
  const kept = await f.call("DELETE", `/api/runs/${outside.id}/workspace`, {});
  assert.equal(kept.status, 409);
  assert.equal(await exists(path.join(userRepo, "hello.ts")), true);
  // Deleting the run removes the record; the person's checkout stays.
  assert.equal((await f.call("DELETE", `/api/runs/${outside.id}`, {})).status, 200);
  assert.equal(await exists(path.join(userRepo, "hello.ts")), true);
  assert.equal((await f.call("DELETE", `/api/runs/${busy.id}`, {})).status, 409);
  assert.deepEqual(
    f.store.data.runs.map((entry) => entry.id),
    [value.id, busy.id],
  );
});

test("BELL's clone of a local-only checkout is its own: freeing a run deletes the run's branch there", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const checkout = path.join(f.directory, "local-only");
  await gitRepository(checkout);
  const repo = await f.workbench.importRepository(checkout);
  assert.equal(repo.url, "");
  assert.equal(f.workbench.managedClone(repo), false);
  const baseSha = (await git(repo.path, ["rev-parse", "HEAD"])).stdout.trim();
  const value = await runWithWorkspace(f, repo, baseSha, "eeeeeeee-5555-4555-8555-555555555555");
  const storage = (await f.call("GET", "/api/storage")).body;
  assert.equal(storage.repos[0].managed, true);
  assert.ok(storage.repos[0].bytes > 0);
  assert.equal((await f.call("DELETE", `/api/runs/${value.id}/workspace`, {})).status, 200);
  assert.equal((await git(repo.path, ["branch", "--list", value.branch])).stdout.trim(), "");
  // The person's checkout never had the branch.
  assert.equal((await git(checkout, ["branch", "--list", value.branch])).stdout.trim(), "");
});

test("retention frees only finished runs past the period and never touches active ones", async (t) => {
  const f = await fixture();
  const previous = process.env.BELLPR_RETENTION_DAYS;
  t.after(async () => {
    setRetentionDaysSource();
    if (previous === undefined) delete process.env.BELLPR_RETENTION_DAYS;
    else process.env.BELLPR_RETENTION_DAYS = previous;
    await f.cleanup();
  });
  const repoPath = path.join(f.directory, "repo");
  const baseSha = await gitRepository(repoPath);
  const repo = await f.workbench.importRepository(repoPath);
  const old = new Date(Date.now() - 40 * dayMs).toISOString();
  const recent = new Date(Date.now() - 2 * dayMs).toISOString();
  const fields = (status: Run["status"], at = old): Partial<Run> => ({
    status,
    createdAt: at,
    logs: [{ time: at, agent: "system", message: "Last activity" }],
  });
  const make = (id: string, extra: Partial<Run>) =>
    runWithWorkspace(f, repo, baseSha, `${id}-0000-4000-8000-000000000000`.slice(0, 36), extra);
  const eligible = [
    await make("0000fail", { ...fields("failed"), locale: "zh-TW" }),
    await make("00cancel", fields("cancelled")),
    await make("0publish", fields("published")),
  ];
  const kept = [
    await make("00queued", fields("queued")),
    await make("0running", fields("running")),
    await make("00paused", fields("awaiting_plan")),
    await make("00review", fields("review")),
    await make("approved", fields("approved")),
    await make("pushing0", { ...fields("approved"), publishing: true }),
    await make("00recent", fields("failed", recent)),
    // A published PR with an open round keeps its checkout.
    await make("00rounds", {
      ...fields("published"),
      followUps: [
        { id: "r1", requestedAt: old, feedbackUrls: [], status: "review", parentCommit: baseSha },
      ],
    }),
    // A follow-up round last week counts as activity.
    await make("00active", {
      ...fields("published"),
      followUps: [
        { id: "r1", requestedAt: recent, feedbackUrls: [], status: "published", parentCommit: baseSha },
      ],
    }),
  ];
  // A run cancelled before it started has no files, so nothing marks it
  // removed and a retry can still create its worktree.
  const neverStarted = run("0nofiles-0000-4000-8000-000000000000", repo, {
    ...fields("cancelled"),
    worktreePath: path.join(f.dataDir, "worktrees", "0nofiles-0000-4000-8000-000000000000"),
  });
  f.store.data.runs.push(neverStarted);
  // Older than the period by the configured source, not by the environment.
  process.env.BELLPR_RETENTION_DAYS = "60";
  assert.equal(retentionDays(), 60);
  assert.deepEqual(await f.workbench.applyRetention(), []);
  setRetentionDaysSource(() => 30);
  assert.equal(retentionDays(), 30);
  const archived = await f.workbench.applyRetention();
  assert.deepEqual(archived.sort(), eligible.map((value) => value.id).sort());
  for (const value of eligible) {
    assert.ok(value.workspaceRemovedAt);
    assert.equal(await exists(value.worktreePath), false);
  }
  for (const value of kept) {
    assert.equal(value.workspaceRemovedAt, undefined, value.id);
    assert.equal(await exists(value.worktreePath), true, value.id);
  }
  assert.equal(neverStarted.workspaceRemovedAt, undefined);
  assert.deepEqual(neverStarted.logs.map((entry) => entry.message), ["Last activity"]);
  // The log line is in the run's own language.
  assert.match(eligible[0].logs.at(-1)!.message, /^這個工作結束 30 天後已移除工作檔案/);
  // An invalid source falls back to the environment, then 14 days.
  setRetentionDaysSource(() => 0);
  assert.equal(retentionDays(), 60);
  process.env.BELLPR_RETENTION_DAYS = "soon";
  assert.equal(retentionDays(), 14);
});

test("deleting a project is refused while a run works, then removes its clone, runs and analysis", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const clonePath = path.join(f.dataDir, "repositories", "test-owner-example-5e6f7a8b");
  const baseSha = await gitRepository(clonePath, "https://github.com/test-owner/example.git");
  const repo = addRepository(f, clonePath, "https://github.com/test-owner/example");
  const working = await runWithWorkspace(f, repo, baseSha, "eeeeeeee-5555-4555-8555-555555555555", {
    status: "running",
  });
  const cache = insightsCachePath(f.dataDir, repo.id);
  await mkdir(path.dirname(cache), { recursive: true });
  await writeFile(cache, "{}");
  const refused = await f.call("DELETE", `/api/repos/${repo.id}`, {});
  assert.equal(refused.status, 409);
  assert.equal(
    refused.body.error,
    "A run of this project is still working. Stop it or wait until it finishes, then delete the project.",
  );
  assert.equal(await exists(clonePath), true);
  working.status = "failed";
  const removed = await f.call("DELETE", `/api/repos/${repo.id}`, {});
  assert.equal(removed.status, 200);
  assert.equal(await exists(clonePath), false);
  assert.equal(await exists(working.worktreePath), false);
  assert.equal(await exists(cache), false);
  assert.deepEqual(f.store.data.repos, []);
  assert.deepEqual(f.store.data.runs, []);
  // A project on the person's disk stays there.
  const userRepo = path.join(f.directory, "mine");
  await gitRepository(userRepo);
  const local = await f.workbench.importRepository(userRepo);
  assert.equal((await f.call("DELETE", `/api/repos/${local.id}`, {})).status, 200);
  assert.equal(await exists(path.join(userRepo, "hello.ts")), true);
  assert.equal((await f.call("DELETE", `/api/repos/${local.id}`, {})).status, 404);
});

test("erasing all data needs ERASE, waits for running work, and keeps settings and the license", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const clonePath = path.join(f.dataDir, "repositories", "test-owner-example-9a8b7c6d");
  const baseSha = await gitRepository(clonePath, "https://github.com/test-owner/example.git");
  const repo = await f.workbench.importRepository(clonePath);
  const value = await runWithWorkspace(f, repo, baseSha, "ffffffff-6666-4666-8666-666666666666", {
    status: "queued",
    baseSha,
  });
  const keep = ["model-settings.json", "app-settings.json", "license.json", "bellpr.lock"];
  for (const name of keep) await writeFile(path.join(f.dataDir, name), "{}");
  const erased = [
    "discovery.json",
    "state.quarantine.json",
    "state.json.corrupt-2026-10-01T00-00-00-000Z",
    "team-index-1234",
    "author-emails.json",
  ];
  for (const name of erased) await writeFile(path.join(f.dataDir, name), "{}");
  await mkdir(path.join(f.dataDir, "insights"), { recursive: true });
  await writeFile(insightsCachePath(f.dataDir, repo.id), "{}");
  log.info("before.erase", { runId: value.id });

  for (const body of [{}, { confirm: "erase" }, { confirm: true }]) {
    const refused = await f.call("POST", "/api/data/erase", body);
    assert.equal(refused.status, 400);
    assert.equal(refused.body.error, "Type ERASE to confirm that all data should be deleted.");
  }
  await assert.rejects(
    withLocale("en", () => f.workbench.eraseAll("yes")),
    { statusCode: 400 },
  );
  const busy = await f.call("POST", "/api/data/erase", { confirm: "ERASE" });
  assert.equal(busy.status, 409);
  assert.equal(await exists(clonePath), true);
  value.status = "cancelled";
  const done = await f.call("POST", "/api/data/erase", { confirm: "ERASE" });
  assert.equal(done.status, 200);
  assert.deepEqual(done.body, { erased: { runs: 1, repos: 1 } });
  assert.deepEqual(f.store.data.repos, []);
  assert.deepEqual(f.store.data.runs, []);
  const left = await readdir(f.dataDir);
  for (const name of keep) assert.ok(left.includes(name), name);
  for (const name of [...erased, "repositories", "worktrees", "team-worktrees", "insights", "state.json.bak.1"])
    assert.ok(!left.includes(name), name);
  const saved = JSON.parse(await readFile(path.join(f.dataDir, "state.json"), "utf8"));
  assert.deepEqual(saved, { version: 1, repos: [], runs: [] });
  // Today's log was emptied of what came before.
  const logs = await readdir(path.join(f.dataDir, "logs"));
  for (const name of logs)
    assert.ok(!(await readFile(path.join(f.dataDir, "logs", name), "utf8")).includes("before.erase"));
});

/** No credential shape, no GitHub login, and no absolute path in the text. */
function assertShareable(text: string, f: Fixture, login: string) {
  assert.equal(secretInPatch(text), false, "a token-shaped string");
  assert.ok(!text.includes(token));
  assert.ok(!text.toLowerCase().includes(login.toLowerCase()), "the GitHub login");
  assert.ok(!text.includes(f.dataDir), "the data directory path");
  assert.ok(!text.includes(os.homedir()), "the home directory");
  // An absolute POSIX path in a JSON string or after a space.
  assert.doesNotMatch(text, /(?:["\s(=]|\\n)\/(?:[\w.-]+\/)*[\w.-]+/);
  assert.doesNotMatch(text, /[A-Za-z]:\\\\/);
}

test("storage and diagnostics report sizes, versions and logs without tokens, the login or outside paths", async (t) => {
  const login = "octo-person";
  const f = await fixture({ login });
  t.after(f.cleanup);
  const clonePath = path.join(f.dataDir, "repositories", "octo-person-example-0a1b2c3d");
  const baseSha = await gitRepository(clonePath, "https://github.com/octo-person/example.git");
  const repo = await f.workbench.importRepository(clonePath);
  // A title is the person's text and may hold a pasted secret.
  const value = await runWithWorkspace(f, repo, baseSha, "abababab-7777-4777-8777-777777777777", {
    title: `Rotate ${token} in the example`,
  });
  // Log lines that carry everything diagnostics must not leak.
  log.warn("probe.leaky", {
    token,
    remote: `https://octo-person:${token}@github.com/octo-person/example.git`,
    home: path.join(os.homedir(), "projects", "example"),
    outside: "/opt/tools/bin/codex",
    windows: "C:\\Users\\octo\\project",
    url: "file:///srv/bell/server.js",
    data: path.join(f.dataDir, "worktrees", value.id),
    user: "Octo-Person",
  });

  const storage = await f.call("GET", "/api/storage");
  assert.equal(storage.status, 200);
  assert.ok(storage.body.totalBytes > 0);
  assert.equal(storage.body.retentionDays, retentionDays());
  const [clone] = storage.body.repos;
  assert.equal(clone.managed, true);
  assert.ok(clone.bytes > 0);
  const [measured] = storage.body.runs;
  assert.equal(measured.id, value.id);
  assert.ok(measured.bytes > 0);
  assert.equal(measured.removable, true);
  assert.ok(measured.title.startsWith("Rotate ") && !measured.title.includes(token));
  // The repository's full name is the project's, not a path or a secret.
  assertShareable(storage.text.replaceAll(repo.fullName, "owner/name"), f, login);
  // Cached for a minute, measured again after a cleanup.
  assert.deepEqual((await f.call("GET", "/api/storage")).body, storage.body);
  await f.call("DELETE", `/api/runs/${value.id}/workspace`, {});
  const after = (await f.call("GET", "/api/storage")).body;
  assert.equal(after.runs[0].bytes, 0);
  assert.ok(after.runs[0].workspaceRemovedAt);

  const diagnostics = await f.call("GET", "/api/diagnostics");
  assert.equal(diagnostics.status, 200);
  const body = diagnostics.body;
  assert.equal(body.app.name, "BELL PR");
  assert.ok(body.app.version);
  assert.equal(body.node, process.version);
  assert.equal(body.auth.github, true);
  assert.ok(body.checks.every((check: Record<string, unknown>) => !("detail" in check)));
  assert.ok(body.dataDir.totalBytes > 0);
  assert.ok(body.logs.length > 0 && body.logs.length <= 500);
  const leaky = body.logs.find((line: string) => line.includes("probe.leaky"));
  assert.ok(leaky);
  const entry = JSON.parse(leaky);
  assert.equal(entry.home, "~/projects/example");
  assert.equal(entry.outside, "[path]");
  assert.equal(entry.windows, "[path]");
  assert.equal(entry.url, "[path]");
  assert.equal(entry.data, `<data>/worktrees/${value.id}`);
  assert.equal(entry.user, "[github-user]");
  assertShareable(diagnostics.text, f, login);
});

test("the learning record pages runs with ready explanations and notes, newest first", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const repo: Repository = {
    id: "12121212-1212-4121-8121-121212121212",
    name: "greeting",
    owner: "local",
    fullName: "local/greeting",
    path: path.join(f.directory, "repo"),
    defaultBranch: "main",
    url: "",
  };
  f.store.data.repos.push(repo);
  const content = {
    summary: "Greets the world.",
    reason: "Clearer output.",
    concept: "Constants\nA named value.",
    tip: "Name values.",
    example: { scenario: "Run it", before: "hi", after: "hello" },
  };
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 1, 0, minute)).toISOString();
  for (let index = 0; index < 23; index++)
    f.store.data.runs.push(
      run(`learn-${String(index).padStart(2, "0")}`, repo, {
        createdAt: at(index),
        explanations: {
          "hello.ts": { fingerprint: "a".repeat(64), status: "ready", content, generatedAt: at(index) },
          "other.ts": { fingerprint: "b".repeat(64), status: "failed", error: "No answer" },
        },
      }),
    );
  f.store.data.runs.push(
    run("note-only", repo, {
      createdAt: at(30),
      notes: { "hello.ts": { text: "Remember this.", fingerprint: "c".repeat(64), updatedAt: at(30) } },
    }),
    run("nothing", repo, { createdAt: at(31) }),
    run("failed-only", repo, {
      createdAt: at(32),
      explanations: { "x.ts": { fingerprint: "d".repeat(64), status: "failed" } },
      notes: { "x.ts": { text: "   ", fingerprint: "d".repeat(64), updatedAt: at(32) } },
    }),
  );
  const first = await f.call("GET", "/api/learning");
  assert.equal(first.status, 200);
  assert.equal(first.body.runs.length, learningPageSize);
  assert.equal(first.body.runs[0].id, "note-only");
  assert.equal(first.body.runs[1].id, "learn-22");
  assert.deepEqual(Object.keys(first.body.runs[1].explanations), ["hello.ts"]);
  assert.deepEqual(first.body.runs[0].notes["hello.ts"].text, "Remember this.");
  assert.ok(!("logs" in first.body.runs[1]));
  assert.ok(first.body.nextCursor);
  // A run created meanwhile neither repeats nor shifts the next page.
  f.store.data.runs.unshift(
    run("newest", repo, {
      createdAt: at(40),
      notes: { "a.ts": { text: "New.", fingerprint: "e".repeat(64), updatedAt: at(40) } },
    }),
  );
  const second = await f.call(
    "GET",
    `/api/learning?cursor=${encodeURIComponent(first.body.nextCursor)}`,
  );
  assert.equal(second.status, 200);
  assert.deepEqual(
    second.body.runs.map((entry: { id: string }) => entry.id),
    ["learn-03", "learn-02", "learn-01", "learn-00"],
  );
  assert.equal(second.body.nextCursor, undefined);
  const invalid = await f.call("GET", "/api/learning?cursor=not-a-cursor");
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error, "This page of learning notes is out of date; reload the list.");
});

test("the diff updates explanation and draft state in the run's language, never the viewer's", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const repoPath = path.join(f.directory, "repo");
  const baseSha = await gitRepository(repoPath);
  const repo = await f.workbench.importRepository(repoPath);
  await writeFile(path.join(repoPath, "hello.ts"), 'export const hello = "after";\n');
  const stalePreparation = () => ({ status: "ready" as const, fingerprint: "f".repeat(64) });
  // Saved before runs had a locale: the builds then wrote zh-TW only.
  const legacy = run("legacy-run", repo, { status: "review", baseSha, worktreePath: repoPath, draftPreparation: stalePreparation() });
  const english = run("english-run", repo, { status: "review", baseSha, worktreePath: repoPath, locale: "en", draftPreparation: stalePreparation() });
  f.store.data.runs.push(legacy, english);
  await withLocale("en", () => f.workbench.diff(legacy.id));
  assert.equal(legacy.draftPreparation?.status, "stale");
  assert.equal(legacy.draftPreparation?.error, "程式碼差異已更新；請重新產生符合目前變更的 PR 草稿建議。");
  await withLocale("zh-TW", () => f.workbench.diff(english.id));
  assert.equal(
    english.draftPreparation?.error,
    "The code diff has changed. Generate a new PR draft suggestion for the current changes.",
  );
});
