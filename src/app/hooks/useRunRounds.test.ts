import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement } from "react";
import en from "../../i18n/en/workspace";
import { mount } from "../../mission/test-dom";
import type { DiffFile, Run } from "../../types";
import { useRunRounds } from "./useRunRounds";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("discarding a round on a run whose files were freed says it was discarded, not that it failed", async () => {
  const freed = { id: "run-1", status: "published", workspaceRemovedAt: "2026-10-20T09:00:00.000Z", agents: [] } as unknown as Run;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/follow-ups/discard")) return json(200, { run: freed });
    // The server answers a freed run's diff with 410, as the files are gone.
    if (url.endsWith("/diff")) return json(410, { error: "Files for this run were cleaned up.", code: "workspace_removed" });
    throw new Error(`unexpected request ${url}`);
  }) as typeof fetch;
  const notes: { message: string; tone?: string }[] = [];
  let files: DiffFile[] | undefined;
  let rounds!: ReturnType<typeof useRunRounds>;
  function Probe() {
    rounds = useRunRounds({
      run: freed,
      setRun() {},
      runIdRef: { current: freed.id },
      setFiles: (value) => void (files = typeof value === "function" ? value([]) : value),
      setBusy() {},
      notify: (message, tone) => void notes.push({ message, tone }),
      setTab() {},
    });
    return null;
  }
  const mounted = await mount(createElement(Probe));
  const realConfirm = window.confirm;
  window.confirm = () => true;
  try {
    await act(async () => rounds.discardFollowUp());
    assert.deepEqual(notes, [{ message: en.notices.roundDiscarded, tone: undefined }]);
    assert.deepEqual(files, []);
  } finally {
    window.confirm = realConfirm;
    await mounted.unmount();
    globalThis.fetch = realFetch;
  }
});
