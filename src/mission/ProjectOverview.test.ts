import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { formatters } from "../../shared/i18n/locale";
import type { ProjectInsights } from "../../shared/insights";
import type { AgentTeam } from "../../shared/team";
import { freeEntitlements, proEntitlements } from "../../shared/plans";
import { getDemo } from "../demo";
import type { PlaybackClock } from "../demo/playback";
import { assertNoHan, renderEn, renderWith, renderZh } from "../test-utils/render";
import { MarkdownContent } from "../review/MarkdownContent";
import { briefMarkdown, ProjectOverview, type ProjectOverviewProps } from "./ProjectOverview";
import { playSampleAnalysis, stopSampleAnalysis } from "./sample-analysis";
import { mount } from "./test-dom";

const demoInsights = getDemo("zh-TW").insights;

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

const overviewProps = (
  overrides: Partial<ProjectOverviewProps> = {},
): ProjectOverviewProps => ({
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
});

const renderEnglish = (overrides: Partial<ProjectOverviewProps> = {}) =>
  renderEn(createElement(ProjectOverview, overviewProps(overrides)));

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
    assertNoHan(html);
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

/** The "Generate 5 more" button, as rendered. */
function moreButton(html: string) {
  const found = html.match(/<button[^>]*aria-describedby="mission-more-description"[^>]*>.*?<\/button>/)?.[0];
  assert.ok(found, "no Generate more button");
  return found;
}
const moreReason = (html: string) =>
  html.match(/<p id="mission-more-description">([^<]*)<\/p>/)?.[1];

test("Generate 5 more is locked on Free with its reason, and open on Pro", () => {
  for (const props of [{ entitlements: freeEntitlements }, { canRecommendMore: false }]) {
    const html = renderEnglish(props);
    assertNoHan(html);
    assert.match(moreButton(html), /disabled=""/);
    assert.match(moreButton(html), /Generate 5 more<span class="pro-badge"[^>]*>PRO<\/span><\/button>/);
    assert.equal(
      moreReason(html),
      "Generating more recommendations is part of Pro. Free keeps the 5 recommendations of each analysis, and the ones you already have stay.",
    );
    assert.match(html, /<button type="button" class="mission-text-button mission-upgrade-button">See what Pro adds/);
  }
  for (const props of [{ entitlements: proEntitlements(2) }, { canRecommendMore: true }, {}]) {
    const html = renderEnglish(props);
    assert.doesNotMatch(moreButton(html), /disabled|pro-badge/);
    assert.match(moreReason(html) ?? "", /^The Agent uses the model settings saved for this project/);
    assert.doesNotMatch(html, /See what Pro adds/);
  }
  // A stale analysis still says Pro first on Free.
  assert.match(moreReason(renderEnglish({ entitlements: freeEntitlements, stale: true })) ?? "", /part of Pro/);
  assert.match(
    render({ insights: analyzed, entitlements: freeEntitlements }),
    /產出更多建議是 Pro 功能。/,
  );
});

test("the sample offers its extra batch unlocked, with a PRO chip, once", () => {
  const sample = getDemo("en").insights;
  const html = renderEnglish({ insights: sample, entitlements: freeEntitlements });
  assertNoHan(html);
  assert.doesNotMatch(moreButton(html), /disabled/);
  assert.match(moreButton(html), /<span class="pro-badge"/);
  assert.match(moreReason(html) ?? "", /^In the sample this adds prewritten recommendations, without calling an AI\./);
  assert.doesNotMatch(html, /See what Pro adds/);

  const extras = getDemo("en").extraRecommendations ?? [];
  const expanded = renderEnglish({
    insights: {
      ...sample,
      recommendations: [...sample.recommendations, ...extras],
      recommendationExpansion: {
        generatedAt: sample.generatedAt,
        addedIds: extras.map((idea) => idea.id),
        requestedCount: 5,
      },
    },
    entitlements: freeEntitlements,
  });
  assertNoHan(expanded);
  assert.match(moreButton(expanded), /disabled=""/);
  assert.match(moreReason(expanded) ?? "", /^The sample&#x27;s extra recommendations are all shown\./);
  assert.match(expanded, /View this batch&#x27;s new recommendations \(5 of 5\)/);
  // Its provenance says it is a sample, not an unrecorded model call.
  assert.match(expanded, /mission-more-provenance/);
  assert.doesNotMatch(expanded, /did not record its model/);
  assert.match(expanded, /No measurements yet\. The sample did not call AI\./);
});

test("while the sample's analysis plays, the loading state lists its lines so far", async () => {
  // A clock that never fires: the playback stays on its first line.
  const timers: (() => void)[] = [];
  const clock: PlaybackClock = {
    now: () => 0,
    setTimeout: (callback) => timers.push(callback),
    clearTimeout() {},
  };
  const demo = getDemo("en");
  const steps = demo.analysisSteps ?? [];
  const played = playSampleAnalysis({ demo, clock });
  try {
    timers.shift()?.();
    const html = renderEnglish({ insights: null, loading: true });
    assertNoHan(html);
    assert.match(html, /Turning the code into a project overview\./);
    assert.ok(
      html.includes('role="progressbar" aria-label="Analysis progress" aria-valuemin="0" aria-valuemax="5" aria-valuenow="2"'),
    );
    assert.match(html, /style="width:33%"/);
    assert.ok(html.includes(`<li class="done">`));
    assert.ok(html.includes(`<span>${steps[0]}</span>`));
    const current = html.slice(html.indexOf('<li class="current">'));
    assert.ok(current.startsWith('<li class="current">') && current.includes(`<span>${steps[1]}</span></li>`));
    assert.ok(!html.includes(steps[2]));
    // Another repository, or a real analysis, shows no sample lines.
    assert.doesNotMatch(renderEnglish({ repo: { ...repo, id: "repo-1" }, insights: null, loading: true }), /mission-analysis-steps/);
    assert.doesNotMatch(renderEnglish({ insights: null, loading: false }), /mission-analysis-steps/);
    assert.match(
      renderWith("zh-TW", createElement(ProjectOverview, overviewProps({ insights: null, loading: true }))),
      /aria-label="分析進度"/,
    );
  } finally {
    stopSampleAnalysis();
    await played;
  }
});

/** The section ids in the order the page shows them. */
const sectionOrder = (html: string) =>
  [...html.matchAll(/<section id="(overview-[a-z]+)"/g)].map((match) => match[1]);
/** The section nav's links, as [anchor, label]. */
const navLinks = (html: string) =>
  [...(html.match(/<nav class="mission-section-nav"[^>]*>.*?<\/nav>/)?.[0] ?? "").matchAll(/<a href="#([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(
    (match) => [match[1], match[2]],
  );

test("a sticky nav links to every section; a run's overview leads with its brief and keeps the directions last", () => {
  const html = renderEnglish({ run: englishRun });
  assertNoHan(html);
  assert.match(html, /<nav class="mission-section-nav" aria-label="On this page">/);
  assert.deepEqual(navLinks(html), [
    ["overview-contribution", "This contribution"],
    ["overview-purpose", "Purpose"],
    ["overview-journey", "How people use it"],
    ["overview-reading", "Where to start reading"],
    ["overview-directions", "Directions"],
  ]);
  assert.deepEqual(sectionOrder(html), [
    "overview-contribution",
    "overview-purpose",
    "overview-journey",
    "overview-reading",
    "overview-directions",
  ]);
  // Each target can take focus when a link moves there.
  assert.match(html, /<section id="overview-directions" tabindex="-1" class="mission-recommendations"/);
});

test("without a run the directions come right after the project card", () => {
  const html = renderEnglish({ onStartContribution() {} });
  assert.deepEqual(sectionOrder(html), [
    "overview-purpose",
    "overview-directions",
    "overview-journey",
    "overview-reading",
  ]);
  assert.deepEqual(
    navLinks(html).map(([anchor]) => anchor),
    ["overview-purpose", "overview-directions", "overview-journey", "overview-reading"],
  );
  // The details and the next step still follow the reading path.
  assert.ok(html.indexOf("mission-project-details") > html.indexOf('id="overview-reading"'));
  assert.ok(html.indexOf("mission-next-step") > html.indexOf("mission-project-details"));
  // Sections without content get no link.
  const short = renderEnglish({ insights: { ...englishInsights, userJourney: [], readingPath: undefined } });
  assert.deepEqual(navLinks(short).map(([anchor]) => anchor), ["overview-purpose", "overview-directions"]);
  // Before an analysis there is nothing to navigate.
  assert.doesNotMatch(renderEnglish({ insights: null }), /mission-section-nav/);
  assert.match(render(), /aria-label="本頁內容"/);
  assert.match(render(), />貢獻方向<\/a>/);
});

test("the reading path opens on its first two steps, with a button that shows the rest", () => {
  const readingPath = ["a.ts", "b.ts", "c.ts", "d.ts"].map((path) => ({
    path,
    why: `Why ${path}`,
    lookFor: `Look in ${path}`,
  }));
  const html = renderEnglish({ insights: { ...englishInsights, readingPath } });
  assertNoHan(html);
  const list = html.match(/<ol class="mission-reading-steps".*?<\/ol>/)?.[0] ?? "";
  const steps = [...list.matchAll(/<li( hidden="")?><span class="mission-journey-number">(\d+)<\/span>/g)]
    .map((match) => [match[2], !!match[1]]);
  assert.deepEqual(steps, [["01", false], ["02", false], ["03", true], ["04", true]]);
  // Hidden steps stay in the page, so "Show all" only reveals them.
  assert.ok(html.includes("Look in d.ts"));
  assert.match(
    html,
    /<button type="button" class="mission-text-button mission-reading-toggle" aria-expanded="false" aria-controls="mission-reading-steps">Show all 4 steps/,
  );
  assert.match(html, /<ol class="mission-reading-steps" id="mission-reading-steps">/);
  // Two steps or fewer need no button.
  assert.doesNotMatch(renderEnglish(), /mission-reading-toggle/);
  assert.match(render({ insights: { ...demoInsights, readingPath } }), />顯示全部 4 步/);
});

test("an AI analysis and its recommendations are labelled AI-generated; the sample is not", () => {
  const html = renderEnglish();
  assert.match(html, /<span class="mission-source"><svg[^>]*>.*?<\/svg>AI-generated analysis<\/span>/);
  assert.match(html, /<span class="mission-source"><svg[^>]*>.*?<\/svg>AI-generated<\/span><span class="mission-ideas-count">3 recommendations<\/span>/);
  const sample = renderEnglish({ insights: getDemo("en").insights });
  assert.doesNotMatch(sample, /AI-generated/);
  assert.match(sample, /Sample analysis/);
  assert.match(render({ insights: analyzed }), /AI 生成的專案分析/);
});

test("an analysis in another language than the UI offers to analyze again in the UI's", () => {
  const html = renderEnglish({ insights: { ...englishInsights, locale: "zh-TW" } });
  assertNoHan(html);
  assert.match(
    html,
    /<div class="mission-alert mission-alert-info" role="status"><svg[^>]*>.*?<\/svg><span>Analyzed in Traditional Chinese\.<\/span><button type="button">Re-analyze in English<svg/,
  );
  assert.match(
    renderEnglish({ insights: { ...englishInsights, locale: "zh-TW" }, loading: true }),
    /<button type="button" disabled="">Re-analyze in English/,
  );
  // The same language, an unknown one (older caches) and the sample need nothing.
  for (const insights of [
    { ...englishInsights, locale: "en" as const },
    englishInsights,
    { ...getDemo("en").insights, locale: "zh-TW" as const },
  ])
    assert.doesNotMatch(renderEnglish({ insights }), /Analyzed in|Re-analyze in/);
  const zh = render({ insights: { ...analyzed, locale: "en" } });
  assert.match(zh, /這份分析以英文撰寫。/);
  assert.match(zh, />改用繁體中文重新分析</);
});

test("the sample's overview reads no plan, also while its analysis plays", async () => {
  const realFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requests.push(String(input));
    return new Response(
      JSON.stringify({ license: { plan: "free", source: "none", status: "none" } }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  const loadingOverview = (id: string) =>
    createElement(ProjectOverview, overviewProps({ repo: { ...repo, id }, insights: null, loading: true }));
  const view = await mount(loadingOverview("demo-repo"));
  try {
    assert.deepEqual(requests, []);
    // A real repository's overview reads the plan for "Generate 5 more".
    await view.rerender(loadingOverview("repo-1"));
    assert.deepEqual(requests, ["/api/license"]);
  } finally {
    await view.unmount();
    globalThis.fetch = realFetch;
  }
});

test("the contribution brief shows the premise verdict and labels what still states the assumption", () => {
  const base = {
    id: "r",
    repoId: "demo-repo",
    title: "確認呼叫端使用回傳的 id",
    prompt: "假設（未驗證）：呼叫端把自己產生的 id 交給瀏覽器。",
    status: "review",
    branch: "fix/abc",
    baseBranch: "main",
    createdAt: "2026-10-14T00:00:00Z",
    agents: [],
    logs: [],
    draft: { title: "t", body: "b" },
    reviewedFiles: [],
  } as unknown as NonNullable<ProjectOverviewProps["run"]>;
  const team: AgentTeam = {
    config: { maxTeammates: 2, requirePlanApproval: false, provider: "claude", protocol: "bell-shared-tasks", messageDelivery: "between-turns" },
    phase: "complete",
    planSummary: "",
    tasks: [],
    messages: [],
  };
  const brief = {
    problem: base.prompt,
    motivation: "若此假設成立，候選人重新整理後就無法開始面試。",
    beneficiaries: [],
    before: "目前存在任務描述中的問題。",
    after: "若此假設成立，候選人重新整理後就無法開始面試。",
    validation: [],
    risks: [],
  };
  const refuted = render({
    run: {
      ...base,
      team: {
        ...team,
        premise: { verdict: "refuted", statement: "呼叫端交出自己產生的 id。", evidence: "src/web/interviews.rs:195 用的是回傳值。" },
      },
    },
    brief,
  });
  assert.match(refuted, /前提查核：假設不成立/);
  assert.match(refuted, /src\/web\/interviews\.rs:195/);
  // The request's wording is kept but labelled on both cards that copy it.
  assert.equal(refuted.match(/依你的假設，查證後不成立/g)?.length, 2);
  assert.match(refuted, /若此假設成立，候選人重新整理後就無法開始面試。/);
  assert.match(refuted, /上面依假設描述的問題與影響實際上不會發生/);
  // A check can be made again; the button appears only with the action.
  assert.doesNotMatch(refuted, /重新查核前提/);
  const recheck = render({
    run: { ...base, team: { ...team, premise: { verdict: "refuted", statement: "s", evidence: "e:1" } } },
    brief,
    onCheckPremise() {},
  });
  assert.match(recheck, /重新查核前提/);
  assert.doesNotMatch(recheck, /依審查結果查核前提/);

  // A run made before premise checks offers one; without the action, nothing is offered.
  const missing = render({ run: { ...base, team }, brief, onCheckPremise() {} });
  assert.match(missing, /這個貢獻建立時還沒有前提查核/);
  assert.match(missing, /依審查結果查核前提/);
  assert.doesNotMatch(missing, /依你的假設/);
  assert.doesNotMatch(render({ run: { ...base, team }, brief }), /依審查結果查核前提/);
});

test("the premise check in the brief reads in English", () => {
  const run = {
    id: "r",
    repoId: "demo-repo",
    title: "Use the returned id",
    prompt: "Assumption (unverified): the caller hands the browser an id it made itself.",
    status: "review",
    branch: "fix/abc",
    baseBranch: "main",
    createdAt: "2026-10-14T00:00:00Z",
    agents: [],
    logs: [],
    draft: { title: "t", body: "b" },
    reviewedFiles: [],
    team: {
      config: { maxTeammates: 2, requirePlanApproval: false, provider: "claude", protocol: "bell-shared-tasks", messageDelivery: "between-turns" },
      phase: "complete",
      planSummary: "",
      tasks: [],
      messages: [],
      premise: { verdict: "unclear", statement: "The caller hands over an id it made.", evidence: "src/web/interviews.rs:195 uses the returned value." },
    },
  } as unknown as NonNullable<ProjectOverviewProps["run"]>;
  const brief = {
    problem: run.prompt,
    motivation: "If this holds, a candidate who reloads cannot start the interview.",
    beneficiaries: [],
    before: "Today the problem in the request exists.",
    after: "If this holds, a candidate who reloads cannot start the interview.",
    validation: [],
    risks: [],
  };
  const html = renderEnglish({ run, brief, onCheckPremise() {} });
  assertNoHan(html);
  assert.match(html, /Premise check: the assumption could not be confirmed/);
  assert.equal(html.match(/As you assumed; not confirmed yet/g)?.length, 2);
  assert.match(html, /Check the premise again/);
  assert.match(html, /These are the goals of this contribution/);
});

test("an open contribution leads with its brief, which does not repeat the title, before the project analysis", () => {
  const run = {
    id: "r",
    repoId: "demo-repo",
    title: "確認呼叫端使用回傳的 id",
    prompt: "讓呼叫端使用回傳的 id。",
    status: "review",
    branch: "fix/abc",
    baseBranch: "main",
    createdAt: "2026-10-14T00:00:00Z",
    agents: [],
    logs: [],
    draft: { title: "t", body: "b" },
    reviewedFiles: [],
  } as unknown as NonNullable<ProjectOverviewProps["run"]>;
  const html = render({ run });
  const brief = html.indexOf("這次改動，會帶來什麼不同？");
  assert.ok(brief >= 0 && brief < html.indexOf("先看懂專案，再決定怎麼改。"));
  assert.ok(brief < html.indexOf('id="mission-purpose-title"'));
  // The header shows the title; the brief does not repeat it.
  assert.doesNotMatch(html, /mission-contribution-name|確認呼叫端使用回傳的 id/);
  // The product keeps the directions on a run's overview, after the analysis.
  assert.ok(html.indexOf("mission-ideas-title") > html.indexOf('id="mission-purpose-title"'));
  // While the analysis loads, or before there is one, the brief still leads.
  for (const props of [{ loading: true, insights: null }, { insights: null }]) {
    const pending = render({ run, ...props });
    assert.ok(pending.indexOf("這次改動，會帶來什麼不同？") < pending.indexOf("mission-overview-empty"));
  }
  // The project page has no brief.
  assert.doesNotMatch(render(), /這次改動，會帶來什麼不同？/);
});

test("a request written in labelled sections renders as Markdown with its labels in bold", () => {
  const request = [
    "問題：觀察：create_interview 會回傳既有列的 id。",
    "使用者影響：若此假設成立，候選人重新整理後就無法開始面試。",
    "建議做法：1) 用 `grep -rn 'create_interview(' src/` 找出呼叫端。",
    "驗收：",
    "- `./scripts/test.sh` 通過",
    "原始碼依據（引文已核對；推論仍待確認）：",
    "- src/accounts/interviews.rs：「The caller supplies the id」",
  ].join("\n");
  const marked = briefMarkdown(request);
  for (const label of ["問題", "使用者影響", "建議做法", "驗收"])
    assert.ok(marked.includes(`**${label}**：`), label);
  // A parenthetical stays outside the bold; list items, sentences and later colons are untouched.
  assert.ok(marked.includes("**原始碼依據**（引文已核對；推論仍待確認）："));
  assert.ok(marked.includes("觀察：create_interview"));
  assert.ok(marked.includes("- src/accounts/interviews.rs：「"));
  assert.equal(briefMarkdown("若此假設成立，候選人：無法開始"), "若此假設成立，候選人：無法開始");
  // An ordered list stays a list.
  assert.equal(briefMarkdown("1) 步驟：先讀"), "1) 步驟：先讀");

  const html = renderZh(createElement(MarkdownContent, { children: marked }));
  // Each section is its own paragraph, so the one after a list is not absorbed into it.
  assert.match(html, /<p><strong>問題<\/strong>：觀察：create_interview 會回傳既有列的 id。<\/p>/);
  assert.match(html, /<p><strong>使用者影響<\/strong>：/);
  assert.match(html, /<code>grep -rn &#x27;create_interview\(&#x27; src\/<\/code>/);
  assert.match(html, /<p><strong>驗收<\/strong>：<\/p>\s*<ul>\s*<li><code>\.\/scripts\/test\.sh<\/code> 通過<\/li>\s*<\/ul>/);
  assert.match(html, /<p><strong>原始碼依據<\/strong>（引文已核對；推論仍待確認）：<\/p>\s*<ul>/);
});

test("an English request's section labels are bolded the same way, and sentences are not", () => {
  const request = [
    "Problem: GET requests fail on the first brief outage.",
    "User impact: Retries would spare people a reload.",
    "Acceptance:",
    "- `npm test` passes",
    "Source evidence (each quote was checked; inferences are unconfirmed):",
    "- src/client.ts: “fetch(url)” — one attempt",
  ].join("\n");
  const marked = briefMarkdown(request);
  for (const label of ["Problem", "User impact", "Acceptance"]) assert.ok(marked.includes(`**${label}**:`), label);
  assert.ok(marked.includes("**Source evidence** (each quote was checked; inferences are unconfirmed):"));
  assert.ok(marked.includes("- src/client.ts: “fetch(url)”"));
  // A sentence with a comma, a lowercase start or a URL is not a label.
  for (const line of ["If this holds, the caller: fails", "note: lowercase", "https://example.com/a: b", "1) Step: read"])
    assert.equal(briefMarkdown(line), line);
  const html = renderEn(createElement(MarkdownContent, { children: marked }));
  assert.match(html, /<p><strong>Acceptance<\/strong>:<\/p>\s*<ul>\s*<li><code>npm test<\/code> passes<\/li>/);
});

test("a request's generics, tags, dunder names and paths show as written, while its code stays code", () => {
  const request = [
    "Problem: Make get() return Promise<Response> instead of Promise<any>, and fix the import in src/__init__.py.",
    "The <Dialog> component closes on Escape; make <Select> do the same for Result<Vec<u8>, Error> & Array<string>.",
    "Keep snake_case_names and C:\\Users\\me\\new_dir; see https://example.com/a_b/c_d.",
    "Run `make <target> __all__` first.",
    "```",
    "Problem: <b>kept</b> __as__ written",
    "```",
  ].join("\n");
  const html = renderEn(createElement(MarkdownContent, { children: briefMarkdown(request) }));
  const text = html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  for (const written of [
    "Make get() return Promise<Response> instead of Promise<any>, and fix the import in src/__init__.py.",
    "The <Dialog> component closes on Escape; make <Select> do the same for Result<Vec<u8>, Error> & Array<string>.",
    "Keep snake_case_names and C:\\Users\\me\\new_dir; see https://example.com/a_b/c_d.",
  ])
    assert.ok(text.includes(written), written);
  // Nothing became emphasis, and the label is still bold.
  assert.doesNotMatch(html, /<em>|<strong>init/);
  assert.match(html, /<p><strong>Problem<\/strong>: Make get\(\)/);
  assert.match(html, /<a href="https:\/\/example\.com\/a_b\/c_d"/);
  // Code spans and fenced blocks are code, exactly as written.
  assert.match(html, /<code>make &lt;target&gt; __all__<\/code>/);
  assert.match(html, /<pre><code>Problem: &lt;b&gt;kept&lt;\/b&gt; __as__ written\n<\/code><\/pre>/);
});

test("the brief's request and direction text render through the Markdown view, and a long request spans the width", async () => {
  const run = { ...englishRun, prompt: "Problem: one attempt." } as NonNullable<ProjectOverviewProps["run"]>;
  const brief = {
    problem: "Problem: x\n".repeat(30),
    motivation: "Fewer reloads.",
    beneficiaries: [],
    before: "One attempt.",
    after: "Three attempts.",
    validation: ["`npm test` passes"],
    risks: [],
  };
  // The Markdown view loads with its first use; until then the text shows as before.
  renderEnglish({ run, brief });
  await import("../review/MarkdownContent");
  await new Promise((resolve) => setImmediate(resolve));
  const html = renderEnglish({ run, brief });
  assert.match(html, /class="mission-contribution-reason is-stacked"/);
  assert.match(
    html,
    /<li><div class="mission-brief-text"><div class="markdown-content"><p><code>npm test<\/code> passes<\/p><\/div><\/div><\/li>/,
  );
  assert.match(html, /<span>The problem to solve<\/span><div class="mission-brief-text"><div class="markdown-content"><p><strong>Problem<\/strong>: x<\/p>/);
  assert.doesNotMatch(renderEnglish({ run, brief: { ...brief, problem: "Short." } }), /is-stacked/);
  assert.match(renderEnglish({ run, brief: undefined }), /<div class="mission-brief-pending">.*<p><strong>Problem<\/strong>: one attempt\.<\/p>/s);
});
