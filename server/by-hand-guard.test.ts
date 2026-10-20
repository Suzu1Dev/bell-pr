// No write turn in a Learn-by-hand run (DESIGN v1.2 F2): the guard in
// runAgent, the branch of executeRun, and the early refusals of the three
// write callers (team retry, follow-up rounds, the conflict agent). The
// agent runner is a fake that records every call; fake codex, claude and gh
// come first on PATH.
import test, { after, before, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { byHandClean } from "../shared/by-hand.js";
import { git } from "./process.js";
import { runAgent } from "./run-executor.js";
import { Store } from "./store.js";
import type { TeamAgentInput } from "./team.js";
import { AppError, type Run } from "./types.js";
import { withLocale } from "./i18n/index.js";
import { Workbench, type WorkbenchContext } from "./workbench.js";

const previousPath = process.env.PATH;
let fakeBin: string;

before(async () => {
  fakeBin = await mkdtemp(path.join(os.tmpdir(), "bell-by-hand-guard-bin-"));
  for (const name of ["codex", "claude", "gh"])
    await writeFile(path.join(fakeBin, name), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  process.env.PATH = `${fakeBin}${path.delimiter}${previousPath}`;
});

after(async () => {
  process.env.PATH = previousPath;
  await rm(fakeBin, { recursive: true, force: true });
});

const refused = (message: RegExp) => (error: unknown) =>
  error instanceof AppError && error.statusCode === 409 && message.test(error.message);

async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-by-hand-guard-"));
  const repository = path.join(directory, "repo");
  await mkdir(repository, { recursive: true });
  await git(repository, ["init", "-b", "main"]);
  await git(repository, ["config", "user.name", "BELL Test"]);
  await git(repository, ["config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(repository, "retry.ts"), "export const attempts = 1;\n");
  await git(repository, ["add", "--", "."]);
  await git(repository, ["commit", "-m", "initial"]);
  const baseSha = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const calls: TeamAgentInput[] = [];
  const workbench = new Workbench(store, async (input) => {
    calls.push(input);
    return "Read the retry loop first.";
  });
  t.after(async () => {
    await workbench.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  const repo = await workbench.importRepository(repository);
  const run: Run = {
    id: "lbh-guard-run",
    repoId: repo.id,
    title: "Retry twice",
    prompt: "Retry a GET twice after a 503.",
    status: "review",
    branch: "main",
    baseBranch: "main",
    baseSha,
    worktreePath: repository,
    createdAt: new Date().toISOString(),
    locale: "en",
    learnByHand: true,
    agents: [
      { id: "lead", name: "Atlas", role: "Team lead", status: "waiting", detail: "" },
      { id: "reviewer", name: "Lens", role: "Reviewer", status: "waiting", detail: "" },
      { id: "tester", name: "Scout", role: "Test analyst", status: "waiting", detail: "" },
    ],
    logs: [],
    draft: { title: "Retry twice", body: "" },
    reviewedFiles: [],
    reviewedFingerprints: {},
    reports: {},
    team: {
      config: { maxTeammates: 2, requirePlanApproval: true, provider: "codex", protocol: "bell-shared-tasks", messageDelivery: "between-turns" },
      phase: "planning",
      planSummary: "",
      tasks: [],
      messages: [],
    },
  };
  store.data.runs.push(run);
  const ctx = (workbench as unknown as { context: WorkbenchContext }).context;
  const waitFor = async (done: () => boolean) => {
    for (let index = 0; index < 400 && !done(); index++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(done());
  };
  return { directory, store, workbench, repo, run, calls, ctx, waitFor };
}

test("runAgent refuses a write turn of a Learn-by-hand run before any agent runs", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    withLocale("en", () => runAgent(f.ctx, f.run, "lead", "Edit retry.ts.", new AbortController().signal, false)),
    refused(/^BELL PR's agents have no write access in a Learn-by-hand run/),
  );
  assert.equal(f.calls.length, 0);
  assert.equal(f.run.agents[0].status, "waiting");
  // A read turn goes ahead, and an agent run's write turn too.
  assert.equal(
    await runAgent(f.ctx, f.run, "lead", "Where is the retry loop?", new AbortController().signal),
    "Read the retry loop first.",
  );
  assert.equal(f.calls.at(-1)?.readonly, true);
  delete f.run.learnByHand;
  await runAgent(f.ctx, f.run, "lead", "Edit retry.ts.", new AbortController().signal, false);
  assert.equal(f.calls.at(-1)?.readonly, false);
});

test("executeRun sends a Learn-by-hand run to the guide's planning, never to the team", async (t) => {
  const f = await fixture(t);
  f.run.status = "queued";
  f.ctx.enqueue(f.run.id);
  await f.waitFor(() => f.run.status === "failed");
  // planByHand (W2A) asks the guide once, read-only; the fake's plain-text answer is not the guide's form.
  assert.equal(f.run.error, "The guide's answer was not in the expected form, so nothing was stored. Try again.");
  assert.deepEqual(f.calls.map((call) => [call.role, call.readonly]), [["lead", true]]);
  assert.deepEqual(f.run.team?.tasks, []);
  assert.deepEqual(f.run.agents.map((agent) => agent.id), ["lead", "reviewer", "tester"]);
});

test("retryTeam re-plans a Learn-by-hand run without an outline, and returns one with an outline to its plan", async (t) => {
  const f = await fixture(t);
  // (a) Failed before the guide's outline existed: the same re-queue as a run without a plan.
  f.run.status = "failed";
  f.run.error = "The service restarted.";
  await withLocale("en", () => f.workbench.retryTeam(f.run.id));
  // The queue reached executeRun's Learn-by-hand branch again: the guide's planning (W2A).
  await f.waitFor(() => f.run.status === "failed" && f.run.error !== "The service restarted.");
  assert.equal(f.run.error, "The guide's answer was not in the expected form, so nothing was stored. Try again.");
  assert.deepEqual(f.calls.map((call) => [call.role, call.readonly]), [["lead", true]]);
  // (b) Cancelled with an outline and no confirmed plan: back to the plan, no agent turn.
  f.run.status = "cancelled";
  f.run.team!.phase = "cancelled";
  f.run.byHand = {
    guidePlan: { summary: "A 503 fails at once.", steps: [{ title: "Find the throw", files: ["retry.ts"] }], at: new Date().toISOString() },
    plan: { steps: [{ id: "s1", title: "Read retry.ts" }], savedAt: new Date().toISOString() },
  };
  const back = await withLocale("en", () => f.workbench.retryTeam(f.run.id));
  assert.equal(back.status, "awaiting_plan");
  assert.equal(back.team?.phase, "awaiting_approval");
  assert.equal(back.logs.at(-1)?.message, "Back to your plan: nothing runs until you confirm it.");
  assert.equal(f.calls.length, 1); // (a)'s planning turn only
  // Past a confirmed plan there is no agent work to retry.
  f.run.status = "failed";
  f.run.byHand.plan!.confirmedAt = new Date().toISOString();
  await assert.rejects(
    withLocale("en", () => f.workbench.retryTeam(f.run.id)),
    refused(/^A Learn-by-hand run goes on from your own edits/),
  );
  assert.equal(f.calls.length, 1); // (a)'s planning turn only
});

test("retryTeam never re-plans a Learn-by-hand run an older build planned as a team run", async (t) => {
  const f = await fixture(t);
  // An older build, which doesn't know the mode, planned the run for teammates who then wrote files.
  f.run.status = "failed";
  f.run.team!.tasks = [
    { id: "t1", title: "Add the delay", description: "Wait between attempts.", owner: "member-1", files: ["retry.ts"], dependsOn: [], status: "failed" },
  ];
  f.run.agents.push({ id: "member-1", name: "Teammate 1", role: "Developer", status: "failed", detail: "" });
  await assert.rejects(
    withLocale("en", () => f.workbench.retryTeam(f.run.id)),
    refused(/^A Learn-by-hand run goes on from your own edits/),
  );
  // The teammate stays on the record, so the run's history still withdraws the claim.
  assert.deepEqual(f.run.agents.map((agent) => agent.id), ["lead", "reviewer", "tester", "member-1"]);
  assert.deepEqual(byHandClean(f.run), { clean: false, reason: "agents" });
  assert.equal(f.run.status, "failed");
  assert.equal(f.calls.length, 0);
});

test("a Learn-by-hand run refuses an AI follow-up round and the conflict agent", async (t) => {
  const f = await fixture(t);
  f.run.status = "published";
  f.run.prUrl = "https://github.com/test-owner/example/pull/1";
  await assert.rejects(
    withLocale("en", () => f.workbench.startFollowUp(f.run.id, { feedbackUrls: [], note: "Rename the helper." })),
    refused(/^In Learn by hand, push follow-up commits from the run's folder with your own Git/),
  );
  f.run.status = "review";
  f.run.sync = { at: new Date().toISOString(), from: f.run.baseSha, to: f.run.baseSha, snapshot: f.run.baseSha, conflicts: ["retry.ts"] };
  await assert.rejects(
    withLocale("en", () => f.workbench.resolveConflicts(f.run.id)),
    refused(/^In Learn by hand, resolve the conflict markers by hand/),
  );
  assert.equal(f.calls.length, 0);
  assert.ok(!f.run.agents.some((agent) => agent.id === "sync" || agent.id === "followup"));
});

test("Stop aborts and awaits a Learn-by-hand job without changing the run's status", async (t) => {
  const f = await fixture(t);
  for (const kind of ["guide", "review", "tests"]) {
    const key = `${kind}:${f.run.id}`;
    const controller = new AbortController();
    f.ctx.controllers.set(key, controller);
    let finished = false;
    const job = new Promise<void>((resolve) =>
      controller.signal.addEventListener("abort", () => setTimeout(() => {
        finished = true;
        resolve();
      }, 20)),
    ).finally(() => {
      f.ctx.byHandJobs.delete(key);
      f.ctx.controllers.delete(key);
    });
    f.ctx.byHandJobs.set(key, job);
    const run = await f.workbench.cancel(f.run.id);
    assert.equal(finished, true, kind);
    assert.equal(run.status, "review");
  }
});
