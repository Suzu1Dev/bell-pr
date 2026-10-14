import { formatters } from "../../../shared/i18n/locale.js";

const fmt = formatters("en");
/** A number with its noun in the matching form: "1 file", "3 files". */
const count = (n: number, one: string, other: string) =>
  `${fmt.number(n)} ${fmt.plural(n) === "one" ? one : other}`;

/** Run pipeline messages: run logs, agent details and run errors. */
export default {
  /** Agent CLI events, retries and time limits shown while an agent works. */
  agentCli: {
    /** The outcome of a shell command Claude Code ran, kept with the task's checks. */
    commandSucceeded: "succeeded",
    commandFailed: "failed",
    codexTurnFailed: "The Codex turn failed.",
    codexError: "Codex reported an error.",
    claudeTurnFailed: ({ subtype }: { subtype: string }) =>
      `The Claude Code turn failed (${subtype}).`,
    /** Each detail is left out when the CLI did not report it. */
    apiRetry: ({
      attempt,
      maxRetries,
      reason,
      delaySeconds,
    }: {
      attempt?: number;
      maxRetries?: number;
      reason?: string;
      delaySeconds?: number;
    }) => {
      const details = [
        attempt === undefined
          ? ""
          : maxRetries === undefined
            ? `attempt ${attempt}`
            : `attempt ${attempt} of ${maxRetries}`,
        reason ? `reason: ${reason}` : "",
        delaySeconds === undefined
          ? ""
          : `next try in ${count(delaySeconds, "second", "seconds")}`,
      ].filter(Boolean);
      return `Claude Code is retrying${details.length ? ` (${fmt.list(details, { type: "unit" })})` : ""}.`;
    },
    /** Claude Code's rate limit windows by their rateLimitType id. */
    rateLimitWindows: {
      five_hour:
        "5-hour rolling window: usage resets 5 hours after it started",
      seven_day: "7-day rolling window: the weekly total for all models",
      seven_day_opus: "7-day rolling window: weekly Opus usage",
      seven_day_sonnet: "7-day rolling window: weekly Sonnet usage",
      seven_day_overage_included:
        "7-day rolling window: the weekly total including extra usage",
      overage: "extra usage",
    },
    /**
     * A rate limit that is not plainly allowed. `status` is the CLI's id
     * ("rejected", "allowed_warning" or another one shown as is); `used` is
     * a percentage and `resetsAt` a formatted date and time.
     */
    rateLimit: ({
      status,
      window,
      used,
      resetsAt,
    }: {
      status: string;
      window?: string;
      used?: number;
      resetsAt?: string;
    }) => {
      const details = [
        window ?? "",
        used === undefined ? "" : `${used}% used`,
        resetsAt === undefined ? "" : `expected to reset at ${resetsAt}`,
      ].filter(Boolean);
      const suffix = details.length
        ? ` (${fmt.list(details, { type: "unit" })})`
        : "";
      if (status === "rejected")
        return `Claude usage limit reached; waiting for it to reset${suffix}.`;
      if (status === "allowed_warning")
        return `Claude usage is close to its limit${suffix}.`;
      return `Claude usage limit status: ${status}${suffix}.`;
    },
    deniedTool: ({ tool, reason }: { tool: string; reason?: string }) =>
      reason
        ? `The permission settings denied the ${tool} tool: ${reason}`
        : `The permission settings denied the ${tool} tool.`,
    authRetry: ({
      seconds,
      attempt,
      total,
    }: {
      seconds: number;
      attempt: number;
      total: number;
    }) =>
      `Claude Code is refreshing its sign-in while another process holds the refresh lock; next try in ${count(seconds, "second", "seconds")} (attempt ${attempt} of ${total}).`,
    /** Added to "started" lines when a turn may take longer than usual. */
    timeoutLimit: ({ minutes }: { minutes: number }) =>
      `waits up to ${count(minutes, "minute", "minutes")}`,
    timedOut: ({ executable, minutes }: { executable: string; minutes: number }) =>
      `${executable} timed out after ${count(minutes, "minute", "minutes")}. A higher reasoning effort or a large project needs more time: lower the effort, choose a faster model, or raise BELLPR_AGENT_TIMEOUT_SCALE.`,
  },
  /** Git, gh and agent CLI processes. */
  command: {
    timedOut: ({ executable }: { executable: string }) =>
      `${executable} timed out.`,
    outputTooLarge: ({ executable }: { executable: string }) =>
      `${executable} produced more output than the safety limit allows; make the task smaller.`,
    spawnFailed: ({ executable, reason }: { executable: string; reason: string }) =>
      `${executable} could not start: ${reason}`,
    failed: ({ executable, output }: { executable: string; output: string }) =>
      `${executable} failed: ${output}`,
  },
  /** Publishing a run's reviewed changes as a pull request. */
  publish: {
    commitMessageInvalid: "A commit message may only contain text and line breaks.",
    invalidBranch:
      "A GitHub branch name may only use letters, digits and . _ - /, must not contain .., and must not end with . or .lock.",
  },
};
