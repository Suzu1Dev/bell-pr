/**
 * The efficiency mode (built on Ponytail) and the provider-reported AI usage
 * of a run, an analysis or a discovery (English).
 */
import type { PonytailMode } from "../../../shared/efficiency";
import { formatters } from "../../../shared/i18n/locale";

const fmt = formatters("en");

const efficiency = {
  /** The default heading: the AI usage of a contribution's agent team. */
  title: "Team AI usage",
  /** The efficiency mode a call ran with; the stored id "lite" reads "Lean". */
  modes: {
    lite: "Lean",
    full: "Full",
    off: "Off",
  } satisfies Record<PonytailMode, string>,
  modeLabel: ({ mode }: { mode: string }) => `Efficiency mode: ${mode}`,
  /** Marks the summary of the built-in sample. */
  sample: "Sample",
  /** One row per calling role; the member-N teammates share one row. */
  roles: {
    lead: "Lead (planning and integration)",
    member: "Teammates",
    reviewer: "Reviewer",
    tester: "Test analyst",
    draft: "PR draft",
    explanations: "Explanations",
    guide: "Follow-up questions",
    walkthrough: "Code walkthroughs",
    premise: "Premise checks",
    followup: "Review fixes",
    sync: "Conflict resolution",
  },
  /** The credit behind the mode chip: its tooltip and the panel it opens. */
  credit: {
    text: ({ version }: { version: string }) =>
      `Efficiency modes build on Ponytail ${version} by DietrichGebert (MIT license). Lean gives Agents a short adaptation of its principles; Full, its complete rules; Off, neither.`,
    link: "Ponytail upstream project",
  },
  inputTokens: "Input tokens",
  cachedInputTokens: "Of which cached",
  outputTokens: "Output tokens",
  agentTime: "Total Agent time",
  running: "Running",
  /** A count the CLI did not report; never shown as zero. */
  notReported: "Not reported",
  seconds: ({ seconds }: { seconds: number }) =>
    `${fmt.number(seconds, { maximumFractionDigits: 1 })} s`,
  usageNote: ({ calls, measured }: { calls: number; measured: number }) =>
    `${fmt.number(calls)} ${fmt.plural(calls) === "one" ? "call" : "calls"} · usage reported for ${fmt.number(measured)} of ${fmt.number(calls)}${
      measured < calls ? ", so the totals include only the reported calls." : "."
    } Input tokens include cached input. Time adds up all calls, not your wait.`,
  byRole: ({ count }: { count: number }) =>
    `By role (${fmt.number(count)} ${fmt.plural(count) === "one" ? "group" : "groups"})`,
  columns: {
    role: "Role",
    calls: "Calls",
    inputTokens: "Input tokens",
    cachedInputTokens: "Of which cached",
    outputTokens: "Output tokens",
    time: "Time",
  },
  /** A role's call count when only some calls reported their usage. */
  partialCalls: ({ calls, measured }: { calls: number; measured: number }) =>
    `${fmt.number(calls)} (${fmt.number(measured)} reported)`,
  byRoleNote: "Teammates is the total of all members.",
  noMeasurement:
    "No measurements yet. Reported usage and time appear after a run.",
  noMeasurementSample: "No measurements yet. The sample did not call AI.",
};

export default efficiency;
