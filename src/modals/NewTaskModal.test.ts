import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultContributionSettings } from "../../shared/insights";
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

const render = (
  setup: Partial<Props["setup"]> = {},
  props: Partial<Omit<Props, "setup">> = {},
) =>
  renderToStaticMarkup(
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
    }),
  );

const submit = (html: string) =>
  html.match(/<button class="button primary" type="submit"[^>]*>/)?.[0] ?? "";

test("the new-task dialog asks for the repository, the goal and the team settings", () => {
  const html = render();
  assert.match(html, /<h2 id="modal-title">把想法交給你的 Agent team。<\/h2>/);
  assert.match(html, /描述你想改善什麼，以及完成後應該有的行為。/);
  assert.match(html, /<option value="repo-1" selected="">octo\/widgets<\/option>/);
  assert.match(html, /<option value="demo-repo">acme-labs\/open-fetch（示範）<\/option>/);
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
