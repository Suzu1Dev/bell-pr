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
import { request } from "node:http";
import os from "node:os";
import path from "node:path";
import { git } from "./process.js";
import { Store } from "./store.js";
import { Workbench } from "./workbench.js";
import { createApp } from "./app.js";
import { log } from "./log.js";
import { withLocale } from "./i18n/index.js";
import { insightsCachePath } from "./cleanup.js";
import type { Repository, Run } from "./types.js";


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
  const repo = await f.workbench.importRepository(clonePath);
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
  const repo = await f.workbench.importRepository(userRepo);
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

test("deleting a project is refused while a run works, then removes its clone, runs and analysis", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const clonePath = path.join(f.dataDir, "repositories", "test-owner-example-5e6f7a8b");
  const baseSha = await gitRepository(clonePath, "https://github.com/test-owner/example.git");
  const repo = await f.workbench.importRepository(clonePath);
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

