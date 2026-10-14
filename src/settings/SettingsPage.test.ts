import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import type { Status } from "../app/hooks/useAppData";
import { withoutOtherLanguages } from "../app/test-markup";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import { SettingsPage } from "./SettingsPage";

const element = (status: Status | null) =>
  createElement(SettingsPage, {
      status,
      setStatus() {},
      setApiError() {},
      notify() {},
      configureContributionModels() {},
      setTab() {},
      navigate() {},
    });

const render = (status: Status | null) => renderZh(element(status));

const serviceStatus = (html: string, name: string) =>
  html.match(
    new RegExp(`<h3>${name}</h3>.*?<span class="service-status[^"]*">([^<]+)</span>`),
  )?.[1];

test("the settings page lists the connections and the commands that set them up", () => {
  const html = render(null);
  assert.match(html, /<h1 tabindex="-1">讓工作環境準備就緒。<\/h1>/);
  assert.match(html, />重新檢查連線<\/button>/);
  assert.match(html, />設定貢獻模型<\/button>/);
  assert.match(html, />查看目前任務模型<\/button>/);
  for (const command of ["codex login", "claude auth login", "gh auth login"])
    assert.ok(html.includes(`<code>${command}</code>`), command);
});

test("without a status yet every CLI reads as missing and the limits as unknown", () => {
  const html = render(null);
  assert.equal(serviceStatus(html, "Codex CLI"), "尚未安裝");
  assert.equal(serviceStatus(html, "Claude Code CLI"), "尚未安裝");
  assert.equal(serviceStatus(html, "GitHub CLI"), "尚未登入");
  assert.match(html, /匯入專案、推送分支與建立 Draft PR/);
  assert.equal(html.match(/<code>—<\/code>/g)?.length, 3);
});

test("a reported status shows each CLI's state, the GitHub user and the limits", () => {
  const html = render({
    codex: true,
    codexAuthenticated: true,
    claude: true,
    claudeAuthenticated: false,
    github: true,
    githubUser: "octo",
    limits: { maxActiveRuns: 2, maxAgentProcesses: 8, maxQueued: 20 },
  });
  assert.equal(serviceStatus(html, "Codex CLI"), "已就緒");
  assert.equal(serviceStatus(html, "Claude Code CLI"), "尚未登入");
  assert.equal(serviceStatus(html, "GitHub CLI"), "已連線");
  assert.match(html, /以 octo 連線/);
  // The limits show by name; the variables that set them are under Advanced.
  assert.match(html, /同時執行的工作上限<\/span><code>2<\/code>/);
  assert.match(html, /Agent CLI 行程上限<\/span><code>8<\/code>/);
  assert.match(html, /<code>20<\/code>/);
});

const status: Status = {
  codex: true,
  codexAuthenticated: true,
  claude: true,
  claudeAuthenticated: false,
  github: true,
  githubUser: "octo",
  limits: { maxActiveRuns: 2, maxAgentProcesses: 8, maxQueued: 20 },
};

test("the settings page reads in English with no Chinese left", () => {
  for (const value of [null, status]) {
    const html = renderEn(element(value));
    assert.match(html, /<h1 tabindex="-1">Get your workspace ready\.<\/h1>/);
    assertNoHan(withoutOtherLanguages(html));
  }
  const html = renderEn(element(status));
  assert.equal(serviceStatus(html, "Codex CLI"), "Ready");
  assert.equal(serviceStatus(html, "Claude Code CLI"), "Not signed in");
  assert.equal(serviceStatus(html, "GitHub CLI"), "Connected");
  assert.match(html, /Connected as octo/);
  assert.match(html, /Runs at the same time<\/span><code>2<\/code>/);
});

test("the Claude Code copy is neutral about the person's plan and account", () => {
  const html = renderEn(element(status));
  assert.ok(
    html.includes(
      "Uses the Claude Code CLI you installed and signed in to (Claude plan or Anthropic API key). Usage counts against your own account.",
    ),
  );
  assert.ok(
    html.includes(
      "Running many agents at once uses your provider account faster. Heavy parallel use of a personal plan may exceed its intended individual use.",
    ),
  );
  // The retired plan and billing wording (in English and zh-TW) and the old
  // service-manager path, spelled with escapes so that a search of the
  // source for that wording comes back empty.
  const retired = [
    /sub\u0073cription|\u8a02\u95b1/i,
    /API\u0020billing|API \u8a08\u8cbb/i,
    /system\u0064|\.config\/bell-pr/,
  ];
  for (const locale of [html, render(status)])
    for (const pattern of retired) assert.doesNotMatch(locale, pattern);
  // The patterns do catch the old copy.
  assert.match("Claude \u8a02\u95b1", retired[0]);
  assert.match("Sub\u0073cription, not API\u0020billing", retired[1]);
});

test("the General card switches the language and the variables sit under Advanced", () => {
  const html = renderEn(element(status));
  assert.match(
    html,
    /<h3>General<\/h3>.*<label for="settings-language">Language<\/label><select id="settings-language" class="settings-language-select" aria-label="Language">/,
  );
  const advanced = html.match(/<details class="settings-advanced">.*?<\/details>/)?.[0] ?? "";
  assert.match(advanced, /<summary>Advanced: environment variables<\/summary>/);
  assert.match(advanced, /Set environment variables and restart BELL PR\. See the documentation\./);
  assert.match(advanced, /<code>BELLPR_MAX_ACTIVE_RUNS<\/code><\/dt><dd>Runs at the same time<\/dd>/);
  assert.match(advanced, /<code>BELLPR_MAX_AGENT_PROCESSES<\/code><\/dt><dd>Agent CLI processes<\/dd>/);
  // The variable names appear nowhere else on the page.
  assert.equal(html.match(/BELLPR_MAX_/g)?.length, 2);
  // No documentation link while the product has no docs URL.
  assert.doesNotMatch(advanced, /<a /);
});
