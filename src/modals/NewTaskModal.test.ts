import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement } from "react";
import type { DoctorReport } from "../../shared/doctor";
import { defaultContributionSettings } from "../../shared/insights";
import { getDemo } from "../demo";
import { mount, type FakeElement } from "../mission/test-dom";
import type { DoctorState } from "../setup/useDoctor";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import type { Repo } from "../types";
import modals from "../i18n/en/modals";
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

const report = (provider: "ok" | "fail"): DoctorReport => ({
  checks: [
    { id: "git", status: "ok", required: true },
    {
      id: "provider-ready",
      status: provider,
      required: true,
      ...(provider === "fail"
        ? {
            detail: "No AI provider is installed and signed in.",
            fixes: [{ label: "Sign in to the Codex CLI", command: "codex login" }],
          }
        : {}),
    },
  ],
  ready: provider === "ok",
  checkedAt: "2026-10-14T09:00:00.000Z",
  platform: "linux",
});
const doctor = (value: DoctorReport | null, error = ""): DoctorState => ({
  report: value,
  checking: false,
  error,
  refresh: async () => undefined,
});

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
        preferredMode: undefined,
        runRequest: { current: {} },
        ...setup,
      },
      repos: [repo],
      busy: false,
      formError: "",
      async startTask() {},
      closeModal() {},
      openModal() {},
      navigate() {},
      setExploreRepoId() {},
      doctor: doctor(report("ok")),
      ...props,
    });

const render = (
  setup: Partial<Props["setup"]> = {},
  props: Partial<Omit<Props, "setup">> = {},
) => renderZh(element(setup, props));

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

test("the demo repository plays the sample team again instead of starting agents", () => {
  const html = render({ taskRepoId: "demo-repo" });
  assert.match(html, /示範設定可以自由調整；不會啟動真實 agent。示範團隊會從頭重新播放它的工作。/);
  assert.match(html, />播放示範團隊<\/button>/);
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
  assertNoHan(html);

  const demo = renderEn(element({ taskRepoId: "demo-repo" }));
  assert.match(demo, /Demo settings can be changed freely; no real agent starts\./);
  assert.match(demo, />Play the sample team<\/button>/);
  assertNoHan(demo);

  const loading = renderEn(element({ settingsLoading: true, settingsReady: false }));
  assert.match(loading, /Loading this project&#x27;s contribution settings…/);
  assertNoHan(loading);
  const failed = renderEn(element({ settingsReady: false }));
  assert.match(failed, />Reload project settings<\/button>/);
  assertNoHan(failed);

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

test("a run waits for a ready AI provider and shows the fix; the sample does not", () => {
  const prompt = "Add timeout retries and tests to widgets";
  const ready = renderEn(element({ prompt }));
  assert.doesNotMatch(ready, /readiness-notice/);
  assert.doesNotMatch(submit(ready), /disabled=""/);

  const unready = renderEn(element({ prompt }, { doctor: doctor(report("fail")) }));
  assert.match(unready, /<div class="readiness-notice" role="status">/);
  assert.match(unready, /This needs an AI provider: install and sign in to the Codex CLI or Claude Code\./);
  assert.match(unready, /<code>codex login<\/code>/);
  assert.match(submit(unready), /disabled=""/);
  assertNoHan(unready);

  // The sample project skips the readiness gate.
  const sample = renderEn(
    element({ prompt, taskRepoId: "demo-repo" }, { doctor: doctor(report("fail")) }),
  );
  assert.doesNotMatch(sample, /readiness-notice/);
  assert.doesNotMatch(submit(sample), /disabled=""/);

  // While the check runs the button waits; a check that cannot answer
  // leaves the decision to the server.
  const checking = renderEn(element({ prompt }, { doctor: doctor(null) }));
  assert.match(checking, /readiness-checking/);
  assert.match(submit(checking), /disabled=""/);
  const failed = renderEn(element({ prompt }, { doctor: doctor(null, "offline") }));
  assert.doesNotMatch(submit(failed), /disabled=""/);
});

test("a provider that is not ready is explained once, next to its picker", () => {
  const prompt = "Add timeout retries and tests to widgets";
  const base = report("fail");
  const codexFails: DoctorReport = {
    ...base,
    checks: [
      ...base.checks,
      {
        id: "codex",
        status: "fail",
        required: false,
        detail: "The Codex CLI exited with code 1.",
        fixes: [{ label: "Install the Codex CLI", command: "npm install -g @openai/codex" }],
      },
    ],
  };
  const html = renderEn(element({ prompt }, { doctor: doctor(codexFails) }));
  // DirectionSettings shares the shell's report and says what is wrong with
  // the chosen provider; the dialog adds no second notice, and still waits.
  assert.equal(html.match(/class="readiness-notice"/g)?.length, 1);
  assert.match(html, /The Codex CLI exited with code 1\./);
  assert.match(submit(html), /disabled=""/);
  assertNoHan(html);
  // The sample checks nothing, in the dialog or in the form.
  const sample = renderEn(
    element({ prompt, taskRepoId: "demo-repo" }, { doctor: doctor(codexFails) }),
  );
  assert.doesNotMatch(sample, /readiness-notice/);
});

test("under the request the dialog asks who writes the code; the sample shows the agent team only", () => {
  const html = renderEn(element({ prompt: "Retry failed requests with backoff." }));
  assertNoHan(html);
  const goal = html.indexOf('id="task-prompt"');
  const mode = html.indexOf("Who writes the code?");
  assert.ok(goal > 0 && mode > goal, "the choice comes after the request");
  assert.match(html, /<input type="radio" name="[^"]+-mode" checked=""\/><svg[\s\S]*?<strong>The agent team writes it<\/strong>/);
  // The team runs by default, so its preview and Start stay as they were.
  assert.ok(html.includes('class="task-team-preview"'));
  const sample = renderEn(element({ taskRepoId: getDemo("en").repo.id }));
  assert.ok(sample.includes("The sample shows the agent team. Learn by hand works on your own projects."));
  const hand = sample.match(/(<input type="radio"[^>]*-mode"[^>]*\/>)<svg(?:(?!<input)[\s\S])*?<strong>You write it/)?.[1];
  assert.match(hand ?? "", /disabled=""/);
});

/** Calls the handler React gave `element` (the fake DOM dispatches no events), without waiting for what it starts. */
const react = (element: FakeElement, name: "onClick" | "onSubmit") =>
  act(async () => {
    const props = Object.entries(element).find(([key]) => key.startsWith("__reactProps$"))?.[1] as Record<
      string,
      (event: { preventDefault(): void }) => unknown
    >;
    void props[name]({ preventDefault() {} });
  });

test("while the task is being started the dialog cannot be closed or left, so it can still open the run or show the error", async () => {
  let closed = 0;
  let finish = () => {};
  const props = (busy: boolean): Partial<Omit<Props, "setup">> => ({
    busy,
    closeModal: () => void closed++,
    startTask: () => new Promise<void>((resolve) => (finish = resolve)),
  });
  const setup = { prompt: "Retry GET requests on timeout" };
  const view = await mount(element(setup, props(false)));
  try {
    const find = (match: (element: FakeElement) => boolean) => view.container.querySelectorAll(match)[0]!;
    const button = (text: string) => find((element) => element.nodeName === "BUTTON" && element.textContent === text);
    // The close button, Escape and the backdrop all close through the Modal's onClose.
    const close = () => react(find((element) => element.getAttribute("class") === "icon-button modal-close"), "onClick");
    await react(find((element) => element.nodeName === "FORM"), "onSubmit");
    // AppShell is busy while the run is created, as it is for every request.
    await view.rerender(element(setup, props(true)));
    await close();
    assert.equal(closed, 0);
    // Import and Recommendations would leave the dialog too.
    for (const text of ["Cancel", modals.newTask.importOther, modals.newTask.recommendations])
      assert.ok(button(text).hasAttribute("disabled"), text);
    // A failed start leaves the dialog open, and then it closes again.
    await act(async () => finish());
    await view.rerender(element(setup, props(false)));
    assert.ok(!button("Cancel").hasAttribute("disabled"));
    await close();
    assert.equal(closed, 1);
  } finally {
    await view.unmount();
  }
});

test("another request that runs while the new-task dialog is open does not keep it from closing", async () => {
  let closed = 0;
  const view = await mount(element({}, { busy: true, closeModal: () => void closed++ }));
  try {
    const find = (match: (element: FakeElement) => boolean) => view.container.querySelectorAll(match)[0]!;
    const cancel = find((element) => element.nodeName === "BUTTON" && element.textContent === "Cancel");
    assert.ok(!cancel.hasAttribute("disabled"));
    await react(find((element) => element.getAttribute("class") === "icon-button modal-close"), "onClick");
    assert.equal(closed, 1);
  } finally {
    await view.unmount();
  }
});
