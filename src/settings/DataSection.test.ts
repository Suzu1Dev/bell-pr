import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { act, createElement } from "react";
import { getDemo } from "../demo";
import { mount, type FakeElement } from "../mission/test-dom";
import type { DoctorState } from "../setup/useDoctor";
import type { Run } from "../types";
import { DataSection, type StorageReport, type StorageRun } from "./DataSection";
import type { AppSettingsState } from "./useAppSettings";

const doctor: DoctorState = { report: null, checking: true, error: "", refresh: async () => undefined };
const settings: AppSettingsState = {
  view: null,
  error: "",
  save: async () => ({ settings: {}, lockedBy: {} }),
  reload: async () => undefined,
};

const kept: StorageRun = {
  id: "run-1",
  repoId: "repo-1",
  title: "Retry on timeout",
  status: "review",
  createdAt: "2026-10-12T00:00:00.000Z",
  bytes: 4096,
  removable: true,
};
const storage = (run: StorageRun): StorageReport => ({
  measuredAt: "2026-10-12T00:00:00.000Z",
  retentionDays: 14,
  totalBytes: 4096,
  logsBytes: 0,
  insightsBytes: 0,
  repos: [],
  runs: [run],
});
const freedRun: Run = {
  ...getDemo("en").run,
  id: kept.id,
  workspaceRemovedAt: "2026-10-12T01:00:00.000Z",
  workspaceBytes: 4096,
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/**
 * Answers the storage report and DELETE /api/runs/:id/workspace; `fail`
 * names the request that answers 500 instead.
 */
function stubFetch(fail?: "free" | "refresh") {
  let freed = false;
  const requests: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const url = String(input);
    requests.push(`${method} ${url}`);
    const failed = fail === (method === "DELETE" ? "free" : url.includes("refresh=1") ? "refresh" : "");
    if (method === "DELETE" && !failed) freed = true;
    const body = failed
      ? { error: "The disk is busy." }
      : method === "DELETE"
        ? { run: freedRun }
        : storage(freed ? { ...kept, workspaceRemovedAt: freedRun.workspaceRemovedAt, removable: false } : kept);
    return new Response(JSON.stringify(body), {
      status: failed ? 500 : 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return requests;
}

/** Calls the click handler React gave `element`: the fake DOM dispatches no events. */
const click = (element: FakeElement) =>
  act(async () => {
    const props = Object.entries(element).find(([name]) => name.startsWith("__reactProps$"))?.[1] as {
      onClick(): unknown;
    };
    void props.onClick();
  });

/** Lets the pending requests answer and their renders land. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

test("freeing a run's files tells the shell, so the open run shows them gone", async () => {
  const requests = stubFetch();
  const runs: Run[] = [];
  const view = await mount(
    createElement(DataSection, {
      doctor,
      settings,
      maskPath: (value: string) => value,
      onRunFreed: (run: Run) => runs.push(run),
    }),
  );
  try {
    await settle();
    const find = (match: (element: FakeElement) => boolean) => view.container.querySelectorAll(match)[0];
    await click(find((element) => element.getAttribute("aria-label") === "Free the space of Retry on timeout")!);
    await click(find((element) => element.getAttribute("class") === "button primary settings-danger-button")!);
    await settle();
    assert.ok(requests.includes("DELETE /api/runs/run-1/workspace"));
    assert.deepEqual(
      runs.map(({ id, workspaceRemovedAt }) => ({ id, workspaceRemovedAt })),
      [{ id: "run-1", workspaceRemovedAt: freedRun.workspaceRemovedAt }],
    );
    assert.match(view.text(), /Freed 4 kB\./);
  } finally {
    await view.unmount();
  }
});

/** The element that has the keyboard focus in the fake DOM. */
const focused = () => document.activeElement as unknown as FakeElement | null;

/** Mounts the section with its report loaded and the run's confirmation open. */
async function confirming() {
  const view = await mount(createElement(DataSection, { doctor, settings, maskPath: (value: string) => value }));
  await settle();
  const find = (match: (element: FakeElement) => boolean) => view.container.querySelectorAll(match)[0];
  const toggle = () => find((element) => element.getAttribute("aria-label") === "Free the space of Retry on timeout");
  await click(toggle()!);
  const confirm = find((element) => element.getAttribute("class") === "button primary settings-danger-button")!;
  // Pressed from the keyboard.
  confirm.focus();
  return { view, find, toggle, confirm };
}

test("after a free the keyboard waits on Measure again, since the run's row goes", async () => {
  stubFetch();
  const { view, find, confirm } = await confirming();
  try {
    await click(confirm);
    await settle();
    const again = find((element) => element.nodeName === "BUTTON" && element.textContent === "Measure again");
    assert.ok(focused() === again, "the focus is on Measure again");
    assert.equal(again?.getAttribute("aria-disabled"), "false");
    assert.doesNotMatch(view.text(), /Retry on timeout/);
  } finally {
    await view.unmount();
  }
});

test("a free that fails gives the keyboard back to the run's button", async () => {
  stubFetch("free");
  const { view, toggle, confirm } = await confirming();
  try {
    await click(confirm);
    await settle();
    assert.ok(focused() === toggle(), "the focus is on the run's Free space button");
    assert.equal(toggle()?.getAttribute("aria-expanded"), "false");
    assert.match(view.text(), /The disk is busy\./);
  } finally {
    await view.unmount();
  }
});

test("when the storage does not load again after a free, the run's button works again", async () => {
  stubFetch("refresh");
  const { view, toggle, confirm } = await confirming();
  try {
    await click(confirm);
    await settle();
    assert.equal(toggle()?.textContent, "Free space");
    assert.ok(!toggle()?.hasAttribute("disabled"));
    assert.equal(toggle()?.getAttribute("aria-expanded"), "false");
    assert.match(view.text(), /Freed 4 kB\./);
    assert.match(view.text(), /Storage use did not load: The disk is busy\./);
  } finally {
    await view.unmount();
  }
});
