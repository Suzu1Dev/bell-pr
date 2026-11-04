import { useT } from "../i18n";
import {
  ProjectOverview,
  type ProjectOverviewProps,
} from "../mission/ProjectOverview";
import { latestSetupOutcomes, openSetupNeeds, runSetupNeeds, SetupNeeds } from "../team/SetupNeeds";
import { SetupHandOff } from "../team/SetupHandOff";
import type { Run } from "../types";

/**
 * The overview tab's lazily loaded part: what the run's agents could not
 * run on this machine (the person installs it, or on a Full access run
 * hands it to an agent), above the project overview. They load as one view, so they show together and the overview
 * never moves down when the needs arrive.
 */
export function OverviewPanel({
  onSetupTurn,
  setupTurnBlock,
  ...props
}: ProjectOverviewProps & {
  run: Run;
  /** Hands chosen setup to a Full access collaboration turn; absent while it cannot run. */
  onSetupTurn?: (commands: string[]) => Promise<void>;
  /** Why such a turn cannot start now. */
  setupTurnBlock?: string;
}) {
  const messages = useT("team").setupNeeds;
  const needs = runSetupNeeds(
    props.run,
    (number) => messages.round({ number }),
    (name, id) => messages.agent({ name, id }),
  );
  const outcomes = latestSetupOutcomes(props.run.session?.messages, props.run.followUps);
  const open = openSetupNeeds(needs, outcomes);
  // Only an agent's report says an item is handled; items BELL PR does not hand over say why on their own.
  const handled = needs.some((need) => ["installed", "present"].includes(outcomes.get(need.command.trim())?.outcome ?? ""));
  const handOff = onSetupTurn ? (
    open.length ? (
      <SetupHandOff needs={open} block={setupTurnBlock} onStart={onSetupTurn} />
    ) : handled ? (
      <p className="field-help">{messages.allHandled}</p>
    ) : null
  ) : undefined;
  return (
    <>
      <SetupNeeds needs={needs} outcomes={outcomes} handOff={handOff} />
      <ProjectOverview {...props} />
    </>
  );
}
