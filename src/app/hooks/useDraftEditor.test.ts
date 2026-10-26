import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement, useState } from "react";
import type { DraftCheck } from "../../../shared/draft-checks";
import { aiDisclosureLine } from "../../../shared/drafts";
import { mount } from "../../mission/test-dom";
import type { Run } from "../../types";
import {
  mergePublishChecks,
  savedDisclosure,
  useDraftEditor,
  type DraftEditor,
} from "./useDraftEditor";

const check = (id: DraftCheck["id"], message: string = id): DraftCheck => ({
  id,
  kind: id === "secret" || id === "placeholder" ? "block" : "confirm",
  message,
  details: [],
});

test("the publish dialog asks for the confirmations only the server can check", () => {
  const local = [check("unchecked"), check("brevity")];
  // Before the server's list arrives, the dialog shows the local checks.
  assert.deepEqual(mergePublishChecks(local, undefined), local);
  // The commit e-mail, local folders and CI files come from the server, in its words.
  const server = [
    check("unchecked", "From the server"),
    check("local-paths"),
    check("workflows"),
    check("author-email"),
  ];
  assert.deepEqual(
    mergePublishChecks(local, server).map((item) => [item.id, item.message]),
    [
      ["unchecked", "From the server"],
      ["local-paths", "local-paths"],
      ["workflows", "workflows"],
      ["author-email", "author-email"],
      ["brevity", "brevity"],
    ],
  );
  // An empty server list still keeps what the editor found itself.
  assert.deepEqual(mergePublishChecks(local, []), local);
});

test("turning the AI line on adds it to an agent run's description, never to a Learn-by-hand run's", () => {
  const body = "## Summary\n\nRetries GET requests.";
  const agent = savedDisclosure(body, true);
  assert.equal(agent.choice, true);
  assert.ok(agent.body.endsWith(aiDisclosureLine));
  assert.deepEqual(savedDisclosure(`${body}\n\n${aiDisclosureLine}`, false), { body, choice: false });
  // The person's text is theirs: no line, and no choice that the server would act on.
  for (const choice of [true, false, undefined])
    assert.deepEqual(savedDisclosure(body, choice, true), { body });
  assert.deepEqual(savedDisclosure(body, undefined), { body });
});

test("a draft saved after the team finished leaves the run to the poll, with the saved draft", async () => {
  const running = {
    id: "run-1",
    repoId: "repo-1",
    status: "running",
    baseBranch: "main",
    agents: [],
    draft: { title: "t", body: "b" },
  } as unknown as Run;
  const saved = { title: "Saved title", body: "b" };
  const realFetch = globalThis.fetch;
  // The server already counts the team as finished, so it accepts the save.
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ run: { ...running, status: "review", draft: saved } }), {
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
  let editor: DraftEditor | undefined;
  let shown = running;
  function Probe() {
    const [run, setRun] = useState(running);
    shown = run;
    editor = useDraftEditor({
      run,
      setRun,
      demo: false,
      runIdRef: { current: run.id },
      notify() {},
      setBusy() {},
    });
    return null;
  }
  const mounted = await mount(createElement(Probe));
  try {
    await act(async () => editor!.setDraftTitle(saved.title));
    await act(async () => editor!.saveDraft());
    // Still working here, so the next poll loads the team's diff and applies the run.
    assert.equal(shown.status, "running");
    assert.deepEqual(shown.draft, saved);
  } finally {
    await mounted.unmount();
    globalThis.fetch = realFetch;
  }
});

test("a title saved with a stray space shows as saved, so Approve no longer asks to save first", async () => {
  const review = {
    id: "run-1",
    repoId: "repo-1",
    status: "review",
    baseBranch: "main",
    agents: [],
    draft: { title: "t", body: "b" },
  } as unknown as Run;
  const sent: { title: string }[] = [];
  const realFetch = globalThis.fetch;
  // Like PATCH /runs/:id/draft, the server trims the title it stores.
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const patch = JSON.parse(String(init?.body)) as { title: string; body: string };
    sent.push(patch);
    return new Response(
      JSON.stringify({ run: { ...review, draft: { title: patch.title.trim(), body: patch.body } } }),
      { headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  let editor: DraftEditor | undefined;
  function Probe() {
    const [run, setRun] = useState(review);
    editor = useDraftEditor({
      run,
      setRun,
      demo: false,
      runIdRef: { current: run.id },
      notify() {},
      setBusy() {},
    });
    return null;
  }
  const mounted = await mount(createElement(Probe));
  try {
    // A first save, then a save that leaves the stored title as it was.
    for (const typed of ["Fix the retry bug ", "Fix the retry bug  "]) {
      await act(async () => editor!.setDraftTitle(typed));
      await act(async () => editor!.saveDraft());
      assert.equal(editor!.draftDirty, false);
      assert.equal(editor!.draftTitle, "Fix the retry bug");
      // Approve sends the editor's title, which must match the stored one.
      assert.equal(sent.at(-1)!.title, "Fix the retry bug");
    }
  } finally {
    await mounted.unmount();
    globalThis.fetch = realFetch;
  }
});
