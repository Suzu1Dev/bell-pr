import type { AgentProvider } from "./models.js";

export type TeamTaskStatus =
  "pending" | "ready" | "running" | "complete" | "failed" | "blocked";

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
  baseSha?: string;
  startedAt?: string;
  completedAt?: string;
  acceptsMessages?: boolean;
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
}
