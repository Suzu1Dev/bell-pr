/**
 * The prompt of the agent that resolves the conflict markers a sync left,
 * on an unpublished run or a published PR's sync round. A pure function of
 * its input, so server/prompts/rounds.test.ts can pin its exact text.
 */
import type { AgentAccessMode } from "../../shared/models.js";
import type { Locale } from "../../shared/i18n/locale.js";
import { outputLanguage } from "../prompt-language.js";
import { teamBoundaries } from "./team.js";

/**
 * The writable turn that resolves merge conflict markers left by a sync. Its
 * account is in the run's language; the conflict labels in the files stay
 * English.
 */
export function conflictPrompt(input: {
  locale: Locale;
  agentAccess?: AgentAccessMode;
  contributionContext: string;
  task: { title: string; prompt: string };
  baseBranch: string;
  conflicts: string[];
}) {
  const language = outputLanguage(input.locale);
  return `${teamBoundaries(input.locale, input.agentAccess === "full")}
You are resolving merge conflicts left after BELL moved this contribution onto the latest ${input.baseBranch}. Work only in this checkout. These files hold conflict markers: ${JSON.stringify(input.conflicts)}. In each block, the side labelled "latest ${input.baseBranch}" is the target branch as it is now and the side labelled "this contribution" or "this pull request" is the person's change; either side may come first. Keep the target branch's new work and re-apply the contribution's intent on top of it; when the two truly contradict, keep the target branch's behaviour and explain what of the contribution could not be kept. Edit only these files, except for the smallest follow-on edit a rename or signature change on the target branch forces in a file the contribution already changes. Remove every conflict marker. Run relevant existing checks. Do not commit, stage or change .git.
Return JSON: summary (how you resolved the conflicts and anything the person should check, in ${language}) and files [{path, resolution}] with one sentence in ${language} per resolved file.
${input.contributionContext}
Task: ${JSON.stringify(input.task)}`;
}
