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
  };
}
