import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { act, createElement, useState } from "react";
import type { ModelSettings } from "../../shared/models";
import { mount, type FakeElement } from "../mission/test-dom";
import type { DoctorState } from "../setup/useDoctor";
import { ProviderSection } from "./ProviderSection";
import { ModelSettingsModal } from "./ModelSettingsModal";

const doctor: DoctorState = { report: null, checking: false, error: "", refresh: async () => undefined };
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function stubApi() {
  const writes: ModelSettings[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    let body: unknown;
    if (url.includes("/model-settings")) {
      if (init?.method === "PUT") writes.push(JSON.parse(String(init.body)) as ModelSettings);
      body = { settings: writes.at(-1) ?? { provider: "codex", model: "", reasoningEffort: "", webAccess: true } };
    } else if (url.includes("/models")) body = { source: "codex", models: [] };
    else if (url.includes("/system/sudo")) body = { sudo: { user: "bellsvc", available: true, installed: false, passwordless: false } };
    else if (url.includes("/doctor")) body = { checkedAt: "", platform: "linux", ready: true, checks: [] };
    else throw new Error(`Unexpected request: ${url}`);
    return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return writes;
}

type Handler = (event: { preventDefault(): void; target: { value: string } }) => unknown;
async function invoke(element: FakeElement, name: "onChange" | "onSubmit", value = "") {
  const props = Object.entries(element).find(([key]) => key.startsWith("__reactProps$"))?.[1] as Record<string, Handler>;
  await act(async () => { await props[name]({ preventDefault() {}, target: { value } }); });
}

test("the Provider settings page saves explicit full access and can return it to workspace mode", async () => {
  const writes = stubApi();
  const view = await mount(createElement(ProviderSection, { doctor, maskUser: String, maskPath: String, showCurrentRun() {} }));
  try {
    const find = (match: (node: FakeElement) => boolean) => {
      const element = view.container.querySelectorAll(match)[0];
      assert.ok(element);
      return element;
    };
    await invoke(find((node) => node.getAttribute("id")?.endsWith("-agent-access") === true), "onChange", "full");
    await invoke(find((node) => node.nodeName === "FORM"), "onSubmit");
    assert.equal(writes.at(-1)?.agentAccess, "full");
    assert.equal(writes.at(-1)?.webAccess, true);
    await invoke(find((node) => node.getAttribute("id")?.endsWith("-agent-access") === true), "onChange", "workspace");
    await invoke(find((node) => node.nodeName === "FORM"), "onSubmit");
    assert.equal(writes.at(-1)?.agentAccess, "workspace");
  } finally { await view.unmount(); }
});

test("the model settings dialog forwards the chosen access mode to its save handler", async () => {
  stubApi();
  let saved: ModelSettings | undefined;
  function Harness() {
    const [modelSettings, setModelSettings] = useState<ModelSettings>({ provider: "codex", webAccess: true });
    return createElement(ModelSettingsModal, {
      busy: false, formError: "", setFormError() {}, closeModal() {},
      setup: {
        modelSettings, setModelSettings, settingsLoading: false, settingsReady: true,
        settingsNotice: "", setSettingsNotice() {}, settingsSaveButton: { current: null },
        configureContributionModels: async () => undefined,
        saveModelSettings: async () => { saved = modelSettings; },
      },
    });
  }
  const view = await mount(createElement(Harness));
  try {
    const access = view.container.querySelectorAll((node) => node.getAttribute("id")?.endsWith("-agent-access") === true)[0];
    assert.ok(access);
    await invoke(access, "onChange", "full");
    const form = view.container.querySelectorAll((node) => node.nodeName === "FORM")[0];
    assert.ok(form);
    await invoke(form, "onSubmit");
    assert.equal(saved?.agentAccess, "full");
    assert.equal(saved?.webAccess, true);
  } finally { await view.unmount(); }
});
