import type {
  ChangeExplanation,
  ExplanationStatus,
  StoredExplanation,
} from "../shared/explanations.js";
import type { EfficiencyMetrics } from "../shared/efficiency.js";
import type { AgentTeam } from "../shared/team.js";
import type { ContributionSettings } from "../shared/insights.js";
import type { DraftPreparation } from "../shared/drafts.js";
import type { ModelExecution } from "../shared/models.js";

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
  logs: { time: string; agent: string; message: string }[];
  draft: { title: string; body: string };
  reviewedFiles: string[];
  reviewedFingerprints: Record<string, string>;
  approvedFingerprint?: string;
  reports?: Record<string, string>;
  prUrl?: string;
  error?: string;
  publishing?: boolean;
  publishCommit?: string;
  headRepository?: string;
  contributionSettings?: ContributionSettings;
  team?: AgentTeam;
}

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
