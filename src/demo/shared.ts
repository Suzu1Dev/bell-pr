/**
 * The locale-independent structure of the demo: ids, paths, diff lines,
 * numbers, timestamps, and the text a real contribution keeps in English
 * (the PR draft and the commit message). Each locale file supplies the copy
 * as a DemoCopy, and buildDemoContent() joins the two, so every locale shares
 * the same ids, paths and times.
 */
import { ponytailPolicyVersion, type EfficiencyMetrics } from "../../shared/efficiency";
import type { ContributionFacts } from "../../shared/contribution";
import { aiDisclosureLine } from "../../shared/drafts";
import type { ContributionRecommendation } from "../../shared/insights";
import type { PracticeItem } from "../../shared/practice";
import type {
  Confidence,
  RoadChoice,
  SelfGrade,
} from "../../shared/understanding";
import type { DiffFile, Repo } from "../types";
import type {
  DemoContent,
  DemoCopy,
  DemoRecommendationCopy,
} from "./types";

export const repo: Repo = {
  id: "demo-repo",
  name: "open-fetch",
  owner: "openfetch-sample",
  fullName: "openfetch-sample/open-fetch",
  path: "",
  defaultBranch: "main",
  url: "",
  language: "TypeScript",
};

/** The demo diff, in display order. */
export const diffs = [
  {
    path: "src/utils/retry.ts",
    lines: [
      " import type { RetryOptions } from '../types';",
      " ",
      " const sleep = (ms: number) =>",
      "   new Promise<void>((resolve) => setTimeout(resolve, ms));",
      " ",
      " export async function withRetry<T>(",
      "   operation: () => Promise<T>,",
      "   options: RetryOptions = {},",
      " ): Promise<T> {",
      "-  const { maxRetries = 3, delay = 1000 } = options;",
      "+  const {",
      "+    maxRetries = 3,",
      "+    baseDelay = 1000,",
      "+    maxDelay = 30_000,",
      "+    shouldRetry = () => true,",
      "+  } = options;",
      " ",
      "   for (let attempt = 0; ; attempt++) {",
      "     try {",
      "       return await operation();",
      "     } catch (error) {",
      "-      if (attempt >= maxRetries) throw error;",
      "-      await sleep(delay);",
      "+      if (attempt >= maxRetries || !shouldRetry(error)) {",
      "+        throw error;",
      "+      }",
      "+",
      "+      // Exponential backoff with full jitter.",
      "+      const ceiling = Math.min(",
      "+        maxDelay,",
      "+        baseDelay * 2 ** attempt,",
      "+      );",
      "+      const delay = Math.floor(Math.random() * ceiling);",
      "+      await sleep(delay);",
      "     }",
      "   }",
      " }",
    ],
  },
  {
    path: "src/client.ts",
    lines: [
      " import { withRetry } from './utils/retry';",
      " import type { ClientOptions } from './types';",
      " ",
      "+export class HttpError extends Error {",
      "+  constructor(public readonly response: Response) {",
      "+    super(`HTTP ${response.status}`);",
      "+  }",
      "+}",
      "+",
      " export function createClient(options: ClientOptions) {",
      "   return {",
      "     async get<T>(path: string): Promise<T> {",
      "-      const response = await fetch(new URL(path, options.baseURL));",
      "-      return response.json() as Promise<T>;",
      "+      return withRetry(async () => {",
      "+        const response = await fetch(new URL(path, options.baseURL));",
      "+        if (!response.ok) throw new HttpError(response);",
      "+        return response.json() as Promise<T>;",
      "+      }, {",
      "+        ...options.retry,",
      "+        shouldRetry: (error) => error instanceof HttpError",
      "+          ? [408, 429, 500, 502, 503, 504].includes(error.response.status)",
      "+          : error instanceof TypeError,",
      "+      });",
      "     },",
      "   };",
      " }",
    ],
  },
  {
    path: "src/types.ts",
    lines: [
      " export interface RetryOptions {",
      "   maxRetries?: number;",
      "-  delay?: number;",
      "+  /** Initial backoff ceiling, in milliseconds. */",
      "+  baseDelay?: number;",
      "+  /** Maximum backoff ceiling, in milliseconds. */",
      "+  maxDelay?: number;",
      "+  /** Return true to allow another attempt. */",
      "+  shouldRetry?: (error: unknown) => boolean;",
      " }",
      " ",
      " export interface ClientOptions {",
      "   baseURL: string;",
      "+  retry?: Omit<RetryOptions, 'shouldRetry'>;",
      " }",
    ],
  },
  {
    path: "tests/retry.test.ts",
    status: "added",
    lines: [
      "+import { afterEach, describe, expect, it, vi } from 'vitest';",
      "+import { withRetry } from '../src/utils/retry';",
      "+",
      "+describe('withRetry', () => {",
      "+  afterEach(() => {",
      "+    vi.restoreAllMocks();",
      "+    vi.useRealTimers();",
      "+  });",
      "+",
      "+  it('recovers after a temporary failure', async () => {",
      "+    vi.useFakeTimers();",
      "+    vi.spyOn(Math, 'random').mockReturnValue(0.5);",
      "+    const operation = vi.fn()",
      "+      .mockRejectedValueOnce(new Error('temporary'))",
      "+      .mockResolvedValue('ok');",
      "+",
      "+    const result = withRetry(operation);",
      "+    await vi.advanceTimersByTimeAsync(500);",
      "+    await expect(result).resolves.toBe('ok');",
      "+    expect(operation).toHaveBeenCalledTimes(2);",
      "+  });",
      "+",
      "+  it('does not retry an excluded error', async () => {",
      "+    const error = new Error('not retryable');",
      "+    const operation = vi.fn().mockRejectedValue(error);",
      "+    await expect(withRetry(operation, {",
      "+      shouldRetry: () => false,",
      "+    })).rejects.toBe(error);",
      "+    expect(operation).toHaveBeenCalledTimes(1);",
      "+  });",
      "+});",
    ],
  },
  {
    path: "README.md",
    lines: [
      " # Open Fetch",
      " ",
      " A small, typed HTTP client for modern applications.",
      "+",
      "+## Automatic retries",
      "+",
      "+GET requests retry temporary failures with exponential backoff",
      "+and full jitter. The default is 3 retries after the first attempt.",
      "+",
      "+```ts",
      "+const client = createClient({",
      "+  baseURL: 'https://api.example.com',",
      "+  retry: { maxRetries: 3, baseDelay: 1000, maxDelay: 30_000 },",
      "+});",
      "+```",
      "+",
      "+Only network errors and HTTP 408, 429, 500, 502, 503, 504 are retried.",
      "+Other HTTP errors fail immediately.",
      "+",
      "+### Migration",
      "+",
      "+Replace `retry.delay` with `retry.baseDelay`. Unlike a fixed delay,",
      "+this value sets the upper bound of the first randomized wait.",
    ],
  },
] as const satisfies readonly {
  path: string;
  status?: "added";
  lines: readonly string[];
}[];
export type DemoFilePath = (typeof diffs)[number]["path"];

function diff(
  path: string,
  lines: readonly string[],
  explanation: NonNullable<DiffFile["explanation"]>,
  status = "modified",
): DiffFile {
  const additions = lines.filter((line) => line.startsWith("+")).length;
  const deletions = lines.filter((line) => line.startsWith("-")).length;
  const oldCount = lines.filter((line) => !line.startsWith("+")).length;
  const newCount = lines.filter((line) => !line.startsWith("-")).length;
  return {
    path,
    language: path.endsWith(".md") ? "Markdown" : "TypeScript",
    additions,
    deletions,
    status,
    patch: `diff --git a/${path} b/${path}\n--- ${status === "added" ? "/dev/null" : `a/${path}`}\n+++ b/${path}\n@@ -${oldCount ? "1" : "0"},${oldCount} +1,${newCount} @@\n${lines.join("\n")}\n`,
    explanation,
  };
}

/**
 * The sample's function walkthrough of src/client.ts: the unit, its parts,
 * the code it points to and the unit the diff adds whole. Line numbers are
 * in the changed version of the file; each locale's copy has the words.
 */
export const walkthrough = {
  path: "src/client.ts",
  name: "createClient",
  startLine: 10,
  endLine: 25,
  steps: [
    [10, 11],
    [12, 16],
    [17, 21],
    [22, 25],
  ],
  callers: [{ path: "README.md", line: 11 }],
  callees: [
    { name: "withRetry", path: "src/utils/retry.ts", line: 6 },
    { name: "HttpError", path: "src/client.ts", line: 4 },
    { name: "fetch", path: "", line: null },
  ],
  newUnits: ["HttpError"],
} as const;

/**
 * The issue the sample run is for. It is a fragment, shown as "#42
 * (sample)" and never as a link, and it meets the sample project's
 * "issue first" rule.
 */
export const sampleIssueUrl = "#sample-issue-42";

export const run = {
  id: "demo-run",
  status: "review",
  branch: "fix/smart-retry",
  baseBranch: "main",
  createdAt: "2026-10-03T01:30:00.000Z",
  agents: [
    { id: "lead", name: "Atlas", status: "complete" },
    { id: "member-1", name: "Teammate 1", status: "complete" },
    { id: "member-2", name: "Teammate 2", status: "complete" },
    { id: "member-3", name: "Teammate 3", status: "complete" },
    { id: "reviewer", name: "Lens", status: "complete" },
    { id: "tester", name: "Scout", status: "complete" },
  ],
  /** Each entry's copy is keyed by `key`. */
  logs: [
    {
      key: "plan",
      time: "2026-10-03T09:30:00+08:00",
      agent: "lead",
    },
    {
      key: "implement",
      time: "2026-10-03T09:32:00+08:00",
      agent: "member-1",
    },
    {
      key: "review",
      time: "2026-10-03T09:34:00+08:00",
      agent: "reviewer",
    },
  ],
  /**
   * The efficiency mode the sample team ran in, recorded like a real run's.
   * The sample called no AI, so every count is zero and the summary shows
   * no usage.
   */
  efficiency: {
    policyVersion: ponytailPolicyVersion,
    mode: "lite",
    calls: 0,
    completedCalls: 0,
    failedCalls: 0,
    measuredCalls: 0,
    durationMs: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
  } satisfies EfficiencyMetrics,
  draft: {
    title: "feat(client): add exponential backoff and jitter to GET retries",
    // The sample project asks for an AI-assistance disclosure, so the
    // draft ends with the line the draft guide suggests for it, as if the
    // person had applied it; the proposal itself never carries it.
    body: `## Summary\n\n- Add configurable exponential backoff with full jitter.\n- Retry temporary GET failures and preserve HTTP error details.\n- Add example retry tests and document the new configuration.\n\n## Compatibility\n\n\`retry.delay\` is renamed to \`retry.baseDelay\`; callers must update their configuration.\n\n## Validation\n\nThis is demonstration content. Tests have not been executed against a real repository.\n\n## Review notes\n\nConfirm parameter validation, maximum retry coverage, cancellation behavior and Retry-After handling before production use.\n\n${aiDisclosureLine}`,
  },
  /** The task's settings; the issue link is the sample issue. */
  contributionSettings: {
    direction: "bugfix",
    targetUser: "",
    outcome: "",
    constraints: "",
    acceptance: "",
    maxTeammates: 3,
    requirePlanApproval: true,
    issueUrl: sampleIssueUrl,
  },
} as const;
export type DemoAgentId = (typeof run.agents)[number]["id"];
export type DemoLogKey = (typeof run.logs)[number]["key"];

export const insights = {
  modules: [
    "src/client.ts",
    "src/utils/retry.ts",
    "src/types.ts",
    "tests/retry.test.ts",
  ],
  readingPath: [
    "README.md",
    "src/types.ts",
    "src/client.ts",
    "src/utils/retry.ts",
  ],
  evidence: ["README.md", "src/client.ts", "src/utils/retry.ts"],
  recommendations: [
    {
      id: "demo-smart-retry",
      direction: "bugfix",
      effort: "medium",
      confidence: "high",
      evidence: ["src/client.ts", "src/utils/retry.ts"],
    },
    {
      id: "demo-retry-boundaries",
      direction: "testing",
      effort: "small",
      confidence: "high",
      evidence: ["tests/retry.test.ts", "src/utils/retry.ts"],
    },
    {
      id: "demo-upgrade-guide",
      direction: "docs",
      effort: "small",
      confidence: "medium",
      evidence: ["README.md", "src/types.ts"],
    },
  ],
  generatedAt: "2026-10-03T00:00:00+08:00",
  source: "demo",
  baseSha: "demo",
} as const;
export type DemoModulePath = (typeof insights.modules)[number];
export type DemoReadingPath = (typeof insights.readingPath)[number];
export type DemoEvidencePath = (typeof insights.evidence)[number];
export type DemoRecommendationId =
  (typeof insights.recommendations)[number]["id"];

/** The five recommendations that "Generate 5 more" adds in the demo. */
export const extraRecommendations = [
  {
    id: "demo-retry-after",
    direction: "feature",
    effort: "medium",
    confidence: "high",
    evidence: ["src/client.ts", "src/utils/retry.ts"],
  },
  {
    id: "demo-retry-cancel",
    direction: "ux",
    effort: "medium",
    confidence: "medium",
    evidence: ["src/utils/retry.ts", "src/client.ts"],
  },
  {
    id: "demo-validate-options",
    direction: "bugfix",
    effort: "small",
    confidence: "high",
    evidence: ["src/utils/retry.ts", "src/types.ts"],
  },
  {
    id: "demo-delay-deprecation",
    direction: "maintenance",
    effort: "small",
    confidence: "medium",
    evidence: ["src/types.ts", "src/client.ts", "README.md"],
  },
  {
    id: "demo-client-status-tests",
    direction: "testing",
    effort: "small",
    confidence: "high",
    evidence: ["src/client.ts", "tests/retry.test.ts"],
  },
] as const;
export type DemoExtraRecommendationId =
  (typeof extraRecommendations)[number]["id"];

export const team = {
  config: {
    maxTeammates: 3,
    requirePlanApproval: true,
    provider: "codex",
    protocol: "bell-shared-tasks",
    messageDelivery: "between-turns",
  },
  phase: "complete",
  /** The lead's premise check: the request takes for granted that GET does not retry yet. */
  premiseVerdict: "holds",
  tasks: [
    {
      id: "task-1",
      owner: "member-1",
      files: ["src/utils/retry.ts", "src/types.ts"],
      dependsOn: [],
      status: "complete",
      checks: [
        { command: "npm test -- retry", outcome: "exit 0" },
        { command: "npx tsc --noEmit", outcome: "exit 0" },
      ],
      integratedFiles: ["src/utils/retry.ts", "src/types.ts"],
    },
    {
      id: "task-2",
      owner: "member-2",
      files: ["src/client.ts"],
      dependsOn: ["task-1"],
      status: "complete",
    },
    {
      id: "task-3",
      owner: "member-3",
      files: ["README.md"],
      dependsOn: ["task-1"],
      status: "complete",
    },
    {
      id: "task-4",
      owner: "member-1",
      files: ["tests/retry.test.ts"],
      dependsOn: ["task-2", "task-3"],
      status: "complete",
    },
  ],
  messages: [
    {
      id: "m1",
      from: "lead",
      to: "all",
      createdAt: "2026-10-03T09:31:00+08:00",
      status: "delivered",
      recipients: ["task-1", "task-2", "task-3", "task-4"],
      deliveredTo: ["task-1", "task-2", "task-3", "task-4"],
    },
    {
      id: "m2",
      from: "member-1",
      to: "task-2",
      createdAt: "2026-10-03T09:33:00+08:00",
      status: "delivered",
      recipients: ["task-2"],
      deliveredTo: ["task-2"],
    },
  ],
} as const;
export type DemoTaskId = (typeof team.tasks)[number]["id"];
export type DemoMessageId = (typeof team.messages)[number]["id"];

/**
 * The fictional project's CONTRIBUTING.md, written for the sample (no real
 * project's text). It states the three rules the "Before you contribute"
 * card quotes: an issue first, explaining the change in review, and saying
 * so when AI tools helped. Like a real project's rules it is quoted word
 * for word, in English, whatever the interface language.
 */
export const contributingText = [
  "# Contributing to Open Fetch",
  "",
  "Thanks for helping. A few rules keep reviews quick.",
  "",
  "Open an issue before changing behavior.",
  "",
  "You must be able to explain your change in review.",
  "",
  "If you used AI tools, say so in the PR description.",
  "",
  "Titles should describe the improvement users get.",
  "",
  "The testing section should separate the checks you ran from the items still to verify.",
  "",
  "Commit subjects use the format type(scope): summary, followed by a blank line and the reason.",
].join("\n");

/** Synthetic content for the local demo; none of these rules are attributed to a real repository. */
export const draftPreparation = {
  status: "ready",
  fingerprint: "demo-draft-guidance",
  checkedAt: "2026-10-03T01:36:00.000Z",
  baseSha: "demo",
  sources: [
    { id: "demo-contributing", kind: "contributing", path: "CONTRIBUTING.md" },
    {
      id: "demo-template",
      kind: "template",
      path: ".github/PULL_REQUEST_TEMPLATE.md",
    },
  ],
  policy: "repository",
  templateSourceId: "demo-template",
  commitMessage:
    "feat(client): add exponential backoff and jitter to GET retries\n\nTemporary network errors forced users to repeat read requests.\nRetry only idempotent reads, cap the attempts and keep the final\nerror message when the retries are exhausted.",
  commitSources: ["demo-contributing"],
} as const;
export type DemoDraftSourceId =
  (typeof draftPreparation.sources)[number]["id"];

/**
 * Sample maintainer feedback on the demo's published Draft PR (prUrl
 * '#demo-pr'): one review that asks for changes, one comment on a diff line
 * and one CI check. The maintainer is fictional: the login has an underscore,
 * which personal GitHub accounts cannot use. Each url is a fragment that names
 * its item, unique as the feedback list's keys need, and never a link to
 * GitHub. `line` counts lines of the new file, as GitHub does.
 */
export const prFeedback = {
  prNumber: 128,
  fetchedAt: "2026-10-05T02:15:00.000Z",
  checksState: "SUCCESS",
  reviewDecision: "CHANGES_REQUESTED",
  checks: [{ name: "ci / test (node 22)", state: "SUCCESS" }],
  items: [
    {
      id: "review",
      kind: "review",
      author: "sample_maintainer",
      authorAssociation: "MEMBER",
      state: "CHANGES_REQUESTED",
      url: "#demo-pr-review-1",
      createdAt: "2026-10-04T08:20:00.000Z",
    },
    {
      id: "retry-after",
      kind: "thread",
      author: "sample_maintainer",
      authorAssociation: "MEMBER",
      path: "src/client.ts",
      line: 20,
      isResolved: false,
      url: "#demo-pr-thread-1",
      createdAt: "2026-10-04T08:20:00.000Z",
    },
  ],
} as const;
export type DemoFeedbackItemId = (typeof prFeedback.items)[number]["id"];

/**
 * The sample's GitHub facts at publish: pull requests are open to the
 * person, issue #42 is open, unassigned and has no other pull request, a
 * maintainer welcomed a fix, and the person has no pull request here yet
 * (a budget of 1). The logins have an underscore, which GitHub accounts
 * cannot use; nothing here was read from GitHub.
 */
export const contributionFacts = {
  checkedAt: "2026-10-03T01:35:00.000Z",
  door: {
    hasPullRequests: true,
    pullRequestCreationPolicy: "all",
    viewerPermission: "READ",
    login: "sample_contributor",
  },
  issue: {
    url: sampleIssueUrl,
    number: 42,
    title: "GET requests give up on the first temporary error",
    state: "OPEN",
    labels: ["enhancement"],
    assignees: [],
    claims: [],
    otherPrs: [],
    maintainerQuote: {
      author: "sample_maintainer",
      association: "MEMBER",
      quote: "PRs welcome for the retry cap.",
      at: "2026-10-02T09:00:00.000Z",
    },
    viewerCommented: true,
  },
  pacing: { openPrs: 0, mergedPrs: 0, waitingPrs: 0, viewerPermission: "READ" },
} satisfies ContributionFacts;

/** The sample project's last three merged pull requests (the real size reference). */
export const mergedSizes = [
  { number: 118, additions: 64, deletions: 12, changedFiles: 4 },
  { number: 121, additions: 23, deletions: 5, changedFiles: 2 },
  { number: 125, additions: 140, deletions: 31, changedFiles: 6 },
];

/**
 * The structure of the sample check: the questions the check plans for the
 * demo diff (97 changed lines: one file question, `retry.ts`, plus the
 * not-tested question), with the confidence and grade of each answer.
 */
export const understanding = {
  answers: {
    "selfCheck:src/utils/retry.ts": { confidence: "think", grade: "partly" },
    untested: { confidence: "sure" },
  },
  forecastDimension: "tests",
} as const satisfies {
  answers: Record<string, { confidence: Confidence; grade?: SelfGrade }>;
  forecastDimension: string;
};
export type DemoCheckItemId = keyof typeof understanding.answers;

/** The confidence and grade of each file's try-first answer. */
export const quizzes = {
  "src/utils/retry.ts": { confidence: "think", grade: "got" },
  "src/client.ts": { confidence: "think", grade: "got" },
  "src/types.ts": { confidence: "sure", grade: "got" },
  "tests/retry.test.ts": { confidence: "think", grade: "got" },
  "README.md": { confidence: "guess", grade: "partly" },
} as const satisfies Record<DemoFilePath, { confidence: Confidence; grade: SelfGrade }>;

/** The road the person chose for each file's alternative. */
export const roads = {
  "src/utils/retry.ts": "keep",
  "src/client.ts": "keep",
  "src/types.ts": "switch",
  "tests/retry.test.ts": "depends",
  "README.md": "keep",
} as const satisfies Record<DemoFilePath, RoadChoice>;

/**
 * The person's tags on the sample feedback: the review asks for a test
 * (Tests, which the forecast predicted), and the Retry-After comment
 * surprised them (with a lesson in the copy).
 */
export const feedbackTags = {
  review: { dimension: "tests", predicted: true, at: "2026-10-05T02:20:00.000Z" },
  "retry-after": { dimension: "risk", predicted: false, at: "2026-10-05T02:21:00.000Z" },
} as const satisfies Record<DemoFeedbackItemId, { dimension: string; predicted: boolean; at: string }>;

/** Three due practice items from the sample run; their words are copy. */
export const practice = [
  {
    id: "retry-check",
    kind: "check",
    key: "check:selfCheck:src/utils/retry.ts",
    path: "src/utils/retry.ts",
    dueAt: "2026-10-06T01:00:00.000Z",
    lastGrade: "partly",
    lastConfidence: "think",
  },
  {
    id: "retry-after-feedback",
    kind: "feedback",
    key: "feedback:#demo-pr-thread-1",
    feedbackItem: "retry-after",
    path: "src/client.ts",
    dimension: "risk",
    dueAt: "2026-10-06T02:00:00.000Z",
  },
  {
    id: "types-self-check",
    kind: "selfCheck",
    key: "selfCheck:src/types.ts",
    path: "src/types.ts",
    dueAt: "2026-10-06T03:00:00.000Z",
  },
] as const satisfies readonly (Pick<
  PracticeItem,
  "kind" | "key" | "path" | "dueAt" | "dimension" | "lastGrade" | "lastConfidence"
> & { id: string; feedbackItem?: "retry-after" })[];
export type DemoPracticeId = (typeof practice)[number]["id"];

/** The sample coach debrief (Pro): written after the feedback was read. */
export const debrief = {
  at: "2026-10-06T00:00:00.000Z",
  dimension: "tests",
} as const;

/**
 * The sample discovery job: fictional repositories, issues and quotes that
 * stand in for live results. No owner exists on GitHub (`gh api users/<owner>`
 * returns 404) and every URL is empty, so nothing links to a real or
 * claimable page. The repository documents are English, as a real project's
 * would be; the analysis around them is copy. Like a live result, every
 * opportunity quotes an issue, quotes CONTRIBUTING.md when the repository has
 * one, and each quote is taken verbatim from its source.
 */
export const sampleDiscovery = {
  id: "sample-discovery",
  createdAt: "2026-10-02T20:00:00+08:00",
  completedAt: "2026-10-02T20:03:00+08:00",
  preferences: { difficulty: "any", minStars: 50, sort: "updated" },
  candidates: [
    {
      fullName: "markwell-sample/markwell",
      url: "",
      description:
        "A Markdown linter that checks documentation links, heading levels and code fences.",
      language: "TypeScript",
      stars: 1840,
      forks: 132,
      pushedAt: "2026-09-29T14:12:00Z",
      openIssues: 47,
      sources: [
        {
          id: "markwell-sample/markwell:file:CONTRIBUTING.md",
          kind: "contributing",
          title: "CONTRIBUTING.md",
          url: "",
          content:
            "# Contributing\n\nComment on the issue you want to take before you start, so two people do not fix the same thing.\n\nEvery rule change needs a fixture in `test/fixtures/` and an entry in `CHANGELOG.md`.\n\nRun `npm test` and `npm run lint` before you open a pull request.",
        },
        {
          id: "markwell-sample/markwell:issue:57",
          kind: "issue",
          title: "#57 Broken link warnings do not say where the link is",
          url: "",
          content:
            "Broken link warnings do not say where the link is\n\nWhen a relative link is broken, markwell prints `docs/setup.md: broken link ./instal.md`. On a long page I have to search for the link by hand.\n\nThe heading rules already print `file:line:column`. Could the link rule do the same?",
        },
      ],
      warnings: [],
    },
    {
      fullName: "cronwise-sample/cronwise",
      url: "",
      description:
        "Explains cron expressions in plain language and previews the next run times.",
      language: "Python",
      stars: 960,
      forks: 71,
      pushedAt: "2026-10-01T08:45:00Z",
      openIssues: 23,
      sources: [
        {
          id: "cronwise-sample/cronwise:file:README.md",
          kind: "readme",
          title: "README.md",
          url: "",
          content:
            "# cronwise\n\nTurn a cron expression into a plain-language sentence and preview the next run times.\n\n```python\nfrom cronwise import explain\nexplain(\"0 9 * * 1-5\")  # At 09:00, Monday through Friday\n```\n\nDay-of-week ranges may wrap around the end of the week, so `5-1` means Friday through Monday.",
        },
        {
          id: "cronwise-sample/cronwise:file:CONTRIBUTING.md",
          kind: "contributing",
          title: "CONTRIBUTING.md",
          url: "",
          content:
            "# Contributing to cronwise\n\nPlease open or claim an issue before you send a pull request.\n\nAdd a test to `tests/test_schedule.py` for every expression you fix.\n\nWe use `pytest` and `ruff`; both must pass in CI.",
        },
        {
          id: "cronwise-sample/cronwise:issue:112",
          kind: "issue",
          title: "#112 Next run times skip the weekend for a wrapping range",
          url: "",
          content:
            "Next run times skip the weekend for a wrapping range\n\n`explain(\"0 22 * * 5-1\")` correctly says \"At 22:00, Friday through Monday\", but `next_runs()` only returns Fridays and Mondays. Saturday and Sunday are missing.\n\nI think `expand_range()` assumes the start is smaller than the end.",
        },
      ],
      warnings: [],
    },
    {
      fullName: "huecheck-sample/huecheck",
      url: "",
      description:
        "A command-line tool that checks text colors in CSS files against WCAG contrast ratios.",
      language: "Go",
      stars: 410,
      forks: 38,
      pushedAt: "2026-09-24T19:30:00Z",
      openIssues: 12,
      sources: [
        {
          id: "huecheck-sample/huecheck:file:README.md",
          kind: "readme",
          title: "README.md",
          url: "",
          content:
            "# huecheck\n\nhuecheck reads CSS files and reports text colors whose contrast with the background is below the WCAG AA ratio.\n\n```sh\nhuecheck ./styles\n```\n\nCustom properties such as `var(--text-muted)` are not resolved yet.",
        },
        {
          id: "huecheck-sample/huecheck:issue:88",
          kind: "issue",
          title: "#88 Colors set through custom properties are skipped without a warning",
          url: "",
          content:
            "Colors set through custom properties are skipped without a warning\n\nA rule like `color: var(--text-muted)` is ignored and huecheck still exits with 0. Most design systems define their colors this way, so a clean run can hide real contrast problems.\n\nA first step could be a warning that lists the skipped declarations.",
        },
      ],
      warnings: [],
    },
  ],
  opportunities: [
    {
      id: "markwell-link-positions",
      repository: "markwell-sample/markwell",
      difficulty: "beginner",
      // A starter issue: practice to write by hand, not work for the agent team.
      learnByHand: true,
      evidence: [
        {
          sourceId: "markwell-sample/markwell:issue:57",
          quote:
            "The heading rules already print `file:line:column`. Could the link rule do the same?",
        },
        {
          sourceId: "markwell-sample/markwell:file:CONTRIBUTING.md",
          quote:
            "Every rule change needs a fixture in `test/fixtures/` and an entry in `CHANGELOG.md`.",
        },
      ],
    },
    {
      id: "cronwise-wrapping-ranges",
      repository: "cronwise-sample/cronwise",
      difficulty: "intermediate",
      evidence: [
        {
          sourceId: "cronwise-sample/cronwise:issue:112",
          quote:
            "I think `expand_range()` assumes the start is smaller than the end.",
        },
        {
          sourceId: "cronwise-sample/cronwise:file:CONTRIBUTING.md",
          quote:
            "Add a test to `tests/test_schedule.py` for every expression you fix.",
        },
        {
          sourceId: "cronwise-sample/cronwise:file:README.md",
          quote:
            "Day-of-week ranges may wrap around the end of the week, so `5-1` means Friday through Monday.",
        },
      ],
    },
    {
      id: "huecheck-skipped-variables",
      repository: "huecheck-sample/huecheck",
      difficulty: "beginner",
      evidence: [
        {
          sourceId: "huecheck-sample/huecheck:issue:88",
          quote:
            "A first step could be a warning that lists the skipped declarations.",
        },
        {
          sourceId: "huecheck-sample/huecheck:file:README.md",
          quote:
            "Custom properties such as `var(--text-muted)` are not resolved yet.",
        },
      ],
    },
  ],
} as const;
export type DemoOpportunityId =
  (typeof sampleDiscovery.opportunities)[number]["id"];

/** One recommendation: its structure from this file, its copy from a locale. */
function recommendation(
  structure: (
    | typeof insights.recommendations
    | typeof extraRecommendations
  )[number],
  text: DemoRecommendationCopy,
): ContributionRecommendation {
  return {
    id: structure.id,
    title: text.title,
    direction: structure.direction,
    problem: text.problem,
    userImpact: text.userImpact,
    approach: text.approach,
    acceptance: text.acceptance,
    effort: structure.effort,
    confidence: structure.confidence,
    evidence: [...structure.evidence],
  };
}

/** Joins the shared structure with one locale's copy. */
export function buildDemoContent(copy: DemoCopy): DemoContent {
  return {
    repo,
    files: diffs.map((file) => {
      const changed = diff(
        file.path,
        file.lines,
        copy.explanations[file.path],
        "status" in file ? file.status : undefined,
      );
      if (file.path !== walkthrough.path) return changed;
      const text = copy.walkthrough;
      return {
        ...changed,
        walkthroughStatus: "ready",
        walkthrough: {
          functions: [
            {
              name: walkthrough.name,
              kind: text.kind,
              startLine: walkthrough.startLine,
              endLine: walkthrough.endLine,
              summary: text.summary,
              change: text.change,
              steps: walkthrough.steps.map(([startLine, endLine], index) => ({
                startLine,
                endLine,
                explanation: text.steps[index],
              })),
              callers: walkthrough.callers.map((caller, index) => ({
                ...caller,
                ...text.callers[index],
              })),
              callees: walkthrough.callees.map((callee, index) => ({
                ...callee,
                note: text.callees[index],
              })),
              analogy: text.analogy,
              selfCheck: { ...text.selfCheck },
            },
          ],
          newUnits: [...walkthrough.newUnits],
        },
      };
    }),
    run: {
      id: run.id,
      repoId: repo.id,
      title: copy.run.title,
      prompt: copy.run.prompt,
      status: run.status,
      branch: run.branch,
      baseBranch: run.baseBranch,
      createdAt: run.createdAt,
      agents: run.agents.map((agent) => ({
        ...agent,
        ...copy.run.agents[agent.id],
      })),
      logs: run.logs.map((log) => ({
        time: log.time,
        agent: log.agent,
        message: copy.run.logs[log.key],
      })),
      draft: { ...run.draft },
      reviewedFiles: [],
      reports: { ...copy.run.reports },
      efficiency: { ...run.efficiency },
      contributionSettings: { ...run.contributionSettings },
    },
    insights: {
      summary: copy.insights.summary,
      purpose: copy.insights.purpose,
      audience: copy.insights.audience,
      userJourney: copy.insights.userJourney,
      modules: insights.modules.map((path) => ({
        path,
        purpose: copy.insights.modules[path],
      })),
      readingPath: insights.readingPath.map((path) => ({
        path,
        ...copy.insights.readingPath[path],
      })),
      howItFitsTogether: copy.insights.howItFitsTogether,
      evidence: insights.evidence.map((path) => ({
        path,
        note: copy.insights.evidence[path],
      })),
      recommendations: insights.recommendations.map((structure) =>
        recommendation(structure, copy.insights.recommendations[structure.id]),
      ),
      generatedAt: insights.generatedAt,
      source: insights.source,
      baseSha: insights.baseSha,
    },
    contributionBrief: copy.contributionBrief,
    team: {
      config: { ...team.config },
      phase: team.phase,
      planSummary: copy.team.planSummary,
      premise: { verdict: team.premiseVerdict, ...copy.team.premise },
      tasks: team.tasks.map((task) => {
        const text = copy.team.tasks[task.id];
        return {
          id: task.id,
          title: text.title,
          description: text.description,
          owner: task.owner,
          files: [...task.files],
          dependsOn: [...task.dependsOn],
          status: task.status,
          report: text.report,
          ...("checks" in task
            ? {
                checks: task.checks.map((check) => ({ ...check })),
                integratedFiles: [...task.integratedFiles],
              }
            : {}),
        };
      }),
      messages: team.messages.map((message) => ({
        id: message.id,
        from: message.from,
        to: message.to,
        content: copy.team.messages[message.id],
        createdAt: message.createdAt,
        status: message.status,
        recipients: [...message.recipients],
        deliveredTo: [...message.deliveredTo],
      })),
    },
    draftPreparation: {
      status: draftPreparation.status,
      fingerprint: draftPreparation.fingerprint,
      context: {
        checkedAt: draftPreparation.checkedAt,
        baseSha: draftPreparation.baseSha,
        warnings: copy.draftPreparation.warnings,
        sources: draftPreparation.sources.map((source) => ({
          ...source,
          label: copy.draftPreparation.sources[source.id].label,
          // One CONTRIBUTING.md: the rules card and the draft guide quote the same file.
          content:
            source.id === "demo-contributing"
              ? contributingText
              : copy.draftPreparation.sources["demo-template"].content,
        })),
      },
      proposal: {
        title: copy.draftPreparation.proposal.title,
        policy: draftPreparation.policy,
        summary: copy.draftPreparation.proposal.summary,
        templateSourceId: draftPreparation.templateSourceId,
        body: copy.draftPreparation.proposal.body,
        rules: copy.draftPreparation.proposal.rules.map((rule) => ({
          text: rule.text,
          sourceId: rule.sourceId,
          quote: rule.quote,
        })),
        checklist: copy.draftPreparation.proposal.checklist,
        commitMessageSuggestion: {
          message: draftPreparation.commitMessage,
          rationale: copy.draftPreparation.proposal.commitRationale,
          sources: [...draftPreparation.commitSources],
        },
      },
    },
    answers: copy.answers,
    discovery: copy.discovery,
    prFeedback: {
      fetchedAt: prFeedback.fetchedAt,
      prNumber: prFeedback.prNumber,
      items: prFeedback.items.map(({ id, ...item }) => ({
        ...item,
        body: copy.prFeedback.bodies[id],
      })),
      checksState: prFeedback.checksState,
      reviewDecision: prFeedback.reviewDecision,
      checks: prFeedback.checks.map((check) => ({ ...check })),
      warnings: [...copy.prFeedback.warnings],
    },
    extraRecommendations: extraRecommendations.map((structure) =>
      recommendation(structure, copy.extraRecommendations[structure.id]),
    ),
    rerunReport: { ...copy.rerunReport },
    importSteps: [...copy.importSteps],
    analysisSteps: [...copy.analysisSteps],
    publishedCard: { ...copy.publishedCard },
    understandingSample: {
      summary: copy.understanding.summary,
      answers: Object.fromEntries(
        (Object.keys(understanding.answers) as DemoCheckItemId[]).map((id) => [
          id,
          { ...understanding.answers[id], ...copy.understanding.answers[id] },
        ]),
      ),
      untested: copy.understanding.answers.untested.answer,
      forecast: {
        dimension: understanding.forecastDimension,
        question: copy.understanding.forecastQuestion,
      },
    },
    quizSamples: Object.fromEntries(
      diffs.map(({ path }) => [path, { answer: copy.quizzes[path], ...quizzes[path] }]),
    ) as NonNullable<DemoContent["quizSamples"]>,
    roadSamples: Object.fromEntries(
      diffs.map(({ path }) => [path, { ...copy.roads[path], choice: roads[path] }]),
    ) as NonNullable<DemoContent["roadSamples"]>,
    contributingText,
    contributionFacts: structuredClone(contributionFacts) as ContributionFacts,
    mergedSizes: mergedSizes.map((size) => ({ ...size })),
    feedbackTags: Object.fromEntries(
      prFeedback.items.map(({ id, url }) => [
        url,
        {
          ...feedbackTags[id],
          ...(id === "retry-after" ? { lesson: copy.feedbackLessons[id] } : {}),
        },
      ]),
    ),
    // A file's selfCheck item takes its words from the explanation, a
    // missed check answer its correction, a feedback item its lesson.
    practiceSample: practice.map(({ id, ...structure }) => {
      const { feedbackItem, ...item } = { feedbackItem: undefined, ...structure };
      const text = copy.practice[id];
      const check = copy.explanations[item.path].selfCheck;
      const earlier =
        item.kind === "check"
          ? copy.understanding.answers[`selfCheck:${item.path}` as DemoCheckItemId]?.correction
          : feedbackItem
            ? copy.feedbackLessons[feedbackItem]
            : undefined;
      const reference = text.reference ?? check?.answer;
      return {
        ...item,
        runId: run.id,
        repoId: repo.id,
        question: text.question ?? check?.question ?? "",
        ...(reference ? { reference } : {}),
        ...(earlier ? { earlier } : {}),
        codeAvailable: true,
      };
    }),
    debriefSample: {
      at: debrief.at,
      locale: copy.locale,
      runIds: [run.id],
      recurring: { dimension: debrief.dimension, quotes: [...copy.debrief.quotes] },
      drills: copy.debrief.drills.map((drill) => ({ ...drill })),
      nextStep: copy.debrief.nextStep,
    },
    restatementSample: [
      { url: prFeedback.items[0].url, text: copy.restatement },
    ],
  };
}
