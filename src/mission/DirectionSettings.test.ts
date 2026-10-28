import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { act, createElement } from "react";
import {
  defaultContributionSettings,
  type ContributionSettings,
} from "../../shared/insights";
import type { DoctorCheck, DoctorReport } from "../../shared/doctor";
import type { ModelCatalog } from "../../shared/models";
import { ApiError } from "../api";
import { setLocale } from "../i18n";
import type { DoctorState } from "../setup/useDoctor";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import {
  DirectionSettings,
  loadModelCatalog,
  type DirectionSettingsProps,
} from "./DirectionSettings";
import type { StartCheck } from "./StartConfirm";
import { mount } from "./test-dom";

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
  assert.match(html, /<option value="lite" selected="">Lean · default<\/option>/);
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

// A catalog whose default model offers every effort, the deepest ones too.
const catalog: ModelCatalog = {
  source: "codex",
  models: [
    {
      id: "gpt-test",
      name: "GPT Test",
      description: "A test model.",
      isDefault: true,
      reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
      defaultReasoningEffort: "medium",
    },
  ],
};

const open = (
  value: Partial<ContributionSettings>,
  options: Partial<Omit<DirectionSettingsProps, "value">>,
) => renderEn(props(value, { initialCatalog: catalog, ...options }));

/** The first match of `pattern` in `html`; fails when there is none. */
function find(html: string, pattern: RegExp) {
  const found = html.match(pattern)?.[0];
  assert.ok(found, `nothing matches ${pattern}`);
  return found;
}
/** The team-size radio for `count` teammates, as rendered. */
const teamRadio = (html: string, count: number) =>
  find(html, new RegExp(`<label class="mission-team-choice[^"]*"><input type="radio"[^>]*>(?=<strong>${count}</strong>)`));
const option = (html: string, value: string) =>
  find(html, new RegExp(`<option value="${value}"[^>]*>[^<]*</option>`));
const webAccess = (html: string) =>
  find(html, /<input type="checkbox"[^>]*aria-describedby="[^"]*-web-help"[^>]*>/);

test("every team size, every effort and web access are open, without a chip, in the sample too", () => {
  for (const demo of [false, true]) {
    const html = open({ maxTeammates: 4 }, { demo });
    assertNoHan(html);
    for (const count of [2, 3, 4]) assert.doesNotMatch(teamRadio(html, count), /disabled/);
    assert.match(teamRadio(html, 4), /checked=""/);
    assert.equal(option(html, "high"), '<option value="high">High</option>');
    assert.equal(option(html, "xhigh"), '<option value="xhigh">Extra high · xhigh</option>');
    assert.equal(option(html, "max"), '<option value="max">Max</option>');
    assert.doesNotMatch(webAccess(html), /disabled/);
    assert.doesNotMatch(html, /pro-badge|mission-clamp-notice|mission-option-locked|mission-team-choice[^"]* locked/);
    assert.match(html, /aria-describedby="([^"]*)-reasoning-default \1-reasoning-help"/);
    assert.match(html, /<p id="[^"]*-reasoning-default" class="mission-field-note">Default uses the model&#x27;s own default effort\.<\/p>/);
  }
});

test("web access stays off until the person turns it on", () => {
  assert.doesNotMatch(webAccess(open({}, { demo: false })), /checked/);
  assert.match(webAccess(open({ webAccess: true }, { demo: false })), /checked=""/);
});

test("the form wording has no plan or upgrade copy, in either language", () => {
  for (const html of [open({ maxTeammates: 3 }, {}), renderZh(props({ maxTeammates: 3 }, { initialCatalog: catalog }))]) {
    assert.doesNotMatch(html, /\bPro\b|\bFree\b|Upgrade|upgrade|[Tt]rial|免費|升級|試用/);
  }
});

/** fetch answering the requests the form makes once it is mounted. */
function stubApi() {
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    const body = url.startsWith("/api/models")
      ? catalog
      : url.startsWith("/api/doctor")
        ? { checks: [], ready: true, checkedAt: "", platform: "linux" }
        : {};
    return json(200, body);
  }) as typeof fetch;
  return urls;
}

test("once mounted, a saved team of 3 or 4 is kept: nothing is reported back, and no extra request is made", async () => {
  const cases: Partial<Omit<DirectionSettingsProps, "value">>[] = [
    { demo: false },
    { demo: true },
    { demo: false, modelsOnly: true },
  ];
  for (const maxTeammates of [3, 4] as const)
    for (const options of cases) {
      const urls = stubApi();
      const calls: ContributionSettings[] = [];
      const view = await mount(
        props({ maxTeammates }, { ...options, onChange: (next) => calls.push(next) }),
      );
      try {
        assert.deepEqual(calls, [], JSON.stringify(options));
        assert.ok(urls.every((url) => url.startsWith("/api/models") || url.startsWith("/api/doctor")), urls.join());
        // The demo checks no environment.
        assert.equal(urls.some((url) => url.startsWith("/api/doctor")), !options.demo);
      } finally {
        await view.unmount();
      }
    }
});

const check = (
  id: DoctorCheck["id"],
  status: DoctorCheck["status"],
  extra: Partial<DoctorCheck> = {},
): DoctorCheck => ({ id, status, required: false, ...extra });

const doctor = (checks: DoctorCheck[]): DoctorState => ({
  report: { checks, ready: true, checkedAt: "2026-10-14T00:00:00.000Z", platform: "linux" } satisfies DoctorReport,
  checking: false,
  error: "",
  refresh: async () => {},
});

const environment = doctor([
  check("codex", "ok", { version: "0.159.0" }),
  check("codex-auth", "warn", {
    reason: "signed-out",
    detail: "Not signed in.",
    fixes: [{ label: "Sign in to Codex", command: "codex login" }],
  }),
  check("claude", "ok"),
  check("claude-auth", "ok", { detail: "Signed in." }),
]);

test("each provider says whether it is ready, and a selected provider that is not explains the fix", () => {
  const codex = renderEn(props({ provider: "codex" }, { doctor: environment, demo: false }));
  assertNoHan(codex);
  assert.match(codex, /<option value="codex" selected="">Codex — not signed in<\/option>/);
  assert.match(codex, /<option value="claude">Claude Code — ready<\/option>/);
  assert.match(codex, /class="readiness-notice" role="status"/);
  assert.match(codex, /Codex sign-in: Not signed in\./);
  assert.match(codex, /codex login/);

  const claude = renderEn(props({ provider: "claude" }, { doctor: environment, demo: false }));
  assert.match(claude, /<option value="claude" selected="">Claude Code — ready<\/option>/);
  assert.doesNotMatch(claude, /readiness-notice/);

  const missing = renderEn(
    props({ provider: "claude" }, {
      doctor: doctor([check("codex", "warn", { reason: "broken" }), check("claude", "skip", { reason: "missing", detail: "Not installed." })]),
      demo: false,
    }),
  );
  assert.match(missing, /Codex — not working<\/option>/);
  assert.match(missing, /Claude Code — not installed<\/option>/);
  assert.match(missing, /Claude Code: Not installed\./);

  // The demo needs no tools: plain names and no notice.
  const demo = renderEn(props({ provider: "codex" }, { doctor: environment, demo: true }));
  assert.match(demo, /<option value="codex" selected="">Codex<\/option>/);
  assert.doesNotMatch(demo, /readiness-notice/);
  // Before the report arrives the names stand alone.
  assert.match(renderEn(props({}, { demo: false })), /<option value="codex" selected="">Codex<\/option>/);

  assert.match(
    renderZh(props({ provider: "codex" }, { doctor: environment, demo: false })),
    /<option value="claude">Claude Code（已就緒）<\/option>/,
  );
});

test("the efficiency setting is named Efficiency mode, with the Ponytail credit as its tooltip", () => {
  const html = renderEn(props());
  assert.match(
    html,
    /<label for="[^"]*-ponytail" title="Efficiency mode is based on Ponytail by DietrichGebert \(MIT\)\.">Efficiency mode<\/label>/,
  );
  assert.doesNotMatch(html, /development mode/);
  assert.match(renderZh(props()), />效率模式<\/label>/);
  assert.match(renderZh(props()), /「模型預設」會使用模型本身的預設強度。/);
});

test("the task dialog's form shows the Before-you-start facts under the issue field; the settings defaults do not", async () => {
  const urls = stubApi();
  const reports: StartCheck[] = [];
  const view = await mount(
    props({}, { demo: true, repoId: "demo-repo", onStartCheck: (check) => reports.push(check) }),
  );
  try {
    // The facts load with their own chunk.
    for (let tries = 0; tries < 60 && !view.text().includes("Before you start"); tries++)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    assert.ok(view.text().includes("Before you start#42 (sample)"), view.text());
    assert.ok(view.text().includes("Your open PRs here: 0 of 1"));
    assert.deepEqual(reports.at(-1)?.reasons, []);
    assert.ok(!urls.some((url) => url.includes("contribution")), urls.join());
  } finally {
    await view.unmount();
  }
  stubApi();
  const defaults = await mount(props({}, { demo: true }));
  try {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    assert.ok(!defaults.text().includes("Before you start"));
  } finally {
    await defaults.unmount();
  }
});

test("in Learn by hand the team size is hidden and plan approval is always on", () => {
  const html = renderEn(
    props({ requirePlanApproval: false }, { byHand: true }),
  );
  assertNoHan(html);
  assert.doesNotMatch(html, /mission-team-size/);
  const approval = html.slice(html.lastIndexOf('<label class="mission-plan-option">'));
  assert.ok(approval.startsWith('<label class="mission-plan-option"><input type="checkbox" disabled="" checked=""/>'));
  assert.ok(
    approval.includes(
      "Let me approve the plan before development</strong><small>Always on in Learn by hand: you confirm your own plan before you write.</small>",
    ),
  );
  // The agent team keeps both, and the saved choice.
  const team = renderEn(props({ requirePlanApproval: false }));
  assert.match(team, /mission-team-size/);
  assert.ok(team.slice(team.lastIndexOf('<label class="mission-plan-option">')).startsWith('<label class="mission-plan-option"><input type="checkbox"/>'));
  assert.match(renderZh(props({}, { byHand: true })), /親手學一律開啟/);
});

test("agent access defaults to workspace and exposes the sudo controls only for explicit full access", () => {
  const normal = renderEn(props({}, { modelsOnly: true, demo: true }));
  assert.match(normal, /value="workspace" selected=""/);
  assert.doesNotMatch(normal, /Reading sudo status/);
  const full = renderEn(props({ agentAccess: "full" }, { modelsOnly: true, demo: true }));
  assert.match(full, /value="full" selected=""/);
  assert.match(full, /Passwordless sudo/);
  assert.match(full, /Read-only roles keep their restrictions/);
  assertNoHan(full);
});
