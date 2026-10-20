import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { act, createElement, useState } from "react";
import { selectionQuestion, parseDiff } from "../../review/diff";
import en from "../../i18n/en/review";
import { mount } from "../../mission/test-dom";
import type { DiffFile, Run } from "../../types";
import { focusWhenShown, selectionOf, useByHand, type ByHand } from "./useByHand";

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

test("an explanation asked for before a reload is followed by reading the diff until it is written, never by asking again", async () => {
  const requests: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(`${init?.method ?? "GET"} ${String(input)}`);
    return new Response(JSON.stringify({ files: [{ ...file, explanationStatus: "ready" }] }), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  mock.timers.enable({ apis: ["setInterval"] });
  const value = { id: "run-1", repoId: "repo-1", status: "approved", learnByHand: true, agents: [], byHand: {} } as unknown as Run;
  let shown: DiffFile[] = [];
  function Probe({ requesting }: { requesting: boolean }) {
    const [files, setFiles] = useState<DiffFile[]>([{ ...file, explanationStatus: "generating" }]);
    shown = files;
    useByHand(value, files, {
      demo: false,
      requesting,
      draftMutationEpoch: { current: 0 },
      actions: { setRun() {}, setFiles, approveTeamPlan: async () => {} },
      handBack() {},
    });
    return null;
  }
  const flush = () => act(async () => new Promise((resolve) => setImmediate(resolve)));
  // While this tab asks for it itself, its own request brings the result.
  const asking = await mount(createElement(Probe, { requesting: true }));
  mock.timers.tick(9000);
  await flush();
  assert.deepEqual(requests, []);
  await asking.unmount();
  const mounted = await mount(createElement(Probe, { requesting: false }));
  try {
    mock.timers.tick(3000);
    await flush();
    await flush();
    assert.equal(requests.length, 1);
    assert.match(requests[0], /^GET .*\/runs\/run-1\/diff$/);
    assert.equal(shown[0].explanationStatus, "ready");
    // Written: no more reads.
    mock.timers.tick(9000);
    await flush();
    assert.equal(requests.length, 1);
  } finally {
    await mounted.unmount();
    mock.timers.reset();
    globalThis.fetch = realFetch;
  }
});

test("the focus moves to an element once it is on screen, and the search gives up after a while", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let shownAfter = 2;
    const focused: string[] = [];
    focusWhenShown(() => (shownAfter-- > 0 ? null : ({ focus: () => focused.push("close") } as unknown as HTMLElement)));
    assert.deepEqual(focused, []);
    mock.timers.tick(50);
    assert.deepEqual(focused, []);
    mock.timers.tick(50);
    assert.deepEqual(focused, ["close"]);
    let calls = 0;
    focusWhenShown(() => (calls++, null), 3);
    for (let tick = 0; tick < 10; tick++) mock.timers.tick(50);
    assert.equal(calls, 4);
  } finally {
    mock.timers.reset();
  }
});

test("the Ready dialog's line about AI rules comes only from rules about AI", async () => {
  const finding = (kind: string, quote: string) => ({ kind, path: "CONTRIBUTING.md", line: 3, quote, contribution: false });
  function Probe({ findings }: { findings: ReturnType<typeof finding>[] }) {
    const byHand = useByHand({ id: "run-1", repoId: "repo-1", status: "review", learnByHand: true, agents: [], logs: [] } as unknown as Run, [], {
      demo: false,
      repo: { id: "repo-1", contributionRules: { checkedAt: "2026-10-20T09:00:00.000Z", findings, filesRead: [] } } as never,
      draftMutationEpoch: { current: 0 },
      actions: { setRun() {}, setFiles() {}, approveTeamPlan: async () => {} },
      handBack() {},
    });
    return createElement("span", null, String(byHand.readyDialog.aiRules));
  }
  const aiRules = async (findings: ReturnType<typeof finding>[]) => {
    const mounted = await mount(createElement(Probe, { findings }));
    try {
      return mounted.text();
    } finally {
      await mounted.unmount();
    }
  };
  // Open an issue first, write it in your own words, understand your change: not about AI.
  assert.equal(
    await aiRules([
      finding("issue-first", "Open an issue before you change behaviour."),
      finding("own-words", "Write the description in your own words."),
      finding("understand", "You must understand every line you submit."),
    ]),
    "false",
  );
  for (const kind of ["ban", "disclose", "area", "agent"]) assert.equal(await aiRules([finding(kind, "Some rule.")]), "true", kind);
  // A rule of another kind whose own words are about AI.
  assert.equal(await aiRules([finding("understand", "If you used an LLM, you must understand every line it wrote.")]), "true");
  assert.equal(await aiRules([finding("own-words", "Don't paste AI output into the description.")]), "true");
});
