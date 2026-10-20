// Reading a Learn-by-hand change (DESIGN v1.2 F5, F6, F8, F10): nothing is
// explained, walked through, premise-checked, reviewed again or discussed
// before the person marks the change ready; after Ready, "How a reader sees
// your change" comes one file at a time, after that file's own
// Explain-it-back answer, filtered before it is stored and recorded as
// help; the per-file Ask tab goes to the guide. Agent runs are unchanged.
// The agent runner is a fake that records every call; fake codex, claude
// and gh come first on PATH.
import test, { after, before, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { changeFingerprint, type UnderstandingItem } from "../shared/understanding.js";
import { readDiff } from "./git.js";
import { withLocale } from "./i18n/index.js";
import { git } from "./process.js";
import { Store } from "./store.js";
import type { TeamAgentInput } from "./team.js";
import { AppError, type Run } from "./types.js";
import { byHandReviewInTests } from "./by-hand.js";
import { planUnderstanding, skipUnderstandingCheckInTests } from "./understanding.js";
import { Workbench, type WorkbenchContext } from "./workbench.js";

const previousPath = process.env.PATH;
let fakeBin: string;

before(async () => {
  fakeBin = await mkdtemp(path.join(os.tmpdir(), "bell-by-hand-reading-bin-"));
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
const notReady = refused(409, /^Mark your changes ready for review first\./);

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
// Enough changed lines (over 15) for the check to ask about one file.
const changedSource = `${retrySource.replace("attempts = 1", "attempts = 3")}${Array.from({ length: 20 }, (_, index) => `// Retry note ${index + 1}.`).join("\n")}\n`;

/** The explanation card the fake agent writes for the file the prompt names. */
function explanationAnswer(input: TeamAgentInput) {
  const file = /"path":"([^"]+)","patch"/.exec(input.prompt)?.[1] ?? "src/retry.ts";
  return JSON.stringify({
    files: [
      {
        path: file,
        summary: "The count of `attempts` rises from 1 to 3.",
        reason: "A flaky server stops breaking the page.\n```ts\nwhile (failed) await retryWithJitter();\n```",
        concept: "Retry\nTrying a safe request again.",
        tip: "Test a 503 followed by a 200.",
        example: { scenario: "A shop page loads.", before: "export const attempts = 1;", after: "export const attempts = retryBudget();" },
        alternatives: "A circuit breaker.",
        lookup: ["retry"],
        selfCheck: { question: "Why only GET?", answer: "A GET can be sent twice safely." },
      },
    ],
  });
}

const walkthroughAnswer = JSON.stringify({
  functions: [
    {
      name: "getPage",
      kind: "function",
      startLine: 3,
      endLine: 7,
      summary: "Sends the GET and returns the text; calls backoffWithJitter() first.",
      change: "Nothing here changed.",
      steps: [{ startLine: 4, endLine: 5, explanation: "A 503 throws:\n```ts\nif (status === 503) return retry();\n```" }],
      callers: [],
      callees: [],
      analogy: "A shop that says closed.",
      selfCheck: { question: "What does a 503 do?", answer: "It throws." },
    },
  ],
  newUnits: [],
});

async function fixture(t: TestContext, answers: Record<string, string | ((input: TeamAgentInput) => string)> = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-by-hand-reading-"));
  const repository = path.join(directory, "repo");
  await mkdir(path.join(repository, "src"), { recursive: true });
  await mkdir(path.join(repository, "docs"), { recursive: true });
  await git(repository, ["init", "-b", "main"]);
  await git(repository, ["config", "user.name", "BELL Test"]);
  await git(repository, ["config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(repository, "src", "retry.ts"), retrySource);
  await writeFile(path.join(repository, "docs", "notes.md"), "# Notes\n\nNothing yet.\n");
  await git(repository, ["add", "--", "."]);
  await git(repository, ["commit", "-m", "initial"]);
  const baseSha = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const calls: TeamAgentInput[] = [];
  const replies: Record<string, string | ((input: TeamAgentInput) => string)> = {
    explanations: explanationAnswer,
    walkthrough: walkthroughAnswer,
    guide: "The retry count is in src/retry.ts:1.",
    ...answers,
  };
  const workbench = new Workbench(store, async (input) => {
    calls.push(input);
    const reply = replies[input.role];
    if (reply === undefined) throw new Error(`no answer for ${input.role}`);
    return typeof reply === "function" ? reply(input) : reply;
  });
  t.after(async () => {
    skipUnderstandingCheckInTests();
    await workbench.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  const repo = await workbench.importRepository(repository);
  const ctx = (workbench as unknown as { context: WorkbenchContext }).context;
  const run: Run = {
    id: "lbh-reading-run",
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
      { id: "lead", name: "Atlas", role: "Team lead", status: "complete", detail: "" },
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
      phase: "developing",
      planSummary: "A GET that meets a 503 fails at once.",
      tasks: [],
      messages: [],
    },
    byHand: { plan: { steps: [{ id: "s1", title: "Retry the GET", files: ["src/retry.ts"] }], savedAt: new Date().toISOString(), confirmedAt: new Date().toISOString() } },
  };
  store.data.runs.push(run);
  await writeFile(path.join(repository, "src", "retry.ts"), changedSource);
  await writeFile(path.join(repository, "docs", "notes.md"), "# Notes\n\nRetries a GET twice.\n");
  const files = () => readDiff(run);
  const markReady = async (review = false) =>
    en(async () => workbench.byHand.ready(run.id, { changeFingerprint: changeFingerprint(await files()), review }));
  /** Locks an answer for one planned question, as "Lock my answers" would. */
  const answer = async (id: string) => {
    const item = planUnderstanding(run, await files(), repo).find((entry) => entry.id === id)!;
    const saved: UnderstandingItem = {
      id: item.id,
      ...(item.path ? { path: item.path, fingerprint: item.fingerprint } : {}),
      source: item.source,
      question: item.question,
      answer: "Three attempts because the server recovers within seconds.",
      confidence: "think",
      lockedAt: new Date().toISOString(),
    };
    run.understanding = { ...run.understanding, items: [...(run.understanding?.items ?? []), saved] };
  };
  return { directory, store, workbench, repo, ctx, run, calls, replies, files, markReady, answer };
}

test("before Ready nothing is explained, walked through, premise-checked, reviewed again or discussed", async (t) => {
  const f = await fixture(t);
  await assert.rejects(en(() => f.workbench.explanations(f.run.id)), notReady);
  await assert.rejects(en(() => f.workbench.explanations(f.run.id, { filePath: "src/retry.ts" })), notReady);
  await assert.rejects(en(() => f.workbench.walkthrough(f.run.id, "src/retry.ts")), notReady);
  await assert.rejects(en(() => f.workbench.checkPremise(f.run.id)), notReady);
  await assert.rejects(en(() => f.workbench.rerunReview(f.run.id)), notReady);
  await assert.rejects(en(() => f.workbench.chat(f.run.id, "src/retry.ts", "Why three?")), notReady);
  // Changed after Ready: the same refusals until the person marks it ready again.
  await f.markReady();
  await writeFile(path.join(f.run.worktreePath, "src", "retry.ts"), retrySource.replace("attempts = 1", "attempts = 4"));
  await assert.rejects(en(() => f.workbench.explanations(f.run.id, { filePath: "src/retry.ts" })), notReady);
  await assert.rejects(en(() => f.workbench.walkthrough(f.run.id, "src/retry.ts")), notReady);
  await assert.rejects(en(() => f.workbench.checkPremise(f.run.id)), notReady);
  await assert.rejects(en(() => f.workbench.rerunReview(f.run.id)), notReady);
  assert.equal(f.calls.length, 0);
  assert.equal(f.run.explanations?.["src/retry.ts"]?.status ?? "pending", "pending");
  assert.deepEqual(f.run.byHand?.events ?? [], []);
});

test("after Ready an explanation comes one file at a time, after that file's own answer, filtered and recorded", async (t) => {
  skipUnderstandingCheckInTests(false);
  const f = await fixture(t);
  await f.markReady();
  await assert.rejects(en(() => f.workbench.explanations(f.run.id)), refused(409, /^Ask for one file at a time\./));
  const plan = planUnderstanding(f.run, await f.files(), f.repo);
  const slotted = plan.find((item) => item.path)!;
  const other = (await f.files()).find((file) => !plan.some((item) => item.path === file.path))!;
  assert.ok(slotted && other, "one file has a question and one has none");
  const answerFirst = refused(409, /^Answer this file's Explain-it-back question first/);
  await assert.rejects(en(() => f.workbench.explanations(f.run.id, { filePath: slotted.path })), answerFirst);
  await f.answer(slotted.id);
  const result = await en(() => f.workbench.explanations(f.run.id, { filePath: slotted.path }));
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].readonly, true);
  const stored = f.run.explanations?.[slotted.path!];
  assert.equal(stored?.status, "ready", stored?.error);
  const card = stored!.content!;
  // The filter removed the code block and the invented call; the example's verbatim line stays,
  // its other side is filtered as prose, and the card keeps its example (it is not made again).
  assert.doesNotMatch(card.reason, /```|retryWithJitter/);
  assert.equal(card.example?.before, "export const attempts = 1;");
  assert.doesNotMatch(card.example?.after ?? "", /retryBudget/);
  assert.equal(stored?.status, "ready");
  assert.match(card.summary, /`attempts`/);
  assert.ok(result.files.some((file) => file.path === slotted.path));
  assert.deepEqual(f.run.byHand?.events?.map((event) => [event.kind, event.source]), [["explain", "explanation"]]);
  assert.ok((f.run.byHand?.events?.[0].removed ?? 0) >= 2);
  assert.equal(f.run.byHand?.removedTotal, f.run.byHand?.events?.[0].removed);
  // A file without a question waits until every question is answered.
  await assert.rejects(en(() => f.workbench.explanations(f.run.id, { filePath: other.path })), answerFirst);
  for (const item of plan) if (item.id !== slotted.id) await f.answer(item.id);
  await en(() => f.workbench.explanations(f.run.id, { filePath: other.path }));
  assert.equal(f.calls.length, 2);
});

test("with the understanding check off, an explanation after Ready needs no answer first", async (t) => {
  skipUnderstandingCheckInTests(true);
  const f = await fixture(t);
  await f.markReady();
  await en(() => f.workbench.explanations(f.run.id, { filePath: "src/retry.ts" }));
  assert.equal(f.run.explanations?.["src/retry.ts"]?.status, "ready");
  await assert.rejects(en(() => f.workbench.explanations(f.run.id)), refused(409, /^Ask for one file at a time\./));
});

test("after Ready a walkthrough of the person's code waits for the file's answer and is filtered before it is stored", async (t) => {
  skipUnderstandingCheckInTests(false);
  const f = await fixture(t);
  await f.markReady();
  const slotted = planUnderstanding(f.run, await f.files(), f.repo).find((item) => item.path === "src/retry.ts");
  assert.ok(slotted, "src/retry.ts has a question");
  await assert.rejects(
    en(() => f.workbench.walkthrough(f.run.id, "src/retry.ts")),
    refused(409, /^Answer this file's Explain-it-back question first/),
  );
  await assert.rejects(en(() => f.workbench.walkthrough(f.run.id, "missing.ts")), refused(404, /./));
  await f.answer(slotted.id);
  await en(() => f.workbench.walkthrough(f.run.id, "src/retry.ts"));
  const stored = f.run.walkthroughs?.["src/retry.ts"];
  assert.equal(stored?.status, "ready", stored?.error);
  const unit = stored!.content!.functions[0];
  assert.doesNotMatch(unit.summary, /backoffWithJitter/);
  assert.match(unit.summary, /^Sends the GET and returns the text/);
  assert.doesNotMatch(unit.steps[0].explanation, /```/);
  assert.deepEqual(f.run.byHand?.events?.map((event) => [event.kind, event.source]), [["explain", "walkthrough"]]);
});

test("after Ready the premise check filters its evidence and records explain help", async (t) => {
  const f = await fixture(t, {
    premise: JSON.stringify({
      premise: { verdict: "holds", statement: "A 503 fails at once.", evidence: "It throws; see `getPage` and retryLater()." },
    }),
  });
  await f.markReady();
  const checked = await en(() => f.workbench.checkPremise(f.run.id));
  assert.equal(checked.premise?.verdict, "holds");
  assert.match(f.run.team?.premise?.evidence ?? "", /`getPage`/);
  assert.doesNotMatch(f.run.team?.premise?.evidence ?? "", /retryLater/);
  assert.deepEqual(f.run.byHand?.events?.map((event) => [event.kind, event.source]), [["explain", "premise"]]);
  assert.deepEqual(f.calls.map((call) => [call.role, call.readonly]), [["premise", true]]);
});

test("a failed turn about the person's change keeps what the agent wrote in its error out of the stored errors and the log", async (t) => {
  skipUnderstandingCheckInTests(true);
  const leak = () => {
    throw new AppError("claude failed: Write this:\n```ts\nreturn retryTwice(getPage);\n```", 422);
  };
  const f = await fixture(t, { explanations: leak, walkthrough: leak, premise: leak });
  await f.markReady();
  await en(() => f.workbench.explanations(f.run.id, { filePath: "src/retry.ts" }));
  assert.match(f.run.explanations?.["src/retry.ts"]?.error ?? "", /^claude failed: Write this:/);
  await en(() => f.workbench.walkthrough(f.run.id, "src/retry.ts"));
  assert.match(f.run.walkthroughs?.["src/retry.ts"]?.error ?? "", /^claude failed: Write this:/);
  await assert.rejects(
    en(() => f.workbench.checkPremise(f.run.id)),
    (error) => error instanceof AppError && error.statusCode === 422 && /^claude failed: Write this:/.test(error.message) && !/retryTwice|```/.test(error.message),
  );
  assert.doesNotMatch(JSON.stringify(f.run), /retryTwice|```/);
});

test("a changed premise verdict keeps the walkthroughs whose units were answered and drops the rest", async (t) => {
  const f = await fixture(t, {
    premise: JSON.stringify({ premise: { verdict: "refuted", statement: "A 503 fails at once.", evidence: "It retries." } }),
  });
  // An agent run, which D1's answered walkthrough units belong to.
  delete f.run.learnByHand;
  f.run.team!.premise = { verdict: "holds", statement: "A 503 fails at once.", evidence: "It throws." };
  const [notes, retry] = await f.files();
  const walkthrough = (fingerprint: string) => ({
    fingerprint,
    status: "ready" as const,
    content: { functions: [], newUnits: [] },
    generatedAt: new Date().toISOString(),
  });
  f.run.walkthroughs = { [retry.path]: walkthrough(retry.fingerprint), [notes.path]: walkthrough(notes.fingerprint) };
  f.run.attempts = {
    [retry.path]: { fingerprint: retry.fingerprint, walkthroughs: { "getPage:3": { skipped: true, at: new Date().toISOString() } } },
  };
  await en(() => f.workbench.checkPremise(f.run.id));
  assert.equal(f.run.team?.premise?.verdict, "refuted");
  // The answered one is kept as it was; the other is made again with the new verdict.
  assert.equal(f.run.walkthroughs?.[retry.path]?.status, "ready");
  assert.notEqual(f.run.walkthroughs?.[notes.path]?.status, "ready");
});

test("after Ready the Ask tab goes to the guide; until the guide's turn exists nothing is stored; agent runs keep the mentor", async (t) => {
  const f = await fixture(t);
  await f.markReady();
  // The guide's chat is W2B's; on this branch it still answers 501, and nothing is stored or recorded.
  await assert.rejects(
    en(() => f.workbench.chat(f.run.id, "src/retry.ts", "Why three attempts?")),
    refused(501, /^This part of Learn by hand is not available in this build yet\./),
  );
  const conversation = () => f.run.conversations?.["src/retry.ts"];
  assert.equal(conversation(), undefined);
  assert.deepEqual(f.run.byHand?.events ?? [], []);
  assert.equal(f.calls.length, 0);
  // An agent run's question goes to the mentor and is stored as before.
  delete f.run.learnByHand;
  const answer = await en(() => f.workbench.chat(f.run.id, "src/retry.ts", "Why three attempts?"));
  assert.equal(answer, "The retry count is in src/retry.ts:1.");
  assert.deepEqual(f.calls.map((call) => call.role), ["guide"]);
  assert.deepEqual(
    conversation()?.messages.map((message) => message.role),
    ["user", "assistant"],
  );
});

test("Run the review again on the ready version is the guide's review, never the team's prompts", async (t) => {
  const f = await fixture(t);
  const reviewed: string[] = [];
  t.after(() => byHandReviewInTests());
  // W2B's review turn stores the review; this stand-in stores one the same way.
  byHandReviewInTests(async (_ctx, run) => {
    reviewed.push(run.byHand!.ready!.changeFingerprint);
    run.byHand!.reviews = [
      ...(run.byHand!.reviews ?? []),
      { at: new Date().toISOString(), changeFingerprint: run.byHand!.ready!.changeFingerprint, verified: "No test run.", checked: ["The count"], findings: [] },
    ];
  });
  await f.markReady();
  const run = await en(() => f.workbench.rerunReview(f.run.id));
  assert.equal(run.byHand?.ready?.review, true);
  for (let index = 0; index < 300 && !f.run.byHand?.reviews?.length; index++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(reviewed, [run.byHand?.ready?.changeFingerprint]);
  // No reviewer or test analyst turn with the team's prompts, and nothing written by an agent into the reports.
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.run.reports, {});
  // The second review needs a test run of this version first.
  await assert.rejects(en(() => f.workbench.rerunReview(f.run.id)), refused(409, /^Run your tests on this version first/));
});

test("the Ask tab never displaces a running guide job, so Stop still ends it", async (t) => {
  const f = await fixture(t);
  await f.markReady();
  const key = `guide:${f.run.id}`;
  const controller = new AbortController();
  let stopped = false;
  const job = new Promise<void>((resolve) =>
    controller.signal.addEventListener("abort", () => {
      stopped = true;
      resolve();
    }),
  ).finally(() => {
    f.ctx.byHandJobs.delete(key);
    f.ctx.controllers.delete(key);
  });
  f.ctx.controllers.set(key, controller);
  f.ctx.byHandJobs.set(key, job);
  await assert.rejects(
    en(() => f.workbench.chat(f.run.id, "src/retry.ts", "Why three?")),
    refused(409, /^The guide is already working on this run/),
  );
  assert.equal(f.ctx.controllers.get(key), controller);
  await en(() => f.workbench.cancel(f.run.id));
  assert.equal(stopped, true);
  assert.equal(f.calls.length, 0);
  assert.equal(f.run.conversations?.["src/retry.ts"], undefined);
});
