import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderEn, renderZh } from "../test-utils/render";
import { DevicesSection } from "./DevicesSection";

test("device settings are localized", () => {
  assert.match(renderEn(createElement(DevicesSection)), /Devices/);
  assert.match(renderZh(createElement(DevicesSection)), /裝置/);
});

test("device list revocation updates the list and preserves an API failure", async () => {
  const { act } = await import("react");
  const { mount } = await import("../mission/test-dom");
  const realFetch = globalThis.fetch;
  let fail = true;
  const calls: string[] = [];
  globalThis.fetch = async (url, options) => {
    calls.push(`${options?.method ?? "GET"} ${url}`);
    if (options?.method === "DELETE") return fail
      ? new Response(JSON.stringify({ error: "Test failure" }), { status: 503 })
      : new Response(null, { status: 204 });
    return new Response(JSON.stringify([{ id: "test-device", name: "Test phone", createdAt: "2026-01-01", lastUsedAt: null }]), {
      headers: { "Content-Type": "application/json" },
    });
  };
  const view = await mount(createElement(DevicesSection));
  try {
    assert.match(view.text(), /Test phone/);
    const button = view.container.querySelectorAll((element) => element.nodeName === "BUTTON" && element.textContent === "Revoke device")[0];
    const props = Object.entries(button).find(([name]) => name.startsWith("__reactProps$"))?.[1] as { onClick(): void };
    await act(async () => props.onClick());
    assert.match(view.text(), /Test failure/);
    assert.match(view.text(), /Test phone/);
    fail = false;
    await act(async () => props.onClick());
    assert.match(view.text(), /No paired devices/);
    assert.equal(calls.at(-1), "DELETE /api/devices/test-device");
  } finally {
    await view.unmount();
    globalThis.fetch = realFetch;
  }
});

test("paired device lists and revokes other devices, then itself", async () => {
  const { act } = await import("react");
  const { mount } = await import("../mission/test-dom");
  const realFetch = globalThis.fetch;
  const oldLocal = globalThis.localStorage;
  const oldSession = globalThis.sessionStorage;
  const stored = new Map([
    ["bellpr-device-token", "bpd_" + "0".repeat(64)],
    ["bellpr-device-info", JSON.stringify({ id: "self", name: "Test self" })],
  ]);
  globalThis.sessionStorage = undefined as unknown as Storage;
  globalThis.localStorage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => { stored.set(key, value); },
    removeItem: (key) => { stored.delete(key); },
    clear: () => stored.clear(), key: () => null, length: 2,
  };
  const calls: string[] = [];
  globalThis.fetch = async (url, options) => {
    calls.push(`${options?.method ?? "GET"} ${url}`);
    assert.equal(new Headers(options?.headers).get("Authorization"), "Bearer bpd_" + "0".repeat(64));
    return options?.method === "DELETE" ? new Response(null, { status: 204 })
      : new Response(JSON.stringify([
        { id: "other", name: "Other phone", lastUsedAt: null },
        { id: "self", name: "Test self", current: true, lastUsedAt: null },
      ]), { headers: { "Content-Type": "application/json" } });
  };
  const view = await mount(createElement(DevicesSection));
  let destination = "";
  Object.assign(window.location, { replace: (url: string) => { destination = url; } });
  try {
    assert.match(view.text(), /Test self/);
    assert.deepEqual(calls, ["GET /api/devices"]);
    const other = view.container.querySelectorAll((element) => element.nodeName === "BUTTON")[0];
    const otherProps = Object.entries(other).find(([name]) => name.startsWith("__reactProps$"))?.[1] as { onClick(): void };
    await act(async () => otherProps.onClick());
    assert.doesNotMatch(view.text(), /Other phone/);
    assert.equal(stored.has("bellpr-device-token"), true);
    const button = view.container.querySelectorAll((element) => element.nodeName === "BUTTON")[0];
    const props = Object.entries(button).find(([name]) => name.startsWith("__reactProps$"))?.[1] as { onClick(): void };
    await act(async () => props.onClick());
    assert.deepEqual(calls, ["GET /api/devices", "DELETE /api/devices/other", "DELETE /api/devices/self"]);
    assert.equal(stored.get("bellpr-device-token"), undefined);
    assert.equal(destination, "/pair");
  } finally {
    await view.unmount();
    globalThis.fetch = realFetch;
    globalThis.localStorage = oldLocal;
    globalThis.sessionStorage = oldSession;
  }
});
