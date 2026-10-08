/**
 * Maintainer feedback read from the published PR. BELL only reads it; the
 * learner replies on GitHub themselves, so nothing here is ever posted back.
 */
export interface PrFeedbackItem {
  /** A PR review (approve / request changes / comment), a conversation comment, or a thread comment on a diff line. */
  kind: "review" | "comment" | "thread";
  author: string;
  /** GitHub's authorAssociation (OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR, NONE, …). */
  authorAssociation: string;
  body: string;
  /** Review state such as APPROVED or CHANGES_REQUESTED; reviews only. */
  state?: string;
  /** Diff path the thread is attached to; thread comments only. */
  path?: string;
  line?: number;
  isResolved?: boolean;
  url: string;
  createdAt: string;
}

/** One CI check from the head commit's status rollup (CheckRun or commit status). */
export interface PrCheck {
  name: string;
  /** CheckRun conclusion when finished, otherwise its status; the state of a commit status. */
  state: string;
  url?: string;
}

export interface PrFeedback {
  fetchedAt: string;
  prNumber: number;
  items: PrFeedbackItem[];
  /** Overall statusCheckRollup state (SUCCESS, FAILURE, PENDING, …) when GitHub reports one. */
  checksState?: string;
  checks?: PrCheck[];
  warnings?: string[];
}

export const prFeedbackItemLimit = 100;
export const prFeedbackBodyLimit = 4_000;

/** Items grouped for display: items without a path (reviews, conversation) first, then by file. */
export function groupPrFeedback(items: PrFeedbackItem[]) {
  const groups = new Map<string | undefined, PrFeedbackItem[]>([[undefined, []]]);
  for (const item of items) {
    const list = groups.get(item.path) ?? [];
    list.push(item);
    groups.set(item.path, list);
  }
  return [...groups]
    .filter(([, list]) => list.length)
    .map(([path, list]) => ({ path, items: list }));
}

/** Counts of finished-good, pending and failed checks for a one-line summary. */
export function summarizeChecks(checks: PrCheck[] = []) {
  const summary = { total: checks.length, success: 0, pending: 0, failed: 0 };
  for (const check of checks) {
    const state = check.state.toUpperCase();
    if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(state)) summary.success++;
    else if (
      ["PENDING", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED", "EXPECTED"].includes(state)
    )
      summary.pending++;
    else summary.failed++;
  }
  return summary;
}
