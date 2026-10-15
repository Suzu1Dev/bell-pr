// The Explain-it-back gate on the server: approve() and publish() refuse
// until the check passed for the current files, unless the person turned
// it off. Fake codex, claude and gh come first on PATH, so no agent CLI or
// GitHub call can run.
import test, { after, before, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import type { ChangeExplanation } from "../shared/explanations.js";
import type { PlannedItem } from "../shared/understanding.js";
import { createApp } from "./index.js";
import { git } from "./process.js";
import { readDiff } from "./git.js";
import { withLocale } from "./i18n/index.js";
import { Store } from "./store.js";
import { AppError, type Run } from "./types.js";
import { Workbench } from "./workbench.js";

const previousPath = process.env.PATH;
let fakeBin: string;

before(async () => {
  fakeBin = await mkdtemp(path.join(os.tmpdir(), "bell-understanding-bin-"));
  for (const name of ["codex", "claude", "gh"])
    await writeFile(path.join(fakeBin, name), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  process.env.PATH = `${fakeBin}${path.delimiter}${previousPath}`;
});

after(async () => {
  process.env.PATH = previousPath;
  await rm(fakeBin, { recursive: true, force: true });
});

const summary =
  "The client now retries failed GET requests with growing random waits, so short outages recover instead of failing at once.";

/** `count` numbered lines of TypeScript, distinct per `name`. */
const lines = (name: string, count: number) =>
  Array.from({ length: count }, (_, index) => `export const ${name}${index} = ${index};`).join("\n") + "\n";

async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-understanding-"));
  const repository = path.join(directory, "repo");
  await mkdir(path.join(repository, "src"), { recursive: true });
  await git(repository, ["init", "-b", "main"]);
  await git(repository, ["config", "user.name", "BELL Test"]);
  await git(repository, ["config", "user.email", "test@example.invalid"]);
  for (const name of ["a", "b"])
    await writeFile(path.join(repository, "src", `${name}.ts`), `export const ${name} = 0;\n`);
  await writeFile(path.join(repository, "README.md"), "# Sample\n");
  await git(repository, ["add", "--", "."]);
  await git(repository, ["commit", "-m", "initial"]);
  const baseSha = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const workbench = new Workbench(store);
  t.after(async () => {
    await workbench.shutdown();
    delete process.env.BELLPR_REQUIRE_UNDERSTANDING_CHECK;
    await rm(directory, { recursive: true, force: true });
  });
  const repo = await workbench.importRepository(repository);
  const run: Run = {
    id: "check-run",
    repoId: repo.id,
    title: "Retry GET requests",
    prompt: "Retry temporary GET failures.",
    status: "review",
    branch: "main",
    baseBranch: "main",
    baseSha,
    worktreePath: repository,
    createdAt: new Date().toISOString(),
    locale: "en",
    agents: [],
    logs: [],
    draft: { title: "Retry GET requests", body: "Retries temporary GET failures." },
    reviewedFiles: [],
    reviewedFingerprints: {},
  };
  store.data.runs.push(run);
  const write = (file: string, text: string) => writeFile(path.join(repository, file), text);
  const reviewAll = async () => {
    for (const file of await readDiff(run))
      if (!file.blocked) await workbench.review(run.id, file.path, true, file.fingerprint);
  };
  return { directory, repository, baseSha, store, workbench, repo, run, write, reviewAll };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

/** An own-words answer for each planned question. */
const answerFor = (item: PlannedItem) =>
  item.source === "untested"
    ? "I did not test a server that sends Retry-After headers."
    : `It adds numbered constants to ${item.path}, one per line.`;

/** Locks answers for every open question, then grades them. */
async function passCheck(f: Fixture, grade: "got" | "partly" = "got") {
  const view = await f.workbench.understanding.status(f.run.id);
  const answered = new Set((view.record?.items ?? []).map((item) => item.id));
  const open = view.plan.filter((item) => !answered.has(item.id) && item.source !== "attempt");
  await f.workbench.understanding.saveAnswers(f.run.id, {
    ...(view.record?.summary ? {} : { summary }),
    items: open.map((item) => ({ id: item.id, answer: answerFor(item), confidence: "think" as const })),
    changeFingerprint: view.changeFingerprint,
    openedAt: new Date(Date.now() - 90_000).toISOString(),
  });
  return f.workbench.understanding.saveGrades(f.run.id, {
    items: open
      .filter((item) => item.source !== "untested")
      .map((item) => ({
        id: item.id,
        grade,
        ...(grade === "partly" ? { correction: "the constants are numbered from zero" } : {}),
      })),
  });
}

const refusedForCheck = (error: unknown) =>
  error instanceof AppError &&
  error.statusCode === 409 &&
  error.code === "understanding_check_required";

test("approve is refused with understanding_check_required while there is no check", async (t) => {
  const f = await fixture(t);
  await f.write("src/a.ts", lines("a", 40));
  await f.reviewAll();
  await assert.rejects(
    withLocale("en", () => f.workbench.approve(f.run.id, { ...f.run.draft })),
    (error: unknown) => {
      assert.ok(refusedForCheck(error));
      assert.match((error as Error).message, /^Explain the change back before you approve or publish/);
      return true;
    },
  );
  assert.equal(f.run.status, "review");
  assert.equal(f.run.approvedFingerprint, undefined);
  // The Reviewed ticks still come first.
  await f.write("src/b.ts", lines("b", 5));
  await assert.rejects(f.workbench.approve(f.run.id, { ...f.run.draft }), /審閱|Review/);
});

test("approve passes after the answers and grades, and the pass is recorded with its time", async (t) => {
  const f = await fixture(t);
  await f.write("src/a.ts", lines("a", 40));
  await f.reviewAll();
  const view = await f.workbench.understanding.status(f.run.id);
  assert.deepEqual(view.plan.map((item) => [item.id, item.question]), [
    ["fallback:src/a.ts", "In one sentence, what does the change to src/a.ts do, and why?"],
    ["untested", "What did you not test, and why?"],
  ]);
  assert.equal(view.required, true);
  assert.deepEqual(view.missing, [
    { part: "summary" },
    { part: "answer", itemId: "fallback:src/a.ts" },
    { part: "answer", itemId: "untested" },
  ]);
  const { understanding } = await passCheck(f, "partly");
  assert.equal(understanding.passed, true);
  const record = f.run.understanding!;
  assert.ok(record.passedAt);
  assert.equal(record.history?.length, 1);
  assert.deepEqual(
    { ...record.history![0], passedAt: "", seconds: undefined },
    { passedAt: "", questions: 2, misses: 1, confidentMisses: 1, seconds: undefined },
  );
  assert.ok(record.history![0].seconds! >= 89 && record.history![0].seconds! <= 120);
  const approved = await f.workbench.approve(f.run.id, { ...f.run.draft });
  assert.equal(approved.status, "approved");
  assert.equal(approved.understandingCheckOff, undefined);
});

test("with the check off approve passes and marks the run, but only when approval succeeds", async (t) => {
  const f = await fixture(t);
  await f.write("src/a.ts", lines("a", 40));
  await f.reviewAll();
  await f.workbench.updateAppSettings({ skipUnderstandingCheck: true });
  assert.equal((await f.workbench.understanding.status(f.run.id)).required, false);
  // An approval that fails later (no PR description) leaves no mark.
  await f.workbench.draft(f.run.id, { title: f.run.draft.title, body: "" });
  await assert.rejects(f.workbench.approve(f.run.id, { ...f.run.draft }), (error: AppError) => error.statusCode === 422);
  assert.equal(f.run.understandingCheckOff, undefined);
  const saved = JSON.parse(await readFile(path.join(f.store.directory, "state.json"), "utf8"));
  assert.equal(saved.runs[0].understandingCheckOff, undefined);
  await f.workbench.draft(f.run.id, { title: f.run.draft.title, body: "Retries temporary GET failures." });
  const approved = await f.workbench.approve(f.run.id, { ...f.run.draft });
  assert.equal(approved.status, "approved");
  assert.equal(approved.understandingCheckOff, true);
  // Approved again with the check passed, the mark goes.
  await f.workbench.updateAppSettings({ skipUnderstandingCheck: null });
  await passCheck(f);
  assert.equal((await f.workbench.approve(f.run.id, { ...f.run.draft })).understandingCheckOff, undefined);
});

test("turned back on, the check holds a run approved without it at publish", async (t) => {
  const f = await fixture(t);
  await f.write("src/a.ts", lines("a", 40));
  await f.reviewAll();
  await f.workbench.updateAppSettings({ skipUnderstandingCheck: true });
  await f.workbench.approve(f.run.id, { ...f.run.draft });
  assert.equal(f.run.understandingCheckOff, true);
  Object.assign(f.repo, {
    url: "https://github.com/test-owner/example",
    fullName: "test-owner/example",
    owner: "test-owner",
    name: "example",
  });
  await f.workbench.updateAppSettings({ skipUnderstandingCheck: false });
  await assert.rejects(f.workbench.publish(f.run.id, f.run.approvedFingerprint!), refusedForCheck);
  assert.ok(!f.run.publishing);
  assert.equal(f.run.publishCommit, undefined);
  // The mark stays: the run was approved without the check.
  assert.equal(f.run.understandingCheckOff, true);
});

/** The test server for one fixture, with the plan given (Free by default). */
async function serve(t: TestContext, f: Fixture) {
  const app = createApp(f.workbench, { staticDirectory: path.join(f.directory, "missing") });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.locals.insights.shutdown();
    await app.locals.discovery.shutdown();
  });
  return (method: string, endpoint: string, body?: unknown) =>
    new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
      const req = request(
        `http://127.0.0.1:${port}/api${endpoint}`,
        {
          method,
          headers: {
            "Content-Type": "application/json",
            Host: "127.0.0.1:4311",
            "X-Bell-Locale": "en",
            ...(body === undefined ? {} : { "Content-Length": Buffer.byteLength(JSON.stringify(body)) }),
          },
        },
        (response) => {
          let text = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => (text += chunk));
          response.on("end", () => resolve({ status: response.statusCode!, body: text ? JSON.parse(text) : {} }));
        },
      );
      req.on("error", reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
}

test("BELLPR_REQUIRE_UNDERSTANDING_CHECK=1 keeps the check on; any other value locks nothing", async (t) => {
  const f = await fixture(t);
  await f.write("src/a.ts", lines("a", 40));
  await f.reviewAll();
  const call = await serve(t, f);
  process.env.BELLPR_REQUIRE_UNDERSTANDING_CHECK = "1";
  const refused = await call("PUT", "/app-settings", { skipUnderstandingCheck: true });
  assert.equal(refused.status, 409);
  assert.deepEqual(refused.body.params, {
    setting: "skipUnderstandingCheck",
    variable: "BELLPR_REQUIRE_UNDERSTANDING_CHECK",
  });
  const view = await call("GET", `/runs/${f.run.id}/understanding`);
  assert.equal((view.body.understanding as { lockedBy?: string }).lockedBy, "BELLPR_REQUIRE_UNDERSTANDING_CHECK");
  const approve = await call("POST", `/runs/${f.run.id}/approve`, { draft: f.run.draft });
  assert.equal(approve.status, 409);
  assert.equal(approve.body.code, "understanding_check_required");
  // "0" locks nothing: the person may turn the check off.
  process.env.BELLPR_REQUIRE_UNDERSTANDING_CHECK = "0";
  assert.equal((await call("PUT", "/app-settings", { skipUnderstandingCheck: true })).status, 200);
  assert.equal((await call("POST", `/runs/${f.run.id}/approve`, { draft: f.run.draft })).status, 200);
  assert.equal(f.run.understandingCheckOff, true);
  // Locked again, the saved choice no longer applies.
  process.env.BELLPR_REQUIRE_UNDERSTANDING_CHECK = "1";
  const locked = await call("GET", `/runs/${f.run.id}/understanding`);
  assert.equal((locked.body.understanding as { required: boolean }).required, true);
});

test("after a file changes the summary is stale and only that file's question is asked again", async (t) => {
  const f = await fixture(t);
  await f.write("src/a.ts", lines("a", 60));
  await f.write("src/b.ts", lines("b", 60));
  await f.reviewAll();
  const first = await f.workbench.understanding.status(f.run.id);
  assert.deepEqual(first.plan.map((item) => item.id), ["fallback:src/a.ts", "fallback:src/b.ts", "untested"]);
  await passCheck(f);
  await f.workbench.approve(f.run.id, { ...f.run.draft });
  await f.write("src/b.ts", lines("b", 62));
  const moved = await f.workbench.understanding.status(f.run.id);
  assert.equal(f.run.status, "review");
  assert.equal(moved.stale, true);
  assert.equal(moved.passed, false);
  assert.deepEqual(moved.plan.map((item) => item.id), ["fallback:src/b.ts", "untested"]);
  assert.deepEqual(moved.missing, [
    { part: "summary-confirm" },
    { part: "answer", itemId: "fallback:src/b.ts" },
  ]);
  // The answers about a.ts and what was not tested stay.
  assert.deepEqual(f.run.understanding?.items?.map((item) => item.id), ["fallback:src/a.ts", "untested"]);
  await f.reviewAll();
  await assert.rejects(f.workbench.approve(f.run.id, { ...f.run.draft }), refusedForCheck);
  // A changed fingerprint in a write is refused.
  await assert.rejects(
    f.workbench.understanding.confirmSummary(f.run.id, { changeFingerprint: first.changeFingerprint }),
    (error: AppError) => error.statusCode === 409,
  );
  await f.workbench.understanding.confirmSummary(f.run.id, { changeFingerprint: moved.changeFingerprint });
  await passCheck(f);
  assert.equal(f.run.understanding?.history?.length, 2);
  assert.equal(f.run.understanding?.history?.[1].questions, 2);
  assert.equal((await f.workbench.approve(f.run.id, { ...f.run.draft })).status, "approved");
});

test("an open follow-up round asks only about the files the round changed", async (t) => {
  const f = await fixture(t);
  await f.write("src/a.ts", lines("a", 60));
  await f.write("src/b.ts", lines("b", 10));
  await f.reviewAll();
  assert.deepEqual(
    (await f.workbench.understanding.status(f.run.id)).plan.map((item) => item.id),
    ["fallback:src/a.ts", "untested"],
  );
  await passCheck(f);
  // The published PR gets a round: the agent changed b.ts only.
  f.run.followUps = [
    {
      id: "round-1",
      requestedAt: new Date().toISOString(),
      feedbackUrls: [],
      note: "Name the constants.",
      status: "review",
      parentCommit: f.baseSha,
    },
  ];
  await f.write("src/b.ts", lines("bee", 30));
  await f.reviewAll();
  const round = await f.workbench.understanding.status(f.run.id);
  assert.deepEqual(round.plan.map((item) => item.id), ["fallback:src/b.ts", "untested"]);
  assert.equal(round.stale, true);
  // In a round the person says what the round changes.
  await f.workbench.understanding.confirmSummary(f.run.id, {
    changeFingerprint: round.changeFingerprint,
    text: "This round renames the constants in b.ts, which answers the review comment about unclear names.",
  });
  await passCheck(f);
  assert.equal(f.run.understanding?.history?.at(-1)?.round, "round-1");
});

const card = (question: string, answer: string): ChangeExplanation => ({
  summary: "Adds numbered constants to the module.",
  reason: "The sample needs many exports.",
  concept: "Exports\nEach line exports one value.",
  tip: "Check the numbering.",
  example: { scenario: "A caller imports a0.", before: "It did not exist.", after: "It is 0." },
  selfCheck: { question, answer },
});

test("a try-first quiz on a picked file counts toward the check and never changes review state", async (t) => {
  const f = await fixture(t);
  await f.write("src/a.ts", lines("a", 40));
  await f.reviewAll();
  const [file] = await readDiff(f.run);
  f.run.explanations = {
    "src/a.ts": {
      fingerprint: file.fingerprint,
      status: "ready",
      content: card("What is the value of a3?", "It is 3, because each constant equals its line number."),
    },
  };
  await f.workbench.updateAppSettings({ skipUnderstandingCheck: true });
  await f.workbench.approve(f.run.id, { ...f.run.draft });
  await f.workbench.updateAppSettings({ skipUnderstandingCheck: null });
  const approvedFingerprint = f.run.approvedFingerprint;
  // A stale fingerprint is refused like a stale review tick.
  await assert.rejects(
    f.workbench.understanding.saveAttempt(f.run.id, { filePath: "src/a.ts", fingerprint: "0".repeat(64), quiz: { answer: "x" } }),
    (error: AppError) => error.statusCode === 409,
  );
  await f.workbench.understanding.saveAttempt(f.run.id, {
    filePath: "src/a.ts",
    fingerprint: file.fingerprint,
    quiz: { answer: "it equals its index three", confidence: "sure" },
    road: { guess: "a generated array" },
  });
  await f.workbench.understanding.saveAttempt(f.run.id, {
    filePath: "src/a.ts",
    fingerprint: file.fingerprint,
    quiz: { grade: "got" },
    road: { choice: "keep", why: "it reads plainly" },
  });
  assert.equal(f.run.status, "approved");
  assert.equal(f.run.approvedFingerprint, approvedFingerprint);
  assert.deepEqual(
    { ...f.run.attempts?.["src/a.ts"]?.quiz, at: "" },
    { answer: "it equals its index three", confidence: "sure", grade: "got", at: "" },
  );
  assert.deepEqual(
    { ...f.run.attempts?.["src/a.ts"]?.road, at: "" },
    { guess: "a generated array", choice: "keep", why: "it reads plainly", at: "" },
  );
  // A graded quiz is final.
  await assert.rejects(
    f.workbench.understanding.saveAttempt(f.run.id, {
      filePath: "src/a.ts",
      fingerprint: file.fingerprint,
      quiz: { answer: "something else entirely here" },
    }),
    (error: AppError) => error.statusCode === 409,
  );
  const view = await f.workbench.understanding.status(f.run.id);
  assert.deepEqual(view.plan.map((item) => [item.id, item.source]), [
    ["attempt:src/a.ts", "attempt"],
    ["untested", "untested"],
  ]);
  // The credited answer is not asked again.
  await assert.rejects(
    f.workbench.understanding.saveAnswers(f.run.id, {
      summary,
      items: [
        { id: "attempt:src/a.ts", answer: "it is three", confidence: "sure" },
        { id: "untested", answer: "nothing with real servers", confidence: "sure" },
      ],
      changeFingerprint: view.changeFingerprint,
    }),
    (error: AppError) => error.statusCode === 409,
  );
  const { understanding } = await f.workbench.understanding.saveAnswers(f.run.id, {
    summary,
    items: [{ id: "untested", answer: "nothing with real servers", confidence: "sure" }],
    changeFingerprint: view.changeFingerprint,
  });
  assert.equal(understanding.passed, true);
  const credited = f.run.understanding?.items?.find((item) => item.id === "attempt:src/a.ts");
  assert.equal(credited?.answer, "it equals its index three");
  assert.equal(credited?.grade, "got");
  assert.equal(f.run.status, "approved");
});

test("a held-back file gets the fallback question and no reference", async (t) => {
  const f = await fixture(t);
  // A tracked file BELL holds back still has its changed lines counted.
  await f.write(".env.production", "SECRET0=0\n");
  await git(f.repository, ["add", "--", ".env.production"]);
  await git(f.repository, ["commit", "-m", "settings"]);
  f.run.baseSha = (await git(f.repository, ["rev-parse", "HEAD"])).stdout.trim();
  await f.write(".env.production", lines("SECRET", 30));
  const [file] = await readDiff(f.run);
  assert.ok(file.blocked);
  const view = await f.workbench.understanding.status(f.run.id);
  assert.deepEqual(view.plan, [
    {
      path: ".env.production",
      fingerprint: file.fingerprint,
      id: "fallback:.env.production",
      source: "fallback",
      question: "In one sentence, what does the change to .env.production do, and why?",
      reference: undefined,
    },
    { id: "untested", source: "untested", question: "What did you not test, and why?" },
  ]);
});

test("the answers are checked: own words, enough of them, one lock, and I don't know at Guessing", async (t) => {
  const f = await fixture(t);
  await f.write("src/a.ts", lines("a", 40));
  await f.reviewAll();
  const [file] = await readDiff(f.run);
  f.run.explanations = {
    "src/a.ts": {
      fingerprint: file.fingerprint,
      status: "ready",
      content: card("What is the value of a3?", "It is 3, because each constant equals its line number."),
    },
  };
  const view = await f.workbench.understanding.status(f.run.id);
  const base = { changeFingerprint: view.changeFingerprint };
  const untested = { id: "untested", answer: "nothing with real servers", confidence: "think" as const };
  const answer = (text: string, extra = {}) => ({ id: "selfCheck:src/a.ts", answer: text, confidence: "think" as const, ...extra });
  const status = (error: unknown) => (error as AppError).statusCode;
  const refusals: [Parameters<typeof f.workbench.understanding.saveAnswers>[1], number][] = [
    [{ ...base, items: [answer("it is three"), untested] }, 422],
    [{ ...base, summary: "Too short.", items: [answer("it is three"), untested] }, 422],
    [{ ...base, summary: "It is 3, because each constant equals its line number. That is all this change does to the module.", items: [answer("it is three"), untested] }, 422],
    [{ ...base, summary, items: [answer("three")] }, 422],
    [{ ...base, summary, items: [answer("three"), untested] }, 422],
    [{ ...base, summary, items: [answer("It is 3, because each constant equals its line number."), untested] }, 422],
    [{ ...base, summary, items: [answer("", { dontKnow: true }), untested] }, 422],
    [{ ...base, summary, items: [answer("it is three"), untested, { ...untested, id: "other" }] }, 422],
    [{ changeFingerprint: "0".repeat(16), summary, items: [answer("it is three"), untested] }, 409],
  ];
  for (const [input, expected] of refusals)
    await assert.rejects(f.workbench.understanding.saveAnswers(f.run.id, input), (error) => status(error) === expected, JSON.stringify(input));
  assert.equal(f.run.understanding?.items, undefined);
  // "I don't know" at Guessing counts as missed and needs a correction.
  await f.workbench.understanding.saveAnswers(f.run.id, {
    ...base,
    summary,
    items: [answer("", { dontKnow: true, confidence: "guess" }), untested],
  });
  const locked = (await f.workbench.understanding.status(f.run.id));
  assert.deepEqual(locked.missing, [{ part: "correction", itemId: "selfCheck:src/a.ts" }]);
  await assert.rejects(
    f.workbench.understanding.saveAnswers(f.run.id, { ...base, items: [] }),
    (error) => status(error) === 409,
  );
  await assert.rejects(
    f.workbench.understanding.saveGrades(f.run.id, { items: [{ id: "selfCheck:src/a.ts", grade: "got" }] }),
    (error) => status(error) === 422,
  );
  await assert.rejects(
    f.workbench.understanding.saveGrades(f.run.id, { items: [{ id: "untested", grade: "got" }] }),
    (error) => status(error) === 422,
  );
  const { understanding } = await f.workbench.understanding.saveGrades(f.run.id, {
    items: [{ id: "selfCheck:src/a.ts", grade: "missed", correction: "each constant equals its index" }],
    forecast: { dimension: "tests", question: "Is the numbering tested?" },
  });
  assert.equal(understanding.passed, true);
  assert.equal(f.run.understanding?.forecast?.dimension, "tests");
  assert.deepEqual(
    { ...f.run.understanding?.history?.[0], passedAt: "", seconds: 0 },
    { passedAt: "", questions: 2, misses: 1, confidentMisses: 0, seconds: 0 },
  );
  // After the pass, answers change only through Start over.
  await assert.rejects(
    f.workbench.understanding.saveGrades(f.run.id, { items: [{ id: "selfCheck:src/a.ts", grade: "missed" }] }),
    (error) => status(error) === 409,
  );
  const restarted = await f.workbench.understanding.restart(f.run.id);
  assert.equal(restarted.understanding.passed, false);
  assert.deepEqual(Object.keys(f.run.understanding ?? {}).sort(), ["forecast", "history"]);
  assert.deepEqual(restarted.understanding.plan.map((item) => item.id), ["selfCheck:src/a.ts", "untested"]);
  // The forecast has its own route too; an empty one removes it.
  await f.workbench.understanding.saveForecast(f.run.id, {});
  assert.equal(f.run.understanding?.forecast, undefined);
});

test("the check is taken only while the run waits for review or approval", async (t) => {
  const f = await fixture(t);
  await f.write("src/a.ts", lines("a", 40));
  for (const status of ["running", "published", "failed"] as const) {
    f.run.status = status;
    await assert.rejects(
      f.workbench.understanding.saveForecast(f.run.id, { dimension: "tests" }),
      (error: AppError) => error.statusCode === 409,
    );
    // Reading it is never refused.
    const view = await f.workbench.understanding.status(f.run.id);
    assert.deepEqual(view.plan, []);
  }
});

test("only test files call skipUnderstandingCheckInTests", async () => {
  const root = path.dirname(new URL(import.meta.url).pathname);
  const found: string[] = [];
  const visit = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "fixtures") await visit(full);
      } else if (/\.ts$/.test(entry.name)) {
        const text = await readFile(full, "utf8");
        if (text.includes("skipUnderstandingCheckInTests")) found.push(path.relative(root, full));
      }
    }
  };
  await visit(root);
  const outside = found.filter((file) => !file.endsWith(".test.ts"));
  assert.deepEqual(outside, ["understanding.ts"]);
  const definition = await readFile(path.join(root, "understanding.ts"), "utf8");
  assert.equal(definition.match(/skipUnderstandingCheckInTests/g)?.length, 1);
  // Every other server test file that calls it uses the before/after pair.
  assert.ok(found.length >= 9, found.join(", "));
});

// The respect checks reach approval, the publish dialog and publishing
// (task 7 of the L1 contracts); the rules themselves are tested in
// shared/draft-checks.test.ts.

test("approve refuses weakened tests until each has a reason", async (t) => {
  const f = await fixture(t);
  await mkdir(path.join(f.repository, "tests"), { recursive: true });
  await f.write("tests/a.test.ts", "it('a', () => {\n  expect(1).toBe(1);\n});\n");
  await git(f.repository, ["add", "--", "tests/a.test.ts"]);
  await git(f.repository, ["commit", "-m", "test"]);
  f.run.baseSha = (await git(f.repository, ["rev-parse", "HEAD"])).stdout.trim();
  await f.write("tests/a.test.ts", "it.skip('a', () => {\n});\n");
  await f.reviewAll();
  await f.workbench.updateAppSettings({ skipUnderstandingCheck: true });
  await assert.rejects(
    withLocale("en", () => f.workbench.approve(f.run.id, { ...f.run.draft })),
    (error: AppError) =>
      error.statusCode === 422 &&
      /^This change weakens tests in 2 places\./.test(error.message) &&
      error.message.includes("tests/a.test.ts:1 added: it.skip('a', () => {") &&
      error.message.includes("tests/a.test.ts:2 removed: expect(1).toBe(1);"),
  );
  f.run.reviewability = {
    testReasons: {
      "tests/a.test.ts#1": "The case is flaky upstream, tracked in issue 12.",
      "tests/a.test.ts#-2": "The case is skipped, so its assertion goes with it.",
    },
  };
  assert.equal((await f.workbench.approve(f.run.id, { ...f.run.draft })).status, "approved");
});

test("the publish dialog shows the project's rules from the stored facts, without calling GitHub", async (t) => {
  const f = await fixture(t);
  await f.write("src/a.ts", lines("a", 40));
  const calls = path.join(f.directory, "gh-calls");
  await writeFile(path.join(fakeBin, "gh"), `#!/bin/sh\necho "$@" >> ${JSON.stringify(calls)}\nexit 1\n`, { mode: 0o755 });
  t.after(() => writeFile(path.join(fakeBin, "gh"), "#!/bin/sh\nexit 1\n", { mode: 0o755 }));
  f.repo.contributionRules = {
    checkedAt: "2026-10-15T00:00:00.000Z",
    findings: [
      { kind: "ban", path: "AI_POLICY.md", line: 4, quote: "Pull requests made with AI tools are not accepted.", contribution: true },
    ],
    filesRead: ["AI_POLICY.md"],
  };
  f.run.contributionFacts = {
    checkedAt: "2026-10-15T00:00:00.000Z",
    unknown: ["door: HTTP 502"],
  };
  const call = await serve(t, f);
  const preflight = await call("GET", `/runs/${f.run.id}/preflight`);
  assert.equal(preflight.status, 200);
  const checks = preflight.body.checks as { id: string; kind: string; details: string[] }[];
  assert.deepEqual(
    checks.filter((check) => !["author-email"].includes(check.id)).map((check) => [check.id, check.kind]),
    [
      ["ai-ban", "block"],
      ["reviewability", "confirm"],
      ["facts-unknown", "confirm"],
    ],
  );
  assert.equal(checks[0].details[1], 'AI_POLICY.md:4: "Pull requests made with AI tools are not accepted."');
  await assert.rejects(readFile(calls, "utf8"), /ENOENT/);
});

test("publish accepts overrides only for someone else's PR, with a 20 to 200 character reason, and records them", async (t) => {
  const f = await fixture(t);
  await f.write("src/a.ts", lines("a", 10));
  await f.reviewAll();
  const call = await serve(t, f);
  const publish = (overrides: unknown) =>
    call("POST", `/runs/${f.run.id}/publish`, { fingerprint: "a".repeat(64), overrides });
  for (const overrides of [
    [{ id: "ai-ban", reason: "This ban does not apply to this change at all." }],
    [{ id: "issue-has-pr", reason: "too short" }],
    [{ id: "issue-has-pr", reason: "x".repeat(201) }],
    [{ id: "issue-has-pr", reason: "Their PR was abandoned in June.", at: "now" }],
    Array.from({ length: 5 }, () => ({ id: "issue-has-pr", reason: "Their PR was abandoned in June." })),
  ])
    assert.equal((await publish(overrides)).status, 400, JSON.stringify(overrides));
  // A valid override reaches publishing, which first checks the approval.
  assert.equal((await publish([{ id: "issue-has-pr", reason: "  Their PR was abandoned in June.  " }])).status, 409);
  // Approved and published through a GitHub origin, the reason is kept on the run.
  await f.workbench.updateAppSettings({ skipUnderstandingCheck: true });
  await f.workbench.approve(f.run.id, { ...f.run.draft });
  Object.assign(f.repo, { url: "https://github.com/test-owner/example", fullName: "test-owner/example", owner: "test-owner", name: "example" });
  f.run.guardOverrides = Array.from({ length: 8 }, (_, index) => ({
    id: "issue-has-pr",
    reason: `An older reason number ${index} for the record.`,
    at: "2026-10-01T00:00:00.000Z",
  }));
  await assert.rejects(
    f.workbench.publish(f.run.id, f.run.approvedFingerprint!, ["facts-unknown"], [
      { id: "issue-has-pr", reason: "  Their PR was abandoned in June.  " },
    ]),
  );
  assert.equal(f.run.guardOverrides?.length, 8);
  assert.equal(f.run.guardOverrides?.at(-1)?.reason, "Their PR was abandoned in June.");
  assert.equal(f.run.guardOverrides?.[0].reason, "An older reason number 1 for the record.");
  // A retry with the same reason records it once.
  await assert.rejects(
    f.workbench.publish(f.run.id, f.run.approvedFingerprint!, ["facts-unknown"], [
      { id: "issue-has-pr", reason: "Their PR was abandoned in June." },
    ]),
  );
  assert.equal(f.run.guardOverrides?.filter((override) => override.reason === "Their PR was abandoned in June.").length, 1);
  assert.equal(f.run.guardOverrides?.[0].reason, "An older reason number 1 for the record.");
  // A publish that a check refuses records nothing.
  f.repo.contributionRules = {
    checkedAt: "2026-10-15T00:00:00.000Z",
    findings: [
      { kind: "ban", path: "AI_POLICY.md", line: 4, quote: "Pull requests made with AI tools are not accepted.", contribution: true },
    ],
    filesRead: ["AI_POLICY.md"],
  };
  await assert.rejects(
    f.workbench.publish(f.run.id, f.run.approvedFingerprint!, ["facts-unknown"], [
      { id: "issue-has-pr", reason: "Another reason that is long enough." },
    ]),
    (error: AppError) => error.statusCode === 422,
  );
  assert.ok(!f.run.guardOverrides?.some((override) => override.reason === "Another reason that is long enough."));
});
