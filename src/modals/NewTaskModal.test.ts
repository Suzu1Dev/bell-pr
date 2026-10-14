import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { defaultContributionSettings } from "../../shared/insights";
import { withoutElement } from "../app/test-markup";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import type { Repo } from "../types";
import { NewTaskModal } from "./NewTaskModal";

type Props = Parameters<typeof NewTaskModal>[0];

const repo: Repo = {
  id: "repo-1",
  name: "widgets",
  owner: "octo",
  fullName: "octo/widgets",
  path: "/tmp/widgets",
  defaultBranch: "main",
  url: "https://github.com/octo/widgets",
};

const element = (
  setup: Partial<Props["setup"]> = {},
  props: Partial<Omit<Props, "setup">> = {},
) =>
  createElement(NewTaskModal, {
      setup: {
        taskRepoId: repo.id,
        prompt: "",
        setPrompt() {},
        taskTitle: "",
        setTaskTitle() {},
        contributionSettings: { ...defaultContributionSettings },
        settingsLoading: false,
        settingsReady: true,
        configureTaskRepo: async () => {},
        changeContributionSettings() {},
        saveDirection: async () => {},
        ...setup,
      },
      repos: [repo],
      busy: false,
      formError: "",
      startTask() {},
      closeModal() {},
      openModal() {},
      navigate() {},
      setExploreRepoId() {},
      ...props,
    });

const render = (
  setup: Partial<Props["setup"]> = {},
  props: Partial<Omit<Props, "setup">> = {},
) => renderZh(element(setup, props));

// The direction settings inside the dialog belong to the mission panel,
// which is translated and tested in English on its own.
const ownMarkup = (html: string) =>
  withoutElement(html, 'class="direction-settings-container"');

const submit = (html: string) =>
  html.match(/<button class="button primary" type="submit"[^>]*>/)?.[0] ?? "";

test("the new-task dialog asks for the repository, the goal and the team settings", () => {
  const html = render();
  assert.match(html, /<h2 id="modal-title">把想法交給你的 Agent team。<\/h2>/);
  assert.match(html, /描述你想改善什麼，以及完成後應該有的行為。/);
  assert.match(html, /<option value="repo-1" selected="">octo\/widgets<\/option>/);
  assert.match(html, /<option value="demo-repo">openfetch-sample\/open-fetch（示範）<\/option>/);
  assert.match(html, /匯入其他專案/);
  assert.match(html, /先看 AI 推薦方向/);
  assert.match(html, /儲存為預設設定/);
  assert.match(html, /任務名稱 <span>選填<\/span>/);
  assert.match(html, /這次想完成什麼？/);
  assert.match(html, /<span>3 位 Teammates<\/span>/);
  assert.match(html, /會使用本機 Codex 帳號執行任務/);
  assert.doesNotMatch(html, /示範設定可以自由調整/);
});

test("the start button names what happens next and waits for a long enough goal", () => {
  const short = render({ prompt: "太短" });
  assert.match(short, />產生團隊計畫<\/button>/);
  assert.match(submit(short), /disabled=""/);

  const ready = render({ prompt: "為 widgets 加入逾時重試與測試" });
  assert.doesNotMatch(submit(ready), /disabled=""/);

  const direct = render({
    prompt: "為 widgets 加入逾時重試與測試",
    contributionSettings: {
      ...defaultContributionSettings,
      requirePlanApproval: false,
      provider: "claude",
    },
  });
  assert.match(direct, />啟動 Agent team<\/button>/);
  assert.match(direct, /會使用本機 Claude Code 帳號執行任務/);
});

test("the demo repository only saves a direction", () => {
  const html = render({ taskRepoId: "demo-repo" });
  assert.match(html, /示範設定可以自由調整；不會啟動真實 agent。/);
  assert.match(html, />儲存示範方向<\/button>/);
});

test("loading or failed settings keep the form locked and say why", () => {
  const loading = render({ settingsLoading: true, settingsReady: false });
  assert.match(loading, /正在載入這個專案的貢獻設定…/);
  assert.match(loading, /<fieldset class="direction-settings-container" disabled="">/);

  const failed = render({ settingsReady: false }, { formError: "讀取設定失敗" });
  assert.match(failed, />重新載入專案設定<\/button>/);
  assert.match(failed, /<p role="alert" class="inline-error">讀取設定失敗<\/p>/);
  assert.match(submit(failed), /disabled=""/);
});

test("the new-task dialog reads in English with no Chinese left", () => {
  const html = renderEn(element({ prompt: "Add timeout retries and tests to widgets" }));
  assert.match(html, /<h2 id="modal-title">Hand your idea to your agent team\.<\/h2>/);
  assert.match(html, /<option value="demo-repo">openfetch-sample\/open-fetch \(demo\)<\/option>/);
  assert.match(html, /Task name <span>Optional<\/span>/);
  assert.match(html, /<span>3 teammates<\/span>/);
  assert.match(html, /The task runs with the Codex CLI signed in on this computer/);
  assert.match(html, />Generate the team plan<\/button>/);
  assert.match(html, />Cancel<\/button>/);
  assertNoHan(ownMarkup(html));

  const demo = renderEn(element({ taskRepoId: "demo-repo" }));
  assert.match(demo, /Demo settings can be changed freely; no real agent starts\./);
  assert.match(demo, />Save demo direction<\/button>/);
  assertNoHan(ownMarkup(demo));

  const loading = renderEn(element({ settingsLoading: true, settingsReady: false }));
  assert.match(loading, /Loading this project&#x27;s contribution settings…/);
  assertNoHan(ownMarkup(loading));
  const failed = renderEn(element({ settingsReady: false }));
  assert.match(failed, />Reload project settings<\/button>/);
  assertNoHan(ownMarkup(failed));

  const solo = renderEn(
    element({
      contributionSettings: {
        ...defaultContributionSettings,
        maxTeammates: 2,
        requirePlanApproval: false,
        provider: "claude",
      },
    }),
  );
  assert.match(solo, /<span>2 teammates<\/span>/);
  assert.match(solo, /the Claude Code CLI signed in/);
  assert.match(solo, />Start the agent team<\/button>/);
});
