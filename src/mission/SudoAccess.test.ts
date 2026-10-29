import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderZh } from "../test-utils/render";
import type { SudoStatus } from "../../shared/sudo";
import { SudoAccessView, type SudoAccessViewProps } from "./SudoAccess";

const needsPassword: SudoStatus = { user: "bellsvc", available: true, installed: false, passwordless: false };

const render = (overrides: Partial<SudoAccessViewProps> = {}) =>
  renderZh(
    createElement(SudoAccessView, {
      id: "dir",
      status: needsPassword,
      password: "",
      busy: false,
      onPasswordChange: () => {},
      onEnable: () => {},
      onDisable: () => {},
      ...overrides,
    }),
  );

test("when sudo needs a password, the panel asks for it once and the enable button waits for input", () => {
  const empty = render();
  assert.match(empty, /<input id="dir-sudo-password" type="password"/);
  assert.match(empty, /<button[^>]*disabled[^>]*>啟用免密碼 sudo<\/button>/);
  assert.doesNotMatch(empty, /移除 BELL PR 的 sudo 規則/);
  assert.match(empty, /不會被儲存或寫入記錄/);
  assert.match(empty, /TODO\(B38 disclosure\): 免密碼 sudo 說明尚未定稿。/);

  const typed = render({ password: "typed" });
  assert.doesNotMatch(typed, /<button[^>]*disabled[^>]*>啟用免密碼 sudo<\/button>/);
  assert.match(typed, /<button[^>]*>啟用免密碼 sudo<\/button>/);
});

test("when BELL's own rule is active, the panel offers removal and no password field", () => {
  const html = render({ status: { ...needsPassword, installed: true, passwordless: true } });
  assert.doesNotMatch(html, /type="password"/);
  assert.match(html, /這是 BELL PR 建立的規則，可在這裡移除/);
  assert.match(html, /移除 BELL PR 的 sudo 規則/);
});

test("when sudo is passwordless through another rule, the panel says BELL will not remove it", () => {
  const html = render({ status: { ...needsPassword, passwordless: true } });
  assert.doesNotMatch(html, /type="password"/);
  assert.doesNotMatch(html, /移除 BELL PR 的 sudo 規則/);
  assert.match(html, /規則不是 BELL PR 建立的，BELL PR 不會移除它/);
});

test("a machine without sudo, a failed status read, and a refused change each say what happened", () => {
  assert.match(render({ status: { ...needsPassword, available: false } }), /這台機器沒有 sudo 指令/);
  assert.match(render({ status: undefined, loadError: "連線失敗" }), /無法讀取 sudo 狀態：連線失敗/);
  const refused = render({ error: "密碼不正確；再輸錯 2 次會暫停 15 分鐘。" });
  assert.match(refused, /role="alert"[^>]*>密碼不正確；再輸錯 2 次會暫停 15 分鐘。/);
});
