import type {
  ChangeExplanation,
  ExplanationStatus,
} from "../shared/explanations.js";
import type { RunDetailField } from "../shared/runs.js";
import type { Repository, RunCore } from "../shared/types.js";

export type {
  Agent,
  Repository,
  RunLogEntry,
  RunStatus,
} from "../shared/types.js";

export interface Run extends RunCore {
  baseSha: string;
  worktreePath: string;
  reviewedFingerprints: Record<string, string>;
  publishing?: boolean;
  publishCommit?: string;
  headRepository?: string;
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
