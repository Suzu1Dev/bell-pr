import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  agentCommand,
  agentEventReader,
  agentLoginCheck,
  applyReportedModel,
  retryTransientAuth,
  type AgentEvent,
} from "./agent-cli.js";
import type { ModelExecution } from "../shared/models.js";
import { formatters } from "../shared/i18n/locale.js";
import { agentEnvironment } from "./process.js";
import { AppError } from "./types.js";
import { withLocale } from "./i18n/index.js";

/** Han characters and CJK punctuation; the Latin middle dot is not one. */
const cjk = /(?!\u00B7)[\p{Script_Extensions=Han}\u3000-\u303F\uFF00-\uFFEF]/u;

test("Codex arguments keep the existing sandbox, approval and schema flags", async () => {
  assert.deepEqual(
    (
      await agentCommand(
        { model: "codex-example", source: "selected" },
        { cwd: "/work/tree", access: "write" },
      )
    ).args,
    [
      "exec",
      "--ignore-user-config",
      "--ephemeral",
      "--model",
      "codex-example",
      "--sandbox",
      "workspace-write",
      "-c",
      'approval_policy="never"',
      "--json",
      "--color",
      "never",
      "-C",
      "/work/tree",
      "-",
    ],
  );
  const readOnly = await agentCommand(
    { source: "cli-default" },
    {
      cwd: "/tmp/analysis",
      access: "none",
      outputSchema: "/tmp/analysis/schema.json",
      skipGitRepoCheck: true,
    },
  );
  assert.equal(readOnly.executable, "codex");
  assert.equal(
    readOnly.args[readOnly.args.indexOf("--sandbox") + 1],
    "read-only",
  );
  assert.ok(readOnly.args.includes("--skip-git-repo-check"));
  assert.equal(
    readOnly.args[readOnly.args.indexOf("--output-schema") + 1],
    "/tmp/analysis/schema.json",
  );
  assert.deepEqual(agentLoginCheck(), {
    executable: "codex",
    args: ["login", "status"],
  });
});

test("Claude Code arguments map access levels, inline the schema and keep MCP connectors out", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-agent-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const schemaPath = path.join(directory, "schema.json");
  const schema = '{"type":"object","required":["answer"]}';
  await writeFile(schemaPath, schema);
  const value = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

  const none = await agentCommand(
    {
      provider: "claude",
      model: "sonnet",
      reasoningEffort: "high",
      source: "selected",
    },
    { cwd: directory, access: "none", outputSchema: schemaPath },
  );
  assert.equal(none.executable, "claude");
  assert.deepEqual(none.args.slice(0, 4), [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
  ]);
  assert.ok(none.args.includes("--no-session-persistence"));
  assert.ok(none.args.includes("--strict-mcp-config"));
  assert.equal(value(none.args, "--setting-sources"), "user");
  assert.ok(!none.args.includes("--disallowedTools"));
  assert.equal(value(none.args, "--model"), "sonnet");
  assert.equal(value(none.args, "--effort"), "high");
  assert.equal(value(none.args, "--tools"), "");
  assert.equal(value(none.args, "--permission-mode"), "dontAsk");
  assert.equal(value(none.args, "--json-schema"), schema);
  assert.ok(!none.args.includes("--bare"), "--bare would ignore the subscription login");

  const read = await agentCommand(
    { provider: "claude", source: "cli-default" },
    { cwd: directory, access: "read" },
  );
  assert.ok(!read.args.includes("--model"));
  assert.ok(!read.args.includes("--effort"));
  assert.equal(value(read.args, "--tools"), "Read,Grep,Glob");
  assert.equal(value(read.args, "--permission-mode"), "dontAsk");
  assert.equal(value(read.args, "--setting-sources"), "user");
  assert.ok(!read.args.includes("--disallowedTools"));

  const write = await agentCommand(
    { provider: "claude", source: "cli-default" },
    { cwd: directory, access: "write" },
  );
  assert.equal(value(write.args, "--tools"), "Read,Grep,Glob,Edit,Write,Bash");
  assert.equal(value(write.args, "--allowedTools"), "Read Grep Glob Bash");
  assert.equal(value(write.args, "--permission-mode"), "acceptEdits");
  assert.equal(value(write.args, "--setting-sources"), "user");
  const denied = write.args.indexOf("--disallowedTools");
  assert.deepEqual(write.args.slice(denied + 1, denied + 5), [
    "Bash(git push:*)",
    "Bash(gh:*)",
    "Bash(curl:*)",
    "Bash(wget:*)",
  ]);

  await assert.rejects(
    agentCommand(
      { provider: "claude", model: "--dangerously", source: "selected" },
      { cwd: directory, access: "none" },
    ),
  );
  assert.deepEqual(agentLoginCheck("claude"), {
    executable: "claude",
    args: ["auth", "status"],
  });
});

test("teammates combine write access with an output schema on both providers", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-agent-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const schemaPath = path.join(directory, "report-schema.json");
  const schema = '{"type":"object","required":["report","messages"]}';
  await writeFile(schemaPath, schema);
  const value = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

  const codex = await agentCommand(
    { source: "cli-default" },
    { cwd: directory, access: "write", outputSchema: schemaPath },
  );
  assert.equal(value(codex.args, "--sandbox"), "workspace-write");
  assert.equal(value(codex.args, "--output-schema"), schemaPath);
  assert.ok(!codex.args.includes("--skip-git-repo-check"));

  const claude = await agentCommand(
    { provider: "claude", source: "cli-default" },
    { cwd: directory, access: "write", outputSchema: schemaPath },
  );
  assert.equal(value(claude.args, "--permission-mode"), "acceptEdits");
  assert.equal(value(claude.args, "--json-schema"), schema);
  assert.ok(claude.args.includes("--disallowedTools"));
});

test("web access adds Claude Code's WebSearch/WebFetch and Codex live search for read and write access only", async () => {
  const value = (args: string[], flag: string) => args[args.indexOf(flag) + 1];
  const claude = { provider: "claude" as const, source: "cli-default" as const };
  const codex = { source: "cli-default" as const };
  for (const access of ["read", "write"] as const) {
    // Verified with Claude Code 2.1.292: the init event then lists WebFetch and WebSearch among the tools.
    const on = await agentCommand(claude, { cwd: "/work/tree", access, web: true });
    const tools =
      access === "read" ? "Read,Grep,Glob" : "Read,Grep,Glob,Edit,Write,Bash";
    const allowed = access === "read" ? "Read Grep Glob" : "Read Grep Glob Bash";
    assert.equal(value(on.args, "--tools"), `${tools},WebSearch,WebFetch`);
    assert.equal(value(on.args, "--allowedTools"), `${allowed} WebSearch WebFetch`);
    assert.ok(on.args.includes("--strict-mcp-config"));
    assert.equal(value(on.args, "--setting-sources"), "user");
    const off = await agentCommand(claude, { cwd: "/work/tree", access, web: false });
    assert.equal(value(off.args, "--tools"), tools);
    assert.equal(value(off.args, "--allowedTools"), allowed);
    assert.deepEqual(await agentCommand(claude, { cwd: "/work/tree", access }), off);
    // Codex 0.159 `exec` rejects --search; the live search config override is the only addition.
    const codexOn = await agentCommand(codex, { cwd: "/work/tree", access, web: true });
    const codexOff = await agentCommand(codex, { cwd: "/work/tree", access });
    const index = codexOn.args.indexOf('web_search="live"');
    assert.ok(index > 0 && codexOn.args[index - 1] === "-c");
    assert.deepEqual(
      codexOn.args.filter((_arg, position) => position !== index - 1 && position !== index),
      codexOff.args,
    );
    assert.ok(!codexOn.args.includes("--search"));
    assert.doesNotMatch(JSON.stringify(codexOff.args), /web_search/);
  }
  // curl and wget stay denied with web on: WebFetch is the sanctioned way to read a page.
  const write = await agentCommand(claude, { cwd: "/work/tree", access: "write", web: true });
  const denied = write.args.indexOf("--disallowedTools");
  assert.deepEqual(write.args.slice(denied + 1, denied + 5), [
    "Bash(git push:*)",
    "Bash(gh:*)",
    "Bash(curl:*)",
    "Bash(wget:*)",
  ]);
  assert.equal(value(write.args, "--permission-mode"), "acceptEdits");
  // Analysis and discovery use "none": the flag never reaches the CLI there.
  for (const execution of [claude, codex]) {
    const none = await agentCommand(execution, { cwd: "/work/tree", access: "none", web: true });
    assert.deepEqual(none, await agentCommand(execution, { cwd: "/work/tree", access: "none" }));
    assert.doesNotMatch(JSON.stringify(none.args), /WebSearch|WebFetch|web_search/);
  }
});

test("web tool use becomes a web event with the query or URL only, on both providers", () => {
  const claude = agentEventReader("claude");
  // Observed with Claude Code 2.1.292 (haiku, read access + web): tool_use inputs carry query / url.
  assert.deepEqual(
    claude({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Searching." },
          {
            type: "tool_use",
            id: "search-1",
            name: "WebSearch",
            input: { query: "Node.js LTS stable version nodejs.org", mode: "standard" },
          },
          {
            type: "tool_use",
            id: "fetch-1",
            name: "WebFetch",
            input: {
              url: "https://nodejs.org/?token=ghp_0123456789abcdef0123",
              prompt: "What is the current LTS major version?",
            },
          },
          { type: "tool_use", id: "search-2", name: "WebSearch", input: {} },
        ],
      },
    }),
    [
      { kind: "message", text: "Searching." },
      { kind: "web", action: "search", detail: "Node.js LTS stable version nodejs.org" },
      { kind: "web", action: "fetch", detail: "https://nodejs.org/?token=[REDACTED]" },
    ],
  );
  // The tool_result holds page content: it is never returned.
  assert.deepEqual(
    claude({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "search-1",
            content: "Web search results for query: SECRET-PAGE",
          },
          { type: "tool_result", tool_use_id: "fetch-1", content: "PAGE CONTENT" },
        ],
      },
    }),
    [],
  );
  const long = claude({
    type: "assistant",
    message: {
      content: [
        { type: "tool_use", id: "search-3", name: "WebSearch", input: { query: "q".repeat(500) } },
      ],
    },
  })[0] as { detail: string };
  assert.equal(long.detail.length, 200);

  const codex = agentEventReader("codex");
  // Observed with Codex 0.159: the started item has an empty query; the completed one carries it in
  // item.query and action.query (documented as action.queries); results are never returned.
  assert.deepEqual(
    codex({
      type: "item.started",
      item: { id: "exec-1", type: "web_search", query: "", action: { type: "other" } },
    }),
    [],
  );
  assert.deepEqual(
    codex({
      type: "item.completed",
      item: {
        id: "exec-1",
        type: "web_search",
        query: "site:nodejs.org current latest LTS Node.js download",
        action: { type: "search", query: "site:nodejs.org current latest LTS Node.js download" },
        results: [{ type: "text_result", domain: "nodejs.org", snippet: "SECRET-SNIPPET" }],
      },
    }),
    [
      {
        kind: "web",
        action: "search",
        detail: "site:nodejs.org current latest LTS Node.js download",
      },
    ],
  );
  assert.deepEqual(
    codex({
      type: "item.completed",
      item: {
        type: "web_search",
        query: "",
        action: { type: "search", queries: ["node lts", "", "node release schedule"] },
      },
    }),
    [{ kind: "web", action: "search", detail: "node lts / node release schedule" }],
  );
  assert.deepEqual(
    codex({
      type: "item.completed",
      item: { type: "web_search", query: "", action: { type: "other" } },
    }),
    [],
  );
});

test("agent environment never forwards an Anthropic API key", (t) => {
  const previous = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  t.after(() => {
    if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previous;
  });
  assert.equal(agentEnvironment().ANTHROPIC_API_KEY, undefined);
});

test("Codex events keep their existing meaning", () => {
  const read = agentEventReader("codex");
  assert.deepEqual(
    read({
      type: "item.completed",
      item: { type: "agent_message", text: "report" },
    }),
    [{ kind: "message", text: "report" }],
  );
  // Without a command string the event keeps its old shape.
  assert.deepEqual(
    read({
      type: "item.completed",
      item: { type: "command_execution", exit_code: 1 },
    }),
    [{ kind: "command", outcome: "exit 1" }],
  );
  // The command is kept (first line, redacted, ≤300 chars); aggregated_output never is.
  const executed = read({
    type: "item.completed",
    item: {
      type: "command_execution",
      command: `export GITHUB_TOKEN=ghp_0123456789abcdef0123 && npm test -- a.test.ts\nrm -rf /tmp/${"x".repeat(400)}`,
      aggregated_output: "SECRET-OUTPUT",
      exit_code: 0,
    },
  });
  assert.deepEqual(executed, [
    {
      kind: "command",
      outcome: "exit 0",
      command: "export GITHUB_TOKEN=[REDACTED] && npm test -- a.test.ts",
    },
  ]);
  assert.doesNotMatch(JSON.stringify(executed), /SECRET-OUTPUT|ghp_0123/);
  assert.equal(
    (
      read({
        type: "item.completed",
        item: {
          type: "command_execution",
          command: "y".repeat(500),
          exit_code: 0,
        },
      })[0] as { command: string }
    ).command.length,
    300,
  );
  assert.deepEqual(
    read({ type: "item.completed", item: { type: "file_change" } }),
    [{ kind: "file-change" }],
  );
  assert.deepEqual(
    read({
      type: "item.completed",
      item: {
        type: "file_change",
        changes: [
          { path: "src/a.ts", kind: "update" },
          { path: "docs/b.md", kind: "add" },
          { kind: "delete" },
        ],
      },
    }),
    [
      { kind: "file-change", path: "src/a.ts" },
      { kind: "file-change", path: "docs/b.md" },
    ],
  );
  assert.deepEqual(read({ type: "turn.failed", error: { message: "boom" } }), [
    { kind: "error", terminal: true, message: "boom" },
  ]);
  assert.deepEqual(read({ type: "error", message: "retrying" }), [
    { kind: "error", terminal: false, message: "retrying" },
  ]);
  assert.deepEqual(read(null), []);
});

test("Claude Code stream-json events map to messages, checks, edits and the final answer", () => {
  const read = agentEventReader("claude");
  // Observed with Claude Code 2.1.292: system/init carries the resolved model and claude_code_version.
  assert.deepEqual(
    read({
      type: "system",
      subtype: "init",
      model: "claude-haiku-4-5-20251001",
      claude_code_version: "2.1.292",
      permissionMode: "dontAsk",
    }),
    [
      {
        kind: "session",
        model: "claude-haiku-4-5-20251001",
        cliVersion: "2.1.292",
      },
    ],
  );
  assert.deepEqual(
    read({ type: "system", subtype: "init", model: "bad model id" }),
    [],
  );
  assert.deepEqual(read({ type: "system", subtype: "hook_started" }), []);
  assert.deepEqual(
    read({
      type: "assistant",
      message: {
        content: [
          { type: "thinking", thinking: "" },
          { type: "text", text: "Running tests." },
          { type: "tool_use", id: "bash-1", name: "Bash", input: {} },
          { type: "tool_use", id: "write-1", name: "Write", input: {} },
          { type: "tool_use", id: "read-1", name: "Read", input: {} },
          {
            type: "tool_use",
            id: "bash-2",
            name: "Bash",
            input: {
              command: "npm test -- --token sk-abcdefghijklmnop0123\ncat out.log",
              description: "Run tests",
            },
          },
          {
            type: "tool_use",
            id: "edit-1",
            name: "Edit",
            input: { file_path: "/work/tree/src/a.ts", old_string: "secret" },
          },
        ],
      },
    }),
    [{ kind: "message", text: "Running tests." }],
  );
  // Tool inputs are recalled when their results arrive; missing inputs keep the old shape and result content is never returned.
  const results = read({
    type: "user",
    message: {
      content: [
        { type: "tool_result", tool_use_id: "bash-1", is_error: true },
        { type: "tool_result", tool_use_id: "write-1" },
        { type: "tool_result", tool_use_id: "read-1", content: "secret" },
        {
          type: "tool_result",
          tool_use_id: "bash-2",
          content: "TEST OUTPUT",
        },
        { type: "tool_result", tool_use_id: "edit-1" },
      ],
    },
  });
  assert.deepEqual(results, [
    { kind: "command", outcome: "失敗" },
    { kind: "file-change" },
    {
      kind: "command",
      outcome: "成功",
      command: "npm test -- --token [REDACTED]",
    },
    { kind: "file-change", path: "/work/tree/src/a.ts" },
  ]);
  assert.doesNotMatch(JSON.stringify(results), /TEST OUTPUT|secret|cat out/);
  assert.deepEqual(
    read({
      type: "result",
      subtype: "success",
      is_error: false,
      result: '{"answer":"pong"}',
      structured_output: { answer: "pong" },
    }),
    [{ kind: "final", text: '{"answer":"pong"}' }],
  );
  assert.deepEqual(
    read({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "plain report",
    }),
    [{ kind: "final", text: "plain report" }],
  );
  assert.deepEqual(
    read({
      type: "result",
      subtype: "success",
      is_error: true,
      result: "Claude usage limit reached",
    }),
    [{ kind: "error", terminal: true, message: "Claude usage limit reached" }],
  );
  assert.deepEqual(
    read({ type: "result", subtype: "error_max_turns", is_error: true }),
    [
      {
        kind: "error",
        terminal: true,
        message: "Claude Code 工作回合失敗（error_max_turns）。",
      },
    ],
  );
});

test("Claude Code result.modelUsage keys become a usage-by-model event before the final answer", () => {
  const read = agentEventReader("claude");
  // Observed shape: modelUsage is keyed by the resolved model ID; costUSD is never surfaced.
  assert.deepEqual(
    read({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "done",
      modelUsage: {
        "claude-haiku-4-5-20251001": { inputTokens: 9, costUSD: 0.015 },
        "claude-sonnet-4-5": { inputTokens: 1 },
        "not a model id": { inputTokens: 1 },
      },
    }),
    [
      {
        kind: "usage-by-model",
        models: ["claude-haiku-4-5-20251001", "claude-sonnet-4-5"],
      },
      { kind: "final", text: "done" },
    ],
  );
  assert.deepEqual(
    read({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "done",
      modelUsage: {},
    }),
    [{ kind: "final", text: "done" }],
  );
  assert.deepEqual(
    read({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "done",
      modelUsage: "junk",
    }),
    [{ kind: "final", text: "done" }],
  );
});

test("Claude Code retries, rate limits and denied tools are notices, never errors", () => {
  const read = agentEventReader("claude");
  assert.deepEqual(
    read({
      type: "system",
      subtype: "api_retry",
      attempt: 2,
      max_retries: 10,
      retry_delay_ms: 4000,
      error_status: 429,
      error: "rate_limit",
    }),
    [
      {
        kind: "notice",
        message: "Claude Code 重試中（第 2/10 次，原因 rate_limit，4 秒後重試）。",
      },
    ],
  );
  assert.deepEqual(read({ type: "system", subtype: "api_retry" }), [
    { kind: "notice", message: "Claude Code 重試中。" },
  ]);

  // A normal run reports status "allowed" on every call; only warnings and rejections are shown.
  assert.deepEqual(
    read({
      type: "rate_limit_event",
      rate_limit_info: {
        status: "allowed",
        resetsAt: 1791439800,
        rateLimitType: "five_hour",
      },
    }),
    [],
  );
  const rejected = read({
    type: "rate_limit_event",
    rate_limit_info: {
      status: "rejected",
      resetsAt: 1791439800,
      rateLimitType: "five_hour",
      utilization: 1,
    },
  });
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].kind, "notice");
  const message = rejected[0].kind === "notice" ? rejected[0].message : "";
  assert.match(message, /^Claude 額度已達上限，等待重置中（5 小時滾動視窗/);
  assert.match(message, /已用 100%/);
  // The reset time is formatted for the locale, never with a hard-coded tag.
  assert.ok(
    message.endsWith(
      `預計 ${formatters("zh-TW").dateTime(1791439800 * 1000)} 重置）。`,
    ),
    message,
  );
  assert.deepEqual(
    read({
      type: "rate_limit_event",
      rate_limit_info: { status: "allowed_warning", rateLimitType: "unknown_window" },
    }),
    [{ kind: "notice", message: "Claude 額度接近上限（unknown_window）。" }],
  );
  assert.deepEqual(read({ type: "rate_limit_event" }), []);
  assert.deepEqual(
    read({ type: "rate_limit_event", rate_limit_info: { resetsAt: "soon" } }),
    [],
  );

  assert.deepEqual(
    read({
      type: "system",
      subtype: "permission_denied",
      tool_name: "Bash",
      tool_use_id: "bash-9",
      decision_reason: "Bash(git push:*) 被 --disallowedTools 拒絕",
      tool_input: { command: "git push" },
      message: "Permission to use Bash has been denied",
    }),
    [
      {
        kind: "notice",
        message: "工具 Bash 被權限設定拒絕：Bash(git push:*) 被 --disallowedTools 拒絕",
      },
    ],
  );
  assert.deepEqual(
    read({ type: "system", subtype: "permission_denied", message: "x" }),
    [],
  );

  // Successful turns still list denials; the final answer must survive them.
  assert.deepEqual(
    read({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "report",
      permission_denials: [
        {
          tool_name: "Bash",
          tool_use_id: "bash-1",
          tool_input: { command: "curl https://example.com" },
        },
        { tool_use_id: "bash-2" },
      ],
    }),
    [
      { kind: "notice", message: "工具 Bash 被權限設定拒絕。" },
      { kind: "final", text: "report" },
    ],
  );
  for (const item of read({
    type: "system",
    subtype: "api_retry",
    attempt: 1,
  }))
    assert.notEqual(item.kind, "error");
});

test("reported model is recorded once per model and modelsUsed is a union", () => {
  const execution: ModelExecution = {
    provider: "claude",
    model: "haiku",
    source: "selected",
  };
  const session: AgentEvent = {
    kind: "session",
    model: "claude-haiku-4-5-20251001",
    cliVersion: "2.1.292",
  };
  // Usage before a session event has nowhere to go and is ignored.
  assert.equal(
    applyReportedModel(execution, { kind: "usage-by-model", models: ["x-1"] }),
    false,
  );
  assert.equal(execution.reported, undefined);
  assert.equal(applyReportedModel(execution, session), true);
  assert.equal(applyReportedModel(execution, session), false);
  assert.equal(
    applyReportedModel(execution, {
      kind: "usage-by-model",
      models: ["claude-haiku-4-5-20251001"],
    }),
    false,
  );
  applyReportedModel(execution, {
    kind: "usage-by-model",
    models: ["claude-sonnet-4-5", "claude-haiku-4-5-20251001"],
  });
  assert.deepEqual(execution.reported, {
    model: "claude-haiku-4-5-20251001",
    cliVersion: "2.1.292",
    modelsUsed: ["claude-haiku-4-5-20251001", "claude-sonnet-4-5"],
  });
  assert.equal(
    applyReportedModel(execution, { kind: "message", text: "hi" }),
    false,
  );
});

const refreshRace =
  "Failed to refresh OAuth token: another Claude Code process is refreshing it or exited mid-refresh. This is usually transient; retry in a minute, and if it persists close other Claude Code processes or sign in again";

test("losing the Claude Code OAuth refresh lock is a retryable terminal error; other API errors are not", () => {
  const read = agentEventReader("claude");
  // Claude Code sends the same text as an assistant message first; it stays an ordinary message.
  assert.deepEqual(
    read({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: refreshRace }],
      },
      error: "server_error",
      is_api_error_message: true,
      session_id: "03489f4f-4a7d-4154-b21e-f1ceb6da7c59",
    }),
    [{ kind: "message", text: refreshRace }],
  );
  assert.deepEqual(
    read({
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
      permission_denials: [],
      total_cost_usd: 0,
    }),
    [{ kind: "error", terminal: true, message: refreshRace, retryable: true }],
  );
  assert.deepEqual(
    read({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      terminal_reason: "api_error",
      errors: [refreshRace],
    }),
    [{ kind: "error", terminal: true, message: refreshRace, retryable: true }],
  );
  assert.deepEqual(
    read({
      type: "result",
      subtype: "success",
      is_error: true,
      terminal_reason: "api_error",
      result: "API Error: 500 Internal server error",
    }),
    [
      {
        kind: "error",
        terminal: true,
        message: "API Error: 500 Internal server error",
      },
    ],
  );
});

test("retryTransientAuth reruns a retryable attempt up to twice with the production backoff and stops on abort", async () => {
  const waits: number[] = [];
  const notices: string[] = [];
  let attempts = 0;
  const controller = new AbortController();
  const sleep = async (ms: number) => {
    waits.push(ms);
  };
  assert.deepEqual(
    await retryTransientAuth(
      async () => ({ retryable: ++attempts < 3, attempt: attempts }),
      { signal: controller.signal, sleep, onRetry: (n) => notices.push(n) },
    ),
    { retryable: false, attempt: 3 },
  );
  assert.deepEqual(waits, [15_000, 45_000]);
  assert.deepEqual(notices, [
    "Claude Code 正在更新登入憑證（其他行程持有更新鎖），15 秒後重試（第 2/3 次）。",
    "Claude Code 正在更新登入憑證（其他行程持有更新鎖），45 秒後重試（第 3/3 次）。",
  ]);
  // A third retryable result is returned as is; the caller turns it into the final failure.
  attempts = 0;
  waits.length = 0;
  assert.deepEqual(
    await retryTransientAuth(
      async () => ({ retryable: true, attempt: ++attempts }),
      { signal: controller.signal, sleep },
    ),
    { retryable: true, attempt: 3 },
  );
  assert.deepEqual(waits, [15_000, 45_000]);
  assert.deepEqual(
    await retryTransientAuth(async () => ({ retryable: false, attempt: 1 }), {
      signal: controller.signal,
      sleep,
    }),
    { retryable: false, attempt: 1 },
  );
  assert.deepEqual(waits, [15_000, 45_000]);
  // Cancelling during the wait rejects with the run cancellation and never starts the next attempt.
  attempts = 0;
  await assert.rejects(
    retryTransientAuth(async () => ({ retryable: true, attempt: ++attempts }), {
      signal: controller.signal,
      sleep: async () => {
        controller.abort();
      },
    }),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 409 &&
      error.message === "工作已取消。",
  );
  assert.equal(attempts, 1);
  // The real wait honours the signal as well.
  const aborted = new AbortController();
  attempts = 0;
  const pending = retryTransientAuth(
    async () => ({ retryable: true, attempt: ++attempts }),
    { signal: aborted.signal },
  );
  await delay(5);
  aborted.abort();
  await assert.rejects(pending, /工作已取消/);
  assert.equal(attempts, 1);
});

test("agent CLI notices, outcomes and failures follow the locale in effect", async () => {
  const resetsAt = formatters("en").dateTime(1791439800 * 1000);
  const events = withLocale("en", () => {
    const read = agentEventReader("claude");
    return [
      ...read({
        type: "system",
        subtype: "api_retry",
        attempt: 2,
        max_retries: 10,
        retry_delay_ms: 4000,
        error: "rate_limit",
      }),
      ...read({ type: "system", subtype: "api_retry", retry_delay_ms: 1000 }),
      ...read({
        type: "rate_limit_event",
        rate_limit_info: {
          status: "rejected",
          resetsAt: 1791439800,
          rateLimitType: "five_hour",
          utilization: 1,
        },
      }),
      ...read({
        type: "rate_limit_event",
        rate_limit_info: { status: "allowed_warning", rateLimitType: "toString" },
      }),
      ...read({
        type: "system",
        subtype: "permission_denied",
        tool_name: "Bash",
        decision_reason: "Bash(git push:*) is in --disallowedTools",
      }),
      ...read({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "b1", name: "Bash", input: { command: "npm test" } },
            { type: "tool_use", id: "b2", name: "Bash", input: { command: "npm run lint" } },
          ],
        },
      }),
      ...read({
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "b1", is_error: true },
            { type: "tool_result", tool_use_id: "b2" },
          ],
        },
      }),
      ...read({ type: "result", subtype: "error_max_turns", is_error: true }),
      ...read({
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        errors: ["first problem", "second problem"],
      }),
      ...agentEventReader("codex")({ type: "turn.failed" }),
      ...agentEventReader("codex")({ type: "error" }),
    ];
  });
  assert.deepEqual(
    events.map((event) =>
      event.kind === "command"
        ? event.outcome
        : event.kind === "notice" || event.kind === "error"
          ? event.message
          : event.kind,
    ),
    [
      "Claude Code is retrying (attempt 2 of 10, reason: rate_limit, next try in 4 seconds).",
      "Claude Code is retrying (next try in 1 second).",
      `Claude usage limit reached; waiting for it to reset (5-hour rolling window: usage resets 5 hours after it started, 100% used, expected to reset at ${resetsAt}).`,
      // An unknown window id is shown as given, even one named like an object method.
      "Claude usage is close to its limit (toString).",
      "The permission settings denied the Bash tool: Bash(git push:*) is in --disallowedTools",
      "failed",
      "succeeded",
      "The Claude Code turn failed (error_max_turns).",
      "first problem, second problem",
      "The Codex turn failed.",
      "Codex reported an error.",
    ],
  );
  assert.doesNotMatch(JSON.stringify(events), cjk);
  // The same events read under zh-TW keep their Traditional Chinese text.
  const chinese = withLocale("zh-TW", () =>
    agentEventReader("claude")({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      errors: ["first problem", "second problem"],
    }),
  );
  assert.deepEqual(chinese, [
    { kind: "error", terminal: true, message: "first problem、second problem" },
  ]);

  const notices: string[] = [];
  const controller = new AbortController();
  let attempts = 0;
  await assert.rejects(
    withLocale("en", () =>
      retryTransientAuth(async () => ({ retryable: true, attempt: ++attempts }), {
        signal: controller.signal,
        onRetry: (notice) => notices.push(notice),
        sleep: async () => {
          controller.abort();
        },
      }),
    ),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 409 &&
      error.message === "The operation was cancelled.",
  );
  assert.deepEqual(notices, [
    "Claude Code is refreshing its sign-in while another process holds the refresh lock; next try in 15 seconds (attempt 2 of 3).",
  ]);
});
