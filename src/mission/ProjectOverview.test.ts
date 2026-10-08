import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProjectInsights } from "../../shared/insights";
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
  renderToStaticMarkup(
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
