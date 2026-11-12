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
  for (const step of welcomeSteps) {
    const html = renderEn(welcome(step));
    // The language switcher names each language in itself.
    assertNoHan(withoutOtherLanguages(html));
    assert.match(html, /<h1 id="welcome-title">Welcome to BELL PR<\/h1>/);
    assert.match(html, /aria-current="step"/);
    assert.equal(html.match(/aria-current="step"/g)?.length, 1);
    const zh = renderZh(welcome(step));
    assert.match(zh, /歡迎使用 BELL PR/);
    assert.equal(zh.match(/aria-current="step"/g)?.length, 1);
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
  // A Claude Code release outside the supported versions only warns.
  const untested: DoctorReport = {
    ...claudeOnly,
    checks: claudeOnly.checks.map((value) =>
      value.id === "claude" ? { ...value, status: "warn", reason: "unsupported-version" } : value,
    ),
  };
  assert.deepEqual(readyProviders(untested), ["claude"]);
  const only = renderEn(welcome("provider"));
  assert.match(only, /<strong>Claude Code<\/strong>/);
  // Neutral wording about the person's own Claude Code sign-in.
  assert.match(only, /Uses the Claude Code CLI you installed and signed in to \(Claude plan or Anthropic API key\)\. Usage counts against your own account\./);
  assert.doesNotMatch(only, /subscription|API billing/i);
  const choice = renderEn(welcome("provider", { doctor: doctor(both) }));
  assert.match(choice, /<legend>More than one AI provider is ready\. Which one should your Agents use\?<\/legend>/);
  assert.equal(choice.match(/type="radio" name="welcome-provider"/g)?.length, 2);
  const empty = renderEn(welcome("provider", { doctor: doctor(none) }));
  assert.match(empty, /No AI provider is ready yet\./);
  assert.match(empty, />Check again</);
  const onlyCodex = report(base);
  const providerReady = onlyCodex.checks.find((check) => check.id === "provider-ready")!;
  providerReady.reason = "claude-only";
  providerReady.detail =
    "1.0.0 supports Claude Code only; Codex support is disabled.\nInstall Claude Code.";
  const blocked = renderEn(welcome("provider", { doctor: doctor(onlyCodex) }));
  assert.match(blocked, /1\.0\.0 supports Claude Code only; Codex support is disabled\./);
  assert.match(blocked, /Install Claude Code\./);
  assert.match(blocked, /See the <a[^>]*>Claude Code documentation<\/a> for other ways to install it\./);
  assert.doesNotMatch(blocked, /See the Codex CLI/);
  assert.doesNotMatch(blocked, /Antigravity documentation/);
  assert.doesNotMatch(blocked, /No AI provider is ready yet/);
  providerReady.detail = "1.0.0 只支援 Claude Code；Codex 已停用。\n請安裝 Claude Code。";
  const blockedZh = renderZh(welcome("provider", { doctor: doctor(onlyCodex) }));
  assert.match(blockedZh, /1\.0\.0 只支援 Claude Code；Codex 已停用。/);
  assert.match(blockedZh, /請安裝 Claude Code。/);
  const loading = renderEn(welcome("provider", { doctor: doctor(null) }));
  assert.match(loading, /Checking which AI providers are ready…/);
});

test("with no provider ready, Welcome shows how to install one", () => {
  const missing = {
    ...none,
    checks: none.checks.map((check) =>
      check.id === "provider-ready"
        ? {
            ...check,
            status: "fail" as const,
            reason: "none-ready",
            detail:
              "Install and sign in to the Codex CLI, Claude Code or the Antigravity CLI: BELL PR needs at least one.",
            fixes: [
              { label: "Install the Codex CLI", command: "npm install -g @openai/codex" },
              { label: "Sign in to Codex", command: "codex login" },
              { label: "Install Claude Code", command: "npm install -g @anthropic-ai/claude-code" },
              { label: "Sign in to Claude Code", command: "claude auth login" },
              {
                label: "Install the Antigravity CLI",
                command: "curl -fsSL https://antigravity.google/cli/install.sh | bash",
              },
              { label: "Start the Antigravity CLI once to sign in", command: "agy" },
            ],
          }
        : check,
    ),
  };
  const html = renderEn(welcome("provider", { doctor: doctor(missing) }));
  assertNoHan(html);
  assert.match(html, /<h1 id="welcome-title">Welcome to BELL PR<\/h1>/);
  assert.match(html, /No AI provider is ready yet\./);
  for (const command of [
    "npm install -g @openai/codex",
    "codex login",
    "npm install -g @anthropic-ai/claude-code",
    "claude auth login",
    "curl -fsSL https://antigravity.google/cli/install.sh | bash",
    "agy",
  ])
    assert.match(
      html,
      new RegExp(
        `<code class="welcome-command" tabindex="0" role="region" aria-label="Scroll the command: ${command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}">${command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</code>`,
      ),
      command,
    );
  assert.match(html, /href="https:\/\/github.com\/openai\/codex"/);
  assert.match(html, /See the <a[^>]*>Codex CLI<\/a> for other ways to install it\./);
  assert.match(html, /href="https:\/\/code\.claude\.com\/docs\/en\/overview"/);
  assert.match(html, /See the <a[^>]*>Claude Code documentation<\/a> for other ways to install it\./);
  assert.match(html, /href="https:\/\/antigravity.google\/docs"/);
  assert.match(html, /See the <a[^>]*>Antigravity documentation<\/a> for other ways to install it\./);
  const zh = renderZh(welcome("provider", { doctor: doctor(missing) }));
  assert.match(zh, /歡迎使用 BELL PR/);
  assert.match(
    zh,
    /<code class="welcome-command" tabindex="0" role="region" aria-label="左右捲動指令：npm install -g @openai\/codex">npm install -g @openai\/codex<\/code>/,
  );
  assert.match(zh, /其他安裝方式請見 <a[^>]*>Codex CLI<\/a>/);
  assert.match(zh, /href="https:\/\/github.com\/openai\/codex"/);
  assert.match(zh, /其他安裝方式請見 <a[^>]*>Claude Code 文件<\/a>/);
  assert.match(zh, /href="https:\/\/code\.claude\.com\/docs\/en\/overview"/);
  assert.match(zh, /其他安裝方式請見 <a[^>]*>Antigravity 文件<\/a>/);
  assert.match(zh, /href="https:\/\/antigravity.google\/docs"/);
});

test("a provider that is not ready shows only that provider's install link", () => {
  const chosen = {
    ...none,
    checks: none.checks.map((check) =>
      check.id === "provider-ready"
        ? {
            ...check,
            status: "fail" as const,
            reason: "chosen-not-ready",
            params: { provider: "claude" },
            fixes: [{ label: "Sign in to Claude Code", command: "claude auth login" }],
          }
        : check,
    ),
  };
  const html = renderEn(welcome("provider", { doctor: doctor(chosen) }));
  assert.match(html, /claude auth login/);
  assert.match(html, /Claude Code documentation/);
  assert.doesNotMatch(html, /See the Codex CLI/);
  assert.doesNotMatch(html, /Antigravity documentation/);
});

test("the last step offers the tour, an import and discovery, which waits for the GitHub CLI", () => {
  const html = renderEn(welcome("start"));
  assertNoHan(html);
  assert.match(html, /Take the 2-minute sample tour/);
  assert.match(html, /Import a project/);
  // Every contribution ends with the understanding check, and the setting can change it.
  assert.match(
    html,
    /Each contribution ends with you explaining the change back; turn that off in Settings → Learning\./,
  );
  assert.match(renderZh(welcome("start")), /每份貢獻最後都由你用自己的話講一遍；可在「設定 → 學習」關閉。/);
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
  assert.match(zh, /在 GitHub 上搜尋歡迎你這類協助的專案。/);
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
