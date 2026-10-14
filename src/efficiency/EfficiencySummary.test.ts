import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import {
  ponytailSource,
  ponytailVersion,
  type EfficiencyMetrics,
} from "../../shared/efficiency";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import { EfficiencySummary, groupByRole } from "./EfficiencySummary";

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

type Props = Parameters<typeof EfficiencySummary>[0];

const render = (props: Props) =>
  renderZh(createElement(EfficiencySummary, props));

/** Renders in English and checks that no zh-TW text is left. */
const renderEnglish = (props: Props) => {
  const html = renderEn(createElement(EfficiencySummary, props));
  assertNoHan(html);
  return html;
};

const byRole: EfficiencyMetrics["byRole"] = {
  "member-2": {
    calls: 1,
    measuredCalls: 1,
    inputTokens: 2_000,
    cachedInputTokens: 500,
    outputTokens: 100,
    durationMs: 1_000,
  },
  "member-1": {
    calls: 2,
    measuredCalls: 1,
    inputTokens: 1_000,
    cachedInputTokens: 0,
    outputTokens: 50,
    durationMs: 500,
  },
  lead: {
    calls: 1,
    measuredCalls: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    durationMs: 2_000,
  },
  custom: {
    calls: 1,
    measuredCalls: 1,
    inputTokens: 7,
    cachedInputTokens: 0,
    outputTokens: 1,
    durationMs: 10,
  },
};

test("measured calls render zh-TW formatted tokens and summed time", () => {
  const html = render({ metrics });
  assert.match(html, /<dd>123,456<\/dd>/);
  assert.match(html, /<dd>7,890<\/dd>/);
  assert.match(html, /<dd>1,234<\/dd>/);
  assert.match(html, /12\.3 秒/);
  assert.match(html, /用量回報 2 \/ 2/);
  assert.match(html, /效率模式：輕量/);
});

test("calls without reported usage show 未回報 instead of zero", () => {
  const html = render({
    metrics: { ...metrics, measuredCalls: 0, inputTokens: 0, outputTokens: 0 },
  });
  assert.match(html, /<dd>未回報<\/dd>/);
  assert.doesNotMatch(html, /<dd>0<\/dd>/);
  assert.match(html, /僅加總已回報部分/);
});

test("byRole renders a collapsible table with teammates merged and unreported roles marked", () => {
  const html = render({ metrics: { ...metrics, byRole } });
  assert.match(html, /<details class="efficiency-roles"><summary>依角色分項（3 類）/);
  const rows = [...html.matchAll(/<tr><th scope="row">([^<]+)<\/th>/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(rows, ["Lead（規劃與整合）", "Teammates", "custom"]);
  assert.match(html, /Lead（規劃與整合）<\/th><td>1（回報 0）<\/td><td>未回報<\/td>/);
  assert.match(html, /Teammates<\/th><td>3（回報 2）<\/td><td>3,000<\/td><td>500<\/td><td>150<\/td><td>1\.5 秒<\/td>/);
  assert.doesNotMatch(render({ metrics }), /efficiency-roles/);
});

test("demo and unmeasured runs report no measurement", () => {
  assert.match(render({ metrics, demo: true }), /尚無實測；示範內容未呼叫 AI/);
  assert.match(render({ mode: "off" }), /尚無實測；執行後會顯示/);
});

test("English renders format tokens, seconds and the usage note", () => {
  const html = renderEnglish({ metrics });
  assert.match(html, /aria-label="Team AI usage"/);
  assert.match(html, /<strong>Team AI usage<\/strong>/);
  assert.match(html, /<summary title="The efficiency modes build on Ponytail \d+\.\d+\.\d+ by DietrichGebert \(MIT license\)\.[^"]*">Efficiency mode: Lean<svg/);
  assert.match(html, /<dt>Input tokens<\/dt><dd>123,456<\/dd>/);
  assert.match(html, /<dt>Of which cached<\/dt><dd>7,890<\/dd>/);
  assert.match(html, /<dt>Output tokens<\/dt><dd>1,234<\/dd>/);
  assert.match(html, /<dt>Total agent time<\/dt><dd>12\.3 s<\/dd>/);
  assert.match(
    html,
    /2 calls · usage reported for 2 of 2\. Cached input is included in the input tokens\./,
  );

  const partial = renderEnglish({
    metrics: { ...metrics, calls: 1, measuredCalls: 0, completedCalls: 0 },
    title: "Discovery AI usage",
  });
  assert.match(partial, /<strong>Discovery AI usage<\/strong>/);
  assert.match(partial, /<dd>Not reported<\/dd>/);
  assert.match(partial, /<dd>Running<\/dd>/);
  assert.match(partial, /1 call · usage reported for 0 of 1, so the totals/);
});

test("English role table keeps the order, merges teammates and marks partial reports", () => {
  const html = renderEnglish({ metrics: { ...metrics, byRole } });
  assert.match(html, /<summary>By role \(3 groups\)<\/summary>/);
  const rows = [...html.matchAll(/<tr><th scope="row">([^<]+)<\/th>/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(rows, ["Lead (planning and integration)", "Teammates", "custom"]);
  assert.match(
    html,
    /Lead \(planning and integration\)<\/th><td>1 \(0 reported\)<\/td><td>Not reported<\/td>/,
  );
  assert.match(
    html,
    /Teammates<\/th><td>3 \(2 reported\)<\/td><td>3,000<\/td><td>500<\/td><td>150<\/td><td>1\.5 s<\/td>/,
  );
  assert.match(html, /<th scope="col">Of which cached<\/th>/);
  const one = renderEnglish({
    metrics: { ...metrics, byRole: { reviewer: byRole.custom } },
  });
  assert.match(one, /<summary>By role \(1 group\)<\/summary>/);
  assert.match(one, /<th scope="row">Reviewer<\/th><td>1<\/td>/);
  // Unknown roles keep their raw key, even one named like an object method.
  assert.match(
    renderEnglish({ metrics: { ...metrics, byRole: { constructor: byRole.custom } } }),
    /<th scope="row">constructor<\/th>/,
  );
});

test("English sample and unmeasured runs report no measurement", () => {
  assert.match(
    renderEnglish({ metrics, demo: true }),
    /No measurements yet\. The sample did not call AI\./,
  );
  const off = renderEnglish({ mode: "off" });
  assert.match(off, /Efficiency mode: Off/);
  assert.match(off, /No measurements yet\. Reported usage and time appear/);
});

test("groupByRole orders the known roles by id and puts unknown keys last", () => {
  const rows = groupByRole({
    zeta: byRole.custom,
    sync: byRole.custom,
    alpha: byRole.custom,
    tester: byRole.custom,
    "member-3": byRole.custom,
  });
  assert.deepEqual(
    rows.map((row) => row.key),
    ["member", "tester", "sync", "alpha", "zeta"],
  );
});

test("the mode chip reads Efficiency mode and opens the Ponytail credit and link", () => {
  const html = renderEnglish({ metrics });
  // The user-facing name is the efficiency mode; Ponytail is credited, not the label.
  assert.doesNotMatch(html, /Ponytail ·/);
  assert.match(
    html,
    new RegExp(
      `<details class="efficiency-mode"><summary title="[^"]+">Efficiency mode: Lean<svg[\\s\\S]*?</svg></summary><div class="efficiency-credit" role="note" tabindex="-1"><p>The efficiency modes build on Ponytail ${ponytailVersion} by DietrichGebert \\(MIT license\\)\\. Lean gives the agents a short adaptation of its principles, Full gives them its complete rules, and Off adds neither\\.</p><a href="${ponytailSource}" target="_blank" rel="noreferrer">Ponytail upstream project<svg`,
    ),
  );
  assert.match(renderEnglish({ mode: "full" }), /Efficiency mode: Full/);
  // Without a recorded mode there is no chip and no credit.
  assert.doesNotMatch(renderEnglish({}), /efficiency-mode|Ponytail/);
  assert.match(render({ metrics }), /Ponytail \d+\.\d+\.\d+（MIT 授權）/);
});

test("without measured calls the summary folds into one line, and the sample is marked", () => {
  assert.match(renderEnglish({ mode: "lite" }), /<section class="efficiency-summary is-empty"/);
  assert.match(renderEnglish({ metrics }), /<section class="efficiency-summary "/);
  const sample = renderEnglish({ metrics, mode: "lite", demo: true });
  assert.match(sample, /<section class="efficiency-summary is-empty"/);
  assert.match(sample, /<strong>Team AI usage<\/strong><\/span><span class="efficiency-sample">Sample<\/span>/);
  assert.doesNotMatch(renderEnglish({ metrics }), /efficiency-sample/);
  assert.match(render({ demo: true }), /class="efficiency-sample">示範</);
});

test("follow-up and sync calls have their own rows", () => {
  const html = renderEnglish({
    metrics: { ...metrics, byRole: { followup: byRole.custom, sync: byRole.custom } },
  });
  assert.match(html, /<th scope="row">Review fixes<\/th>/);
  assert.match(html, /<th scope="row">Conflict resolution<\/th>/);
});
