// Fork selection when publishing to a repository the person cannot push to.
// GitHub is a local stub: no network and no tokens.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { command, git } from "./process.js";
import { readDiff } from "./git.js";
import { Store } from "./store.js";
import { Workbench } from "./workbench.js";
import { AppError, type Run } from "./types.js";
import { withLocale } from "./i18n/index.js";
import { skipUnderstandingCheckInTests } from "./understanding.js";

const parent = "northwind-labs/lumen";
const user = "ada-example";
const org = "bright-guild";
const branch = "fix/glow";

interface Reply {
  status?: number;
  body?: unknown;
  rateLimited?: boolean;
}

interface Scenario {
  permission?: string;
  forks?: Reply;
  sameName?: Reply;
  readyAfter?: number;
  ready?: Reply;
  create?: Reply;
}

function forkNode(
  owner: string,
  name: string,
  parentOwner: string,
  permission: string,
) {
  return {
    name,
    owner: { login: owner },
    viewerPermission: permission,
    parent: { name: "lumen", owner: { login: parentOwner } },
  };
}

function forksBody(nodes: unknown[]) {
  return {
    data: {
      repository: {
        forks: { nodes, pageInfo: { hasNextPage: false } },
      },
    },
  };
}

const readyFork = {
  name: "lumen",
  full_name: `${user}/lumen`,
  owner: { login: user },
  fork: true,
  parent: { name: "lumen", owner: { login: "northwind-labs" } },
  permissions: { push: true },
};

const unrelatedRepo = {
  name: "lumen",
  full_name: `${user}/lumen`,
  owner: { login: user },
  fork: false,
};

function pushes(calls: string[][]) {
  return calls.filter((call) => call[0] === "git" && call.includes("push"));
}

function posts(calls: string[][]) {
  return calls.filter(
    (call) =>
      call[0] === "gh" &&
      call.includes("POST") &&
      call.some((arg) => arg.endsWith("/forks")),
  );
}

function assertForkQuery(calls: string[][]) {
  const call = calls.find((entry) => entry.some((arg) => arg.includes("BellForks")));
  assert.ok(call, calls.map((entry) => entry.join(" ")).join("\n"));
  assert.ok(call.some((arg) => arg.includes("ownerAffiliations")));
  assert.ok(call.includes("owner=northwind-labs"));
  assert.ok(call.includes("name=lumen"));
  assert.equal(
    calls.some((entry) => entry[0] === "gh" && entry[1] === "repo" && entry[2] === "fork"),
    false,
  );
}

function assertPushed(calls: string[][], fullName: string, head: string) {
  const found = pushes(calls);
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.ok(
    found[0].includes(`https://github.com/${fullName}.git`),
    found[0].join(" "),
  );
  assert.ok(
    found[0].some((arg) => arg.endsWith(`:refs/heads/${branch}`) && !arg.startsWith("+")),
  );
  const create = calls.find(
    (call) => call[0] === "gh" && call[1] === "pr" && call[2] === "create",
  );
  assert.ok(create);
  assert.equal(create[create.indexOf("--repo") + 1], parent);
  assert.equal(create[create.indexOf("--head") + 1], head);
}

async function publishScenario(t: TestContext, scenario: Scenario) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-fork-publish-"));
  const previousPath = process.env.PATH;
  const hidden = ["GH_TOKEN", "GITHUB_TOKEN", "GITHUB_PAT"] as const;
  const savedTokens = Object.fromEntries(hidden.map((key) => [key, process.env[key]]));
  const session: { workbench?: Workbench } = {};
  t.after(async () => {
    process.env.PATH = previousPath;
    for (const key of hidden)
      if (savedTokens[key] === undefined) delete process.env[key];
      else process.env[key] = savedTokens[key];
    await session.workbench?.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  for (const key of hidden) delete process.env[key];

  const repository = path.join(directory, "repo");
  await mkdir(repository);
  await git(repository, ["init", "-q", "-b", "main"]);
  await git(repository, ["config", "user.name", "BELL Test"]);
  await git(repository, ["config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(repository, "hello.ts"), 'export const hello = "before";\n');
  await git(repository, ["add", "--", "hello.ts"]);
  await git(repository, ["commit", "-q", "-m", "initial"]);
  await git(repository, ["checkout", "-q", "-b", branch]);
  const baseSha = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();
  await writeFile(path.join(repository, "hello.ts"), 'export const hello = "after";\n');

  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const workbench = new Workbench(store);
  session.workbench = workbench;
  const repo = await workbench.importRepository(repository);
  repo.url = `https://github.com/${parent}`;
  repo.fullName = parent;
  repo.owner = "northwind-labs";
  repo.name = "lumen";
  const run: Run = {
    id: "fork-run",
    repoId: repo.id,
    title: "Improve the greeting",
    prompt: "Improve the greeting",
    status: "review",
    branch,
    baseBranch: "main",
    baseSha,
    worktreePath: repository,
    createdAt: new Date().toISOString(),
    agents: [],
    logs: [],
    draft: {
      title: "Improve the greeting",
      body: "The greeting text was out of date.",
    },
    reviewedFiles: [],
    reviewedFingerprints: {},
  };
  store.data.runs.push(run);
  for (const file of await readDiff(run))
    await workbench.review(run.id, file.path, true, file.fingerprint);

  const realGit = (await command("which", ["git"])).stdout.trim();
  const bin = path.join(directory, "bin");
  const callsPath = path.join(directory, "calls");
  const scenarioPath = path.join(directory, "scenario.json");
  const postedPath = path.join(directory, "posted");
  const pollsPath = path.join(directory, "polls");
  await mkdir(bin);
  await writeFile(
    scenarioPath,
    JSON.stringify({
      user,
      parent,
      repoName: "lumen",
      baseSha,
      permission: scenario.permission ?? "READ",
      forks: scenario.forks ?? { status: 200, body: forksBody([]) },
      sameName: scenario.sameName ?? { status: 404 },
      readyAfter: scenario.readyAfter ?? 1,
      ready: scenario.ready ?? { status: 200, body: readyFork },
      create: scenario.create ?? { status: 200, body: {} },
    }),
  );
  await writeFile(
    path.join(bin, "git"),
    `#!/usr/bin/env node
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
if (args.includes("push") || args.includes("fetch") || args.includes("clone") || args.includes("ls-remote")) {
  fs.appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(["git", ...args]) + "\\n");
  process.exit(args.includes("push") ? 0 : 98);
}
const result = spawnSync(${JSON.stringify(realGit)}, args, { stdio: "inherit", env: process.env });
process.exit(result.status ?? 1);
`,
    { mode: 0o700 },
  );
  await writeFile(
    path.join(bin, "gh"),
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const scenario = JSON.parse(fs.readFileSync(${JSON.stringify(scenarioPath)}, "utf8"));
fs.appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(["gh", ...args]) + "\\n");
function respond(spec) {
  if (spec && spec.rateLimited) {
    console.error("gh: API rate limit exceeded for user ID 1. (HTTP 403)");
    process.exit(1);
  }
  const status = spec && spec.status ? spec.status : 200;
  if (status === 404) { console.error("gh: Not Found (HTTP 404)"); process.exit(1); }
  if (status === 403) { console.error("gh: Forbidden (HTTP 403)"); process.exit(1); }
  if (status !== 200) { console.error("gh: HTTP " + status); process.exit(1); }
  console.log(JSON.stringify(spec && spec.body !== undefined ? spec.body : {}));
  process.exit(0);
}
if (args[0] === "api" && args[1] === "user") { console.log(scenario.user); process.exit(0); }
if (args[0] === "repo" && args[1] === "view") {
  console.log(JSON.stringify({ viewerPermission: scenario.permission, defaultBranchRef: { name: "main" } }));
  process.exit(0);
}
if (args[0] === "api" && String(args[1] || "").includes("/git/ref/heads/")) {
  console.log(scenario.baseSha);
  process.exit(0);
}
if (args[0] === "pr" && args[1] === "list") { console.log("[]"); process.exit(0); }
if (args[0] === "pr" && args[1] === "create") {
  console.log("https://github.com/" + scenario.parent + "/pull/7");
  process.exit(0);
}
if (args.some((arg) => String(arg).includes("BellForks"))) respond(scenario.forks);
const method = args.includes("--method") ? args[args.indexOf("--method") + 1] : "GET";
if (method === "POST" && args.includes("repos/" + scenario.parent + "/forks")) {
  fs.writeFileSync(${JSON.stringify(postedPath)}, "1");
  respond(scenario.create);
}
if (method === "GET" && args.includes("repos/" + scenario.user + "/" + scenario.repoName)) {
  if (fs.existsSync(${JSON.stringify(postedPath)})) {
    const n = (fs.existsSync(${JSON.stringify(pollsPath)}) ? Number(fs.readFileSync(${JSON.stringify(pollsPath)}, "utf8")) : 0) + 1;
    fs.writeFileSync(${JSON.stringify(pollsPath)}, String(n));
    if (n < scenario.readyAfter) { console.error("gh: Not Found (HTTP 404)"); process.exit(1); }
    respond(scenario.ready);
  }
  respond(scenario.sameName);
}
console.error("gh: Not Found (HTTP 404)");
process.exit(1);
`,
    { mode: 0o700 },
  );
  process.env.PATH = `${bin}${path.delimiter}${previousPath}`;

  skipUnderstandingCheckInTests(true);
  let caught: unknown;
  try {
    await workbench.approve(run.id, { ...run.draft });
    try {
      await withLocale("en", () =>
        workbench.publish(run.id, run.approvedFingerprint!, ["facts-unknown"]),
      );
    } catch (error) {
      caught = error;
    }
  } finally {
    skipUnderstandingCheckInTests();
  }
  const raw = await readFile(callsPath, "utf8").catch(() => "");
  const calls = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);
  return { error: caught, calls, run };
}

const cases: [string, (t: TestContext) => Promise<void>][] = [
  [
    "keeps the upstream when the person can push",
    async (t) => {
      const result = await publishScenario(t, { permission: "WRITE" });
      assert.equal(result.error, undefined);
      assert.equal(result.run.status, "published");
      assert.equal(result.run.headRepository, parent);
      assert.equal(
        result.calls.some((call) => call.some((arg) => arg.includes("BellForks"))),
        false,
      );
      assert.equal(posts(result.calls).length, 0);
      assertPushed(result.calls, parent, `northwind-labs:${branch}`);
    },
  ],
  [
    "reuses a fork that already matches the parent",
    async (t) => {
    const result = await publishScenario(t, {
      forks: {
        body: forksBody([forkNode(user, "lumen", "northwind-labs", "ADMIN")]),
      },
    });
    assert.equal(result.error, undefined);
    assert.equal(result.run.headRepository, `${user}/lumen`);
    assertForkQuery(result.calls);
    assert.equal(posts(result.calls).length, 0);
    assertPushed(result.calls, `${user}/lumen`, `${user}:${branch}`);
    },
  ],
  [
    "creates a fork and waits until GitHub serves it",
    async (t) => {
      const result = await publishScenario(t, {
        forks: { body: forksBody([]) },
        sameName: { status: 404 },
        readyAfter: 2,
        ready: { body: readyFork },
      });
      assert.equal(result.error, undefined, result.error instanceof Error ? result.error.message : "");
      assert.equal(posts(result.calls).length, 1);
      assert.equal(result.run.headRepository, `${user}/lumen`);
      assertForkQuery(result.calls);
      const lookups = result.calls.filter((call) => call.includes(`repos/${user}/lumen`));
      assert.ok(lookups.length >= 3, String(lookups.length));
      assertPushed(result.calls, `${user}/lumen`, `${user}:${branch}`);
    },
  ],
  [
    "refuses a same-named repository that is not a fork",
    async (t) => {
      const result = await publishScenario(t, {
        forks: { body: forksBody([]) },
        sameName: { body: unrelatedRepo },
        create: { status: 403 },
      });
      assert.ok(result.error instanceof AppError);
      assert.equal(result.error.statusCode, 409);
      assert.match(result.error.message, /not a fork of the target project/);
      assert.equal(result.run.status, "approved");
      assert.equal(result.run.prUrl, undefined);
      assert.equal(result.run.headRepository, undefined);
      assertForkQuery(result.calls);
      assert.equal(posts(result.calls).length, 0);
      assert.equal(pushes(result.calls).length, 0);
    },
  ],
  [
    "refuses a fork of a different parent",
    async (t) => {
      const result = await publishScenario(t, {
        forks: { body: forksBody([]) },
        sameName: {
          body: {
            ...unrelatedRepo,
            fork: true,
            parent: { name: "lumen", owner: { login: "other-labs" } },
          },
        },
        create: { status: 403 },
      });
      assert.ok(result.error instanceof AppError);
      assert.equal(result.error.statusCode, 409);
      assert.match(result.error.message, /not a fork of the target project/);
      assert.equal(posts(result.calls).length, 0);
      assert.equal(pushes(result.calls).length, 0);
      assert.equal(
        result.calls.some((call) => call.some((arg) => arg.includes(`${user}/lumen.git`))),
        false,
      );
    },
  ],
  [
    "reuses a renamed fork and does not push to the unrelated name",
    async (t) => {
      const result = await publishScenario(t, {
        forks: {
          body: forksBody([
            forkNode(org, "lumen", "northwind-labs", "WRITE"),
            forkNode(user, "lumen-notes", "northwind-labs", "ADMIN"),
          ]),
        },
        sameName: { body: unrelatedRepo },
        create: { status: 403 },
      });
      assert.equal(result.error, undefined, result.error instanceof Error ? result.error.message : "");
      assert.equal(result.run.headRepository, `${user}/lumen-notes`);
      assertForkQuery(result.calls);
      assert.equal(posts(result.calls).length, 0);
      assertPushed(result.calls, `${user}/lumen-notes`, `${user}:${branch}`);
      assert.equal(
        pushes(result.calls).some((call) =>
          call.includes(`https://github.com/${user}/lumen.git`),
        ),
        false,
      );
    },
  ],
  [
    "reuses a fork owned by an organization the person belongs to",
    async (t) => {
      const result = await publishScenario(t, {
        forks: {
          body: forksBody([forkNode(org, "lumen", "northwind-labs", "WRITE")]),
        },
        sameName: { body: unrelatedRepo },
        create: { status: 403 },
      });
      assert.equal(result.error, undefined, result.error instanceof Error ? result.error.message : "");
      assert.equal(result.run.headRepository, `${org}/lumen`);
      assertForkQuery(result.calls);
      assert.equal(posts(result.calls).length, 0);
      assertPushed(result.calls, `${org}/lumen`, `${org}:${branch}`);
    },
  ],
];

for (const failure of [
  { name: "403", forks: { status: 403 } as Reply, pattern: /HTTP 403/ },
  { name: "404", forks: { status: 404 } as Reply, pattern: /HTTP 404/ },
  { name: "rate limit", forks: { rateLimited: true } as Reply, pattern: /rate-limited the request/ },
]) {
  cases.push([
    `stops on a fork lookup ${failure.name} and does not push`,
    async (t) => {
      const result = await publishScenario(t, {
        forks: failure.forks,
        create: { status: 403 },
      });
      assert.ok(result.error instanceof AppError, failure.name);
      assert.equal(result.error.statusCode, 502);
      assert.match(result.error.message, failure.pattern);
      assert.match(result.error.message, /Nothing was pushed/);
      assert.equal(result.run.status, "approved");
      assert.equal(result.run.prUrl, undefined);
      assert.equal(posts(result.calls).length, 0);
      assert.equal(pushes(result.calls).length, 0);
    },
  ]);
}

const caseName = process.env.BELL_FORK_CASE;
if (caseName) {
  const found = cases.find(([name]) => name === caseName);
  if (!found) throw new Error(`Unknown fork case: ${caseName}`);
  const cleanups: (() => Promise<void>)[] = [];
  const context = {
    after(fn: () => Promise<void>) {
      cleanups.push(fn);
    },
  } as unknown as TestContext;
  try {
    await found[1](context);
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup();
  }
} else {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  test("publishing chooses a fork when the person cannot push", { timeout: 180_000 }, async (t) => {
    for (const [name] of cases) {
      await t.test(name, () => {
        // Each case gets its own process so its gh/git stubs cannot change this one.
        const result = spawnSync(
          process.execPath,
          ["--import", "tsx", fileURLToPath(import.meta.url)],
          {
            cwd: root,
            encoding: "utf8",
            env: { ...process.env, BELL_FORK_CASE: name },
            timeout: 60_000,
          },
        );
        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      });
    }
  });
}
