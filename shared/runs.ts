/**
 * Fields GET /api/runs leaves out. They are large (logs, reports, PR draft
 * preparation, file Q&A, PR feedback, review follow-up rounds, target-branch
 * syncs, file explanations, function walkthroughs, the person's notes, the understanding check,
 * try-first attempts, feedback tags, practice schedules, GitHub facts,
 * overrides, test reasons and the Learn-by-hand record) and only the open
 * run reads them; the lists
 * only need id, title, repo, branch and status (and the "Check off" mark,
 * `understandingCheckOff`). The learning page reads explanations and notes
 * from GET /api/learning.
 */
export const runDetailFields = [
  "logs",
  "reports",
  "draftPreparation",
  "conversations",
  "session",
  "prFeedback",
  "followUps",
  "sync",
  "explanations",
  "walkthroughs",
  "notes",
  "understanding",
  "attempts",
  "feedbackTags",
  "practice",
  "contributionFacts",
  "guardOverrides",
  "reviewability",
  "byHand",
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
