import { Wrench } from "lucide-react";
import { mergeSetupNeeds, type MergedSetupNeed } from "../../shared/setup-needs";
import { useFormat, useT } from "../i18n";
import { CopyCommand } from "../setup/CopyCommand";
import type { Run } from "../types";
import "./team.css";

/**
 * Every need the run's teammates and follow-up rounds reported, each
 * command once with who reported it. `roundLabel` names a round by its
 * number among the run's rounds.
 */
export function runSetupNeeds(
  run: Pick<Run, "agents" | "team" | "followUps">,
  roundLabel: (number: number) => string,
): MergedSetupNeed[] {
  return mergeSetupNeeds([
    ...(run.team?.tasks ?? []).map((task) => ({
      from:
        run.agents.find((agent) => agent.id === task.owner)?.name ?? task.owner,
      needs: task.setup,
    })),
    ...(run.followUps ?? []).map((round, index) => ({
      from: roundLabel(index + 1),
      needs: round.setup,
    })),
  ]);
}

/**
 * What agents could not run because this machine lacks something. Agents
 * are asked not to change the machine, so the person installs it; each
 * command is an agent's suggestion, shown to be checked and copied, never
 * run by BELL. The copy control is the environment checklist's.
 */
export function SetupNeeds({ needs }: { needs: MergedSetupNeed[] }) {
  const t = useT("team").setupNeeds;
  const format = useFormat();
  if (!needs.length) return null;
  return (
    <section className="setup-needs" aria-labelledby="setup-needs-title">
      <h2 id="setup-needs-title">
        <Wrench size={15} aria-hidden="true" />
        {t.title}
      </h2>
      <p>{t.intro}</p>
      <ul>
        {needs.map((need) => (
          <li key={need.command}>
            <strong>{need.need}</strong>
            {need.reason && <p>{need.reason}</p>}
            <CopyCommand command={need.command} />
            <small>
              {t.reportedBy({ names: format.list(need.from, { type: "unit" }) })}
            </small>
          </li>
        ))}
      </ul>
    </section>
  );
}
