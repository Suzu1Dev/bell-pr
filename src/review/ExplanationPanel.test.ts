import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { demoFiles, demoRun } from "../demo";
import type { DiffFile } from "../types";
import {
  ExplanationPanel,
  ReviewReports,
  moduleFor,
  reportMentionCount,
} from "./ExplanationPanel";

const render = (file: DiffFile) =>
  renderToStaticMarkup(
    createElement(ExplanationPanel, {
      file,
      messages: [],
      loading: false,
      onAsk() {},
      demo: true,
    }),
  );

test("a demo file with an explanation renders every learning section", () => {
  const file = demoFiles[0];
  assert.ok(file.explanation, "demo fixture must carry an explanation");
  const html = render(file);
  assert.match(html, /aria-label="程式碼學習助手"/);
  for (const title of [
    "白話文舉例",
    "這段改了什麼？",
    "為什麼這樣改？",
    "帶走一個開發觀念",
    "審閱時，多想一步",
  ]) {
    assert.match(html, new RegExp(title));
  }
  assert.match(html, /指數退避（Exponential backoff）/);
  assert.match(html, /示範解說 · 預先整理的學習內容/);
});

test("test files get a reading hint and extra presets while source files keep the fixed three", () => {
  const testFile = demoFiles.find((file) => file.path === "tests/retry.test.ts")!;
  const html = render(testFile);
  assert.equal(html.match(/role="tab"/g)?.length, 3);
  assert.match(html, /審查者怎麼看/);
  assert.match(html, /測試就是行為規格：先讀 it\/test 描述/);
  assert.doesNotMatch(render(demoFiles[0]), /測試就是行為規格/);
  const chat = (file: DiffFile) =>
    renderToStaticMarkup(
      createElement(ExplanationPanel, {
        file,
        messages: [],
        loading: false,
        onAsk() {},
        demo: true,
        chatRequestId: 1,
      }),
    );
  const plain = chat({ ...demoFiles[0], path: "src/x.ts", explanation: undefined });
  assert.match(plain, /為什麼要這樣改？/);
  assert.doesNotMatch(plain, /還有哪些做法|這個測試在保護什麼行為/);
  const explained = chat(demoFiles[0]);
  assert.match(explained, /這個觀念在專案其他地方還能用在哪？/);
  assert.match(explained, /如果不這樣改，還有哪些做法？各有什麼取捨？/);
  assert.doesNotMatch(explained, /這個測試在保護什麼行為/);
  assert.match(chat(testFile), /這個測試在保護什麼行為？/);
});

test("saved answers about an older diff are marked instead of dropped", () => {
  const html = renderToStaticMarkup(
    createElement(ExplanationPanel, {
      file: { ...demoFiles[0], fingerprint: "new" },
      messages: [
        { role: "user", content: "舊問題", fingerprint: "old" },
        { role: "assistant", content: "舊回答", fingerprint: "old" },
        { role: "user", content: "新問題", fingerprint: "new" },
        { role: "assistant", content: "尚未送出的本機回答" },
      ],
      loading: false,
      onAsk() {},
      demo: false,
      chatRequestId: 1,
    }),
  );
  assert.equal(html.match(/針對較舊版本/g)?.length, 2);
  for (const content of ["舊問題", "舊回答", "新問題", "尚未送出的本機回答"])
    assert.match(html, new RegExp(content));
});

test("the reports tab renders demo reports with the static-review label and per-file mention counts", () => {
  assert.ok(demoRun.reports?.reviewer, "demo fixture must carry reports");
  const html = renderToStaticMarkup(
    createElement(ReviewReports, {
      file: demoFiles[0],
      reports: demoRun.reports,
      demo: true,
    }),
  );
  assert.match(html, /示範報告 · 預先整理的內容/);
  assert.match(html, /Lead 整合摘要/);
  assert.match(html, /Lens · Reviewer/);
  assert.match(html, /Scout · Test analyst/);
  assert.equal(html.match(/獨立靜態審查，非執行結果/g)?.length, 3);
  assert.match(html, /本報告提到此檔 \d+ 處/);
  // Markdown is rendered, not shown as raw asterisks.
  assert.match(html, /<strong>正確性<\/strong>/);
  // Non-report keys stay hidden even when present.
  const extra = renderToStaticMarkup(
    createElement(ReviewReports, {
      file: { ...demoFiles[0], path: "docs/none.md" },
      reports: { ...demoRun.reports, guide: "導師回答", alpha: "{}" },
      demo: false,
    }),
  );
  assert.doesNotMatch(extra, /導師回答/);
  assert.equal(extra.match(/此報告未直接提到本檔/g)?.length, 3);
  const empty = renderToStaticMarkup(
    createElement(ReviewReports, { file: demoFiles[0], reports: {}, demo: false }),
  );
  assert.match(empty, /這次工作還沒有審查報告/);
  assert.equal(reportMentionCount("a\n\nsrc/a.ts here\n\nand a.ts\n\nnope", "src/a.ts"), 2);
});

test("alternatives and self-check cards render only when the explanation carries them, with the answer folded", () => {
  const file = demoFiles[0];
  assert.ok(file.explanation?.alternatives && file.explanation.selfCheck);
  const html = render(file);
  assert.match(html, /如果換個做法？/);
  assert.match(html, /可以查：/);
  assert.match(html, /<code>exponential backoff<\/code>/);
  assert.match(html, /考考自己/);
  assert.match(html, /第三次重試/);
  assert.match(html, /aria-expanded="false"[^>]*>看答案</);
  assert.doesNotMatch(html, /full jitter 會在 0 到 4 秒之間/);
  // Cards saved before these fields existed hide both cards.
  const legacy = render({
    ...file,
    explanation: {
      summary: file.explanation!.summary,
      reason: file.explanation!.reason,
      concept: file.explanation!.concept,
      tip: file.explanation!.tip,
      example: file.explanation!.example,
    },
  });
  assert.doesNotMatch(legacy, /如果換個做法？|考考自己/);
  assert.match(legacy, /審閱時，多想一步/);
});

test("the module line uses the longest matching module path and stays hidden without modules", () => {
  const modules = [
    { path: "src", purpose: "程式庫原始碼" },
    { path: "src/utils/", purpose: "共用工具" },
    { path: "src/utils/retry.ts", purpose: "重試邏輯" },
    { path: "tests", purpose: "測試" },
  ];
  assert.deepEqual(moduleFor("src/utils/retry.ts", modules), {
    path: "src/utils/retry.ts",
    purpose: "重試邏輯",
  });
  assert.deepEqual(moduleFor("src/utils/sleep.ts", modules), {
    path: "src/utils",
    purpose: "共用工具",
  });
  // "src" must not match "srcfoo/x.ts": prefixes are whole path segments.
  assert.equal(moduleFor("srcfoo/x.ts", modules), undefined);
  assert.equal(moduleFor("README.md", modules), undefined);
  const html = renderToStaticMarkup(
    createElement(ExplanationPanel, {
      file: demoFiles[1],
      messages: [],
      loading: false,
      onAsk() {},
      demo: true,
      modules,
    }),
  );
  assert.match(html, /所在模組 <code>src<\/code>：程式庫原始碼/);
  assert.doesNotMatch(render(demoFiles[1]), /所在模組/);
});

test("the note editor renders with the saved text and flags a note written for an older diff", () => {
  const file = { ...demoFiles[0], fingerprint: "b".repeat(64) };
  const withNote = (fingerprint: string) =>
    renderToStaticMarkup(
      createElement(ExplanationPanel, {
        file,
        messages: [],
        loading: false,
        onAsk() {},
        demo: true,
        note: { text: "我的筆記內容", fingerprint, updatedAt: "2026-01-01T00:00:00.000Z" },
        onSaveNote() {},
      }),
    );
  const current = withNote("b".repeat(64));
  assert.match(current, /我的理解/);
  assert.match(current, /我的筆記內容<\/textarea>/);
  assert.match(current, /maxLength="2000"/i);
  assert.doesNotMatch(current, /diff 已更新/);
  // The save button stays disabled until the text changes.
  assert.match(current, /儲存筆記/);
  assert.match(current, /<button[^>]*class="explain-note-save"[^>]*disabled/);
  const stale = withNote("a".repeat(64));
  assert.match(stale, /diff 已更新/);
  assert.match(stale, /我的筆記內容<\/textarea>/);
  // A stale note can be re-saved as is to refresh its fingerprint.
  assert.doesNotMatch(stale, /<button[^>]*class="explain-note-save"[^>]*disabled/);
  // Without a save handler (no persistence available) the editor is absent.
  assert.doesNotMatch(render(file), /我的理解/);
});

test("a blocked file explains why no explanation is available", () => {
  const html = render({ ...demoFiles[0], blocked: "原因" });
  assert.match(html, /目前無法解說此檔案/);
  assert.match(html, /<p>原因<\/p>/);
  assert.doesNotMatch(html, /這段改了什麼？/);
});
