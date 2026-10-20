// A whole Learn-by-hand run with a fake agent runner (DESIGN v1.2 §17):
// create → the guide's orientation → the person's steps → a reveal →
// confirm → a hand edit → Ready with the guide's review → an explanation
// refused before the person's answer and given after → approval refused
// after an edit past Ready and given after a new Ready. No agent turn has
// write access, team.tasks stays empty and the history stays clean. The
// guide's review turn is W2B's (server/by-hand-guide.ts); until it merges a
// stand-in takes its place. A second run is fitted to a project's rules
// (the QEMU case: explain, answer and test): every help outside that set
// is refused and recorded nowhere. Fake codex, claude and gh come first on
// PATH.
import test, { after, before, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { byHandClean } from "../shared/by-hand.js";
import { changeFingerprint } from "../shared/understanding.js";
import { readDiff } from "./git.js";
import { withLocale } from "./i18n/index.js";
import { git } from "./process.js";
import { Store } from "./store.js";
import type { TeamAgentInput } from "./team.js";
import { AppError, type Run } from "./types.js";
import { skipUnderstandingCheckInTests } from "./understanding.js";
import { byHandReviewInTests } from "./by-hand.js";
import { Workbench, type WorkbenchContext } from "./workbench.js";

const previousPath = process.env.PATH;
let fakeBin: string;

before(async () => {
  fakeBin = await mkdtemp(path.join(os.tmpdir(), "bell-by-hand-whole-bin-"));
  for (const name of ["codex", "claude", "gh"])
    await writeFile(path.join(fakeBin, name), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  process.env.PATH = `${fakeBin}${path.delimiter}${previousPath}`;
});

after(async () => {
  skipUnderstandingCheckInTests();
  process.env.PATH = previousPath;
  await rm(fakeBin, { recursive: true, force: true });
});

const refused = (status: number, message: RegExp) => (error: unknown) =>
  error instanceof AppError && error.statusCode === status && message.test(error.message);
const en = <T>(fn: () => Promise<T>) => withLocale("en", fn);
const outsideFit = (kind: string) => refused(409, new RegExp(`^Not offered in this run: the project's text it is fitted to doesn't name ${kind}\\.`));

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
/** The person's own edit: enough changed lines (over 15) for the check to ask about the file. */
const handEdit = (attempts: number) =>
  `${retrySource.replace("attempts = 1", `attempts = ${attempts}`)}${Array.from({ length: 20 }, (_, index) => `// Retry note ${index + 1}.`).join("\n")}\n`;

const answers: Record<string, string | ((input: TeamAgentInput) => string)> = {
  lead: JSON.stringify({
    summary: "A GET that meets a 503 fails at once, so a flaky server breaks the page.",
    steps: [{ title: "Find where the request fails", files: ["src/retry.ts"] }],
    readFirst: [{ path: "src/retry.ts", startLine: 3, endLine: 6, why: "Where the request is sent." }],
    premise: { verdict: "holds", statement: "A 503 fails at once.", evidence: "getPage throws on a 503." },
  }),
  explanations: (input) =>
    JSON.stringify({
      files: [
        {
          path: /"path":"([^"]+)","patch"/.exec(input.prompt)?.[1] ?? "src/retry.ts",
          summary: "The count of `attempts` rises, so a 503 is tried again.",
          reason: "A flaky server stops breaking the page.",
          concept: "Retry\nTrying a safe request again.",
          tip: "Test a 503 followed by a 200.",
          example: { scenario: "A shop page loads.", before: "The page showed an error.", after: "The page loads on the second try." },
          alternatives: "A circuit breaker.",
          lookup: ["retry"],
          selfCheck: { question: "Why only GET?", answer: "A GET can be sent twice safely." },
        },
      ],
    }),
};

async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-by-hand-whole-"));
  const repository = path.join(directory, "repo");
  await mkdir(path.join(repository, "src"), { recursive: true });
  await git(repository, ["init", "-b", "main"]);
  await git(repository, ["config", "user.name", "BELL Test"]);
  await git(repository, ["config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(repository, "src", "retry.ts"), retrySource);
  await git(repository, ["add", "--", "."]);
  await git(repository, ["commit", "-m", "initial"]);
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const calls: TeamAgentInput[] = [];
  const workbench = new Workbench(
    store,
    async (input) => {
      calls.push(input);
      const reply = answers[input.role];
      if (reply === undefined) throw new Error(`no answer for ${input.role}`);
      return typeof reply === "function" ? reply(input) : reply;
    },
    { getModelCatalog: async (provider) => ({ models: [], source: provider ?? "codex" }) },
  );
  workbench.status = async () => ({ codex: true, codexAuthenticated: true, claude: true, claudeAuthenticated: true, github: false });
  t.after(async () => {
    skipUnderstandingCheckInTests();
    await workbench.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  const repo = await workbench.importRepository(repository);
  const ctx = (workbench as unknown as { context: WorkbenchContext }).context;
  const waitFor = async (done: () => boolean) => {
    for (let index = 0; index < 500 && !done(); index++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(done());
  };
  const create = async () => {
    const run = await en(() => workbench.createRun(repo.id, "Retry a GET twice after a 503.", "Retry twice", undefined, { learnByHand: true }));
    await waitFor(() => run.status === "awaiting_plan" || run.status === "failed");
    assert.equal(run.status, "awaiting_plan", run.error);
    await git(run.worktreePath, ["config", "user.name", "BELL Test"]);
    await git(run.worktreePath, ["config", "user.email", "test@example.invalid"]);
    return run;
  };
  const edit = (run: Run, attempts: number) => writeFile(path.join(run.worktreePath, "src", "retry.ts"), handEdit(attempts));
  const current = async (run: Run) => changeFingerprint(await readDiff(run));
  /** "Lock my answers" for every question of the check, through its own route. */
  const answerAll = async (run: Run) => {
    const view = await en(() => workbench.understanding.status(run.id));
    await en(() =>
      workbench.understanding.saveAnswers(run.id, {
        summary: "I raised the retry count so a GET that meets a 503 is sent again before the page shows an error.",
        items: view.plan.map((item) => ({ id: item.id, answer: "Because the server recovers within a few seconds.", confidence: "think" as const })),
        changeFingerprint: view.changeFingerprint,
      }),
    );
  };
  return { workbench, repo, ctx, calls, waitFor, create, edit, current, answerAll };
}

test("a whole Learn-by-hand run: no write turn, no team task and a clean history", async (t) => {
  skipUnderstandingCheckInTests(false);
  const f = await fixture(t);
  const run = await f.create();
  assert.ok(run.byHand?.guidePlan);
  await en(() => f.workbench.byHand.savePlan(run.id, {
    steps: [{ title: "Read getPage", files: ["src/retry.ts"] }, { title: "Retry once more on a 503" }],
    tests: "A fake server that answers 503 then 200.",
    prediction: "getPage, because it sends the request.",
  }));
  await en(() => f.workbench.byHand.revealOutline(run.id, { mode: "compare" }));
  assert.equal(run.byHand?.plan?.outlineBeforeDraft, undefined);
  await en(() => f.workbench.approvePlan(run.id));
  assert.equal(run.status, "review");
  // The person writes the change in the run's folder.
  await f.edit(run, 3);
  const reviewed: { leastSure?: string; busy?: string }[] = [];
  t.after(() => byHandReviewInTests());
  byHandReviewInTests(async (_ctx, reviewedRun, input) => {
    reviewed.push({ ...input, busy: reviewedRun.byHand?.busy?.kind });
  });
  await en(async () => f.workbench.byHand.ready(run.id, { changeFingerprint: await f.current(run), leastSure: "The count.", review: true }));
  await f.waitFor(() => !f.ctx.byHandJobs.size && !run.byHand?.busy);
  assert.deepEqual(reviewed, [{ leastSure: "The count.", busy: "review" }]);
  assert.equal(run.logs.at(-1)?.message, "The guide reviewed your change.");
  // Before the person's own answer for the file, "How a reader sees your change" waits.
  await assert.rejects(
    en(() => f.workbench.explanations(run.id, { filePath: "src/retry.ts" })),
    refused(409, /^Answer this file's Explain-it-back question first/),
  );
  await f.answerAll(run);
  await en(() => f.workbench.explanations(run.id, { filePath: "src/retry.ts" }));
  assert.equal(run.explanations?.["src/retry.ts"]?.status, "ready");
  // Approval needs the ready version: an edit after Ready is refused until the person marks it ready again.
  skipUnderstandingCheckInTests(true);
  await en(() => f.workbench.draft(run.id, { title: "Retry a GET twice", body: "Retries a GET after a 503; I wrote it in Learn by hand." }));
  await f.edit(run, 2);
  for (const file of await readDiff(run)) await f.workbench.review(run.id, file.path, true, file.fingerprint);
  await assert.rejects(en(() => f.workbench.approve(run.id, { ...run.draft })), refused(409, /^Mark your changes ready for review first\./));
  await en(async () => f.workbench.byHand.ready(run.id, { changeFingerprint: await f.current(run), review: false }));
  assert.equal((await en(() => f.workbench.approve(run.id, { ...run.draft }))).status, "approved");
  // What the run's history shows.
  assert.deepEqual(f.calls.filter((call) => !call.readonly), []);
  assert.deepEqual(f.calls.map((call) => call.role).sort(), ["explanations", "lead"]);
  assert.deepEqual(run.team?.tasks, []);
  assert.deepEqual(byHandClean(run), { clean: true });
  assert.deepEqual(
    run.byHand?.events?.map((event) => [event.kind, event.source]),
    [["explain", "premise"], ["plan", "outline"], ["explain", "explanation"]],
  );
  assert.deepEqual(run.byHand?.readyHistory?.map((entry) => entry.review), [true]);
});

test("a run fitted to the project's rules (explain, answer, test) is refused every other help and records none of it", async (t) => {
  skipUnderstandingCheckInTests(false);
  const f = await fixture(t);
  const run = await f.create();
  // The QEMU case: createRun fixes this set from the project's carve-out (W2G); here it is seeded.
  run.byHand!.helpLock = { kinds: ["explain", "answer", "test"], at: run.createdAt, rulesCheckedAt: run.createdAt, rules: [] };
  await en(() => f.workbench.byHand.savePlan(run.id, { steps: [{ title: "Read getPage", files: ["src/retry.ts"] }] }));
  await assert.rejects(en(() => f.workbench.byHand.revealOutline(run.id, { mode: "names" })), outsideFit("help with planning"));
  await assert.rejects(en(() => f.workbench.byHand.revealOutline(run.id, { mode: "compare" })), outsideFit("help with planning"));
  assert.equal(run.byHand?.plan?.outlineAt, undefined);
  await en(() => f.workbench.approvePlan(run.id));
  await f.edit(run, 3);
  const version = await f.current(run);
  await assert.rejects(
    en(() => f.workbench.byHand.ready(run.id, { changeFingerprint: version, review: true })),
    outsideFit("reviews"),
  );
  const readyVersion = () => run.byHand?.ready?.changeFingerprint;
  assert.equal(readyVersion(), undefined);
  await assert.rejects(en(() => f.workbench.rerunReview(run.id)), refused(409, /^Mark your changes ready for review first\./));
  // Ready itself is never refused for that.
  await en(() => f.workbench.byHand.ready(run.id, { changeFingerprint: version, review: false }));
  assert.equal(readyVersion(), version);
  await assert.rejects(en(() => f.workbench.rerunReview(run.id)), outsideFit("reviews"));
  // An explanation is explain help, which every help set holds: given after the answer.
  await f.answerAll(run);
  await en(() => f.workbench.explanations(run.id, { filePath: "src/retry.ts" }));
  assert.equal(run.explanations?.["src/retry.ts"]?.status, "ready");
  assert.deepEqual(
    run.byHand?.events?.map((event) => [event.kind, event.source]),
    [["explain", "premise"], ["explain", "explanation"]],
  );
  assert.ok(!f.calls.some((call) => call.role === "reviewer" || call.role === "tester"));
  assert.deepEqual(f.calls.filter((call) => !call.readonly), []);
  assert.deepEqual(byHandClean(run), { clean: true });
});
