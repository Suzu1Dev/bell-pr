import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { demoFiles, demoRun } from "../demo";
import type { DiffFile } from "../types";
import {
  ExplanationPanel,
  ReviewReports,
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

test("a blocked file explains why no explanation is available", () => {
  const html = render({ ...demoFiles[0], blocked: "原因" });
  assert.match(html, /目前無法解說此檔案/);
  assert.match(html, /<p>原因<\/p>/);
  assert.doesNotMatch(html, /這段改了什麼？/);
});
