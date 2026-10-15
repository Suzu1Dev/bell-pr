import type { ContributionRules } from "../../shared/contribution";
import { classifyPolicy } from "../../shared/project-policy";
import { draftPreparation } from "./shared";
import type { DemoContent } from "./types";

/**
 * The sample project's "Before you contribute" facts, built from its
 * CONTRIBUTING.md with the real classifier, so the demo shows what BELL PR
 * finds in a project's own words. Load this module lazily: the classifier
 * brings the Markdown tooling of the PR checks with it.
 */
export function demoContributionRules(demo: DemoContent): ContributionRules {
  return {
    checkedAt: draftPreparation.checkedAt,
    ...(demo.contributionFacts?.door ? { door: { ...demo.contributionFacts.door } } : {}),
    findings: classifyPolicy("CONTRIBUTING.md", demo.contributingText ?? ""),
    filesRead: draftPreparation.sources.map((source) => source.path),
    ...(demo.mergedSizes ? { mergedSizes: demo.mergedSizes.map((size) => ({ ...size })) } : {}),
  };
}
