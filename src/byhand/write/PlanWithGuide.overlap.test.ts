// "This is my plan" against the person's other contributions: the click
// reads the overlaps for the saved steps first, stops for the tick when
// there are any, and then confirms with the digest it read.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { act, createElement } from "react";
import { mount, type FakeElement } from "../../mission/test-dom";
import type { Run } from "../../types";
import { PlanWithGuide } from "./PlanWithGuide";

const at = "2026-10-20T09:00:00.000Z";
const run: Run = {
  id: "run-1",
  repoId: "repo-1",
  title: "Cap the retries",
  prompt: "Cap the retries at three.",
  status: "awaiting_plan",
  branch: "fix/retries",
  baseBranch: "main",
  createdAt: at,
  agents: [],
  logs: [],
  draft: { title: "", body: "" },
  reviewedFiles: [],
  learnByHand: true,
  team: { phase: "awaiting_approval", planSummary: "", tasks: [], messages: [], config: { provider: "codex", maxTeammates: 2, requirePlanApproval: true } } as unknown as Run["team"],
  byHand: { plan: { steps: [{ id: "s1", title: "Cap the retries", files: ["src/retry.ts"] }], savedAt: at } },
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** GET …/overlaps answers `answer()` at the time of each call. */
function stubOverlaps(answer: () => unknown) {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(JSON.stringify(answer()), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return () => calls;
}

const handlers = (element: FakeElement) =>
  Object.entries(element).find(([name]) => name.startsWith("__reactProps$"))?.[1] as {
    onClick(): void;
    onChange(event: { target: { checked: boolean } }): void;
    disabled?: boolean;
  };
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

test("a click while the overlaps were unread still counts, stops for the tick when there are some, and then confirms with their digest", async () => {
  let overlaps: unknown[] = [];
  const calls = stubOverlaps(() => ({ overlaps, digest: overlaps.length ? "d".repeat(64) : "0".repeat(64) }));
  const confirms: unknown[] = [];
  const view = await mount(
    createElement(PlanWithGuide, {
      run,
      onSave: async () => {},
      onReveal: async () => {},
      onAskQuestions: async () => {},
      onConfirm: async (options) => {
        confirms.push(options);
      },
    }),
  );
  try {
    const find = (match: (element: FakeElement) => boolean) => view.container.querySelectorAll(match);
    const confirm = () => find((element) => element.nodeName === "BUTTON" && element.getAttribute("class") === "button primary")[0];
    // Another contribution changes the file only now, after the first read.
    await settle();
    overlaps = [{ runId: "r2", title: "Other fix", status: "review", paths: ["src/retry.ts"] }];
    assert.notEqual(handlers(confirm()).disabled, true);
    await act(async () => handlers(confirm()).onClick());
    await settle();
    assert.deepEqual(confirms, []);
    assert.ok(calls() >= 2);
    assert.match(view.text(), /Another contribution of yours to this project changes files this plan covers/);
    // Ticking the overlap lets the next click confirm with the digest it was read with.
    const tick = find((element) => element.nodeName === "INPUT" && element.parentNode?.nodeName === "LABEL").at(-1)!;
    await act(async () => handlers(tick).onChange({ target: { checked: true } }));
    assert.notEqual(handlers(confirm()).disabled, true);
    await act(async () => handlers(confirm()).onClick());
    await settle();
    assert.deepEqual(confirms, [{ overlapDigest: "d".repeat(64) }]);
  } finally {
    await view.unmount();
  }
});
