/**
 * Something this machine lacks for a check an agent could not run. Agents
 * may not change the machine, so the person installs it; the command is the
 * agent's suggestion, shown for the person to verify before running it.
 */
export interface SetupNeed {
  /** What is missing, in Traditional Chinese. */
  need: string;
  /** One command the person can run; it may use sudo. */
  command: string;
  /** The check it blocked and where the project documents it, in Traditional Chinese. */
  reason: string;
}

/** Every need once, by command, with the agents that reported it, in report order. */
export function mergeSetupNeeds(
  sources: { from: string; needs?: SetupNeed[] }[],
) {
  const merged = new Map<string, SetupNeed & { from: string[] }>();
  for (const { from, needs } of sources)
    for (const need of needs ?? []) {
      const key = need.command.replace(/\s+/g, " ").trim();
      const entry = merged.get(key);
      if (!entry) merged.set(key, { ...need, from: [from] });
      else if (!entry.from.includes(from)) entry.from.push(from);
    }
  return [...merged.values()];
}
