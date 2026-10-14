import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { createElement } from "react";
import type { Locale } from "../../shared/i18n/locale";
import {
  maxProjectRecommendations,
  type ProjectInsights,
} from "../../shared/insights";
import { getDemo } from "../demo";
import { playbackTiming, type PlaybackClock } from "../demo/playback";
import { setLocale } from "../i18n";
import { assertNoHan, renderWith } from "../test-utils/render";
import {
  ProjectInsightsCache,
  shownInsights,
  useProjectInsights,
} from "./useProjectInsights";
import { sampleAnalysisState } from "./sample-analysis";

afterEach(async () => {
  await setLocale("en");
});

test("a refresh after the clone is updated reads again instead of joining an analysis in flight", async () => {
  const calls: string[] = [];
  let finishAnalysis = () => {};
  const cache = new ProjectInsightsCache(async (_repoId, operation) => {
    calls.push(operation);
    if (operation === "analyze")
      await new Promise<void>((resolve) => (finishAnalysis = resolve));
    return { insights: null, stale: operation === "load" };
  });
  const analysis = cache.analyze("repo");
  await new Promise((resolve) => setTimeout(resolve, 0));
  const refresh = cache.refresh("repo");
  finishAnalysis();
  await Promise.all([analysis, refresh]);
  assert.deepEqual(calls, ["analyze", "load"]);
  assert.equal(cache.snapshot("repo").stale, true);
});

const analysis = (recommendations: number): ProjectInsights => ({
  ...getDemo("en").insights,
  source: "ai",
  recommendations: Array.from({ length: recommendations }, (_, index) => ({
    ...getDemo("en").insights.recommendations[0],
    id: `idea-${index}`,
  })),
});

/** Every message the cache writes for requests it refuses or that fail without a reason. */
async function cacheMessages() {
  const cache = new ProjectInsightsCache(
    async (repoId, operation) => {
      // Failures that carry no Error, so the cache words them itself.
      if (repoId === "broken") throw "offline";
      if (operation !== "load") throw undefined;
      return {
        insights: analysis(repoId === "full" ? maxProjectRecommendations : 1),
        stale: repoId === "stale",
      };
    },
    async (repoId) => {
      if (repoId === "rejected") throw new Error("connection lost");
      throw null;
    },
  );
  await cache.load("broken");
  await cache.analyze("demo-repo");
  // The first click adds the sample's prewritten batch; the second has nothing left.
  await cache.recommendMore("demo-repo");
  await cache.recommendMore("demo-repo");
  await cache.recommendMore("missing");
  for (const id of ["stale", "full", "fails", "rejected", "silent"])
    await cache.load(id);
  await cache.recommendMore("stale");
  await cache.recommendMore("full");
  await cache.recommendMore("fails");
  // Starting an analysis clears the recommendation error, so read it first.
  const moreFailed = cache.snapshot("fails").recommendationError;
  await cache.analyze("fails");
  const preferences = { order: [], hidden: ["idea-0"] };
  await cache.savePreferences("rejected", preferences);
  await cache.savePreferences("silent", preferences);
  return {
    load: cache.snapshot("broken").error,
    demoAnalysis: cache.snapshot("demo-repo").error,
    demoMore: cache.snapshot("demo-repo").recommendationError,
    missing: cache.snapshot("missing").recommendationError,
    stale: cache.snapshot("stale").recommendationError,
    full: cache.snapshot("full").recommendationError,
    moreFailed,
    analysisFailed: cache.snapshot("fails").error,
    rejected: cache.snapshot("rejected").preferenceError,
    silent: cache.snapshot("silent").preferenceError,
  };
}

test("the cache words its own messages in the UI language", async () => {
  const en = await cacheMessages();
  assert.deepEqual(en, {
    load: "Could not load the project analysis. Try again.",
    demoAnalysis:
      "The sample project uses a prewritten analysis. Import your repository to have AI read real source code.",
    demoMore: "Import a real project to generate more contribution recommendations.",
    missing: "Re-analyze the project before you generate more recommendations.",
    stale: "Re-analyze the project before you generate more recommendations.",
    full: `This analysis already has ${maxProjectRecommendations} recommendations.`,
    moreFailed:
      "No more recommendations were generated; the existing list is kept. Try again.",
    analysisFailed: "The project analysis did not finish. Try again.",
    rejected:
      "The order and visibility were not saved and have been restored: connection lost",
    silent: "The order and visibility were not saved and have been restored. Try again.",
  });
  assertNoHan(JSON.stringify(en));

  await setLocale("zh-TW");
  assert.deepEqual(await cacheMessages(), {
    load: "無法讀取專案分析，請重試。",
    demoAnalysis:
      "示範專案使用預寫分析。匯入你的 repository 後，即可請 AI 閱讀真實原始碼。",
    demoMore: "匯入真實專案後，即可產出更多貢獻建議。",
    missing: "請先重新分析專案，再產出更多建議。",
    stale: "請先重新分析專案，再產出更多建議。",
    full: `這份分析已累積 ${maxProjectRecommendations} 個建議。`,
    moreFailed: "尚未產出更多建議，原有清單已保留。請重試。",
    analysisFailed: "專案分析未完成，請重試。",
    rejected: "未儲存顯示與排序設定，已還原：connection lost",
    silent: "未儲存顯示與排序設定，已還原。請再試一次。",
  });
});

function DemoAnalysis({ locale }: { locale: Locale }) {
  const { insights } = useProjectInsights("demo-repo");
  return createElement(
    "output",
    null,
    String(insights === getDemo(locale).insights),
  );
}

test("the sample project's prewritten analysis follows the UI language", () => {
  for (const locale of ["en", "zh-TW"] as const)
    assert.equal(
      renderWith(locale, createElement(DemoAnalysis, { locale })),
      "<output>true</output>",
    );
});

test("Generate 5 more adds the sample's prewritten batch once, without a request", async () => {
  const requests: string[] = [];
  const cache = new ProjectInsightsCache(async (repoId, operation) => {
    requests.push(`${repoId}:${operation}`);
    return { insights: null, stale: false };
  });
  const demo = getDemo("en");
  const extras = (demo.extraRecommendations ?? []).map((idea) => idea.id);
  assert.equal(extras.length, 5);
  await cache.recommendMore("demo-repo");
  const expanded = cache.snapshot("demo-repo");
  assert.equal(expanded.recommendationError, "");
  assert.deepEqual(
    expanded.insights?.recommendations.map((idea) => idea.id),
    [...demo.insights.recommendations.map((idea) => idea.id), ...extras],
  );
  assert.deepEqual(expanded.insights?.recommendationExpansion, {
    generatedAt: demo.insights.generatedAt,
    addedIds: extras,
    requestedCount: 5,
  });
  assert.equal(expanded.insights?.source, "demo");
  // A second click changes nothing and says why.
  await cache.recommendMore("demo-repo");
  assert.equal(cache.snapshot("demo-repo").insights, expanded.insights);
  assert.equal(
    cache.snapshot("demo-repo").recommendationError,
    "Import a real project to generate more contribution recommendations.",
  );
  assert.deepEqual(requests, []);
});

test("the sample's extra batch follows the UI language too", async () => {
  await setLocale("zh-TW");
  const cache = new ProjectInsightsCache();
  await cache.recommendMore("demo-repo");
  const written = cache.snapshot("demo-repo").insights;
  const zh = getDemo("zh-TW");
  assert.equal(written?.recommendations.at(-1)?.title, zh.extraRecommendations?.at(-1)?.title);
  // An English reader sees the English sample with the same batch added.
  const en = getDemo("en");
  const shown = shownInsights(written, "en");
  assertNoHan(JSON.stringify(shown));
  assert.deepEqual(
    shown?.recommendations.map((idea) => idea.title),
    [...en.insights.recommendations, ...(en.extraRecommendations ?? [])].map((idea) => idea.title),
  );
  assert.equal(shownInsights(shown, "en"), shown);
  assert.equal(shownInsights(written, "zh-TW"), written);
  // An AI analysis keeps its language.
  const analysis = { ...en.insights, source: "ai" as const };
  assert.equal(shownInsights(analysis, "zh-TW"), analysis);
  assert.equal(shownInsights(null, "en"), null);
});

/** A clock whose time only moves when the test says so. */
function fakeClock() {
  let now = 0;
  let sequence = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const clock: PlaybackClock = {
    now: () => now,
    setTimeout(callback, ms) {
      timers.set(++sequence, { at: now + ms, callback });
      return sequence;
    },
    clearTimeout(handle) {
      timers.delete(handle as number);
    },
  };
  /** Fires the timers that fall due within `ms`, in time order. */
  const advance = (ms = Infinity) => {
    const end = now + ms;
    for (;;) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      timers.delete(next[0]);
      now = next[1].at;
      next[1].callback();
    }
    if (Number.isFinite(end)) now = end;
  };
  return { clock, advance, pending: () => timers.size };
}

/** A cache whose server requests are recorded and must not happen. */
function playbackCache(time: ReturnType<typeof fakeClock>) {
  const requests: string[] = [];
  const cache = new ProjectInsightsCache(
    async (repoId, operation) => {
      requests.push(`${repoId}:${operation}`);
      return { insights: null, stale: false };
    },
    async (repoId) => {
      requests.push(`${repoId}:preferences`);
      return { recommendationPreferences: { order: [], hidden: [] } };
    },
    { playSample: true, clock: time.clock },
  );
  return { cache, requests };
}

test("in playback mode the sample's analysis plays its loading lines, then shows, without a request", async () => {
  const time = fakeClock();
  const { cache, requests } = playbackCache(time);
  const demo = getDemo("en");
  const steps = demo.analysisSteps ?? [];
  assert.equal(steps.length, 5);
  // It starts out loading, so the analysis never shows before it plays.
  assert.equal(cache.snapshot("demo-repo").insights, null);
  assert.equal(cache.snapshot("demo-repo").loading, true);

  const played = cache.playSample("en", 4);
  assert.deepEqual(sampleAnalysisState(), { playing: true, steps: steps.slice(0, 1), total: 5 });
  time.advance(playbackTiming.analysisStep / 4);
  assert.deepEqual(sampleAnalysisState().steps, steps.slice(0, 2));
  assert.equal(cache.snapshot("demo-repo").insights, null);
  // Starting again while it plays joins it.
  assert.equal(cache.playSample("en", 4), played);
  time.advance();
  await played;
  assert.equal(cache.snapshot("demo-repo").insights, demo.insights);
  assert.equal(cache.snapshot("demo-repo").loading, false);
  assert.deepEqual(sampleAnalysisState(), { playing: false, steps, total: 5 });

  // It plays once: a later start or load keeps the analysis.
  await cache.playSample("en", 4);
  await cache.load("demo-repo");
  assert.equal(cache.snapshot("demo-repo").insights, demo.insights);
  assert.equal(time.pending(), 0);

  // Re-analyze in playback mode plays it again, in the language asked for.
  const again = cache.playSample("zh-TW", 4, true);
  assert.equal(cache.snapshot("demo-repo").insights, null);
  assert.deepEqual(sampleAnalysisState().steps, getDemo("zh-TW").analysisSteps?.slice(0, 1));
  time.advance();
  await again;
  assert.equal(cache.snapshot("demo-repo").insights, getDemo("zh-TW").insights);
  assert.deepEqual(requests, []);
});

test("a sample analysis stopped while it plays shows on the next load", async () => {
  const time = fakeClock();
  const { cache, requests } = playbackCache(time);
  const played = cache.playSample("en", 1);
  cache.dispose();
  assert.equal(time.pending(), 0);
  await played;
  assert.equal(sampleAnalysisState().playing, false);
  assert.equal(cache.snapshot("demo-repo").insights, null);
  await cache.load("demo-repo");
  assert.equal(cache.snapshot("demo-repo").insights, getDemo("en").insights);
  assert.equal(cache.snapshot("demo-repo").loading, false);
  // Outside playback mode the sample shows at once, as before.
  assert.equal(new ProjectInsightsCache().snapshot("demo-repo").insights, getDemo("en").insights);
  assert.deepEqual(requests, []);
});

