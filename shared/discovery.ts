import type { EfficiencyMetrics, PonytailMode } from "./efficiency.js";
import type { ModelExecution, ModelSettings } from "./models.js";

export interface DiscoveryPreferences extends ModelSettings {
  interests: string;
  language: string;
  difficulty: "any" | "beginner" | "intermediate";
  minStars: number;
  ponytailMode: PonytailMode;
}

export const defaultDiscoveryPreferences: DiscoveryPreferences = {
  interests: "",
  language: "",
  difficulty: "beginner",
  minStars: 50,
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
  previousResult?: {
    createdAt: string;
    candidates: DiscoveryCandidate[];
    opportunities: ContributionOpportunity[];
  };
}
