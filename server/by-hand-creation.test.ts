// Creating a Learn-by-hand run (DESIGN v1.2 F1, F12): the mode is a field of
// POST /api/runs only, set at creation and never written by another route;
// plan approval is always on; Claude Code needs only its read sandbox; and
// `byHandFit` stores the help set fixed at the start, or refuses with 409.
// Fake codex, claude and gh come first on PATH; agent turns never start.
import test, { after, before, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { defaultContributionSettings } from "../shared/insights.js";
import type { ContributionRules } from "../shared/contribution.js";
import { createApp } from "./index.js";
import { git } from "./process.js";
import { forgetClaudeSandboxDetection } from "./sandbox.js";
import { Store } from "./store.js";
import { AppError } from "./types.js";
import type { TeamAgentRunner } from "./team.js";
import { withLocale } from "./i18n/index.js";
import { Workbench } from "./workbench.js";

const previousPath = process.env.PATH;
let fakeBin: string;

before(async () => {
  fakeBin = await mkdtemp(path.join(os.tmpdir(), "bell-by-hand-creation-bin-"));
  for (const name of ["codex", "claude", "gh"])
    await writeFile(path.join(fakeBin, name), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  process.env.PATH = `${fakeBin}${path.delimiter}${previousPath}`;
});

after(async () => {
  process.env.PATH = previousPath;
  await rm(fakeBin, { recursive: true, force: true });
});

/** Agent turns wait until the run stops, so nothing runs past creation. */
const workUntilStopped: TeamAgentRunner = (input) =>
  new Promise((_resolve, reject) => {
    if (input.signal.aborted) reject(new Error("stopped"));
    input.signal.addEventListener("abort", () => reject(new Error("stopped")), { once: true });
  });

const prompt = "Retry a GET request twice after a 503 answer.";

async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-by-hand-creation-"));
  const repository = path.join(directory, "repo");
  await mkdir(repository, { recursive: true });
  await git(repository, ["init", "-b", "main"]);
  await git(repository, ["config", "user.name", "BELL Test"]);
  await git(repository, ["config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(repository, "retry.ts"), "export const attempts = 1;\n");
  await git(repository, ["add", "--", "."]);
  await git(repository, ["commit", "-m", "initial"]);
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const workbench = new Workbench(store, workUntilStopped, {
    getModelCatalog: async (provider) => ({ models: [], source: provider ?? "codex" }),
  });
  workbench.status = async () => ({
    codex: true,
    codexAuthenticated: true,
    claude: true,
    claudeAuthenticated: true,
    github: false,
  });
  t.after(async () => {
    await workbench.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  const repo = await workbench.importRepository(repository);
  return { directory, store, workbench, repo };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function serve(t: TestContext, f: Fixture) {
  const app = createApp(f.workbench, { staticDirectory: path.join(f.directory, "missing") });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.locals.insights.shutdown();
    await app.locals.discovery.shutdown();
  });
  return (body: unknown) =>
    new Promise<{ status: number; body: Record<string, ReturnType<typeof JSON.parse>> }>((resolve, reject) => {
      const text = JSON.stringify(body);
      const req = request(
        `http://127.0.0.1:${port}/api/runs`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Host: "127.0.0.1:4311",
            "X-Bell-Locale": "en",
            "Content-Length": Buffer.byteLength(text),
          },
        },
        (response) => {
          let received = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => (received += chunk));
          response.on("end", () => resolve({ status: response.statusCode!, body: received ? JSON.parse(received) : {} }));
        },
      );
      req.on("error", reject);
      req.end(text);
    });
}

const banRules = (quote: string): ContributionRules => ({
  checkedAt: new Date().toISOString(),
  findings: [{ kind: "ban", path: "CONTRIBUTING.md", line: 3, quote, contribution: true }],
  filesRead: ["CONTRIBUTING.md"],
});

test("POST /api/runs passes learnByHand to createRun, and an older client's body makes an agent run", async (t) => {
  const f = await fixture(t);
  const post = await serve(t, f);
  const settings = { ...defaultContributionSettings, requirePlanApproval: false };
  const byHand = await post({ repoId: f.repo.id, prompt, settings, learnByHand: true });
  assert.equal(byHand.status, 202, JSON.stringify(byHand.body));
  assert.equal(byHand.body.run.learnByHand, true);
  // Plan approval is always on in Learn by hand, whatever the settings say.
  assert.equal(byHand.body.run.team.config.requirePlanApproval, true);
  assert.equal(byHand.body.run.byHand, undefined);
  // A body from a client that predates the field: an agent run, unchanged.
  const agent = await post({ repoId: f.repo.id, prompt, settings });
  assert.equal(agent.status, 202, JSON.stringify(agent.body));
  assert.equal("learnByHand" in agent.body.run, false);
  assert.equal(agent.body.run.team.config.requirePlanApproval, false);
  // false is an agent run too, and an unknown key is still dropped.
  const off = await post({ repoId: f.repo.id, prompt, settings, learnByHand: false, mode: "hand" });
  assert.equal(off.status, 202, JSON.stringify(off.body));
  assert.equal("learnByHand" in off.body.run, false);
  assert.equal(f.store.data.runs.filter((run) => run.learnByHand).length, 1);
});

test("byHandFit is accepted only with learnByHand, and is never stored as given", async (t) => {
  const f = await fixture(t);
  const post = await serve(t, f);
  const settings = defaultContributionSettings;
  for (const body of [
    { repoId: f.repo.id, prompt, settings, byHandFit: { learningIssue: false } },
    { repoId: f.repo.id, prompt, settings, learnByHand: false, byHandFit: { learningIssue: true } },
    { repoId: f.repo.id, prompt, settings, learnByHand: true, byHandFit: { learningIssue: true, kinds: ["plan"] } },
    { repoId: f.repo.id, prompt, settings, learnByHand: true, byHandFit: {} },
  ]) {
    const refused = await post(body);
    assert.equal(refused.status, 400, JSON.stringify(body));
  }
  assert.equal(f.store.data.runs.length, 0);
});

test("byHandFit on a project whose rules ban AI help is a 409, and no run is created", async (t) => {
  const f = await fixture(t);
  const post = await serve(t, f);
  // Gentoo's assistance ban: the quoted confirm can never apply (DESIGN v1.2 F12 a).
  f.repo.contributionRules = banRules(
    "It is expressly forbidden to contribute to Gentoo any content that has been created with the assistance of Natural Language Processing artificial intelligence tools.",
  );
  const refused = await post({
    repoId: f.repo.id,
    prompt,
    settings: defaultContributionSettings,
    learnByHand: true,
    byHandFit: { learningIssue: false },
  });
  assert.equal(refused.status, 409);
  assert.equal(
    refused.body.error,
    "BELL PR can't fit this run to the project's rules any more: its rule restricts AI help itself, or BELL PR can't tell what it covers. Check the rules again, or start with every kind of help.",
  );
  // A project with no AI rule has nothing to fit to.
  f.repo.contributionRules = { checkedAt: new Date().toISOString(), findings: [], filesRead: [] };
  await assert.rejects(
    withLocale("en", () =>
      f.workbench.createRun(f.repo.id, prompt, undefined, defaultContributionSettings, {
        learnByHand: true,
        byHandFit: { learningIssue: true },
      }),
    ),
    (error: AppError) =>
      error.statusCode === 409 && /the project's rules have no AI rule to fit the guide to/.test(error.message),
  );
  assert.equal(f.store.data.runs.length, 0);
  // Without byHandFit the same project gets a Learn-by-hand run with every kind of help: no lock.
  const run = await f.workbench.createRun(f.repo.id, prompt, undefined, defaultContributionSettings, { learnByHand: true });
  assert.equal(run.learnByHand, true);
  assert.equal(run.byHand?.helpLock, undefined);
});

test("with Claude Code and no usable sandbox, a Learn-by-hand run is created and an agent run still gets 503", async (t) => {
  const f = await fixture(t);
  const previousAllow = process.env.BELLPR_ALLOW_UNSANDBOXED_AGENTS;
  delete process.env.BELLPR_ALLOW_UNSANDBOXED_AGENTS;
  // Only the fake CLIs and git: no bwrap or socat, so the sandbox cannot start.
  const bin = path.join(f.directory, "bin");
  await mkdir(bin);
  for (const name of await readdir(fakeBin)) await writeFile(path.join(bin, name), await readFile(path.join(fakeBin, name)), { mode: 0o755 });
  const gitPath = (await import("node:child_process")).execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  await writeFile(path.join(bin, "git"), `#!/bin/sh\nexec ${JSON.stringify(gitPath)} "$@"\n`, { mode: 0o755 });
  process.env.PATH = bin;
  forgetClaudeSandboxDetection();
  t.after(() => {
    process.env.PATH = `${fakeBin}${path.delimiter}${previousPath}`;
    if (previousAllow !== undefined) process.env.BELLPR_ALLOW_UNSANDBOXED_AGENTS = previousAllow;
    forgetClaudeSandboxDetection();
  });
  const settings = { ...defaultContributionSettings, provider: "claude" as const };
  await assert.rejects(
    f.workbench.createRun(f.repo.id, prompt, undefined, settings),
    (error: AppError) => error.statusCode === 503 && error.code === "claude_sandbox_unavailable",
  );
  const run = await f.workbench.createRun(f.repo.id, prompt, undefined, settings, { learnByHand: true });
  assert.equal(run.learnByHand, true);
  assert.equal(run.modelExecution?.provider, "claude");
  assert.equal(f.store.data.runs.length, 1);
});

test("no route but POST /api/runs takes the mode, and none takes a help lock", async () => {
  const routes = path.join(import.meta.dirname, "routes");
  for (const name of await readdir(routes)) {
    if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
    const source = await readFile(path.join(routes, name), "utf8");
    assert.doesNotMatch(source, /helpLock/, name);
    if (name !== "runs.ts") assert.doesNotMatch(source, /learnByHand|byHandFit/, name);
  }
});
