import { useT } from "../i18n";
import {
  ProjectOverview,
  type ProjectOverviewProps,
} from "../mission/ProjectOverview";
import { runSetupNeeds, SetupNeeds } from "../team/SetupNeeds";
import type { Run } from "../types";

/**
 * The overview tab's lazily loaded part: what the run's agents could not
 * run on this machine (the person installs it), above the project
 * overview. They load as one view, so they show together and the overview
 * never moves down when the needs arrive.
 */
export function OverviewPanel(props: ProjectOverviewProps & { run: Run }) {
  const messages = useT("team").setupNeeds;
  const needs = runSetupNeeds(
    props.run,
    (number) => messages.round({ number }),
    (name, id) => messages.agent({ name, id }),
  );
  return (
    <>
      <SetupNeeds needs={needs} />
      <ProjectOverview {...props} />
    </>
  );
}
