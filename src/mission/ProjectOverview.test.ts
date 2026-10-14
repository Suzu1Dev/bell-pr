import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { formatters } from "../../shared/i18n/locale";
import type { ProjectInsights } from "../../shared/insights";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import { demoInsights } from "./demo";
import { ProjectOverview, type ProjectOverviewProps } from "./ProjectOverview";

const repo = {
  id: "demo-repo",
  name: "open-fetch",
  owner: "demo",
  fullName: "demo/open-fetch",
  path: "/tmp/open-fetch",
  defaultBranch: "main",
  url: "",
};

const render = (overrides: Partial<ProjectOverviewProps> = {}) =>
  renderZh(
    createElement(ProjectOverview, {
      repo,
      insights: demoInsights,
      loading: false,
      error: "",
      recommending: false,
      recommendationError: "",
      recommendationPreferences: { order: [], hidden: [] },
      savingPreferences: false,
      preferenceError: "",
      stale: false,
      onAnalyze() {},
      onRecommendMore() {},
      onSavePreferences() {},
      onChooseRecommendation() {},
      onReadCode() {},
      ...overrides,
    }),
  );

const analyzed: ProjectInsights = {
  ...demoInsights,
  source: "ai",
  baseSha: "0123456789abcdef0123456789abcdef01234567",
};

test("the reading path lists each step with the matching module purpose and evidence note", () => {
  const html = render();
  assert.match(html, /第一次讀這個專案，建議這樣讀/);
  assert.match(html, /模組怎麼串起來/);
  assert.match(html, /示範 diff 中尚未被 client 引用/);
  // src/client.ts appears in modules and evidence; both show under its step.
  assert.match(html, /對外提供 client，送出 GET 請求並處理回應。/);
  assert.match(html, /示範 diff 的原始 GET 實作直接呼叫 fetch/);
  for (const step of demoInsights.readingPath ?? []) {
    assert.match(html, new RegExp(step.lookFor));
  }
  const legacy = render({ insights: { ...demoInsights, readingPath: undefined } });
  assert.doesNotMatch(legacy, /第一次讀這個專案/);
  assert.match(legacy, /主要模組怎麼分工？/);
});

test("the stale notice reports changed and cited files, and never suggests skipping re-analysis", () => {
  const unknown = render({ insights: analyzed, stale: true });
  assert.match(unknown, /無法列出變更明細；重新分析後再確認貢獻方向/);

  const cited = render({
    insights: analyzed,
    stale: true,
    staleDetail: { changedFiles: 3, citedChanged: ["src/client.ts"] },
  });
  assert.match(
    cited,
    /自分析版本 0123456後有至少 3 個檔案變動，其中 1 個是本份分析引用的檔案：src\/client\.ts。重新分析後再確認貢獻方向。/,
  );

  const uncited = render({
    insights: analyzed,
    stale: true,
    staleDetail: { changedFiles: 2, citedChanged: [] },
  });
  assert.match(uncited, /分析引用的檔案未變動，但全貌仍可能受其他變更影響/);
  assert.match(uncited, /重新分析後再確認貢獻方向/);

  const sameContent = render({
    insights: analyzed,
    stale: true,
    staleDetail: { changedFiles: 0, citedChanged: [] },
  });
  assert.match(sameContent, /版本已變更，但分析引用的檔案內容相同/);
  assert.match(sameContent, /重新分析後再確認貢獻方向/);

  for (const html of [unknown, cited, uncited, sameContent]) {
    assert.match(html, /專案版本已更新，請先重新分析專案，再產出更多建議。/);
    assert.match(html, /disabled="" aria-describedby="mission-more-description"/);
  }
  assert.doesNotMatch(render({ insights: analyzed }), /重新分析後再確認貢獻方向/);
});

test("unsampled reading steps are marked and dropped citations are listed; old caches show neither", () => {
  const [first, ...rest] = analyzed.readingPath ?? [];
  const html = render({
    insights: {
      ...analyzed,
      readingPath: [{ ...first, sampled: false }, ...rest],
      verification: {
        droppedRecommendations: [],
        droppedPaths: [
          { field: "evidence", path: "hello.ts", reason: "引用了未抽樣的檔案 hello.ts" },
        ],
      },
    },
  });
  assert.match(html, /未抽樣，內容未讀/);
  assert.match(html, /因引用未抽樣／不存在的檔案而略過 1 項說明/);
  assert.match(html, /hello\.ts/);
  const legacy = render({ insights: analyzed });
  assert.doesNotMatch(legacy, /未抽樣，內容未讀/);
  assert.doesNotMatch(legacy, /因引用未抽樣／不存在的檔案而略過/);
});

test("BELL's own clone offers an update to the latest default branch, which pauses analysis while it runs", () => {
  // Local imports and the demo get no handler, so no button.
  assert.doesNotMatch(render(), /更新到最新版本/);
  const updatable = render({
    repo: { ...repo, updatedAt: "2026-10-13T00:00:00.000Z" },
    onUpdateRepo() {},
  });
  assert.match(updatable, /aria-describedby="mission-update-help">.*更新到最新版本<\/button>/);
  assert.match(updatable, /從 GitHub 取得 main 的最新版本/);
  assert.match(updatable, /上次更新：/);
  const updating = render({ onUpdateRepo() {}, updatingRepo: true });
  assert.match(updating, /disabled="" aria-describedby="mission-update-help">.*正在更新…<\/button>/);
  assert.match(updating, /<button[^>]*disabled="">(?:(?!<\/button>).)*重新分析<\/button>/);
  assert.doesNotMatch(
    render({ onUpdateRepo() {} }),
    /<button[^>]*disabled="">(?:(?!<\/button>).)*重新分析<\/button>/,
  );
});

// English renders use an English analysis, so any Han left in the output
// comes from the overview itself.
const englishInsights: ProjectInsights = {
  summary: "A small HTTP client for dashboards",
  purpose: "open-fetch wraps fetch with retries and typed responses.",
  audience: ["Front-end developers", "Dashboard maintainers"],
  userJourney: ["Install the package", "Create a client", "Call get() with retries"],
  modules: [
    { path: "src/client.ts", purpose: "Creates the client and sends GET requests." },
    { path: "src/retry.ts", purpose: "Decides when a request is retried." },
  ],
  readingPath: [
    { path: "src/client.ts", why: "Every request starts here.", lookFor: "How get() builds a request" },
    { path: "docs/", why: "Lists the options.", lookFor: "The retry options", sampled: false },
  ],
  howItFitsTogether: "get() calls fetch and hands failures to retry.ts.",
  evidence: [{ path: "src/client.ts", note: "get() calls fetch directly." }],
  recommendations: [
    {
      id: "retry-jitter",
      title: "Add jitter to GET retries",
      direction: "performance",
      problem: "Clients retry at the same moment after an outage.",
      userImpact: "Dashboards recover without a burst of requests.",
      approach: "Randomise the retry delay.",
      acceptance: ["Delays differ between clients"],
      effort: "small",
      confidence: "high",
      evidence: ["src/retry.ts"],
      evidenceDetails: [
        { path: "src/retry.ts", quote: "const delay = 100;", reason: "The delay is fixed." },
      ],
    },
    {
      id: "docs-timeout",
      title: "Document the timeout option",
      direction: "docs",
      problem: "The timeout option is not documented.",
      userImpact: "People find the option without reading the code.",
      approach: "Add a README section.",
      acceptance: [],
      effort: "medium",
      confidence: "medium",
      evidence: [],
    },
    {
      id: "no-retry-401",
      title: "Stop retrying 401 answers",
      direction: "bugfix",
      problem: "A 401 is retried three times.",
      userImpact: "Expired sessions fail fast.",
      approach: "Skip retries for 401.",
      acceptance: ["401 is not retried"],
      effort: "large",
      confidence: "low",
      evidence: ["src/client.ts"],
    },
  ],
  verification: {
    droppedRecommendations: [
      { id: "parser", title: "Rewrite the parser", reason: "The quote was not in the excerpt." },
    ],
    droppedPaths: [
      { field: "modules", path: "src/legacy.ts", reason: "The file is not in the tree." },
    ],
  },
  recommendationExpansion: {
    generatedAt: "2026-10-08T09:30:00.000Z",
    addedIds: ["no-retry-401"],
    requestedCount: 5,
    verification: {
      droppedRecommendations: [
        { id: "cache", title: "Cache responses", reason: "The quote did not match." },
      ],
    },
  },
  generatedAt: "2026-10-07T08:00:00.000Z",
  source: "ai",
  baseSha: "0123456789abcdef0123456789abcdef01234567",
  sample: { trackedFiles: 480, sampledFiles: 120, bytes: 358_400, truncatedFiles: 12 },
};

const englishRun = {
  id: "run-1",
  repoId: "demo-repo",
  title: "Add jitter to GET retries",
  prompt: "Spread out GET retries after an outage.",
  status: "review",
  createdAt: "2026-10-08T10:00:00.000Z",
  updatedAt: "2026-10-08T10:30:00.000Z",
  agents: [],
  logs: [],
  diff: [],
} as unknown as NonNullable<ProjectOverviewProps["run"]>;

const renderEnglish = (overrides: Partial<ProjectOverviewProps> = {}) =>
  renderEn(
    createElement(ProjectOverview, {
      repo,
      insights: englishInsights,
      loading: false,
      error: "",
      recommending: false,
      recommendationError: "",
      recommendationPreferences: { order: [], hidden: [] },
      savingPreferences: false,
      preferenceError: "",
      stale: false,
      onAnalyze() {},
      onRecommendMore() {},
      onSavePreferences() {},
      onChooseRecommendation() {},
      onReadCode() {},
      ...overrides,
    }),
  );

// ModelSummary (src/models) and EfficiencySummary (src/efficiency) have their
// own English tests; leave their sections out so these tests check the
// overview's own text.
const summarySections =
  /<section class="(?:model|efficiency)-summary"[^>]*>[\s\S]*?<\/section>/g;
const overviewText = (html: string) => html.replace(summarySections, "");

const en = formatters("en");

test("the English overview has no Han, wherever the overview writes text", () => {
  const states: Partial<ProjectOverviewProps>[] = [
    {},
    { insights: null },
    { insights: null, loading: true },
    { insights: null, error: "Could not reach the service." },
    {
      run: englishRun,
      brief: {
        problem: "Retries arrive together.",
        motivation: "Outages hit every client at once.",
        beneficiaries: ["Dashboard users"],
        before: "Every client retries after 100 ms.",
        after: "Retries spread out.",
        validation: ["A test checks the delays"],
        risks: ["Slower first retry"],
      },
    },
    { run: englishRun, onStartContribution() {} },
    { onStartContribution() {} },
    {
      recommendationPreferences: { order: [], hidden: ["docs-timeout"] },
      savingPreferences: true,
      preferenceError: "Could not save the order.",
      recommendationError: "The model timed out.",
    },
    { recommending: true },
    {
      recommendationPreferences: {
        order: [],
        hidden: ["retry-jitter", "docs-timeout", "no-retry-401"],
      },
    },
    { insights: { ...englishInsights, recommendations: [] } },
    { insights: { ...englishInsights, source: "demo", sample: undefined } },
    { insights: { ...englishInsights, sample: undefined } },
    {
      onUpdateRepo() {},
      repo: { ...repo, updatedAt: "2026-10-13T00:00:00.000Z" },
    },
    { onUpdateRepo() {}, updatingRepo: true },
    { stale: true },
    { stale: true, staleDetail: { changedFiles: 0, citedChanged: [] } },
    { stale: true, staleDetail: { changedFiles: 4, citedChanged: [] } },
    {
      stale: true,
      staleDetail: {
        changedFiles: 1_250,
        citedChanged: Array.from({ length: 12 }, (_, index) => `src/file-${index}.ts`),
      },
    },
  ];
  for (const state of states) {
    const html = renderEnglish(state);
    assert.ok(html.length > 0);
    assertNoHan(overviewText(html));
  }
});

test("the English overview words counts, dates and the update help in English", () => {
  const html = renderEnglish({
    onUpdateRepo() {},
    repo: { ...repo, updatedAt: "2026-10-13T00:00:00.000Z" },
    recommendationPreferences: { order: [], hidden: ["docs-timeout"] },
  });
  assert.match(html, />Update to the latest version<\/button>/);
  assert.ok(
    html.includes(
      `Fetches the latest main from GitHub, and the overview and analysis follow it. New contributions always start from the latest version. Last updated: ${en.dateTime("2026-10-13T00:00:00.000Z")}`,
    ),
  );
  const analyzed = en.dateTime("2026-10-07T08:00:00.000Z", {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  assert.ok(html.includes(`Updated ${analyzed} · Version <code>0123456</code>`));
  assert.match(
    html,
    /Read 120 of 480 tracked files \(about 350 KB, 12 only in part\); the inferences still need checking/,
  );
  assert.match(html, />2 modules</);
  assert.match(html, />1 source</);
  assert.match(html, />3 recommendations</);
  assert.match(html, /Generate 5 more/);
  assert.match(html, /<span class="mission-idea-direction">.*?<\/svg>Improve performance<\/span>/);
  assert.match(html, />Small scope</);
  assert.match(html, />Well supported</);
  assert.match(html, /1 recommendation hidden/);
  assert.match(html, /aria-label="Show again: Document the timeout option"/);
  assert.match(html, /Skipped 2 recommendations whose quotes failed the check/);
  assert.match(html, /<span>Project analysis<\/span>/);
  assert.match(html, /<span>Latest batch<\/span>/);
  assert.match(html, /Skipped 1 note citing unsampled or missing files/);
  assert.match(html, /<strong>Module roles<\/strong>/);
  assert.match(html, /Showing 1 of 2 visible recommendations/);
  assert.match(html, /aria-label="Usage of this project analysis"/);
  assert.match(html, /aria-label="Usage of this recommendation batch"/);
  assert.match(html, /This batch fell short of its target/);
  assert.match(html, /View this batch&#x27;s new recommendations \(1 of 5\)/);
});

test("the English stale notices name the changed and cited files in one sentence", () => {
  const cited = renderEnglish({
    stale: true,
    staleDetail: { changedFiles: 3, citedChanged: ["src/client.ts", "src/retry.ts"] },
  });
  assert.match(
    cited,
    /At least 3 files changed since the analyzed version 0123456, including 2 files that this analysis cites: src\/client\.ts, src\/retry\.ts\. Re-analyze before you settle on a direction\./,
  );
  assert.match(cited, /The project has a newer version\. Re-analyze it before you generate more recommendations\./);

  const one = renderEnglish({
    insights: { ...englishInsights, baseSha: "" },
    stale: true,
    staleDetail: { changedFiles: 1, citedChanged: ["src/client.ts"] },
  });
  assert.match(
    one,
    /At least 1 file changed since the analyzed version, including 1 file that this analysis cites: src\/client\.ts\./,
  );

  const capped = renderEnglish({
    stale: true,
    staleDetail: {
      changedFiles: 1_250,
      citedChanged: Array.from({ length: 12 }, (_, index) => `f${index}.ts`),
    },
  });
  assert.match(capped, /At least 1,250 files changed .*, including 12 or more files that this analysis cites: f0\.ts, f1\.ts/);
});
