import type { ModelExecution } from "../shared/models.js";
import { AppError } from "./types.js";
import { sm } from "./i18n/index.js";

export type AgentTimeoutKind =
  | "analysis"
  | "discovery"
  | "explanations"
  | "draft"
  | "read"
  | "write";

/**
 * Seconds each call waited before provider and effort factors existed (Codex,
 * no effort factor). Explanations and the PR draft run through the read-only
 * agent turn and keep that budget.
 */
const baseSeconds: Record<AgentTimeoutKind, number> = {
  analysis: 240,
  discovery: 240,
  explanations: 600,
  draft: 600,
  read: 600,
  write: 1800,
};

/** Claude Code with thinking is slower per call than the Codex defaults above. */
const providerFactors = { codex: 1, claude: 2.5 } as const;
/** Only the two highest efforts stretch a turn enough to matter; others keep ×1. */
const effortFactors: Partial<Record<string, number>> = { xhigh: 1.5, max: 2 };
export const maxAgentTimeoutMs = 2 * 60 * 60 * 1000;
export const defaultAgentTimeoutScale = 1;

/** Base × provider × effort × scale, whole seconds, at most two hours. */
export function agentTimeoutMs(
  kind: AgentTimeoutKind,
  execution: Pick<ModelExecution, "provider" | "reasoningEffort">,
  scale = defaultAgentTimeoutScale,
): number {
  const provider = providerFactors[execution.provider ?? "codex"];
  const effort = execution.reasoningEffort
    ? (effortFactors[execution.reasoningEffort] ?? 1)
    : 1;
  const seconds = Math.round(baseSeconds[kind] * provider * effort * scale);
  return Math.min(seconds * 1000, maxAgentTimeoutMs);
}

/** True when the wait is longer than the Codex baseline and worth announcing. */
export function hasExtendedAgentTimeout(
  execution: Pick<ModelExecution, "provider" | "reasoningEffort">,
): boolean {
  return (
    execution.provider === "claude" ||
    (!!execution.reasoningEffort && execution.reasoningEffort in effortFactors)
  );
}

/** Whole minutes when exact, otherwise one decimal (37.5). */
function minutes(timeoutMs: number): number {
  return Math.round(timeoutMs / 6000) / 10;
}

/** A clause such as "waits up to 15 minutes" for a line announcing a turn. */
export function describeAgentTimeout(timeoutMs: number): string {
  return sm().run.agentCli.timeoutLimit({ minutes: minutes(timeoutMs) });
}

/**
 * Replaces command()'s generic 504 with advice the person can act on, and its
 * exit failure (the raw tail of the CLI's output) with the error the CLI
 * reported in its event stream, when it reported one; any other error is
 * returned unchanged so git/gh behaviour stays the same. A failure already
 * recognised as a setup problem (it has a code, such as a CLI that is not
 * signed in) keeps its message and its fixes.
 */
export function withAgentTimeoutHint(
  error: unknown,
  executable: string,
  timeoutMs: number,
  reported?: string,
): unknown {
  if (
    error instanceof AppError &&
    error.statusCode === 422 &&
    !error.code &&
    reported
  )
    return new AppError(
      (m) => m.run.command.failed({ executable, output: reported }),
      422,
      { details: error.details, cause: error },
    );
  if (!(error instanceof AppError) || error.statusCode !== 504) return error;
  return new AppError(
    (m) =>
      m.run.agentCli.timedOut({ executable, minutes: minutes(timeoutMs) }),
    504,
  );
}

/** Parses BELLPR_AGENT_TIMEOUT_SCALE; an unset variable means the default. */
export function parseAgentTimeoutScale(value: string | undefined): number {
  if (value === undefined) return defaultAgentTimeoutScale;
  const scale = Number(value);
  if (value.trim() === "" || !Number.isFinite(scale) || scale < 0.5 || scale > 10)
    throw new Error(
      sm().cli.config.limitRange({ name: "BELLPR_AGENT_TIMEOUT_SCALE", min: 0.5, max: 10 }),
    );
  return scale;
}
