import { formatters } from "../../../shared/i18n/locale.js";
import { product } from "../../../shared/product.js";

const fmt = formatters("en");
/** A number with its noun in the matching form: "1 file", "3 files". */
const count = (n: number, one: string, other: string) =>
  `${fmt.number(n)} ${fmt.plural(n) === "one" ? one : other}`;
/** File names and similar items, separated as the locale separates a plain list. */
const list = (items: readonly string[]) => fmt.list(items, { type: "unit" });
const followUpAgentCommitted =
  "The agent made its own commit or switched branches; the branch is back on the pushed PR, and the edits stay in the working directory for your review.";

/** Words for a fork-lookup failure code. The code itself is not shown. */
function forkLookupDetail(reason: string) {
  switch (reason) {
    case "rate-limited":
      return "GitHub rate-limited the request";
    case "not-ready":
      return "the new fork was not ready";
    case "unconfirmed":
      return "an existing fork could not be ruled out";
    case "invalid-response":
      return "GitHub returned an unreadable response";
    case "timeout":
      return "GitHub did not answer in time";
    default:
      return reason.startsWith("HTTP ")
        ? `GitHub returned ${reason}`
        : "GitHub returned an error";
  }
}

/** Run pipeline messages: run logs, agent details and run errors. */
export default {
  /** Logged once on a run whose Claude agent ran without the OS sandbox. */
  unsandboxedNotice:
    "This Claude agent ran without the OS sandbox because unsandboxed Claude agents are allowed (in Settings or with BELLPR_ALLOW_UNSANDBOXED_AGENTS=1).",
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
    rerunWaiting: "Waiting to review again…",
    sync: "Resolving the merge conflicts a sync left",
    syncResolved: "Conflicts resolved; waiting for review",
    syncUnresolved: "Conflicts remain, or the work stopped",
    followUp: "Revising from maintainer feedback",
    followUpDone: "Revision done; waiting for review",
    followUpStoppedKept: "Revision stopped; its edits wait for review",
    followUpStopped: "Revision stopped or changed nothing",
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
      "Only runs that are queued, running or waiting for plan approval can be cancelled.",
    cancelRequested:
      "Cancellation requested. The isolated working directories of failed or cancelled tasks are kept; those of integrated tasks were removed. Use “Retry failed subtasks” to continue.",
  },
  /** The team's turns, tasks and phases in a run's log. */
  team: {
    /** The name a Learn-by-hand run's turns start with in its log: its one agent role is the guide (DESIGN v1.2 §12). */
    guideName: "The guide",
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
    /**
     * A success that does not show the commands in the line succeeded, as in
     * `npm test | tail` (tail's status) or `npm test || true`; outcome is
     * "exit 0" (Codex) or commandSucceeded (Claude Code).
     */
    commandUnverified: ({ outcome }: { outcome: string }) =>
      `${outcome}, not verified: another command run with it can hide a failure`,
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
  /** The unchanged code around a modified file's changes, read from the run's base. */
  context: {
    notAFile:
      "A submodule or special entry has no code to show around its changes.",
    tooLarge:
      "The file is larger than 512 KB, so the code around its changes cannot be shown.",
    binary: "A binary file has no code to show around its changes.",
    credentials:
      "The file looks like it contains credentials, so the code around its changes is not shown.",
    blocked:
      "This file cannot be reviewed right now, so the code around its changes is not shown either.",
    stale: "The file's changes were updated; refresh the changes.",
    baseMoved: "The run's base was updated; refresh the changes.",
    wholeFile: "Added and deleted files are already shown whole.",
    unreadable: "The file cannot be read or is larger than 512 KB.",
  },
  /** The commits of a published contribution, and why one file's change is not shown. */
  commits: {
    notFound: "This commit is not part of the contribution.",
    unsupportedName: "The file name contains unsupported characters.",
    sensitive: "A sensitive file or build artifact; its content is not shown.",
    binary: "A binary file; its content is not shown.",
    tooLarge: "The change is larger than 600 KB; its content is not shown.",
    credentials: "The change looks like it contains credentials; its content is not shown.",
  },
  /** Checking the request's assumption again on a finished run. */
  premise: {
    tooEarly: "Wait for development to finish before checking the premise.",
    busy: "An agent, a review or an explanation is still working on this run; check the premise once it finishes.",
    incomplete: "The agent's premise check was incomplete.",
    /** One line in the run's log; `changed` says whether the verdict is new. */
    checked: ({ verdict, changed }: { verdict: "holds" | "refuted" | "unclear"; changed: boolean }) =>
      `Premise check: ${{ holds: "the assumption holds", refuted: "the assumption does not hold", unclear: "the assumption could not be confirmed" }[verdict]}. ${changed ? "The code walkthroughs, and the explanations not answered yet, are made again with this verdict." : "The verdict did not change."}`,
    noAssumption: "Premise check: the request states no assumption to check.",
  },
  /** Function walkthroughs: the code around each change, step by step. */
  walkthrough: {
    wholeFile:
      "An added or deleted file has no earlier logic to walk through; see the explanation.",
    noFunctions: "This kind of file has no functions to walk through.",
    tooLarge:
      "The changes are larger than 100 KB, so no code walkthrough is made automatically.",
    overLimit: ({ limit }: { limit: number }) =>
      `This change touches more than ${limit} code files, and code walkthroughs are made automatically for the first ${limit} only; ask about the others in the Ask tab.`,
    incomplete: "The agent's code walkthrough was incomplete.",
    tooEarly: "Wait for development to finish before generating code walkthroughs.",
    stopped: "The code walkthrough stopped; you can retry it.",
    failed: "Generating the code walkthrough failed; try again.",
    notFinished: ({ path, reason }: { path: string; reason: string }) =>
      `The code walkthrough of ${path} did not finish: ${reason}`,
    /** A unit the agent left unnamed, by its first line. */
    lineName: ({ line }: { line: number }) => `Line ${line}`,
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
  /** Explanations, notes, questions, maintainer feedback and review reruns on a finished run. */
  review: {
    rerunNotAllowed:
      "Only runs that are in review or approved can have their review run again.",
    rerunRunning:
      "The review of this run is already running again; wait for it to finish or stop it first.",
    nothingToReview: "There are no code changes to review.",
    rerunRequested: ({ files }: { files: number }) =>
      `Requested a new independent review of the ${count(files, "changed file", "changed files")} in the current working directory.`,
    rerunDone:
      "The independent review is updated. The reports are advice: review marks and approval are unchanged.",
    rerunStopped:
      "Stopped the new review; the earlier reports and review marks are kept.",
    rerunIncomplete: "The new review did not finish.",
    explanationsTooEarly:
      "Wait for development to finish before generating explanations.",
    fileNotFound: "This changed file was not found.",
    explanationsStopped:
      "Generating explanations stopped; the finished code changes are kept and you can retry the explanations.",
    explanationsFailed: "Generating the explanations failed; try again.",
    explanationsCancelled: "Generating explanations was cancelled.",
    notesTooEarly:
      "Wait for development to finish before writing down what you understood.",
    chatTooEarly: "Wait for development to finish before asking questions.",
    chatUnavailable: "This file cannot be discussed right now.",
    feedbackUnpublished:
      "The PR has not been sent yet, so there is no maintainer feedback to read.",
    feedbackMismatch:
      "The PR URL does not match this repository, so its feedback cannot be read.",
    githubInvalidJson: "GitHub's response is not valid JSON.",
    feedbackRead: ({ number, items }: { number: number; items: number }) =>
      `Read the maintainer feedback on PR #${number}: ${count(items, "item", "items")}.`,
  },
  /** PR draft suggestions. */
  draft: {
    notForRound:
      "A follow-up round only pushes a new commit and leaves the PR description unchanged, so no draft suggestion is needed.",
    cancelled: "Generating the PR draft was cancelled.",
    stale:
      "The code changes were updated; generate a new PR draft suggestion that matches them.",
    applied:
      "Put the PR draft suggestion in the editor. This is the model's own text: before you send it, check it in your own words and work through the checklist and checkboxes.",
    ready:
      "The PR draft suggestion is ready and your current draft is kept; review and apply it in the PR draft area.",
    stopped:
      "Generating the PR draft suggestion stopped; your current draft and the finished changes are kept, and you can generate it again.",
    failed: "Generating the PR draft suggestion failed; try again.",
    incomplete: "The PR draft suggestion did not finish.",
  },
  /** Syncing a run onto the latest target branch and resolving its conflicts. */
  sync: {
    partlyPublished:
      "An earlier publish already made a commit that may be on GitHub, so this run can no longer be synced or have a sync undone; start a new run from the latest version.",
    unmarkedRun: ({ files }: { files: string[] }) =>
      `These files conflict in a way conflict markers cannot show (deleted on one side and changed on the other, or a binary file changed on both), and ${product.name} does not pick a side for you: ${list(files)}. The run is unchanged; you can first undo this run's changes to them or deletions of them, sync, and then make those changes again.`,
    unmarkedPr: ({ files, branch }: { files: string[]; branch: string }) =>
      `These files conflict in a way conflict markers cannot show (deleted on one side and changed on the other, or a binary file changed on both), and ${product.name} does not pick a side for you: ${list(files)}. The PR is unchanged; merge ${branch} into the PR branch with git on your machine and push, and ${product.name} takes over those commits afterwards.`,
    notAllowed:
      "Only runs in review, approved or waiting for plan approval can sync to the latest target branch.",
    busy: "Agents, a review or explanations are still working on this run; wait for them to finish before you sync.",
    busyUndo:
      "Agents, a review or explanations are still working on this run; wait for them to finish before you undo the sync.",
    busyResolve:
      "Agents, a review or explanations are still working on this run; wait for them to finish before you resolve the conflicts.",
    baseMismatch:
      "The run's branch commit does not match its recorded base, so the sync stopped.",
    baseMismatchUndo:
      "The run's branch commit does not match its recorded base, so the undo stopped.",
    upToDate: ({ branch }: { branch: string }) =>
      `Checked ${branch}: it has no new commits, so the run is up to date.`,
    synced: ({
      branch,
      commit,
      conflicts,
    }: {
      branch: string;
      commit: string;
      conflicts: string[];
    }) =>
      conflicts.length
        ? `Synced onto the latest ${branch} (${commit}); ${count(conflicts.length, "file has", "files have")} conflicts to resolve: ${list(conflicts)}.`
        : `Synced onto the latest ${branch} (${commit}) without conflicts; the changed files need another review.`,
    prOnly: "Only a sent PR can take in its target branch.",
    roundOpen:
      "A follow-up round is in progress on this PR; finish or discard it before you sync.",
    prCheckoutDiffers:
      "The working directory differs from the pushed PR; undo the changes in it before you sync.",
    prUpToDate: ({ branch }: { branch: string }) =>
      `Checked: the PR already contains the latest ${branch}.`,
    nothingToMerge: ({ branch }: { branch: string }) =>
      `${branch} already contains every change of this PR, so merging would change nothing and no sync was made; the PR is unchanged, and you may want to close it.`,
    prSynced: ({
      branch,
      commit,
      conflicts,
    }: {
      branch: string;
      commit: string;
      conflicts: string[];
    }) =>
      conflicts.length
        ? `Merged the latest ${branch} (${commit}) into the PR; ${count(conflicts.length, "file has", "files have")} conflicts to resolve: ${list(conflicts)}.`
        : `Merged the latest ${branch} (${commit}) into the PR without conflicts; after your review, one merge commit is pushed.`,
    nothingToUndo: "There is no sync to undo.",
    undone:
      "Undid the sync; the run is back to the content and base it had before.",
    noConflicts: "There are no sync conflicts to resolve.",
    conflictsGone:
      "Every conflict marker is already resolved; the agent is not needed.",
    resolveRequested: ({ files }: { files: string[] }) =>
      `Asked the agent to resolve the merge conflicts in ${count(files.length, "file", "files")}: ${list(files)}.`,
    agentCommitted:
      "The agent made its own commit or switched branches; that was undone, and its edits stay in the working directory for your review.",
    markersLeft: ({ files }: { files: string[] }) =>
      `Conflict markers remain: ${list(files)}.`,
    resolved:
      "The agent resolved the merge conflicts; review these files one by one.",
    stillConflicted: ({ files }: { files: string[] }) =>
      `Conflict markers remain after the agent: ${list(files)}; edit them yourself or ask the agent again.`,
    stopped:
      "Stopped resolving the conflicts; the edited files are kept, and you can finish yourself or ask the agent again.",
    /** `reason` is an error message without its final period. */
    failed: ({ reason }: { reason: string }) =>
      `${reason}; the edited files are kept, and you can finish yourself or ask the agent again.`,
    incompleteReason: "Resolving the conflicts did not finish",
    incomplete: "Resolving the conflicts did not finish.",
    conflictsOpen: ({ files }: { files: string[] }) =>
      `These files still have merge conflict markers: ${list(files)}. Resolve the conflicts first (the agent can do it for you).`,
    mergeFailed: "Could not compute the merge result.",
    answerIncomplete:
      "The agent's answer about the conflict resolution is incomplete",
  },
  /** Follow-up rounds on a published PR, and its branch on GitHub. */
  followUp: {
    inProgress: "A follow-up round is already in progress on this run.",
    busy: "A follow-up round or a review is already in progress on this run.",
    notPublished:
      "Only a run whose PR has been sent can start a follow-up round from its review.",
    feedbackNotInLatest:
      "The selected feedback is not in the latest feedback read; read the feedback again, then choose.",
    inputRequired:
      "Choose at least one feedback item, or describe what this round should change.",
    checkoutDiffers:
      "The working directory differs from the pushed PR; undo the changes in it before you start a round.",
    requested: ({
      feedback,
      note,
      round,
    }: {
      feedback: number;
      note: boolean;
      round: number;
    }) =>
      note
        ? `Requested follow-up round ${round} from ${count(feedback, "maintainer feedback item", "maintainer feedback items")} and your note.`
        : `Requested follow-up round ${round} from ${count(feedback, "maintainer feedback item", "maintainer feedback items")}.`,
    agentCommitted: followUpAgentCommitted,
    noChanges:
      "The agent changed no files; read its explanation below and, if needed, adjust the selected feedback or your note and try again.",
    done: ({
      round,
      agentCommitted,
    }: {
      round: number;
      agentCommitted: boolean;
    }) =>
      `Follow-up round ${round} is done; review the files this round changed one by one and check the commit message before you push.${agentCommitted ? ` ${followUpAgentCommitted}` : ""}`,
    stoppedReason: "This round was stopped",
    incompleteReason: "This round did not finish",
    /** `reason` is one of the reasons above or an error message. */
    keptEdits: ({ reason }: { reason: string }) =>
      `${reason}; some edits are kept in the working directory, and you can review them, write a commit message and push, or discard the round.`,
    nothingToDiscard: "There is no follow-up round to discard.",
    alreadyPushed:
      `This round is already on the PR; press Push again so ${product.name} records it as done.`,
    discarded:
      "Discarded the follow-up round; the working directory is back to the pushed PR.",
    /** Discarding a round whose working files were already removed. */
    discardedWithoutFiles:
      "Discarded the follow-up round; its changes went with the working files removed earlier.",
    answerIncomplete: "The agent's answer about the round is incomplete",
    pushUnknown: "Cannot confirm whether this round was pushed to the PR.",
    remoteMoved: ({ branch }: { branch: string }) =>
      `The PR branch ${branch} on GitHub has commits from outside ${product.name} (for example a suggestion applied on GitHub, a maintainer's push or an updated branch). ${product.name} does not overwrite them and cannot continue the round; handle it on GitHub or discard the round.`,
    remoteMissing: ({ branch }: { branch: string }) =>
      `The PR branch ${branch} is not on GitHub, so the round cannot be pushed.`,
    historyRewritten: ({ branch }: { branch: string }) =>
      `The PR branch ${branch} on GitHub rewrote history that ${product.name} pushed (for example with a force push), so ${product.name} cannot continue; handle it on GitHub.`,
    adoptedReport: ({ commits }: { commits: number }) =>
      `Took over ${count(commits, "commit", "commits")} made on GitHub outside ${product.name}; their changes are reviewed with the next round.`,
    adopted: ({ branch, commits }: { branch: string; commits: number }) =>
      `Took over ${count(commits, "commit", "commits")} on the PR branch ${branch} on GitHub (for example an applied suggestion or Update branch); their changes are reviewed with the next round.`,
  },
  /** What a run says after the service restarted in the middle of its work. */
  recovery: {
    unreadableState: ({ path, reason }: { path: string; reason: string }) =>
      `Cannot read ${path}: ${reason}. Check that the file is valid JSON (version 1).`,
    /** The `reason` above for JSON that is not a version 1 state; no final period. */
    invalidStateFormat: "Invalid state format",
    draft:
      "The service restarted, so the PR draft suggestion stopped; your current draft is kept, and you can generate the suggestion again.",
    explanation:
      "The service restarted, so generating the explanation stopped; you can retry it.",
    walkthrough:
      "The service restarted, so the code walkthrough stopped; you can retry it.",
    /** An agent card's detail, without a final period. */
    review:
      "The service restarted, so the review rerun stopped; the earlier reports are kept",
    conflicts:
      "The service restarted, so resolving the conflicts stopped; the edited files are kept, and you can finish yourself or ask the agent again.",
    round:
      "The service restarted, so this follow-up round stopped; you can review the edits kept in the working directory, write a commit message and push, or discard the round.",
    run: "The service restarted, so the run stopped. Its working directory is kept and you can read the diff; for a team run, retry the failed subtasks on the task board, and integrated subtasks do not run again.",
    task: "The service restarted, so the task stopped; its isolated working directory is kept, and a retry starts again from a fresh snapshot.",
  },
  /** The projects BELL works on and its own clones of them. */
  repos: {
    notFound: "Repository not found.",
    importSource:
      "Enter a GitHub HTTPS URL or the absolute path of a local repository.",
    bare: "Choose a repository that has a working directory.",
    /** A local path that names no folder; `path` is absolute, with ~/ expanded. */
    pathMissing: ({ path }: { path: string }) =>
      `There is no folder at ${path} on the computer ${product.name} runs on. Check the path; ~/ is the home directory of the user ${product.name} runs as.`,
    /** A local folder that Git does not see as part of a working tree. */
    notGitRepository: ({ path }: { path: string }) =>
      `${path} is not inside a Git repository. Enter the folder of a Git checkout, the one that holds its .git folder.`,
    /** A local-only project: BELL cloned it at import, and it has no GitHub source. */
    localNotUpdated:
      `This project has no GitHub source, so ${product.name} has nothing to update its copy from. To work on newer code, update your own checkout, then remove the project here and import it again.`,
    /** A checkout an earlier build imported in place: the person's own. */
    checkoutNotUpdated:
      `This is your own local repository, and ${product.name} never changes it; run git pull in a terminal yourself, then analyse the project again.`,
    cloneChanged:
      `${product.name}'s copy of the project has unexpected changes, so the update stopped; check it and try again.`,
  },
  /** Splitting a contribution into separate ones (shared/split.ts). */
  split: {
    byHand: "A Learn by hand run is written by you, line by line, so it cannot be split.",
    published: "This contribution is already published, so it cannot be split.",
    alreadySplit: ({ count }: { count: number }) =>
      `This contribution was already split into ${count}. Open one of those, or split one of them.`,
    followUp: "A follow-up round is open on this contribution, so it cannot be split now.",
    unknownPath: ({ path }: { path: string }) =>
      `"${path}" is not a changed file of this contribution.`,
    duplicatePath: ({ path }: { path: string }) =>
      `"${path}" is in more than one contribution; a file goes to only one.`,
    heldBack: ({ path }: { path: string }) =>
      `"${path}" is held back from review, so it cannot be moved; leave it out.`,
    notReproduced:
      "The copied files did not match the originals, so nothing was split. A Git setting that rewrites files, such as line-ending conversion, can cause this.",
    startedFrom: ({ title }: { title: string }) => `Split from "${title}".`,
    wasSplit: ({ count }: { count: number }) => `Split into ${count} contributions.`,
  },
  /** The human review gate and publishing: draft, file reviews, approval and push. */
  publish: {
    commitMessageInvalid: "A commit message may only contain text and line breaks.",
    invalidBranch:
      "A GitHub branch name may only use letters, digits and . _ - /, must not contain .., and must not end with . or .lock.",
    notEditable: "Wait for the run to finish before reviewing or editing.",
    roundKeepsPrText:
      "A follow-up round only pushes a new commit; the PR title and description stay as they are and cannot be changed here.",
    branchIsTarget: ({ branch }: { branch: string }) =>
      `The GitHub branch cannot be the target branch ${branch}: that would push straight to it instead of opening a PR. Use a new branch name.`,
    branchLocked: ({ branch }: { branch: string }) =>
      `An earlier publish already pushed to the GitHub branch ${branch}. After a push the branch cannot change, so that no second PR is opened; restore the branch name or start a new run.`,
    fileChanged:
      "This file's diff changed; reload and review the latest version before you mark it reviewed.",
    draftChanged:
      "The PR draft changed; reload, check the latest title and description, and approve again.",
    reviewAllFirst:
      "Review every latest change and remove the blocked files first.",
    prTextRequired: "Fill in the PR title and description first.",
    roundMessageRequired:
      "Write this follow-up round's commit message and leave no placeholders in it.",
    approvalStale:
      "The approved version changed or expired; reload, review and approve again before you send the PR.",
    approveFirst: "Finish the review and approve the PR first.",
    noGithubOrigin:
      "This repository has no GitHub origin, so it cannot be published.",
    diffChanged:
      "The changes differ from what you approved; review and approve them again.",
    notAllReviewed: "Not every latest change has been reviewed.",
    understandingRequired:
      "Explain the change back before you approve or publish: finish the understanding check for the latest version of the changes. You can turn the check off in Settings → Learning; runs approved without it are marked.",
    prAlreadySent:
      "This PR was already sent; to push new changes, start a follow-up round from the maintainer feedback.",
    branchIsTargetReapprove: ({ branch }: { branch: string }) =>
      `The GitHub branch cannot be the target branch ${branch}; change the branch name and approve again.`,
    branchLockedPublish: ({ branch }: { branch: string }) =>
      `An earlier publish already pushed to the GitHub branch ${branch}; restore the branch name or start a new run.`,
    /** `items` are the preflight messages, each a whole sentence. */
    confirmFirst: ({ items }: { items: string[] }) =>
      `Before sending, confirm each item in the preview: ${items.join(" ")}`,
    githubUserInvalid: "The GitHub user information is not valid.",
    defaultBranchChanged:
      "The remote default branch changed; start a new run from the latest branch.",
    targetMoved:
      "The target branch has new commits; first press “Sync to the latest target branch” on the PR draft tab, review, then send.",
    targetMovedAfterCommit:
      "The target branch has new commits. An earlier publish already made a commit that may be on GitHub, so this run can no longer be synced or have a sync undone; start a new run from the latest version.",
    branchChanged: "The run's branch changed, so publishing stopped.",
    priorCommitDiffers:
      "An earlier publish made a different commit. Start a new run so that a branch that may already be pushed is not overwritten.",
    priorMessageDiffers:
      "The commit of an earlier publish has a different commit message, which cannot change after a push. Restore the commit message or start a new run.",
    notAFork:
      "Your repository with this name is not a fork of the target project; sort out the GitHub fork first.",
    /** `reason` is a short code from the fork lookup, not GitHub's raw body. */
    forkLookupFailed: ({ reason }: { reason: string }) =>
      `Could not look up a fork of this project (${forkLookupDetail(reason)}). Nothing was pushed.`,
    noPrUrl:
      "GitHub returned no PR URL; check on GitHub first so the PR is not published twice.",
    prCreated: "Created the GitHub draft PR.",
    failed: "Publishing failed.",
    failedAfterPush: ({ error }: { error: string }) =>
      `${error} If the push went through, the branch stays on GitHub; check the remote before you retry.`,
    roundReverts: ({ files }: { files: string[] }) =>
      `This follow-up round puts pushed files back to their original version or deletes them: ${list(files)}. ${product.name} cannot show such changes for file-by-file review, so they are not pushed; restore these files or discard the round.`,
    roundMessageMissing: "Write this follow-up round's commit message.",
    roundMessagePlaceholders:
      "The commit message still has placeholders; complete it before pushing.",
    roundNoPushTarget:
      "Cannot find where this PR is pushed, so the round cannot be pushed.",
    roundPushed: ({
      round,
      branch,
      commit,
    }: {
      round: number;
      branch: string;
      commit: string;
    }) => `Pushed follow-up round ${round} to the PR branch ${branch} (${commit}).`,
    branchChangedPush: "The run's branch changed, so pushing stopped.",
    commitChangedPush:
      "The run's branch moved to another commit, so pushing stopped.",
    prMerged: "This PR was merged; no more follow-up rounds can be pushed.",
    prClosed: "This PR was closed; no more follow-up rounds can be pushed.",
    roundEmpty:
      "This follow-up round has no new changes to push; you can discard it.",
    roundCommitDiffers:
      "This follow-up round already made a commit with different content; restore the changes and the commit message before you push, or discard the round.",
    pushFailed: "Pushing failed.",
    stagedFilesDiffer:
      "The files prepared for the commit differ from the approved changes.",
    fileChangedWhileStaging: ({ path }: { path: string }) =>
      `${path} changed while the commit was being prepared; review it again.`,
    filesChangedWhilePublishing:
      "Files changed while publishing was being prepared; review them again.",
  },
};
