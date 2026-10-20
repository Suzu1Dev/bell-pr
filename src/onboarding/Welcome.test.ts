import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import type { DoctorCheck, DoctorCheckId, DoctorReport } from "../../shared/doctor";
import { withoutOtherLanguages } from "../app/test-markup";
import { setCheckSettingsForTests } from "../app/hooks/useUnderstanding";
import type { DoctorState } from "../setup/useDoctor";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import {
  providerUpdate,
  readyProviders,
  Welcome,
  welcomeSteps,
  type WelcomeProps,
  type WelcomeStep,
} from "./Welcome";

/** A report where the listed checks are ok and everything else is not used. */
function report(ok: DoctorCheckId[]): DoctorReport {
  const ids: DoctorCheckId[] = [
    "node", "git", "git-identity", "gh", "gh-auth", "gh-scopes", "codex", "codex-auth",
    "claude", "claude-auth", "claude-sandbox", "provider-ready", "data-dir", "app", "platform",
  ];
  const checks: DoctorCheck[] = ids.map((id) => ({
    id,
    required: ["node", "git", "provider-ready", "data-dir"].includes(id),
    status: ok.includes(id) ? "ok" : id === "provider-ready" ? "fail" : "skip",
  }));
  return {
    checks,
    ready: ok.includes("provider-ready"),
    checkedAt: "2026-10-14T09:30:00.000Z",
    platform: "linux",
  };
}

const base: DoctorCheckId[] = ["node", "git", "git-identity", "data-dir", "app", "platform"];
const claudeOnly = report([...base, "claude", "claude-auth", "provider-ready"]);
const both = report([...base, "codex", "codex-auth", "claude", "claude-auth", "provider-ready", "gh", "gh-auth", "gh-scopes"]);
const none = report(base);

const doctor = (value: DoctorReport | null): DoctorState => ({
  report: value,
  checking: false,
  error: "",
  refresh: async () => undefined,
});

const welcome = (step: WelcomeStep, props: Partial<WelcomeProps> = {}) =>
  createElement(Welcome, {
    onFinish: () => undefined,
    doctor: doctor(claudeOnly),
    initialStep: step,
    ...props,
  });

test("every welcome step reads in English with no Chinese left, and in zh-TW", () => {
  assert.deepEqual([...welcomeSteps], ["language", "environment", "provider", "start"]);
  for (const [position, step] of welcomeSteps.entries()) {
    const html = renderEn(welcome(step));
    // The language switcher names each language in itself.
    assertNoHan(withoutOtherLanguages(html));
    assert.match(html, /<h1 id="welcome-title">Welcome to BELL PR<\/h1>/);
    assert.match(html, new RegExp(`Step ${position + 1} of 4`));
    assert.equal(html.match(/aria-current="step"/g)?.length, 1);
    const zh = renderZh(welcome(step));
    assert.match(zh, /歡迎使用 BELL PR/);
    assert.match(zh, new RegExp(`第 ${position + 1} 步，共 4 步`));
  }
  // The first step has no way back; the others do.
  assert.doesNotMatch(renderEn(welcome("language")), />Back</);
  assert.match(renderEn(welcome("environment")), />Back</);
});

test("the language step offers the language switcher", () => {
  const html = renderEn(welcome("language"));
  assert.match(html, /<label for="welcome-language">Language<\/label><select id="welcome-language"/);
  assert.match(html, /<option value="zh-TW" lang="zh-Hant-TW">/);
});

test("the environment step shows the checklist with masked details", () => {
  const html = renderEn(
    welcome("environment", {
      doctor: doctor({
        ...none,
        checks: none.checks.map((value) =>
          value.id === "git-identity" ? { ...value, detail: "Octo <octo@example.com>" } : value,
        ),
      }),
      maskUser: () => "you",
    }),
  );
  assert.match(html, /class="setup-checklist"/);
  assert.match(html, /1 required item needs your attention\./);
  assert.doesNotMatch(html, /octo@example\.com/);
  assert.match(html, /You can continue now and fix the rest later in Settings\./);
});

test("the provider step picks the only ready provider and lets the person choose between two", () => {
  assert.deepEqual(readyProviders(claudeOnly), ["claude"]);
  assert.deepEqual(readyProviders(both), ["codex", "claude"]);
  assert.deepEqual(readyProviders(none), []);
  assert.deepEqual(readyProviders(null), []);
  const only = renderEn(welcome("provider"));
  assert.match(only, /Claude Code is installed and signed in, so your agents use it\./);
  // Neutral wording about the person's own Claude Code sign-in.
  assert.match(only, /Uses the Claude Code CLI you installed and signed in to \(Claude plan or Anthropic API key\)\. Usage counts against your own account\./);
  assert.doesNotMatch(only, /subscription|API billing/i);
  const choice = renderEn(welcome("provider", { doctor: doctor(both) }));
  assert.match(choice, /<legend>Both providers are ready\. Which one should your agents use\?<\/legend>/);
  assert.equal(choice.match(/type="radio" name="welcome-provider"/g)?.length, 2);
  const empty = renderEn(welcome("provider", { doctor: doctor(none) }));
  assert.match(empty, /No provider is ready yet\./);
  assert.match(empty, />Re-check</);
  const loading = renderEn(welcome("provider", { doctor: doctor(null) }));
  assert.match(loading, /Checking which providers are ready…/);
});

test("the last step offers the tour, an import and discovery, which waits for the GitHub CLI", () => {
  const html = renderEn(welcome("start"));
  assertNoHan(html);
  assert.match(html, /Take the 2-minute sample tour/);
  assert.match(html, /Import a repository/);
  // Every contribution ends with the understanding check, and the setting can change it.
  assert.match(
    html,
    /Every contribution ends with you explaining the change back; you can change that in Settings → Learning\./,
  );
  assert.match(renderZh(welcome("start")), /每一份貢獻最後都由你用自己的話講一遍；可在「設定 → 學習」調整。/);
  // While the variable keeps the check on, Settings can't change it, so Welcome doesn't say so.
  setCheckSettingsForTests({ settings: {}, lockedBy: { skipUnderstandingCheck: "BELLPR_REQUIRE_UNDERSTANDING_CHECK" } });
  try {
    const locked = renderEn(welcome("start"));
    assertNoHan(locked);
    assert.match(locked, /Every contribution ends with you explaining the change back\.</);
    assert.doesNotMatch(locked, /Settings → Learning/);
    assert.doesNotMatch(renderZh(welcome("start")), /設定 → 學習/);
  } finally {
    setCheckSettingsForTests(undefined);
  }
  assert.match(
    html,
    /<button type="button" class="welcome-choice" disabled="" aria-describedby="welcome-reason-discover">.*?Find a project to contribute to.*?<span id="welcome-reason-discover" class="welcome-choice-reason">Install and sign in to the GitHub CLI first\.<\/span>/,
  );
  assert.equal(html.match(/<button type="button" class="welcome-choice">/g)?.length, 2);
  // No Continue on the last step: choosing a path finishes.
  assert.doesNotMatch(html, />Continue</);
  const github = renderEn(welcome("start", { doctor: doctor(both) }));
  assert.equal(github.match(/<button type="button" class="welcome-choice">/g)?.length, 3);
  assert.doesNotMatch(github, /welcome-choice-reason/);
});

test("discovery is a plain choice that searches GitHub", () => {
  const html = renderEn(welcome("start", { doctor: doctor(both) }));
  assertNoHan(html);
  assert.match(
    html,
    /<span class="welcome-choice-text"><strong>Find a project to contribute to<\/strong><span>Search GitHub for projects that welcome the kind of help you want to give\.<\/span><\/span>/,
  );
  assert.doesNotMatch(html, /pro-badge|sample results|Upgrade|trial/i);
  const zh = renderZh(welcome("start", { doctor: doctor(both) }));
  assert.match(zh, /在 GitHub 上搜尋歡迎你提供這類協助的專案。/);
});

test("the provider is saved without losing a model chosen for it", () => {
  // Nothing saved yet (the doctor's default shows): save the choice.
  assert.deepEqual(providerUpdate({ provider: "claude", model: "", reasoningEffort: "" }, "claude"), {
    provider: "claude",
  });
  assert.deepEqual(providerUpdate({ model: "", reasoningEffort: "" }, "codex"), { provider: "codex" });
  // Saved choices for the same provider stay as they are.
  assert.equal(providerUpdate({ provider: "claude", model: "opus", reasoningEffort: "" }, "claude"), undefined);
  assert.equal(providerUpdate({ model: "", reasoningEffort: "high" }, "codex"), undefined);
  // Another provider starts with its own defaults.
  assert.deepEqual(
    providerUpdate({ provider: "codex", model: "gpt-x", reasoningEffort: "high", webAccess: true }, "claude"),
    { provider: "claude" },
  );
});
