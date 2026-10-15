import {
  defaultDiscoveryPreferences,
  type DiscoveryJob,
} from "../../shared/discovery";
import { formatters, type Locale } from "../../shared/i18n/locale";
import { getDemo } from "./index";
import { sampleDiscovery } from "./shared";

/**
 * A finished discovery job with fictional repositories, for the sample
 * results shown where live discovery is not available. Nothing in it comes
 * from GitHub or a model; see sampleDiscovery in shared.ts.
 */
export function getSampleDiscoveryJob(locale: Locale): DiscoveryJob {
  const copy = getDemo(locale).discovery;
  const fmt = formatters(locale);
  const candidates = sampleDiscovery.candidates.map((candidate) => ({
    ...candidate,
    sources: candidate.sources.map((source) => ({ ...source })),
    warnings: [],
  }));
  return {
    id: sampleDiscovery.id,
    status: "ready",
    phase: "complete",
    message: copy.message({ count: sampleDiscovery.opportunities.length }),
    preferences: {
      ...defaultDiscoveryPreferences,
      ...sampleDiscovery.preferences,
      interests: copy.interests,
    },
    createdAt: sampleDiscovery.createdAt,
    completedAt: sampleDiscovery.completedAt,
    candidates,
    opportunities: sampleDiscovery.opportunities.map((opportunity) => {
      const text = copy.opportunities[opportunity.id];
      const candidate = candidates.find(
        (item) => item.fullName === opportunity.repository,
      );
      if (!candidate)
        throw new Error(`No sample repository ${opportunity.repository}.`);
      return {
        id: opportunity.id,
        repository: opportunity.repository,
        title: text.title,
        summary: text.summary,
        userNeed: text.userNeed,
        contributionRules: text.contributionRules,
        popularity: copy.popularity({
          stars: fmt.number(candidate.stars),
          forks: fmt.number(candidate.forks),
          pushedAt: candidate.pushedAt.slice(0, 10),
        }),
        feasibility: text.feasibility,
        difficulty: opportunity.difficulty,
        effort: text.effort,
        firstSteps: [...text.firstSteps],
        acceptanceChecks: [...text.acceptanceChecks],
        risks: [...text.risks],
        evidence: opportunity.evidence.map((evidence, index) => ({
          sourceId: evidence.sourceId,
          quote: evidence.quote,
          reason: text.reasons[index],
        })),
        ...("learnByHand" in opportunity ? { learnByHand: opportunity.learnByHand } : {}),
      };
    }),
    warnings: [...copy.warnings],
    sample: true,
  };
}
