import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { act, createElement, useState, type SetStateAction } from "react";
import { mount } from "../../mission/test-dom";
import type { DiffFile, Run } from "../../types";
import type { Tab } from "../AppShell";
import { useRunPolling } from "./useRunPolling";

const running = {
  id: "run-1",
  repoId: "repo-1",
  status: "running",
  agents: [],
  draft: { title: "t", body: "b" },
  reviewedFiles: [],
} as unknown as Run;
const finished = { ...running, status: "review" } as Run;
const file = { path: "src/retry.ts", additions: 1, deletions: 0 } as DiffFile;

const respond = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });

/**
 * Polls `running` with a server whose diff answer is `diff`: the files and
 * tab it shows, and the runs it applies, are recorded.
 */
async function mountPolling(diff: (epoch: { current: number }) => Promise<Response>, initial = running, response = finished) {
  const asked: string[] = [];
  const epoch = { current: 0 };
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    asked.push(url);
    return url.endsWith("/diff") ? diff(epoch) : respond({ run: response });
  }) as typeof fetch;
  const shown = { files: [] as DiffFile[], tab: "activity" as Tab, runs: [] as Run[] };
  // Stable, like the shell's state setters, so the poll keeps running.
  const setRun = (value: SetStateAction<Run>) => {
    if (typeof value !== "function") shown.runs.push(value);
  };
  const ignore = () => {};
  function Probe() {
    const [files, setFiles] = useState<DiffFile[]>([]);
    const [tab, setTab] = useState<Tab>("activity");
    shown.files = files;
    shown.tab = tab;
    useRunPolling({
      run: initial,
      demo: false,
      active: ["running", "queued", "awaiting_plan"].includes(initial.status),
      preparingDraft: false,
      reviewRerunning: false,
      draftMutationEpoch: epoch,
      setRun,
      setRuns: ignore,
      setFiles,
      setSelectedPath: ignore,
      setTab,
      setApiError: ignore,
    });
    return null;
  }
  mock.timers.enable({ apis: ["setInterval"] });
  const mounted = await mount(createElement(Probe));
  const flush = () => act(async () => new Promise((resolve) => setImmediate(resolve)));
  return {
    asked,
    shown,
    async poll() {
      mock.timers.tick(2500);
      for (let step = 0; step < 4; step++) await flush();
    },
    async unmount() {
      await mounted.unmount();
      mock.timers.reset();
      globalThis.fetch = realFetch;
    },
  };
}

test("a draft saved while the finished team's diff loads still shows that diff", async () => {
  const polling = await mountPolling(async (epoch) => {
    // The person saves the draft meanwhile; the server refuses it (409).
    epoch.current += 2;
    return respond({ files: [file] });
  });
  try {
    await polling.poll();
    assert.deepEqual(polling.shown.files, [file]);
    assert.equal(polling.shown.tab, "overview");
    // The run read before the save is not applied; the next poll's is.
    assert.equal(polling.shown.runs.length, 0);
    await polling.poll();
    assert.deepEqual(polling.shown.runs.map((run) => run.status), ["review"]);
    assert.equal(polling.asked.filter((url) => url.endsWith("/diff")).length, 1);
  } finally {
    await polling.unmount();
  }
});

test("a finished team whose diff cannot be read is still shown as finished", async () => {
  // Every read is refused, as with more than 150 changed files (422).
  const polling = await mountPolling(async () =>
    new Response(JSON.stringify({ error: "Too many changed files to show." }), {
      status: 422,
      headers: { "Content-Type": "application/json" },
    }),
  );
  try {
    await polling.poll();
    await polling.poll();
    assert.deepEqual(polling.shown.files, []);
    assert.deepEqual(polling.shown.runs.map((run) => run.status), ["review"]);
    assert.equal(polling.asked.filter((url) => url.endsWith("/diff")).length, 1);
  } finally {
    await polling.unmount();
  }
});

test("a collaboration turn finishing in review refreshes files and draft without leaving its tab", async () => {
  const session = { messages: [], revision: 0, updatedAt: "2026-10-28T00:00:00.000Z", running: true };
  const initial = { ...finished, session } as Run;
  const response = { ...finished, session: { ...session, running: false, revision: 1 }, draft: { title: "t", body: "Updated limitations" } } as Run;
  const polling = await mountPolling(async () => respond({ files: [file] }), initial, response);
  try {
    await polling.poll();
    assert.deepEqual(polling.shown.files, [file]);
    assert.equal(polling.shown.tab, "activity");
    assert.equal(polling.shown.runs.at(-1)?.draft.body, "Updated limitations");
    assert.equal(polling.shown.runs.at(-1)?.session?.running, false);
    await polling.poll();
    assert.equal(polling.asked.filter((url) => url.endsWith("/diff")).length, 1);
  } finally {
    await polling.unmount();
  }
});
