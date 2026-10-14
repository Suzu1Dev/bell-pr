/**
 * Server-log events for a run's lifecycle and its agent processes (see
 * log.ts). Each `msg` is a stable event name such as `run.started` or
 * `agent.output_retry`, so the log files can be counted and searched.
 * Prompts and agent answers are never logged.
 */
import { log } from "./log.js";
import { AppError, type Run } from "./types.js";
import type { AgentTeam } from "../shared/team.js";

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** run.queued: the run waits for a free slot in the Workbench queue. */
export function logRunQueued(
  run: Run,
  reason: "created" | "plan_approved" | "plan_revised" | "retry" | "resumed",
) {
  log.info("run.queued", { runId: run.id, reason });
}

/**
 * run.started when the queue starts a run; call the returned function when
 * it stops, to log run.finished, run.awaiting_plan, run.cancelled or
 * run.failed with the duration.
 */
export function runLifecycle(run: Run) {
  const started = Date.now();
  log.info("run.started", {
    runId: run.id,
    phase: run.team?.phase,
    provider: run.modelExecution?.provider,
  });
  return () => {
    const fields = {
      runId: run.id,
      status: run.status,
      phase: run.team?.phase,
      durationMs: Date.now() - started,
    };
    if (run.status === "failed")
      log.warn("run.failed", { ...fields, error: run.error });
    else if (run.status === "cancelled") log.info("run.cancelled", fields);
    else if (run.status === "awaiting_plan") log.info("run.awaiting_plan", fields);
    else log.info("run.finished", fields);
  };
}

/** Moves a team run to its next phase and logs run.phase. */
export function enterPhase(run: Run, team: AgentTeam, phase: AgentTeam["phase"]) {
  team.phase = phase;
  log.info("run.phase", { runId: run.id, phase });
}

/**
 * agent.spawn when an agent CLI process starts; `exited` or `failed` logs
 * agent.exit with the exit code (when the process reported one) and the
 * duration.
 */
export function agentSpawn(
  run: Pick<Run, "id">,
  role: string,
  executable: string,
  timeoutMs: number,
) {
  const started = Date.now();
  const fields = { runId: run.id, role, executable, timeoutMs };
  log.info("agent.spawn", fields);
  return {
    exited(result?: { code?: number }) {
      log.info("agent.exit", {
        ...fields,
        exitCode: result?.code ?? 0,
        durationMs: Date.now() - started,
      });
    },
    failed(error: unknown) {
      const status = error instanceof AppError ? error.statusCode : undefined;
      // command() (process.ts) attaches the code when the process exited.
      const exitCode =
        error instanceof AppError && typeof error.details?.exitCode === "number"
          ? error.details.exitCode
          : undefined;
      log.warn("agent.exit", {
        ...fields,
        outcome:
          status === 504
            ? "timeout"
            : status === 409
              ? "cancelled"
              : status === 503
                ? "spawn_failed"
                : "failed",
        status,
        exitCode,
        durationMs: Date.now() - started,
      });
    },
  };
}

/**
 * Parses an agent's structured answer. When the answer does not fit its
 * schema, logs agent.output_retry with the run id and the schema name (the
 * "format incomplete, retry" path the person then has to retry) and
 * rethrows.
 */
export function parseAgentOutput<T>(
  run: Pick<Run, "id">,
  schema: string,
  parse: () => T,
): T {
  try {
    return parse();
  } catch (error) {
    log.warn("agent.output_retry", {
      runId: run.id,
      schema,
      reason: errorMessage(error),
    });
    throw error;
  }
}

/**
 * Logs `<event>.started`, then `<event>.finished` or `<event>.failed` with
 * the duration, around a sync or a follow-up step started by the person.
 * A refusal (an AppError below 500) is logged at info level.
 */
export async function logged<T>(
  event: string,
  fields: Record<string, unknown>,
  work: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  log.info(`${event}.started`, fields);
  try {
    const result = await work();
    log.info(`${event}.finished`, { ...fields, durationMs: Date.now() - started });
    return result;
  } catch (error) {
    const refused = error instanceof AppError && error.statusCode < 500;
    (refused ? log.info : log.warn)(`${event}.failed`, {
      ...fields,
      durationMs: Date.now() - started,
      ...(refused ? { status: error.statusCode } : {}),
      error: errorMessage(error),
    });
    throw error;
  }
}
