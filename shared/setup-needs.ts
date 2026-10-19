/**
 * Something this machine lacks for a check an agent could not run. Agents
 * are asked not to change the machine, so the person installs it; the
 * command is the agent's suggestion, shown for the person to verify before
 * running it, never run by BELL. Kept on the team task or follow-up round
 * that reported it (TeamTask.setup, FollowUpRound.setup).
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
