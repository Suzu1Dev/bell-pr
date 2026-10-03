import type { EfficiencyMetrics, PonytailMode } from "./efficiency.js";
import type { ModelExecution, ModelSettings } from "./models.js";
export const contributionDirections = [
  "bugfix",
  "feature",
  "performance",
  "ux",
  "testing",
  "docs",
  "maintenance",
] as const;

export type ContributionDirection = (typeof contributionDirections)[number];

export interface ContributionSettings extends ModelSettings {
  direction: ContributionDirection;
  targetUser: string;
  outcome: string;
  constraints: string;
  acceptance: string;
  maxTeammates: 2 | 3 | 4;
  requirePlanApproval: boolean;
  ponytailMode?: PonytailMode;
}

export const defaultContributionSettings: ContributionSettings = {
  direction: "bugfix",
  targetUser: "",
  outcome: "",
  constraints: "",
  acceptance: "",
  maxTeammates: 3,
  requirePlanApproval: true,
  ponytailMode: "lite",
  model: "",
  reasoningEffort: "",
};

export interface ContributionRecommendation {
  id: string;
  title: string;
  direction: ContributionDirection;
  problem: string;
  userImpact: string;
  approach: string;
  acceptance: string[];
  effort: "small" | "medium" | "large";
  confidence: "high" | "medium" | "low";
  evidence: string[];
  /** Source quotes verified against the exact analyzed excerpts; conclusions remain AI proposals. */
  evidenceDetails?: { path: string; quote: string; reason: string }[];
}

export interface ProjectInsights {
  modelExecution?: ModelExecution;
  efficiency?: EfficiencyMetrics;
  summary: string;
  purpose: string;
  audience: string[];
  userJourney: string[];
  modules: { path: string; purpose: string }[];
  evidence: { path: string; note: string }[];
  recommendations: ContributionRecommendation[];
  generatedAt: string;
  source: "ai" | "demo";
  baseSha: string;
}

export interface ContributionBrief {
  problem: string;
  motivation: string;
  beneficiaries: string[];
  before: string;
  after: string;
  validation: string[];
  risks: string[];
}
