import type { ChangeExplanation } from "../../shared/explanations";
import type {
  ContributionBrief,
  ContributionRecommendation,
  ProjectInsights,
} from "../../shared/insights";
import type { PrFeedback } from "../../shared/pr-feedback";
import type { AgentTeam } from "../../shared/team";
import type { DraftPreparation } from "../../shared/drafts";
import type { DiffFile, Repo, Run } from "../types";
import type {
  DemoAgentId,
  DemoDraftSourceId,
  DemoEvidencePath,
  DemoFilePath,
  DemoLogKey,
  DemoMessageId,
  DemoModulePath,
  DemoReadingPath,
  DemoRecommendationId,
  DemoTaskId,
} from "./shared";

export type DemoAnswerTopic = "test" | "jitter" | "risk" | "why" | "generic";

/**
 * One prewritten follow-up answer. demoAnswer() takes the first answer whose
 * keywords match the question, in table order, and falls back to the
 * "generic" answer. The text is a local fixture, never a model reply.
 */
export interface DemoAnswer {
  topic: DemoAnswerTopic;
  keywords: RegExp;
  text: (params: { file: DiffFile }) => string;
}

/** Everything the demo shows, in one locale. */
export interface DemoContent {
  repo: Repo;
  /** The demo diff, each file with its prewritten explanation. */
  files: DiffFile[];
  run: Run;
  insights: ProjectInsights;
  contributionBrief: ContributionBrief;
  team: AgentTeam;
  draftPreparation: DraftPreparation;
  answers: DemoAnswer[];
  // The samples below are optional until they are written.
  /** Sample maintainer feedback and CI checks on the demo's published PR. */
  prFeedback?: PrFeedback;
  /** The sample recommendations that "Generate 5 more" adds in the demo. */
  extraRecommendations?: ContributionRecommendation[];
  /** The review reports after a demo re-run, keyed as in Run.reports. */
  rerunReport?: Record<string, string>;
}

/**
 * The words of the demo in one locale. buildDemoContent() joins them with the
 * locale-independent structure in shared.ts; records are keyed by the ids and
 * paths defined there, so the compiler finds missing or stray entries.
 */
export interface DemoCopy {
  explanations: Record<DemoFilePath, ChangeExplanation>;
  run: {
    title: string;
    prompt: string;
    agents: Record<DemoAgentId, { role: string; detail: string }>;
    logs: Record<DemoLogKey, string>;
    /** The Lead's integration summary and the two review reports. */
    reports: Record<"implementer" | "reviewer" | "tester", string>;
  };
  insights: {
    summary: string;
    purpose: string;
    audience: string[];
    userJourney: string[];
    modules: Record<DemoModulePath, string>;
    readingPath: Record<DemoReadingPath, { why: string; lookFor: string }>;
    howItFitsTogether: string;
    evidence: Record<DemoEvidencePath, string>;
    recommendations: Record<
      DemoRecommendationId,
      Pick<
        ContributionRecommendation,
        "title" | "problem" | "userImpact" | "approach" | "acceptance"
      >
    >;
  };
  contributionBrief: ContributionBrief;
  team: {
    planSummary: string;
    tasks: Record<
      DemoTaskId,
      { title: string; description: string; report: string }
    >;
    messages: Record<DemoMessageId, string>;
  };
  draftPreparation: {
    warnings: string[];
    sources: Record<DemoDraftSourceId, { label: string; content: string }>;
    proposal: {
      title: string;
      summary: string;
      body: string;
      /** Each quote is taken from the content of its source. */
      rules: { sourceId: DemoDraftSourceId; text: string; quote: string }[];
      checklist: string[];
      commitRationale: string;
    };
  };
  answers: DemoAnswer[];
}
