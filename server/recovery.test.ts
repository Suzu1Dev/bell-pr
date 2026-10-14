import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
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
import { withLocale } from "./i18n/index.js";
import type { Database, Repository, Run } from "./types.js";

const prUrl = "https://github.com/test-owner/example/pull/1";

/** A temporary directory with a Git repository holding hello.ts on main. */
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-recovery-test-"));
  const repository = path.join(directory, "repo");
  await mkdir(repository);
  await git(repository, ["init", "-b", "main"]);
  await git(repository, ["config", "user.name", "BELL Test"]);
  await git(repository, ["config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(repository, "hello.ts"), 'export const hello = "before";\n');
  await git(repository, ["add", "hello.ts"]);
  await git(repository, ["commit", "-m", "initial"]);
  const baseSha = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();
  const dataDir = path.join(directory, "state");
  const previousPath = process.env.PATH;
  const deferred: (() => Promise<unknown>)[] = [];
  return {
    directory,
    repository,
    baseSha,
    dataDir,
    statePath: path.join(dataDir, "state.json"),
    /** Puts stand-in executables first on PATH until cleanup. */
    async binaries(scripts: Record<string, string>) {
      const bin = path.join(directory, "bin");
      await mkdir(bin, { recursive: true });
      for (const [name, source] of Object.entries(scripts))
        await writeFile(path.join(bin, name), source, { mode: 0o700 });
      process.env.PATH = `${bin}${path.delimiter}${previousPath}`;
    },
    /** Runs `fn` at cleanup, before the directory goes (last added, first run). */
    defer(fn: () => Promise<unknown>) {
      deferred.unshift(fn);
    },
    cleanup: async () => {
      for (const fn of deferred) await fn();
      process.env.PATH = previousPath;
      await rm(directory, { recursive: true, force: true });
    },
  };
}

/** Answers every CLI probe of GET /api/status without a real agent CLI. */
const statusClis = {
  codex: "#!/bin/sh\necho 'codex-cli 0.0.0-test'\n",
  claude: "#!/bin/sh\necho '0.0.0-test (Claude Code)'\n",
  gh: "#!/bin/sh\necho test-owner\n",
};

function repository(repoPath: string): Repository {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "greeting",
    owner: "local",
    fullName: "local/greeting",
    path: repoPath,
    defaultBranch: "main",
    url: "",
  };
}

/** A run in the shape Workbench writes, in review. */
function reviewRun(id: string, repo: Repository, worktreePath: string, baseSha: string): Run {
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
      { id: "lead", name: "Atlas", role: "Team lead", status: "complete", detail: "Done" },
    ],
    logs: [{ time: "2026-10-12T00:00:01.000Z", agent: "lead", message: "Started" }],
    draft: { title: "Improve greeting", body: "A clearer greeting." },
    reviewedFiles: [],
    reviewedFingerprints: {},
    reports: {},
  };
}

async function writeState(dataDir: string, state: unknown) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, "state.json"), JSON.stringify(state));
}

/** GET or a JSON request through the app on a free port. */
async function call(
  app: ReturnType<typeof createApp>,
  method: string,
  url: string,
  body?: unknown,
) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are read field by field
    return await new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = request(
        `http://127.0.0.1:${address.port}${url}`,
        {
          method,
          headers: {
            host: "127.0.0.1:4311",
            "content-type": "application/json",
            "x-bell-locale": "en",
          },
        },
        (response) => {
          let text = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => (text += chunk));
          response.on("end", () =>
            resolve({ status: response.statusCode!, body: JSON.parse(text) }),
          );
        },
      );
      req.on("error", reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("a truncated state.json comes back from the newest valid backup and /api/status shows the recovery", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const repo = repository(f.repository);
  const state: Database = {
    version: 1,
    repos: [repo],
    runs: [reviewRun("run-a", repo, f.repository, f.baseSha)],
  };
  await writeState(f.dataDir, state);
  // Two earlier starts left two backups; the newer one is damaged too.
  for (let start = 0; start < 2; start++) await new Store(f.dataDir).initialize();
  assert.deepEqual(
    (await readdir(f.dataDir)).filter((name) => name.includes(".bak.")).sort(),
    ["state.json.bak.1", "state.json.bak.2"],
  );
  const written = await readFile(f.statePath, "utf8");
  await writeFile(f.statePath, written.slice(0, Math.floor(written.length / 2)));
  await writeFile(`${f.statePath}.bak.1`, "");

  const store = new Store(f.dataDir);
  await store.initialize();
  assert.deepEqual(store.recovery, {
    restoredFrom: "state.json.bak.2",
    quarantinedRuns: 0,
  });
  assert.deepEqual(store.data, state);
  // The broken file is kept for inspection, and state.json is whole again.
  const corrupt = (await readdir(f.dataDir)).filter((name) =>
    name.startsWith("state.json.corrupt-"),
  );
  assert.equal(corrupt.length, 1);
  assert.equal(
    await readFile(path.join(f.dataDir, corrupt[0]), "utf8"),
    written.slice(0, Math.floor(written.length / 2)),
  );
  assert.deepEqual(JSON.parse(await readFile(f.statePath, "utf8")), state);

  await f.binaries(statusClis);
  const workbench = new Workbench(store);
  f.defer(() => workbench.shutdown());
  const status = await call(createApp(workbench), "GET", "/api/status");
  assert.equal(status.status, 200);
  assert.deepEqual(status.body.recovery, {
    restoredFrom: "state.json.bak.2",
    quarantinedRuns: 0,
  });
  assert.equal(status.body.codex, true);

  // The next start is clean and shows no notice.
  const next = new Store(f.dataDir);
  await next.initialize();
  assert.equal(next.recovery, undefined);
});

test("without a readable backup a damaged state.json still stops the start and stays in place", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  await writeState(f.dataDir, { version: 1, repos: [], runs: [] });
  await writeFile(f.statePath, '{"version":1,"repos":[');
  await writeFile(`${f.statePath}.bak.1`, "{ not json");
  await assert.rejects(new Store(f.dataDir).initialize(), /state\.json/);
  assert.equal(await readFile(f.statePath, "utf8"), '{"version":1,"repos":[');
  assert.ok(
    !(await readdir(f.dataDir)).some((name) => name.includes("corrupt")),
  );
});

test("one malformed run is quarantined while the others load", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const repo = repository(f.repository);
  const good = reviewRun("run-good", repo, f.repository, f.baseSha);
  const other = { ...reviewRun("run-other", repo, f.repository, f.baseSha), status: "published" as const, prUrl };
  const broken = {
    ...reviewRun("run-broken", repo, f.repository, f.baseSha),
    agents: "not a list",
  };
  const unknownStatus = { ...reviewRun("run-status", repo, f.repository, f.baseSha), status: "paused" };
  await writeState(f.dataDir, {
    version: 1,
    repos: [repo],
    runs: [good, broken, other, unknownStatus],
  });
  const store = new Store(f.dataDir);
  await withLocale("en", () => store.initialize());
  assert.deepEqual(
    store.data.runs.map((run) => run.id),
    ["run-good", "run-other"],
  );
  assert.deepEqual(store.recovery, { quarantinedRuns: 2 });
  const quarantine = JSON.parse(
    await readFile(path.join(f.dataDir, "state.quarantine.json"), "utf8"),
  );
  assert.deepEqual(
    quarantine.runs.map((entry: { run: { id: string } }) => entry.run.id),
    ["run-broken", "run-status"],
  );
  // The whole record is kept, with the reason and without data loss.
  assert.deepEqual(quarantine.runs[0].run, broken);
  assert.match(quarantine.runs[0].reason, /^agents: /);
  assert.match(quarantine.runs[1].reason, /^status: /);
  assert.ok(quarantine.runs[0].quarantinedAt);
  // state.json no longer holds them, so the next start is clean.
  const saved = JSON.parse(await readFile(f.statePath, "utf8")) as Database;
  assert.deepEqual(saved.runs.map((run) => run.id), ["run-good", "run-other"]);
  const next = new Store(f.dataDir);
  await next.initialize();
  assert.equal(next.recovery, undefined);
  assert.equal(next.data.runs.length, 2);
  // A later quarantine adds to the file instead of replacing it.
  await writeState(f.dataDir, {
    ...saved,
    repos: [...saved.repos, { id: "bad-repo" }],
    runs: [...saved.runs, { id: "run-later" }],
  });
  const third = new Store(f.dataDir);
  await third.initialize();
  assert.deepEqual(third.recovery, { quarantinedRuns: 1, quarantinedRepos: 1 });
  assert.deepEqual(third.data.repos.map((value) => value.id), [repo.id]);
  const grown = JSON.parse(
    await readFile(path.join(f.dataDir, "state.quarantine.json"), "utf8"),
  );
  assert.deepEqual(
    grown.runs.map((entry: { run: { id: string } }) => entry.run.id),
    ["run-broken", "run-status", "run-later"],
  );
  assert.deepEqual(grown.repos.map((entry: { repo: { id: string } }) => entry.repo.id), ["bad-repo"]);
});

test("fields from a newer build survive a load, an edit and a save at every level", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const repo = { ...repository(f.repository), futureRepoField: { kept: 1 } };
  const run = {
    ...reviewRun("run-future", repo, f.repository, f.baseSha),
    futureRunField: ["kept"],
    agents: [
      {
        id: "lead",
        name: "Atlas",
        role: "Team lead",
        status: "complete",
        detail: "Done",
        futureAgentField: true,
      },
    ],
    draft: { title: "Improve greeting", body: "A clearer greeting.", futureDraftField: "x" },
    explanations: {
      "hello.ts": { fingerprint: "a".repeat(64), status: "pending", futureExplanationField: 2 },
    },
    team: {
      config: {
        maxTeammates: 2,
        requirePlanApproval: true,
        provider: "codex",
        protocol: "bell-shared-tasks",
        messageDelivery: "between-turns",
        futureConfigField: "x",
      },
      phase: "complete",
      planSummary: "One task",
      tasks: [
        {
          id: "task-1",
          title: "Greeting",
          description: "Change hello.ts",
          owner: "member-1",
          files: ["hello.ts"],
          dependsOn: [],
          status: "complete",
          futureTaskField: { deep: [1, 2] },
        },
      ],
      messages: [],
    },
    followUps: [
      {
        id: "round-1",
        requestedAt: "2026-10-12T00:00:02.000Z",
        feedbackUrls: [],
        status: "discarded",
        parentCommit: f.baseSha,
        futureRoundField: "kept",
      },
    ],
  };
  const state = { version: 1, futureTopField: { kept: true }, repos: [repo], runs: [run] };
  await writeState(f.dataDir, state);
  const store = new Store(f.dataDir);
  await store.initialize();
  assert.deepEqual(store.data, state);
  // An edit through the Workbench writes every unknown field back.
  const workbench = new Workbench(store);
  f.defer(() => workbench.shutdown());
  await writeFile(path.join(f.repository, "hello.ts"), 'export const hello = "after";\n');
  await workbench.saveNote("run-future", "hello.ts", "Greets more clearly.");
  const reopened = new Store(f.dataDir);
  await reopened.initialize();
  const [saved] = reopened.data.runs as unknown as (typeof run & { notes: unknown })[];
  assert.deepEqual(saved.futureRunField, ["kept"]);
  assert.equal(saved.agents[0].futureAgentField, true);
  assert.equal(saved.draft.futureDraftField, "x");
  assert.equal(saved.team.config.futureConfigField, "x");
  assert.deepEqual(saved.team.tasks[0].futureTaskField, { deep: [1, 2] });
  assert.equal(saved.followUps[0].futureRoundField, "kept");
  assert.ok(saved.notes);
  assert.deepEqual(
    (reopened.data as unknown as typeof state).futureTopField,
    { kept: true },
  );
  assert.deepEqual(
    (reopened.data.repos[0] as unknown as typeof repo).futureRepoField,
    { kept: 1 },
  );
});
