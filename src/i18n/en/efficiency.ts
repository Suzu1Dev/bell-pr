/**
 * The Ponytail efficiency mode and the provider-reported AI usage of a run,
 * an analysis or a discovery (English).
 */
import type { PonytailMode } from "../../../shared/efficiency";
import { formatters } from "../../../shared/i18n/locale";

const fmt = formatters("en");

const efficiency = {
  /** The default heading: the AI usage of a contribution's agent team. */
  title: "Team AI usage",
  modes: {
    lite: "Lite",
    full: "Full",
    off: "Off",
  } satisfies Record<PonytailMode, string>,
  /** One row per calling role; the member-N teammates share one row. */
  roles: {
    lead: "Lead (planning and integration)",
    member: "Teammates",
    reviewer: "Reviewer",
    tester: "Test analyst",
    draft: "PR draft",
    explanations: "Explanations",
    guide: "Follow-up questions",
    followup: "Review fixes",
    sync: "Conflict resolution",
  },
  /** Tooltip of the link to the upstream Ponytail project. */
  sourceTitle: ({ version }: { version: string }) =>
    `Ponytail ${version} upstream project`,
  inputTokens: "Input tokens",
  cachedInputTokens: "Of which cached",
  outputTokens: "Output tokens",
  agentTime: "Total agent time",
  running: "Running",
  /** A count the CLI did not report; never shown as zero. */
  notReported: "Not reported",
  seconds: ({ seconds }: { seconds: number }) =>
    `${fmt.number(seconds, { maximumFractionDigits: 1 })} s`,
  usageNote: ({ calls, measured }: { calls: number; measured: number }) =>
    `${fmt.number(calls)} ${fmt.plural(calls) === "one" ? "call" : "calls"} · usage reported for ${fmt.number(measured)} of ${fmt.number(calls)}${
      measured < calls ? ", so the totals include only the reported calls." : "."
    } Cached input is included in the input tokens. The time is the sum of all calls, not the time you waited.`,
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
  byRoleNote:
    "Like the totals above, this lists only the tokens and calls the CLI reported. Teammates is the total of all members.",
  noMeasurement:
    "No measurements yet. Reported usage and time appear after a run.",
  noMeasurementSample: "No measurements yet. The sample did not call AI.",
};

export default efficiency;
