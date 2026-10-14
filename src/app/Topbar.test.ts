import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import type { DoctorCheck, DoctorReport } from "../../shared/doctor";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import { Toasts } from "./Toasts";
import { environmentReadiness, gitHubUrl, Topbar } from "./Topbar";

type Props = Parameters<typeof Topbar>[0];

const element = (props: Partial<Props> = {}) =>
  createElement(Topbar, {
    page: "workspace",
    busy: false,
    sidebarOpen: false,
    setSidebarOpen() {},
    sidebarCollapsed: false,
    setSidebarCollapsed() {},
    toggleCommandPalette() {},
    navigate() {},
    report: null,
    presenting: false,
    githubUser: "",
    ...props,
  });

const check = (
  id: DoctorCheck["id"],
  status: DoctorCheck["status"],
  required = false,
): DoctorCheck => ({ id, status, required });
const report = (...checks: DoctorCheck[]): DoctorReport => ({
  checks,
  ready: !checks.some((item) => item.required && item.status === "fail"),
  checkedAt: "2026-10-14T09:00:00.000Z",
  platform: "linux",
});
const ready = report(check("git", "ok", true), check("gh", "skip"));
const twoSteps = report(
  check("git", "ok", true),
  check("git-identity", "fail"),
  check("gh-auth", "warn"),
);
const broken = report(check("provider-ready", "fail", true), check("gh", "warn"));

test("the top bar reads in English with no Chinese left", () => {
  const html = renderEn(element({ report: ready }));
  assert.match(html, /<span class="breadcrumb-root">Workspace<\/span>/);
  assert.match(html, /<span class="breadcrumb-page">Workbench<\/span>/);
  assert.match(html, /aria-label="Switch projects and contributions"/);
  assert.match(html, /<span>Quick switch<\/span>/);
  assert.match(html, /<span class="readiness-text">Ready<\/span>/);
  assert.match(html, /aria-label="Collapse the sidebar"/);
  assertNoHan(html);
  for (const page of ["home", "repos", "explore", "discovery", "team", "learning", "settings"] as const)
    assertNoHan(renderEn(element({ page, sidebarCollapsed: true, report: broken })));
  assert.match(renderEn(element({ page: "settings" })), /<span class="breadcrumb-page">Settings<\/span>/);
  assert.match(renderEn(element({ page: "home" })), /<span class="breadcrumb-page">Home<\/span>/);
});

test("the top bar keeps its zh-TW page names", () => {
  const html = renderZh(element({ page: "explore", sidebarCollapsed: true }));
  assert.match(html, /<span class="breadcrumb-root">工作空間<\/span>/);
  assert.match(html, /<span class="breadcrumb-page">專案全貌<\/span>/);
  assert.match(html, /aria-label="展開左側選單"/);
  assert.match(renderZh(element({ report: twoSteps })), /<span class="readiness-text">2 個設定步驟<\/span>/);
});

test("readiness is ready, a number of setup steps, or not ready", () => {
  assert.equal(environmentReadiness(null), undefined);
  assert.deepEqual(environmentReadiness(ready), { state: "ready" });
  assert.deepEqual(environmentReadiness(twoSteps), { state: "steps", count: 2 });
  assert.deepEqual(environmentReadiness(broken), { state: "not-ready" });
});

test("the readiness pill links to the environment settings and hides while presenting", () => {
  assert.doesNotMatch(renderEn(element()), /readiness-pill/);
  const steps = renderEn(element({ report: twoSteps }));
  assert.match(
    steps,
    /<a class="readiness-pill readiness-steps" href="#\/settings\/environment" aria-label="Environment: 2 setup steps\. Open the environment settings\."/,
  );
  assert.match(steps, /<span class="readiness-text">2 setup steps<\/span>/);
  assert.match(renderEn(element({ report: broken })), /readiness-not-ready[^>]*>.*Not ready<\/span>/);
  assert.doesNotMatch(renderEn(element({ report: broken, presenting: true })), /readiness/);
});

test("the top bar links the open repository on GitHub with text, never a bare icon", () => {
  assert.doesNotMatch(renderEn(element()), /github\.com|Open on GitHub/);
  const html = renderEn(element({ repoUrl: "https://github.com/octo/widgets.git" }));
  assert.match(
    html,
    /<a class="topbar-repo-link" href="https:\/\/github\.com\/octo\/widgets" target="_blank" rel="noreferrer" aria-label="Open on GitHub" title="Open on GitHub"><svg[^]*?<span class="topbar-repo-text">Open on GitHub<\/span><\/a>/,
  );
  assert.equal(gitHubUrl("https://github.com/octo/widgets"), "https://github.com/octo/widgets");
  assert.equal(gitHubUrl("https://github.com/octo/widgets/"), "https://github.com/octo/widgets");
  for (const url of ["", undefined, "/home/me/widgets", "https://gitlab.com/octo/widgets", "https://github.com/octo", "https://github.com/octo/widgets/issues", "javascript:alert(1)"])
    assert.equal(gitHubUrl(url), undefined, String(url));
});

test("the avatar shows the GitHub user's initials, and an icon otherwise or while presenting", () => {
  assert.match(renderEn(element({ githubUser: "octo-cat" })), /aria-label="Profile settings">OC<\/button>/);
  assert.match(renderEn(element()), /aria-label="Profile settings"><svg/);
  assert.match(renderEn(element({ githubUser: "octo-cat", presenting: true })), /aria-label="Profile settings"><svg/);
});

test("a notice's close button reads in the UI language", () => {
  const toast = { message: "Saved", tone: "success" as const };
  const html = renderEn(createElement(Toasts, { toast, setToast() {} }));
  assert.match(html, /aria-label="Dismiss notification"/);
  assertNoHan(html);
  assert.match(
    renderZh(createElement(Toasts, { toast, setToast() {} })),
    /aria-label="關閉通知"/,
  );
});

test("notices are read from live regions that stay in the page", () => {
  const regions = (html: string) => [
    html.match(/<div class="visually-hidden" aria-live="polite" aria-atomic="true">([^<]*)<\/div>/)?.[1],
    html.match(/<div class="visually-hidden" aria-live="assertive" aria-atomic="true">([^<]*)<\/div>/)?.[1],
  ];
  const none = renderEn(createElement(Toasts, { toast: null, setToast() {} }));
  assert.deepEqual(regions(none), ["", ""]);
  assert.doesNotMatch(none, /class="toast/);

  const saved = renderEn(
    createElement(Toasts, { toast: { message: "Saved", tone: "success" }, setToast() {} }),
  );
  assert.deepEqual(regions(saved), ["Saved", ""]);
  // The visible notice carries no role of its own, so it is read once.
  assert.match(saved, /<div class="toast ">/);
  assert.doesNotMatch(saved, /role="(status|alert)"/);

  const failed = renderEn(
    createElement(Toasts, { toast: { message: "Push failed", tone: "error" }, setToast() {} }),
  );
  assert.deepEqual(regions(failed), ["", "Push failed"]);
  assert.match(failed, /<div class="toast toast-error">/);
});
