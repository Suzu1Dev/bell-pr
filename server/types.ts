import type {
  ChangeExplanation,
  ExplanationStatus,
} from "../shared/explanations.js";
import type { ErrorCode, Fix } from "../shared/errors.js";
import type { FileWalkthrough } from "../shared/walkthroughs.js";
import type { RunDetailField } from "../shared/runs.js";
import type { Repository, RunCore } from "../shared/types.js";
import { parseLocale } from "../shared/i18n/locale.js";
import {
  currentLocale,
  sm,
  withLocale,
  type ServerMessages,
} from "./i18n/index.js";

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
}

/** What GET /api/runs returns for each run (see shared/runs.ts). */
export type RunSummary = Omit<Run, RunDetailField>;

/**
 * Runs `fn`, and the async work it starts, in the locale the run was
 * created in, so a run's background work writes its logs and agent details
 * and prompts its agents in one language. A run saved before runs recorded
 * a locale, or with one this build does not know, uses the locale in
 * effect.
 */
export function withRunLocale<T>(run: Pick<Run, "locale">, fn: () => T): T {
  return withLocale(parseLocale(run.locale) ?? currentLocale(), fn);
}

export interface DiffFile {
  explanation?: ChangeExplanation;
  explanationStatus?: ExplanationStatus;
  explanationError?: string;
  walkthrough?: FileWalkthrough;
  walkthroughStatus?: ExplanationStatus;
  walkthroughError?: string;
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
  /** Extra JSON body fields, such as the failing command's `exitCode`. */
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
