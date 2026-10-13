import type {
  ChangeExplanation,
  ExplanationStatus,
  LearnerNote,
  StoredExplanation,
} from "../shared/explanations.js";
import type { EfficiencyMetrics } from "../shared/efficiency.js";
import type { AgentTeam } from "../shared/team.js";
import type { ContributionSettings } from "../shared/insights.js";
import type { DraftPreparation } from "../shared/drafts.js";
import type { ModelExecution } from "../shared/models.js";
import type { FileConversation } from "../shared/chat.js";
import type { PrFeedback } from "../shared/pr-feedback.js";
import type { RunDetailField } from "../shared/runs.js";
import type { FollowUpRound } from "../shared/followups.js";

export type RunStatus =
  | "queued"
  | "running"
  | "awaiting_plan"
  | "review"
  | "approved"
  | "published"
  | "failed"
  | "cancelled";

export interface Repository {
  id: string;
  name: string;
  owner: string;
  fullName: string;
  path: string;
  defaultBranch: string;
  url: string;
  language?: string;
  /** When the person last updated BELL's clone to the latest default branch. */
  updatedAt?: string;
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  status: "waiting" | "running" | "complete" | "failed";
  detail: string;
}

/**
 * One activity-log line. Entries saved before `kind` existed have none and
 * are plain messages; `detail` carries the exit code of a command or the
 * paths of a file entry.
 */
export interface RunLogEntry {
  time: string;
  agent: string;
  message: string;
  kind?: "message" | "command" | "file" | "status" | "notice";
  detail?: string;
}

export interface Run {
  draftPreparation?: DraftPreparation;
  modelExecution?: ModelExecution;
  explanations?: Record<string, StoredExplanation>;
  efficiency?: EfficiencyMetrics;
  id: string;
  repoId: string;
  title: string;
  prompt: string;
  status: RunStatus;
  branch: string;
  baseBranch: string;
  baseSha: string;
  worktreePath: string;
  createdAt: string;
  agents: Agent[];
  logs: RunLogEntry[];
  /**
   * commitMessage is the full commit message the human wrote (subject, body,
   * trailers such as Signed-off-by). Absent or empty means the PR title alone
   * is used, which is how runs saved before this field existed were published.
   * publishBranch is the branch name pushed to GitHub; absent means `branch`.
   */
  draft: {
    title: string;
    body: string;
    commitMessage?: string;
    publishBranch?: string;
  };
  reviewedFiles: string[];
  reviewedFingerprints: Record<string, string>;
  /** Learner notes keyed by diff path; absent on runs saved before notes existed. */
  notes?: Record<string, LearnerNote>;
  approvedFingerprint?: string;
  reports?: Record<string, string>;
  prUrl?: string;
  /** Maintainer feedback read from the PR on request; absent until the learner fetches it. */
  prFeedback?: PrFeedback;
  error?: string;
  publishing?: boolean;
  publishCommit?: string;
  /** The GitHub branch the publish commit was pushed to; absent until a push succeeds. */
  publishedBranch?: string;
  /** Rounds of changes after maintainer review, oldest first; absent until the first one. */
  followUps?: FollowUpRound[];
  headRepository?: string;
  contributionSettings?: ContributionSettings;
  team?: AgentTeam;
  /** Follow-up Q&A per diff path; absent on runs saved before it was persisted. */
  conversations?: Record<string, FileConversation>;
}

/** What GET /api/runs returns for each run (see shared/runs.ts). */
export type RunSummary = Omit<Run, RunDetailField>;

export interface DiffFile {
  explanation?: ChangeExplanation;
  explanationStatus?: ExplanationStatus;
  explanationError?: string;
  path: string;
  language: string;
  additions: number;
  deletions: number;
  status: "added" | "modified" | "deleted";
  patch: string;
  fingerprint: string;
  blocked?: string;
  hunks: {
    header: string;
    oldStart: number;
    newStart: number;
    lines: string[];
  }[];
}

export interface Database {
  version: 1;
  repos: Repository[];
  runs: Run[];
}

export class AppError extends Error {
  constructor(
    message: string,
    public statusCode = 400,
  ) {
    super(message);
  }
}
