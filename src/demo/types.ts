import type { ChangeExplanation } from "../../shared/explanations";
import type {
  ContributionBrief,
  ContributionRecommendation,
  ProjectInsights,
} from "../../shared/insights";
import type { PrFeedback } from "../../shared/pr-feedback";
import type { CommitDetail, CommitSummary } from "../../shared/commits";
import type { AgentTeam } from "../../shared/team";
import type { DraftPreparation } from "../../shared/drafts";
import type { CoachDebrief, CoachDrill } from "../../shared/coach";
import type {
  ContributionFacts,
  MergedPrSize,
} from "../../shared/contribution";
import type { FollowUpRestatement } from "../../shared/followups";
import type { PracticeItem } from "../../shared/practice";
import type {
  Confidence,
  FeedbackTag,
  RoadChoice,
  SelfGrade,
  TasteDimension,
} from "../../shared/understanding";
import type { Locale } from "../../shared/i18n/locale";
import type { DiffFile, Repo, Run } from "../types";
import type {
  DemoAgentId,
  DemoCheckItemId,
  DemoDraftSourceId,
  DemoEvidencePath,
  DemoExtraRecommendationId,
  DemoFeedbackItemId,
  DemoFilePath,
  DemoLogKey,
  DemoMessageId,
  DemoModulePath,
  DemoOpportunityId,
  DemoPracticeId,
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

/** The copy of one sample discovery opportunity (see shared.ts). */
export interface DemoOpportunityCopy {
  title: string;
  summary: string;
  userNeed: string;
  contributionRules: string;
  feasibility: string;
  effort: string;
  firstSteps: string[];
  acceptanceChecks: string[];
  risks: string[];
  /** Why each quote supports the opportunity, in the order of its evidence. */
  reasons: string[];
}

/** The copy of the sample discovery job that getSampleDiscoveryJob() builds. */
export interface DemoDiscoveryCopy {
  /** What the sample search asked for, as a person would type it. */
  interests: string;
  message: (params: { count: number }) => string;
  warnings: string[];
  /** The numbers arrive formatted for the locale; pushedAt is YYYY-MM-DD. */
  popularity: (params: {
    stars: string;
    forks: string;
    pushedAt: string;
  }) => string;
  opportunities: Record<DemoOpportunityId, DemoOpportunityCopy>;
}

/** The copy of one recommendation; its structure is in shared.ts. */
export type DemoRecommendationCopy = Pick<
  ContributionRecommendation,
  "title" | "problem" | "userImpact" | "approach" | "acceptance"
>;

/** The card the demo shows once its sample Draft PR is "published". */
export interface DemoPublishedCard {
  title: string;
  /** Says that nothing was created on GitHub. */
  note: string;
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
  /** The copy of the sample discovery job; see discovery.ts. */
  discovery: DemoDiscoveryCopy;
  // The samples below are optional in the type; every locale fills them.
  /**
   * Sample maintainer feedback and one CI check on the demo's published PR.
   * The maintainer is fictional and each item's url is a fragment, unique per
   * item, never a GitHub link.
   */
  prFeedback?: PrFeedback;
  /** The sample recommendations that "Generate 5 more" adds in the demo. */
  extraRecommendations?: ContributionRecommendation[];
  /** The review reports after a demo re-run, keyed as in Run.reports. */
  rerunReport?: Record<string, string>;
  /** Clone progress lines for the sample import, in order. */
  importSteps?: string[];
  /** Loading lines for the sample analysis, in order. */
  analysisSteps?: string[];
  /** The card shown once the sample Draft PR is published. */
  publishedCard?: DemoPublishedCard;
  /**
   * A finished Explain-it-back check for the sample run, for the demo's
   * "Fill with the sample answer" buttons: the summary, one answer per
   * planned question (keyed by item id; the not-tested question has no
   * grade), the not-tested answer again for the PR's Testing section, and
   * the forecast. One answer is at Think so, graded Partly, with a
   * correction.
   */
  understandingSample?: {
    summary: string;
    answers: Record<
      string,
      { answer: string; confidence: Confidence; grade?: SelfGrade; correction?: string }
    >;
    untested: string;
    forecast: { dimension: TasteDimension; question: string };
  };
  /** A try-first answer to each file's selfCheck question. */
  quizSamples?: Record<
    DemoFilePath,
    { answer: string; confidence: Confidence; grade: SelfGrade }
  >;
  /** A road choice for each file's alternatives card. */
  roadSamples?: Record<
    DemoFilePath,
    { guess: string; choice: RoadChoice; why: string }
  >;
  /**
   * The fictional project's CONTRIBUTING.md, the same file the
   * `demo-contributing` draft source holds. The demo classifies it with the
   * real classifier (sampleRules in src/mission/respect.ts).
   */
  contributingText?: string;
  /** The sample's GitHub facts: PRs open, issue #42 open and free, no PR of yours here yet. */
  contributionFacts?: ContributionFacts;
  /** The sample project's last three merged pull requests, as the size reference. */
  mergedSizes?: MergedPrSize[];
  /** The person's tags on the sample maintainer feedback, keyed by item URL. */
  feedbackTags?: Record<string, FeedbackTag>;
  /** Three due practice items from the sample run. */
  practiceSample?: PracticeItem[];
  /** A sample coach debrief (Pro), labelled as such in the UI. */
  debriefSample?: CoachDebrief;
  /** The person's restatement of the sample review before an AI round. */
  restatementSample?: FollowUpRestatement[];
  /**
   * The sample PR's commits once published with a review round and a merge
   * of the target branch, with what each changed; the commit messages are
   * English in every locale.
   */
  commitHistory?: { commits: CommitSummary[]; details: Record<string, CommitDetail> };
}

/**
 * The words of the demo in one locale. buildDemoContent() joins them with the
 * locale-independent structure in shared.ts; records are keyed by the ids and
 * paths defined there, so the compiler finds missing or stray entries.
 */
export interface DemoCopy {
  /** The locale the copy is written in (the sample debrief records it). */
  locale: Locale;
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
    recommendations: Record<DemoRecommendationId, DemoRecommendationCopy>;
  };
  contributionBrief: ContributionBrief;
  team: {
    planSummary: string;
    /** The words of the lead's premise check; its verdict is in shared.ts. */
    premise: { statement: string; evidence: string };
    tasks: Record<
      DemoTaskId,
      { title: string; description: string; report: string }
    >;
    messages: Record<DemoMessageId, string>;
  };
  draftPreparation: {
    warnings: string[];
    /** The CONTRIBUTING.md content is the same in every locale (shared.ts). */
    sources: {
      "demo-contributing": { label: string };
      "demo-template": { label: string; content: string };
    };
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
  discovery: DemoDiscoveryCopy;
  prFeedback: {
    /** The text of each feedback item, keyed by its id in shared.ts. */
    bodies: Record<DemoFeedbackItemId, string>;
    /** Shown above the feedback; says that it is a fictional sample. */
    warnings: string[];
  };
  extraRecommendations: Record<
    DemoExtraRecommendationId,
    DemoRecommendationCopy
  >;
  /** The reports a review re-run replaces, keyed as in Run.reports. */
  rerunReport: Record<"reviewer" | "tester", string>;
  // Fixed lengths, so every locale plays the same number of steps.
  importSteps: [string, string, string, string];
  analysisSteps: [string, string, string, string, string];
  publishedCard: DemoPublishedCard;
  /** The sample check's words; its ids, confidences and grades are in shared.ts. */
  understanding: {
    summary: string;
    answers: Record<DemoCheckItemId, { answer: string; correction?: string }>;
    forecastQuestion: string;
  };
  /** The try-first answer to each file's selfCheck question. */
  quizzes: Record<DemoFilePath, string>;
  /** The guess before the alternatives card, and why the choice fits. */
  roads: Record<DemoFilePath, { guess: string; why: string }>;
  /** The lesson the person wrote for a maintainer comment that surprised them. */
  feedbackLessons: { "retry-after": string };
  /**
   * The question and reference of each practice item that is not a file's
   * selfCheck; the others take theirs from the file's explanation, and the
   * earlier correction or lesson from the check and the feedback tags.
   */
  practice: Record<DemoPracticeId, { question?: string; reference?: string }>;
  /** The sample debrief's words; each quote is taken from the review's body. */
  debrief: { quotes: string[]; drills: CoachDrill[]; nextStep: string };
  /** The person's restatement of the review comment. */
  restatement: string;
  /**
   * The words of the src/client.ts walkthrough (shared.ts `walkthrough`):
   * one explanation per step, one caller with its name, and one note per
   * callee, in the order shared.ts lists them.
   */
  walkthrough: {
    kind: string;
    summary: string;
    change: string;
    steps: [string, string, string, string];
    callers: [{ name: string; note: string }];
    callees: [string, string, string];
    analogy: string;
    selfCheck: { question: string; answer: string };
  };
}
