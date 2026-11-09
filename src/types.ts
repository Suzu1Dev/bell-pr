import type {
  ChangeExplanation,
  ExplanationStatus,
} from "../shared/explanations";
import type { RunDetailField } from "../shared/runs";
import type { FileWalkthrough } from "../shared/walkthroughs";
import type { Repository, RunCore } from "../shared/types";

export type { ChatMessage } from "../shared/chat";
export type { Agent, RunLogEntry, RunStatus } from "../shared/types";

/** A repository as the API lists it. */
export interface Repo extends Repository {
  /** Whether BELL owns the clone and may update it; computed by the API, not stored. */
  updatable?: boolean;
}

/** The client run; the demo run has no baseSha, worktreePath or reviewedFingerprints. */
export interface Run extends RunCore {
  /** Returned for real runs; a review tick is valid only for this exact diff. */
  reviewedFingerprints?: Record<string, string>;
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
  walkthrough?: FileWalkthrough;
  walkthroughStatus?: ExplanationStatus;
  walkthroughError?: string;
  hunks?: unknown;
  blocked?: string;
}
