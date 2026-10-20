// The flow of a Learn-by-hand run on the server (DESIGN v1.2 F3-F5, F11):
// the guide's read-only orientation turn and its outline kept outside
// team.tasks, the person's plan and the outline reveals, confirming the
// plan, step state, check-ins and leaving, Ready for review, approval of
// the ready version only, no AI PR text, and the PR template. The agent
// runner is a fake that records every call; fake codex, claude and gh come
// first on PATH.
import test, { after, before, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { aiDisclosureLine, withAiDisclosure } from "../shared/drafts.js";
import { changeFingerprint } from "../shared/understanding.js";
import { readDiff, reviewFingerprint } from "./git.js";
import { byHandReviewInTests } from "./by-hand.js";
import { applyAiDisclosure, parseDraftProposal, setAlwaysDiscloseAiSource } from "./drafts.js";
import { withLocale } from "./i18n/index.js";
import { git } from "./process.js";
import { Store } from "./store.js";
import type { TeamAgentInput } from "./team.js";
import { AppError, type Run } from "./types.js";
import { skipUnderstandingCheckInTests } from "./understanding.js";
import { Workbench, type WorkbenchContext } from "./workbench.js";

const previousPath = process.env.PATH;
let fakeBin: string;

before(async () => {
  fakeBin = await mkdtemp(path.join(os.tmpdir(), "bell-by-hand-flow-bin-"));
  for (const name of ["codex", "claude", "gh"])
    await writeFile(path.join(fakeBin, name), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  process.env.PATH = `${fakeBin}${path.delimiter}${previousPath}`;
});

after(async () => {
  process.env.PATH = previousPath;
  await rm(fakeBin, { recursive: true, force: true });
});

const refused = (status: number, message: RegExp) => (error: unknown) =>
  error instanceof AppError && error.statusCode === status && message.test(error.message);
const en = <T>(fn: () => Promise<T>) => withLocale("en", fn);

const retrySource = [
  "export const attempts = 1;",
  "",
  "export async function getPage(url: string) {",
  "  const response = await fetch(url);",
  '  if (response.status === 503) throw new Error("Service unavailable");',
  "  return response.text();",
  "}",
  "",
].join("\n");

const orientation = (premise: object | null = {
  verdict: "refuted",
  statement: "The request is retried already.",
  evidence: "There is one attempt: `attempts` is 1, and backoffDelayMs never runs.",
}) =>
  JSON.stringify({
    summary: "A GET that meets a 503 fails at once.\n```ts\nreturn retryTwice(getPage);\n```",
    steps: [
      { title: "Find where the request fails", files: ["src/retry.ts"] },
      { title: "Decide how often to try again", files: [] },
    ],
    readFirst: [
      { path: "src/retry.ts", startLine: 3, endLine: 6, why: "Where the request is sent." },
      { path: "src/retry.ts", startLine: 40, endLine: 60, why: "Past the end of the file." },
    ],
    premise,
  });

async function fixture(t: TestContext, answers: Record<string, string | (() => string)> = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-by-hand-flow-"));
  const repository = path.join(directory, "repo");
  await mkdir(path.join(repository, "src"), { recursive: true });
  await mkdir(path.join(repository, ".github"), { recursive: true });
  await git(repository, ["init", "-b", "main"]);
  await git(repository, ["config", "user.name", "BELL Test"]);
  await git(repository, ["config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(repository, "src", "retry.ts"), retrySource);
  await writeFile(path.join(repository, ".github", "pull_request_template.md"), "## What changed\n\n## How I tested it\n");
  await git(repository, ["add", "--", "."]);
  await git(repository, ["commit", "-m", "initial"]);
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const calls: TeamAgentInput[] = [];
  const replies: Record<string, string | (() => string)> = { lead: orientation(), ...answers };
  const workbench = new Workbench(
    store,
    async (input) => {
      calls.push(input);
      if (!(input.role in replies)) throw new Error(`no answer for ${input.role}`);
      const reply = replies[input.role];
      return typeof reply === "function" ? reply() : reply;
    },
    { getModelCatalog: async (provider) => ({ models: [], source: provider ?? "codex" }) },
  );
  workbench.status = async () => ({
    codex: true,
    codexAuthenticated: true,
    claude: true,
    claudeAuthenticated: true,
    github: false,
  });
  t.after(async () => {
    skipUnderstandingCheckInTests();
    setAlwaysDiscloseAiSource();
    await workbench.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  const repo = await workbench.importRepository(repository);
  const ctx = (workbench as unknown as { context: WorkbenchContext }).context;
  const waitFor = async (done: () => boolean) => {
    for (let index = 0; index < 500 && !done(); index++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(done());
  };
  /** A Learn-by-hand run through createRun and the queue, waiting for the person's plan. */
  const create = async () => {
    const run = await en(() => workbench.createRun(repo.id, "Retry a GET twice after a 503.", "Retry twice", undefined, { learnByHand: true }));
    await waitFor(() => !["queued", "running"].includes(run.status));
    return run;
  };
  const write = (run: Run, content: string) => writeFile(path.join(run.worktreePath, "src", "retry.ts"), content);
  const fingerprint = async (run: Run) => changeFingerprint(await readDiff(run));
  /** Saves a plan, confirms it and writes a change. */
  const writing = async () => {
    const run = await create();
    await en(() => workbench.byHand.savePlan(run.id, { steps: [{ title: "Retry the GET", files: ["src/retry.ts"] }] }));
    await en(() => workbench.approvePlan(run.id));
    await write(run, retrySource.replace("attempts = 1", "attempts = 3"));
    return run;
  };
  return { directory, store, workbench, repo, ctx, calls, replies, waitFor, create, write, fingerprint, writing };
}

test("the guide's orientation turn stores a filtered outline outside team.tasks, so an older build has no plan to approve", async (t) => {
  const f = await fixture(t);
  const run = await f.create();
  assert.equal(run.status, "awaiting_plan", run.error);
  assert.equal(run.team?.phase, "awaiting_approval");
  // One read-only, isolated lead turn; its raw answer reaches neither the reports nor the log.
  assert.deepEqual(f.calls.map((call) => [call.role, call.readonly]), [["lead", true]]);
  assert.equal(run.reports?.lead, undefined);
  assert.ok(!run.logs.some((entry) => entry.message.includes("retryTwice")));
  assert.equal(run.logs.at(-1)?.message, "The guide read the project. Write the steps of your own plan first.");
  const outline = run.byHand?.guidePlan;
  assert.ok(outline);
  assert.doesNotMatch(outline.summary, /```|retryTwice/);
  assert.match(outline.summary, /^A GET that meets a 503 fails at once\./);
  assert.deepEqual(outline.steps.map((step) => step.title), ["Find where the request fails", "Decide how often to try again"]);
  // The range past the end of the file is dropped and counted.
  assert.deepEqual(outline.readFirst, [{ path: "src/retry.ts", startLine: 3, endLine: 6, why: "Where the request is sent." }]);
  assert.equal(outline.dropped, 1);
  assert.ok((outline.removed ?? 0) >= 2);
  assert.equal(run.byHand?.removedTotal, outline.removed);
  assert.equal(run.team?.planSummary, outline.summary);
  // The premise is filtered too, and recorded as explain help; the invented name is gone, the real one stays.
  assert.equal(run.team?.premise?.verdict, "refuted");
  assert.match(run.team?.premise?.evidence ?? "", /`attempts`/);
  assert.doesNotMatch(run.team?.premise?.evidence ?? "", /backoffDelayMs/);
  assert.deepEqual(run.byHand?.events?.map((event) => [event.kind, event.source]), [["explain", "premise"]]);
  assert.equal(run.byHand?.busy, undefined);
  // The guide's outline is not in team.tasks, and the agent cards are the guide, the reviewer and the test analyst.
  assert.deepEqual(run.team?.tasks, []);
  assert.deepEqual(run.agents.map((agent) => agent.id), ["lead", "reviewer", "tester"]);
  // The pre-v1.2 approvePlan condition on the stored run: an older build refuses it.
  assert.equal(run.status !== "awaiting_plan" || !run.team?.tasks.length, true);
});

test("the outline keeps only paths of the checkout: a pattern, a folder's lines or code named as a path is dropped and counted", async (t) => {
  const f = await fixture(t, {
    lead: JSON.stringify({
      summary: "A GET that meets a 503 fails at once.",
      steps: [{ title: "Find where the request fails", files: ["src/retry.ts", "src", "return retryTwice(getPage);", "src/*.ts"] }],
      readFirst: [
        { path: "src/retry.ts", startLine: 1, endLine: 1, why: "The count." },
        // git show <sha>:<path> prints nothing for a missing path with * in it, as for an empty file.
        { path: "src/*.ts", startLine: 1, endLine: 1, why: "A pattern." },
        { path: "if (failed) { return attempts * 2; }", startLine: 1, endLine: 1, why: "Code." },
        { path: "src", startLine: 1, endLine: 1, why: "A folder." },
      ],
      premise: null,
    }),
  });
  const run = await f.create();
  assert.equal(run.status, "awaiting_plan", run.error);
  const outline = run.byHand!.guidePlan!;
  assert.deepEqual(outline.readFirst?.map((range) => range.path), ["src/retry.ts"]);
  assert.deepEqual(outline.steps[0].files, ["src/retry.ts", "src"]);
  assert.equal(outline.dropped, 5);
});

test("a run fitted to rules that don't name planning help keeps none of the outline's step names, also when it plans again", async (t) => {
  const f = await fixture(t);
  const run = await f.create();
  // The help set createRun fixes from the project's carve-out (the QEMU case); a retry runs the orientation again.
  run.byHand!.helpLock = { kinds: ["explain", "answer", "test"], at: run.createdAt, rulesCheckedAt: run.createdAt, rules: [] };
  delete run.byHand!.guidePlan;
  run.status = "failed";
  await en(() => f.workbench.retryTeam(run.id));
  await f.waitFor(() => !["queued", "running"].includes(run.status));
  assert.equal(run.status, "awaiting_plan", run.error);
  assert.equal(f.calls.length, 2);
  const outline = (run as Run).byHand?.guidePlan;
  assert.deepEqual(outline?.steps, []);
  assert.match(outline?.summary ?? "", /^A GET that meets a 503 fails at once\./);
  assert.deepEqual(outline?.readFirst?.map((range) => range.path), ["src/retry.ts"]);
  // Nowhere in what the run detail sends: not in the record, the log or the team.
  assert.doesNotMatch(JSON.stringify(run), /Find where the request fails|Decide how often to try again/);
});

test("a failed orientation or review keeps what the agent wrote in its error out of the run's error and log", async (t) => {
  const leak = "claude failed: The plan is to wrap the call:\n```ts\nreturn retryTwice(getPage);\n```";
  const f = await fixture(t, {
    lead: () => {
      throw new AppError(leak, 422);
    },
  });
  const failed = await f.create();
  assert.equal(failed.status, "failed");
  assert.match(failed.error ?? "", /^claude failed: The plan is to wrap the call:/);
  assert.doesNotMatch(JSON.stringify(failed), /retryTwice|```/);
  // The review job's failure line is filtered too.
  f.replies.lead = orientation();
  const run = await f.writing();
  t.after(() => byHandReviewInTests());
  byHandReviewInTests(async () => {
    throw new Error(leak);
  });
  await en(async () => f.workbench.byHand.ready(run.id, { changeFingerprint: await f.fingerprint(run), review: true }));
  await f.waitFor(() => !f.ctx.byHandJobs.size);
  assert.match(run.logs.at(-1)?.message ?? "", /^The guide's review didn't finish: claude failed: The plan is to wrap the call:/);
  assert.doesNotMatch(JSON.stringify(run), /retryTwice|```/);
});

test("an orientation without a premise records no help, and planByHand leaves team.tasks and the agent cards as they are", async (t) => {
  const f = await fixture(t, { lead: orientation(null) });
  const run = await f.create();
  assert.equal(run.status, "awaiting_plan", run.error);
  assert.equal(run.team?.premise, undefined);
  assert.deepEqual(run.byHand?.events ?? [], []);
  // A run an older build planned as a team run, queued again: its history stays.
  run.status = "queued";
  run.team!.phase = "planning";
  const task = { id: "t1", title: "Add the delay", description: "Wait between attempts.", owner: "member-1", files: ["src/retry.ts"], dependsOn: [], status: "complete" as const };
  run.team!.tasks = [task];
  run.agents.push({ id: "member-1", name: "Teammate 1", role: "Developer", status: "complete", detail: "" });
  f.ctx.enqueue(run.id);
  await f.waitFor(() => run.status === "awaiting_plan" && f.calls.length === 2);
  assert.deepEqual(run.team?.tasks, [task]);
  assert.deepEqual(run.agents.map((agent) => agent.id), ["lead", "reviewer", "tester", "member-1"]);
});

test("the person's plan keeps step ids and state, and its answers stay as confirmed while the person writes", async (t) => {
  const f = await fixture(t);
  const run = await f.create();
  let saved = (await en(() => f.workbench.byHand.savePlan(run.id, {
    steps: [{ id: "mine", title: " Read the request code " }, { title: "Add a second attempt", files: ["src/retry.ts"], how: "Loop once more." }],
    tests: "A fake server that answers 503 then 200.",
    unsure: "Whether POST should retry.",
    prediction: "getPage, because it sends the request.",
  }))).run;
  const plan = saved.byHand!.plan!;
  assert.equal(plan.steps[0].id, "mine");
  assert.equal(plan.steps[0].title, "Read the request code");
  assert.match(plan.steps[1].id, /^s-[0-9a-f]{8}$/);
  assert.equal(plan.steps[1].how, "Loop once more.");
  assert.equal(plan.prediction, "getPage, because it sends the request.");
  // A repeated id gets an id of its own.
  saved = (await en(() => f.workbench.byHand.savePlan(run.id, { steps: [{ id: "mine", title: "One" }, { id: "mine", title: "Two" }] }))).run;
  assert.equal(new Set(saved.byHand!.plan!.steps.map((step) => step.id)).size, 2);
  await en(() => f.workbench.byHand.savePlan(run.id, { steps: [{ id: "mine", title: "Read the request code" }], tests: "" }));
  assert.equal(run.byHand!.plan!.tests, undefined);
  await en(() => f.workbench.approvePlan(run.id));
  // While writing, steps change and keep their state; the prediction stays as confirmed.
  run.byHand!.plan!.steps[0].doneAt = "2026-10-20T00:00:00.000Z";
  saved = (await en(() => f.workbench.byHand.savePlan(run.id, {
    steps: [{ id: "mine", title: "Read the request code again" }, { title: "Test two 503s" }],
    prediction: "Something else after reading the code.",
  }))).run;
  assert.equal(saved.byHand!.plan!.steps[0].doneAt, "2026-10-20T00:00:00.000Z");
  assert.equal(saved.byHand!.plan!.steps[0].title, "Read the request code again");
  assert.equal(saved.byHand!.plan!.prediction, "getPage, because it sends the request.");
  assert.ok(saved.byHand!.plan!.confirmedAt);
  // At the ready version the plan is closed until the next edit.
  await f.write(run, retrySource.replace("attempts = 1", "attempts = 2"));
  await en(async () => f.workbench.byHand.ready(run.id, { changeFingerprint: await f.fingerprint(run), review: false }));
  await assert.rejects(
    en(() => f.workbench.byHand.savePlan(run.id, { steps: [{ title: "Late step" }] })),
    refused(409, /^You can change your plan before you confirm it/),
  );
  await f.write(run, retrySource.replace("attempts = 1", "attempts = 3"));
  await en(() => f.workbench.byHand.savePlan(run.id, { steps: [{ id: "mine", title: "Read the request code" }] }));
});

test("revealing the guide's outline records plan help; comparing waits for a step of the person's own", async (t) => {
  const f = await fixture(t);
  const run = await f.create();
  await assert.rejects(
    en(() => f.workbench.byHand.revealOutline(run.id, { mode: "compare" })),
    refused(409, /^Write at least one step of your own plan first\./),
  );
  assert.deepEqual(run.byHand?.events?.map((event) => event.source), ["premise"]);
  // "I don't know where to start": the names before a first draft, recorded as early.
  await en(() => f.workbench.byHand.revealOutline(run.id, { mode: "names" }));
  const first = run.byHand!.plan!.outlineAt;
  assert.ok(first);
  assert.equal(run.byHand!.plan!.outlineBeforeDraft, true);
  await en(() => f.workbench.byHand.savePlan(run.id, { steps: [{ title: "Read the request code" }] }));
  await en(() => f.workbench.byHand.revealOutline(run.id, { mode: "compare" }));
  assert.equal(run.byHand!.plan!.outlineAt, first);
  assert.deepEqual(
    run.byHand!.events!.map((event) => [event.kind, event.source]),
    [["explain", "premise"], ["plan", "outline"], ["plan", "outline"]],
  );
  // Without an outline (the orientation hasn't run) there is nothing to reveal.
  delete run.byHand!.guidePlan;
  await assert.rejects(
    en(() => f.workbench.byHand.revealOutline(run.id, { mode: "names" })),
    refused(409, /^The guide's outline isn't ready yet\./),
  );
});

test("confirming the plan needs a step of the person's own, starts their turn and queues nothing; a revision is refused", async (t) => {
  const f = await fixture(t);
  const run = await f.create();
  await assert.rejects(
    en(() => f.workbench.revisePlan(run.id, "Use three steps instead.")),
    refused(409, /^In Learn by hand the plan is yours/),
  );
  await assert.rejects(en(() => f.workbench.approvePlan(run.id)), refused(409, /^Write at least one step of your own plan first\./));
  assert.equal(run.status, "awaiting_plan");
  await en(() => f.workbench.byHand.savePlan(run.id, { steps: [{ title: "Retry the GET" }] }));
  const confirmed = await en(() => f.workbench.approvePlan(run.id));
  assert.equal(confirmed.status, "review");
  assert.equal(confirmed.team?.phase, "developing");
  assert.ok(confirmed.team?.approvedAt);
  assert.equal(confirmed.byHand?.plan?.confirmedAt, confirmed.team?.approvedAt);
  assert.equal(confirmed.logs.at(-1)?.message, "Your turn: write the change.");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(run.status, "review");
  assert.deepEqual(run.team?.tasks, []);
  assert.equal(f.calls.length, 1);
  // Still refused after the confirm: a revision would erase the run's history.
  await assert.rejects(en(() => f.workbench.revisePlan(run.id, "Again.")), refused(409, /^In Learn by hand the plan is yours/));
});

test("steps record done, parked, the why after R3 or R4, an R3 choice and R0 uses; check-ins and leaving record the exits", async (t) => {
  const f = await fixture(t);
  const run = await f.writing();
  const stepId = run.byHand!.plan!.steps[0].id;
  await assert.rejects(en(() => f.workbench.byHand.updateStep(run.id, "missing", { done: true })), refused(404, /no longer in your plan/));
  // After R3 a step needs the person's own why (at least 5 words) before it is done.
  run.byHand!.plan!.steps[0].maxRung = 3;
  run.byHand!.thread = [
    { id: "e1", at: new Date().toISOString(), kind: "hint", stepId, rung: 3, text: "Two ways.", options: [{ name: "A loop", tradeoff: "Simple." }, { name: "A helper", tradeoff: "Reusable." }] },
    { id: "e2", at: new Date().toISOString(), kind: "hint", stepId, rung: 1, text: "Look at src/retry.ts:4." },
  ];
  await assert.rejects(
    en(() => f.workbench.byHand.updateStep(run.id, stepId, { done: true, why: "It retries." })),
    refused(409, /^Say in one sentence why your change for this step works/),
  );
  assert.equal(run.byHand!.plan!.steps[0].doneAt, undefined);
  assert.equal(run.byHand!.plan!.steps[0].why, undefined);
  await assert.rejects(
    en(() => f.workbench.byHand.updateStep(run.id, stepId, { chosen: { entryId: "e2", option: 0, why: "Simplest." } })),
    refused(409, /^Pick one of the options the guide gave/),
  );
  await assert.rejects(
    en(() => f.workbench.byHand.updateStep(run.id, stepId, { chosen: { entryId: "e1", option: 2, why: "Simplest." } })),
    refused(409, /^Pick one of the options the guide gave/),
  );
  await en(() => f.workbench.byHand.updateStep(run.id, stepId, { chosen: { entryId: "e1", option: 0, why: " Simplest. " }, talked: true }));
  await en(() =>
    f.workbench.byHand.updateStep(run.id, stepId, { done: true, why: "The loop tries the GET once more after a 503." }),
  );
  let step = run.byHand!.plan!.steps[0];
  assert.deepEqual(step.chosen, { entryId: "e1", option: 0, why: "Simplest." });
  assert.ok(step.doneAt);
  assert.equal(step.why, "The loop tries the GET once more after a 503.");
  assert.deepEqual(run.byHand!.talks?.map((talk) => talk.stepId), [stepId]);
  await en(() => f.workbench.byHand.updateStep(run.id, stepId, { done: false, parked: true }));
  step = run.byHand!.plan!.steps[0];
  assert.equal(step.doneAt, undefined);
  assert.ok(step.parkedAt);
  // R0 and the step state are not help.
  assert.deepEqual(run.byHand!.events!.map((event) => event.source), ["premise"]);
  await en(() => f.workbench.byHand.checkIn(run.id, { stepId, signal: "button", choice: "smaller" }));
  await en(() => f.workbench.byHand.checkIn(run.id, { signal: "repeat-failure" }));
  assert.deepEqual(run.byHand!.checkIns!.map((entry) => [entry.stepId, entry.signal, entry.choice]), [
    [stepId, "button", "smaller"],
    [undefined, "repeat-failure", undefined],
  ]);
  await en(() => f.workbench.byHand.leave(run.id));
  assert.ok(run.byHand!.leftAt);
  assert.deepEqual(run.byHand!.exits!.map((entry) => entry.exit), ["smaller", "leave"]);
  assert.equal(run.status, "review");
  assert.equal(run.logs.at(-1)?.message, "You handed this task to the agent team. This run stays as it is.");
});

test("Ready for review binds the current fingerprint; a stale one and an empty change are refused, and a second review needs a test run", async (t) => {
  const f = await fixture(t);
  const run = await f.create();
  await en(() => f.workbench.byHand.savePlan(run.id, { steps: [{ title: "Retry the GET" }] }));
  await en(() => f.workbench.approvePlan(run.id));
  await assert.rejects(
    en(() => f.workbench.byHand.ready(run.id, { changeFingerprint: "0".repeat(16), review: false })),
    refused(409, /^Write a change first/),
  );
  await f.write(run, retrySource.replace("attempts = 1", "attempts = 2"));
  const first = await f.fingerprint(run);
  await assert.rejects(
    en(() => f.workbench.byHand.ready(run.id, { changeFingerprint: "0".repeat(16), review: false })),
    refused(409, /^The change moved since you opened this/),
  );
  await en(() => f.workbench.byHand.ready(run.id, { changeFingerprint: first, leastSure: " The retry count. ", review: false }));
  assert.deepEqual({ ...run.byHand!.ready, at: undefined }, { at: undefined, changeFingerprint: first, leastSure: "The retry count.", review: false });
  assert.equal(run.team?.phase, "complete");
  assert.equal(f.ctx.byHandJobs.size, 0);
  assert.equal(f.calls.length, 1);
  // A review at the next version: the job runs the guide's review turn, which on this
  // branch is still W1A's stub (W2B fills it), so the job ends with that refusal logged.
  await f.write(run, retrySource.replace("attempts = 1", "attempts = 3"));
  const second = await f.fingerprint(run);
  await en(() => f.workbench.byHand.ready(run.id, { changeFingerprint: second, review: true }));
  assert.deepEqual(run.byHand!.readyHistory?.map((entry) => entry.changeFingerprint), [first]);
  await f.waitFor(() => !f.ctx.byHandJobs.size);
  assert.equal(run.byHand!.busy, undefined);
  assert.equal(run.logs.at(-1)?.message, "The guide's review didn't finish: This part of Learn by hand is not available in this build yet.");
  assert.deepEqual(run.reports, {});
  // Once a review is stored, another one needs a test run of this version.
  run.byHand!.reviews = [{ at: new Date().toISOString(), changeFingerprint: second, verified: "No test run.", checked: ["The count"], findings: [] }];
  await assert.rejects(
    en(() => f.workbench.byHand.ready(run.id, { changeFingerprint: second, review: true })),
    refused(409, /^Run your tests on this version first; the tests are the judge\./),
  );
  // Ready without the review is never refused for that.
  await en(() => f.workbench.byHand.ready(run.id, { changeFingerprint: second, review: false }));
  run.byHand!.tests = [{ at: new Date().toISOString(), command: "npm test", changeFingerprint: second, outcome: "passed", ms: 5, reported: true }];
  await en(() => f.workbench.byHand.ready(run.id, { changeFingerprint: second, review: true }));
  await f.waitFor(() => !f.ctx.byHandJobs.size);
  assert.deepEqual(f.calls.filter((call) => !call.readonly), []);
});

test("another review of the same version needs a test run made since the last review", async (t) => {
  const f = await fixture(t);
  const run = await f.writing();
  const version = await f.fingerprint(run);
  t.after(() => byHandReviewInTests());
  // W2B's review turn stores the review; this stand-in stores one the same way.
  byHandReviewInTests(async (_ctx, reviewed) => {
    const review = { at: new Date().toISOString(), changeFingerprint: version, verified: "The tests passed.", checked: ["The count"], findings: [] };
    reviewed.byHand!.reviews = [...(reviewed.byHand!.reviews ?? []), review];
  });
  const testRun = (at: number) => ({ at: new Date(at).toISOString(), command: "npm test", changeFingerprint: version, outcome: "passed", ms: 5, reported: true as const });
  // Tested, then reviewed.
  run.byHand!.tests = [testRun(Date.now() - 60_000)];
  await en(() => f.workbench.byHand.ready(run.id, { changeFingerprint: version, review: true }));
  await f.waitFor(() => !f.ctx.byHandJobs.size);
  assert.equal(run.byHand!.reviews?.length, 1);
  // The test run the review already saw doesn't buy a second review of the same version.
  const testFirst = refused(409, /^Run your tests on this version first; the tests are the judge\./);
  await assert.rejects(en(() => f.workbench.byHand.ready(run.id, { changeFingerprint: version, review: true })), testFirst);
  await assert.rejects(en(() => f.workbench.rerunReview(run.id)), testFirst);
  // A test run after the review does.
  run.byHand!.tests.push(testRun(Date.now() + 1000));
  await en(() => f.workbench.byHand.ready(run.id, { changeFingerprint: version, review: true }));
  await f.waitFor(() => !f.ctx.byHandJobs.size);
  assert.equal(run.byHand!.reviews?.length, 2);
});

test("the review job runs the guide's review turn, owns its busy slot and log, and Stop ends it", async (t) => {
  const f = await fixture(t);
  const run = await f.writing();
  const version = await f.fingerprint(run);
  const reviews: { leastSure?: string; busy?: string }[] = [];
  const busy = () => run.byHand?.busy?.kind;
  t.after(() => byHandReviewInTests());
  byHandReviewInTests(async (_ctx, reviewed, input) => {
    reviews.push({ ...input, busy: reviewed.byHand?.busy?.kind });
  });
  await en(() => f.workbench.byHand.ready(run.id, { changeFingerprint: version, leastSure: "The count.", review: true }));
  await f.waitFor(() => !f.ctx.byHandJobs.size);
  assert.deepEqual(reviews, [{ leastSure: "The count.", busy: "review" }]);
  assert.equal(busy(), undefined);
  assert.equal(run.logs.at(-1)?.message, "The guide reviewed your change.");
  // The review waits for the run's guide turn or test run, which hold the one busy slot.
  run.byHand!.reviews = [];
  run.byHand!.busy = { kind: "guide", since: new Date().toISOString() };
  await assert.rejects(
    en(() => f.workbench.byHand.ready(run.id, { changeFingerprint: version, review: true })),
    refused(409, /^The guide is already working on this run/),
  );
  await en(() => f.workbench.byHand.ready(run.id, { changeFingerprint: version, review: false }));
  assert.equal(busy(), "guide");
  delete run.byHand!.busy;
  // It clears the slot only while the slot is still its own.
  byHandReviewInTests(async (_ctx, reviewed) => {
    reviewed.byHand!.busy = { kind: "tests", since: new Date().toISOString() };
  });
  await en(() => f.workbench.byHand.ready(run.id, { changeFingerprint: version, review: true }));
  await f.waitFor(() => !f.ctx.byHandJobs.size);
  assert.equal(busy(), "tests");
  delete run.byHand!.busy;
  // Stop aborts the review turn and keeps the run's status.
  byHandReviewInTests(
    (_ctx, _run, _input, signal) =>
      new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("stopped")), { once: true })),
  );
  await en(() => f.workbench.byHand.ready(run.id, { changeFingerprint: version, review: true }));
  assert.equal(busy(), "review");
  await assert.rejects(
    en(() => f.workbench.byHand.ready(run.id, { changeFingerprint: version, review: false })),
    refused(409, /^The guide is already working on this run/),
  );
  const stopped = await en(() => f.workbench.cancel(run.id));
  assert.equal(stopped.status, "review");
  assert.equal(busy(), undefined);
  assert.equal(run.logs.at(-1)?.message, "The guide's review stopped.");
  assert.equal(f.calls.length, 1);
});

test("only tests replace the guide's review turn", async () => {
  const files = (await readdir(import.meta.dirname, { recursive: true }))
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));
  for (const file of files) {
    const source = await readFile(path.join(import.meta.dirname, file), "utf8");
    if (file !== "by-hand.ts") assert.doesNotMatch(source, /byHandReviewInTests/, file);
  }
});

test("approval needs the version the person marked ready, and waits for BELL's test run", async (t) => {
  skipUnderstandingCheckInTests(true);
  const f = await fixture(t);
  const run = await f.writing();
  await git(run.worktreePath, ["config", "user.name", "BELL Test"]);
  await git(run.worktreePath, ["config", "user.email", "test@example.invalid"]);
  run.draft = { title: "Retry a GET twice", body: "Retries a GET twice after a 503." };
  for (const file of await readDiff(run)) await f.workbench.review(run.id, file.path, true, file.fingerprint);
  await assert.rejects(en(() => f.workbench.approve(run.id, { ...run.draft })), refused(409, /^Mark your changes ready for review first\./));
  await en(async () => f.workbench.byHand.ready(run.id, { changeFingerprint: await f.fingerprint(run), review: false }));
  // Never while BELL runs the person's tests (the job `tests:<id>`, server/by-hand-tests.ts).
  const tests = new AbortController();
  f.ctx.controllers.set(`tests:${run.id}`, tests);
  await assert.rejects(
    en(() => f.workbench.approve(run.id, { ...run.draft })),
    refused(409, /^Wait for the tests to finish or stop them, then approve\./),
  );
  assert.equal(run.status, "review");
  f.ctx.controllers.delete(`tests:${run.id}`);
  assert.equal((await en(() => f.workbench.approve(run.id, { ...run.draft }))).status, "approved");
  // Edited after Ready: the reviewed ticks and the ready version both have to come back.
  await f.write(run, retrySource.replace("attempts = 1", "attempts = 4"));
  for (const file of await readDiff(run)) await f.workbench.review(run.id, file.path, true, file.fingerprint);
  await assert.rejects(en(() => f.workbench.approve(run.id, { ...run.draft })), refused(409, /^Mark your changes ready for review first\./));
  await en(async () => f.workbench.byHand.ready(run.id, { changeFingerprint: await f.fingerprint(run), review: false }));
  assert.equal((await en(() => f.workbench.approve(run.id, { ...run.draft }))).status, "approved");
  // An agent run approves as before: no Ready version, and a `tests:` key means nothing to it.
  delete run.learnByHand;
  await f.write(run, retrySource.replace("attempts = 1", "attempts = 5"));
  for (const file of await readDiff(run)) await f.workbench.review(run.id, file.path, true, file.fingerprint);
  f.ctx.controllers.set(`tests:${run.id}`, new AbortController());
  assert.equal((await en(() => f.workbench.approve(run.id, { ...run.draft }))).status, "approved");
  f.ctx.controllers.delete(`tests:${run.id}`);
});

test("approval approves the very version it found ready, also when a file is reverted while it checks", async (t) => {
  skipUnderstandingCheckInTests(true);
  const f = await fixture(t);
  const run = await f.writing();
  await git(run.worktreePath, ["config", "user.name", "BELL Test"]);
  await git(run.worktreePath, ["config", "user.email", "test@example.invalid"]);
  const template = ".github/pull_request_template.md";
  await writeFile(path.join(run.worktreePath, template), "## What changed\n\n## How I tested it\n\n## Notes\n");
  run.draft = { title: "Retry a GET twice", body: "Retries a GET twice after a 503." };
  const atReady = await readDiff(run);
  assert.equal(atReady.length, 2);
  for (const file of atReady) await f.workbench.review(run.id, file.path, true, file.fingerprint);
  await en(() => f.workbench.byHand.ready(run.id, { changeFingerprint: changeFingerprint(atReady), review: false }));
  const diff = f.ctx.diff;
  t.after(() => {
    f.ctx.diff = diff;
  });
  let reads = 0;
  f.ctx.diff = async (id) => {
    // The person reverts one file right after approval read the change.
    if (++reads === 2) await git(run.worktreePath, ["checkout", "--", template]);
    return diff(id);
  };
  assert.equal((await en(() => f.workbench.approve(run.id, { ...run.draft }))).status, "approved");
  assert.equal(run.approvedFingerprint, reviewFingerprint(atReady, run.draft));
});

test("no AI PR text in Learn by hand: no draft, and BELL's AI line is never added, even with Always add on", async (t) => {
  const f = await fixture(t);
  const run = await f.writing();
  await assert.rejects(
    en(() => f.workbench.prepareDraft(run.id)),
    refused(409, /^In Learn by hand, the pull request text is yours; BELL PR doesn't draft it\./),
  );
  setAlwaysDiscloseAiSource(() => true);
  const saved = await en(() => f.workbench.draft(run.id, { title: "Retry a GET twice", body: "I wrote the retry.", aiDisclosure: true }));
  assert.equal(saved.draft.body, "I wrote the retry.");
  assert.ok(!saved.draft.body.includes(aiDisclosureLine));
  const previous = { title: "T", body: "Mine.", aiDisclosure: false };
  assert.equal(applyAiDisclosure(previous, { title: "T", body: "Mine.", aiDisclosure: true }, { learnByHand: true }).body, "Mine.");
  // An agent run's choice still adds the line.
  assert.ok(applyAiDisclosure(previous, { title: "T", body: "Mine.", aiDisclosure: true }).body.includes(aiDisclosureLine));
  // The proposal path: a draft BELL's agents propose never gets the line in a Learn-by-hand run.
  const proposal = JSON.stringify({
    title: "Retry a GET twice",
    body: "Retries a GET after a 503.",
    policy: "linux",
    summary: "Adds one retry.",
    rules: [],
    checklist: [],
    templateSourceId: "",
    commitMessageSuggestion: null,
  });
  const context = { sources: [], warnings: [], checkedAt: new Date().toISOString(), baseSha: run.baseSha };
  assert.ok(!parseDraftProposal(proposal, context, { learnByHand: true }).body.includes(aiDisclosureLine));
  assert.ok(parseDraftProposal(proposal, context).body.includes(aiDisclosureLine));
  assert.equal(f.calls.length, 1);
});

test("BELL's AI line never stays in a Learn-by-hand draft, also from an older client that adds it itself", async (t) => {
  const f = await fixture(t);
  const run = await f.writing();
  t.after(() => setAlwaysDiscloseAiSource(() => false));
  for (const always of [false, true]) {
    setAlwaysDiscloseAiSource(() => always);
    // An older client turns the AI note on: it puts BELL's line into the body and sends the choice.
    const saved = await en(() =>
      f.workbench.draft(run.id, { title: "Retry a GET twice", body: withAiDisclosure("I wrote the retry."), aiDisclosure: true }),
    );
    assert.equal(saved.draft.body, "I wrote the retry.");
    // Its next plain save sends the line back from its editor.
    const again = await en(() => f.workbench.draft(run.id, { title: "Retry a GET twice", body: withAiDisclosure("I wrote the retry. Tested by hand.") }));
    assert.equal(again.draft.body, "I wrote the retry. Tested by hand.");
  }
  // The person's own words about AI stay, as written.
  const own = "I asked BELL PR's guide where the retry lives; I wrote the change myself.";
  assert.equal((await en(() => f.workbench.draft(run.id, { title: "Retry a GET twice", body: own }))).draft.body, own);
  // An agent run keeps the line it adds or that the person keeps.
  const previous = { title: "T", body: "Mine.", aiDisclosure: false };
  assert.ok(applyAiDisclosure(previous, { title: "T", body: withAiDisclosure("Mine."), aiDisclosure: true }).body.includes(aiDisclosureLine));
  assert.ok(applyAiDisclosure({ ...previous, aiDisclosure: true }, { title: "T", body: withAiDisclosure("Mine.") }).body.includes(aiDisclosureLine));
});

test("the PR template comes verbatim from the run's folder: at most three, none over 20 kB", async (t) => {
  const f = await fixture(t);
  const run = await f.writing();
  assert.deepEqual((await en(() => f.workbench.byHand.template(run.id))).templates, [
    { path: ".github/pull_request_template.md", content: "## What changed\n\n## How I tested it\n" },
  ]);
  const folder = path.join(run.worktreePath, ".github", "PULL_REQUEST_TEMPLATE");
  await mkdir(folder, { recursive: true });
  for (const name of ["bug.md", "docs.md", "feature.md"]) await writeFile(path.join(folder, name), `# ${name}\n`);
  await writeFile(path.join(folder, "huge.md"), "x".repeat(20_001));
  await writeFile(path.join(run.worktreePath, "README.md"), "# Not a template\n");
  await git(run.worktreePath, ["add", "--", ".github", "README.md"]);
  const { templates } = await en(() => f.workbench.byHand.template(run.id));
  assert.deepEqual(templates.map((entry) => entry.path), [
    ".github/pull_request_template.md",
    ".github/PULL_REQUEST_TEMPLATE/bug.md",
    ".github/PULL_REQUEST_TEMPLATE/docs.md",
  ]);
  assert.equal(templates[1].content, "# bug.md\n");
});
