import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelSummary } from "./ModelSummary";

const render = (props: Parameters<typeof ModelSummary>[0]) =>
  renderToStaticMarkup(createElement(ModelSummary, props));

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
