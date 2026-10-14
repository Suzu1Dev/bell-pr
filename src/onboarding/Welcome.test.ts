import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import type { DoctorCheck, DoctorCheckId, DoctorReport } from "../../shared/doctor";
import { eulaVersion } from "../../shared/product";
import { withoutOtherLanguages } from "../app/test-markup";
import type { DoctorState } from "../setup/useDoctor";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import {
  needsEulaAcceptance,
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

test("the license must be accepted again when its version changes", () => {
  assert.equal(needsEulaAcceptance(undefined), true);
  assert.equal(needsEulaAcceptance(null), true);
  assert.equal(needsEulaAcceptance({}), true);
  assert.equal(needsEulaAcceptance({ eulaAcceptedVersion: "draft-0" }), true);
  assert.equal(needsEulaAcceptance({ eulaAcceptedVersion: eulaVersion }), false);
});

test("every welcome step reads in English with no Chinese left, and in zh-TW", () => {
  assert.deepEqual([...welcomeSteps], ["language", "license", "environment", "provider", "start"]);
  for (const [position, step] of welcomeSteps.entries()) {
    const html = renderEn(welcome(step));
    // The language switcher names each language in itself.
    assertNoHan(withoutOtherLanguages(html));
    assert.match(html, /<h1 id="welcome-title">Welcome to BELL PR<\/h1>/);
    assert.match(html, new RegExp(`Step ${position + 1} of 5`));
    assert.equal(html.match(/aria-current="step"/g)?.length, 1);
    const zh = renderZh(welcome(step));
    assert.match(zh, /歡迎使用 BELL PR/);
    assert.match(zh, new RegExp(`第 ${position + 1} 步，共 5 步`));
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

test("the license step summarizes the agreement, links the full text and needs the box ticked", () => {
  const html = renderEn(welcome("license"));
  assert.match(html, /<a href="\/legal\/EULA\.txt" target="_blank" rel="noreferrer">Read the full agreement/);
  assert.match(html, new RegExp(`Agreement version ${eulaVersion}`));
  assert.match(html, /This summary is not the agreement\./);
  assert.match(html, /<input type="checkbox"\/><span>I accept the BELL PR End User License Agreement<\/span>/);
  assert.match(html, /<button type="button" class="button primary" disabled="">Accept and continue/);
  // Accepted before: ticked, and the button only continues.
  const accepted = renderEn(welcome("license", { settings: { eulaAcceptedVersion: eulaVersion } }));
  assert.match(accepted, new RegExp(`You accepted version ${eulaVersion} of the agreement\\.`));
  assert.match(accepted, /<input type="checkbox" checked=""\/>/);
  assert.match(accepted, /<button type="button" class="button primary">Continue/);
  // An older acceptance asks again.
  const older = renderEn(welcome("license", { settings: { eulaAcceptedVersion: "draft-0" } }));
  assert.match(older, /disabled="">Accept and continue/);
  const zh = renderZh(welcome("license"));
  assert.match(zh, /我接受 BELL PR 終端使用者授權合約/);
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
  assert.match(html, /Take the 2-minute sample tour/);
  assert.match(html, /Import a repository/);
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
