/**
 * The setup list in a teammate's or a follow-up round's report: what this
 * machine lacked for a check the agent could not run; and a setup turn's
 * per-item results, when the person hands that list to an agent on a Full
 * access run. The prompt text that asks for them is in prompts/setup.ts.
 */
import {
  handOffRefused,
  mergeSetupNeeds,
  setupAgentOutcomes,
  setupTurnLimit,
  unsafeSetupCommand,
  type SetupNeed,
  type SetupResult,
} from "../shared/setup-needs.js";
import { sm } from "./i18n/index.js";
import { redact } from "./secrets.js";
import { AppError, type Run } from "./types.js";

/** The report field in the CLIs' structured output; every object closed and fully required. */
export const setupJsonSchema = {
  type: "array",
  maxItems: 10,
  items: {
    type: "object",
    properties: {
      need: { type: "string" },
      command: { type: "string" },
      reason: { type: "string" },
    },
    required: ["need", "command", "reason"],
    additionalProperties: false,
  },
};

/** Keeps well-formed needs and drops the rest; an agent's answer is not trusted. */
export function parseSetupNeeds(value: unknown): SetupNeed[] {
  if (!Array.isArray(value)) return [];
  const text = (input: unknown, max: number) =>
    typeof input === "string" ? redact(input.trim()).slice(0, max) : "";
  return value
    .slice(0, 10)
    .map((entry) => {
      const record = (entry ?? {}) as Record<string, unknown>;
      return {
        need: text(record.need, 120),
        // A cut command would be a different command, so a long one is dropped.
        command: text(record.command, 301),
        reason: text(record.reason, 600),
      };
    })
    .filter(
      (entry) =>
        entry.need &&
        entry.command &&
        entry.command.length <= 300 &&
        !unsafeSetupCommand.test(entry.command),
    );
}

/** A setup turn's results in the CLIs' structured output; every object closed and fully required. */
export const setupResultsJsonSchema = {
  type: "array",
  maxItems: setupTurnLimit,
  items: {
    type: "object",
    properties: {
      command: { type: "string" },
      outcome: { type: "string", enum: [...setupAgentOutcomes] },
      detail: { type: "string" },
    },
    required: ["command", "outcome", "detail"],
    additionalProperties: false,
  },
};

/**
 * One result per item the person handed over, in that order, from the
 * agent's untrusted answer: the first entry for each handed command with a
 * known outcome counts, anything else is dropped, and an item without one
 * is `unreported`. The need always comes from BELL's own copy.
 */
export function parseSetupResults(value: unknown, handed: readonly SetupNeed[]): SetupResult[] {
  const reported = new Map<string, Pick<SetupResult, "outcome" | "detail">>();
  for (const entry of Array.isArray(value) ? value.slice(0, setupTurnLimit) : []) {
    const record = (entry ?? {}) as Record<string, unknown>;
    const command = typeof record.command === "string" ? record.command.trim() : "";
    const outcome = setupAgentOutcomes.find((known) => known === record.outcome);
    if (!command || !outcome || reported.has(command)) continue;
    const detail = typeof record.detail === "string" ? redact(record.detail.trim()).slice(0, 800) : "";
    reported.set(command, { outcome, detail });
  }
  return handed.map(({ need, command }) => ({
    need,
    command,
    ...(reported.get(command.trim()) ?? { outcome: "unreported" as const, detail: "" }),
  }));
}

/**
 * The stored needs for `commands`, the ones the person ticked: only a Full
 * access run hands its setup to an agent, only commands on the run's own
 * lists (the ones the Overview shows) are taken, and one that downloads
 * and runs or chains what it fetched, or pipes into a shell or another
 * interpreter (handOffRefused), never is, also one read back from
 * state.json.
 */
export function setupHandOffNeeds(
  run: Pick<Run, "modelExecution" | "team" | "followUps">,
  commands: readonly string[],
): SetupNeed[] {
  if (run.modelExecution?.agentAccess !== "full") throw new AppError(sm().session.setupFullAccessOnly, 409);
  const stored = mergeSetupNeeds([
    ...(run.team?.tasks ?? []).map((task) => ({ from: "", needs: task.setup })),
    ...(run.followUps ?? []).map((round) => ({ from: "", needs: round.setup })),
  ]);
  return [...new Set(commands.map((command) => command.trim()))].map((command) => {
    const need = stored.find((entry) => entry.command.trim() === command);
    if (!need) throw new AppError(sm().session.setupNotListed, 409);
    if (handOffRefused(need.command)) throw new AppError(sm().session.setupUnsafe, 422);
    return { need: need.need, command: need.command, reason: need.reason };
  });
}
