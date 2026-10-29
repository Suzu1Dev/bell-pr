import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { reasoningEfforts } from "../../shared/models";
import en from "../i18n/en";
import zhTW from "../i18n/zh-TW";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import { ModelSummary } from "./ModelSummary";

type Props = Parameters<typeof ModelSummary>[0];

const render = (props: Props) => renderZh(createElement(ModelSummary, props));

/** Renders in English and checks that no zh-TW text is left. */
const renderEnglish = (props: Props) => {
  const html = renderEn(createElement(ModelSummary, props));
  assertNoHan(html);
  return html;
};

test("Codex and records without a reported model keep the 未回報 wording", () => {
  const codex = render({ execution: { source: "cli-default" } });
  assert.match(codex, /Codex 預設（型號未回報）/);
  assert.match(codex, /服務端實際使用的模型未另外回報/);
  const claude = render({
    execution: { provider: "claude", model: "opus", source: "selected" },
  });
  assert.match(claude, /<dd>opus<\/dd>/);
  assert.match(claude, /服務端實際使用的模型未另外回報/);
  assert.doesNotMatch(claude, /回報 /);
});

test("a reported Claude Code model shows the passed alias, the resolved model and the CLI version", () => {
  const selected = render({
    execution: {
      provider: "claude",
      model: "haiku",
      source: "selected",
      reported: { model: "claude-haiku-4-5-20251001", cliVersion: "2.1.292" },
    },
  });
  assert.match(
    selected,
    /<dd>傳入 haiku → 回報 claude-haiku-4-5-20251001（CLI 2\.1\.292）<\/dd>/,
  );
  assert.match(selected, /Claude Code CLI 回報的實際模型/);
  assert.doesNotMatch(selected, /未另外回報|本次執行呼叫過的模型/);

  const cliDefault = render({
    execution: {
      provider: "claude",
      source: "cli-default",
      reported: {
        model: "claude-sonnet-4-5",
        modelsUsed: ["claude-sonnet-4-5", "claude-haiku-4-5-20251001"],
      },
    },
  });
  assert.match(cliDefault, /<dd>未傳入 --model → 回報 claude-sonnet-4-5<\/dd>/);
  assert.match(
    cliDefault,
    /本次執行呼叫過的模型<\/dt><dd>claude-sonnet-4-5、claude-haiku-4-5-20251001<\/dd>/,
  );

  const same = render({
    execution: {
      provider: "claude",
      model: "claude-sonnet-4-5",
      source: "selected",
      reported: { model: "claude-sonnet-4-5", modelsUsed: ["claude-sonnet-4-5"] },
    },
  });
  assert.match(same, /<dd>claude-sonnet-4-5<\/dd>/);
  assert.doesNotMatch(same, /→|本次執行呼叫過的模型/);
});

test("web access is shown only when the run recorded it", () => {
  const on = render({
    execution: { provider: "claude", model: "sonnet", webAccess: true, source: "selected" },
  });
  assert.match(on, /<dt>網路<\/dt><dd>已允許上網<\/dd>/);
  const off = render({
    execution: { provider: "claude", model: "sonnet", source: "selected" },
  });
  assert.doesNotMatch(off, /已允許上網/);
});

test("English renders say what was passed and what the CLI reported", () => {
  const codex = renderEnglish({ execution: { source: "cli-default" } });
  assert.match(codex, /aria-label="Model settings for this run"/);
  assert.match(codex, /<strong>Run model<\/strong>/);
  assert.match(codex, /<dd>Codex default \(model not reported\)<\/dd>/);
  assert.match(codex, /<dt>Reasoning effort<\/dt><dd>Codex default<\/dd>/);
  assert.match(codex, /The model the service actually used was not reported\./);
  assert.match(codex, /settings BELL PR passed to Codex/);

  const claude = renderEnglish({
    execution: {
      provider: "claude",
      model: "haiku",
      reasoningEffort: "xhigh",
      webAccess: true,
      source: "selected",
      reported: {
        model: "claude-haiku-4-5-20251001",
        cliVersion: "2.1.292",
        modelsUsed: ["claude-haiku-4-5-20251001", "claude-sonnet-4-5"],
      },
    },
  });
  assert.match(
    claude,
    /<dd>Passed haiku → reported claude-haiku-4-5-20251001 \(CLI 2\.1\.292\)<\/dd>/,
  );
  assert.match(
    claude,
    /<dt>Models called during this run<\/dt><dd>claude-haiku-4-5-20251001, claude-sonnet-4-5<\/dd>/,
  );
  assert.match(claude, /<dd>Extra high · xhigh<\/dd>/);
  assert.match(claude, /<dt>Network<\/dt><dd>Web access allowed<\/dd>/);
  assert.match(claude, /the model the Claude Code CLI reported/);

  const cliDefault = renderEnglish({
    execution: {
      provider: "claude",
      source: "cli-default",
      reported: { model: "claude-sonnet-4-5" },
    },
  });
  assert.match(cliDefault, /<dd>No --model passed → reported claude-sonnet-4-5<\/dd>/);
});

test("English analysis, sample and unrecorded summaries", () => {
  const sample = renderEnglish({ demo: true, analysis: true });
  assert.match(sample, /aria-label="Model settings for this analysis"/);
  assert.match(sample, /<strong>Analysis model<\/strong>/);
  assert.match(sample, /Sample content\. No model has run yet\./);
  assert.match(
    renderEnglish({ analysis: true }),
    /This analysis did not record its model\./,
  );
  assert.match(renderEnglish({}), /This older run did not record its model\./);
});

test("the sample carries a Sample chip; real summaries do not", () => {
  assert.match(
    renderEnglish({ demo: true }),
    /<strong>Run model<\/strong><span class="model-summary-sample">Sample<\/span><\/div>/,
  );
  assert.match(render({ demo: true }), /class="model-summary-sample">示範</);
  assert.doesNotMatch(
    renderEnglish({ execution: { source: "cli-default" } }),
    /model-summary-sample/,
  );
});

test("an effort shows its CLI id only where the label does not already read as it", () => {
  assert.deepEqual(
    reasoningEfforts.map((effort) => en.common.reasoningEffortWithId({ effort })),
    ["Off · none", "Minimal", "Low", "Medium", "High", "Extra high · xhigh", "Max", "Ultra"],
  );
  assert.equal(zhTW.common.reasoningEffortWithId({ effort: "low" }), "低 · low");
  assert.match(
    renderEnglish({ execution: { reasoningEffort: "high", source: "selected" } }),
    /<dd>High<\/dd>/,
  );
  assert.match(
    render({ execution: { reasoningEffort: "high", source: "selected" } }),
    /<dd>高 · high<\/dd>/,
  );
});

test("full access is shown in both languages only when the run recorded it", () => {
  const execution = { source: "cli-default", agentAccess: "full" } as const;
  assert.match(render({ execution }), /完整權限（取消沙箱與指令拒絕規則）/);
  assert.match(renderEnglish({ execution }), /Full access \(sandbox and command deny rules lifted\)/);
  assert.doesNotMatch(render({ execution: { source: "cli-default" } }), /完整權限/);
});
