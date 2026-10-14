import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { DoctorReport } from "../shared/doctor.js";
import { defaultContributionSettings } from "../shared/insights.js";
import { freeEntitlements, proEntitlements, type Entitlements } from "../shared/plans.js";
import { eulaVersion } from "../shared/product.js";
import { createApp } from "./app.js";
import { DiscoveryService } from "./discovery.js";
import { runDoctor } from "./doctor.js";
import { readDiff } from "./git.js";
import { withLocale } from "./i18n/index.js";
import { analysisRunning, ProjectInsightsService } from "./insights.js";
import { fixedLicense } from "./license.js";
import { command, git } from "./process.js";
import { cloneGitHubRepository } from "./repositories.js";
import { Store } from "./store.js";
import type { TeamAgentRunner } from "./team.js";
import { AppError, type Run } from "./types.js";
import { Workbench } from "./workbench.js";

/**
 * Runs `fn` at the end of the test, before what was deferred earlier (the
 * temporary directory goes last).
 */
function deferrer(t: TestContext) {
  const deferred: (() => unknown)[] = [];
  t.after(async () => {
    for (const fn of deferred.reverse()) await fn();
  });
  return (fn: () => unknown) => deferred.push(fn);
}

/** A temporary directory removed after the test. */
async function temporary(t: TestContext) {
  const defer = deferrer(t);
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-preflight-test-"));
  defer(() => rm(directory, { recursive: true, force: true }));
  return { directory, defer };
}

/**
 * Puts stand-in CLIs first on PATH for the test. Each logs its arguments
 * to calls.log; no real git, gh, codex or claude is reached for what the
 * stand-ins answer.
 */
async function standIns(
  { directory, defer }: Awaited<ReturnType<typeof temporary>>,
  scripts: Record<string, string>,
) {
  const bin = path.join(directory, "bin");
  await mkdir(bin, { recursive: true });
  const calls = path.join(directory, "calls.log");
  for (const [name, body] of Object.entries(scripts))
    await writeFile(
      path.join(bin, name),
      `#!/bin/sh\necho "${name} $*" >> '${calls}'\n${body}\n`,
      { mode: 0o700 },
    );
  const previous = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previous}`;
  defer(() => {
    process.env.PATH = previous;
  });
  return async () =>
    (await readFile(calls, "utf8").catch(() => "")).split("\n").filter(Boolean);
}

test("an import accepts owner/repo and clones GitHub without past file contents", async (t) => {
  const f = await temporary(t);
  const calls = await standIns(f, {
    // No network: every clone fails after it is recorded.
    git: "echo 'fatal: unable to access' >&2; exit 128",
    gh: "exit 1",
  });
  const store = new Store(path.join(f.directory, "data"));
  await store.initialize();
  const workbench = new Workbench(store);
  f.defer(() => workbench.shutdown());
  await assert.rejects(workbench.importRepository("  octo-org/hello  "), AppError);
  await assert.rejects(
    workbench.importRepository("github.com/octo-org/hello/tree/main/docs"),
    AppError,
  );
  const clones = (await calls()).filter((line) => line.includes(" clone "));
  assert.equal(clones.length, 2);
  for (const line of clones) {
    assert.match(
      line,
      / clone --filter=blob:none --no-recurse-submodules -- https:\/\/github\.com\/octo-org\/hello\.git \S+\/repositories\/octo-org-hello-[0-9a-f]{8}$/,
    );
    // Credentials come from gh alone.
    assert.match(line, /credential\.helper=!gh auth git-credential/);
  }
  assert.equal(store.data.repos.length, 0);
});

test("a clone that takes too long stops with clone_timeout, its advice and no leftovers", async (t) => {
  const f = await temporary(t);
  const destination = path.join(f.directory, "repositories", "octo-org-hello-0000");
  await mkdir(path.dirname(destination), { recursive: true });
  await standIns(f, {
    git: `mkdir -p '${destination}'\nexec sleep 30`,
  });
  const started = Date.now();
  await assert.rejects(
    withLocale("en", () =>
      cloneGitHubRepository(
        path.dirname(destination),
        "https://github.com/octo-org/hello",
        destination,
        300,
      ),
    ),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "clone_timeout");
      assert.equal(error.statusCode, 504);
      assert.match(error.message, /Clone the repository yourself, then import the path/);
      assert.deepEqual(error.fixes, [
        { label: "Clone it yourself", command: "git clone https://github.com/octo-org/hello.git" },
      ]);
      return true;
    },
  );
  assert.ok(Date.now() - started < 10_000);
  assert.equal(existsSync(destination), false);
});

/** Serves `workbench` on a free port; `call` sends JSON the way the UI does. */
async function serve(
  f: Awaited<ReturnType<typeof temporary>>,
  workbench: Workbench,
  options: Parameters<typeof createApp>[1] = {},
) {
  const app = createApp(workbench, {
    staticDirectory: path.join(f.directory, "no-ui"),
    ...options,
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  f.defer(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.locals.insights.shutdown();
    await app.locals.discovery.shutdown();
  });
  const call = (method: string, pathname: string, body?: unknown) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the JSON of several routes
    new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = request(
        `http://127.0.0.1:${address.port}${pathname}`,
        {
          method,
          headers: {
            host: "127.0.0.1:4311",
            "content-type": "application/json",
            "x-bell-locale": "en",
          },
        },
        (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => (text += chunk));
          res.on("end", () => resolve({ status: res.statusCode!, body: text ? JSON.parse(text) : undefined }));
        },
      );
      req.on("error", reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  return { app, call };
}

/** A Git repository with one commit, made without depending on the person's Git identity. */
async function gitRepository(directory: string) {
  await mkdir(directory, { recursive: true });
  const identity = ["-c", "user.name=BELL Test", "-c", "user.email=test@example.invalid"];
  await git(directory, ["init", "-b", "main"]);
  await writeFile(path.join(directory, "hello.ts"), 'export const hello = "before";\n');
  await writeFile(path.join(directory, "README.md"), "# Greeting\nA command-line greeting tool.\n");
  await git(directory, ["add", "--", "hello.ts", "README.md"]);
  await git(directory, [...identity, "commit", "-m", "initial"]);
  return (await git(directory, ["rev-parse", "HEAD"])).stdout.trim();
}

/** Agents that work until they are stopped, so a run stays running. */
const workUntilStopped: TeamAgentRunner = (input) =>
  new Promise((_resolve, reject) => {
    if (input.signal.aborted) reject(new Error("stopped"));
    input.signal.addEventListener("abort", () => reject(new Error("stopped")), { once: true });
  });

const codexReady = async () => ({
  codex: true,
  codexAuthenticated: true,
  claude: false,
  claudeAuthenticated: false,
  github: false,
});

async function waitUntil(condition: () => boolean, what: string) {
  const end = Date.now() + 10_000;
  while (!condition()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await delay(10);
  }
}

/** A Workbench on a fresh data directory with one imported project. */
async function workbenchWithProject(
  f: Awaited<ReturnType<typeof temporary>>,
  dependencies: ConstructorParameters<typeof Workbench>[2] = {},
) {
  await gitRepository(path.join(f.directory, "repo"));
  const store = new Store(path.join(f.directory, "data"));
  await store.initialize();
  const workbench = new Workbench(store, workUntilStopped, {
    getModelCatalog: async () => ({ models: [], source: "codex" }),
    ...dependencies,
  });
  f.defer(() => workbench.shutdown());
  workbench.status = codexReady;
  const repo = await workbench.importRepository(path.join(f.directory, "repo"));
  return { store, workbench, repo };
}

const prompt = "Make the greeting friendlier for new users";

test("raising maxActiveRuns through PUT /api/app-settings starts a queued run immediately", async (t) => {
  const f = await temporary(t);
  const { workbench, repo } = await workbenchWithProject(f, { maxActiveRuns: 1 });
  const { call } = await serve(f, workbench);
  const first = await workbench.createRun(repo.id, prompt);
  const second = await workbench.createRun(repo.id, `${prompt} again`);
  assert.equal(first.status, "running");
  assert.equal(second.status, "queued");
  assert.deepEqual((await call("GET", "/api/app-settings")).body, { settings: {}, lockedBy: {} });

  const saved = await call("PUT", "/api/app-settings", { maxActiveRuns: 2 });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body, { settings: { maxActiveRuns: 2 }, lockedBy: {} });
  // Started by the change itself, not by another run finishing.
  assert.equal(second.status, "running");
  assert.equal(first.status, "running");
  const status = await call("GET", "/api/status");
  assert.equal(status.body.limits.maxActiveRuns, 2);
  assert.equal(status.body.limits.effectiveMaxActiveRuns, 2);
  // A changed process limit applies to the shared slots at once.
  await call("PUT", "/api/app-settings", { maxAgentProcesses: 6 });
  assert.equal(workbench.agentSlots.limit, 6);
  await call("PUT", "/api/app-settings", { maxAgentProcesses: null });
  assert.equal(workbench.agentSlots.limit, 3);
  // Kept for the next start.
  assert.deepEqual(
    JSON.parse(await readFile(path.join(workbench.store.directory, "app-settings.json"), "utf8")),
    { maxActiveRuns: 2 },
  );
  // Invalid values and unknown settings are refused.
  assert.equal((await call("PUT", "/api/app-settings", { maxActiveRuns: 9 })).status, 400);
  assert.equal((await call("PUT", "/api/app-settings", { theme: "dark" })).status, 400);
});

test("an environment-locked setting reports lockedBy and its PUT gets 409", async (t) => {
  const f = await temporary(t);
  const previous = process.env.BELLPR_MAX_ACTIVE_RUNS;
  process.env.BELLPR_MAX_ACTIVE_RUNS = "1";
  f.defer(() => {
    if (previous === undefined) delete process.env.BELLPR_MAX_ACTIVE_RUNS;
    else process.env.BELLPR_MAX_ACTIVE_RUNS = previous;
  });
  const { workbench } = await workbenchWithProject(f, { maxActiveRuns: 1 });
  const { call } = await serve(f, workbench);
  const view = await call("GET", "/api/app-settings");
  assert.deepEqual(view.body, {
    settings: { maxActiveRuns: 1 },
    lockedBy: { maxActiveRuns: "BELLPR_MAX_ACTIVE_RUNS" },
  });
  const refused = await call("PUT", "/api/app-settings", { maxActiveRuns: 3, locale: "en" });
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /BELLPR_MAX_ACTIVE_RUNS/);
  assert.deepEqual(refused.body.params, {
    setting: "maxActiveRuns",
    variable: "BELLPR_MAX_ACTIVE_RUNS",
  });
  // Nothing of a refused request is saved; other settings still are.
  assert.equal(workbench.appSettings.get().locale, undefined);
  const accepted = await call("PUT", "/api/app-settings", {
    eulaAcceptedVersion: eulaVersion,
    onboardingCompletedAt: "2026-10-14T09:00:00.000Z",
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.settings.eulaAcceptedVersion, eulaVersion);
  assert.equal(workbench.maxActiveRuns, 1);
});

test("on the Free plan a second run stays queued and a 3-teammate request runs with 2 and a notice", async (t) => {
  const f = await temporary(t);
  let entitlements: Entitlements = freeEntitlements;
  const { workbench, repo } = await workbenchWithProject(f, {
    maxActiveRuns: 2,
    entitlements: () => entitlements,
  });
  const { call } = await serve(f, workbench, { license: fixedLicense("free") });
  const settings = { ...defaultContributionSettings, maxTeammates: 3 as const };
  const first = await withLocale("en", () => workbench.createRun(repo.id, prompt, undefined, settings));
  const second = await withLocale("zh-TW", () =>
    workbench.createRun(repo.id, `${prompt} again`, undefined, settings),
  );
  assert.equal(first.team?.config.maxTeammates, 2);
  assert.equal(first.contributionSettings?.maxTeammates, 2);
  const notices = first.logs.filter((entry) => entry.kind === "notice");
  assert.deepEqual(
    notices.map((entry) => entry.message),
    ["Free plan: up to 2 teammates work at once. Pro runs up to 4."],
  );
  // In the run's own language.
  assert.deepEqual(
    second.logs.filter((entry) => entry.kind === "notice").map((entry) => entry.message),
    ["免費方案：最多 2 位隊員同時工作。Pro 最多可有 4 位。"],
  );
  assert.equal(first.status, "running");
  await delay(200);
  assert.equal(second.status, "queued");
  const status = await call("GET", "/api/status");
  assert.equal(status.body.limits.maxActiveRuns, 2);
  assert.equal(status.body.limits.effectiveMaxActiveRuns, 1);
  assert.equal(status.body.license.plan, "free");
  assert.equal(typeof status.body.version, "string");

  // A plan change drains the queue; existing runs keep their team.
  entitlements = proEntitlements(2);
  workbench.entitlementsChanged();
  assert.equal(second.status, "running");
  assert.equal(second.team?.config.maxTeammates, 2);
  const pro = await workbench.createRun(repo.id, `${prompt} with Pro`, undefined, settings);
  assert.equal(pro.team?.config.maxTeammates, 3);
  assert.equal(pro.logs.some((entry) => entry.kind === "notice"), false);
});

/** Stand-ins for a machine where only Claude Code is installed and signed in. */
const claudeOnly = {
  git: `case "$1" in
  --version) echo "git version 2.45.1" ;;
  var) echo "Test User <test@example.com> 1760000000 +0000" ;;
  config) echo "test@example.com" ;;
  *) echo "fatal: not supported here" >&2; exit 1 ;;
esac`,
  claude: `case "$1" in
  --version) echo "2.1.292 (Claude Code)" ;;
  auth) echo '{"loggedIn": true, "authMethod": "claude.ai", "subscriptionType": "max"}' ;;
  *) exit 1 ;;
esac`,
};

test("Claude-only setups default the provider to claude without writing model-settings.json, and the sandbox is checked before a run", async (t) => {
  const f = await temporary(t);
  // Only the stand-ins: no real git, gh, codex, claude or bubblewrap.
  const bin = path.join(f.directory, "only-bin");
  await mkdir(bin);
  for (const [name, body] of Object.entries(claudeOnly))
    await writeFile(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o700 });
  const previous = {
    path: process.env.PATH,
    allow: process.env.BELLPR_ALLOW_UNSANDBOXED_AGENTS,
  };
  f.defer(() => {
    process.env.PATH = previous.path;
    if (previous.allow !== undefined) process.env.BELLPR_ALLOW_UNSANDBOXED_AGENTS = previous.allow;
  });
  delete process.env.BELLPR_ALLOW_UNSANDBOXED_AGENTS;
  const store = new Store(path.join(f.directory, "data"));
  await store.initialize();
  const repoId = "4a4a4a4a-4a4a-44a4-84a4-4a4a4a4a4a4a";
  store.data.repos.push({
    id: repoId,
    name: "greeting",
    owner: "local",
    fullName: "local/greeting",
    path: path.join(f.directory, "repo"),
    defaultBranch: "main",
    url: "",
  });
  const workbench = new Workbench(store, workUntilStopped, {
    getModelCatalog: async (provider) => ({ models: [], source: provider ?? "codex" }),
  });
  f.defer(() => workbench.shutdown());
  const { call } = await serve(f, workbench);
  process.env.PATH = bin;

  const status = await call("GET", "/api/status");
  assert.equal(status.status, 200);
  assert.deepEqual(
    {
      codex: status.body.codex,
      claude: status.body.claude,
      claudeAuthenticated: status.body.claudeAuthenticated,
      github: status.body.github,
      ready: status.body.ready,
    },
    { codex: false, claude: true, claudeAuthenticated: true, github: false, ready: true },
  );
  const settings = await call("GET", "/api/model-settings");
  assert.deepEqual(settings.body, {
    settings: { provider: "claude", model: "", reasoningEffort: "" },
  });
  assert.equal(existsSync(path.join(store.directory, "model-settings.json")), false);

  // GET /api/doctor answers the full report; ?refresh=1 probes again.
  const doctor = (await call("GET", "/api/doctor")).body as DoctorReport;
  assert.equal(doctor.ready, true);
  const provider = doctor.checks.find((check) => check.id === "provider-ready");
  assert.equal(provider?.detail, "Ready: Claude Code.");
  assert.equal(doctor.checks.find((check) => check.id === "claude-auth")?.detail, "claude.ai · Max");
  const refreshed = (await call("GET", "/api/doctor?refresh=1")).body as DoctorReport;
  assert.ok(Date.parse(refreshed.checkedAt) >= Date.parse(doctor.checkedAt));

  // A Claude run is refused before it is queued while its sandbox cannot start.
  const refused = await call("POST", "/api/runs", { repoId, prompt });
  assert.equal(refused.status, 503);
  assert.equal(refused.body.code, "claude_sandbox_unavailable");
  assert.ok(refused.body.fixes.length);
  assert.equal(store.data.runs.length, 0);
  // Allowed in the app settings, the run is created with Claude Code.
  assert.equal(
    (await call("PUT", "/api/app-settings", { allowUnsandboxedAgents: true })).status,
    200,
  );
  // The checklist shows the opt-in at once, from the probe results it has.
  const allowed = (await call("GET", "/api/doctor")).body as DoctorReport;
  assert.equal(
    allowed.checks.find((check) => check.id === "claude-sandbox")?.reason,
    "allowed",
  );
  const created = await call("POST", "/api/runs", { repoId, prompt });
  assert.equal(created.status, 202, JSON.stringify(created.body));
  assert.equal(created.body.run.modelExecution.provider, "claude");
  assert.equal(created.body.run.team.config.provider, "claude");
  assert.equal(existsSync(path.join(store.directory, "model-settings.json")), false);
});

test("a run for a provider that is not signed in is refused with its code and fix", async (t) => {
  const f = await temporary(t);
  const { workbench, repo } = await workbenchWithProject(f);
  workbench.status = async () => ({ ...(await codexReady()), codexAuthenticated: false });
  await assert.rejects(
    withLocale("en", () => workbench.createRun(repo.id, prompt)),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, "codex_unauthenticated");
      assert.deepEqual(error.fixes, [{ label: "Sign in to Codex", command: "codex login" }]);
      return true;
    },
  );
  workbench.status = async () => ({ ...(await codexReady()), codex: false, codexAuthenticated: false });
  await assert.rejects(workbench.createRun(repo.id, prompt), { code: "codex_missing" });
  assert.equal(workbench.store.data.runs.length, 0);
});

/**
 * Makes Git refuse to guess an identity for the test, wherever it runs:
 * an empty global configuration that only allows configured identities.
 */
async function noGitIdentity(f: Awaited<ReturnType<typeof temporary>>) {
  const config = path.join(f.directory, "gitconfig");
  await writeFile(config, "[user]\n\tuseConfigOnly = true\n");
  const names = [
    "GIT_CONFIG_GLOBAL",
    "GIT_CONFIG_NOSYSTEM",
    "GIT_AUTHOR_NAME",
    "GIT_AUTHOR_EMAIL",
    "GIT_COMMITTER_NAME",
    "GIT_COMMITTER_EMAIL",
    "EMAIL",
  ];
  const previous = names.map((name) => [name, process.env[name]] as const);
  for (const name of names) delete process.env[name];
  process.env.GIT_CONFIG_GLOBAL = config;
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  f.defer(() => {
    for (const [name, value] of previous)
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
  });
}

test("approve and publish without a Git identity fail with git_identity_missing before any push", async (t) => {
  const f = await temporary(t);
  await noGitIdentity(f);
  const repository = path.join(f.directory, "repo");
  const baseSha = await gitRepository(repository);
  const calls = await standIns(f, { gh: "exit 97" });
  const store = new Store(path.join(f.directory, "data"));
  await store.initialize();
  const workbench = new Workbench(store);
  f.defer(() => workbench.shutdown());
  const repo = {
    id: "5b5b5b5b-5b5b-45b5-85b5-5b5b5b5b5b5b",
    name: "example",
    owner: "test-owner",
    fullName: "test-owner/example",
    path: repository,
    defaultBranch: "main",
    url: "https://github.com/test-owner/example",
  };
  store.data.repos.push(repo);
  const run: Run = {
    id: "identity-run",
    repoId: repo.id,
    title: "Improve greeting",
    prompt,
    status: "review",
    branch: "main",
    baseBranch: "main",
    baseSha,
    worktreePath: repository,
    createdAt: new Date().toISOString(),
    locale: "en",
    agents: [],
    logs: [],
    draft: { title: "Improve the greeting", body: "A friendlier greeting for new users." },
    reviewedFiles: [],
    reviewedFingerprints: {},
  };
  store.data.runs.push(run);
  await writeFile(path.join(repository, "hello.ts"), 'export const hello = "after";\n');
  await workbench.review(run.id, "hello.ts", true, (await readDiff(run))[0].fingerprint);
  await assert.rejects(
    withLocale("en", () => workbench.approve(run.id, { ...run.draft })),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "git_identity_missing");
      assert.match(error.message, /Git does not know your name and e-mail address/);
      assert.deepEqual(
        error.fixes?.map((fix) => fix.command),
        ['git config --global user.name "Your Name"', 'git config --global user.email "you@example.com"'],
      );
      return true;
    },
  );
  assert.equal(run.status, "review");
  assert.equal(run.approvedFingerprint, undefined);

  // The repository's own settings count: with them the run is approved.
  await git(repository, ["config", "user.name", "BELL Test"]);
  await git(repository, ["config", "user.email", "test@example.invalid"]);
  await workbench.approve(run.id, { ...run.draft });
  assert.equal(run.status, "approved");
  // Removed again before publishing: refused before anything is pushed.
  await git(repository, ["config", "--unset", "user.email"]);
  await assert.rejects(workbench.publish(run.id, run.approvedFingerprint!), {
    code: "git_identity_missing",
  });
  assert.notEqual(run.publishing, true);
  assert.equal(run.status, "approved");
  assert.deepEqual(await calls(), []);
});

test("publishing workflow changes needs the workflow scope when the token reports scopes", async (t) => {
  const f = await temporary(t);
  const repository = path.join(f.directory, "repo");
  const baseSha = await gitRepository(repository);
  await git(repository, ["config", "user.name", "BELL Test"]);
  await git(repository, ["config", "user.email", "test@example.invalid"]);
  const calls = await standIns(f, {
    gh: `case "$1 $2" in
  "auth token") echo gho_faketoken ;;
  "api --include") printf 'HTTP/2.0 200 OK\\r\\nX-Oauth-Scopes: repo, read:org\\r\\n\\r\\noctocat\\n583231\\n' ;;
  *) exit 97 ;;
esac`,
  });
  const store = new Store(path.join(f.directory, "data"));
  await store.initialize();
  const workbench = new Workbench(store);
  f.defer(() => workbench.shutdown());
  store.data.repos.push({
    id: "6c6c6c6c-6c6c-46c6-86c6-6c6c6c6c6c6c",
    name: "example",
    owner: "test-owner",
    fullName: "test-owner/example",
    path: repository,
    defaultBranch: "main",
    url: "https://github.com/test-owner/example",
  });
  const run: Run = {
    id: "workflow-run",
    repoId: "6c6c6c6c-6c6c-46c6-86c6-6c6c6c6c6c6c",
    title: "CI",
    prompt,
    status: "review",
    branch: "main",
    baseBranch: "main",
    baseSha,
    worktreePath: repository,
    createdAt: new Date().toISOString(),
    locale: "en",
    agents: [],
    logs: [],
    draft: { title: "Run the tests on pull requests", body: "Adds a CI workflow for the tests." },
    reviewedFiles: [],
    reviewedFingerprints: {},
  };
  store.data.runs.push(run);
  await mkdir(path.join(repository, ".github", "workflows"), { recursive: true });
  await writeFile(path.join(repository, ".github", "workflows", "ci.yml"), "on: pull_request\n");
  await git(repository, ["add", "--intent-to-add", "--", ".github/workflows/ci.yml"]);
  for (const file of await readDiff(run))
    await workbench.review(run.id, file.path, true, file.fingerprint);
  await workbench.approve(run.id, { ...run.draft });
  await assert.rejects(
    withLocale("en", () =>
      workbench.publish(run.id, run.approvedFingerprint!, ["workflows", "author-email"]),
    ),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "gh_workflow_scope");
      assert.deepEqual(error.fixes?.map((fix) => fix.command), [
        "gh auth refresh -h github.com -s workflow",
      ]);
      return true;
    },
  );
  assert.notEqual(run.publishing, true);
  // Only the token check ran: nothing was pushed or created.
  assert.deepEqual(
    (await calls()).map((line) => line.split(" ").slice(0, 3).join(" ")),
    ["gh auth token", "gh api --include"],
  );
});

/** A valid project analysis of the greeting repository. */
const analysisAnswer = {
  summary: "A small command-line greeting tool.",
  purpose: "It prints a greeting.",
  audience: ["Developers who want a greeting"],
  userJourney: ["Run the tool and read the greeting"],
  modules: [{ path: "hello.ts", purpose: "Exports the greeting text." }],
  readingPath: [
    { path: "hello.ts", why: "It holds the greeting.", lookFor: "The exported constant." },
  ],
  howItFitsTogether: "The command prints the constant that hello.ts exports.",
  evidence: [{ path: "README.md", note: "Describes the tool." }],
  recommendations: [],
};

test("a project or all data is not deleted while its analysis runs, and the analysis writes no cache for a deleted project", async (t) => {
  const f = await temporary(t);
  const { store, workbench, repo } = await workbenchWithProject(f);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const execute: typeof command = async (_executable, args, options = {}) => {
    if (args[0] === "exec") {
      await gate;
      options.onLine?.(
        JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: JSON.stringify(analysisAnswer) },
        }),
        "stdout",
      );
    }
    return { stdout: "", stderr: "", code: 0 };
  };
  const insights = new ProjectInsightsService(store, {
    command: execute,
    getModelCatalog: async () => ({ models: [], source: "codex" }),
    defaultProvider: async () => undefined,
  });
  f.defer(() => insights.shutdown());
  const analysis = withLocale("en", () => insights.generate(repo.id));
  analysis.catch(() => undefined);
  await waitUntil(() => analysisRunning(store, repo.id), "the analysis");
  assert.equal(analysisRunning(store), true);
  await assert.rejects(withLocale("en", () => workbench.removeRepository(repo.id)), {
    statusCode: 409,
    message: "This project is being analyzed. Wait until the analysis finishes, then delete the project.",
  });
  await assert.rejects(workbench.eraseAll("ERASE"), { statusCode: 409 });
  // A wrong confirmation is still the first answer.
  await assert.rejects(workbench.eraseAll("yes"), { statusCode: 400 });
  assert.equal(store.data.repos.length, 1);

  // Had the project gone meanwhile, the finished analysis writes nothing.
  const [removed] = store.data.repos.splice(0, 1);
  release();
  await assert.rejects(analysis, { statusCode: 404 });
  assert.equal(analysisRunning(store), false);
  const cached = await readdir(path.join(store.directory, "insights")).catch(() => [] as string[]);
  assert.deepEqual(cached.filter((name) => name.endsWith(".json")), []);
  store.data.repos.push(removed);
  assert.deepEqual(await workbench.removeRepository(repo.id), { removed: repo.id });
});

test("erasing all data waits for a discovery search and makes discovery forget its job", async (t) => {
  const f = await temporary(t);
  const { store, workbench } = await workbenchWithProject(f);
  let release!: () => void;
  let gate = new Promise<void>((resolve) => (release = resolve));
  const discovery = new DiscoveryService(store, {
    preflight: async () => undefined,
    collectCandidates: async () => {
      await gate;
      return { candidates: [], warnings: [] };
    },
  });
  f.defer(() => discovery.shutdown());
  await discovery.start({});
  await assert.rejects(workbench.eraseAll("ERASE"), { statusCode: 409 });
  release();
  await waitUntil(() => !discovery.running, "the search");
  assert.equal((await discovery.get()).job?.status, "ready");
  assert.ok(existsSync(path.join(store.directory, "discovery.json")));
  gate = Promise.resolve();
  await workbench.eraseAll("ERASE");
  assert.deepEqual(await discovery.get(), { job: null });
  assert.equal(existsSync(path.join(store.directory, "discovery.json")), false);
});

test("discovery refuses before creating a job when the doctor found gh or the provider not ready", async (t) => {
  const f = await temporary(t);
  const bin = path.join(f.directory, "only-bin");
  await mkdir(bin);
  for (const [name, body] of Object.entries(claudeOnly))
    await writeFile(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o700 });
  const previous = process.env.PATH;
  f.defer(() => {
    process.env.PATH = previous;
  });
  const store = new Store(path.join(f.directory, "data"));
  await store.initialize();
  const collected: unknown[] = [];
  const discovery = new DiscoveryService(store, {
    collectCandidates: async (preferences) => {
      collected.push(preferences);
      return { candidates: [], warnings: [] };
    },
  });
  f.defer(() => discovery.shutdown());
  process.env.PATH = bin;
  // Before the doctor ran for this data directory nothing is probed here.
  await discovery.start({});
  await waitUntil(() => collected.length === 1, "the first search");
  await waitUntil(() => !discovery.running, "the first search to end");
  await runDoctor({ dataDir: store.directory, force: true });
  await assert.rejects(
    withLocale("en", () => discovery.start({})),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "gh_missing");
      assert.equal(error.statusCode, 503);
      return true;
    },
  );
  // The last result stays as it was; no job was created.
  assert.equal(collected.length, 1);
  assert.equal((await discovery.get()).job?.status, "ready");
  await writeFile(
    path.join(bin, "gh"),
    `#!/bin/sh\ncase "$1" in\n  --version) echo "gh version 2.46.0" ;;\n  auth) exit 1 ;;\n  *) exit 1 ;;\nesac\n`,
    { mode: 0o700 },
  );
  await runDoctor({ dataDir: store.directory, force: true });
  await assert.rejects(discovery.start({}), { code: "gh_unauthenticated" });
  await writeFile(
    path.join(bin, "gh"),
    `#!/bin/sh\ncase "$1" in\n  --version) echo "gh version 2.46.0" ;;\n  auth) echo gho_faketoken ;;\n  api) printf 'octocat\\n1\\n' ;;\n  *) exit 1 ;;\nesac\n`,
    { mode: 0o700 },
  );
  await runDoctor({ dataDir: store.directory, force: true });
  // Codex is the provider when none is chosen; Claude Code is chosen here.
  await assert.rejects(discovery.start({}), { code: "codex_missing" });
  await discovery.start({ provider: "claude" });
  await waitUntil(() => collected.length === 2, "the second search");
});
