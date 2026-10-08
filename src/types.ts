import type {
  ChangeExplanation,
  ExplanationStatus,
  LearnerNote,
} from "../shared/explanations";
import type { EfficiencyMetrics } from "../shared/efficiency";
import type { AgentTeam } from "../shared/team";
import type { ContributionSettings } from "../shared/insights";
import type { ModelExecution } from "../shared/models";
import type { DraftPreparation } from "../shared/drafts";
import type { FileConversation } from "../shared/chat";
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
  createdAt: string;
  agents: Agent[];
  logs: { time: string; agent: string; message: string }[];
  draft: { title: string; body: string };
  reviewedFiles: string[];
  /** Learner notes keyed by diff path; absent on runs saved before notes existed. */
  notes?: Record<string, LearnerNote>;
  /** Final role answers keyed by role; also holds teammate task ids and guide answers. */
  reports?: Record<string, string>;
  prUrl?: string;
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
