import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { demoFiles } from "../demo";
import type { DiffFile } from "../types";
import { WalkthroughCards } from "./WalkthroughCards";

const render = (file: DiffFile, props: Partial<Parameters<typeof WalkthroughCards>[0]> = {}) =>
  renderToStaticMarkup(createElement(WalkthroughCards, { file, demo: false, ...props }));
const client = demoFiles.find((entry) => entry.path === "src/client.ts")!;

test("a ready walkthrough shows the function, its parts with their lines, callers, callees, an analogy and a self-check", () => {
  const html = render(client, { demo: true, highlight: { startLine: 12, endLine: 16 }, onHighlight() {} });
  assert.match(html, /<strong>createClient<\/strong><small>函式<\/small>/);
  assert.match(html, /第 10–25 行/);
  assert.match(html, /這次修改與它的關係/);
  assert.match(html, /逐步拆解/);
  // The selected part is pressed; the others are not.
  assert.match(html, /class="walkthrough-step-lines" aria-pressed="true"[^>]*>(?:(?!<\/button>).)*第 12–16 行<\/button>/);
  assert.match(html, /class="walkthrough-step-lines" aria-pressed="false"[^>]*>(?:(?!<\/button>).)*第 10–11 行<\/button>/);
  // Explanations render outside the buttons, so their paragraphs and links stay valid.
  assert.doesNotMatch(html, /<button[^>]*>(?:(?!<\/button>).)*<(?:p|a|table)\b/);
  assert.match(html, /誰呼叫它/);
  assert.match(html, /<code>README\.md:11<\/code>/);
  assert.match(html, /它呼叫什麼/);
  assert.match(html, /<code>src\/utils\/retry\.ts:6<\/code>/);
  assert.match(html, /換個方式想/);
  assert.match(html, /<details class="walkthrough-check"><summary>考考自己：/);
});

test("waiting, failed, unavailable and empty walkthroughs each explain themselves", () => {
  const base: DiffFile = { ...client, walkthrough: undefined };
  assert.match(render({ ...base, walkthroughStatus: "pending" }), /程式碼解說會自動準備好/);
  assert.match(render({ ...base, walkthroughStatus: "generating" }), /正在閱讀這個檔案和它的呼叫端/);
  const failed = render({ ...base, walkthroughStatus: "failed", walkthroughError: "逾時" }, { onRetry() {} });
  assert.match(failed, /逾時/);
  assert.match(failed, /重新產生程式碼解說/);
  assert.match(
    render({ ...base, walkthroughStatus: "unavailable", walkthroughError: "這類檔案沒有函式可以拆解。" }),
    /這類檔案沒有函式可以拆解/,
  );
  assert.match(
    render({ ...base, walkthroughStatus: "ready", walkthrough: { functions: [] } }),
    /沒有找到包住這些變更的函式/,
  );
  // Demo files without a prepared walkthrough say so instead of waiting forever.
  assert.match(render(demoFiles[0], { demo: true }), /示範資料只為部分檔案準備了程式碼解說/);
});

test("new code is named and sent to the change explanation instead of being walked through", () => {
  const base: DiffFile = { ...client, walkthroughStatus: "ready" };
  const onlyNew = render({ ...base, walkthrough: { functions: [], newUnits: ["a_reloaded_interview_keeps_the_id"] } });
  assert.match(onlyNew, /這個檔案的變更都是新增的程式碼/);
  assert.match(onlyNew, /<code>a_reloaded_interview_keeps_the_id<\/code>/);
  assert.match(onlyNew, /請看「變更解說」/);
  assert.doesNotMatch(onlyNew, /沒有找到包住這些變更的函式/);
  const mixed = render({ ...base, walkthrough: { ...client.walkthrough!, newUnits: ["HttpError"] } }, { demo: true });
  assert.match(mixed, /createClient/);
  assert.match(mixed, /這次新增的程式碼沒有原本的邏輯可以拆解：<span><code>HttpError<\/code><\/span>/);
});
