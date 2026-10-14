import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProjectInsights } from "../../shared/insights";
import type { AgentTeam } from "../../shared/team";
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
