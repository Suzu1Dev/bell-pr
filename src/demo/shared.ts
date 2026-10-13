/**
 * The locale-independent structure of the demo: ids, paths, diff lines,
 * numbers, timestamps, and the text a real contribution keeps in English
 * (the PR draft and the commit message). Each locale file supplies the copy
 * as a DemoCopy, and buildDemoContent() joins the two, so every locale shares
 * the same ids, paths and times.
 */
import type { DiffFile, Repo } from "../types";
import type { DemoContent, DemoCopy } from "./types";

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
  draft: {
    title: "feat(client): add exponential backoff and jitter to GET retries",
    body: "## Summary\n\n- Add configurable exponential backoff with full jitter.\n- Retry temporary GET failures and preserve HTTP error details.\n- Add example retry tests and document the new configuration.\n\n## Compatibility\n\n`retry.delay` is renamed to `retry.baseDelay`; callers must update their configuration.\n\n## Validation\n\nThis is demonstration content. Tests have not been executed against a real repository.\n\n## Review notes\n\nConfirm parameter validation, maximum retry coverage, cancellation behavior and Retry-After handling before production use.",
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

export const team = {
  config: {
    maxTeammates: 3,
    requirePlanApproval: true,
    provider: "codex",
    protocol: "bell-shared-tasks",
    messageDelivery: "between-turns",
  },
  phase: "complete",
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

/** Joins the shared structure with one locale's copy. */
export function buildDemoContent(copy: DemoCopy): DemoContent {
  return {
    repo,
    files: diffs.map((file) =>
      diff(
        file.path,
        file.lines,
        copy.explanations[file.path],
        "status" in file ? file.status : undefined,
      ),
    ),
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
      recommendations: insights.recommendations.map((recommendation) => {
        const text = copy.insights.recommendations[recommendation.id];
        return {
          id: recommendation.id,
          title: text.title,
          direction: recommendation.direction,
          problem: text.problem,
          userImpact: text.userImpact,
          approach: text.approach,
          acceptance: text.acceptance,
          effort: recommendation.effort,
          confidence: recommendation.confidence,
          evidence: [...recommendation.evidence],
        };
      }),
      generatedAt: insights.generatedAt,
      source: insights.source,
      baseSha: insights.baseSha,
    },
    contributionBrief: copy.contributionBrief,
    team: {
      config: { ...team.config },
      phase: team.phase,
      planSummary: copy.team.planSummary,
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
          ...copy.draftPreparation.sources[source.id],
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
  };
}
