import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { EfficiencyMetrics } from "../../shared/efficiency";
import { EfficiencySummary } from "./EfficiencySummary";

const metrics: EfficiencyMetrics = {
  policyVersion: "bell-ponytail-v1",
  mode: "lite",
  calls: 2,
  completedCalls: 2,
  failedCalls: 0,
  measuredCalls: 2,
  durationMs: 12_345,
  inputTokens: 123_456,
  cachedInputTokens: 7_890,
  outputTokens: 1_234,
};

const render = (props: Parameters<typeof EfficiencySummary>[0]) =>
  renderToStaticMarkup(createElement(EfficiencySummary, props));

test("measured calls render zh-TW formatted tokens and summed time", () => {
  const html = render({ metrics });
  assert.match(html, /<dd>123,456<\/dd>/);
  assert.match(html, /<dd>7,890<\/dd>/);
  assert.match(html, /<dd>1,234<\/dd>/);
  assert.match(html, /12\.3 秒/);
  assert.match(html, /用量回報 2 \/ 2/);
  assert.match(html, /Ponytail · 輕量/);
});

test("calls without reported usage show 未回報 instead of zero", () => {
  const html = render({
    metrics: { ...metrics, measuredCalls: 0, inputTokens: 0, outputTokens: 0 },
  });
  assert.match(html, /<dd>未回報<\/dd>/);
  assert.doesNotMatch(html, /<dd>0<\/dd>/);
  assert.match(html, /僅加總已回報部分/);
});

test("demo and unmeasured runs report no measurement", () => {
  assert.match(render({ metrics, demo: true }), /尚無實測；示範內容未呼叫 AI/);
  assert.match(render({ mode: "off" }), /尚無實測；執行後會顯示/);
});
