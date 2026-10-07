import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  agentCommand,
  agentEventReader,
  agentLoginCheck,
} from "./agent-cli.js";
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

  const write = await agentCommand(
    { provider: "claude", source: "cli-default" },
    { cwd: directory, access: "write" },
  );
  assert.equal(value(write.args, "--tools"), "Read,Grep,Glob,Edit,Write,Bash");
  assert.equal(value(write.args, "--allowedTools"), "Read Grep Glob Bash");
  assert.equal(value(write.args, "--permission-mode"), "acceptEdits");

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
  assert.deepEqual(
    read({ type: "system", subtype: "init", model: "claude-sonnet-5-5" }),
    [],
  );
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
