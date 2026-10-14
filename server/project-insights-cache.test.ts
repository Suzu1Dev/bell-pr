import assert from "node:assert/strict";
import test, { before } from "node:test";
import {
  maxProjectRecommendations,
  type ProjectInsights,
} from "../shared/insights.js";
import { setLocale } from "../src/i18n/index.js";
import { ProjectInsightsCache } from "../src/mission/useProjectInsights.js";

// The cache words its messages in the active client locale; these
// assertions check the zh-TW wording.
before(() => setLocale("zh-TW"));

function insights(name: string): ProjectInsights {
  return {
    summary: name,
    purpose: "專案用途",
    audience: ["使用者"],
    userJourney: ["閱讀文件"],
    modules: [],
    evidence: [],
    recommendations: [{
      id: `${name}-original`,
      title: "補充入門說明",
      direction: "docs",
      problem: "文件沒有操作範例",
      userImpact: "幫助初次使用者完成設定",
      approach: "補上設定範例",
      acceptance: ["確認範例可以執行"],
      effort: "small",
      confidence: "medium",
      evidence: ["README.md"],
    }],
    generatedAt: "2026-10-07T00:00:00.000Z",
    source: "ai",
    baseSha: "a".repeat(40),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

test("追加建議保留原分析，重複點擊與切換專案共用進行中的請求", async () => {
  const original = insights("first");
  const second = insights("second");
  const result = deferred<{ insights: ProjectInsights; stale: boolean }>();
  const calls: string[] = [];
  const cache = new ProjectInsightsCache(async (repoId, action) => {
    calls.push(`${repoId}:${action}`);
    if (action === "recommend") return result.promise;
    return { insights: repoId === "first" ? original : second, stale: false };
  });
  await cache.load("first");
  const pending = cache.recommendMore("first");
  assert.equal(cache.recommendMore("first"), pending);
  assert.equal(cache.load("first"), pending);
  assert.equal(cache.analyze("first"), pending);
  assert.equal(cache.snapshot("first").insights, original);
  assert.equal(cache.snapshot("first").loading, false);
  assert.equal(cache.snapshot("first").recommending, true);
  await cache.load("second");
  assert.equal(cache.snapshot("second").insights, second);
  assert.equal(cache.snapshot("second").recommending, false);
  const expanded: ProjectInsights = {
    ...original,
    recommendations: [
      ...original.recommendations,
      { ...original.recommendations[0], id: "new", title: "改善錯誤提示" },
    ],
    recommendationExpansion: {
      generatedAt: "2026-10-07T01:00:00.000Z",
      addedIds: ["new"],
    },
  };
  result.resolve({ insights: expanded, stale: false });
  await pending;
  assert.equal(cache.snapshot("first").insights, expanded);
  assert.equal(cache.snapshot("first").recommending, false);
  assert.equal(cache.snapshot("second").insights, second);
  assert.deepEqual(calls, ["first:load", "first:recommend", "second:load"]);
  await cache.analyze("first");
  assert.equal(cache.snapshot("first").insights, original);
  assert.equal(cache.snapshot("first").loading, false);
});

test("較晚回傳的舊分析 GET 不會覆蓋新追加的結果", async () => {
  const original = insights("first");
  const outdated = deferred<{ insights: ProjectInsights; stale: boolean }>();
  const updated = { ...original, recommendations: [] };
  let reads = 0;
  const cache = new ProjectInsightsCache(async (_repoId, action) => {
    if (action === "load" && ++reads > 1) return outdated.promise;
    return { insights: action === "recommend" ? updated : original, stale: false };
  });
  await cache.load("first");
  const read = cache.load("first");
  await cache.recommendMore("first");
  outdated.resolve({ insights: original, stale: true });
  await read;
  assert.equal(cache.snapshot("first").insights, updated);
  assert.equal(cache.snapshot("first").stale, false);
});

test("追加失敗的錯誤留在建議區，重試與無新增都保留舊建議", async () => {
  const original = insights("first");
  let attempts = 0;
  const unchanged: ProjectInsights = {
    ...original,
    recommendationExpansion: {
      generatedAt: "2026-10-07T01:00:00.000Z",
      addedIds: [],
    },
  };
  const cache = new ProjectInsightsCache(async (_repoId, action) => {
    if (action === "recommend" && ++attempts === 1) throw new Error("請稍後重試");
    return { insights: action === "recommend" ? unchanged : original, stale: false };
  });
  await cache.load("first");
  await cache.recommendMore("first");
  assert.equal(cache.snapshot("first").insights, original);
  assert.equal(cache.snapshot("first").error, "");
  assert.equal(cache.snapshot("first").recommendationError, "請稍後重試");
  assert.equal(cache.snapshot("first").recommending, false);
  const retry = cache.recommendMore("first");
  assert.equal(cache.snapshot("first").recommendationError, "");
  await retry;
  assert.equal(cache.snapshot("first").insights?.recommendations, original.recommendations);
  assert.deepEqual(cache.snapshot("first").insights?.recommendationExpansion?.addedIds, []);
  assert.equal(attempts, 2);
});

test("示範、未分析、過期與達上限的專案不發出追加請求", async () => {
  const original = insights("first");
  const maximum = {
    ...original,
    recommendations: Array.from({ length: maxProjectRecommendations }, (_, index) => ({
      ...original.recommendations[0],
      id: `idea-${index}`,
    })),
  };
  const actions: string[] = [];
  const cache = new ProjectInsightsCache(async (repoId, action) => {
    actions.push(action);
    return { insights: repoId === "maximum" ? maximum : original, stale: repoId === "stale" };
  });
  await cache.recommendMore("demo-repo");
  await cache.recommendMore("missing");
  await cache.load("stale");
  await cache.recommendMore("stale");
  await cache.load("maximum");
  await cache.recommendMore("maximum");
  assert.deepEqual(actions, ["load", "load"]);
  for (const id of ["demo-repo", "missing", "stale", "maximum"]) {
    assert.ok(cache.snapshot(id).recommendationError);
    assert.equal(cache.snapshot(id).recommending, false);
  }
});

test("顯示與排序立即更新，儲存期間只送一次，切換專案不混用設定", async () => {
  const preferences = { order: ["first-original"], hidden: ["first-original"] };
  const result = deferred<{ recommendationPreferences: typeof preferences }>();
  const calls: string[] = [];
  const cache = new ProjectInsightsCache(
    async (repoId) => ({ insights: insights(repoId), stale: false }),
    async (repoId, value) => {
      calls.push(repoId);
      assert.deepEqual(value, preferences);
      return result.promise;
    },
  );
  await cache.load("first");
  const pending = cache.savePreferences("first", preferences);
  assert.deepEqual(cache.snapshot("first").recommendationPreferences, preferences);
  assert.equal(cache.snapshot("first").savingPreferences, true);
  assert.equal(cache.savePreferences("first", preferences), pending);
  assert.equal(cache.load("first"), pending);
  await cache.load("second");
  assert.deepEqual(cache.snapshot("second").recommendationPreferences, { order: [], hidden: [] });
  result.resolve({ recommendationPreferences: preferences });
  await pending;
  assert.deepEqual(calls, ["first"]);
  assert.equal(cache.snapshot("first").savingPreferences, false);
  assert.deepEqual(cache.snapshot("first").recommendationPreferences, preferences);
});

test("設定儲存失敗會還原，較晚回傳的舊 GET 不能蓋掉新設定", async () => {
  const original = insights("first");
  const oldRead = deferred<{ insights: ProjectInsights; stale: boolean }>();
  const preferences = { order: ["first-original"], hidden: ["first-original"] };
  let reads = 0;
  let saves = 0;
  const cache = new ProjectInsightsCache(
    async () => ++reads > 1 ? oldRead.promise : { insights: original, stale: false },
    async (_id, value) => {
      if (++saves === 1) throw new Error("連線中斷");
      return { recommendationPreferences: value };
    },
  );
  await cache.load("first");
  await cache.savePreferences("first", preferences);
  assert.deepEqual(cache.snapshot("first").recommendationPreferences, { order: [], hidden: [] });
  assert.match(cache.snapshot("first").preferenceError, /已還原.*連線中斷/);
  const read = cache.load("first");
  await cache.savePreferences("first", preferences);
  oldRead.resolve({ insights: original, stale: true });
  await read;
  assert.deepEqual(cache.snapshot("first").recommendationPreferences, preferences);
  assert.equal(cache.snapshot("first").preferenceError, "");
  assert.equal(cache.snapshot("first").stale, false);
});

test("追加結果保留伺服器設定，示範卡片調整不呼叫儲存 API", async () => {
  const preferences = { order: ["first-original"], hidden: ["first-original"] };
  const cache = new ProjectInsightsCache(
    async () => ({ insights: insights("first"), stale: false, recommendationPreferences: preferences }),
    async () => { throw new Error("示範專案不應呼叫 API"); },
  );
  await cache.load("first");
  await cache.recommendMore("first");
  assert.deepEqual(cache.snapshot("first").recommendationPreferences, preferences);
  const demoId = cache.snapshot("demo-repo").insights!.recommendations[0].id;
  await cache.savePreferences("demo-repo", { order: [demoId], hidden: [demoId] });
  assert.deepEqual(cache.snapshot("demo-repo").recommendationPreferences.hidden, [demoId]);
  assert.equal(cache.snapshot("demo-repo").preferenceError, "");
});
