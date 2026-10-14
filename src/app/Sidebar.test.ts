import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { demoRun } from "../demo";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import type { RunSummary } from "../types";
import { Sidebar } from "./Sidebar";
import { withoutOtherLanguages } from "./test-markup";

type Props = Parameters<typeof Sidebar>[0];

const element = (props: Partial<Props> = {}) =>
  createElement(Sidebar, {
      page: "workspace",
      runs: [],
      run: demoRun,
      status: null,
      sidebarOpen: false,
      setSidebarOpen() {},
      navigate() {},
      openModal() {},
      beginContribution() {},
      async chooseRun() {
        return true;
      },
      ...props,
    });

const render = (props: Partial<Props> = {}) => renderZh(element(props));

const summary = (id: string, title: string, status: RunSummary["status"] = "review") =>
  ({ ...demoRun, id, title, status }) as RunSummary;

test("the sidebar lists every page and marks the open one", () => {
  const html = render();
  for (const label of ["貢獻工作台", "Repositories", "探索貢獻", "Agent team", "學習筆記", "連線與設定", "使用指南"])
    assert.ok(html.includes(`<span>${label}</span>`), label);
  assert.match(html, /<nav aria-label="主要導覽">/);
  assert.match(html, /class="nav-item active" title="貢獻工作台"/);
  // The workspace count includes the demo run.
  assert.match(html, /<span class="nav-count">1<\/span>/);
  assert.match(html, /每一次貢獻，都有所收穫。/);

  const learning = render({ page: "learning" });
  assert.match(learning, /class="nav-item active" title="學習筆記"/);
  assert.doesNotMatch(learning, /class="nav-item active" title="貢獻工作台"/);
});

test("recent contributions show the four newest runs and the demo", () => {
  const runs = [
    summary("run-1", "修正登入逾時", "running"),
    summary("run-2", "補上重試測試"),
    summary("run-3", "整理錯誤訊息"),
    summary("run-4", "更新使用文件"),
    summary("run-5", "第五個任務"),
  ];
  const html = render({ runs, run: { ...demoRun, id: "run-2" } });
  assert.match(html, /<span class="nav-count">6<\/span>/);
  for (const run of runs.slice(0, 4)) assert.ok(html.includes(run.title), run.title);
  assert.ok(!html.includes("第五個任務"));
  assert.match(html, /<span>SDK 智慧重試機制<\/span><span class="demo-small">範例<\/span>/);
  assert.match(html, /class="recent-item selected"><span class="small-status "><\/span><span>補上重試測試/);
  assert.match(html, /<span class="small-status running"><\/span><span>修正登入逾時/);
  assert.match(html, /查看全部貢獻/);
});

test("the profile names the signed-in GitHub user or the local workspace", () => {
  assert.match(render(), /<strong>My workspace<\/strong>/);
  const html = render({ status: { codex: true, github: true, githubUser: "octo" } });
  assert.match(html, /<strong>octo<\/strong>/);
  assert.match(html, /本機工作空間/);
});

test("the narrow-screen drawer adds a scrim that closes it", () => {
  assert.doesNotMatch(render(), /關閉導覽/);
  const html = render({ sidebarOpen: true });
  assert.match(html, /<button class="sidebar-scrim" aria-label="關閉導覽"><\/button>/);
  assert.match(html, /class="sidebar sidebar-open"/);
});

test("the sidebar reads in English with no Chinese left", () => {
  const html = renderEn(
    element({
      runs: [summary("run-1", "Fix the login timeout", "running")],
      status: { codex: true, github: true },
      sidebarOpen: true,
    }),
  );
  for (const label of ["Workbench", "Repositories", "Discover", "Agent team", "Learning notes", "Settings", "User guide"])
    assert.ok(html.includes(`<span>${label}</span>`), label);
  assert.match(html, /<nav aria-label="Main navigation">/);
  assert.match(html, /<span>SDK smart retries<\/span><span class="demo-small">Sample<\/span>/);
  assert.match(html, /Every contribution teaches you something\./);
  assert.match(html, /<strong>My workspace<\/strong>/);
  assert.match(html, /aria-label="Close navigation"/);
  assertNoHan(withoutOtherLanguages(html));
});

test("the sidebar footer offers the language switcher", () => {
  const html = renderEn(element());
  assert.match(
    html,
    /<div class="sidebar-language">.*<select class="sidebar-language-select" aria-label="Language">/,
  );
  assert.match(html, /<option value="en" lang="en" selected="">English<\/option>/);
  assert.match(html, /<option value="zh-TW" lang="zh-Hant-TW">/);
  const chinese = renderZh(element());
  assert.match(chinese, /<select class="sidebar-language-select" aria-label="語言">/);
  assert.match(chinese, /<option value="zh-TW" lang="zh-Hant-TW" selected="">/);
});
