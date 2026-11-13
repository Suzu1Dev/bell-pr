import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderEn, renderZh } from "../test-utils/render";
import type { SudoStatus } from "../../shared/sudo";
import { sudoTtlChoices, SudoAccessView, type SudoAccessViewProps } from "./SudoAccess";

const needsPassword: SudoStatus = { user: "bellsvc", available: true, installed: false, passwordless: false };

const render = (overrides: Partial<SudoAccessViewProps> = {}) =>
  renderZh(
    createElement(SudoAccessView, {
      id: "dir",
      status: needsPassword,
      password: "",
      ttlSeconds: 3600,
      busy: false,
      onPasswordChange: () => {},
      onTtlChange: () => {},
      onEnable: () => {},
      onDisable: () => {},
      ...overrides,
    }),
  );

test("when sudo needs a password, the panel asks for it and the enable button waits for input", () => {
  const empty = render();
  assert.match(empty, /<input id="dir-sudo-password" type="password"/);
  assert.match(empty, /<button[^>]*disabled[^>]*>啟用免密碼 sudo<\/button>/);
  assert.doesNotMatch(empty, /移除 BELL PR 的 sudo 規則/);
  assert.match(empty, /不會被儲存或寫入記錄/);
  assert.match(empty, /「免密碼 sudo」（僅 Linux）預設關閉/);

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
  assert.match(render({ status: { ...needsPassword, available: false } }), /這台電腦沒有 sudo 指令/);
  assert.match(render({ status: undefined, loadError: "連線失敗" }), /無法讀取 sudo 狀態：連線失敗/);
  const refused = render({ error: "密碼不正確；再輸錯 2 次會暫停 15 分鐘。" });
  assert.match(refused, /role="alert"[^>]*>密碼不正確；再輸錯 2 次會暫停 15 分鐘。/);
});

test("each enable asks for the password and a duration from 15 minutes to 8 hours, one hour by default, never permanent", () => {
  assert.deepEqual(sudoTtlChoices, [900, 1800, 3600, 7200, 14_400, 28_800]);
  const html = render();
  assert.match(html, /<label for="dir-sudo-ttl">自動關閉時間<\/label>/);
  assert.match(html, /<option value="3600" selected="">1 小時<\/option>/);
  assert.match(html, /<option value="900">15 分鐘<\/option>/);
  assert.match(html, /<option value="28800">8 小時<\/option>/);
  assert.doesNotMatch(html, /永久/);
  assert.match(html, /每次啟用都要輸入密碼/);
  const en = renderEn(
    createElement(SudoAccessView, {
      id: "dir",
      status: needsPassword,
      password: "",
      ttlSeconds: 7200,
      busy: false,
      onPasswordChange: () => {},
      onTtlChange: () => {},
      onEnable: () => {},
      onDisable: () => {},
    }),
  );
  assert.match(en, /<option value="7200" selected="">2 hours<\/option>/);
  assert.match(en, /<option value="1800">30 minutes<\/option>/);
  assert.match(en, /Enter the password each time/);
  assert.doesNotMatch(en, /permanent/i);
});

test("an enabled rule shows when it turns off", () => {
  const html = render({
    status: { ...needsPassword, installed: true, passwordless: true, expiresAt: "2026-11-04T11:00:00.000Z" },
  });
  assert.match(html, /將於 .+ 關閉。/);
});
