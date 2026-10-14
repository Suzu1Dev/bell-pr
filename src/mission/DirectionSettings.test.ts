import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { createElement } from "react";
import {
  defaultContributionSettings,
  type ContributionSettings,
} from "../../shared/insights";
import type { ModelCatalog } from "../../shared/models";
import { ApiError } from "../api";
import { setLocale } from "../i18n";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import {
  DirectionSettings,
  loadModelCatalog,
  type DirectionSettingsProps,
} from "./DirectionSettings";

const props = (
  value: Partial<ContributionSettings> = {},
  options: Partial<Omit<DirectionSettingsProps, "value">> = {},
) =>
  createElement(DirectionSettings, {
    value: { ...defaultContributionSettings, ...value },
    onChange() {},
    ...options,
  });

const claudeSentence =
  "Uses the Claude Code CLI you installed and signed in to (Claude plan or Anthropic API key). Usage counts against your own account. Available models depend on your plan.";

// Words of the replaced Claude sign-in copy (the plan-only wording, and in
// zh-TW also "does not use API"), written with escapes so that searching the
// sources for that copy finds nothing.
const replacedEnglishCopy = /\x73ubscription/i;
const replacedChineseCopy = /\u8a02\u95b1|\u4e0d\u4f7f\u7528 API/;

test("the English form has no Han in any layout or provider", () => {
  const layouts: Partial<Omit<DirectionSettingsProps, "value">>[] = [
    {},
    { compact: true },
    { modelsOnly: true },
  ];
  for (const options of layouts)
    for (const provider of ["codex", "claude"] as const) {
      const html = renderEn(
        props(
          // A saved model and effort the catalog has not confirmed yet.
          { provider, model: "saved-model", reasoningEffort: "high" },
          options,
        ),
      );
      assertNoHan(html);
    }
  const html = renderEn(props({ direction: "docs" }));
  assert.match(html, /Which direction do you want to contribute in\?/);
  assert.match(html, /<strong>Improve docs<\/strong><small>Make it easier to understand and start<\/small>/);
  assert.match(html, /Boundaries <span>Optional<\/span>/);
  assert.match(html, /placeholder="For example:\nA temporary failure succeeds on retry/);
  assert.match(html, /Reading the models your local Codex offers…/);
  assert.match(html, /<option value="" selected="">Codex default<\/option>/);
  assert.match(html, /<option value="" selected="">Model default<\/option>/);
  assert.match(html, /<option value="lite" selected="">Lite · default<\/option>/);
  assert.match(html, /<strong>2<\/strong><span>teammates<\/span>/);
  // Compact layouts leave out the direction hints.
  assert.doesNotMatch(renderEn(props({}, { compact: true })), /Make it easier to understand and start/);
});

test("the English Claude help is the neutral sentence, not the replaced sign-in copy", () => {
  const html = renderEn(props({ provider: "claude" }));
  assert.ok(html.includes(claudeSentence));
  assert.doesNotMatch(html, replacedEnglishCopy);
  // The neutral sentence names the API key as one way to sign in; nothing
  // may say that an API key is not used or that API billing does not apply.
  assert.doesNotMatch(html, /\b(?:no|not|without|instead of)\b[^.<]*\bAPI key/i);
  assert.doesNotMatch(html, /API billing/i);

  const codex = renderEn(props({ provider: "codex" }));
  assert.ok(codex.includes("Uses the Codex CLI you installed and signed in to."));
  assert.ok(!codex.includes(claudeSentence));
});

test("the zh-TW Claude help is neutral too, and a saved choice keeps its legacy wording", () => {
  const html = renderZh(
    props({ provider: "claude", model: "saved-model", reasoningEffort: "high" }),
  );
  assert.match(html, /使用你已安裝並登入的 Claude Code CLI（Claude 方案或 Anthropic API 金鑰皆可）。用量計入你自己的帳號，可用模型依你的方案而定。/);
  assert.doesNotMatch(html, replacedChineseCopy);
  assert.match(html, /saved-model · 已儲存，待確認/);
  assert.match(html, /high · 已儲存，待確認/);
  assert.match(html, /<strong>修復問題<\/strong><small>讓原本的行為正常運作<\/small>/);
  assert.match(html, /開發界線 <span>選填<\/span>/);
  assert.match(renderZh(props({ provider: "codex" })), /使用你已安裝並登入的 Codex CLI。/);
});

const realFetch = globalThis.fetch;

afterEach(async () => {
  globalThis.fetch = realFetch;
  await setLocale("en");
});

function stubFetch(respond: (signal?: AbortSignal | null) => Response) {
  const calls: { url: string; headers: Headers; signal?: AbortSignal | null }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers),
      signal: init?.signal,
    });
    if (init?.signal?.aborted) throw init.signal.reason;
    return respond(init?.signal);
  }) as typeof fetch;
  return calls;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

test("the model catalog is read through api() with the UI locale and the caller's signal", async () => {
  const catalog: ModelCatalog = { source: "claude", models: [] };
  const calls = stubFetch(() => json(200, catalog));
  await setLocale("zh-TW");
  const controller = new AbortController();
  assert.deepEqual(await loadModelCatalog("claude", controller.signal), catalog);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/models?provider=claude");
  assert.equal(calls[0].headers.get("X-Bell-Locale"), "zh-TW");
  assert.equal(calls[0].signal, controller.signal);
});

test("a failed catalog request gives the server's structured error, and an abort stays an abort", async () => {
  stubFetch(() => json(400, { error: "Unsupported agent.", code: "codex_missing" }));
  const failure = await loadModelCatalog("codex").then(
    () => assert.fail("expected the request to fail"),
    (error: unknown) => error,
  );
  assert.ok(failure instanceof ApiError);
  assert.equal(failure.message, "Unsupported agent.");
  assert.equal(failure.status, 400);
  assert.equal(failure.code, "codex_missing");

  stubFetch(() => json(200, {}));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(loadModelCatalog("codex", controller.signal), (error: unknown) => {
    assert.ok(!(error instanceof ApiError));
    assert.equal((error as Error).name, "AbortError");
    return true;
  });
});
