import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement } from "react";
import { ApiError } from "../api";
import type { HoldRestoreResult } from "../app/hooks/useRunActions";
import { mount, type FakeElement } from "../mission/test-dom";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import type { DiffFile, Run } from "../types";
import { canRecoverHeldPaths, HoldRecoveryNotice } from "./HoldRecoveryNotice";

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

const click = (target: FakeElement) =>
  act(async () => {
    const props = Object.entries(target).find(([key]) => key.startsWith("__reactProps$"))?.[1] as {
      onClick(): unknown;
    };
    void props.onClick();
  });
const button = (view: Awaited<ReturnType<typeof mount>>, label: string) =>
  view.container.querySelectorAll((node) => node.nodeName === "BUTTON" && node.textContent === label)[0]!;

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

test("only stopped, recoverable runs show the card", () => {
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
  assert.equal(renderEn(element({ busy: true })), "");
});

test("restore asks for confirmation, disables both actions while busy, and keeps other changes in the success notice", async () => {
  let finish!: (result: HoldRestoreResult) => void;
  const pending = new Promise<HoldRestoreResult>((resolve) => { finish = resolve; });
  const notes: { message: string; tone?: string }[] = [];
  const view = await mount(element({
    run: { ...run, heldPaths: ["docs/guide.md"] },
    actions: actions({
      restoreHeldPaths: () => pending,
      notify: (message, tone) => { notes.push({ message, tone }); },
    }),
  }));
  try {
    await click(button(view, "Put this file back"));
    assert.match(view.text(), /Put held files back\?/);
    assert.match(view.text(), /Put 1 held file back to this run's base version\? Edits to that file will be removed, while any other changed files stay as they are\./);
    await click(button(view, "Put these files back"));
    assert.ok(button(view, "Putting back…").hasAttribute("disabled"));
    assert.ok(button(view, "Check again").hasAttribute("disabled"));
    assert.ok(button(view, "Cancel").hasAttribute("disabled"));
    const other = { path: "src/other.ts" } as DiffFile;
    await act(async () => { finish({ restored: 1, files: [other] }); await pending; });
    assert.doesNotMatch(view.text(), /Put held files back\?/);
    assert.deepEqual(notes, [{ message: "1 file restored. Other changes were kept.", tone: "success" }]);
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

test("409 busy and 403 notJoined errors surface the server sentence while stale and 503 keep recovery fallbacks", async () => {
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
    await click(view.container.querySelectorAll((n) => n.nodeName === "BUTTON" && n.textContent === "Put these files back").at(-1)!);

    failWith = new ApiError("Stale", { status: 409, details: { reason: "stale" } });
    await click(view.container.querySelectorAll((n) => n.nodeName === "BUTTON" && n.textContent === "Put these files back").at(-1)!);

    failWith = new ApiError("Join the group on the Group page first.", { status: 403, details: { reason: "notJoined" } });
    await click(button(view, "Check again"));

    failWith = new ApiError("Group stopped", { status: 503, details: { reason: "holdsUnknown" } });
    await click(button(view, "Check again"));

    assert.equal(notes[0]?.message, "Work is still running on this contribution.");
    assert.equal(notes[1]?.message, "Work is still running on this contribution.");
    assert.match(notes[2]?.message ?? "", /The working directory changed/);
    assert.equal(notes[3]?.message, "Join the group on the Group page first.");
    assert.match(notes[4]?.message ?? "", /Couldn't check file holds right now/);
  } finally {
    await view.unmount();
  }
});
