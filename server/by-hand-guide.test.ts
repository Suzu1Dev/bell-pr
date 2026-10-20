// The guide's turns in a Learn-by-hand run (server/by-hand-guide.ts): the
// hint ladder's gates, one turn at a time, quotes cut by BELL and the code
// filter on every stored answer, the help events, a fitted run's help set,
// the structured review at Ready and the per-file chat. The agent runner is
// a fake that records every call and answers what each test scripts; fake
// codex, claude and gh come first on PATH.
import test, { after, before, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import type { HelpLock, TestRun } from "../shared/by-hand.js";
import { createApp } from "./app.js";
import { chat, review } from "./by-hand-guide.js";
import { withLocale } from "./i18n/index.js";
import { fixedLicense } from "./license.js";
import { git } from "./process.js";
import { Store } from "./store.js";
import type { TeamAgentInput } from "./team.js";
import { AppError, type Run } from "./types.js";
import { Workbench, type WorkbenchContext } from "./workbench.js";

const previousPath = process.env.PATH;
let fakeBin: string;

before(async () => {
  fakeBin = await mkdtemp(path.join(os.tmpdir(), "bell-by-hand-guide-bin-"));
  for (const name of ["codex", "claude", "gh"])
    await writeFile(path.join(fakeBin, name), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  process.env.PATH = `${fakeBin}${path.delimiter}${previousPath}`;
});

after(async () => {
  process.env.PATH = previousPath;
  await rm(fakeBin, { recursive: true, force: true });
});

const retrySource = [
  "// Calls fn until it succeeds or the attempts run out.",
  "export async function withRetry(fn, { attempts = 3, delayMs = 100 } = {}) {",
  "  let lastError;",
  "  for (let attempt = 0; attempt < attempts; attempt++) {",
  "    try {",
  "      return await fn();",
  "    } catch (error) {",
  "      lastError = error;",
  "      await new Promise((resolve) => setTimeout(resolve, delayMs * 2 ** attempt));",
  "    }",
  "  }",
  "  throw lastError;",
  "}",
  "",
].join("\n");
const clientSource = [
  'import { withRetry } from "./retry.js";',
  "",
  "// Fetches JSON; network errors are retried.",
  "export async function getJson(url, fetchImpl = fetch) {",
  "  const response = await withRetry(() => fetchImpl(url));",
  "  return response.json();",
  "}",
  "",
].join("\n");

type Answer = string | ((input: TeamAgentInput) => string | Promise<string>);

/** A guide answer in the guide schema's form. */
const answer = (fields: Record<string, unknown> = {}) =>
  JSON.stringify({
    text: "Look at how the client handles the response: src/client.js:5.",
    question: null,
    refs: [{ path: "src/client.js", line: 5, endLine: null }],
    quotes: [],
    options: null,
    topic: "project",
    askedForCode: false,
    ...fields,
  });

const lock: HelpLock = {
  kinds: ["explain", "answer", "test"],
  at: "2026-10-20T00:00:00.000Z",
  rulesCheckedAt: "2026-10-19T00:00:00.000Z",
  rules: [],
};

const refused = (status: number, message: RegExp | string) => (error: unknown) =>
  error instanceof AppError &&
  error.statusCode === status &&
  (typeof message === "string" ? error.message === message : message.test(error.message));

async function fixture(t: TestContext, options: { status?: Run["status"]; helpLock?: HelpLock } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-by-hand-guide-"));
  const repository = path.join(directory, "repo");
  await mkdir(path.join(repository, "src"), { recursive: true });
  await git(repository, ["init", "-b", "main"]);
  await git(repository, ["config", "user.name", "BELL Test"]);
  await git(repository, ["config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(repository, "src", "retry.js"), retrySource);
  await writeFile(path.join(repository, "src", "client.js"), clientSource);
  await git(repository, ["add", "--", "."]);
  await git(repository, ["commit", "-m", "initial"]);
  const baseSha = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const calls: TeamAgentInput[] = [];
  const answers: Answer[] = [];
  const workbench = new Workbench(store, async (input) => {
    calls.push(input);
    const next = answers.shift() ?? answer();
    return typeof next === "function" ? next(input) : next;
  });
  t.after(async () => {
    await workbench.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  const repo = await workbench.importRepository(repository);
  const run: Run = {
    id: "lbh-guide-run",
    repoId: repo.id,
    title: "Retry a 503",
    prompt: "Retry a GET request once more when the server answers 503.",
    status: options.status ?? "review",
    branch: "main",
    baseBranch: "main",
    baseSha,
    worktreePath: repository,
    createdAt: "2026-10-20T00:00:00.000Z",
    locale: "en",
    learnByHand: true,
    modelExecution: { provider: "codex", source: "cli-default" },
    agents: [
      { id: "lead", name: "Atlas", role: "Team lead", status: "waiting", detail: "" },
      { id: "reviewer", name: "Lens", role: "Reviewer", status: "waiting", detail: "" },
      { id: "tester", name: "Scout", role: "Test analyst", status: "waiting", detail: "" },
    ],
    logs: [],
    draft: { title: "Retry a 503", body: "" },
    reviewedFiles: [],
    reviewedFingerprints: {},
    reports: {},
    team: {
      config: { maxTeammates: 2, requirePlanApproval: true, provider: "codex", protocol: "bell-shared-tasks", messageDelivery: "between-turns" },
      phase: options.status === "awaiting_plan" ? "awaiting_approval" : "developing",
      planSummary: "",
      tasks: [],
      messages: [],
    },
    byHand: {
      plan: {
        steps: [
          { id: "s1", title: "Find where a 503 is handled", files: ["src/client.js"] },
          { id: "s2", title: "Test the retry", files: ["test/"] },
        ],
        savedAt: "2026-10-20T00:10:00.000Z",
        ...(options.status === "awaiting_plan" ? {} : { confirmedAt: "2026-10-20T00:11:00.000Z" }),
      },
      ...(options.helpLock ? { helpLock: options.helpLock } : {}),
    },
  };
  store.data.runs.push(run);
  const ctx = (workbench as unknown as { context: WorkbenchContext }).context;
  /** One guide request, run to its end; refusals reject in English. */
  const ask = async (input: Parameters<typeof workbench.byHand.guide>[1]) => {
    await withLocale("en", () => workbench.byHand.guide(run.id, input));
    await ctx.byHandJobs.get(`guide:${run.id}`);
  };
  const questions = async () => {
    await withLocale("en", () => workbench.byHand.planQuestions(run.id));
    await ctx.byHandJobs.get(`guide:${run.id}`);
  };
  const edit = (text: string) => writeFile(path.join(repository, "src", "client.js"), text);
  return { directory, repository, store, workbench, run, calls, answers, ctx, ask, questions, edit };
}

test("hints come in order, each after an attempt: a rung skipped, no attempt, a junk or repeated 'what I tried' are refused", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.ask({ kind: "hint", stepId: "s1", rung: 2 }), refused(409, "Ask for the hints of this step in order, one rung at a time."));
  await f.ask({ kind: "hint", stepId: "s1", rung: 1 });
  assert.equal(f.calls.length, 1);
  const attemptFirst = refused(409, "Try something first: change the code, run the tests, or say what you tried.");
  await assert.rejects(f.ask({ kind: "hint", stepId: "s1", rung: 2 }), attemptFirst);
  await assert.rejects(f.ask({ kind: "hint", stepId: "s1", rung: 2, tried: "idk, nothing yet" }), attemptFirst);
  await assert.rejects(f.ask({ kind: "hint", stepId: "s1", rung: 1 }), attemptFirst);
  // A "what I tried" of five words counts once; the same words again do not.
  await f.ask({ kind: "hint", stepId: "s1", rung: 2, tried: "I read the retry helper loop" });
  await assert.rejects(f.ask({ kind: "hint", stepId: "s1", rung: 3, tried: "I read the retry helper loop!" }), attemptFirst);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.run.byHand?.hints?.s1 && { rung: f.run.byHand.hints.s1.rung, tried: f.run.byHand.hints.s1.tried }, {
    rung: 2,
    tried: "I read the retry helper loop",
  });
  assert.equal(f.run.byHand?.plan?.steps[0].maxRung, 2);
  assert.ok(f.calls.every((call) => call.readonly && call.role === "lead"));
  // Every refusal came before a turn and left nothing behind.
  assert.equal(f.run.byHand?.thread?.length, 2);
  assert.equal(f.run.byHand?.busy, undefined);
});

test("an attempt is an edit, a BELL test run after the hint, or a new 'what I tried'; R4 also follows the repeated-failure card", async (t) => {
  const f = await fixture(t);
  await f.ask({ kind: "hint", stepId: "s1", rung: 1 });
  // The change moved.
  await f.edit(clientSource.replace("  return response.json();", "  if (response.status === 503) return null;\n  return response.json();"));
  await f.ask({ kind: "hint", stepId: "s1", rung: 2 });
  // A test run BELL ran after the hint (one the person reported does not count).
  const hintAt = Date.parse(f.run.byHand!.hints!.s1.at);
  const failed = (minutes: number, extra: Partial<TestRun> = {}): TestRun => ({
    at: new Date(hintAt + minutes * 60_000).toISOString(),
    command: "npm test",
    changeFingerprint: f.run.byHand!.hints!.s1.fingerprint,
    outcome: "failed",
    exitCode: 1,
    ms: 900,
    outputTail: "not ok 1 - retries a 503",
    tailHash: "same",
    ...extra,
  });
  f.run.byHand!.tests = [failed(1, { reported: true })];
  await assert.rejects(f.ask({ kind: "hint", stepId: "s1", rung: 3 }), refused(409, /^Try something first/));
  f.run.byHand!.tests.push(failed(2));
  await f.ask({ kind: "hint", stepId: "s1", rung: 3 });
  assert.equal(f.run.byHand?.hints?.s1.testRunAt, failed(2).at);
  // The same failure three runs in a row, all before the last hint: R4 without another attempt.
  const before = Date.parse(f.run.byHand!.hints!.s1.at) - 60_000;
  f.run.byHand!.tests = [1, 2, 3].map((index) => ({ ...failed(0), at: new Date(before - index * 1000).toISOString() }));
  await f.ask({ kind: "hint", stepId: "s1", rung: 4 });
  assert.deepEqual(f.run.byHand?.thread?.map((entry) => entry.rung), [1, 2, 3, 4]);
  // No hint past R4: the exits.
  await assert.rejects(f.ask({ kind: "ask", entry: "change", stepId: "s1", question: "Now what?" }), refused(409, /^There is no hint after an example in this project\./));
});

test("one guide turn per run: a second request while one runs is refused, and Stop ends it without changing the run", async (t) => {
  const f = await fixture(t);
  let started!: () => void;
  const running = new Promise<void>((resolve) => (started = resolve));
  f.answers.push(
    (input) =>
      new Promise((_resolve, reject) => {
        started();
        input.signal.addEventListener("abort", () => reject(new Error("stopped by the person")));
      }),
  );
  await withLocale("en", () => f.workbench.byHand.guide(f.run.id, { kind: "ask", entry: "project", question: "Where is the status read?" }));
  await running;
  assert.equal(f.run.byHand?.busy?.kind, "guide");
  await assert.rejects(
    withLocale("en", () => f.workbench.byHand.guide(f.run.id, { kind: "hint", stepId: "s1", rung: 1 })),
    refused(409, "The guide is already working on this run. Wait for it to finish, or stop it."),
  );
  // The person's tests running keep the guide waiting too.
  await f.workbench.cancel(f.run.id);
  assert.equal(f.run.status, "review");
  assert.equal(f.run.byHand?.busy, undefined);
  assert.equal(f.ctx.byHandJobs.size, 0);
  assert.equal(f.run.byHand?.thread, undefined);
  assert.equal(f.run.logs.at(-1)?.message, "stopped by the person");
  f.run.byHand!.busy = { kind: "tests", since: new Date().toISOString() };
  await assert.rejects(f.ask({ kind: "ask", entry: "project" }), refused(409, "Your tests are running. Ask the guide when they finish."));
});

test("a stored answer has no code BELL could not find, quotes BELL cut itself, and counts what it removed and dropped", async (t) => {
  const f = await fixture(t);
  // The person's own file, which a "change" quote is cut from.
  const changed = clientSource.replace("  return response.json();", "  if (response.status === 503) throw new Error(\"503\");\n  return response.json();");
  await f.edit(changed);
  f.answers.push(
    answer({
      text: "Call `retryOnStatus` from the loop, like this:\n```js\nif (response.status === 503) await retryOnStatus(response);\n```\nThe loop at src/retry.js:4 already waits between tries.",
      refs: [
        { path: "src/retry.js", line: 4, endLine: 11 },
        { path: "src/retry.js", line: 400, endLine: null },
      ],
      quotes: [
        // From the base commit: the guide said lines 4-6, its anchor is on line 8.
        { path: "src/retry.js", startLine: 4, endLine: 6, from: "base", anchor: "lastError = error;" },
        // From the person's own file.
        { path: "src/client.js", startLine: 6, endLine: 6, from: "change", anchor: "status === 503" },
        // A range outside the file.
        { path: "src/client.js", startLine: 90, endLine: 95, from: "base", anchor: null },
      ],
    }),
  );
  await f.ask({ kind: "ask", entry: "project", question: "How should the loop retry a 503?" });
  const [entry] = f.run.byHand!.thread!;
  assert.doesNotMatch(entry.text, /```|retryOnStatus|await retryOnStatus/);
  assert.match(entry.text, /The loop at src\/retry\.js:4 already waits between tries\./);
  assert.ok((entry.removed ?? 0) >= 2, `removed ${entry.removed}`);
  assert.equal(entry.dropped, 2); // the ref past the file's end and the quote outside it
  assert.deepEqual(entry.refs, [{ path: "src/retry.js", line: 4, endLine: 11 }]);
  assert.deepEqual(entry.quotes, [
    { path: "src/retry.js", from: "base", startLine: 6, endLine: 8, text: retrySource.split("\n").slice(5, 8).join("\n") },
    { path: "src/client.js", from: "change", startLine: 6, endLine: 6, text: '  if (response.status === 503) throw new Error("503");' },
  ]);
  assert.equal(f.run.byHand?.removedTotal, entry.removed);
  assert.deepEqual(
    f.run.byHand?.events?.map(({ kind, source, removed }) => ({ kind, source, removed })),
    [{ kind: "answer", source: "ask", removed: entry.removed }],
  );
});

test("an answer with nothing left but removed code points to its refs, or says BELL removed it", async (t) => {
  const f = await fixture(t);
  f.answers.push(
    answer({ text: "```js\nreturn retry(fn);\n```", refs: [{ path: "src/retry.js", line: 2, endLine: 4 }] }),
    answer({ text: "```js\nreturn retry(fn);\n```", refs: [] }),
  );
  await f.ask({ kind: "ask", entry: "project" });
  await f.ask({ kind: "ask", entry: "project" });
  const [pointer, nothing] = f.run.byHand!.thread!;
  assert.equal(pointer.text, "src/retry.js:2-4");
  assert.equal(nothing.text, "BELL PR removed code from this answer and nothing else was left. Ask again in other words, or ask for the next hint.");
  assert.equal(f.run.byHand?.removedTotal, 2);
});

test("an ask of another entry that the guide finds is about the change keeps only its refs and its question", async (t) => {
  const f = await fixture(t);
  f.answers.push(
    answer({
      text: "Change src/client.js:5 so that a 503 throws.",
      question: "What should a 503 do?",
      topic: "change",
      quotes: [{ path: "src/client.js", startLine: 5, endLine: 5, from: "base", anchor: null }],
      options: [
        { name: "Throw", tradeoff: "Simple." },
        { name: "Return null", tradeoff: "Hides it." },
      ],
    }),
  );
  await f.ask({ kind: "ask", entry: "concept", question: "What is a 503?" });
  const [entry] = f.run.byHand!.thread!;
  assert.equal(entry.text, "This is about your change; use Hint for the next step.");
  assert.equal(entry.ask, "What should a 503 do?");
  assert.deepEqual(entry.refs, [{ path: "src/client.js", line: 5 }]);
  assert.equal(entry.quotes, undefined);
  assert.equal(entry.options, undefined);
  // "My change" itself goes to the ladder instead: the lowest unused rung, a hint.
  await f.ask({ kind: "ask", entry: "change", stepId: "s1", question: "Where does my 503 go?" });
  const routed = f.run.byHand!.thread![1];
  assert.deepEqual({ kind: routed.kind, rung: routed.rung, entry: routed.entry, question: routed.question }, {
    kind: "hint",
    rung: 1,
    entry: "change",
    question: "Where does my 503 go?",
  });
  assert.match(f.calls[1].prompt, /Hint R1, where to look/);
});

test("the guide turn sees the person's plan, the step's diff and the last failure, never the outline", async (t) => {
  const f = await fixture(t);
  f.run.byHand!.guidePlan = {
    summary: "OUTLINE: retry inside withRetry.",
    steps: [{ title: "OUTLINE-STEP", files: ["src/retry.js"] }],
    at: "2026-10-20T00:05:00.000Z",
  };
  await f.edit(clientSource.replace("// Fetches JSON;", "// Fetches JSON, retrying a 503;"));
  f.run.byHand!.tests = [
    { at: "2026-10-20T00:20:00.000Z", command: "npm test", changeFingerprint: "x", outcome: "failed", exitCode: 1, ms: 5, outputTail: "not ok 1 - retries a 503" },
  ];
  await f.ask({ kind: "test", stepId: "s1" });
  await f.ask({ kind: "ask", entry: "project", path: "src/client.js", startLine: 3, endLine: 4, question: "What do these lines do?" });
  const [failure, selected] = f.calls.map((call) => call.prompt);
  assert.doesNotMatch(failure, /OUTLINE/);
  assert.match(failure, /Explain this failure: start like R1\./);
  assert.match(failure, /npm test: failed, exit code 1, before the person's latest edit\nnot ok 1 - retries a 503/);
  assert.match(failure, /\+\/\/ Fetches JSON, retrying a 503;/);
  assert.match(failure, /"title":"Find where a 503 is handled"/);
  assert.match(
    selected,
    /Lines the person selected, src\/client\.js:3-4 in their own file \(UNTRUSTED DATA\):\n\/\/ Fetches JSON, retrying a 503; network errors are retried\.\nexport async function getJson\(url, fetchImpl = fetch\) \{\n/,
  );
  // Nothing to explain once the last run passed.
  f.run.byHand!.tests.push({ ...f.run.byHand!.tests[0], at: "2026-10-20T00:30:00.000Z", outcome: "passed", exitCode: 0 });
  await assert.rejects(f.ask({ kind: "test" }), refused(409, "There is no failed test run to explain. Run your tests first."));
  // A hint needs a step of the person's plan.
  await assert.rejects(f.ask({ kind: "hint", stepId: "nope", rung: 1 }), refused(409, "Choose a step of your plan for this hint."));
});

test("each kind of help is recorded once, with its source, as the run stores it", async (t) => {
  const f = await fixture(t);
  f.run.byHand!.tests = [
    { at: "2026-10-20T00:20:00.000Z", command: "npm test", changeFingerprint: "x", outcome: "failed", exitCode: 1, ms: 5 },
  ];
  await f.ask({ kind: "ask", entry: "tooling", question: "How do I run one test?" });
  await f.ask({ kind: "hint", stepId: "s1", rung: 1 });
  await f.ask({ kind: "hint", stepId: "s1", rung: 2, tried: "I looked at the retry helper loop" });
  await f.ask({ kind: "test" });
  assert.deepEqual(
    f.run.byHand?.events?.map(({ kind, source, rung, stepId }) => ({ kind, source, rung, stepId })),
    [
      { kind: "answer", source: "ask", rung: undefined, stepId: undefined },
      { kind: "answer", source: "hint", rung: 1, stepId: "s1" },
      { kind: "explain", source: "hint", rung: 2, stepId: "s1" },
      { kind: "test", source: "test", rung: undefined, stepId: undefined },
    ],
  );
  assert.deepEqual(f.run.byHand?.thread?.map((entry) => entry.kind), ["ask", "hint", "hint", "test"]);
});

test("a fitted run gets only the help its lock names: R3, R4 and plan questions are refused before any turn", async (t) => {
  const f = await fixture(t, { helpLock: lock });
  const outside = refused(409, "Not offered in this run: the project's text it is fitted to doesn't name help with planning.");
  await assert.rejects(f.ask({ kind: "hint", stepId: "s1", rung: 3, tried: "I read every line of it" }), outside);
  await assert.rejects(f.ask({ kind: "hint", stepId: "s1", rung: 4 }), outside);
  assert.equal(f.calls.length, 0);
  // R1, R2, a question and "Explain this failure" are within the lock.
  await f.ask({ kind: "hint", stepId: "s1", rung: 1 });
  await f.ask({ kind: "hint", stepId: "s1", rung: 2, tried: "I looked at the retry helper loop" });
  await f.ask({ kind: "ask", entry: "project", question: "Where is the status read?" });
  f.run.byHand!.tests = [
    { at: new Date().toISOString(), command: "npm test", changeFingerprint: "x", outcome: "failed", exitCode: 1, ms: 5 },
  ];
  await f.ask({ kind: "test" });
  assert.equal(f.calls.length, 4);
  // "My change" after R2 would be R3: no rung is left, and the exits stay.
  await assert.rejects(
    f.ask({ kind: "ask", entry: "change", stepId: "s1", question: "Is this right?" }),
    refused(409, /^The guide has no more hints for this step in this run: the project's text it is fitted to doesn't name help with planning\. Try an exit instead/),
  );
  assert.equal(f.calls.length, 4);
  assert.deepEqual([...new Set(f.run.byHand?.events?.map((event) => event.kind))], ["answer", "explain", "test"]);
  // Plan questions, before the plan is confirmed.
  f.run.status = "awaiting_plan";
  await assert.rejects(f.questions(), outside);
  assert.equal(f.calls.length, 4);
});

test("a run without a lock gets every rung, plan questions and a routed question after R2", async (t) => {
  const f = await fixture(t);
  await f.ask({ kind: "hint", stepId: "s1", rung: 1 });
  await f.ask({ kind: "hint", stepId: "s1", rung: 2, tried: "I looked at the retry helper loop" });
  await f.ask({ kind: "ask", entry: "change", stepId: "s1", question: "Is my check in the right place?", tried: "I moved the check above the return" });
  await f.ask({ kind: "hint", stepId: "s1", rung: 4, tried: "I compared it with the retry helper" });
  await f.ask({ kind: "ask", entry: "project" });
  f.run.byHand!.tests = [
    { at: new Date().toISOString(), command: "npm test", changeFingerprint: "x", outcome: "failed", exitCode: 1, ms: 5 },
  ];
  await f.ask({ kind: "test" });
  assert.deepEqual(f.run.byHand?.thread?.map((entry) => [entry.kind, entry.rung ?? null]), [
    ["hint", 1],
    ["hint", 2],
    ["hint", 3],
    ["hint", 4],
    ["ask", null],
    ["test", null],
  ]);
  f.run.status = "awaiting_plan";
  await f.questions();
  assert.equal(f.run.byHand?.planQuestions?.length, 1);
  assert.deepEqual(f.run.byHand?.events?.map((event) => event.kind), ["answer", "explain", "plan", "plan", "answer", "test", "plan"]);
  assert.ok(f.calls.every((call) => call.readonly));
});

test("plan questions see the person's plan, never the outline, at most three times, and only before confirming", async (t) => {
  const f = await fixture(t, { status: "awaiting_plan" });
  f.run.byHand!.guidePlan = { summary: "OUTLINE-SUMMARY", steps: [{ title: "OUTLINE-STEP", files: [] }], at: "2026-10-20T00:05:00.000Z" };
  f.answers.push(answer({ text: "1. What will your test send twice?\n2. Should POST retry?", question: "What will your test send twice?", topic: "change", refs: [] }));
  await f.questions();
  assert.match(f.calls[0].prompt, /Questions on the person's plan/);
  assert.match(f.calls[0].prompt, /"title":"Find where a 503 is handled"/);
  assert.doesNotMatch(f.calls[0].prompt, /OUTLINE/);
  const [entry] = f.run.byHand!.planQuestions!;
  assert.equal(entry.kind, "plan");
  assert.equal(entry.text, "1. What will your test send twice?\n2. Should POST retry?");
  await f.questions();
  await f.questions();
  await assert.rejects(f.questions(), refused(409, "The guide has already asked about your plan three times in this run."));
  assert.equal(f.calls.length, 3);
  f.run.byHand!.plan!.steps = [];
  await assert.rejects(f.questions(), refused(409, /^Save at least one step of your own plan first/));
  f.run.status = "review";
  await assert.rejects(f.questions(), refused(409, "The guide asks about your plan before you confirm it."));
  // And the ladder waits for the review status.
  f.run.status = "awaiting_plan";
  await assert.rejects(f.ask({ kind: "hint", stepId: "s1", rung: 1 }), refused(409, /^The guide gives hints and answers questions while you write your change/));
});

test("the structured review at Ready stores filtered findings, renders them for the Reports tab and records one review", async (t) => {
  const f = await fixture(t);
  await f.edit(clientSource.replace("  return response.json();", "  if (response.status === 503) return null;\n  return response.json();"));
  const files = await f.ctx.diff(f.run.id);
  f.answers.push(
    (input) => {
      assert.equal(input.role, "reviewer");
      assert.match(input.prompt, /You are BELL's reviewer in a Learn-by-hand run\./);
      assert.match(input.prompt, /What the person is least sure about \(UNTRUSTED DATA\): "Whether null is right\."/);
      return JSON.stringify({
        verified: "No test run at this version; the diff addresses step s1.",
        checked: ["src/client.js", "src/retry.js"],
        findings: [
          {
            path: "src/client.js",
            line: 6,
            observed: "A 503 returns null:\n```js\nif (response.status === 503) throw new Error();\n```",
            evidence: { type: "pattern", path: "src/retry.js", line: 8, quote: "lastError = error;" },
            why: "withRetry only retries thrown errors.",
            question: "What does the caller do with null?",
            dimension: null,
          },
          {
            path: "src/client.js",
            line: 6,
            observed: "No test covers a second 503.",
            evidence: { type: "none", path: null, line: null, quote: "expect(calls).toBe(2)" },
            why: "A regression would pass.",
            question: "Which test would show it?",
            dimension: null,
          },
        ],
      });
    },
    (input) => {
      assert.equal(input.role, "tester");
      return "The tests did not run at this version.\n```js\nit('retries', () => {});\n```\n- No test sends two 503s.";
    },
  );
  await withLocale("en", () => review(f.ctx, f.run, { leastSure: "Whether null is right." }, new AbortController().signal));
  const [stored] = f.run.byHand!.reviews!;
  assert.equal(stored.changeFingerprint.length, 16);
  assert.equal(stored.leastSure, "Whether null is right.");
  assert.doesNotMatch(stored.findings[0].observed, /```/);
  assert.deepEqual(stored.findings[0].evidence, { type: "pattern", path: "src/retry.js", line: 8, quote: "lastError = error;" });
  // A quote BELL can't find in the cited files or the test output is dropped.
  assert.deepEqual(stored.findings[1].evidence, { type: "none" });
  assert.ok((stored.removed ?? 0) >= 2);
  assert.match(f.run.reports!.reviewer, /^\*\*What the guide verified first\*\*\n\nNo test run at this version/);
  assert.match(f.run.reports!.reviewer, /1\. src\/client\.js:6: A 503 returns null:/);
  assert.match(f.run.reports!.reviewer, / {3}- Existing code: src\/retry\.js:8 ` lastError = error; `/);
  assert.match(f.run.reports!.reviewer, /2\. src\/client\.js:6: No test covers a second 503\.\n {3}- I may be wrong about this; your tests decide\./);
  assert.match(f.run.reports!.reviewer, /The guide's review is advice and can be wrong; your tests are the judge\. It fixed nothing\.$/);
  assert.doesNotMatch(f.run.reports!.tester, /```|it\('retries'/);
  assert.match(f.run.reports!.tester, /- No test sends two 503s\./);
  assert.deepEqual(f.run.byHand?.events?.map(({ kind, source }) => ({ kind, source })), [{ kind: "review", source: "review" }]);
  assert.equal(f.run.byHand?.removedTotal, stored.removed);
  assert.ok(f.calls.every((call) => call.readonly));
  assert.equal(files.length, 1);
  // An answer not in the reviewer's form keeps the earlier reports and stores nothing.
  const reports = { ...f.run.reports };
  f.answers.push("Looks good to me!", "Fine.");
  await assert.rejects(
    withLocale("en", () => review(f.ctx, f.run, {}, new AbortController().signal)),
    refused(422, "The guide's answer was not in the expected form, so nothing was stored. Try again."),
  );
  assert.deepEqual(f.run.reports, reports);
  assert.equal(f.run.byHand?.reviews?.length, 1);
  // A fitted run whose lock lacks review never starts one.
  f.run.byHand!.helpLock = lock;
  await assert.rejects(withLocale("en", () => review(f.ctx, f.run, {}, new AbortController().signal)), refused(409, /^Not offered in this run/));
});

test("after Ready, the per-file chat answers through the guide, filtered, with BELL's quotes", async (t) => {
  const f = await fixture(t);
  await f.edit(clientSource.replace("  return response.json();", "  if (response.status === 503) return null;\n  return response.json();"));
  f.run.conversations = {
    "src/client.js": {
      fingerprint: "old",
      updatedAt: "2026-10-20T00:30:00.000Z",
      messages: [
        { role: "user", content: "Why GET only?", fingerprint: "old" },
        { role: "assistant", content: "GET is safe to repeat.", fingerprint: "old" },
      ],
    },
  };
  f.answers.push(
    answer({
      text: "Your line returns null, and `retryOnStatus` would hide it. The helper at src/retry.js:6 only sees thrown errors.",
      question: "What should the caller see?",
      refs: [{ path: "src/retry.js", line: 6, endLine: null }],
      quotes: [{ path: "src/client.js", startLine: 6, endLine: 6, from: "change", anchor: "503" }],
      topic: "change",
    }),
  );
  const text = await withLocale("en", () => chat(f.ctx, f.run, "src/client.js", "Is returning null fine?", new AbortController().signal));
  assert.equal(
    text,
    [
      "Your line returns null, and … would hide it. The helper at src/retry.js:6 only sees thrown errors.",
      "From your change, src/client.js:6-6:\n```\n  if (response.status === 503) return null;\n```",
      "What should the caller see?",
      "BELL PR removed code from this answer before you saw it.",
    ].join("\n\n"),
  );
  assert.match(f.calls[0].prompt, /The person marked their change ready for review and asks about one file of it/);
  // Only the chat about this version of the file is history; the diff is that file's.
  assert.doesNotMatch(f.calls[0].prompt, /GET is safe to repeat/);
  assert.match(f.calls[0].prompt, /"file":"src\/client\.js","question":"Is returning null fine\?"/);
  assert.deepEqual(f.run.byHand?.events?.map(({ kind, source, removed }) => ({ kind, source, removed })), [
    { kind: "answer", source: "chat", removed: 1 },
  ]);
  assert.equal(f.run.byHand?.thread, undefined);
});

test("no guide turn asks for write access, and none starts while the server stops", async (t) => {
  const f = await fixture(t);
  await f.ask({ kind: "ask", entry: "concept", question: "What is idempotent?" });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].readonly, true);
  await f.workbench.shutdown();
  await assert.rejects(f.ask({ kind: "ask", entry: "concept" }), refused(503, /./));
});

test("over HTTP, a guide turn answers 202 on the Free plan and a refusal is a 409 with its message", async (t) => {
  const f = await fixture(t);
  const app = createApp(f.workbench, { staticDirectory: path.join(f.directory, "missing"), license: fixedLicense("free") });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.locals.insights.shutdown();
    await app.locals.discovery.shutdown();
  });
  const post = (endpoint: string, body: unknown) =>
    new Promise<{ status: number; body: Record<string, ReturnType<typeof JSON.parse>> }>((resolve, reject) => {
      const text = JSON.stringify(body);
      const req = request(
        `http://127.0.0.1:${port}/api/runs/${f.run.id}/${endpoint}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Host: "127.0.0.1:4311", "X-Bell-Locale": "en", "Content-Length": Buffer.byteLength(text) },
        },
        (response) => {
          let received = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => (received += chunk));
          response.on("end", () => resolve({ status: response.statusCode!, body: received ? JSON.parse(received) : {} }));
        },
      );
      req.on("error", reject);
      req.end(text);
    });
  const accepted = await post("by-hand/guide", { kind: "ask", entry: "project", question: "Where is the status read?" });
  assert.equal(accepted.status, 202);
  assert.equal(accepted.body.run.byHand.busy.kind, "guide");
  await f.ctx.byHandJobs.get(`guide:${f.run.id}`);
  assert.equal(f.run.byHand?.thread?.length, 1);
  const skipped = await post("by-hand/guide", { kind: "hint", stepId: "s1", rung: 3 });
  assert.equal(skipped.status, 409);
  assert.equal(skipped.body.error, "Ask for the hints of this step in order, one rung at a time.");
  const tooLate = await post("by-hand/plan/questions", {});
  assert.equal(tooLate.status, 409);
  assert.equal(tooLate.body.error, "The guide asks about your plan before you confirm it.");
  f.run.status = "awaiting_plan";
  assert.equal((await post("by-hand/plan/questions", {})).status, 202);
  await f.ctx.byHandJobs.get(`guide:${f.run.id}`);
  assert.equal(f.run.byHand?.planQuestions?.length, 1);
});
