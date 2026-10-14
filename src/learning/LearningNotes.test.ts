import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { splitConceptHeading } from "../../shared/explanations";
import { demoFiles, demoRun, getDemo } from "../demo";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import type { DiffFile, Repo, Run } from "../types";
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

type Props = Parameters<typeof LearningNotes>[0];

const render = (props: Partial<Props> = {}) =>
  renderZh(
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

const englishRuns: Run[] = [
  run("run-old", "Add retries with backoff", {
    "src/retry.ts": {
      fingerprint: "a",
      status: "ready",
      generatedAt: "2026-10-01T08:00:00.000Z",
      content: {
        summary: "Summary",
        reason: "Reason",
        concept:
          "Exponential backoff\nEach failure doubles the wait, so a busy service can recover.",
        tip: "Add a test for the failure path first.",
      },
    },
  }),
  run("run-new", "Fix the token cache", {
    "src/cache.ts": {
      fingerprint: "d",
      status: "ready",
      content: {
        summary: "Summary",
        reason: "Reason",
        concept:
          "Cache invalidation\nClear the old entry only after the write succeeds.",
        tip: "Check concurrent writes.",
      },
    },
  }),
];

/** Renders in English and checks that no zh-TW text is left. */
const renderEnglish = (props: Partial<Props> = {}) => {
  const html = renderEn(
    createElement(LearningNotes, {
      runs: englishRuns,
      repos,
      demoFiles: [],
      onOpen() {},
      ...props,
    }),
  );
  assertNoHan(html);
  return html;
};

test("English notes render the page, the filters and each note in English", () => {
  const html = renderEnglish();
  assert.match(html, /<span class="eyebrow">LEARN BY CONTRIBUTING<\/span>/);
  assert.match(html, /Turn the code you understood into experience\./);
  assert.match(html, /placeholder="Search concepts, tips, files or contributions"/);
  assert.match(html, /<option value=""[^>]*>All contributions<\/option>/);
  assert.match(html, /<option value="run-new">Fix the token cache<\/option>/);
  assert.match(html, /Showing 2 of 2 notes/);
  assert.match(html, /<h2>Exponential backoff<\/h2>/);
  assert.match(html, /<strong>Tip<\/strong>/);
  assert.match(html, /<dt>Contribution<\/dt><dd>Add retries with backoff<\/dd>/);
  // The note without a timestamp says so instead of showing a date.
  assert.match(html, /<dt>Generated<\/dt><dd>Not recorded<\/dd>/);
  assert.match(html, /<dt>Generated<\/dt><dd>[^<]*2026[^<]*<\/dd>/);
  assert.match(html, /Study it in the code/);
  assert.doesNotMatch(html, /Sample notes/);
});

test("English filters count the visible notes and say when nothing matches", () => {
  assert.match(
    renderEnglish({ defaultKeyword: "cache" }),
    /Showing 1 of 2 notes/,
  );
  assert.match(
    renderEnglish({ runs: englishRuns.slice(0, 1) }),
    /Showing 1 of 1 note</,
  );
  assert.match(
    renderEnglish({ defaultKeyword: "no such concept" }),
    /No notes match the filters\./,
  );
});

test("the English empty page points to the Repositories page", () => {
  const html = renderEnglish({ runs: [run("empty", "Not reviewed yet", undefined)] });
  assert.match(html, /You have no learning notes yet/);
  assert.match(html, /Import a repository on the Repositories page/);
  assert.match(html, /No notes from your own contributions yet/);
});

test("the English sample section labels the sample notes", () => {
  const file: DiffFile = {
    path: "src/retry.ts",
    language: "ts",
    additions: 1,
    deletions: 0,
    status: "modified",
    patch: "",
    explanation: {
      summary: "Summary",
      reason: "Reason",
      concept: "Jitter\nSpread retries out so clients do not retry together.",
      tip: "Seed the random source in tests.",
    },
  };
  const html = renderEn(
    createElement(LearningNotes, {
      runs: englishRuns,
      repos,
      demoFiles: [file],
      onOpen() {},
    }),
  );
  assert.match(html, /Sample notes<span class="learning-demo-label">Sample<\/span>/);
  assert.match(html, /Explanations from the built-in sample contribution/);
  assert.match(html, /<div class="note-tag">Sample<\/div><h2>Jitter<\/h2>/);
  assert.match(html, /<dt>Generated<\/dt><dd>Sample content<\/dd>/);
});

test(
  "the English sample notes contain no Han",
  {
    skip:
      getDemo("en") === getDemo("zh-TW") &&
      "the English demo is still the zh-TW placeholder",
  },
  () => {
    renderEnglish({ demoFiles: getDemo("en").files });
  },
);
