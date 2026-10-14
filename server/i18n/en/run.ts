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
  /** Reading a run's changes: limits, and why a file is held back from the PR. */
  diff: {
    unparsable: "Could not parse the Git diff.",
    renameFirst:
      "A file name contains unsupported characters; rename the file first.",
    unsupportedName: "A file name contains unsupported characters.",
    tooManyFiles:
      "The changes cover more than 150 files; make the task smaller and run it again.",
    outsideWorktree: "A file is outside the working directory.",
    tooLarge:
      "The changes are larger than 2 MB; split the work into smaller runs.",
    /** Why a file is held back from the PR (a diff file's `blocked`). */
    blocked: {
      sensitive:
        "Sensitive files and build artifacts are never added to the PR; remove this file from the changes first.",
      notRegularFile:
        "A new file must be a regular file; symbolic links need manual handling.",
      newFileTooLarge:
        "This new file is larger than 512 KB; review it by hand or split it.",
      binary:
        "Binary files need a separate manual review and cannot be published through this workflow.",
      credentials:
        "The change looks like it contains credentials, so its content is hidden; remove them and review it again.",
    },
    /** Shown in place of a held-back file's patch. */
    heldBack: ({ reason }: { reason: string }) =>
      `Publishing this file is on hold: ${reason}`,
  },
  /** Taking a teammate's finished task into the run's worktree. */
  integration: {
    snapshotBlocked:
      "The integration snapshot contains files that cannot be reviewed, so no more tasks are assigned.",
    noWorktree: "The task has no isolated working directory.",
    gitStateChanged:
      "A teammate changed the Git commit state, so integration stopped.",
    outOfScope: ({ path }: { path: string }) =>
      `A teammate changed ${path}, which its task does not own; the change stays in its isolated working directory and was not integrated.`,
    needsManualHandling: ({ path }: { path: string }) =>
      `A teammate's ${path} needs manual handling and was not integrated.`,
  },
  /** Checking the lead's task plan. A problem names its field, as in "tasks[1].title". */
  plan: {
    /** Names the whole plan in a problem without a field path. */
    wholePlan: "plan",
    tooBig: ({
      path,
      maximum,
      items,
    }: {
      path: string;
      maximum: number;
      items: boolean;
    }) =>
      `${path}: more than ${items ? count(maximum, "item", "items") : count(maximum, "character", "characters")}`,
    empty: ({ path }: { path: string }) => `${path}: must not be empty`,
    tooSmall: ({
      path,
      minimum,
      items,
    }: {
      path: string;
      minimum: number;
      items: boolean;
    }) =>
      `${path}: at least ${items ? count(minimum, "item", "items") : count(minimum, "character", "characters")}`,
    wrongType: ({
      path,
      expected,
      received,
    }: {
      path: string;
      expected: string;
      received: string;
    }) => `${path}: expected ${expected}, received ${received}`,
    badFormat: ({ path }: { path: string }) => `${path}: invalid format`,
    /** Any other problem, with zod's own reason. */
    other: ({ path, reason }: { path: string; reason: string }) =>
      `${path}: ${reason}`,
    notJson:
      "The lead did not return a valid task plan in JSON; adjust the request and try again.",
    invalid: ({ problem }: { problem: string }) =>
      `The lead's plan does not match the required format (${problem}); adjust the request and try again.`,
    duplicateIds: "The lead's plan has duplicate or reserved task IDs.",
    invalidDependency: "The lead's plan has an invalid task dependency.",
    invalidScope: ({ scope }: { scope: string }) =>
      `The lead's plan has an invalid file scope: ${scope}`,
    cycle: "The lead's plan has a dependency cycle.",
  },
  /** A teammate's structured report as the one text the board and the lead read. */
  report: {
    /** `checks` are lines such as "- npm test → exit 0". */
    member: ({
      summary,
      checks,
      limitations,
      tradeoffs,
    }: {
      summary: string;
      checks: string[];
      limitations: string;
      tradeoffs: string;
    }) =>
      [
        summary,
        `Validation evidence (commands the member reports it ran):\n${checks.length ? checks.join("\n") : "(The member reported no checks that actually ran.)"}`,
        `Limitations and unmet acceptance criteria:\n${limitations || "(Not reported.)"}`,
        `Design tradeoffs (approaches considered but not taken):\n${tradeoffs || "(Not reported.)"}`,
      ].join("\n\n"),
  },
  /** Publishing a run's reviewed changes as a pull request. */
  publish: {
    commitMessageInvalid: "A commit message may only contain text and line breaks.",
    invalidBranch:
      "A GitHub branch name may only use letters, digits and . _ - /, must not contain .., and must not end with . or .lock.",
  },
};
