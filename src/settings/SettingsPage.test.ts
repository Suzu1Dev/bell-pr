import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Status } from "../app/hooks/useAppData";
import { SettingsPage } from "./SettingsPage";

const render = (status: Status | null) =>
  renderToStaticMarkup(
    createElement(SettingsPage, {
      status,
      setStatus() {},
      setApiError() {},
      notify() {},
      configureContributionModels() {},
      setTab() {},
      navigate() {},
    }),
  );

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
  assert.match(html, /BELLPR_MAX_ACTIVE_RUNS）<\/span><code>2<\/code>/);
  assert.match(html, /BELLPR_MAX_AGENT_PROCESSES）<\/span><code>8<\/code>/);
  assert.match(html, /<code>20<\/code>/);
});
