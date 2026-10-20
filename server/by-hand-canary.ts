/**
 * The write canary of a Learn-by-hand run (DESIGN v1.2 F2): BELL's own
 * reading of an agent turn's events (server/agent-cli.ts) is checked on
 * every turn. A file change from either CLI, or a command from Claude Code
 * (whose read turns have only Read, Grep and Glob), is a hit; a Codex
 * command is a read in its read-only sandbox and is not. A hit stops the
 * turn, is counted in `run.byHand.agentWrites` and withdraws the claim for
 * good (`byHandClean`). Because the reader counts every completed Codex
 * file change, a patch the sandbox refused is a hit too: the canary errs
 * toward withdrawing the claim, never toward a false one.
 */
import type { AgentProvider } from "../shared/models.js";
import type { AgentEvent } from "./agent-cli.js";
import { sm } from "./i18n/index.js";
import { log } from "./log.js";
import { AppError, type Run } from "./types.js";
import type { WorkbenchContext } from "./workbench.js";

/** Whether one event of a Learn-by-hand turn is a write. */
export function canaryHit(item: AgentEvent, provider: AgentProvider | undefined) {
  return item.kind === "file-change" || (item.kind === "command" && provider === "claude");
}

/** Counts a hit, logs it on the run and stops the turn; later events of a stopped turn count nothing. */
export function onCanaryHit(
  ctx: Pick<WorkbenchContext, "log">,
  run: Run,
  role: string,
  controller: AbortController,
) {
  if (controller.signal.aborted) return;
  const record = (run.byHand ??= {});
  record.agentWrites = (record.agentWrites ?? 0) + 1;
  ctx.log(run, role, sm().byHand.agentWrite, { kind: "notice" });
  log.warn("by_hand.agent_write", { runId: run.id, role });
  controller.abort();
}

/**
 * The canary of one runAgent turn: the signal the turn runs with (the
 * caller's, plus the canary's own abort), what to call on each event, and
 * the error the turn ends with when the canary stopped it (409
 * `m.byHand.agentWrite`). Outside a Learn-by-hand run it changes nothing.
 */
export function turnCanary(
  ctx: Pick<WorkbenchContext, "log">,
  run: Run,
  role: string,
  signal: AbortSignal,
) {
  const controller = new AbortController();
  const watching = !!run.learnByHand;
  const failure = () => new AppError((m) => m.byHand.agentWrite, 409);
  return {
    signal: watching ? AbortSignal.any([signal, controller.signal]) : signal,
    observe(item: AgentEvent) {
      if (watching && canaryHit(item, run.modelExecution?.provider ?? "codex"))
        onCanaryHit(ctx, run, role, controller);
    },
    /** Throws the canary's error once it stopped the turn. */
    assertNoHit() {
      if (controller.signal.aborted) throw failure();
    },
    /** The error a failed turn ends with: the canary's when it stopped the turn. */
    failure(error: unknown) {
      return controller.signal.aborted ? failure() : error;
    },
  };
}
