/**
 * The agent team board (English): the team's plan and its approval or
 * revision, the task lanes, retries of failed subtasks and the team mailbox.
 * Task statuses come from `common.teamTaskStatus`.
 */
import { product } from "../../../shared/product";
import type { AgentTeam } from "../../../shared/team";
import type { TeamLaneId } from "../../team/lanes";

const taskCount = (count: number) =>
  count === 1 ? "1 task" : `${count} tasks`;
const subtaskCount = (count: number) =>
  count === 1 ? "1 subtask" : `${count} subtasks`;

const team = {
  /** A run created before the team board existed. */
  legacy: {
    title: "This run uses the earlier workflow",
    body: "New runs use the shared task board, dependency scheduling and a separate working directory for each teammate. The original run log is kept below.",
  },
  boardLabel: "Shared tasks and team messages",
  title: "Agent team",
  runtime: {
    demo: "Sample team collaboration",
    engine: ({ provider }: { provider: string }) => provider,
    capacity: ({ count }: { count: number }) =>
      count === 1
        ? "Up to 1 member works at a time"
        : `Up to ${count} members work at the same time`,
  },
  flow: {
    plan: "Lead plans",
    approve: "You approve the plan",
    autoApprove: "Plan runs automatically",
    parallel: "Teammates work in parallel",
    integrate: "Integration and review",
  },
  /** A run waiting in the queue; its team phase is still "planning". */
  queued: "Waiting to start",
  phase: {
    planning: "The lead is planning",
    awaiting_approval: "Waiting for you to approve the plan",
    developing: "Teammates are working together",
    integrating: "The lead is integrating",
    reviewing: "Cross-review in progress",
    complete: "Team work is complete",
    failed: "A problem with the run needs your attention",
    cancelled: "The team was stopped",
  } satisfies Record<AgentTeam["phase"], string>,
  progress: ({ done, total }: { done: number; total: number }) =>
    `${done} / ${total} subtasks done`,
  plan: {
    queued:
      "The run is in the queue. The lead starts planning as soon as it can run.",
    replanning: "The lead is re-planning with your feedback.",
    /** A team that stopped before the lead's plan was ready. */
    none: "The team stopped before the Lead finished a plan.",
    reading:
      "Reading the project and building a plan with clear scopes and dependencies.",
    /** The toggle of a long plan, folded to its first lines. */
    showAll: "Show the whole plan",
    showLess: "Show less of the plan",
  },
  revisions: {
    label: "Plan revision history",
    title: ({ number }: { number: number }) => `Sent back, round ${number}`,
    previousTasks: ({ count, titles }: { count: number; titles: string }) =>
      `The previous plan had ${taskCount(count)}: ${titles}`,
    /** Bold label in front of the feedback; it ends with its own separator. */
    feedback: "Your feedback: ",
    /** Bold label in front of the lead's notes; it ends with its own separator. */
    notes: "The lead's notes on the changes: ",
    replanning: "Re-planning…",
    noNotes:
      "The lead did not describe the changes; compare the old and new tasks directly.",
  },
  approval: {
    hint: "Check each task's file scope and dependencies before you allow code to be written.",
    approve: "Approve the plan and start development",
  },
  revise: {
    action: "Send back with feedback",
    hint: "Split looks wrong, scope too large, a test task missing or odd dependencies? Say why and the Lead re-plans. Good practice in splitting work.",
    label: "Feedback on the plan",
    placeholder:
      "For example: split the API and the UI into two tasks, and add a task that only writes tests.",
    limitReached:
      "The revision limit is reached. Approve the current plan or cancel the run.",
    counter: ({ count, max }: { count: number; max: number }) =>
      `Revised ${count}/${max}. Each revision makes the Lead plan once more, without writing code.`,
  },
  retry: {
    partial: ({ kept, retried }: { kept: number; retried: number }) =>
      `${subtaskCount(kept)} already integrated won't rerun. ${subtaskCount(retried)} that failed or ${retried === 1 ? "was blocked restarts from a fresh snapshot, discarding its old working directory" : "were blocked restart from a fresh snapshot, discarding their old working directories"}.`,
    integrationOnly:
      "All subtasks are integrated; a retry only runs the Lead's integration and the independent review again.",
    notStarted:
      "Some subtasks have not started yet; if the plan is not approved, a retry first goes back to waiting for approval.",
    label: "Note for the retried subtasks",
    placeholder:
      "Optional: a note for the retried members, delivered in their first turn",
    action: "Retry failed subtasks",
  },
  lanes: {
    todo: "To do",
    running: "In progress",
    done: "Done",
  } satisfies Record<TeamLaneId, string>,
  /** An empty lane's message, chosen by lane id. */
  laneEmpty: {
    todo: "No subtask is waiting",
    running: "No subtask is running right now",
    done: "No subtask has finished yet",
  } satisfies Record<TeamLaneId, string>,
  /** The to-do lane while the lead plans. */
  laneEmptyPlanning: "Subtasks appear here once the Lead's plan is ready.",
  /** The running lane while the plan waits for approval. */
  laneEmptyAwaiting: "Subtasks start once you approve the plan.",
  task: {
    details: "Assignment and files",
    worktree: "Own working directory",
    worktreeRemoved: "Working directory removed",
    filesPending: "Being planned",
    dependsOn: "Depends on",
    dependencyUnknown: "Unknown",
    readyAfterRetry: "Ready after retry",
    integrated: ({ files }: { files: string }) => `Integrated: ${files}`,
    /** The toggle of a long task description, folded to its first lines. */
    showAll: "Show the whole description",
    showLess: "Show less of the description",
    showError: "View the failure reason",
    showReport: "View the work report",
    checks: ({ count }: { count: number }) =>
      `The app saw ${count === 1 ? "1 command" : `${count} commands`} run (exit codes only, no output captured). Compare them with the checks the report describes.`,
  },
  mailbox: {
    title: "Team conversation",
    delivery: {
      planning:
        "The lead is planning. Once the plan is ready, you can send the members more instructions.",
      leadDuringApproval: ({ action }: { action: string }) =>
        `To change the plan, use “${action}” above so the Lead re-plans. Messages here are only read in the integration turn.`,
      lead: "The lead reads messages in the next integration turn and does not re-plan. Send development instructions to everyone or to a specific teammate.",
      members:
        "Messages arrive at the next work turn. A turn in progress is not interrupted.",
    },
    you: "You",
    everyone: "Everyone",
    queued: "Waiting for the next turn",
    delivered: "Delivered",
    sample: "Sample",
    empty:
      "Add constraints, ask about the design, or remind members about changed dependencies.",
    sendTo: "Send to",
    recipientLabel: "Team message recipient",
    teamLead: "Team lead",
    closedRecipient: ({ name }: { name: string }) =>
      `${name} (no longer receiving)`,
    messageLabel: "Team message",
    /** Accessible name of the scrollable message list. */
    messagesLabel: "Team messages",
    finishedPlaceholder:
      "This team has finished. Ask follow-up questions on the Code changes tab.",
    placeholder: "For example: keep the current API compatible…",
    demoHint: "Sample messages stay on this screen only",
    hint: "Sent messages are kept in the run record",
    send: "Send team message",
    unavailable:
      "This task no longer receives messages. Choose the Lead or another teammate.",
  },
  /** The model and AI usage cards, folded together. */
  runDetails: {
    title: "Run details",
    hint: "Model, reasoning effort and AI usage",
    calls: ({ count }: { count: number }) =>
      count === 1 ? "1 AI call" : `${count} AI calls`,
    tokens: ({ input, output, partial }: { input: string; output: string; partial: boolean }) =>
      `${input} input · ${output} output tokens${partial ? " (partly reported)" : ""}`,
    /** Calls ran but none reported usage: unknown, not zero. */
    unreported: "usage not reported",
  },
  /**
   * What agents could not run because this machine lacks something, on the
   * run's overview: one list, each command once, with who reported it.
   */
  setupNeeds: {
    title: "Setup this computer needs from you",
    intro:
      "The Agent couldn't finish these checks with its permissions and environment. Check each suggested command against the project's documentation first. After installing, rerun the checks in the working directory; later contributions run them directly. With Full access, the Agent can try installing first; password prompts and what it can't resolve still need you.",
    reportedBy: ({ names }: { names: string }) => `Reported by ${names}`,
    /** Who reported a need: a follow-up round, by its number among the run's rounds. */
    round: ({ number }: { number: number }) => `Follow-up round ${number}`,
    /** …or a teammate, by its name and the id the task board shows. */
    agent: ({ name, id }: { name: string; id: string }) => `${name} (${id})`,
    /** Handing the list to an agent on a Full access run (src/team/SetupHandOff.tsx). */
    handOffAction: "Let the Agent set this up",
    handOffNote:
      "With Full access, an Agent can install your chosen items unsandboxed, under your account, then rerun the checks they blocked. You confirm the exact commands first.",
    handOffUnsafe: `${product.name} never hands this command to an Agent: it downloads and runs or chains something, or pipes into a shell or interpreter. Check and run it yourself.`,
    allHandled:
      "The Agent reports every item it can take as installed or already present (details: Collaborate tab). Run what's left here yourself.",
    outcomeLine: ({ outcome, time }: { outcome: string; time: string }) => `Agent reports: ${outcome} (${time})`,
    unreportedLine: ({ time }: { time: string }) => `The setup turn at ${time} ended without a result for this item.`,
    resultsTitle: "Setup results (the Agent's report)",
    agentAccount: "The Agent's note:",
    outcomes: {
      installed: "installed",
      present: "already present",
      failed: "failed",
      needsYou: "needs you",
      unreported: "no result",
    },
    dialog: {
      title: "Let the Agent set up this computer?",
      intro:
        "Earlier Agents suggested these commands; check them. The Agent runs only ticked ones matching the project's documentation. It may add non-interactive flags like -y, use sudo -n and refresh the package index, but never swaps in another command. Then it verifies each item, reruns blocked checks and reports.",
      choose: "Commands to hand over",
      sudoTag: "uses sudo",
      limit: ({ limit }: { limit: number }) =>
        `At most ${limit} items per turn; the rest stay on the list for the next turn.`,
      sudoPasswordless: ({ user }: { user: string }) =>
        `${user} has passwordless sudo here, so the Agent can run these sudo commands as root, unless a sudo rule restricts them.`,
      sudoPassword: ({ user }: { user: string }) =>
        `sudo asks ${user} for a password here, and the Agent never enters one, so sudo items come back to you unless a sudo rule allows them passwordless. Or turn on Passwordless sudo in the model settings, which gives every process under your account root.`,
      sudoMissing: "sudo is not installed here, so items that need it come back to you.",
      sudoUnknown: `${product.name} could not tell whether sudo needs a password here. The Agent uses only sudo -n; a password prompt returns that item to you.`,
      runs: "The Agent runs without the sandbox, with your account. Usage counts against your own account.",
      review:
        "The Agent is told not to change code; any file it changes (say, a rewritten lockfile) loses its review mark. Changes to files or the PR draft's Validation and Limitations return an approved contribution to review.",
      stop: "Follow and stop it on the Collaborate tab. Stopping does not undo what was installed. An install already started through sudo may finish anyway.",
      confirm: ({ count }: { count: number }) =>
        `Start the Agent (${count === 1 ? "1 command" : `${count} commands`})`,
      starting: "Starting the Agent…",
    },
  },
  /** The disclosure holding the protocol note. */
  /** A Learn-by-hand run's log names its one agent role so (DESIGN v1.2 §12). */
  guide: "The guide",
  howItWorks: "How it works",
  protocolNote: ({ provider }: { provider: string }) =>
    `${product.name} runs its own coordination, turn by turn through ${provider}: shared tasks, separate working directories, messages between turns. It is not Claude Code's native Agent Teams.`,
};

export default team;
