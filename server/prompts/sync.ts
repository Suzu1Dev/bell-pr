/**
 * The prompt of the agent that resolves the conflict markers a sync left,
 * on an unpublished run or a published PR's sync round. A pure function of
 * its input, so server/prompts/rounds.test.ts can pin its exact text.
 */

/** The writable turn that resolves merge conflict markers left by a sync. */
export function conflictPrompt(input: {
  boundaries: string;
  contributionContext: string;
  task: { title: string; prompt: string };
  baseBranch: string;
  conflicts: string[];
}) {
  return `${input.boundaries}
You are resolving merge conflicts left after BELL moved this contribution onto the latest ${input.baseBranch}. Work only in this checkout. These files hold conflict markers: ${JSON.stringify(input.conflicts)}. In each block, the side labelled "latest ${input.baseBranch}" is the target branch as it is now and the side labelled "this contribution" or "this pull request" is the person's change; either side may come first. Keep the target branch's new work and re-apply the contribution's intent on top of it; when the two truly contradict, keep the target branch's behaviour and explain what of the contribution could not be kept. Edit only these files, except for the smallest follow-on edit a rename or signature change on the target branch forces in a file the contribution already changes. Remove every conflict marker. Run relevant existing checks. Do not commit, stage or change .git.
Return JSON: summary (Traditional Chinese: how you resolved the conflicts and anything the person should check) and files [{path, resolution}] with one Traditional Chinese sentence per resolved file.
${input.contributionContext}
Task: ${JSON.stringify(input.task)}`;
}
