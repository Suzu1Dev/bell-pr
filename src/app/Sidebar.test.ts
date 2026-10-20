import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { getDemo } from "../demo";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import type { RunSummary } from "../types";
import { Sidebar } from "./Sidebar";
import { withoutOtherLanguages } from "./test-markup";

const demoRun = getDemo("zh-TW").run;

type Props = Parameters<typeof Sidebar>[0];

const element = (props: Partial<Props> = {}) =>
  createElement(Sidebar, {
      page: "workspace",
      runs: [],
      run: demoRun,
      status: null,
      showSample: true,
      presenting: false,
      maskUser: (value) => value,
      sidebarOpen: false,
      setSidebarOpen() {},
      navigate() {},
      openWorkbench() {},
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
  for (const label of ["首頁", "貢獻工作台", "Repositories", "探索貢獻", "Agent team", "學習筆記", "連線與設定", "使用指南"])
    assert.ok(html.includes(`<span>${label}</span>`), label);
  assert.match(html, /<nav aria-label="主要導覽">/);
  assert.match(html, /class="nav-item active" title="貢獻工作台" aria-current="page"/);
  assert.equal(html.match(/aria-current="page"/g)?.length, 1);
  // The learning notes are one item; no card below repeats the link.
  assert.doesNotMatch(html, /learning-card/);

  const learning = render({ page: "learning" });
  assert.match(learning, /class="nav-item active" title="學習筆記" aria-current="page"/);
  assert.doesNotMatch(learning, /class="nav-item active" title="貢獻工作台"/);
  // A repository's overview belongs to the repository list.
  assert.match(render({ page: "explore" }), /class="nav-item active" title="Repositories" aria-current="page"/);
  assert.match(render({ page: "home" }), /class="nav-item active" title="首頁" aria-current="page"/);
});

test("the workbench count leaves the sample out", () => {
  assert.doesNotMatch(render(), /nav-count/);
  const html = render({ runs: [summary("run-1", "修正登入逾時")] });
  assert.match(html, /<span>貢獻工作台<\/span><span class="nav-count">1<\/span>/);
});

test("recent contributions show the four newest runs, then the sample under its heading", () => {
  const runs = [
    summary("run-1", "修正登入逾時", "running"),
    summary("run-2", "補上重試測試"),
    summary("run-3", "整理錯誤訊息"),
    summary("run-4", "更新使用文件"),
    summary("run-5", "第五個任務"),
  ];
  const html = render({ runs, run: { ...demoRun, id: "run-2" } });
  assert.match(html, /<span class="nav-count">5<\/span>/);
  for (const run of runs.slice(0, 4)) assert.ok(html.includes(run.title), run.title);
  assert.ok(!html.includes("第五個任務"));
  assert.match(
    html,
    /更新使用文件<\/span><\/button><div class="recent-sample-heading">範例<\/div><button class="recent-item "><span class="small-status "><\/span><span>SDK 智慧重試機制<\/span><\/button>/,
  );
  assert.match(html, /class="recent-item selected"><span class="small-status "><\/span><span>補上重試測試/);
  assert.match(html, /<span class="small-status running"><\/span><span>修正登入逾時/);
  assert.match(html, /查看全部貢獻/);

  const hidden = render({ runs, showSample: false });
  assert.doesNotMatch(hidden, /recent-sample-heading|SDK 智慧重試機制/);
});

test("the brand is the logo, without plan or placeholder chips", () => {
  const html = renderEn(element());
  assert.match(html, /<a href="#\/home" class="brand" aria-label="BELL PR home"><svg class="brand-wordmark"[^>]*aria-hidden="true"/);
  assert.doesNotMatch(html, /sidebar-plan|plan-chip|beta-chip|workspace-switch|Personal workspace|tiny-new|>NEW<|brand-symbol/);
});

test("discovery is an ordinary item, without a badge", () => {
  assert.match(
    renderEn(element()),
    /title="Explore contributions"><svg[^]*?<span>Explore contributions<\/span><\/button>/,
  );
  assert.doesNotMatch(renderEn(element()), /pro-badge|PRO/);
});

test("the profile shows the GitHub user's initials, and only an icon while presenting", () => {
  assert.match(render(), /<span class="profile-avatar" aria-hidden="true"><svg/);
  assert.match(render(), /<strong>My workspace<\/strong>/);
  const status = { codex: true, github: true, githubUser: "octo-cat" };
  const html = render({ status });
  assert.match(html, /<span class="profile-avatar" aria-hidden="true">OC<\/span>/);
  assert.match(html, /<strong>octo-cat<\/strong>/);
  assert.match(html, /本機工作空間/);
  const presenting = renderEn(
    element({ status, presenting: true, maskUser: (value) => (value ? "you" : value) }),
  );
  assert.match(presenting, /<span class="profile-avatar" aria-hidden="true"><svg/);
  assert.match(presenting, /<strong>you<\/strong>/);
  assert.doesNotMatch(presenting, /octo|OC</);
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
  for (const label of ["Home", "Workbench", "Repositories", "Explore contributions", "Agent team", "Learning notes", "Settings", "User guide", "About BELL PR"])
    assert.ok(html.includes(`<span>${label}</span>`), label);
  assert.match(html, /<nav aria-label="Main navigation">/);
  assert.match(html, /<div class="recent-sample-heading">Sample<\/div><button class="recent-item selected"><span class="small-status "><\/span><span>SDK smart retries<\/span>/);
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

test("a learn-by-hand run is marked in the recent list", () => {
  const html = renderEn(element({ runs: [{ ...summary("run-2", "Cap the retries"), learnByHand: true }, summary("run-3", "Add a cache")] }));
  assertNoHan(withoutOtherLanguages(html));
  assert.match(html, /<span>Cap the retries<\/span><span title="Learn by hand"><svg[^>]*lucide-hand[\s\S]*?<\/svg><span class="visually-hidden">Learn by hand<\/span><\/span>/);
  assert.equal(html.match(/title="Learn by hand"/g)?.length, 1);
});
