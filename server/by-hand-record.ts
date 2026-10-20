/**
 * The help events of a Learn-by-hand run (DESIGN v1.2 F13): one helper,
 * called wherever agent output of such a run is stored (and so shown). The
 * record, the facts list and the quoted confirm read these events; they
 * never come from the client.
 *
 * It is also the backstop of a run fitted to a project's rules (F12
 * condition e): help of a kind outside the help set fixed at the start is
 * never recorded, and the call fails with 409 before the output can be
 * stored, so a caller that forgot its own `helpAllowed` check fails too.
 */
import {
  byHandLimits,
  helpAllowed,
  helpKindOf,
  type HelpEvent,
  type HelpKind,
  type HelpSource,
} from "../shared/by-hand.js";
import { AppError, type Run } from "./types.js";

/** What the caller knows of one piece of help; the kind follows from source and rung. */
export interface HelpInput {
  source: HelpSource;
  rung?: number;
  stepId?: string;
  /** Code the filter removed from this output. */
  removed?: number;
  /** When the output was stored; now by default. */
  at?: string;
}

/**
 * Records one help event on the run (the newest 300 are kept), with the
 * model and CLI from `run.modelExecution`, and returns it. Refuses with
 * 409 `m.byHand.helpOutsideFit` when the run's help lock lacks the kind.
 */
export function recordHelp(run: Run, input: HelpInput): HelpEvent {
  const kind = helpKindOf(input.source, input.rung);
  assertHelpAllowed(run, kind);
  const execution = run.modelExecution;
  const model = execution?.reported?.model ?? execution?.model;
  const cli = [execution?.provider ?? "codex", execution?.reported?.cliVersion].filter(Boolean).join(" ");
  const event: HelpEvent = {
    at: input.at ?? new Date().toISOString(),
    kind,
    source: input.source,
    ...(input.rung !== undefined ? { rung: input.rung } : {}),
    ...(input.stepId ? { stepId: input.stepId } : {}),
    ...(model ? { model } : {}),
    cli,
    ...(input.removed ? { removed: input.removed } : {}),
  };
  const record = (run.byHand ??= {});
  record.events = [...(record.events ?? []), event].slice(-byHandLimits.events);
  return event;
}

/**
 * Refuses (409 `m.byHand.helpOutsideFit`) help of a kind outside a fitted
 * run's help set; every help-producing route calls it before it starts a
 * turn (DESIGN v1.2 F12), and recordHelp before it stores output.
 */
export function assertHelpAllowed(run: Run, kind: HelpKind | undefined): asserts kind is HelpKind {
  if (!kind || !helpAllowed(run, kind))
    throw new AppError(
      (m) => m.byHand.helpOutsideFit({ kind: kind ? m.byHand.helpKinds[kind] : "?" }),
      409,
    );
}
