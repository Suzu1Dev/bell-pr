// runIndependentReview's options for the Learn-by-hand review at Ready
// (DESIGN v1.2 F8): its own prompts and reviewer schema, isolated turns, and
// both answers returned. Without options the turns are the team's, as before.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runIndependentReview } from "./run-executor.js";
import { Store } from "./store.js";
import type { TeamAgentInput } from "./team.js";
import type { Run } from "./types.js";
import { Workbench, type WorkbenchContext } from "./workbench.js";

test("the review takes the caller's prompts, stays off run.reports when isolated, and returns both answers", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-by-hand-review-"));
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const calls: TeamAgentInput[] = [];
  const workbench = new Workbench(store, async (input) => {
    calls.push(input);
    return `${input.role} answer`;
  });
  t.after(async () => {
    await workbench.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  const run: Run = {
    id: "review-run",
    repoId: "repo",
    title: "Retry twice",
    prompt: "Retry a GET twice after a 503.",
    status: "review",
    branch: "main",
    baseBranch: "main",
    baseSha: "a".repeat(40),
    worktreePath: directory,
    createdAt: new Date().toISOString(),
    locale: "en",
    agents: [
      { id: "reviewer", name: "Lens", role: "Reviewer", status: "waiting", detail: "" },
      { id: "tester", name: "Scout", role: "Test analyst", status: "waiting", detail: "" },
    ],
    logs: [],
    draft: { title: "Retry twice", body: "" },
    reviewedFiles: [],
    reviewedFingerprints: {},
    reports: {},
  };
  store.data.runs.push(run);
  const ctx = (workbench as unknown as { context: WorkbenchContext }).context;
  const signal = new AbortController().signal;
  const answers = await runIndependentReview(ctx, run, [], null as unknown as undefined, signal, {
    reviewerPrompt: "Review the person's change.",
    testerPrompt: "Read the person's tests.",
    isolated: true,
  });
  assert.deepEqual(answers, { reviewer: "reviewer answer", tester: "tester answer" });
  assert.deepEqual(calls.map((call) => [call.role, call.prompt.startsWith(call.role === "reviewer" ? "Review the person's change." : "Read the person's tests."), call.readonly]), [
    ["reviewer", true, true],
    ["tester", true, true],
  ]);
  assert.deepEqual(run.reports, {});
  // Without options: the team prompts, stored in run.reports, as before.
  const team = await runIndependentReview(ctx, run, [], "The lead's summary.", signal);
  assert.deepEqual(team, { reviewer: "reviewer answer", tester: "tester answer" });
  assert.equal(run.reports?.reviewer, "reviewer answer");
  assert.ok(!calls[2].prompt.startsWith("Review the person's change."));
});
