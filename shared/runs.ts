/**
 * Fields GET /api/runs leaves out. They are large (logs, reports, PR draft
 * preparation, file Q&A, PR feedback, review follow-up rounds, target-branch
 * syncs, function walkthroughs) and only the
 * open run reads them; the lists only need id, title, repo, branch and status.
 */
export const runDetailFields = [
  "logs",
  "reports",
  "draftPreparation",
  "conversations",
  "prFeedback",
  "followUps",
  "sync",
  "walkthroughs",
] as const;
export type RunDetailField = (typeof runDetailFields)[number];

/** The list shape of a run; the frontend applies it wherever a full run enters the list. */
export function summarizeRun<T extends Partial<Record<RunDetailField, unknown>>>(
  run: T,
): Omit<T, RunDetailField> {
  const summary = { ...run };
  for (const field of runDetailFields) delete summary[field];
  return summary;
}
