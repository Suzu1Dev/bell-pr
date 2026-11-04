import { useId, type ReactNode } from "react";
import { Wrench } from "lucide-react";
import {
  mergeSetupNeeds,
  handOffRefused,
  setupOutcomes,
  type MergedSetupNeed,
  type SetupOutcome,
  type SetupResult,
} from "../../shared/setup-needs";
import type { FollowUpRound } from "../../shared/followups";
import type { SessionMessage } from "../../shared/session";
import { useFormat, useT } from "../i18n";
import { CopyCommand } from "../setup/CopyCommand";
import type { Run } from "../types";
import "./team.css";

/**
 * Every need the run's teammates and follow-up rounds reported, each
 * command once with who reported it. `roundLabel` names a round by its
 * number among the run's rounds; `agentLabel` names a teammate by its name
 * and its id, the id the task board shows.
 */
export function runSetupNeeds(
  run: Pick<Run, "agents" | "team" | "followUps">,
  roundLabel: (number: number) => string,
  agentLabel: (name: string, id: string) => string = (name) => name,
): MergedSetupNeed[] {
  return mergeSetupNeeds([
    ...(run.team?.tasks ?? []).map((task) => {
      const name = run.agents.find((agent) => agent.id === task.owner)?.name;
      return {
        from: name && name !== task.owner ? agentLabel(name, task.owner) : task.owner,
        needs: task.setup,
      };
    }),
    ...(run.followUps ?? []).map((round, index) => ({
      from: roundLabel(index + 1),
      needs: round.setup,
    })),
  ]);
}

/** The latest result a setup turn reported for a command, and when. */
export interface SetupOutcomeRecord {
  outcome: SetupOutcome;
  detail: string;
  at: string;
}

/**
 * The latest agent report for each command, by its trimmed text, over the
 * kept session messages in order: a setup turn's result sets it, and a
 * later turn that lists the command as missing setup again reopens it, as
 * does a follow-up round started later. An outcome this build does not
 * know reads as unreported.
 */
export function latestSetupOutcomes(
  messages: readonly SessionMessage[] = [],
  rounds: readonly Pick<FollowUpRound, "requestedAt" | "setup">[] = [],
) {
  const outcomes = new Map<string, SetupOutcomeRecord>();
  for (const message of messages) {
    if (message.role !== "agent") continue;
    for (const result of message.setupResults ?? [])
      outcomes.set(result.command.trim(), {
        outcome: (setupOutcomes as readonly string[]).includes(result.outcome) ? result.outcome : "unreported",
        detail: result.detail,
        at: message.at,
      });
    for (const need of message.setup ?? []) outcomes.delete(need.command.trim());
  }
  // ISO times compare as text.
  for (const round of rounds)
    for (const need of round.setup ?? []) {
      const reported = outcomes.get(need.command.trim());
      if (reported && round.requestedAt > reported.at) outcomes.delete(need.command.trim());
    }
  return outcomes;
}

/** The needs an agent may still take: none BELL PR refuses to hand over, and none reported installed or present. */
export function openSetupNeeds(needs: readonly MergedSetupNeed[], outcomes: ReadonlyMap<string, SetupOutcomeRecord>) {
  return needs.filter((need) => {
    if (handOffRefused(need.command)) return false;
    const outcome = outcomes.get(need.command.trim())?.outcome;
    return outcome !== "installed" && outcome !== "present";
  });
}

/**
 * What agents could not run with their available permissions and setup;
 * each command is an agent's suggestion, shown to be checked and copied.
 * BELL never runs one from here on its own: on a Full access run,
 * `handOff` offers to hand the list to an agent, and `outcomes` show what
 * the agent reported for each item. The copy control is the environment
 * checklist's.
 */
export function SetupNeeds({
  needs,
  outcomes,
  handOff,
}: {
  needs: MergedSetupNeed[];
  outcomes?: ReadonlyMap<string, SetupOutcomeRecord>;
  handOff?: ReactNode;
}) {
  const t = useT("team").setupNeeds;
  const format = useFormat();
  const titleId = useId();
  if (!needs.length) return null;
  return (
    <section className="setup-needs" aria-labelledby={titleId}>
      <h2 id={titleId}>
        <Wrench size={15} aria-hidden="true" />
        {t.title}
      </h2>
      <p>{t.intro}</p>
      {handOff}
      <ul>
        {needs.map((need) => {
          const reported = outcomes?.get(need.command.trim());
          return (
            <li key={need.command}>
              <strong>{need.need}</strong>
              {need.reason && <p>{need.reason}</p>}
              <CopyCommand command={need.command} />
              {reported && (
                <p className="setup-outcome" data-outcome={reported.outcome}>
                  {reported.outcome === "unreported"
                    ? t.unreportedLine({ time: format.dateTime(reported.at) })
                    : t.outcomeLine({ outcome: t.outcomes[reported.outcome], time: format.dateTime(reported.at) })}
                </p>
              )}
              {handOff !== undefined && handOffRefused(need.command) && (
                <p className="setup-outcome">{t.handOffUnsafe}</p>
              )}
              <small>
                {t.reportedBy({ names: format.list(need.from, { type: "unit" }) })}
              </small>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** A setup turn's results in its message: one row per item handed over, as the agent reported it. */
export function SetupResults({ results }: { results: readonly SetupResult[] }) {
  const t = useT("team").setupNeeds;
  return (
    <section className="setup-results">
      <h4>{t.resultsTitle}</h4>
      <ul>
        {results.map((result) => {
          const outcome = (setupOutcomes as readonly string[]).includes(result.outcome) ? result.outcome : "unreported";
          return (
            <li key={result.command} data-outcome={outcome}>
              <span className="setup-result-outcome">{t.outcomes[outcome]}</span>{" "}
              <strong>{result.need}</strong> <code>{result.command}</code>
              {result.detail && (
                <p>
                  {t.agentAccount} {result.detail}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
