import type {
  ChangeExplanation,
  ExplanationStatus,
  LearnerNote,
  StoredExplanation,
} from "../shared/explanations";
import type { EfficiencyMetrics } from "../shared/efficiency";
import type { AgentTeam } from "../shared/team";
import type { ContributionSettings } from "../shared/insights";
import type { ModelExecution } from "../shared/models";
import type { DraftPreparation } from "../shared/drafts";
import type { FileConversation } from "../shared/chat";
import type { PrFeedback } from "../shared/pr-feedback";
import type { RunDetailField } from "../shared/runs";

export type { ChatMessage } from "../shared/chat";
export interface Repo {
  id: string;
  name: string;
  owner: string;
  fullName: string;
  path: string;
  defaultBranch: string;
  url: string;
  language?: string;
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  status: "waiting" | "running" | "complete" | "failed";
  detail: string;
}

/** One activity-log line; entries saved before `kind` existed are plain messages. */
export interface RunLogEntry {
  time: string;
  agent: string;
  message: string;
  kind?: "message" | "command" | "file" | "status" | "notice";
  /** Exit code of a command entry or the paths of a file entry. */
  detail?: string;
}

export interface Run {
  draftPreparation?: DraftPreparation;
  modelExecution?: ModelExecution;
  efficiency?: EfficiencyMetrics;
  team?: AgentTeam;
  contributionSettings?: ContributionSettings;
  approvedFingerprint?: string;
  id: string;
  repoId: string;
  title: string;
  prompt: string;
  status:
    | "queued"
    | "awaiting_plan"
    | "running"
    | "review"
    | "approved"
    | "published"
    | "failed"
    | "cancelled";
  branch: string;
  baseBranch: string;
  /** Local checkout the learner may edit by hand; absent on the demo run. */
  worktreePath?: string;
  createdAt: string;
  agents: Agent[];
  logs: RunLogEntry[];
  /** Human-written commit message; absent or empty means the PR title alone is used. */
  draft: { title: string; body: string; commitMessage?: string };
  reviewedFiles: string[];
  /** Learner notes keyed by diff path; absent on runs saved before notes existed. */
  notes?: Record<string, LearnerNote>;
  /** Final role answers keyed by role; also holds teammate task ids and guide answers. */
  reports?: Record<string, string>;
  /** Stored per-file explanations keyed by path; the learning page aggregates the ready ones. */
  explanations?: Record<string, StoredExplanation>;
  prUrl?: string;
  /** Maintainer feedback read from the PR on request; absent until the learner fetches it. */
  prFeedback?: PrFeedback;
  error?: string;
  /** Follow-up Q&A per diff path; absent on runs saved before it was persisted. */
  conversations?: Record<string, FileConversation>;
}

/** What GET /api/runs returns for each run (see shared/runs.ts). */
export type RunSummary = Omit<Run, RunDetailField>;

export interface DiffFile {
  fingerprint?: string;
  path: string;
  language: string;
  additions: number;
  deletions: number;
  status: string;
  patch: string;
  explanation?: ChangeExplanation;
  explanationStatus?: ExplanationStatus;
  explanationError?: string;
  hunks?: unknown;
  blocked?: string;
}
