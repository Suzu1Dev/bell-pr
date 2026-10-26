import type { EfficiencyMetrics, PonytailMode } from "./efficiency.js";
import type { Locale } from "./i18n/locale.js";
import type { ModelExecution, ModelSettings } from "./models.js";

/** GitHub search order: "relevance" is GitHub best match (no sort parameter). */
export const discoverySorts = ["relevance", "updated", "stars"] as const;
export type DiscoverySort = (typeof discoverySorts)[number];

export interface DiscoveryPreferences extends ModelSettings {
  interests: string;
  language: string;
  difficulty: "any" | "beginner" | "intermediate";
  minStars: number;
  sort: DiscoverySort;
  ponytailMode: PonytailMode;
}

export const defaultDiscoveryPreferences: DiscoveryPreferences = {
  interests: "",
  language: "",
  difficulty: "beginner",
  minStars: 50,
  // "updated" keeps the long-standing behaviour; saved discovery.json files predate this field.
  sort: "updated",
  ponytailMode: "lite",
  model: "",
  reasoningEffort: "",
};

export interface DiscoverySource {
  id: string;
  kind: "readme" | "contributing" | "template" | "issue" | "comment";
  title: string;
  url: string;
  content: string;
}

export interface DiscoveryCandidate {
  fullName: string;
  url: string;
  description: string;
  language: string;
  stars: number;
  forks: number;
  pushedAt: string;
  openIssues: number;
  sources: DiscoverySource[];
  warnings: string[];
}

export interface DiscoveryEvidence {
  sourceId: string;
  quote: string;
  reason: string;
}

export interface ContributionOpportunity {
  id: string;
  repository: string;
  title: string;
  summary: string;
  userNeed: string;
  contributionRules: string;
  popularity: string;
  feasibility: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  effort: string;
  firstSteps: string[];
  acceptanceChecks: string[];
  risks: string[];
  evidence: DiscoveryEvidence[];
  /**
   * The issue carries a learning label (good first issue and the like):
   * practice for the person to write by hand, not work for the agent team.
   * Absent means false.
   */
  learnByHand?: boolean;
  /**
   * An evidence quote reserves issues like this one for people learning
   * without AI (an `area` rule), so BELL won't publish a Learn-by-hand run
   * for it unless the rule is worded around AI-generated or automated pull
   * requests (`byHandReservedOutput`). Derived by the server, never taken
   * from the agent's answer; absent means false.
   */
  byHandReserved?: true;
  /**
   * Beside `byHandReserved`: the reservation is worded around AI-generated
   * or automated pull requests (matplotlib's "pull requests that are AI
   * generated will be closed"), not around using AI, so a Learn-by-hand run
   * may still reach the quoted confirm there. Absent means false.
   */
  byHandReservedOutput?: true;
  /**
   * Beside `byHandReserved` without `byHandReservedOutput`: the evidence
   * quote whose reservation is worded around using AI (or BELL can't tell),
   * which the card quotes. Derived by the server with the flags (plan
   * README §18.10), so the card needs no classifier; never taken from the
   * agent's answer. Absent otherwise.
   */
  byHandReservedQuote?: string;
}

export interface DiscoveryJob {
  id: string;
  status: "running" | "ready" | "failed" | "cancelled";
  phase: "searching" | "screening" | "analyzing" | "complete";
  message: string;
  preferences: DiscoveryPreferences;
  createdAt: string;
  completedAt?: string;
  candidates: DiscoveryCandidate[];
  opportunities: ContributionOpportunity[];
  warnings: string[];
  modelExecution?: ModelExecution;
  efficiency?: EfficiencyMetrics;
  error?: string;
  /**
   * The UI locale the job was started in; its messages and the agent's
   * output use it. Absent on jobs saved before it was recorded.
   */
  locale?: Locale;
  previousResult?: {
    createdAt: string;
    candidates: DiscoveryCandidate[];
    opportunities: ContributionOpportunity[];
    /**
     * The locale of the job that found these results. Absent on results
     * saved before it was recorded.
     */
    locale?: Locale;
  };
}
