/**
 * Something this machine lacks for a check an agent could not run. The
 * command is an agent's suggestion, and BELL never runs it on its own: the
 * person runs it, or, on a Full access run, ticks it and confirms, and one
 * collaboration turn runs it (its report is `SessionMessage.setupResults`).
 * Kept on the team task or follow-up round that reported it
 * (TeamTask.setup, FollowUpRound.setup).
 */
export interface SetupNeed {
  /** What is missing, in the run's language. */
  need: string;
  /** One command the person can run; it may use sudo. */
  command: string;
  /** The check it blocked and where the project documents it, in the run's language. */
  reason: string;
}

/** A need as the checklist lists it, with every agent that reported it. */
export type MergedSetupNeed = SetupNeed & { from: string[] };

// The person may run these with sudo: one line, and never a download run by a
// shell, whether piped (`| sh`) or substituted (`sh <(curl …)`, `$(wget …)`).
export const unsafeSetupCommand =
  /[\r\n]|\|\s*(?:sudo\s+)?\S*sh\b|[<$]\(\s*(?:curl|wget)\b/;

/**
 * A command BELL PR never hands to an agent, which runs it without the
 * sandbox and perhaps as root: the shapes above; anything that runs a
 * downloader (curl, wget, aria2c, axel, fetch) and pipes, chains or
 * substitutes; and a pipe into a shell or another interpreter, whatever
 * sudo or env options stand in front of it. Stricter than what reaches the
 * person's own checklist, where they run the command themselves. A shape
 * it does not know still reaches the dialog, where the person reads it.
 */
export function handOffRefused(command: string) {
  return (
    unsafeSetupCommand.test(command) ||
    (/\b(?:curl|wget|aria2c|axel|fetch)\b/.test(command) && /[|;&<>`]|\$\(/.test(command)) ||
    /\|&?(?:[^|]*?[\s/])?(?:sh|bash|zsh|dash|ksh|fish|python[\d.]*|perl|ruby|node|php|deno|bun)(?:\s|$)/.test(command)
  );
}

/** Items one setup turn may take: the cap of one report (server/setup-needs.ts). */
export const setupTurnLimit = 10;
/** What the agent may report per item. Persisted: never add a value (AGENTS.md rule 4). */
export const setupAgentOutcomes = ["installed", "present", "failed", "needsYou"] as const;
/** …and BELL's own value for an item the agent left out, or an answer that was not JSON. */
export const setupOutcomes = [...setupAgentOutcomes, "unreported"] as const;
export type SetupOutcome = (typeof setupOutcomes)[number];

/** One handed item's result: need and command are BELL's stored copy, outcome and detail the agent's report. */
export interface SetupResult {
  need: string;
  command: string;
  outcome: SetupOutcome;
  detail: string;
}

/** A command that runs sudo anywhere in it, such as `apt-get update && sudo apt-get install x`. */
export const usesSudo = (command: string) => /(^|[\s;&|(])sudo(\s|$)/.test(command);

/** Every need once, by command, with the agents that reported it, in report order. */
export function mergeSetupNeeds(
  sources: { from: string; needs?: SetupNeed[] }[],
): MergedSetupNeed[] {
  const merged = new Map<string, MergedSetupNeed>();
  for (const { from, needs } of sources)
    for (const need of needs ?? []) {
      // Spacing inside quotes can matter to a shell, so only the ends are trimmed.
      const key = need.command.trim();
      const entry = merged.get(key);
      if (!entry) merged.set(key, { ...need, from: [from] });
      else if (!entry.from.includes(from)) entry.from.push(from);
    }
  return [...merged.values()];
}
