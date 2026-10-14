import { formatters } from "../../../shared/i18n/locale.js";

const fmt = formatters("en");
/** A number with its noun in the matching form: "1 file", "3 files". */
const count = (n: number, one: string, other: string) =>
  `${fmt.number(n)} ${fmt.plural(n) === "one" ? one : other}`;
/** File names and similar items, separated as the locale separates a plain list. */
const list = (items: readonly string[]) => fmt.list(items, { type: "unit" });

/** Run pipeline messages: run logs, agent details and run errors. */
export default {
  /** What an agent card says the agent is doing (its `detail`). */
  agents: {
    lead: "Analysing the project and breaking down the request",
    reviewer: "Reviewing correctness and maintainability independently",
    tester: "Checking the test evidence and regression risk",
    member: "Waiting to claim a shared task; works in its own directory",
    memberRetry: "Waiting to claim the task again in a new working directory",
    running: ({ cli }: { cli: string }) => `Running ${cli}…`,
    waitingForSlot: ({ queued }: { queued: number }) =>
      `Waiting for other agents to finish (${queued} queued)`,
    complete: "Done; the report is ready to read",
    failed: "Stopped or failed",
  },
  /** Starting, queueing, approving and cancelling runs. */
  queue: {
    runNotFound: "Run not found.",
    claudeMissing:
      "Claude Code CLI is not installed. Install it, then run claude auth login.",
    claudeSignedOut:
      "Claude Code is not signed in. Run claude auth login in a terminal first.",
    codexMissing: "Codex CLI is not installed. Install it, then run codex login.",
    codexSignedOut: "Codex is not signed in. Run codex login in a terminal first.",
    full: ({ max }: { max: number }) =>
      `Up to ${max} runs can be queued or in progress at once; wait for one to finish.`,
    teamStopped:
      "The team has stopped working on this run; ask about the code in the follow-up chat instead.",
    noPlanToApprove: "No team plan is waiting for approval.",
    planApproved:
      "Approved the task split and file scopes; the team is queued for development.",
    feedbackLength: "Feedback on the plan must be 1 to 4000 characters.",
    revisionLimit: ({ max }: { max: number }) =>
      `The plan was already revised ${count(max, "time", "times")}; approve the current plan, or cancel and start a new run with an adjusted request.`,
    planSentBack: ({ revision, max }: { revision: number; max: number }) =>
      `Sent the plan back with feedback (revision ${revision} of ${max}); the lead will plan again.`,
    cancelNotAllowed:
      "Only queued, running or plan-approval runs can be cancelled.",
    cancelRequested:
      "Cancellation requested. The isolated working directories of failed or cancelled tasks are kept; those of integrated tasks were removed. Use “Retry failed subtasks” to continue.",
  },
  /** The team's turns, tasks and phases in a run's log. */
  team: {
    /** The first line of every agent turn; a missing model or effort is the CLI's own default. */
    started: ({
      name,
      cli,
      model,
      effort,
      web,
      timeout,
      inbox,
    }: {
      name: string;
      cli: string;
      model?: string;
      effort?: string;
      web: boolean;
      /** For example "waits up to 15 minutes" (agentCli.timeoutLimit). */
      timeout?: string;
      inbox: number;
    }) =>
      `${name} started. Model: ${model ?? `${cli} CLI default (not recorded)`}; reasoning effort: ${effort ?? "model default"}${web ? "; web access allowed" : ""}${timeout ? `; ${timeout}` : ""}.${inbox ? ` ${count(inbox, "team message", "team messages")} arrived at the start of this turn.` : ""}`,
    waitingForSlot: ({ queued }: { queued: number }) =>
      `Waiting for other agents to finish (${queued} queued).`,
    structuredResult:
      "Structured result returned; checking its sources and content.",
    checkFinished: ({ outcome }: { outcome: string }) =>
      `Check finished (${outcome}).`,
    fileUpdated: ({ path }: { path: string }) => `Updated ${path}.`,
    filesUpdated: "Updated files in the working directory.",
    webSearch: ({ detail }: { detail: string }) => `Web search: ${detail}`,
    webFetch: ({ detail }: { detail: string }) => `Read web page: ${detail}`,
    reportedModel: ({
      cli,
      model,
      requested,
      version,
    }: {
      cli: string;
      model: string;
      requested?: string;
      version?: string;
    }) =>
      `${cli} reported the model in use: ${model} (${requested ? `--model ${requested} was passed` : "no --model was passed"}${version ? `, CLI ${version}` : ""}).`,
    noReport: ({ cli }: { cli: string }) => `${cli} returned no report.`,
    noTeam: "This run has no agent team.",
    messageTargetClosed:
      "This member or task has finished and cannot take messages; send it to the lead.",
    messageLength: "Team messages must be 1 to 4000 characters.",
    messageLimit: "This run has reached its limit of 200 team messages.",
    messageQueued: ({ to }: { to: string }) =>
      `Queued a team message for ${to}; it is delivered at the start of the next turn.`,
    taskClaimed: ({ title }: { title: string }) =>
      `Claimed task ${title}; its own working directory and file scope are ready.`,
    messageNotQueued: ({ reason }: { reason: string }) =>
      `Coordination message not queued: ${reason}`,
    turnLimit:
      "Reached the limit of 3 turns per task; undelivered messages stay in the team inbox for the lead to review during integration.",
    taskIntegrated: ({ title, files }: { title: string; files: string[] }) =>
      files.length
        ? `${title} is done; integrated ${count(files.length, "file", "files")} that passed the scope check: ${list(files)}.`
        : `${title} is done; it changed no files to integrate.`,
    checkoutRemoved: ({ owner }: { owner: string }) =>
      `The integrated changes are now in this run's worktree, so ${owner}'s separate checkout was removed.`,
    checkoutNotRemoved: ({ task, reason }: { task: string; reason: string }) =>
      `Could not remove the isolated working directory of ${task}; you can delete it by hand: ${reason}`,
    taskFailed: "The task failed.",
    stuck:
      "Task dependencies or file assignments stop the team from continuing; check the shared task list.",
    creatingWorktree: "Creating a separate Git worktree.",
    legacyRun:
      "Older runs cannot be assigned to a team again; start a new agent team run.",
    planCreated: ({ tasks, max }: { tasks: number; max: number }) =>
      `Created ${count(tasks, "task", "tasks")} with dependencies and file scopes; up to ${count(max, "teammate works", "teammates work")} at once.`,
    awaitingApproval:
      "Waiting for you to approve the plan; no code has been changed yet.",
    noChanges:
      "The agent team produced no code changes. Check the task reports or adjust the direction.",
    done: ({ files }: { files: number }) =>
      `Team development and the independent review are done: ${count(files, "changed file waits", "changed files wait")} for your file-by-file review.`,
    draftIncomplete: "The PR draft suggestion did not finish; try again.",
    runFailed: "The run failed.",
    retryNotAllowed:
      "Only failed or cancelled team runs whose lead already made a plan can be retried.",
    stillStopping: "This run is still finishing; try again in a moment.",
    retryAwaitingApproval:
      "Retry requested; the plan is not approved yet, so it waits for approval again.",
    retryTasks: ({ kept, retried }: { kept: number; retried: number }) =>
      `Retrying failed subtasks: ${count(kept, "completed task is", "completed tasks are")} kept, and ${count(retried, "task starts", "tasks start")} again from a fresh snapshot.`,
    retryIntegration:
      "Retry: every subtask is complete, so only integration and the independent review run again.",
    retryPending: "Retry: continuing with the subtasks that have not started.",
  },
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
  /** The projects BELL works on and its own clones of them. */
  repos: {
    notFound: "Repository not found.",
  },
  /** Publishing a run's reviewed changes as a pull request. */
  publish: {
    commitMessageInvalid: "A commit message may only contain text and line breaks.",
    invalidBranch:
      "A GitHub branch name may only use letters, digits and . _ - /, must not contain .., and must not end with . or .lock.",
  },
};
