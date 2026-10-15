/**
 * The respect facts on the server: the project's quoted rules
 * (`Repository.contributionRules`), the run's GitHub facts
 * (`run.contributionFacts`) and the person's test reasons. Reads are
 * local (`git ls-tree`, `git show`) or read-only `gh api` calls, time-boxed,
 * never polled, and never for a repository without a GitHub origin. A
 * fact that could not be read is listed in `unknown`, never a pass.
 *
 * L1 stub with the final signatures; L2B fills it in. Until then the two
 * refresh helpers return undefined (no facts: no fact-based check runs)
 * and every façade method answers 501.
 */
import type {
  ContributionFacts,
  ContributionRules,
} from "../shared/contribution.js";
import { AppError, type Repository, type Run } from "./types.js";
import type { WorkbenchContext } from "./workbench.js";

/**
 * Reads the run's GitHub facts again (door, issue, pacing) within
 * `timeoutMs` in total, 8 s per call. publish() calls it before its checks
 * and keeps the stored snapshot when it returns undefined.
 */
export async function refreshRunFacts(
  _ctx: WorkbenchContext,
  _run: Run,
  _options: { timeoutMs?: number } = {},
): Promise<ContributionFacts | undefined> {
  return undefined;
}

/** Reads the project's rules and door again, at import, Update project or "Check again". */
export async function refreshRepositoryRules(
  _ctx: WorkbenchContext,
  _repo: Repository,
): Promise<ContributionRules | undefined> {
  return undefined;
}

/**
 * A plain-words explanation of a failed `gh pr create` (for example
 * GitHub's own limit on open pull requests), or undefined to keep the
 * error as it is.
 */
export function explainPrCreateFailure(_error: unknown): AppError | undefined {
  return undefined;
}

/** What the contribution routes do; Workbench.contribution. */
export interface ContributionFacade {
  /** GET /api/repos/:id/contribution-rules: the stored rules, never refreshed. */
  rules(repoId: string): Promise<ContributionRules | undefined>;
  /** POST /api/repos/:id/contribution-rules/refresh ("Check again"). */
  refreshRules(repoId: string): Promise<ContributionRules | undefined>;
  /** GET /api/repos/:id/contribution-check?issue=: the task dialog's issue and pacing facts, time-boxed, never cached across runs. */
  check(repoId: string, issueUrl?: string): Promise<ContributionFacts>;
  /** POST /api/runs/:id/contribution-facts/refresh: stores `run.contributionFacts`. */
  refreshRun(runId: string): Promise<{ run: Run }>;
  /** PUT /api/runs/:id/test-reasons: one line per weakened-test item. */
  saveTestReasons(
    runId: string,
    reasons: Record<string, string>,
  ): Promise<{ run: Run }>;
}

const notImplemented = () =>
  Promise.reject(new AppError((m) => m.contribution.notImplemented, 501));

export function contributionFacade(_ctx: WorkbenchContext): ContributionFacade {
  return {
    rules: notImplemented,
    refreshRules: notImplemented,
    check: notImplemented,
    refreshRun: notImplemented,
    saveTestReasons: notImplemented,
  };
}
