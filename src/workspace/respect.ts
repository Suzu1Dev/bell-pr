/**
 * The facts the Draft tab and the publish dialog show about how welcome
 * the change is: the project's quoted rules, the reviewability snapshot,
 * and, for the sample, every respect check computed here from its
 * fixtures. Load this module lazily: the policy classifier and the checks
 * bring the Markdown tooling with them.
 */
import {
  openPrBudget,
  pacingExempt,
  type ContributionFacts,
  type ContributionRules,
} from "../../shared/contribution";
import { draftPreflight, type DraftCheck } from "../../shared/draft-checks";
import type { Locale } from "../../shared/i18n/locale";
import { classifyPolicy } from "../../shared/project-policy";
import { reviewabilitySnapshot } from "../../shared/reviewability";
import type { DemoContent } from "../demo";
import type { DiffFile, Repo, Run } from "../types";

/**
 * The sample project's "Before you contribute" facts from its fictional
 * CONTRIBUTING.md, classified by the real classifier. The same as
 * demoContributionRules (src/demo/rules.ts), which this module cannot
 * import: everything under src/demo/ joins the demo chunk the first screen
 * loads, and the classifier would bring the Markdown parser into it.
 */
export function sampleRules(demo: DemoContent): ContributionRules {
  return {
    checkedAt: demo.draftPreparation.context?.checkedAt ?? demo.run.createdAt,
    ...(demo.contributionFacts?.door ? { door: { ...demo.contributionFacts.door } } : {}),
    findings: classifyPolicy("CONTRIBUTING.md", demo.contributingText ?? ""),
    filesRead: (demo.draftPreparation.context?.sources ?? []).flatMap((source) =>
      source.path ? [source.path] : [],
    ),
    ...(demo.mergedSizes ? { mergedSizes: demo.mergedSizes.map((size) => ({ ...size })) } : {}),
  };
}

/** The project's rules: the sample's, or what BELL read from the real repository. */
export function rulesOf(repo: Repo | undefined, sample?: DemoContent) {
  return sample ? sampleRules(sample) : repo?.contributionRules;
}

/** How reviewable the change is, against the plan's scopes and the project's own merged sizes. */
export function changesOf(
  run: Run,
  files: readonly DiffFile[],
  repo: Repo | undefined,
  sample?: DemoContent,
) {
  return reviewabilitySnapshot({
    files,
    planScopes: run.team?.tasks.map((task) => task.files),
    generated: repo?.contributionRules?.generated,
    mergedSizes: sample?.mergedSizes ?? repo?.contributionRules?.mergedSizes,
  });
}

/**
 * The sample's publish checks, as the server would compute them for a real
 * run: its rules, its GitHub facts, its reviewability and its issue link.
 * They all pass on the sample as shipped; with the understanding check
 * off, the sample's own rule about explaining a change asks for a confirm.
 */
export function samplePublishChecks(
  sample: DemoContent,
  run: Run,
  files: readonly DiffFile[],
  locale: Locale,
  understandingOff = false,
): DraftCheck[] {
  return draftPreflight(
    {
      title: run.draft.title,
      body: run.draft.body,
      ...(run.draft.commitMessage ? { commitMessage: run.draft.commitMessage } : {}),
      sources: run.draftPreparation?.context?.sources,
      proposalBody: run.draftPreparation?.proposal?.body,
      changedPaths: files.map((file) => file.path),
      rules: sampleRules(sample),
      facts: sample.contributionFacts,
      changes: changesOf(run, files, undefined, sample),
      testReasons: run.reviewability?.testReasons,
      issueUrl: run.contributionSettings?.issueUrl,
      understandingOff,
    },
    locale,
  );
}

/**
 * "Your open PRs here: k of budget", from the pacing facts: the budget is
 * BELL's default (1 before a first merged PR here, 2 after), and people
 * who can write to the repository are not paced. Undefined when the facts
 * do not say; an unknown count is never shown as zero.
 */
export function pacingOf(facts: ContributionFacts | undefined) {
  const pacing = facts?.pacing;
  if (typeof pacing?.openPrs !== "number") return undefined;
  if (pacingExempt(pacing.viewerPermission ?? facts?.door?.viewerPermission))
    return "exempt" as const;
  return {
    open: pacing.openPrs,
    budget: openPrBudget(pacing.mergedPrs ?? 0),
    first: pacing.mergedPrs === 0,
  };
}

/** Han, Kana or Hangul: text the English PR description does not take as it is. */
const otherScript = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/**
 * The project's rules ask for a PR in another language than English: the
 * draft suggestion, written by the project's rules and in English unless
 * they say otherwise, is in that language.
 */
export function projectLanguageAllowed(run: Pick<Run, "draftPreparation">) {
  const proposal = run.draftPreparation?.proposal;
  return (
    proposal?.policy === "repository" &&
    otherScript.test(`${proposal.title}\n${proposal.body}`)
  );
}
