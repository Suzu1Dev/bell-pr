import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { splitConceptHeading } from "../../shared/explanations";
import { demoFiles, demoRun } from "../demo";
import type { Repo, Run } from "../types";
import { collectLearningNotes, LearningNotes } from "./LearningNotes";

const repos: Repo[] = [
  {
    id: "repo-1",
    name: "open-fetch",
    owner: "openfetch-sample",
    fullName: "openfetch-sample/open-fetch",
    path: "/tmp/open-fetch",
    defaultBranch: "main",
    url: "https://github.com/openfetch-sample/open-fetch",
  },
];

const explanation = (concept: string, tip = "先補一個失敗路徑的測試。") => ({
  summary: "摘要",
  reason: "原因",
  concept,
  tip,
});

function run(id: string, title: string, explanations: Run["explanations"]): Run {
  return {
    ...demoRun,
    id,
    title,
    repoId: "repo-1",
    explanations,
  };
}

const runs: Run[] = [
  run("run-old", "加入重試機制", {
    "src/retry.ts": {
      fingerprint: "a",
      status: "ready",
      generatedAt: "2026-10-01T08:00:00.000Z",
      content: explanation("指數退避\n每次失敗後等待時間加倍，讓忙碌的服務有機會恢復。"),
    },
    "src/pending.ts": { fingerprint: "b", status: "generating" },
    "src/broken.ts": { fingerprint: "c", status: "failed", error: "逾時" },
  }),
  run("run-new", "修正 token 快取", {
    "src/cache.ts": {
      fingerprint: "d",
      status: "ready",
      generatedAt: "2026-10-05T08:00:00.000Z",
      content: explanation("快取失效\n寫入成功後再清除舊快取，避免讀到過期資料。", "檢查並發寫入。"),
    },
  }),
];

const render = (
  props: Partial<Parameters<typeof LearningNotes>[0]> = {},
) =>
  renderToStaticMarkup(
    createElement(LearningNotes, {
      runs,
      repos,
      demoFiles,
      onOpen() {},
      ...props,
    }),
  );

test("splitConceptHeading separates the title line from the body", () => {
  assert.deepEqual(splitConceptHeading("指數退避\n第一句。\n第二句。"), {
    heading: "指數退避",
    body: "第一句。\n第二句。",
  });
  assert.deepEqual(splitConceptHeading("只有一段內文，沒有標題。"), {
    heading: "",
    body: "只有一段內文，沒有標題。",
  });
});

test("collectLearningNotes keeps only ready explanations, newest first", () => {
  const notes = collectLearningNotes(runs, repos);
  assert.deepEqual(
    notes.map((note) => note.path),
    ["src/cache.ts", "src/retry.ts"],
  );
  assert.equal(notes[0].repoName, "openfetch-sample/open-fetch");
  assert.equal(notes[1].runTitle, "加入重試機制");
});

test("real notes render concept, tip, task, repo, path and a demo section", () => {
  const html = render();
  assert.match(html, /2 \/ 2 則筆記/);
  assert.match(html, /<h2>指數退避<\/h2>/);
  assert.match(html, /每次失敗後等待時間加倍/);
  assert.match(html, /先補一個失敗路徑的測試。/);
  assert.match(html, /<code>src\/retry\.ts<\/code>/);
  assert.match(html, /openfetch-sample\/open-fetch/);
  assert.match(html, /<dd>修正 token 快取<\/dd>/);
  assert.doesNotMatch(html, /src\/pending\.ts/);
  assert.doesNotMatch(html, /src\/broken\.ts/);
  assert.match(html, /示範筆記/);
  assert.match(html, /class="learning-demo-label">示範</);
  assert.match(html, /指數退避（Exponential backoff）/);
  assert.match(html, /<option value="run-new">修正 token 快取<\/option>/);
  assert.ok(
    html.indexOf("快取失效") < html.indexOf("<h2>指數退避</h2>"),
    "newest note comes first",
  );
});

test("keyword filter narrows real and demo notes", () => {
  const html = render({ defaultKeyword: "快取" });
  assert.match(html, /1 \/ 2 則筆記/);
  assert.match(html, /快取失效/);
  assert.doesNotMatch(html, /<h2>指數退避<\/h2>/);
  assert.doesNotMatch(html, /示範筆記/);
});

test("run filter shows one task and hides the demo section", () => {
  const html = render({ defaultRunId: "run-old" });
  assert.match(html, /1 \/ 2 則筆記/);
  assert.match(html, /<h2>指數退避<\/h2>/);
  assert.doesNotMatch(html, /快取失效/);
  assert.doesNotMatch(html, /示範筆記/);
});

test("without real explanations the page guides the user to import a project", () => {
  const html = render({ runs: [run("empty", "尚未審查", undefined)] });
  assert.match(html, /還沒有屬於你的學習筆記/);
  assert.match(html, /匯入 repository/);
  assert.match(html, /尚無真實任務的筆記/);
  assert.match(html, /示範筆記/);
});
