import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { agentCommand } from "./agent-cli.js";
import {
  agentReadDenials,
  allowUnsandboxedAgents,
  detectClaudeSandbox,
  enforceAgentSandbox,
  setAgentDataDirectory,
  setAllowUnsandboxedAgentsSource,
} from "./sandbox.js";
import { runAgent } from "./run-executor.js";
import { Store } from "./store.js";
import { AppError, type Run } from "./types.js";
import { Workbench, type WorkbenchContext } from "./workbench.js";
import { withLocale } from "./i18n/index.js";

const linux = process.platform === "linux";

/** Each test's PATH before its first stand-in PATH. */
const originalPaths = new WeakMap<TestContext, string | undefined>();

/**
 * A PATH holding only the named stand-ins (and, when asked, a fake claude
 * that answers one turn), so detection sees exactly what the test wants
 * and no real CLI can start.
 */
async function stubPath(t: TestContext, tools: string[], claude = false) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-sandbox-path-"));
  for (const name of tools)
    await writeFile(path.join(directory, name), "#!/bin/sh\nexit 0\n", {
      mode: 0o755,
    });
  if (claude)
    await writeFile(
      path.join(directory, "claude"),
      `#!${process.execPath}
require('node:fs').readFileSync(0);
console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Edited.' }));
`,
      { mode: 0o755 },
    );
  // After hooks run in order, so the PATH from before the test's first stub is restored once.
  if (!originalPaths.has(t)) {
    originalPaths.set(t, process.env.PATH);
    t.after(() => {
      process.env.PATH = originalPaths.get(t);
    });
  }
  process.env.PATH = directory;
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function optIn(t: TestContext, value: boolean | undefined) {
  setAllowUnsandboxedAgentsSource(() => value);
  t.after(() => setAllowUnsandboxedAgentsSource());
}

test("Linux needs both bwrap and socat on PATH for Claude Code's sandbox", { skip: !linux }, async (t) => {
  await stubPath(t, []);
  assert.deepEqual(await detectClaudeSandbox(), {
    available: false,
    reason: "missing:bwrap,socat",
  });
  // The answer is cached per PATH, so another PATH is looked at again.
  await stubPath(t, ["bwrap"]);
  assert.deepEqual(await detectClaudeSandbox(), {
    available: false,
    reason: "missing:socat",
  });
  await stubPath(t, ["bwrap", "socat"]);
  assert.deepEqual(await detectClaudeSandbox(), { available: true });
  assert.equal(await detectClaudeSandbox(), await detectClaudeSandbox());
});

test("an installed bwrap that cannot create a sandbox, as in Docker, does not count", { skip: !linux }, async (t) => {
  const directory = await stubPath(t, ["socat"]);
  // What Docker's default profile answers to a namespace request.
  await writeFile(
    path.join(directory, "bwrap"),
    "#!/bin/sh\necho 'bwrap: No permissions to create a new namespace' >&2\nexit 1\n",
    { mode: 0o755 },
  );
  assert.deepEqual(await detectClaudeSandbox(), {
    available: false,
    reason: "unusable:bwrap",
  });
  optIn(t, false);
  await assert.rejects(
    withLocale("en", () => enforceAgentSandbox("claude", "write")),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 503 &&
      error.code === "claude_sandbox_unavailable" &&
      /installed but cannot create a sandbox/.test(error.message) &&
      error.fixes?.length === 2 &&
      error.fixes[0].command.includes("--security-opt systempaths=unconfined") &&
      error.fixes[1].command === "BELLPR_ALLOW_UNSANDBOXED_AGENTS=1 bell-pr",
  );
  // The person's opt-in now applies, as it does without bwrap.
  optIn(t, true);
  assert.deepEqual(await enforceAgentSandbox("claude", "write"), {
    sandbox: false,
    unsandboxed: true,
  });
});

test("a write-role Claude agent without the sandbox is refused with the ways to fix it", { skip: !linux }, async (t) => {
  await stubPath(t, []);
  optIn(t, undefined);
  const previous = process.env.BELLPR_ALLOW_UNSANDBOXED_AGENTS;
  delete process.env.BELLPR_ALLOW_UNSANDBOXED_AGENTS;
  t.after(() => {
    if (previous !== undefined) process.env.BELLPR_ALLOW_UNSANDBOXED_AGENTS = previous;
  });
  assert.equal(allowUnsandboxedAgents(), false);
  const refused = (error: unknown) =>
    error instanceof AppError &&
    error.statusCode === 503 &&
    error.code === "claude_sandbox_unavailable" &&
    /bubblewrap/.test(error.message) &&
    error.fixes?.length === 3 &&
    error.fixes[0].command === "sudo apt-get install bubblewrap socat" &&
    error.fixes[0].platform === "linux" &&
    error.fixes[1].command === "codex login" &&
    error.fixes[2].command === "BELLPR_ALLOW_UNSANDBOXED_AGENTS=1 bell-pr" &&
    error.fixes.every((fix) => fix.label.length > 0);
  await assert.rejects(
    withLocale("en", () => enforceAgentSandbox("claude", "write")),
    refused,
  );
  await assert.rejects(
    withLocale("en", () =>
      agentCommand(
        { provider: "claude", source: "cli-default" },
        { cwd: os.tmpdir(), access: "write" },
      ),
    ),
    refused,
  );
  // Read-only roles and Codex never need it.
  assert.deepEqual(await enforceAgentSandbox("claude", "read"), {
    sandbox: false,
    unsandboxed: false,
  });
  assert.deepEqual(await enforceAgentSandbox("claude", "none"), {
    sandbox: false,
    unsandboxed: false,
  });
  assert.deepEqual(await enforceAgentSandbox("codex", "write"), {
    sandbox: false,
    unsandboxed: false,
  });
  assert.deepEqual(await enforceAgentSandbox(undefined, "write"), {
    sandbox: false,
    unsandboxed: false,
  });
  const read = await agentCommand(
    { provider: "claude", source: "cli-default" },
    { cwd: os.tmpdir(), access: "read" },
  );
  assert.equal(read.unsandboxed, undefined);
  const codex = await agentCommand({ source: "cli-default" }, { cwd: os.tmpdir(), access: "write" });
  assert.equal(codex.unsandboxed, undefined);
});

test("with unsandboxed agents allowed, a write role runs without the sandbox and says so", { skip: !linux }, async (t) => {
  await stubPath(t, []);
  optIn(t, true);
  assert.equal(allowUnsandboxedAgents(), true);
  assert.deepEqual(await enforceAgentSandbox("claude", "write"), {
    sandbox: false,
    unsandboxed: true,
  });
  const write = await agentCommand(
    { provider: "claude", source: "cli-default" },
    { cwd: os.tmpdir(), access: "write" },
  );
  assert.equal(write.unsandboxed, true);
  const settings = JSON.parse(write.args[write.args.indexOf("--settings") + 1]);
  assert.equal(settings.sandbox, undefined);
  assert.ok(settings.permissions.deny.includes("Read(~/.ssh/**)"));
  // With the sandbox available the opt-in changes nothing.
  await stubPath(t, ["bwrap", "socat"]);
  assert.deepEqual(await enforceAgentSandbox("claude", "write"), {
    sandbox: true,
    unsandboxed: false,
  });
});

test("the opt-in comes from its source, else from BELLPR_ALLOW_UNSANDBOXED_AGENTS", (t) => {
  const previous = process.env.BELLPR_ALLOW_UNSANDBOXED_AGENTS;
  t.after(() => {
    setAllowUnsandboxedAgentsSource();
    if (previous === undefined) delete process.env.BELLPR_ALLOW_UNSANDBOXED_AGENTS;
    else process.env.BELLPR_ALLOW_UNSANDBOXED_AGENTS = previous;
  });
  delete process.env.BELLPR_ALLOW_UNSANDBOXED_AGENTS;
  setAllowUnsandboxedAgentsSource();
  assert.equal(allowUnsandboxedAgents(), false);
  process.env.BELLPR_ALLOW_UNSANDBOXED_AGENTS = "1";
  assert.equal(allowUnsandboxedAgents(), true);
  setAllowUnsandboxedAgentsSource(() => false);
  assert.equal(allowUnsandboxedAgents(), false);
  setAllowUnsandboxedAgentsSource(() => undefined);
  assert.equal(allowUnsandboxedAgents(), true);
  setAllowUnsandboxedAgentsSource(() => {
    throw new Error("unreadable settings");
  });
  assert.equal(allowUnsandboxedAgents(), true);
  process.env.BELLPR_ALLOW_UNSANDBOXED_AGENTS = "true";
  assert.equal(allowUnsandboxedAgents(), false);
});

test("a run whose Claude agent ran unsandboxed is marked once, with one notice", { skip: !linux }, async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-sandbox-run-"));
  // A fake claude on PATH, and no bwrap or socat.
  await stubPath(t, [], true);
  optIn(t, true);
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const workbench = new Workbench(store);
  try {
    const worktreePath = path.join(store.directory, "worktrees", "unsandboxed");
    await mkdir(worktreePath, { recursive: true });
    const run: Run = {
      id: "unsandboxed",
      repoId: "repo",
      title: "Edit",
      prompt: "Edit",
      status: "running",
      branch: "fix/unsandbo",
      baseBranch: "main",
      baseSha: "0".repeat(40),
      worktreePath,
      createdAt: new Date().toISOString(),
      agents: [],
      logs: [],
      draft: { title: "", body: "" },
      reviewedFiles: [],
      reviewedFingerprints: {},
      modelExecution: { source: "cli-default", provider: "claude" },
      locale: "en",
    };
    store.data.runs.push(run);
    const ctx = (workbench as unknown as { context: WorkbenchContext }).context;
    for (let turn = 0; turn < 2; turn++)
      assert.equal(
        await withLocale("en", () =>
          runAgent(ctx, run, "member", "Edit the file.", new AbortController().signal, false),
        ),
        "Edited.",
      );
    assert.equal(run.unsandboxed, true);
    const notices = run.logs.filter(
      (entry) =>
        entry.kind === "notice" &&
        entry.message ===
          "This Claude agent ran without the OS sandbox because unsandboxed agents are allowed in Settings.",
    );
    assert.equal(notices.length, 1);
  } finally {
    await workbench.shutdown();
    await store.save();
    await rm(directory, { recursive: true, force: true });
  }
});

test("agents are denied credentials and BELL's data outside their own checkout", async (t) => {
  const base = await realpath(await mkdtemp(path.join(os.tmpdir(), "bell-sandbox-data-")));
  t.after(() => rm(base, { recursive: true, force: true }));
  const data = path.join(base, "data");
  const checkout = path.join(data, "worktrees", "run-1");
  const clone = path.join(data, "repositories", "owner-project-1");
  for (const directory of [
    checkout,
    path.join(data, "worktrees", "run-2"),
    path.join(data, "team-worktrees", "run-1", "task-1"),
    path.join(clone, ".git", "worktrees", "run-1"),
    path.join(data, "repositories", "other-project-2"),
    path.join(data, "run"),
    path.join(data, "insights"),
  ])
    await mkdir(directory, { recursive: true });
  for (const file of ["state.json", "license.json", "app-settings.json", "bellpr.lock"])
    await writeFile(path.join(data, file), "{}");
  await writeFile(
    path.join(checkout, ".git"),
    `gitdir: ${path.join(clone, ".git", "worktrees", "run-1")}\n`,
  );
  setAgentDataDirectory(data);
  t.after(() => setAgentDataDirectory());

  const rules = agentReadDenials(checkout);
  const rule = (target: string) => `Read(/${target})`;
  for (const credential of [
    "Read(~/.ssh/**)",
    "Read(~/.config/gh/**)",
    "Read(~/.aws/**)",
    "Read(~/.npmrc)",
    "Read(~/.netrc)",
    "Read(~/.claude/.credentials.json)",
    "Read(~/.codex/auth.json)",
  ])
    assert.ok(rules.includes(credential), credential);
  for (const denied of [
    // One-time sign-in links, also before the folder or file exists.
    `${data}/run/**`,
    `${data}/*.json`,
    `${data}/*.lock`,
    `${data}/insights/**`,
    `${data}/state.json`,
    `${data}/license.json`,
    `${data}/team-worktrees/**`,
    `${data}/worktrees/run-2/**`,
    `${data}/repositories/other-project-2/**`,
  ])
    assert.ok(rules.includes(rule(denied)), denied);
  // The checkout itself, and the repository Git reads inside the sandbox, stay readable.
  for (const allowed of [
    `${data}/worktrees/**`,
    `${data}/worktrees/run-1`,
    `${data}/worktrees/run-1/**`,
    `${data}/repositories/**`,
    `${clone}/**`,
    `${data}/**`,
  ])
    assert.ok(!rules.includes(rule(allowed)), allowed);
  // A checkout without a worktree pointer keeps no clone readable.
  const unlinked = path.join(data, "worktrees", "run-3");
  await mkdir(unlinked);
  assert.ok(agentReadDenials(unlinked).includes(rule(`${data}/repositories/**`)));

  // Work outside the data directory (explanations, the PR draft) is denied all of it.
  const outside = await mkdtemp(path.join(os.tmpdir(), "bell-sandbox-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  assert.ok(agentReadDenials(outside).includes(rule(`${data}/**`)));
  // Without the registered directory, BELL's checkout layout still finds it.
  setAgentDataDirectory();
  assert.ok(agentReadDenials(checkout).includes(rule(`${data}/run/**`)));
});

test("the sandbox canary's fake mode checks the harness without a model call", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const run = (args: string[]) =>
    spawnSync(process.execPath, ["scripts/agent-sandbox-canary.mjs", ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env, BELLPR_CANARY_TMPDIR: os.tmpdir() },
    });
  const fake = run(["--fake"]);
  assert.equal(fake.status, 0, fake.stderr);
  const report = JSON.parse(fake.stdout);
  assert.equal(report.mode, "fake");
  assert.equal(report.passed, true);
  assert.deepEqual(
    report.results.map((result: { provider: string; role: string }) => `${result.provider}:${result.role}`),
    ["claude:teammate", "claude:followup", "claude:sync", "codex:teammate", "codex:followup", "codex:sync"],
  );
  for (const result of report.results) {
    assert.equal(result.passed, true);
    assert.equal(result.instructionsIgnored, true);
    assert.ok(Object.values(result.argv).every(Boolean), JSON.stringify(result.argv));
    assert.deepEqual(
      result.attempts.map((attempt: { id: string; outcome: string }) => [attempt.id, attempt.outcome]),
      [
        ["gh-hosts", "blocked"],
        ["network", "blocked"],
        ["env-token", "blocked"],
        ["open-link", "blocked"],
      ],
    );
  }
  assert.ok(report.results[0].argv.sandboxEnabled && report.results[0].argv.deniesSignInLinks);
  assert.ok(report.results[3].argv.ignoresRules && report.results[3].argv.ignoresProjectDocs);
  // Without the hardening flags the stand-ins behave unsandboxed, and the canary fails.
  const stripped = run(["--fake", "--fake-strip"]);
  assert.equal(stripped.status, 1, stripped.stderr);
  const failed = JSON.parse(stripped.stdout);
  assert.equal(failed.passed, false);
  assert.ok(failed.results.every((result: { passed: boolean }) => !result.passed));
  assert.ok(
    failed.results
      .filter((result: { provider: string }) => result.provider === "codex")
      .every((result: { instructionsIgnored: boolean }) => !result.instructionsIgnored),
  );
  // Never a real model call by accident: one mode must be chosen.
  assert.equal(run([]).status, 2);
});
