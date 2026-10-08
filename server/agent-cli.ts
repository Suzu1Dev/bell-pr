import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import {
  providerLabels,
  type AgentProvider,
  type ModelExecution,
} from "../shared/models.js";
import { modelArguments, modelExecutionSchema, modelId } from "./models.js";
import { AppError } from "./types.js";
import { redact } from "./secrets.js";

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
  /** Web search and page fetching for "read" and "write"; "none" never gets it. */
  web?: boolean;
}

export const agentLabel = (provider: AgentProvider = "codex") =>
  providerLabels[provider];

/** Claude Code's built-in web tools; WebFetch is the sanctioned way to read a page, curl/wget stay denied. */
const claudeWebTools = ["WebSearch", "WebFetch"];

function claudeAccess(access: AgentAccess, web: boolean): string[] {
  if (access === "none") return ["--tools", "", "--permission-mode", "dontAsk"];
  const tools =
    access === "read"
      ? ["Read", "Grep", "Glob"]
      : ["Read", "Grep", "Glob", "Edit", "Write", "Bash"];
  const allowed =
    access === "read" ? ["Read", "Grep", "Glob"] : ["Read", "Grep", "Glob", "Bash"];
  const extra = web ? claudeWebTools : [];
  return [
    "--tools",
    [...tools, ...extra].join(","),
    "--allowedTools",
    [...allowed, ...extra].join(" "),
    "--permission-mode",
    access === "read" ? "dontAsk" : "acceptEdits",
    // acceptEdits approves file edits inside the working directory only; Bash is not sandboxed.
    // Deny rules win over allow rules: pushing, GitHub CLI and raw downloads stay with BELL's own flow.
    ...(access === "write"
      ? [
          "--disallowedTools",
          "Bash(git push:*)",
          "Bash(gh:*)",
          "Bash(curl:*)",
          "Bash(wget:*)",
        ]
      : []),
  ];
}

/** The prompt is always written to stdin; a shell is never used. */
export async function agentCommand(
  execution: ModelExecution,
  options: AgentCommandOptions,
): Promise<{ executable: string; args: string[] }> {
  const web = options.web === true && options.access !== "none";
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
        ...claudeAccess(options.access, web),
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
      // Codex 0.159 `exec` has no --search flag; live search is a config override.
      ...(web ? ["-c", 'web_search="live"'] : []),
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
  /** command is the first line the agent ran, redacted and cut to 300 characters; absent when the CLI gave none. */
  | { kind: "command"; outcome: string; command?: string }
  /** path is as the CLI reported it (Claude Code: absolute); the integrated paths come from the diff, not from here. */
  | { kind: "file-change"; path?: string }
  /** Recoverable waiting or denial the user should see now; never a failure by itself. */
  | { kind: "notice"; message: string }
  /** detail is the search query or the fetched URL, redacted and cut to 200 characters. */
  | { kind: "web"; action: "search" | "fetch"; detail: string }
  /** Claude Code's system/init: the resolved model and the CLI version. */
  | { kind: "session"; model: string; cliVersion?: string }
  /** Model IDs present in result.modelUsage; the first entry is not necessarily the main model. */
  | { kind: "usage-by-model"; models: string[] }
  /** retryable: the invocation lost Claude Code's OAuth refresh lock to another process; a rerun usually succeeds. */
  | { kind: "error"; message: string; terminal: boolean; retryable?: boolean };

/** Claude Code reports this when another process holds ~/.claude/.oauth_refresh.lock while the token is expired. */
const oauthRefreshRace = /Failed to refresh OAuth token/;

type Json = Record<string, any>;
const blocks = (event: Json): Json[] =>
  Array.isArray(event.message?.content)
    ? event.message.content.filter(
        (block: unknown) => !!block && typeof block === "object",
      )
    : [];
const isModelId = (value: unknown): value is string =>
  typeof value === "string" && modelId.safeParse(value).success;
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * A command or path for the log: first line only, credential shapes masked,
 * at most 300 characters. redact() does not know flag forms such as
 * `--token xyz`, which is why continuation lines are dropped rather than kept.
 */
function summarize(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  const line = redact(value).split(/\r?\n/, 1)[0].trim();
  return line ? line.slice(0, 300) : undefined;
}
const withField = <K extends string>(key: K, value: string | undefined) =>
  value === undefined ? {} : ({ [key]: value } as Record<K, string>);

/** A search query or URL for the log; absent when the CLI gave none. */
function webEvent(
  action: "search" | "fetch",
  detail: unknown,
): AgentEvent[] {
  const text = summarize(detail);
  return text ? [{ kind: "web", action, detail: text.slice(0, 200) }] : [];
}

const rateLimitWindows: Record<string, string> = {
  five_hour: "5 小時滾動視窗：用量每 5 小時依開始時間重置",
  seven_day: "7 天滾動視窗：所有模型的每週總量",
  seven_day_opus: "7 天滾動視窗：Opus 的每週用量",
  seven_day_sonnet: "7 天滾動視窗：Sonnet 的每週用量",
  seven_day_overage_included: "7 天滾動視窗：含額外用量的每週總量",
  overage: "額外用量",
};

/** Explains a non-allowed rate_limit_event in one line; a plain "allowed" status is normal and stays silent. */
function rateLimitNotice(info: unknown): string | undefined {
  if (!info || typeof info !== "object") return;
  const value = info as Json;
  if (typeof value.status !== "string" || value.status === "allowed") return;
  const state =
    value.status === "rejected"
      ? "已達上限，等待重置中"
      : value.status === "allowed_warning"
        ? "接近上限"
        : `狀態 ${value.status}`;
  const parts = [
    typeof value.rateLimitType === "string"
      ? (rateLimitWindows[value.rateLimitType] ?? value.rateLimitType)
      : undefined,
    finite(value.utilization)
      ? `已用 ${Math.round(value.utilization * 100)}%`
      : undefined,
    // resetsAt is Unix time in seconds (observed 1791439800 for a same-day reset).
    finite(value.resetsAt)
      ? `預計 ${new Date(value.resetsAt * 1000).toLocaleString("zh-TW", { hour12: false })} 重置`
      : undefined,
  ].filter((part): part is string => !!part);
  return `Claude 額度${state}${parts.length ? `（${parts.join("；")}）` : ""}。`;
}

/** Tool denials from the permission settings; tool_input is never logged. */
function denialNotice(denial: unknown): AgentEvent | undefined {
  if (!denial || typeof denial !== "object") return;
  const value = denial as Json;
  if (typeof value.tool_name !== "string" || !value.tool_name) return;
  const reason =
    typeof value.decision_reason === "string" && value.decision_reason
      ? value.decision_reason
      : typeof value.message === "string" && value.message
        ? value.message
        : "";
  return {
    kind: "notice",
    message: `工具 ${value.tool_name} 被權限設定拒絕${reason ? `：${reason}` : "。"}`,
  };
}

function systemNotice(value: Json): AgentEvent[] {
  if (value.subtype === "api_retry") {
    const parts = [
      finite(value.attempt)
        ? `第 ${value.attempt}${finite(value.max_retries) ? `/${value.max_retries}` : ""} 次`
        : undefined,
      typeof value.error === "string" && value.error
        ? `原因 ${value.error}`
        : undefined,
      finite(value.retry_delay_ms)
        ? `${Math.max(0, Math.round(value.retry_delay_ms / 1000))} 秒後重試`
        : undefined,
    ].filter((part): part is string => !!part);
    return [
      {
        kind: "notice",
        message: `Claude Code 重試中${parts.length ? `（${parts.join("，")}）` : ""}。`,
      },
    ];
  }
  if (value.subtype === "permission_denied") {
    const notice = denialNotice(value);
    return notice ? [notice] : [];
  }
  return [];
}

/**
 * Maps one parsed JSONL event to the documented events BELL uses. Command
 * strings and edited paths are kept (summarized); raw tool output, Codex
 * aggregated_output and tool_result content are never returned.
 */
export function agentEventReader(provider: AgentProvider = "codex") {
  // Claude Code reports a tool's input on tool_use and its outcome on a later tool_result, keyed by id.
  const tools = new Map<string, { name: string; summary?: string }>();
  return (event: unknown): AgentEvent[] => {
    if (!event || typeof event !== "object") return [];
    const value = event as Json;
    if (provider === "codex") {
      const item = value.item;
      if (value.type === "item.completed" && item?.type === "agent_message")
        return [{ kind: "message", text: String(item.text ?? "") }];
      if (value.type === "item.completed" && item?.type === "command_execution")
        return [
          {
            kind: "command",
            outcome: `exit ${item.exit_code ?? "?"}`,
            ...withField("command", summarize(item.command)),
          },
        ];
      if (value.type === "item.completed" && item?.type === "file_change") {
        const paths = (Array.isArray(item.changes) ? item.changes : [])
          .slice(0, 20)
          .map((change: Json) => summarize(change?.path))
          .filter((path: string | undefined): path is string => !!path);
        return paths.length
          ? paths.map((path: string) => ({ kind: "file-change", path }))
          : [{ kind: "file-change" }];
      }
      if (value.type === "item.completed" && item?.type === "web_search") {
        // Codex 0.159: item.query may be empty; the action then carries the query (observed as a
        // string in action.query, documented as action.queries). Results are never read.
        const action = item.action && typeof item.action === "object" ? item.action : {};
        const queries = (
          Array.isArray(action.queries) ? action.queries : [action.query]
        ).filter((query: unknown) => typeof query === "string" && query);
        return webEvent("search", item.query || queries.join(" / "));
      }
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
    if (value.type === "system") {
      if (value.subtype === "init" && isModelId(value.model))
        return [
          {
            kind: "session",
            model: value.model,
            ...(typeof value.claude_code_version === "string" &&
            value.claude_code_version
              ? { cliVersion: value.claude_code_version.slice(0, 100) }
              : {}),
          },
        ];
      return systemNotice(value);
    }
    if (value.type === "rate_limit_event") {
      const message = rateLimitNotice(value.rate_limit_info);
      return message ? [{ kind: "notice", message }] : [];
    }
    if (value.type === "assistant") {
      const events: AgentEvent[] = [];
      for (const block of blocks(value)) {
        if (block.type === "text" && block.text)
          events.push({ kind: "message", text: String(block.text) });
        if (block.type === "tool_use" && typeof block.id === "string") {
          const name = String(block.name);
          const input = block.input && typeof block.input === "object" ? block.input : {};
          // Web tools are logged when requested: their tool_result holds page content, which is never read.
          if (name === "WebSearch") events.push(...webEvent("search", input.query));
          if (name === "WebFetch") events.push(...webEvent("fetch", input.url));
          tools.set(block.id, {
            name,
            summary: summarize(
              name === "Bash"
                ? input.command
                : name === "Edit" || name === "Write"
                  ? input.file_path
                  : undefined,
            ),
          });
        }
      }
      return events;
    }
    if (value.type === "user") {
      const events: AgentEvent[] = [];
      for (const block of blocks(value)) {
        if (block.type !== "tool_result") continue;
        const tool = tools.get(block.tool_use_id);
        if (tool?.name === "Bash")
          events.push({
            kind: "command",
            outcome: block.is_error ? "失敗" : "成功",
            ...withField("command", tool.summary),
          });
        else if (
          (tool?.name === "Edit" || tool?.name === "Write") &&
          !block.is_error
        )
          events.push({ kind: "file-change", ...withField("path", tool.summary) });
      }
      return events;
    }
    if (value.type === "result") {
      // Denials are listed on the result even when the turn succeeded; log them before the outcome.
      const events: AgentEvent[] = (
        Array.isArray(value.permission_denials) ? value.permission_denials : []
      )
        .slice(0, 20)
        .map(denialNotice)
        .filter((item): item is AgentEvent => !!item);
      if (value.is_error || value.subtype !== "success") {
        const detail =
          typeof value.result === "string" && value.result
            ? value.result
            : Array.isArray(value.errors)
              ? value.errors.join("；")
              : "";
        const retryable =
          (value.is_error === true || value.terminal_reason === "api_error") &&
          oauthRefreshRace.test(detail);
        events.push({
          kind: "error",
          terminal: true,
          message:
            detail ||
            `Claude Code 工作回合失敗（${String(value.subtype ?? "unknown")}）。`,
          ...(retryable ? { retryable: true } : {}),
        });
        return events;
      }
      const models =
        value.modelUsage && typeof value.modelUsage === "object"
          ? Object.keys(value.modelUsage).filter(isModelId).slice(0, 20)
          : [];
      if (models.length) events.push({ kind: "usage-by-model", models });
      const text =
        value.structured_output !== undefined
          ? JSON.stringify(value.structured_output)
          : String(value.result ?? "");
      if (text) events.push({ kind: "final", text });
      return events;
    }
    return [];
  };
}

/**
 * Records what Claude Code reported into execution.reported. Returns true when the main
 * model is new, so callers log it once. modelsUsed is a union: a second model is more
 * likely a Claude Code helper call than a fallback, since BELL never passes --fallback-model.
 */
export function applyReportedModel(
  execution: ModelExecution,
  item: AgentEvent,
): boolean {
  if (item.kind === "session") {
    const changed = execution.reported?.model !== item.model;
    execution.reported = {
      ...execution.reported,
      model: item.model,
      ...(item.cliVersion ? { cliVersion: item.cliVersion } : {}),
    };
    return changed;
  }
  if (item.kind === "usage-by-model" && execution.reported) {
    execution.reported.modelsUsed = [
      ...new Set([...(execution.reported.modelsUsed ?? []), ...item.models]),
    ].slice(0, 20);
  }
  return false;
}

/** Waits before the second and third attempt of a turn that lost the OAuth refresh race. */
export const transientRetryDelays: readonly number[] = [15_000, 45_000];

export type TransientSleep = (ms: number, signal: AbortSignal) => Promise<void>;

export interface TransientRetryOptions {
  signal: AbortSignal;
  /** Receives the Traditional Chinese notice before each wait. */
  onRetry?: (notice: string) => void;
  /** Test seam; the default waits for real and rejects with the 409 cancellation on abort. */
  sleep?: TransientSleep;
}

const waitFor: TransientSleep = async (ms, signal) => {
  try {
    await delay(ms, undefined, { signal });
  } catch {
    throw new AppError("工作已取消。", 409);
  }
};

/**
 * Runs one CLI invocation and repeats it while it ends with a retryable
 * terminal error, up to two more times. Every attempt is a separate
 * invocation: the caller acquires and releases its process slot and records
 * efficiency inside attempt(), so nobody is blocked during the wait. The last
 * result is returned as is; the caller decides what a failure means.
 */
export async function retryTransientAuth<T extends { retryable?: boolean }>(
  attempt: () => Promise<T>,
  options: TransientRetryOptions,
): Promise<T> {
  const sleep = options.sleep ?? waitFor;
  const total = transientRetryDelays.length + 1;
  for (let index = 0; ; index++) {
    const result = await attempt();
    const ms = transientRetryDelays[index];
    if (!result.retryable || ms === undefined || options.signal.aborted)
      return result;
    options.onRetry?.(
      `Claude Code 正在更新登入憑證（其他行程持有更新鎖），${Math.round(ms / 1000)} 秒後重試（第 ${index + 2}/${total} 次）。`,
    );
    await sleep(ms, options.signal);
    if (options.signal.aborted) throw new AppError("工作已取消。", 409);
  }
}
