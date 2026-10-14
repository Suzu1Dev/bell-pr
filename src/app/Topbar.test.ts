import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import { Toasts } from "./Toasts";
import { Topbar } from "./Topbar";

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
    ...props,
  });

test("the top bar reads in English with no Chinese left", () => {
  const html = renderEn(element());
  assert.match(html, /<span class="breadcrumb-root">Workspace<\/span>/);
  assert.match(html, /<span>Workbench<\/span>/);
  assert.match(html, /aria-label="Switch projects and contributions"/);
  assert.match(html, /<span>Quick switch<\/span>/);
  assert.match(html, /Local-first/);
  assert.match(html, /aria-label="Collapse the sidebar"/);
  assertNoHan(html);
  for (const page of ["repos", "explore", "discovery", "team", "learning", "settings"] as const)
    assertNoHan(renderEn(element({ page, sidebarCollapsed: true })));
  assert.match(renderEn(element({ page: "settings" })), /<span>Settings<\/span>/);
});

test("the top bar keeps its zh-TW page names", () => {
  const html = renderZh(element({ page: "explore", sidebarCollapsed: true }));
  assert.match(html, /<span class="breadcrumb-root">工作空間<\/span>/);
  assert.match(html, /<span>專案全貌<\/span>/);
  assert.match(html, /aria-label="展開左側選單"/);
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
