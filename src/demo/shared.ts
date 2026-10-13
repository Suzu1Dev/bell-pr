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
  owner: "acme-labs",
  fullName: "acme-labs/open-fetch",
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
    { id: "planner", name: "Planner", status: "complete" },
    { id: "developer", name: "Developer", status: "complete" },
    { id: "reviewer", name: "Reviewer", status: "complete" },
    { id: "tester", name: "Tester", status: "complete" },
  ],
  /** Each entry's copy is keyed by `key`. */
  logs: [
    { key: "plan", time: "09:30", agent: "planner" },
    { key: "implement", time: "09:32", agent: "developer" },
    { key: "review", time: "09:34", agent: "reviewer" },
  ],
  draft: {
    title: "feat: add exponential backoff and jitter to GET retries",
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
      createdAt: "2026-10-03T01:20:00+08:00",
      status: "delivered",
      recipients: ["task-1", "task-2", "task-3", "task-4"],
      deliveredTo: ["task-1", "task-2", "task-3", "task-4"],
    },
    {
      id: "m2",
      from: "member-1",
      to: "task-2",
      createdAt: "2026-10-03T01:24:00+08:00",
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
  checkedAt: "2026-10-03T00:00:00.000Z",
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
    "fix(client): retry temporary read failures with backoff\n\nTemporary network errors forced users to repeat read requests.\nRetry only idempotent reads, cap the attempts and keep the final\nerror message when the retries are exhausted.",
  commitSources: ["demo-contributing"],
} as const;
export type DemoDraftSourceId =
  (typeof draftPreparation.sources)[number]["id"];

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
  };
}
