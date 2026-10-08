import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  agentCommand,
  agentEventReader,
  agentLoginCheck,
  applyReportedModel,
  type AgentEvent,
} from "./agent-cli.js";
import type { ModelExecution } from "../shared/models.js";
import { agentEnvironment } from "./process.js";

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
  assert.deepEqual(
    read({
      type: "item.completed",
      item: { type: "command_execution", exit_code: 1 },
    }),
    [{ kind: "command", outcome: "exit 1" }],
  );
  assert.deepEqual(
    read({ type: "item.completed", item: { type: "file_change" } }),
    [{ kind: "file-change" }],
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
        ],
      },
    }),
    [{ kind: "message", text: "Running tests." }],
  );
  assert.deepEqual(
    read({
      type: "user",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "bash-1", is_error: true },
          { type: "tool_result", tool_use_id: "write-1" },
          { type: "tool_result", tool_use_id: "read-1", content: "secret" },
        ],
      },
    }),
    [{ kind: "command", outcome: "失敗" }, { kind: "file-change" }],
  );
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
  assert.match(
    message,
    new RegExp(
      `預計 ${new Date(1791439800 * 1000).toLocaleString("zh-TW", { hour12: false })} 重置）。$`,
    ),
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
