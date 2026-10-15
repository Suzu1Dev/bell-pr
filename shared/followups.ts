/**
 * A round of changes made after maintainers reviewed the published PR. Each
 * round the person approves becomes one more commit on the same PR branch;
 * the PR title and description stay as they were.
 */
export interface FollowUpRound {
  id: string;
  /**
   * review: changes from maintainer feedback. sync: the latest target branch
   * merged into the PR, pushed as a merge commit. Absent means review.
   */
  kind?: "review" | "sync";
  requestedAt: string;
  /** URLs of the PR feedback items (reviews, comments, threads) the person selected. */
  feedbackUrls: string[];
  /** The person's own instruction for this round. */
  note?: string;
  /**
   * The person's one-line restatement of each selected comment, in their
   * own words: the agent's task, with the maintainer's words as data.
   * Absent on rounds started before restatements existed.
   */
  restatements?: FollowUpRestatement[];
  /**
   * running: the agent is editing. review: waiting for review and approval
   * (the run status says which). published: pushed as `commit`. failed,
   * cancelled and discarded rounds pushed nothing.
   */
  status: "running" | "review" | "published" | "failed" | "cancelled" | "discarded";
  /** The PR head this round builds on; the round's commit has it as parent. */
  parentCommit: string;
  /** What the agent changed and why, in the run's language. */
  report?: string;
  addressed?: { url: string; change: string }[];
  notAddressed?: { url: string; reason: string }[];
  /** Commands BELL saw the agent run, with outcomes; not the agent's own list. */
  checks?: { command: string; outcome: string }[];
  commit?: string;
  publishedAt?: string;
  error?: string;
  /** A sync round's second parent: the target-branch commit merged in. */
  mergeParent?: string;
  /** A sync round's base before it, restored if the round is discarded. */
  previousBase?: string;
  /** Files a sync round's merge could not combine; they hold markers until resolved. */
  conflicts?: string[];
  /** The conflicts still holding markers when the diff was last read. */
  unresolved?: string[];
  /** Per-file conflict resolutions the agent described. */
  resolutions?: { path: string; resolution: string }[];
  /** True while an agent resolves this round's conflicts; a restart clears it. */
  resolving?: boolean;
  /** Commits pushed on GitHub outside BELL that BELL took over; nothing was pushed. */
  adopted?: boolean;
}

export interface FollowUpRestatement {
  /** The feedback item's URL. */
  url: string;
  /** At most `followUpRestatementLimit` characters. */
  text: string;
}

/** POST /api/runs/:id/follow-ups */
export interface FollowUpStartInput {
  feedbackUrls: string[];
  note?: string;
  /** One per selected comment; the server requires them once restatements are enforced. */
  restatements?: FollowUpRestatement[];
}

export const followUpFeedbackLimit = 20;
export const followUpNoteLimit = 2_000;
export const followUpRestatementLimit = 300;

/** The round still being edited or reviewed; undefined once it was pushed or ended. */
export function activeFollowUp(rounds: FollowUpRound[] | undefined) {
  const round = rounds?.at(-1);
  return round && (round.status === "running" || round.status === "review")
    ? round
    : undefined;
}
