// The Antigravity provider (agy): its command, the permission settings of
// each access level, the customizations it would load, its events, models,
// sign-in errors and environment. Events are trimmed from agy 1.5.0 output.
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { activeProvider, presentedModelSettings, setCodexEnabledForTests } from "../shared/codex-switch.js";
import { agentCommand, agentEventReader, agentLoginCheck, type AgentAccess } from "./agent-cli.js";
import { agentTimeoutMs } from "./agent-timeouts.js";
import { canaryHit } from "./by-hand-canary.js";
import { withCliSetupHint } from "./cli-errors.js";
import { trackEfficiency } from "./efficiency.js";
import { withLocale } from "./i18n/index.js";
import {
  parseAntigravityModels,
  readAntigravityModelCatalog,
  resolveModelExecution,
  splitAntigravityModel,
} from "./models.js";
import { agentEnvironment, agentProviderOf } from "./process.js";
import {
  antigravityWorkspaceConfig,
  setAllowUnsandboxedAgentsSource,
  setKernelSettingsRootForTests,
} from "./sandbox.js";
import { AppError } from "./types.js";

const antigravity = { provider: "antigravity", source: "cli-default" } as const;
const execFileAsync = promisify(execFile);

async function folder(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-antigravity-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

/** A checkout: a folder with its own .git directory. */
async function checkout(t: TestContext) {
  const directory = await folder(t);
  await mkdir(path.join(directory, ".git"));
  return directory;
}

/** Kernel settings as agy reads them; `restricted` is Ubuntu's default since 24.04. */
async function kernel(t: TestContext, restricted: boolean) {
  const root = await folder(t);
  await mkdir(path.join(root, "kernel"));
  await writeFile(
    path.join(root, "kernel", "apparmor_restrict_unprivileged_userns"),
    restricted ? "1\n" : "0\n",
  );
  setKernelSettingsRootForTests(root);
  t.after(() => setKernelSettingsRootForTests());
}

function allowUnsandboxed(t: TestContext, value: boolean) {
  setAllowUnsandboxedAgentsSource(() => value);
  t.after(() => setAllowUnsandboxedAgentsSource());
}

/** The parsed --settings value of an agy command. */
const settingsOf = (args: string[]) =>
  JSON.parse(args[args.indexOf("--settings") + 1]) as {
    toolPermission: string;
    enableTerminalSandbox: boolean;
    allowNonWorkspaceAccess: boolean;
    permissions: { allow: string[]; ask: string[]; deny: string[] };
  };

const command = (cwd: string, access: AgentAccess, more: { web?: boolean; full?: boolean } = {}) =>
  agentCommand(antigravity, { cwd, access, ...more });

test("an Antigravity read turn denies writes, commands, MCP, the browser and pages, and sends its prompt on stdin", async (t) => {
  const cwd = await checkout(t);
  const cli = await command(cwd, "read");
  assert.equal(cli.executable, "agy");
  for (const flag of ["--disable-slash-commands", "--settings"]) assert.ok(cli.args.includes(flag), flag);
  assert.deepEqual(cli.args.slice(0, 4), ["--input-format", "stream-json", "--output-format", "stream-json"]);
  assert.equal(cli.args[cli.args.indexOf("--mode") + 1], "accept-edits");
  for (const flag of ["--sandbox", "--dangerously-skip-permissions", "--model", "-p"])
    assert.ok(!cli.args.includes(flag), flag);
  assert.equal(cli.unsandboxed, undefined);
  const settings = settingsOf(cli.args);
  assert.equal(settings.toolPermission, "request-review");
  assert.equal(settings.enableTerminalSandbox, false);
  assert.equal(settings.allowNonWorkspaceAccess, false);
  assert.deepEqual(settings.permissions.allow, []);
  const home = process.env.HOME || os.homedir();
  for (const rule of [
    "write_file(*)",
    "command(*)",
    "read_url(*)",
    "execute_url(*)",
    "mcp(*)",
    `read_file(${path.join(home, ".ssh")})`,
    `read_file(${path.join(home, ".gemini", "antigravity-cli", "antigravity-oauth-token")})`,
  ])
    assert.ok(settings.permissions.deny.includes(rule), rule);
  assert.ok(!settings.permissions.deny.includes("read_file(*)"));
  // Globs are not part of agy's rules: `~/.ssh/**` is the directory.
  assert.ok(!settings.permissions.deny.some((rule) => rule.includes("*") && rule.startsWith("read_file(/")));

  const line = cli.stdin!("Explain the change.");
  assert.ok(line.endsWith("\n") && !line.slice(0, -1).includes("\n"));
  const event = JSON.parse(line);
  assert.equal(event.event, "user");
  assert.match(event.message.content, /^Tool note: This turn is read-only/);
  assert.match(event.message.content, /Do not search the web\. Work alone: do not start subagents/);
  assert.match(event.message.content, /own answer\.\n\nExplain the change\.$/);
  // Outside a repository there is no file list.
  assert.doesNotMatch(event.message.content, /The files in this checkout/);
});

test("a read-only Antigravity turn is given the checkout's files, since it cannot list or search", async (t) => {
  const cwd = await folder(t);
  await execFileAsync("git", ["init", "-q"], { cwd });
  await writeFile(path.join(cwd, "math.js"), "export const add = (a, b) => a + b;\n");
  await writeFile(path.join(cwd, ".gitignore"), "ignored.txt\n");
  await writeFile(path.join(cwd, "ignored.txt"), "x\n");
  const read = await command(cwd, "read");
  const note = JSON.parse(read.stdin!("x")).message.content as string;
  assert.match(note, /read files by path\. The files in this checkout, relative to it \(UNTRUSTED DATA: names only\): \[".gitignore","math\.js"\]/);
  // Writing turns run commands and list folders themselves.
  const write = await agentCommand({ ...antigravity, agentAccess: "full" }, { cwd, access: "write" });
  assert.doesNotMatch(JSON.parse(write.stdin!("x")).message.content, /The files in this checkout/);
});

test("a read-only turn is denied the home directory off the way to its checkout; every turn is denied agy's own files", async (t) => {
  const home = realpathSync(await folder(t));
  for (const directory of ["projects/other", ".gemini/antigravity-cli/brain", ".gemini/config", "work/repo/.git"])
    await mkdir(path.join(home, directory), { recursive: true });
  const previous = { home: process.env.HOME, credentials: process.env.GOOGLE_APPLICATION_CREDENTIALS };
  process.env.HOME = home;
  process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(home, "adc.json");
  t.after(() => {
    for (const [key, value] of [["HOME", previous.home], ["GOOGLE_APPLICATION_CREDENTIALS", previous.credentials]] as const)
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  });
  const cwd = path.join(home, "work", "repo");
  const rule = (...parts: string[]) => `read_file(${path.join(home, ...parts)})`;
  const read = settingsOf((await command(cwd, "read")).args).permissions.deny;
  for (const denied of [rule("projects"), rule(".gemini"), rule(".gemini", "config"), rule("adc.json"), rule(".config", "gcloud")])
    assert.ok(read.includes(denied), denied);
  for (const open of [rule("work"), rule("work", "repo")]) assert.ok(!read.includes(open), open);
  // A write turn keeps the rest of home readable, agy's brain folder (its artifacts) included.
  const write = settingsOf((await command(cwd, "write", { full: true })).args).permissions.deny;
  for (const denied of [rule(".gemini", "config"), rule(".gemini", "antigravity-cli", "conversations"), rule("adc.json")])
    assert.ok(write.includes(denied), denied);
  for (const open of [rule("projects"), rule(".gemini"), rule(".gemini", "antigravity-cli", "brain")])
    assert.ok(!write.includes(open), open);
});

test("web access allows GitHub's pages and drops the search note; a model and a schema are passed on", async (t) => {
  const cwd = await checkout(t);
  const schema = path.join(cwd, "schema.json");
  await writeFile(schema, '{"type":"object"}');
  const cli = await agentCommand(
    { ...antigravity, model: "gemini-4-argon-high", source: "selected" },
    { cwd, access: "read", web: true, outputSchema: schema },
  );
  const settings = settingsOf(cli.args);
  assert.deepEqual(settings.permissions.allow, [
    "read_url(github.com)",
    "read_url(docs.github.com)",
    "read_url(raw.githubusercontent.com)",
  ]);
  assert.ok(!settings.permissions.deny.includes("read_url(*)"));
  assert.equal(cli.args[cli.args.indexOf("--model") + 1], "gemini-4-argon-high");
  assert.equal(cli.args[cli.args.indexOf("--json-schema") + 1], '{"type":"object"}');
  assert.doesNotMatch(JSON.parse(cli.stdin!("x")).message.content, /Do not search the web/);
});

test("analysis and discovery turns also deny reading, and never get web access", async (t) => {
  const cwd = await folder(t);
  const cli = await command(cwd, "none", { web: true });
  const settings = settingsOf(cli.args);
  for (const rule of ["read_file(*)", "write_file(*)", "command(*)", "read_url(*)"])
    assert.ok(settings.permissions.deny.includes(rule), rule);
  assert.deepEqual(settings.permissions.allow, []);
  assert.match(JSON.parse(cli.stdin!("x")).message.content, /^Tool note: Answer from this prompt alone/);
});

test("a write turn runs in agy's sandbox when the kernel allows it, and is refused otherwise", { skip: process.platform !== "linux" }, async (t) => {
  const cwd = await checkout(t);
  allowUnsandboxed(t, false);
  await kernel(t, false);
  const sandboxed = await command(cwd, "write");
  assert.ok(sandboxed.args.includes("--sandbox"));
  assert.equal(sandboxed.unsandboxed, undefined);
  const settings = settingsOf(sandboxed.args);
  assert.equal(settings.toolPermission, "proceed-in-sandbox");
  assert.equal(settings.enableTerminalSandbox, true);
  assert.ok(!settings.permissions.allow.includes("command(*)"));
  for (const rule of [
    "command(git push)",
    "command(gh)",
    "command(curl)",
    "command(wget)",
    `write_file(${path.join(cwd, ".git")})`,
    `write_file(${path.join(cwd, ".git", "hooks")})`,
  ])
    assert.ok(settings.permissions.deny.includes(rule), rule);
  assert.ok(!settings.permissions.deny.includes("command(*)"));
  assert.ok(!settings.permissions.deny.includes("write_file(*)"));

  await kernel(t, true);
  await assert.rejects(command(cwd, "write"), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, "antigravity_sandbox_unavailable");
    assert.equal(error.statusCode, 503);
    // Switching to Claude Code may meet the same Ubuntu setting, so it is not offered.
    assert.ok(!error.fixes?.some((fix) => fix.command === "claude auth login"));
    return true;
  });
  // Read-only turns run no commands, so they need no sandbox.
  await command(cwd, "read");
});

test("an unsandboxed write turn the person allowed gets every command but keeps the denials; full access lifts them", { skip: process.platform !== "linux" }, async (t) => {
  const cwd = await checkout(t);
  await kernel(t, true);
  allowUnsandboxed(t, true);
  const unsandboxed = await command(cwd, "write");
  assert.equal(unsandboxed.unsandboxed, true);
  assert.ok(!unsandboxed.args.includes("--sandbox"));
  const settings = settingsOf(unsandboxed.args);
  assert.equal(settings.toolPermission, "request-review");
  assert.deepEqual(settings.permissions.allow, ["command(*)"]);
  assert.ok(settings.permissions.deny.includes("command(git push)"));

  const full = await command(cwd, "write", { full: true });
  assert.equal(full.unsandboxed, true);
  assert.ok(full.args.includes("--dangerously-skip-permissions"));
  const fullSettings = settingsOf(full.args);
  assert.ok(!fullSettings.permissions.deny.includes("command(git push)"));
  assert.ok(!fullSettings.permissions.deny.some((rule) => rule.startsWith("write_file(")));
  for (const rule of ["mcp(*)", "execute_url(*)", "read_url(*)"])
    assert.ok(fullSettings.permissions.deny.includes(rule), rule);
  assert.ok(fullSettings.permissions.deny.some((rule) => rule.endsWith(`${path.sep}.ssh)`)));
  // The tool note says what this turn really may not do: with Full access, curl, wget, gh and push are allowed.
  const note = (cli: { stdin?: (prompt: string) => string }) => JSON.parse(cli.stdin!("x")).message.content as string;
  assert.match(note(unsandboxed), /^Tool note: Pushing, the GitHub CLI, curl and wget, reading credential files/);
  assert.match(note(full), /^Tool note: Reading credential files, web pages, the browser and MCP tools are denied\./);
  assert.doesNotMatch(note(full), /curl|wget|GitHub CLI|Pushing/);
});

test("Antigravity does not start where it would load a project's hooks, MCP servers, plugins, agents or skills", async (t) => {
  const repository = await checkout(t);
  const sub = path.join(repository, "packages", "app");
  await mkdir(path.join(sub, ".agents"), { recursive: true });
  // Rules are instructions agy loads anyway; they do not stop it.
  await mkdir(path.join(repository, ".agents", "rules"), { recursive: true });
  assert.deepEqual(antigravityWorkspaceConfig(sub), []);
  await writeFile(path.join(sub, ".agents", "hooks.json"), "{}");
  await mkdir(path.join(repository, "_agent", "skills"), { recursive: true });
  assert.deepEqual(antigravityWorkspaceConfig(sub), [
    path.join(".agents", "hooks.json"),
    path.join("..", "..", "_agent", "skills"),
  ]);
  await assert.rejects(command(sub, "read"), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, "antigravity_workspace_config");
    assert.equal(error.statusCode, 422);
    assert.match(error.message, /hooks\.json/);
    return true;
  });
  // Above the repository root nothing is looked at.
  const outer = await folder(t);
  await mkdir(path.join(outer, ".agents"));
  await writeFile(path.join(outer, ".agents", "mcp_config.json"), "{}");
  const inner = path.join(outer, "repository");
  await mkdir(path.join(inner, ".git"), { recursive: true });
  assert.deepEqual(antigravityWorkspaceConfig(inner), []);
  // Without a repository, only the working folder itself.
  const loose = path.join(outer, "loose");
  await mkdir(loose);
  assert.deepEqual(antigravityWorkspaceConfig(loose), []);
});

/** The events of one agy 1.5.0 turn, with the details BELL does not read left out. */
const turn = [
  { event: "init", conversation_id: "c", init: { model: "gemini-3.8-flash-medium", cwd: "/w", tools: ["run_command"], permission_mode: "request-review" } },
  { event: "step_update", step_update: { conversation_id: "c", step_index: 0, state: "DONE", step_type: "user_input" } },
  { event: "step_update", step_update: { conversation_id: "c", step_index: 1, state: "DONE", step_type: "agent_response", text_delta: "Running the checks." } },
  { event: "step_update", step_update: { conversation_id: "c", step_index: 2, state: "ACTIVE", step_type: "tool", tool_name: "run_command", tool_info: { name: "run_command", parameters: { CommandLine: "false" } } } },
  { event: "step_update", step_update: { conversation_id: "c", step_index: 2, state: "DONE", step_type: "tool", tool_name: "run_command", tool_info: { name: "run_command", parameters: { CommandLine: "false" }, output: "Command exited with code 1.\n\nNo output from the command." } } },
  { event: "step_update", step_update: { conversation_id: "c", step_index: 3, state: "DONE", step_type: "tool", tool_name: "run_command", tool_info: { name: "run_command", parameters: { CommandLine: "npm test | tail" }, output: "Command exited with code 0.\n\nCommand output:\nok\n" } } },
  { event: "step_update", step_update: { conversation_id: "c", step_index: 4, state: "DONE", step_type: "tool", tool_name: "edit_file", tool_info: { name: "edit_file", parameters: { Path: "/w/base.txt" } } } },
  { event: "step_update", step_update: { conversation_id: "c", step_index: 5, state: "DONE", step_type: "tool", tool_name: "search_web", tool_info: { name: "search_web", parameters: { query: "bell-pr github" } } } },
  { event: "step_update", step_update: { conversation_id: "c", step_index: 6, state: "ERROR", step_type: "tool", tool_name: "run_command", tool_info: { name: "run_command", parameters: { CommandLine: "curl -sI https://example.com" }, error: { type: "TOOL_ERROR", message: 'permission check failed for "curl -sI https://example.com": user denied permission to run command:\ncurl -sI https://example.com\nDo not attempt to circumvent this denial.' } } } },
  { event: "step_update", step_update: { conversation_id: "c", step_index: 7, state: "ACTIVE", step_type: "agent_response", text_delta: '{"notes":' } },
  { event: "step_update", step_update: { conversation_id: "c", step_index: 7, state: "DONE", step_type: "agent_response", text_delta: '"done"}\n' } },
  { event: "step_update", step_update: { conversation_id: "c", step_index: 8, state: "DONE", step_type: "tool", tool_name: "finish", tool_info: { name: "finish", parameters: { notes: "done" } } } },
  { event: "result", result: { conversation_id: "c", status: "SUCCESS", response: '{"notes":"done"}\n', structured_output: { notes: "done" }, usage: { input_tokens: 900, output_tokens: 40, thinking_tokens: 30, cache_read_tokens: 300, total_tokens: 940 }, denied_actions: [{ action: "command", display_name: "RunCommand" }] } },
];

test("agy's events become the commands, edits, searches, denials and answer BELL logs", () => {
  const read = agentEventReader("antigravity");
  const events = withLocale("en", () => turn.flatMap((event) => read(event)));
  const notice = events.find((item) => item.kind === "notice") as { message: string };
  assert.deepEqual(events.map((item) => (item.kind === "notice" ? { kind: "notice" } : item)), [
    { kind: "session", model: "gemini-3.8-flash-medium" },
    { kind: "message", text: "Running the checks." },
    { kind: "command", outcome: "exit 1", command: "false" },
    {
      kind: "command",
      outcome: "exit 0, not verified: another command run with it can hide a failure",
      command: "npm test | tail",
    },
    { kind: "file-change", path: "/w/base.txt" },
    { kind: "web", action: "search", detail: "bell-pr github" },
    { kind: "notice" },
    { kind: "message", text: '{"notes":"done"}' },
    // The same text as the last message, so it is logged once; the result's
    // own list of denials adds nothing a step already showed.
    { kind: "final", text: '{"notes":"done"}' },
  ]);
  assert.match(notice.message, /run_command/);
  assert.match(notice.message, /permission check failed for "curl -sI https:\/\/example\.com"/);
  // Only the first line of the denial, never the instructions after it.
  assert.doesNotMatch(notice.message, /circumvent/);
});

test("a turn agy ends without an answer after a denial, or with an error status, fails", () => {
  const denied = agentEventReader("antigravity");
  const ended = withLocale("en", () =>
    denied({ event: "result", result: { status: "SUCCESS", response: "", denied_actions: [{ action: "read_file", display_name: "ReadFile" }] } }),
  );
  assert.deepEqual(ended.map((item) => item.kind), ["notice", "error"]);
  assert.deepEqual(ended[1], {
    kind: "error",
    terminal: true,
    message: "Antigravity refused an action this turn may not take and then ended the turn without an answer.",
  });
  const failed = agentEventReader("antigravity")({
    event: "result",
    result: { status: "ERROR", response: "", error: "authentication failed or timed out" },
  });
  assert.deepEqual(failed, [{ kind: "error", terminal: true, message: "authentication failed or timed out" }]);
  // Text written before a denial is not the answer.
  const preamble = agentEventReader("antigravity");
  preamble({ event: "step_update", step_update: { step_index: 1, state: "DONE", step_type: "agent_response", text_delta: "I'll check the PR with gh first." } });
  const after = withLocale("en", () =>
    preamble({ event: "result", result: { status: "SUCCESS", response: "", denied_actions: [{ action: "command" }] } }),
  );
  assert.deepEqual(after.map((item) => item.kind), ["notice", "error"]);
  // Without a final answer or a denial, the last text is the answer.
  const plain = agentEventReader("antigravity");
  assert.deepEqual(
    plain({ event: "step_update", step_update: { step_index: 1, state: "DONE", step_type: "agent_response", text_delta: "All good.\n" } }),
    [{ kind: "message", text: "All good." }],
  );
  assert.deepEqual(plain({ event: "result", result: { status: "SUCCESS", response: "" } }), []);
  // A null structured output is no answer of its own.
  assert.deepEqual(
    agentEventReader("antigravity")({ event: "result", result: { status: "SUCCESS", response: "Done!", structured_output: null } }),
    [{ kind: "final", text: "Done!" }],
  );
  // A structured answer the text did not repeat is the CLI's own.
  const structured = agentEventReader("antigravity");
  structured({ event: "step_update", step_update: { step_index: 1, state: "DONE", step_type: "agent_response", text_delta: "Here it is." } });
  assert.deepEqual(
    structured({ event: "result", result: { status: "SUCCESS", response: '{ "notes": "x" }', structured_output: { notes: "x" } } }),
    [{ kind: "final", text: '{"notes":"x"}' }],
  );
});

test("agy's reported usage is measured with cached input inside input", () => {
  const call = trackEfficiency("lite");
  call.observe(turn.at(-1));
  const metrics = call.finish(true);
  assert.deepEqual(
    { input: metrics.inputTokens, cached: metrics.cachedInputTokens, output: metrics.outputTokens, measured: metrics.measuredCalls },
    { input: 900, cached: 300, output: 40, measured: 1 },
  );
});

test("agy models gives the catalog: each model once, its thinking levels as efforts, no default model", async () => {
  // As agy 1.5.0 printed it, trimmed.
  const output = [
    "Fetching available models...",
    "gemini-4-argon-medium\tGemini 4 Argon (Medium)",
    "gemini-4-argon-high\tGemini 4 Argon (High)",
    "gemini-4-argon-low\tGemini 4 Argon (Low)",
    "claude-sonnet-5-5-low\tClaude Sonnet 5.5 (Low)",
    "claude-sonnet-5-5-high\tClaude Sonnet 5.5 (High)",
    "gpt-oss-120b-medium\tGPT-OSS 120B (Medium)",
    "custom-model\tCustom model",
    "not a model line",
    "",
  ].join("\n");
  const models = withLocale("en", () => parseAntigravityModels(output));
  assert.deepEqual(
    models.map(({ id, name, isDefault, reasoningEfforts, defaultReasoningEffort }) => ({ id, name, isDefault, reasoningEfforts, defaultReasoningEffort })),
    [
      { id: "gemini-4-argon", name: "Gemini 4 Argon", isDefault: false, reasoningEfforts: ["low", "medium", "high"], defaultReasoningEffort: "medium" },
      { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", isDefault: false, reasoningEfforts: ["low", "high"], defaultReasoningEffort: "low" },
      { id: "gpt-oss-120b", name: "GPT-OSS 120B", isDefault: false, reasoningEfforts: ["medium"], defaultReasoningEffort: "medium" },
      { id: "custom-model", name: "Custom model", isDefault: false, reasoningEfforts: [], defaultReasoningEffort: undefined },
    ],
  );
  // A level of a model that agy also lists without one stays a model of its own.
  assert.deepEqual(
    parseAntigravityModels("m\tM\nm-high\tM (High)\n").map(({ id, reasoningEfforts }) => ({ id, reasoningEfforts })),
    [{ id: "m", reasoningEfforts: [] }, { id: "m-high", reasoningEfforts: [] }],
  );
  assert.throws(() => parseAntigravityModels("a\tA\na\tA again\n"));

  const calls: string[][] = [];
  const catalog = await readAntigravityModelCatalog((async (executable: string, args: string[]) => {
    calls.push([executable, ...args]);
    return { stdout: output, stderr: "", code: 0 };
  }) as never);
  assert.deepEqual(calls, [["agy", "models"]]);
  assert.equal(catalog.source, "antigravity");
  assert.equal(catalog.models.length, 4);
  assert.equal(catalog.error, undefined);
  const signedOut = await withLocale("en", () =>
    readAntigravityModelCatalog((async () => {
      throw new AppError("agy failed", 422);
    }) as never),
  );
  assert.deepEqual(signedOut.models, []);
  assert.match(signedOut.error!, /Antigravity model list/);
  // Listing models signs in over the network (about 6 seconds), so the check gets 20.
  assert.deepEqual(agentLoginCheck("antigravity"), { executable: "agy", args: ["models"], timeoutMs: 20_000 });
});

test("a model and effort go to agy as the ID it listed; an ID saved with its level reads as model and effort", async (t) => {
  const catalog = withLocale("en", () => ({
    source: "antigravity" as const,
    models: parseAntigravityModels("gemini-4-argon-low\tGemini 4 Argon (Low)\ngemini-4-argon-high\tGemini 4 Argon (High)\n"),
  }));
  const chosen = resolveModelExecution({ provider: "antigravity", model: "gemini-4-argon", reasoningEffort: "high" }, catalog);
  assert.deepEqual(
    { model: chosen.model, reasoningEffort: chosen.reasoningEffort, source: chosen.source },
    { model: "gemini-4-argon", reasoningEffort: "high", source: "selected" },
  );
  const cli = await agentCommand(chosen, { cwd: await checkout(t), access: "read" });
  assert.equal(cli.args[cli.args.indexOf("--model") + 1], "gemini-4-argon-high");
  assert.ok(!cli.args.includes("--effort"));
  // Without a chosen effort, the model's default applies: low here, as there is no medium.
  assert.equal(resolveModelExecution({ provider: "antigravity", model: "gemini-4-argon" }, catalog).reasoningEffort, "low");
  // 1.1.0-beta.1 saved the whole ID; it is the same choice now.
  const saved = resolveModelExecution({ provider: "antigravity", model: "gemini-4-argon-high" }, catalog);
  assert.deepEqual({ model: saved.model, reasoningEffort: saved.reasoningEffort }, { model: "gemini-4-argon", reasoningEffort: "high" });
  assert.deepEqual(splitAntigravityModel({ provider: "antigravity", model: "gemini-4-argon-high" }), {
    provider: "antigravity",
    model: "gemini-4-argon",
    reasoningEffort: "high",
  });
  // A level the catalog does not list for the model is not invented.
  assert.throws(() => resolveModelExecution({ provider: "antigravity", model: "gemini-4-argon-medium" }, catalog));
  // Other providers' choices are left alone.
  assert.deepEqual(splitAntigravityModel({ provider: "claude", model: "opus-high" }), { provider: "claude", model: "opus-high" });
});

test("agy failures get Antigravity's setup codes and fixes", () => {
  const signedOut = withCliSetupHint(
    new AppError("agy failed", 422, { details: { stderr: "Error: authentication required. Run 'agy' to log in, then retry.\n" } }),
    "/home/me/.local/bin/agy",
  );
  assert.ok(signedOut instanceof AppError);
  assert.equal(signedOut.code, "antigravity_unauthenticated");
  assert.deepEqual(signedOut.fixes?.map((fix) => fix.command), ["agy"]);
  const missing = withCliSetupHint(
    new AppError("agy failed", 503, { cause: Object.assign(new Error("spawn agy ENOENT"), { code: "ENOENT" }) }),
    "agy",
  );
  assert.ok(missing instanceof AppError);
  assert.equal(missing.code, "antigravity_missing");
  assert.ok(missing.fixes?.some((fix) => fix.command === "agy"));
});

test("Antigravity gets only its own keys, and the Codex switch leaves it alone", async (t) => {
  const keys = ["GEMINI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GH_TOKEN"] as const;
  const previous = keys.map((key) => [key, process.env[key]] as const);
  for (const key of keys) process.env[key] = `${key}-value`;
  t.after(() => {
    for (const [key, value] of previous)
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  });
  const env = agentEnvironment("antigravity");
  assert.equal(env.GEMINI_API_KEY, "GEMINI_API_KEY-value");
  for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GH_TOKEN"]) assert.equal(env[key], undefined, key);
  assert.equal(agentEnvironment().GEMINI_API_KEY, "GEMINI_API_KEY-value");
  assert.equal(agentProviderOf("/usr/local/bin/agy"), "antigravity");

  setCodexEnabledForTests(false);
  t.after(() => setCodexEnabledForTests(true));
  assert.equal(activeProvider("antigravity"), "antigravity");
  assert.equal(activeProvider(undefined), "claude");
  assert.deepEqual(presentedModelSettings({ provider: "antigravity", model: "gemini-4-argon-low" }), {
    provider: "antigravity",
    model: "gemini-4-argon-low",
  });
  await command(await checkout(t), "read");
});

test("Antigravity turns wait as long as Claude Code's, and a command in a read turn is a Learn-by-hand write", () => {
  assert.equal(agentTimeoutMs("write", { provider: "antigravity" }), 1800 * 2.5 * 1000);
  assert.equal(canaryHit({ kind: "command", outcome: "exit 0" }, "antigravity"), true);
  assert.equal(canaryHit({ kind: "command", outcome: "exit 0" }, "codex"), false);
});
