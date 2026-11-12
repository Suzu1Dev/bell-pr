/**
 * The title, description and commit message a publish sends.
 * The confirm dialog renders these strings, and the server passes the
 * same strings to git and `gh pr create`.
 */
export function outgoingPublishText(
  draft: { title: string; body: string; commitMessage?: string },
  followUp: boolean,
): { title: string; body: string; commitMessage: string } {
  const title = draft.title;
  const body = draft.body;
  const commitMessage = followUp
    ? `${draft.commitMessage?.trim() ?? ""}\n`
    : `${draft.commitMessage?.trim() || draft.title}\n`;
  return { title, body, commitMessage };
}
