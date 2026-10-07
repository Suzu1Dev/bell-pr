import { readFile } from "node:fs/promises";
import {
  providerLabels,
  type AgentProvider,
  type ModelExecution,
} from "../shared/models.js";
import { modelArguments, modelExecutionSchema } from "./models.js";

/** none: answer from the prompt only; read: inspect files; write: edit the working directory and run commands. */
export type AgentAccess = "none" | "read" | "write";

export interface AgentCommandOptions {
  /** Codex receives it as -C; Claude Code uses the spawned process cwd, so callers must also pass it to command(). */
  cwd: string;
  access: AgentAccess;
  /** JSON Schema file the final answer must match. */
  outputSchema?: string;
  /** Codex only: allow a working directory outside a Git repository. */
  skipGitRepoCheck?: boolean;
}

export const agentLabel = (provider: AgentProvider = "codex") =>
  providerLabels[provider];

const claudeAccess: Record<AgentAccess, string[]> = {
  none: ["--tools", "", "--permission-mode", "dontAsk"],
  read: [
    "--tools",
    "Read,Grep,Glob",
    "--allowedTools",
    "Read Grep Glob",
    "--permission-mode",
    "dontAsk",
  ],
  // acceptEdits approves file edits inside the working directory only; Bash is not sandboxed.
  // Deny rules win over allow rules: pushing, GitHub CLI and raw downloads stay with BELL's own flow.
  write: [
    "--tools",
    "Read,Grep,Glob,Edit,Write,Bash",
    "--allowedTools",
    "Read Grep Glob Bash",
    "--permission-mode",
    "acceptEdits",
    "--disallowedTools",
    "Bash(git push:*)",
    "Bash(gh:*)",
    "Bash(curl:*)",
    "Bash(wget:*)",
  ],
};

/** The prompt is always written to stdin; a shell is never used. */
export async function agentCommand(
  execution: ModelExecution,
  options: AgentCommandOptions,
): Promise<{ executable: string; args: string[] }> {
  if (execution.provider === "claude") {
    const value = modelExecutionSchema.parse(execution);
    return {
      executable: "claude",
      args: [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--no-session-persistence",
        // Keeps the user's claude.ai connectors and MCP servers away from agents reading untrusted content.
        "--strict-mcp-config",
        // -p shows no trust dialog, so the imported repository's .claude settings, hooks and memory must not load.
        "--setting-sources",
        "user",
        ...(value.model ? ["--model", value.model] : []),
        ...(value.reasoningEffort ? ["--effort", value.reasoningEffort] : []),
        ...claudeAccess[options.access],
        ...(options.outputSchema
          ? ["--json-schema", await readFile(options.outputSchema, "utf8")]
          : []),
      ],
    };
  }
  return {
    executable: "codex",
    args: [
      "exec",
      "--ignore-user-config",
      "--ephemeral",
      ...modelArguments(execution),
      "--sandbox",
      options.access === "write" ? "workspace-write" : "read-only",
      "-c",
      'approval_policy="never"',
      ...(options.skipGitRepoCheck ? ["--skip-git-repo-check"] : []),
      "--json",
      "--color",
      "never",
      ...(options.outputSchema ? ["--output-schema", options.outputSchema] : []),
      "-C",
      options.cwd,
      "-",
    ],
  };
}

/** Exits successfully only when the CLI is installed and signed in. */
export function agentLoginCheck(provider: AgentProvider = "codex") {
  return provider === "claude"
    ? { executable: "claude", args: ["auth", "status"] }
    : { executable: "codex", args: ["login", "status"] };
}

export type AgentEvent =
  /** Agent text; the last one is the answer unless a final event follows. */
  | { kind: "message"; text: string }
  /** Claude Code's terminal answer, including validated structured output. */
  | { kind: "final"; text: string }
  | { kind: "command"; outcome: string }
  | { kind: "file-change" }
  | { kind: "error"; message: string; terminal: boolean };

type Json = Record<string, any>;
const blocks = (event: Json): Json[] =>
  Array.isArray(event.message?.content)
    ? event.message.content.filter(
        (block: unknown) => !!block && typeof block === "object",
      )
    : [];

/** Maps one parsed JSONL event to the documented events BELL uses; raw tool output is never returned. */
export function agentEventReader(provider: AgentProvider = "codex") {
  const toolNames = new Map<string, string>();
  return (event: unknown): AgentEvent[] => {
    if (!event || typeof event !== "object") return [];
    const value = event as Json;
    if (provider === "codex") {
      const item = value.item;
      if (value.type === "item.completed" && item?.type === "agent_message")
        return [{ kind: "message", text: String(item.text ?? "") }];
      if (value.type === "item.completed" && item?.type === "command_execution")
        return [{ kind: "command", outcome: `exit ${item.exit_code ?? "?"}` }];
      if (value.type === "item.completed" && item?.type === "file_change")
        return [{ kind: "file-change" }];
      if (value.type === "error" || value.type === "turn.failed") {
        const terminal = value.type === "turn.failed";
        return [
          {
            kind: "error",
            terminal,
            message: String(
              value.message ??
                value.error?.message ??
                (terminal ? "Codex 工作回合失敗。" : "Codex 回報執行錯誤。"),
            ),
          },
        ];
      }
      return [];
    }
    if (value.type === "assistant") {
      const events: AgentEvent[] = [];
      for (const block of blocks(value)) {
        if (block.type === "text" && block.text)
          events.push({ kind: "message", text: String(block.text) });
        if (block.type === "tool_use" && typeof block.id === "string")
          toolNames.set(block.id, String(block.name));
      }
      return events;
    }
    if (value.type === "user") {
      const events: AgentEvent[] = [];
      for (const block of blocks(value)) {
        if (block.type !== "tool_result") continue;
        const name = toolNames.get(block.tool_use_id);
        if (name === "Bash")
          events.push({
            kind: "command",
            outcome: block.is_error ? "失敗" : "成功",
          });
        else if ((name === "Edit" || name === "Write") && !block.is_error)
          events.push({ kind: "file-change" });
      }
      return events;
    }
    if (value.type === "result") {
      if (value.is_error || value.subtype !== "success") {
        const detail =
          typeof value.result === "string" && value.result
            ? value.result
            : Array.isArray(value.errors)
              ? value.errors.join("；")
              : "";
        return [
          {
            kind: "error",
            terminal: true,
            message:
              detail ||
              `Claude Code 工作回合失敗（${String(value.subtype ?? "unknown")}）。`,
          },
        ];
      }
      const text =
        value.structured_output !== undefined
          ? JSON.stringify(value.structured_output)
          : String(value.result ?? "");
      return text ? [{ kind: "final", text }] : [];
    }
    return [];
  };
}
