/**
 * A round of changes made after maintainers reviewed the published PR. Each
 * round the person approves becomes one more commit on the same PR branch;
 * the PR title and description stay as they were.
 */
export interface FollowUpRound {
  id: string;
  requestedAt: string;
  /** URLs of the PR feedback items (reviews, comments, threads) the person selected. */
  feedbackUrls: string[];
  /** The person's own instruction for this round. */
  note?: string;
  /**
   * running: the agent is editing. review: waiting for review and approval
   * (the run status says which). published: pushed as `commit`. failed,
   * cancelled and discarded rounds pushed nothing.
   */
  status: "running" | "review" | "published" | "failed" | "cancelled" | "discarded";
  /** The PR head this round builds on; the round's commit has it as parent. */
  parentCommit: string;
  /** What the agent changed and why, in Traditional Chinese. */
  report?: string;
  addressed?: { url: string; change: string }[];
  notAddressed?: { url: string; reason: string }[];
  /** Commands the agent reported running, with outcomes. */
  checks?: { command: string; outcome: string }[];
  commit?: string;
  publishedAt?: string;
  error?: string;
}

export const followUpFeedbackLimit = 20;
export const followUpNoteLimit = 2_000;

/** The round still being edited or reviewed; undefined once it was pushed or ended. */
export function activeFollowUp(rounds: FollowUpRound[] | undefined) {
  const round = rounds?.at(-1);
  return round && (round.status === "running" || round.status === "review")
    ? round
    : undefined;
}
