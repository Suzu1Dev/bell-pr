import type { EfficiencyMetrics, PonytailMode } from "./efficiency.js";
import type { Locale } from "./i18n/locale.js";
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
export const projectRecommendationBatchSize = 5;
export const maxProjectRecommendations = 30;

export interface ContributionSettings extends ModelSettings {
  direction: ContributionDirection;
  targetUser: string;
  outcome: string;
  constraints: string;
  acceptance: string;
  maxTeammates: 2 | 3 | 4;
  requirePlanApproval: boolean;
  ponytailMode?: PonytailMode;
  /**
   * The GitHub issue this contribution addresses
   * (https://github.com/<owner>/<repo>/issues/<number>); empty or absent
   * means none. Only this issue and the project's issues the task or its
   * plan cites may appear as Fixes/Refs in the PR draft (`draftIssues` in
   * server/drafts.ts).
   */
  issueUrl?: string;
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

/** Display preferences belong to the user, independently of AI analysis. */
export interface RecommendationPreferences {
  order: string[];
  hidden: string[];
}

/**
 * Recommendations whose quotes did not match the analyzed excerpts. Only the
 * id, title and reason are kept so the unverified proposal itself is not shown.
 */
export interface RecommendationVerification {
  droppedRecommendations: { id: string; title: string; reason: string }[];
  /**
   * Modules, reading steps and evidence notes removed for citing a file whose
   * content was not read or that is not in the tree; absent when nothing was
   * dropped and on caches written before it was recorded.
   */
  droppedPaths?: {
    field: "modules" | "readingPath" | "evidence";
    path: string;
    reason: string;
  }[];
}

export interface ProjectInsights {
  modelExecution?: ModelExecution;
  efficiency?: EfficiencyMetrics;
  summary: string;
  purpose: string;
  audience: string[];
  userJourney: string[];
  /** A path is a sampled file or a directory prefix ending in "/" from the tracked file tree. */
  modules: { path: string; purpose: string }[];
  /**
   * Suggested first read, in order; missing on demo data and caches written
   * before it was requested. `sampled: false` marks a tracked file whose
   * content was not read; absent means the file was sampled.
   */
  readingPath?: { path: string; why: string; lookFor: string; sampled?: boolean }[];
  /** One main data flow traced through the sampled files; inferences are labelled in prose. */
  howItFitsTogether?: string;
  evidence: { path: string; note: string }[];
  recommendations: ContributionRecommendation[];
  verification?: RecommendationVerification;
  recommendationExpansion?: {
    generatedAt: string;
    addedIds: string[];
    requestedCount?: number;
    modelExecution?: ModelExecution;
    efficiency?: EfficiencyMetrics;
    verification?: RecommendationVerification;
  };
  generatedAt: string;
  source: "ai" | "demo";
  baseSha: string;
  /**
   * The UI locale the analysis was written in; more recommendations for it
   * are written in the same one. Absent on demo data and on caches written
   * before it was recorded, whose language is unknown.
   */
  locale?: Locale;
  /** What the model actually read; missing on demo data and caches written before it was recorded. */
  sample?: {
    trackedFiles: number;
    sampledFiles: number;
    bytes: number;
    truncatedFiles: number;
    /** Size of the tracked path list sent alongside the excerpts; missing before it was sent. */
    treeBytes?: number;
  };
}

/**
 * What changed since the analyzed commit when a cached analysis is stale.
 * Present only when git could list the difference; absent means unknown, not zero.
 */
export interface InsightsStaleDetail {
  /** Tracked files whose content differs from the analyzed commit; untracked files are not counted. */
  changedFiles: number;
  /** Changed files the analysis cites (modules, evidence, reading path, verified quotes), at most 12. */
  citedChanged: string[];
}

/** The steps of one analysis run, in order. */
export type InsightsPhase = "reading" | "agent" | "checking" | "saving";

/**
 * Where a running analysis is. It lives in the server's memory only: it is
 * never saved, and an analysis that is not running has none.
 */
export interface InsightsProgress {
  phase: InsightsPhase;
  /** Whole seconds since the run began. */
  elapsedSeconds: number;
  /** Whether the run adds recommendations to an analysis instead of making one. */
  more: boolean;
  /** The agent step: which try this is out of how many; a try that lost the sign-in refresh is repeated. */
  attempt?: number;
  attempts?: number;
  /** The agent step: whole seconds this try has run and the most it may run. Absent while the try has not started. */
  waitedSeconds?: number;
  limitSeconds?: number;
  /** The CLI's latest notice (a retry, a rate limit), in the language of the request that started the run. */
  notice?: string;
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
