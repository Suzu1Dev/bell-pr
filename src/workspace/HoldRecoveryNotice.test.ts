import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement, useState } from "react";
import { ApiError } from "../api";
import type { HoldRestoreResult } from "../app/hooks/useRunActions";
import { mount, type FakeElement } from "../mission/test-dom";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import type { DiffFile, Run } from "../types";
import { canRecoverHeldPaths, hasLegacyHoldStop, HoldRecoveryNotice } from "./HoldRecoveryNotice";

const run: Run = {
  id: "run-held",
  repoId: "repo-1",
  title: "Recover held edits",
  prompt: "Recover held edits",
  status: "failed",
  branch: "fix/held",
  baseBranch: "main",
  createdAt: "2026-11-10T00:00:00Z",
  agents: [],
  logs: [],
  draft: { title: "", body: "" },
  reviewedFiles: [],
  heldPaths: ["src/very/long/path/that/wraps.ts", "docs/guide.md"],
};

type Props = Parameters<typeof HoldRecoveryNotice>[0];
type RecoveryActions = Props["actions"];
const actions = (overrides: Partial<RecoveryActions> = {}): RecoveryActions => ({
  async restoreHeldPaths(): Promise<HoldRestoreResult> {
    return { restored: 2, files: [] };
  },
  async recheckHeldPaths() {
    return [];
  },
  notify() {},
  ...overrides,
});
const element = (props: Partial<Props> = {}) =>
  createElement(HoldRecoveryNotice, { run, busy: false, actions: actions(), ...props });

const reactProps = (target: FakeElement) =>
  Object.entries(target).find(([key]) => key.startsWith("__reactProps$"))?.[1] as Record<string, unknown>;

const click = (target: FakeElement) =>
  act(async () => {
    const props = reactProps(target) as { onClick(): unknown };
    void props.onClick();
  });

const mouseDownSelf = (target: FakeElement) =>
  act(async () => {
    const props = reactProps(target) as { onMouseDown(event: { target: FakeElement; currentTarget: FakeElement }): unknown };
    props.onMouseDown({ target, currentTarget: target });
  });

const button = (view: Awaited<ReturnType<typeof mount>>, label: string) =>
  view.container.querySelectorAll((node) => node.nodeName === "BUTTON" && node.textContent === label)[0]!;

const buttons = (view: Awaited<ReturnType<typeof mount>>, label: string) =>
  view.container.querySelectorAll((node) => node.nodeName === "BUTTON" && node.textContent === label);

const byClass = (view: Awaited<ReturnType<typeof mount>>, classToken: string) =>
  view.container.querySelectorAll((node) => (node.getAttribute("class") ?? "").split(/\s+/).includes(classToken))[0];

test("the stopped-run card renders Muse's English and Chinese copy with path-only fallbacks", () => {
  const html = renderEn(element());
  assertNoHan(html);
  assert.match(html, /Stopped because files are held/);
  assert.match(html, /The last turn changed files someone else holds; edits stay in the working directory\./);
  assert.match(html, /src\/very\/long\/path\/that\/wraps\.ts \(held by another member\)/);
  assert.match(html, />Put these files back<\/button>/);
  assert.match(html, />Check again<\/button>/);
  const zh = renderZh(element({ run: { ...run, heldPaths: ["docs/guide.md"] } }));
  assert.match(zh, /改到別人佔用的檔案，已停止/);
  assert.match(zh, /docs\/guide\.md（被他人佔用）/);
  assert.match(zh, />還原這個檔案<\/button>/);
  assert.match(zh, />重新檢查<\/button>/);
});

test("only stopped, recoverable runs show the card, including legacy runs saved before run.heldPaths existed", () => {
  for (const status of ["review", "approved", "failed"] as const)
    assert.equal(canRecoverHeldPaths({ ...run, status }, false), true, status);
  for (const status of ["queued", "running", "awaiting_plan", "cancelled", "published"] as const)
    assert.equal(canRecoverHeldPaths({ ...run, status }, false), false, status);
  assert.equal(canRecoverHeldPaths(run, true), false);
  assert.equal(canRecoverHeldPaths({ ...run, heldPaths: [] }, false), false);
  assert.equal(canRecoverHeldPaths({ ...run, workspaceRemovedAt: "2026-11-10T01:00:00Z" }, false), false);
  assert.equal(canRecoverHeldPaths({
    ...run,
    prFeedback: { fetchedAt: "2026-11-10T02:00:00Z", prNumber: 1, items: [], merged: true },
  }, false), false);
  assert.equal(canRecoverHeldPaths({ ...run, publishCommit: "a".repeat(40) }, false), false);
  const round = {
    id: "round-1",
    requestedAt: "2026-11-10T01:00:00Z",
    feedbackUrls: [],
    parentCommit: "b".repeat(40),
  };
  assert.equal(canRecoverHeldPaths({
    ...run,
    status: "published",
    prUrl: "https://example.test/pull/1",
    followUps: [{ ...round, status: "review" }],
  }, false), true);
  assert.equal(canRecoverHeldPaths({
    ...run,
    status: "published",
    prUrl: "https://example.test/pull/1",
    followUps: [{ ...round, status: "running" }],
  }, false), false);

  const legacyEn =
    "The agent changed files someone else holds, so the run stopped. The changes are still in the checkout. src/a.ts — Dee.";
  const legacyZh =
    "Agent 改到別人佔用的檔案，所以這項工作已停止。改動仍留在工作目錄裡。src/a.ts：由 Dee 佔用。";
  const withoutHeldPaths: Run = { ...run, heldPaths: undefined };
  assert.equal(hasLegacyHoldStop(withoutHeldPaths), false);
  assert.equal(canRecoverHeldPaths({ ...withoutHeldPaths, error: legacyEn }, false), true);
  assert.equal(canRecoverHeldPaths({ ...withoutHeldPaths, error: legacyZh }, false), true);
  assert.equal(canRecoverHeldPaths({
    ...withoutHeldPaths,
    status: "review",
    sync: { at: "2026-11-10T00:00:00Z", from: "0".repeat(40), to: "1".repeat(40), snapshot: "2".repeat(40), conflicts: [], report: legacyEn },
  }, false), true);
  assert.equal(canRecoverHeldPaths({
    ...withoutHeldPaths,
    status: "published",
    prUrl: "https://example.test/pull/1",
    followUps: [{ ...round, status: "review", error: legacyZh }],
  }, false), true);
  assert.equal(renderEn(element({ busy: true })), "");
});

test("legacy runs without heldPaths render legacy copy without an empty list, avoid 0-file counts, and announce holdCleared when 0 files needed restoring", async () => {
  const legacyRun: Run = {
    ...run,
    heldPaths: undefined,
    error: "The agent changed files someone else holds, so the run stopped. The changes are still in the checkout. docs/guide.md — Dee.",
  };
  const html = renderEn(element({ run: legacyRun }));
  assertNoHan(html);
  assert.match(html, /This run stopped earlier because it changed files someone else held\./);
  assert.doesNotMatch(html, /hold-stop-list/);
  assert.match(html, />Put these files back<\/button>/);

  const notes: { message: string; tone?: string }[] = [];
  const view = await mount(element({
    run: legacyRun,
    actions: actions({
      async restoreHeldPaths() {
        return { restored: 0, files: [] };
      },
      notify: (message, tone) => { notes.push({ message, tone }); },
    }),
  }));
  try {
    await click(button(view, "Put these files back"));
    assert.doesNotMatch(view.text(), /0 held files/);
    assert.match(view.text(), /This run stopped earlier because it changed files someone else held\./);
    await click(buttons(view, "Put these files back").at(-1)!);
    assert.deepEqual(notes, [{ message: "No holds remain on these files. You can continue.", tone: "success" }]);
  } finally {
    await view.unmount();
  }
});

test("restore asks for confirmation with TriangleAlert mark, blocks close while pending, and moves focus to .workspace-heading h1 when cleared", async () => {
  let finish!: (result: HoldRestoreResult) => void;
  const pending = new Promise<HoldRestoreResult>((resolve) => { finish = resolve; });
  const notes: { message: string; tone?: string }[] = [];
  const singleHeldRun: Run = { ...run, heldPaths: ["docs/guide.md"] };
  const clearedRun: Run = { ...singleHeldRun, status: "review", heldPaths: undefined };

  function Page() {
    const [currentRun, setCurrentRun] = useState(singleHeldRun);
    return createElement(
      "div",
      null,
      createElement("section", { className: "workspace-heading" }, createElement("h1", { tabIndex: -1 }, currentRun.title)),
      createElement(HoldRecoveryNotice, {
        run: currentRun,
        busy: false,
        actions: actions({
          restoreHeldPaths: async () => {
            const result = await pending;
            setCurrentRun(clearedRun);
            return result;
          },
          notify: (message, tone) => { notes.push({ message, tone }); },
        }),
      }),
    );
  }

  const view = await mount(createElement(Page));
  try {
    await click(button(view, "Put this file back"));
    assert.match(view.text(), /Put held files back\?/);
    assert.match(view.text(), /Put 1 held file back to this run's base version\? Edits to that file will be removed, while any other changed files stay as they are\./);
    const modalMarkSvg = byClass(view, "modal-mark")?.querySelectorAll((node) => node.nodeName.toUpperCase() === "SVG")[0];
    assert.ok(modalMarkSvg);
    assert.equal(modalMarkSvg.getAttribute("aria-hidden"), "true");
    assert.match(modalMarkSvg.getAttribute("class") ?? "", /triangle-alert/);

    await click(buttons(view, "Put these files back").at(-1)!);
    assert.ok(button(view, "Putting back…").hasAttribute("disabled"));
    assert.ok(button(view, "Check again").hasAttribute("disabled"));
    assert.ok(button(view, "Cancel").hasAttribute("disabled"));

    // Close attempts via X button, backdrop mousedown, and Cancel are blocked while restore is pending.
    await click(byClass(view, "modal-close")!);
    await mouseDownSelf(byClass(view, "modal-backdrop")!);
    await click(button(view, "Cancel"));
    assert.match(view.text(), /Put held files back\?/);

    const other = { path: "src/other.ts" } as DiffFile;
    await act(async () => { finish({ restored: 1, files: [other] }); await pending; });
    assert.doesNotMatch(view.text(), /Put held files back\?/);
    assert.doesNotMatch(view.text(), /Stopped because/);
    const heading = view.container.querySelectorAll((node) => node.nodeName === "H1")[0]!;
    assert.equal((globalThis.document as unknown as { activeElement: FakeElement | null }).activeElement, heading);
    assert.deepEqual(notes, [{ message: "1 file restored. Other changes were kept.", tone: "success" }]);
  } finally {
    await view.unmount();
  }
});

test("switching runs while restore or recheck is in flight never mutates dialog, pending, conflicts, or focus on the newly selected run", async () => {
  let finishRun1Restore!: (result: HoldRestoreResult) => void;
  const run1Restore = new Promise<HoldRestoreResult>((resolve) => { finishRun1Restore = resolve; });
  let finishRun1Recheck!: (conflicts: Awaited<ReturnType<RecoveryActions["recheckHeldPaths"]>>) => void;
  const run1Recheck = new Promise<Awaited<ReturnType<RecoveryActions["recheckHeldPaths"]>>>((resolve) => {
    finishRun1Recheck = resolve;
  });

  const run2: Run = { ...run, id: "run-2", title: "Second run", heldPaths: ["README.md"] };
  const notes: { message: string; tone?: string }[] = [];
  const sharedActions = actions({
    restoreHeldPaths: () => run1Restore,
    recheckHeldPaths: () => run1Recheck,
    notify: (message, tone) => { notes.push({ message, tone }); },
  });
  const renderFor = (currentRun: Run) =>
    createElement(
      "div",
      null,
      createElement("section", { className: "workspace-heading" }, createElement("h1", { tabIndex: -1 }, currentRun.title)),
      createElement("button", { type: "button" }, "Keep focus here"),
      createElement(HoldRecoveryNotice, { run: currentRun, busy: false, actions: sharedActions }),
    );

  const view = await mount(renderFor(run));
  try {
    // 1. Start a recheck on run-1, switch to run-2 before it resolves.
    await click(button(view, "Check again"));
    assert.ok(button(view, "Checking…").hasAttribute("disabled"));
    await view.rerender(renderFor(run2));
    // run-2 is immediately idle and shows only its own held path.
    assert.equal(button(view, "Check again").hasAttribute("disabled"), false);
    assert.match(view.text(), /README\.md \(held by another member\)/);
    assert.doesNotMatch(view.text(), /docs\/guide\.md/);

    await act(async () => {
      finishRun1Recheck([{ path: "docs/guide.md", holder: "Dee", title: "Guide work", since: "2026-11-10T09:00:00Z" }]);
      await run1Recheck;
    });
    assert.doesNotMatch(view.text(), /Dee/);
    assert.deepEqual(notes, []);

    // 2. Switch back to run-1, start a restore inside the modal, then switch to run-2 and open run-2's modal.
    await view.rerender(renderFor(run));
    await click(button(view, "Put these files back"));
    await click(buttons(view, "Put these files back").at(-1)!);
    assert.ok(button(view, "Putting back…").hasAttribute("disabled"));

    await view.rerender(renderFor(run2));
    assert.doesNotMatch(view.text(), /Put held files back\?/);
    await click(button(view, "Put this file back"));
    assert.match(view.text(), /Put held files back\?/);
    const keepFocus = button(view, "Keep focus here");
    keepFocus.focus();

    await act(async () => {
      finishRun1Restore({ restored: 2, files: [] });
      await run1Restore;
    });
    // run-2's confirmation dialog stays open, focus stays on keepFocus, and no run-1 toast fired.
    assert.match(view.text(), /Put held files back\?/);
    assert.equal((globalThis.document as unknown as { activeElement: FakeElement | null }).activeElement, keepFocus);
    assert.deepEqual(notes, []);
  } finally {
    await view.unmount();
  }
});

test("a cleared recheck announces that work can continue", async () => {
  const notes: { message: string; tone?: string }[] = [];
  const view = await mount(element({
    actions: actions({ notify: (message, tone) => { notes.push({ message, tone }); } }),
  }));
  try {
    await click(button(view, "Check again"));
    assert.deepEqual(notes, [{ message: "No holds remain on these files. You can continue.", tone: "success" }]);
  } finally {
    await view.unmount();
  }
});

test("a held recheck shows holder metadata and the exact still-held notice", async () => {
  const notes: { message: string; tone?: string }[] = [];
  const view = await mount(element({
    actions: actions({
      async recheckHeldPaths() {
        return [{
          path: "docs/guide.md",
          holder: "Dee",
          title: "Guide work",
          since: "2026-11-10T09:00:00Z",
        }];
      },
      notify: (message, tone) => { notes.push({ message, tone }); },
    }),
  }));
  try {
    await click(button(view, "Check again"));
    assert.match(view.text(), /Held by Dee for “Guide work” · since/);
    assert.deepEqual(notes, [{
      message: "Dee still holds docs/guide.md. Wait for them to release it, ask a group admin to revoke it, or put this file back.",
      tone: "error",
    }]);
  } finally {
    await view.unmount();
  }
});

test("409 heldByOther on restore updates conflicts and closes the modal, 409 busy and 403 notJoined surface server sentences, and 503 uses recovery fallbacks", async () => {
  const notes: { message: string; tone?: string }[] = [];
  let failWith: Error = new ApiError("Work is still running on this contribution.", { status: 409 });
  const view = await mount(element({
    actions: actions({
      async recheckHeldPaths() { throw failWith; },
      async restoreHeldPaths() { throw failWith; },
      notify: (message, tone) => { notes.push({ message, tone }); },
    }),
  }));
  try {
    await click(button(view, "Check again"));
    await click(button(view, "Put these files back"));
    await click(buttons(view, "Put these files back").at(-1)!);
    // Modal remains open on transient 409 busy so the user can retry or cancel.
    assert.match(view.text(), /Put held files back\?/);

    failWith = new ApiError("Held after restore", {
      status: 409,
      details: {
        reason: "heldByOther",
        held: [{ path: "docs/guide.md", holder: "Dee", title: "Guide work", since: "2026-11-10T09:00:00Z" }],
      },
    });
    await click(buttons(view, "Put these files back").at(-1)!);
    // 409 heldByOther closes the modal and shows live holder metadata on the card.
    assert.doesNotMatch(view.text(), /Put held files back\?/);
    assert.match(view.text(), /Held by Dee for “Guide work” · since/);

    failWith = new ApiError("Join the group on the Group page first.", { status: 403, details: { reason: "notJoined" } });
    await click(button(view, "Check again"));
    await click(button(view, "Put these files back"));
    await click(buttons(view, "Put these files back").at(-1)!);

    failWith = new ApiError("Group stopped", { status: 503, details: { reason: "holdsUnknown" } });
    await click(buttons(view, "Put these files back").at(-1)!);
    await click(button(view, "Cancel"));
    await click(button(view, "Check again"));

    assert.equal(notes[0]?.message, "Work is still running on this contribution.");
    assert.equal(notes[1]?.message, "Work is still running on this contribution.");
    assert.equal(
      notes[2]?.message,
      "Dee still holds docs/guide.md. Wait for them to release it, ask a group admin to revoke it, or put this file back.",
    );
    assert.equal(notes[3]?.message, "Join the group on the Group page first.");
    assert.equal(notes[4]?.message, "Join the group on the Group page first.");
    assert.match(notes[5]?.message ?? "", /Couldn't put these files back/);
    assert.match(notes[6]?.message ?? "", /Couldn't check file holds right now/);
  } finally {
    await view.unmount();
  }
});
