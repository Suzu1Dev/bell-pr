import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderEn, renderZh } from "./test-utils/render";
import { PairPage, takePairCode } from "./PairPage";

test("QR code is consumed and the hash stripped immediately", () => {
  let replaced: unknown;
  const win = {
    location: { hash: "#code=TEST-CODE", search: "", pathname: "/pair" },
    history: { state: null, replaceState: (_state: unknown, _title: string, url: unknown) => { replaced = url; } },
  };
  assert.equal(takePairCode(win as unknown as Pick<Window, "location" | "history">), "TEST-CODE");
  assert.equal(replaced, "/pair");
});

test("query code is ignored", () => {
  const win = {
    location: { hash: "", search: "?code=TEST-CODE", pathname: "/pair" },
    history: { state: null, replaceState() {} },
  };
  assert.equal(takePairCode(win as unknown as Pick<Window, "location" | "history">), "");
});

test("pair form has localized labels and host instructions", () => {
  const html = renderEn(createElement(PairPage, { initialCode: "TEST-CODE" }));
  assert.match(html, /bell-pr pair/);
  assert.match(html, /value="TEST-CODE"/);
  assert.match(html, /for="pair-code"/);
  assert.match(renderZh(createElement(PairPage)), /配對碼/);
});

test("pair form handles contract failures, then stores a successful device credential", async () => {
  const { act } = await import("react");
  const { mount } = await import("./mission/test-dom");
  const realFetch = globalThis.fetch;
  const oldLocal = globalThis.localStorage;
  const stored = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => { stored.set(key, value); },
    removeItem: (key) => { stored.delete(key); },
    clear: () => stored.clear(), key: () => null, length: 0,
  };
  let hashCleared = false;
  let status = 401;
  globalThis.fetch = async (_url, options) => {
    assert.equal(new Headers(options?.headers).get("Authorization"), null);
    assert.equal(options?.credentials, "omit");
    assert.equal(hashCleared, true);
    assert.deepEqual(JSON.parse(String(options?.body)), { code: "TEST-CODE" });
    return new Response(JSON.stringify(status === 201
      ? { deviceId: "self", name: "Test phone", token: "bpd_" + "0".repeat(64) }
      : { error: "invalid_code", lockedUntil: new Date(Date.now() + 60_000).toISOString() }), { status, headers: { "Content-Type": "application/json" } });
  };
  const view = await mount(createElement(PairPage, { initialCode: "TEST-CODE" }));
  let destination = "";
  Object.assign(window.location, { hash: "#code=SECRET", pathname: "/pair" });
  Object.assign(window, { history: { state: null, replaceState: (_state: unknown, _title: string, url: string) => {
    assert.equal(url, "/pair");
    window.location.hash = "";
    hashCleared = true;
  } } });
  Object.assign(window.location, { replace: (url: string) => { destination = url; } });
  try {
    const form = view.container.querySelectorAll((element) => element.nodeName === "FORM")[0];
    const props = Object.entries(form).find(([name]) => name.startsWith("__reactProps$"))?.[1] as { onSubmit(event: { preventDefault(): void }): void };
    const submit = () => act(async () => props.onSubmit({ preventDefault() {} }));
    await submit();
    assert.match(view.text(), /invalid or expired/);
    status = 423;
    await submit();
    assert.match(view.text(), /locked.*Try again in .*seconds/);
    status = 429;
    await submit();
    assert.match(view.text(), /Too many attempts/);
    status = 201;
    await submit();
    assert.equal(stored.get("bellpr-device-token"), "bpd_" + "0".repeat(64));
    assert.deepEqual(JSON.parse(stored.get("bellpr-device-info")!), { id: "self", name: "Test phone" });
    assert.equal(destination, "/");
  } finally {
    await view.unmount();
    globalThis.fetch = realFetch;
    globalThis.localStorage = oldLocal;
  }
});
