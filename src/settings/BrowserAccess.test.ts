import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { act, createElement } from "react";
import { mount, type FakeElement } from "../mission/test-dom";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import { BrowserAccess } from "./BrowserAccess";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function stubSession() {
  const calls: { url: string; method: string; body: unknown }[] = [];
  let remembered = false;
  let fail = false;
  globalThis.fetch = async (input, options) => {
    const method = options?.method ?? "GET";
    const body: unknown = options?.body ? JSON.parse(String(options.body)) : undefined;
    calls.push({ url: String(input), method, body });
    if (fail)
      return new Response(JSON.stringify({ error: "Please try again." }), { status: 503 });
    if (method === "DELETE" || String(input).endsWith("/revoke"))
      return new Response(null, { status: 204 });
    if (method === "POST") remembered = (body as { remember: boolean }).remember;
    return new Response(JSON.stringify({ remembered }), {
      headers: { "Content-Type": "application/json" },
    });
  };
  return { calls, fail: (value: boolean) => { fail = value; } };
}

function props(element: FakeElement) {
  return Object.entries(element).find(([name]) => name.startsWith("__reactProps$"))?.[1] as {
    onClick(): void;
    onChange(event: { target: { checked: boolean } }): void;
  };
}

const click = (element: FakeElement) => act(async () => props(element).onClick());

test("browser access starts with remembering off, and has both localized access actions", () => {
  const html = renderEn(createElement(BrowserAccess));
  assertNoHan(html);
  assert.match(html, /Remember this browser for 30 days/);
  assert.match(html, /type="checkbox" disabled=""/);
  assert.doesNotMatch(html, /checked=""/);
  assert.match(html, /Sign out this browser/);
  assert.match(html, /Revoke all access…/);
  assert.doesNotMatch(html, /role="dialog"/);
  const zh = renderZh(createElement(BrowserAccess));
  assert.match(zh, /記住這個瀏覽器 30 天/);
  assert.match(zh, /登出這個瀏覽器/);
  assert.match(zh, /撤銷所有存取權限…/);
});

test("remember saves the browser choice and a failed update keeps its last saved value", async () => {
  const session = stubSession();
  const view = await mount(createElement(BrowserAccess));
  try {
    const checkbox = view.container.querySelectorAll((element) => element.nodeName === "INPUT")[0];
    assert.equal(checkbox.checked, false);
    assert.equal(checkbox.hasAttribute("disabled"), false);
    await act(async () => props(checkbox).onChange({ target: { checked: true } }));
    assert.equal(checkbox.checked, true);
    assert.deepEqual(session.calls.at(-1), {
      url: "/api/session", method: "POST", body: { remember: true },
    });
    assert.match(view.text(), /Saved\./);
    session.fail(true);
    await act(async () => props(checkbox).onChange({ target: { checked: false } }));
    assert.equal(checkbox.checked, true);
    assert.match(view.text(), /Please try again\./);
    assert.doesNotMatch(view.text(), /Saved\./);
  } finally {
    await view.unmount();
  }
});

test("revoking requires confirmation, cancelling restores focus, and only success signs out", async () => {
  const session = stubSession();
  let reloads = 0;
  const view = await mount(createElement(BrowserAccess, { reload: () => { reloads++; } }));
  try {
    const button = (label: string) => view.container.querySelectorAll(
      (element) => element.nodeName === "BUTTON" && element.textContent === label,
    )[0];
    const revoke = button("Revoke all access…");
    revoke.focus();
    await click(revoke);
    assert.match(view.text(), /Every browser, including this one, will be signed out/);
    assert.match(view.text(), /All existing login links and API tokens will stop working/);
    assert.match(view.text(), /Run bell-pr open on the host/);
    assert.match(view.text(), /does not stop running tasks/);
    const actions = view.container.querySelectorAll((element) => element.nodeName === "BUTTON");
    assert.ok(actions.indexOf(button("Cancel")) < actions.indexOf(button("Revoke all access and sign out")));
    await click(button("Cancel"));
    assert.equal(revoke.ownerDocument?.activeElement, revoke);
    assert.equal(session.calls.length, 1);
    assert.equal(reloads, 0);

    session.fail(true);
    await click(button("Sign out this browser"));
    assert.equal(session.calls.at(-1)?.method, "DELETE");
    assert.equal(reloads, 0);
    assert.match(view.text(), /Please try again\./);

    session.fail(false);
    await click(revoke);
    await click(button("Revoke all access and sign out"));
    assert.deepEqual(session.calls.at(-1), { url: "/api/session/revoke", method: "POST", body: {} });
    assert.equal(reloads, 1);
  } finally {
    await view.unmount();
  }
});
