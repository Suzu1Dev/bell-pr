/**
 * The agent team board (English): the team's plan and its approval or
 * revision, the task lanes, retries of failed subtasks and the team mailbox.
 * Task statuses come from `common.teamTaskStatus`.
 */
import type { Plan } from "../../../shared/plans";
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
  eyebrow: "SHARED TASKS · INDEPENDENT CONTEXTS",
  title: "Build together, with clear roles and an open conversation.",
  intro:
    "The lead splits up and integrates the work; each teammate has its own working directory and context.",
  runtime: {
    demo: "Sample team collaboration",
    engine: ({ provider }: { provider: string }) =>
      `${provider} · ${product.name} team engine`,
    capacity: ({ count }: { count: number }) =>
      count === 1
        ? "Up to 1 member works at a time"
        : `Up to ${count} members work at the same time`,
    /** The plan's limit for new runs, from the license (Free 2, Pro 4). */
    planLimit: {
      free: ({ count }: { count: number }) =>
        `Free plan: up to ${count} members at once`,
      trial: ({ count }: { count: number }) =>
        `Pro trial: up to ${count} members at once`,
      pro: ({ count }: { count: number }) =>
        `Pro: up to ${count} members at once`,
    } satisfies Record<Plan, (params: { count: number }) => string>,
    /** A run started with more members than the plan now allows. */
    keptSize: "This run keeps the team size it started with.",
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
    none: "The team stopped before the lead finished a plan.",
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
    hint: "If the split does not make sense, the scope is too large, a test task is missing or the dependencies look odd, write down why so the lead re-plans. It is a chance to practice how to split work into tasks.",
    label: "Feedback on the plan",
    placeholder:
      "For example: split the API and the UI into two tasks, and add a task that only writes tests.",
    limitReached:
      "The revision limit is reached. Approve the current plan or cancel the run.",
    counter: ({ count, max }: { count: number; max: number }) =>
      `Revised ${count}/${max}. Each revision is one read-only planning turn for the lead.`,
  },
  retry: {
    partial: ({ kept, retried }: { kept: number; retried: number }) =>
      `${subtaskCount(kept)} already integrated will not run again. ${subtaskCount(retried)} that failed or ${retried === 1 ? "was blocked will discard its old isolated directory" : "were blocked will discard their old isolated directories"} and start again from a fresh snapshot.`,
    integrationOnly:
      "All subtasks are integrated; a retry only runs the lead's integration and the independent review again.",
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
  laneEmptyPlanning: "Subtasks appear here once the lead's plan is ready.",
  /** The running lane while the plan waits for approval. */
  laneEmptyAwaiting: "Subtasks start once you approve the plan.",
  task: {
    worktree: "Isolated worktree",
    worktreeRemoved: "Isolated worktree cleaned up",
    filesPending: "Being planned",
    dependsOn: ({ tasks }: { tasks: string }) => `Waits for ${tasks}`,
    integrated: ({ files }: { files: string }) => `Integrated: ${files}`,
    /** The toggle of a long task description, folded to its first lines. */
    showAll: "Show the whole description",
    showLess: "Show less of the description",
    showError: "View the failure reason",
    showReport: "View the work report",
    checks: ({ count }: { count: number }) =>
      `The app saw ${count === 1 ? "1 command" : `${count} commands`} run (exit codes only, no output captured; compare them with the checks the report describes)`,
  },
  mailbox: {
    title: "Team conversation",
    delivery: {
      planning:
        "The lead is planning. Once the plan is ready, you can send the members more instructions.",
      leadDuringApproval: ({ action }: { action: string }) =>
        `To change the plan, use “${action}” above so the lead re-plans; messages here are only read in the integration turn.`,
      lead: "The lead reads messages in the next integration turn and does not re-plan; send development instructions to everyone or to a specific teammate.",
      members:
        "Messages arrive at the next work turn; a turn in progress is not interrupted.",
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
      "This task no longer receives messages. Choose the lead or another member.",
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
    title: "Setup this machine needs from you",
    intro:
      "Agents are asked not to change this machine (no sudo, no global or user-level installs), so the checks below did not fully run in this contribution. Each command is an agent's suggestion: check it against the project's documentation before you run it. Once it is installed, you can rerun these checks in the working directory yourself, and later contributions can run them directly.",
    reportedBy: ({ names }: { names: string }) => `Reported by ${names}`,
    /** Who reported a need: a follow-up round, by its number among the run's rounds. */
    round: ({ number }: { number: number }) => `Follow-up round ${number}`,
    /** …or a teammate, by its name and the id the task board shows. */
    agent: ({ name, id }: { name: string; id: string }) => `${name} (${id})`,
  },
  /** The disclosure holding the protocol note. */
  howItWorks: "How it works",
  protocolNote: ({ provider }: { provider: string }) =>
    `${product.name} coordinates the team with shared tasks, separate working directories and messages between turns. This is ${product.name}'s own implementation, driven turn by turn by ${provider}; it is not Claude Code's native Agent Teams.`,
};

export default team;
