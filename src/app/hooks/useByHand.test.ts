import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement, useState } from "react";
import { selectionQuestion, parseDiff } from "../../review/diff";
import en from "../../i18n/en/review";
import { mount } from "../../mission/test-dom";
import type { DiffFile, Run } from "../../types";
import { selectionOf, useByHand, type ByHand } from "./useByHand";

const file: DiffFile = {
  path: "src/retry.ts",
  language: "TypeScript",
  additions: 2,
  deletions: 1,
  status: "modified",
  patch: "@@ -10,4 +10,5 @@\n const max = 3;\n-let tries = 0;\n+let tries = 1;\n+let delay = 100;\n function retry() {\n   return tries;",
};

test("a diff selection's question gives the guide its lines as path:start-end", () => {
  const lines = parseDiff(file.patch);
  const ask = (from: number, to: number) => selectionQuestion(file.path, lines.slice(from, to), en.selection);
  // The two added lines: new lines 11-12.
  assert.deepEqual(selectionOf(file, ask(3, 5)), { path: "src/retry.ts", startLine: 11, endLine: 12 });
  // Context and an added line: the new file's numbers.
  assert.deepEqual(selectionOf(file, ask(1, 4)), { path: "src/retry.ts", startLine: 10, endLine: 11 });
  // A removed line only: the old file's number.
  assert.deepEqual(selectionOf(file, ask(2, 3)), { path: "src/retry.ts", startLine: 11, endLine: 11 });
  // Lines the patch doesn't hold (read from the base) give the path alone.
  assert.deepEqual(selectionOf(file, "Explain this:\n\n```diff\n+not in the patch\n```"), { path: "src/retry.ts", startLine: 0, endLine: 0 });
});

test("when a test run ends, the diff is read once: the tests may have written new files", async () => {
  const requests: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requests.push(String(input));
    return new Response(JSON.stringify({ files: [file] }), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const run = (busy?: { kind: string; since: string }) =>
    ({ id: "run-1", repoId: "repo-1", status: "approved", learnByHand: true, agents: [], byHand: busy ? { busy } : {} }) as unknown as Run;
  function Probe({ value }: { value: Run }) {
    const [files, setFiles] = useState<DiffFile[]>([]);
    useByHand(value, files, {
      demo: false,
      draftMutationEpoch: { current: 0 },
      actions: { setRun() {}, setFiles, approveTeamPlan: async () => {} },
      handBack() {},
    });
    return createElement("span", null, String(files.length));
  }
  const mounted = await mount(createElement(Probe, { value: run({ kind: "tests", since: "2026-10-20T09:00:00.000Z" }) }));
  try {
    assert.deepEqual(requests, []);
    // The guide's turns never touch the files: only the end of a test run reads them.
    await mounted.rerender(createElement(Probe, { value: run({ kind: "guide", since: "2026-10-20T09:01:00.000Z" }) }));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    assert.equal(requests.length, 1);
    assert.match(requests[0], /\/runs\/run-1\/diff$/);
    assert.equal(mounted.text(), "1");
    await mounted.rerender(createElement(Probe, { value: run() }));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    assert.equal(requests.length, 1);
  } finally {
    await mounted.unmount();
    globalThis.fetch = realFetch;
  }
});

test("a refused request shows the server's message in the view that asked, and nowhere else", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "Try something first: change the code, run the tests, or say what you tried." }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
  let latest: ByHand | undefined;
  const value = { id: "run-1", repoId: "repo-1", status: "approved", learnByHand: true, agents: [], byHand: {} } as unknown as Run;
  function Probe() {
    latest = useByHand(value, [], {
      demo: false,
      draftMutationEpoch: { current: 0 },
      actions: { setRun() {}, setFiles() {}, approveTeamPlan: async () => {} },
      handBack() {},
    });
    return null;
  }
  const mounted = await mount(createElement(Probe));
  try {
    await act(async () => latest!.guide.onGuide({ kind: "hint", rung: 2 }).catch(() => undefined));
    assert.equal(latest!.guide.error, "Try something first: change the code, run the tests, or say what you tried.");
    assert.equal(latest!.readyDialog.error, "");
    assert.equal(latest!.plan.error, "");
    // A refused Ready shows in its dialog, and opening it again starts clean.
    await act(async () => latest!.readyDialog.onReady({ changeFingerprint: "x", review: false }).catch(() => undefined));
    assert.equal(latest!.readyDialog.error.length > 0, true);
    assert.equal(latest!.guide.error, "");
    await act(async () => latest!.openReady());
    assert.equal(latest!.readyDialog.error, "");
  } finally {
    await mounted.unmount();
    globalThis.fetch = realFetch;
  }
});
