import type { AgentProvider } from "./models.js";
import type { SetupNeed } from "./setup-needs.js";

export type TeamTaskStatus =
  "pending" | "ready" | "running" | "complete" | "failed" | "blocked";

/** Oldest entries are kept once a task reaches this many observed commands. */
export const maxTeamTaskChecks = 40;

/**
 * One command execution the CLI reported while a teammate worked. This is what
 * the application saw, not what the teammate wrote in its report: the two are
 * shown side by side so a learner can compare them. Output is never captured.
 */
export interface TeamCheck {
  /** First line of the command, credential shapes masked, at most 300 characters. */
  command: string;
  /**
   * Exit code (Codex) or success/failure wording (Claude Code); a success
   * another command in the line could have set (`npm test | tail`) says it
   * is not verified.
   */
  outcome: string;
}

export interface TeamTask {
  id: string;
  title: string;
  description: string;
  owner: string;
  /** Exact repository-relative file names or directory prefixes ending with '/'. */
  files: string[];
  dependsOn: string[];
  status: TeamTaskStatus;
  report?: string;
  error?: string;
  worktreePath?: string;
  /** Git directory of that checkout, recorded when the worktree was created. */
  gitDir?: string;
  /** The isolated checkout was removed after integration; worktreePath stays as a record. */
  worktreeRemoved?: boolean;
  baseSha?: string;
  startedAt?: string;
  completedAt?: string;
  acceptsMessages?: boolean;
  /** Commands the CLI reported during this task; absent on tasks saved before it existed or when none were seen. */
  checks?: TeamCheck[];
  /** Repository-relative paths the application applied to the review worktree; absent before this field existed. */
  integratedFiles?: string[];
  /** What the machine lacked for checks this task could not run; absent when none was reported. */
  setup?: SetupNeed[];
}

export interface TeamMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  createdAt: string;
  status: "queued" | "delivered";
  recipients: string[];
  deliveredTo: string[];
  deliveredAt?: string;
}

/** How many times a plan can be sent back before the person must approve or cancel. */
export const maxPlanRevisions = 3;

/** One round of "send the plan back": the rejected plan, the person's feedback and the lead's reply. */
export interface TeamPlanRevision {
  feedback: string;
  previousSummary: string;
  previousTasks: {
    id: string;
    title: string;
    files: string[];
    dependsOn: string[];
  }[];
  createdAt: string;
  /** Filled in once the lead's revised plan arrives; absent when the lead gave none. */
  revisionNotes?: string;
}

export interface AgentTeam {
  config: {
    maxTeammates: 2 | 3 | 4;
    requirePlanApproval: boolean;
    provider: AgentProvider;
    protocol: "bell-shared-tasks";
    messageDelivery: "between-turns";
  };
  phase:
    | "planning"
    | "awaiting_approval"
    | "developing"
    | "integrating"
    | "reviewing"
    | "complete"
    | "failed"
    | "cancelled";
  planSummary: string;
  tasks: TeamTask[];
  messages: TeamMessage[];
  approvedAt?: string;
  /** Optional: runs created before plan revision existed have none. Oldest first. */
  planRevisions?: TeamPlanRevision[];
  /** The lead's check of the request's assumption; absent when it stated none or before this existed. */
  premise?: PremiseCheck;
}

/** What the lead found about an assumption: the code confirms it, contradicts it, or neither. */
export type PremiseVerdict = "holds" | "refuted" | "unclear";

/**
 * An assumption in the request, checked by the lead against the repository
 * before planning, or again later on request. The statement and the
 * evidence (with path:line) are in the run's language.
 */
export interface PremiseCheck {
  verdict: PremiseVerdict;
  statement: string;
  evidence: string;
}
