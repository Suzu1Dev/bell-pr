import type {
  ChangeExplanation,
  ExplanationStatus,
} from "../shared/explanations";
import type { RunDetailField } from "../shared/runs";
import type { Repository, RunCore } from "../shared/types";

export type { ChatMessage } from "../shared/chat";
export type { Agent, RunLogEntry, RunStatus } from "../shared/types";
export type Repo = Repository;

/** The client run; the demo run has no baseSha, worktreePath or reviewedFingerprints. */
export interface Run extends RunCore {}

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
