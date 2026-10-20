import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { splitConceptHeading } from "../../shared/explanations";
import { getDemo } from "../demo";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import type { DiffFile, Repo } from "../types";
import {
  collectLearningNotes,
  fetchLearningPage,
  LearningNotes,
  type LearningRecordPage,
  type LearningRun,
} from "./LearningNotes";

const demoFiles = getDemo("zh-TW").files;

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

function run(
  id: string,
  title: string,
  explanations: LearningRun["explanations"],
  notes: LearningRun["notes"] = {},
): LearningRun {
  return {
    id,
    repoId: "repo-1",
    title,
    status: "review",
    createdAt: "2026-10-01T00:00:00.000Z",
    explanations,
    notes,
  };
}

// As GET /api/learning sends them: the newest run first.
const runs: LearningRun[] = [
  run("run-new", "修正 token 快取", {
    "src/cache.ts": {
      fingerprint: "d",
      status: "ready",
      generatedAt: "2026-10-05T08:00:00.000Z",
      content: explanation("快取失效\n寫入成功後再清除舊快取，避免讀到過期資料。", "檢查並發寫入。"),
    },
  }),
  run("run-old", "加入重試機制", {
    "src/retry.ts": {
      fingerprint: "a",
      status: "ready",
      generatedAt: "2026-10-01T08:00:00.000Z",
      content: explanation("指數退避\n每次失敗後等待時間加倍，讓忙碌的服務有機會恢復。"),
    },
    // The server sends ready explanations only; the page still checks.
    "src/pending.ts": { fingerprint: "b", status: "generating" },
    "src/broken.ts": { fingerprint: "c", status: "failed", error: "逾時" },
  }),
];

type Props = Parameters<typeof LearningNotes>[0];

const render = (props: Partial<Props> = {}) =>
  renderZh(
    createElement(LearningNotes, {
      repos,
      demoFiles,
      onOpen() {},
      initial: { runs },
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

test("collectLearningNotes keeps ready explanations and notes in the record's order", () => {
  const notes = collectLearningNotes(
    [
      ...runs,
      run(
        "run-notes",
        "Notes only",
        {
          "src/a.ts": {
            fingerprint: "e",
            status: "ready",
            generatedAt: "2026-09-01T08:00:00.000Z",
            content: explanation("A\nAlpha."),
          },
          "src/b.ts": {
            fingerprint: "f",
            status: "ready",
            generatedAt: "2026-09-03T08:00:00.000Z",
            content: explanation("B\nBeta."),
          },
        },
        {
          "src/a.ts": { text: "Remember the edge case.", fingerprint: "e", updatedAt: "2026-09-02T00:00:00.000Z" },
          "src/c.ts": { text: "  Only my note.  ", fingerprint: "g", updatedAt: "2026-09-04T00:00:00.000Z" },
          "src/blank.ts": { text: "   ", fingerprint: "h", updatedAt: "2026-09-05T00:00:00.000Z" },
        },
      ),
    ],
    repos,
  );
  assert.deepEqual(
    notes.map((note) => note.path),
    // Pages stay in run order, so "Load more" appends; each run lists its newest first.
    ["src/cache.ts", "src/retry.ts", "src/c.ts", "src/b.ts", "src/a.ts"],
  );
  assert.equal(notes[0].repoName, "openfetch-sample/open-fetch");
  assert.equal(notes[1].runTitle, "加入重試機制");
  const a = notes.find((note) => note.path === "src/a.ts")!;
  assert.equal(a.note, "Remember the edge case.");
  assert.equal(a.generatedAt, "2026-09-01T08:00:00.000Z");
  const c = notes.find((note) => note.path === "src/c.ts")!;
  assert.equal(c.explanation, undefined);
  assert.equal(c.note, "Only my note.");
  assert.equal(c.generatedAt, "2026-09-04T00:00:00.000Z");
  // An unknown repository falls back to its id.
  assert.equal(
    collectLearningNotes([{ ...runs[0], repoId: "gone" }], repos)[0].repoName,
    "gone",
  );
});

test("real notes render concept, tip, task, repo, path, the AI label and a demo section", () => {
  const html = render();
  assert.match(html, /2 \/ 2 則筆記/);
  assert.match(html, /<h2 tabindex="-1">指數退避<\/h2>/);
  assert.match(html, /每次失敗後等待時間加倍/);
  assert.match(html, /先補一個失敗路徑的測試。/);
  assert.match(html, /<code>src\/retry\.ts<\/code>/);
  assert.match(html, /openfetch-sample\/open-fetch/);
  assert.match(html, /<dd>修正 token 快取<\/dd>/);
  assert.doesNotMatch(html, /src\/pending\.ts/);
  assert.doesNotMatch(html, /src\/broken\.ts/);
  assert.equal(html.match(/class="note-ai-label">AI 生成</g)?.length, 2);
  assert.match(html, /示範筆記/);
  assert.match(html, /class="learning-demo-label">示範</);
  assert.match(html, /指數退避（Exponential backoff）/);
  assert.match(html, /<option value="run-new">修正 token 快取<\/option>/);
  assert.ok(
    html.indexOf("快取失效") < html.indexOf(">指數退避</h2>"),
    "the newest run comes first",
  );
  // Everything came in one page, so there is nothing more to load.
  assert.doesNotMatch(html, /載入更多/);
});

test("keyword filter narrows real and demo notes", () => {
  const html = render({ defaultKeyword: "快取" });
  assert.match(html, /1 \/ 2 則筆記/);
  assert.match(html, /快取失效/);
  assert.doesNotMatch(html, />指數退避<\/h2>/);
  assert.doesNotMatch(html, /示範筆記/);
});

test("run filter shows one task and hides the demo section", () => {
  const html = render({ defaultRunId: "run-old" });
  assert.match(html, /1 \/ 2 則筆記/);
  assert.match(html, />指數退避<\/h2>/);
  assert.doesNotMatch(html, /快取失效/);
  assert.doesNotMatch(html, /示範筆記/);
});

test("without real explanations the page guides the user to import a project", () => {
  const html = render({ initial: { runs: [] } });
  assert.match(html, /還沒有屬於你的學習筆記/);
  assert.match(html, /匯入 repository/);
  assert.match(html, /尚無真實任務的筆記/);
  assert.match(html, /示範筆記/);
});

test("before the first page arrives the page says it is loading, and the sample stays", () => {
  const html = render({ initial: undefined, loadPage: () => new Promise(() => {}) });
  assert.match(html, /role="status"[^>]*>[\s\S]*正在載入你的筆記/);
  assert.doesNotMatch(html, /還沒有屬於你的學習筆記/);
  assert.match(html, /示範筆記/);
});

test("fetchLearningPage reads /api/learning and passes the cursor encoded", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  const urls: string[] = [];
  const page: LearningRecordPage = { runs, nextCursor: "abc" };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify(page), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  assert.deepEqual(await fetchLearningPage(), page);
  await fetchLearningPage("a+b/c=");
  assert.deepEqual(urls, ["/api/learning", "/api/learning?cursor=a%2Bb%2Fc%3D"]);
});

const englishRuns: LearningRun[] = [
  run(
    "run-new",
    "Fix the token cache",
    {
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
    },
    {
      "src/cache.ts": {
        text: "Ask why the lock is not needed.",
        fingerprint: "d",
        updatedAt: "2026-10-06T08:00:00.000Z",
      },
      "src/notes-only.ts": {
        text: "Read the retry docs.",
        fingerprint: "z",
        updatedAt: "2026-10-06T09:00:00.000Z",
      },
    },
  ),
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
];

/** Renders in English and checks that no zh-TW text is left. */
const renderEnglish = (props: Partial<Props> = {}) => {
  const html = renderEn(
    createElement(LearningNotes, {
      repos,
      demoFiles: [],
      onOpen() {},
      initial: { runs: englishRuns },
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
  assert.match(html, /The explanations are AI-generated by the agents that reviewed each change\./);
  assert.match(html, /placeholder="Search notes and files"/);
  assert.match(html, /<option value=""[^>]*>All contributions<\/option>/);
  assert.match(html, /<option value="run-new">Fix the token cache<\/option>/);
  assert.match(html, /Showing 3 of 3 notes/);
  assert.match(html, /<h2 tabindex="-1">Exponential backoff<\/h2>/);
  assert.match(html, /<strong>Tip<\/strong>/);
  assert.match(html, /<span class="note-tag">Fix the token cache<\/span><span class="note-ai-label">AI-generated<\/span>/);
  assert.match(html, /<dt>Contribution<\/dt><dd>Add retries with backoff<\/dd>/);
  // The note without a timestamp says so instead of showing a date.
  assert.match(html, /<dt>Generated<\/dt><dd>Not recorded<\/dd>/);
  assert.match(html, /<dt>Generated<\/dt><dd>[^<]*2026[^<]*<\/dd>/);
  assert.match(html, /Study it in the code/);
  assert.doesNotMatch(html, /Sample notes/);
  // The person's own notes: beside an explanation, and on their own.
  assert.match(html, /<strong>Your note<\/strong><p>Ask why the lock is not needed\.<\/p>/);
  assert.match(html, /<h2 tabindex="-1">src\/notes-only\.ts<\/h2><div class="learning-own-note"><strong>Your note<\/strong><p>Read the retry docs\.<\/p>/);
  assert.match(html, /<dt>Note saved<\/dt><dd>[^<]*2026[^<]*<\/dd>/);
  // A note the person wrote is not labelled AI-generated.
  assert.equal(html.match(/AI-generated<\/span>/g)?.length, 2);
});

test("English filters count the visible notes and say when nothing matches", () => {
  assert.match(renderEnglish({ defaultKeyword: "invalidation" }), /Showing 1 of 3 notes/);
  // The person's notes are searched too.
  assert.match(renderEnglish({ defaultKeyword: "retry docs" }), /Showing 1 of 3 notes/);
  assert.match(
    renderEnglish({ initial: { runs: englishRuns.slice(1) } }),
    /Showing 1 of 1 note</,
  );
  assert.match(
    renderEnglish({ defaultKeyword: "no such concept" }),
    /No notes match the filters\./,
  );
});

test("a record with older pages offers Load more and says the count is so far", () => {
  const html = renderEnglish({ initial: { runs: englishRuns, nextCursor: "next" } });
  assert.match(html, /Showing 3 of the 3 notes loaded so far/);
  assert.match(
    html,
    /<div class="learning-more"><button type="button" class="button secondary" aria-describedby="learning-count">Load more<\/button><\/div>/,
  );
  // Matching notes may be on a page not read yet, so it stays with no match.
  assert.match(
    renderEnglish({
      initial: { runs: englishRuns, nextCursor: "next" },
      defaultKeyword: "no such concept",
    }),
    /No notes match the filters\.[\s\S]*Load more/,
  );
});

test("the English empty and loading pages point to the Repositories page", () => {
  const html = renderEnglish({ initial: { runs: [] } });
  assert.match(html, /You have no learning notes yet/);
  assert.match(html, /Import a repository on the Repositories page/);
  assert.match(html, /No notes from your own contributions yet/);
  const loading = renderEnglish({ initial: undefined, loadPage: () => new Promise(() => {}) });
  assert.match(loading, /Loading your notes…/);
  assert.doesNotMatch(loading, /You have no learning notes yet/);
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
      repos,
      demoFiles: [file],
      onOpen() {},
      initial: { runs: englishRuns },
    }),
  );
  assert.match(html, /Sample notes<span class="learning-demo-label">Sample<\/span>/);
  assert.match(html, /Explanations from the built-in sample contribution/);
  assert.match(
    html,
    /<div class="note-tags"><span class="note-tag">Sample<\/span><\/div><h2 tabindex="-1">Jitter<\/h2>/,
  );
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

/** The English runs with the understanding check recorded on them. */
const checkedRuns: LearningRun[] = [
  {
    ...englishRuns[0],
    understanding: {
      summary: {
        text: "The cache dropped entries before the write finished.\nNow the entry is cleared only after the write succeeds.",
        changeFingerprint: "c1",
        at: "2026-10-06T10:00:00.000Z",
      },
    },
  },
  { ...englishRuns[1], status: "approved", understandingCheckOff: true },
];

test("the notes view links the page's views, notes first", () => {
  const html = renderEnglish();
  assert.match(
    html,
    /<\/div><\/div><nav class="learning-views" aria-label="Learning views"><a href="#\/learning" aria-current="page" data-view="notes">Notes<\/a><a href="#\/learning\?view=practice" data-view="practice">Practice<\/a><a href="#\/learning\?view=debrief" data-view="debrief">Coach debrief<\/a><\/nav>/,
  );
});

test("each contribution shows the person's own explanation, and runs approved without the check are marked", () => {
  const html = renderEnglish({ initial: { runs: checkedRuns } });
  const section = html.match(/<section class="learning-runs".*?<\/section>/s)?.[0] ?? "";
  assert.match(section, /<h2 id="learning-runs-title">Your explanations<\/h2>/);
  const cards = [...section.matchAll(/<article class="learning-run-card">.*?<\/article>/gs)].map(([card]) => card);
  assert.equal(cards.length, 2);
  assert.match(cards[0], /<span class="note-number">openfetch-sample\/open-fetch<\/span><h3>Fix the token cache<\/h3><div class="learning-own-note"><strong>Your explanation<\/strong><p>The cache dropped entries before the write finished\.\nNow the entry/);
  assert.doesNotMatch(cards[0], /check off/i);
  assert.match(cards[1], /<h3>Add retries with backoff<\/h3><span class="learning-check-off">Understanding check off<\/span><p class="learning-run-text">Approved without explaining the change back\.<\/p>/);
  // The cards come before the file notes, which stay as they were.
  assert.ok(html.indexOf("learning-runs") < html.indexOf("learning-grid"));
  assert.match(html, /Showing 3 of 3 notes/);

  // Without a summary or the mark, a run has no card, and no section shows.
  assert.doesNotMatch(renderEnglish(), /learning-runs/);
  // The filters apply: the chosen contribution and the keyword.
  assert.doesNotMatch(renderEnglish({ initial: { runs: checkedRuns }, defaultRunId: "run-old" }), /Fix the token cache<\/h3>/);
  const keyword = renderEnglish({ initial: { runs: checkedRuns }, defaultKeyword: "WRITE SUCCEEDS" });
  assert.match(keyword, /<h3>Fix the token cache<\/h3>/);
  assert.doesNotMatch(keyword, /<h3>Add retries with backoff<\/h3>/);

  const zh = renderZh(createElement(LearningNotes, { repos, demoFiles: [], onOpen() {}, initial: { runs: checkedRuns } }));
  assert.match(zh, /<span class="learning-check-off">理解檢查已關閉<\/span>/);
  assert.match(zh, /<strong>你的說明<\/strong>/);
});

test("a Learn-by-hand run's entry carries its record, which loads with the byhand chunk", () => {
  const byHand: LearningRun = {
    ...englishRuns[1],
    id: "run-by-hand",
    title: "Cap the retries by hand",
    explanations: {},
    notes: {},
    learnByHand: true,
    byHandSummary: {
      helps: { answer: 2 },
      hintRequests: 1,
      lowRungRequests: 1,
      highestRungs: [],
      predictions: { judged: 0, right: 0, unsure: 0 },
      namedTests: 0,
      readyVersions: 1,
      reviewFindings: [],
      removedAnswers: 0,
      removedTotal: 0,
      outlineBeforeDraft: false,
      exits: 0,
      left: false,
    },
  };
  const html = renderEnglish({ initial: { runs: [...checkedRuns, byHand] } });
  assertNoHan(html);
  const cards = [...html.matchAll(/<article class="learning-run-card">.*?<\/article>/gs)].map(([card]) => card);
  assert.equal(cards.length, 3);
  // Neither an explanation nor the check-off text: the record says what happened.
  assert.match(cards[2], /<h3>Cap the retries by hand<\/h3><\/article>/);
  // A run without a record keeps its card as before.
  assert.doesNotMatch(cards[0], /by hand/i);
});
