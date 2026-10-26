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

/** Answers the storage report and DELETE /api/runs/:id/workspace. */
function stubFetch() {
  let freed = false;
  const requests: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const url = String(input);
    requests.push(`${method} ${url}`);
    if (method === "DELETE") freed = true;
    const body =
      method === "DELETE"
        ? { run: freedRun }
        : storage(freed ? { ...kept, workspaceRemovedAt: freedRun.workspaceRemovedAt, removable: false } : kept);
    return new Response(JSON.stringify(body), {
      status: 200,
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
