import type {
  ChangeExplanation,
  ExplanationStatus,
} from "../shared/explanations.js";
import type { ErrorCode, Fix } from "../shared/errors.js";
import type { RunDetailField } from "../shared/runs.js";
import type { Repository, RunCore } from "../shared/types.js";
import { sm, type ServerMessages } from "./i18n/index.js";

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
  publishCommit?: string;
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

export interface AppErrorOptions {
  /** A stable id that clients branch on; they never branch on the text. */
  code?: ErrorCode;
  /** Values for clients that render their own message for `code`. */
  params?: Record<string, string | number>;
  /** Commands that fix the problem. */
  fixes?: Fix[];
  /** Extra JSON body fields, such as `feature` for pro_required. */
  details?: Record<string, unknown>;
  /** The underlying error, kept as `error.cause`; never sent to clients. */
  cause?: unknown;
}

/**
 * An error whose message is meant for the person using BELL PR. A message
 * builder such as `(m) => m.common.cancelled` is rendered with `sm()` when
 * the error is created, so `message` is always text in the locale in effect
 * where it was thrown.
 */
export class AppError extends Error {
  code?: ErrorCode;
  params?: Record<string, string | number>;
  fixes?: Fix[];
  details?: Record<string, unknown>;
  constructor(
    message: string | ((m: ServerMessages) => string),
    public statusCode = 400,
    options: AppErrorOptions = {},
  ) {
    super(
      typeof message === "function" ? message(sm()) : message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.code = options.code;
    this.params = options.params;
    this.fixes = options.fixes;
    this.details = options.details;
  }
}
