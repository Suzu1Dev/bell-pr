// The whole Learn-by-hand flow on the server (DESIGN v1.2 §4, §17; plan
// W3B task 1), with a fake agent runner and nothing else faked: create →
// the guide's orientation → an early outline reveal → the person's steps →
// questions on the plan → confirm → a hand edit → an ask (tooling) → hint
// R1 → R2 refused without an attempt → an edit → R2 → a confirmed test
// command that fails → Explain this failure → R3 with a choice → the step
// done (refused without a why, then with it) → the fix → the tests pass →
// Ready with the guide's review → "How a reader sees your change" refused
// before the person's answer for the file, given after → the check →
// approval → the publish preflight. Every guide answer carries a code fence
// with an invented identifier, which must never be stored.
//
// Then the downgrades (a teammate agent, a conflict agent whose
// resolutions a later sync cleared, a review round without a kind)
// withdraw the claim from the record and the preflight copy; and a run
// fitted to a QEMU-like project's carve-out (on a local stand-in for
// GitHub that takes pull requests) gets only the help that text names,
// is blocked until its rules are read again during the run, then gets
// the quoted confirm, which publishing needs.
//
// Fake codex, claude and gh come first on PATH (only the GitHub stand-in's
// gh answers anything), so no real agent CLI can start.
import test, { after, before, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fakeGitHub } from "../test/fake-github.js";
import { byHandClean, byHandSummary, helpKinds } from "../shared/by-hand.js";
import { byHand as exportByHand } from "../shared/i18n/learning-export.en.js";
import { buildLearningExport } from "../shared/learning-export.js";
import { changeFingerprint } from "../shared/understanding.js";
import { readDiff } from "./git.js";
import { withLocale } from "./i18n/index.js";
import { git } from "./process.js";
import { publishChecks } from "./publish.js";
import { Store } from "./store.js";
import type { TeamAgentInput } from "./team.js";
import { AppError, type Run } from "./types.js";
import { skipUnderstandingCheckInTests } from "./understanding.js";
import { Workbench, type WorkbenchContext } from "./workbench.js";

const previousPath = process.env.PATH;
let fakeBin: string;

before(async () => {
  fakeBin = await mkdtemp(path.join(os.tmpdir(), "bell-whole-flow-bin-"));
  for (const name of ["codex", "claude", "gh"])
    await writeFile(path.join(fakeBin, name), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  process.env.PATH = `${fakeBin}${path.delimiter}${previousPath}`;
});

after(async () => {
  skipUnderstandingCheckInTests();
  process.env.PATH = previousPath;
  await rm(fakeBin, { recursive: true, force: true });
});

const en = <T>(fn: () => Promise<T>) => withLocale("en", fn);
const refused = (status: number, message: RegExp) => (error: unknown) =>
  error instanceof AppError && error.statusCode === status && message.test(error.message);
const claim = exportByHand.claim;

/** The identifier no file holds: any stored text that has it kept code an agent wrote. */
const invented = "makeRetryBudget";
const fence = `\n\`\`\`ts\nexport const attempts = ${invented}(3);\n\`\`\`\n`;

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
/** The person's edit: `attempts` as given, and enough notes (over 15 lines) for the check to ask about the file. */
const handEdit = (attempts: number, notes = 20) =>
  `${retrySource.replace("attempts = 1", `attempts = ${attempts}`)}${Array.from({ length: notes }, (_, index) => `// Retry note ${index + 1}.`).join("\n")}\n`;
/** The confirmed test command: passes once the person retries three times. */
const testCommand = `node -e "process.exit(require('fs').readFileSync('src/retry.ts','utf8').includes('attempts = 3') ? 0 : 1)"`;

const orientation = JSON.stringify({
  summary: `A GET that meets a 503 fails at once, so a flaky server breaks the page.${fence}`,
  steps: [
    { title: "Find where the request fails", files: ["src/retry.ts"] },
    { title: "Send the GET again after a 503", files: ["src/retry.ts"] },
  ],
  readFirst: [{ path: "src/retry.ts", startLine: 3, endLine: 6, why: `Where the request is sent.${fence}` }],
  premise: { verdict: "holds", statement: "A 503 fails at once.", evidence: "getPage throws on a 503." },
});
/** A guide answer in the guide schema, with code in its prose and one quote BELL cuts itself. */
const guideAnswer = (text: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    text: `${text}${fence}`,
    question: "What does a second 503 do?",
    refs: [{ path: "src/retry.ts", line: 1, endLine: null }],
    quotes: [{ path: "src/retry.ts", startLine: 3, endLine: 4, from: "base", anchor: "export async function getPage" }],
    options: null,
    topic: "project",
    askedForCode: false,
    ...extra,
  });
const reviewerAnswer = JSON.stringify({
  verified: `The tests pass at this version.${fence}`,
  checked: ["src/retry.ts"],
  findings: [
    {
      path: "src/retry.ts",
      line: 1,
      observed: `The count rose to three.${fence}`,
      evidence: { type: "pattern", path: "src/retry.ts", line: 4, quote: "const response = await fetch(url);" },
      why: "Each attempt sends the GET again.",
      question: "How long can three attempts take?",
      dimension: null,
    },
  ],
});
const explanation = (input: TeamAgentInput) =>
  JSON.stringify({
    files: [
      {
        path: /"path":"([^"]+)","patch"/.exec(input.prompt)?.[1] ?? "src/retry.ts",
        summary: `The count of attempts rises, so a 503 is tried again.${fence}`,
        reason: "A flaky server stops breaking the page.",
        concept: "Retry\nTrying a safe request again.",
        tip: "Test a 503 followed by a 200.",
        example: { scenario: "A shop page loads.", before: "The page showed an error.", after: "The page loads on the second try." },
        alternatives: "A circuit breaker.",
        lookup: ["retry"],
        selfCheck: { question: "Why only GET?", answer: "A GET can be sent twice safely." },
      },
    ],
  });
const walkthrough = JSON.stringify({
  functions: [
    {
      name: "getPage",
      kind: "function",
      startLine: 3,
      endLine: 7,
      summary: `Fetches a page.${fence}`,
      change: "It is tried again after a 503.",
      steps: [{ startLine: 4, endLine: 4, explanation: "Sends the GET." }],
      callers: [],
      callees: [],
      analogy: "Like calling a busy shop twice.",
      selfCheck: { question: "What does a second 503 do?", answer: "It fails again." },
    },
  ],
  newUnits: [],
});

/** The QEMU text, verbatim (server/fixtures/policy/real), as the project's docs/devel/code-provenance.rst. */
const qemuPolicy = readFile(path.join(import.meta.dirname, "fixtures", "policy", "real", "qemu-code-provenance.rst"), "utf8");

interface Options {
  /** On a local stand-in for GitHub (test/fake-github.ts), with these extra files; else a local folder. */
  github?: Record<string, string>;
}

async function fixture(t: TestContext, options: Options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-whole-flow-"));
  const files = { "src/retry.ts": retrySource, ...options.github };
  let source: string;
  let github: Awaited<ReturnType<typeof fakeGitHub>> | undefined;
  if (options.github) {
    github = await fakeGitHub(directory, { files });
    source = github.url;
  } else {
    source = path.join(directory, "repo");
    await mkdir(path.join(source, "src"), { recursive: true });
    await git(source, ["init", "-b", "main"]);
    await git(source, ["config", "user.name", "BELL Test"]);
    await git(source, ["config", "user.email", "test@example.invalid"]);
    await writeFile(path.join(source, "src", "retry.ts"), retrySource);
    await git(source, ["add", "--", "."]);
    await git(source, ["commit", "-m", "initial"]);
  }
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const calls: TeamAgentInput[] = [];
  /** What the guide answers its next turn. */
  let guide = guideAnswer("Look at the request.");
  const workbench = new Workbench(
    store,
    async (input) => {
      calls.push(input);
      if (input.role === "lead")
        return input.prompt.includes("reading the project before the person plans") ? orientation : guide;
      if (input.role === "reviewer") return reviewerAnswer;
      if (input.role === "tester") return `No test sends two 503s.${fence}`;
      if (input.role === "explanations") return explanation(input);
      if (input.role === "walkthrough") return walkthrough;
      throw new Error(`no answer for ${input.role}`);
    },
    { getModelCatalog: async (provider) => ({ models: [], source: provider ?? "codex" }) },
  );
  workbench.status = async () => ({ codex: true, codexAuthenticated: true, claude: true, claudeAuthenticated: true, github: !!github });
  t.after(async () => {
    skipUnderstandingCheckInTests();
    await workbench.shutdown();
    github?.restore();
    await rm(directory, { recursive: true, force: true });
  });
  const repo = await workbench.importRepository(source);
  const ctx = (workbench as unknown as { context: WorkbenchContext }).context;
  const waitFor = async (done: () => boolean, what = "the job") => {
    for (let index = 0; index < 1500 && !done(); index++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(done(), `waited too long for ${what}`);
  };
  /** Waits until no guide turn, review or test run is going on in the run. */
  const idle = (run: Run) => waitFor(() => !ctx.byHandJobs.size && !run.byHand?.busy, "the run to settle");
  const create = async (mode: { learnByHand: true; byHandFit?: { learningIssue: boolean } } = { learnByHand: true }) => {
    const run = await en(() => workbench.createRun(repo.id, "Retry a GET twice after a 503.", "Retry twice", undefined, mode));
    await waitFor(() => run.status === "awaiting_plan" || run.status === "failed", "the orientation");
    assert.equal(run.status, "awaiting_plan", run.error);
    await git(run.worktreePath, ["config", "user.name", "BELL Test"]);
    await git(run.worktreePath, ["config", "user.email", "test@example.invalid"]);
    return run;
  };
  const edit = (run: Run, attempts: number, notes?: number) =>
    writeFile(path.join(run.worktreePath, "src", "retry.ts"), handEdit(attempts, notes));
  const current = async (run: Run) => changeFingerprint(await readDiff(run));
  /** One guide request (202): the job runs, then the run settles. */
  const ask = async (run: Run, input: Parameters<typeof workbench.byHand.guide>[1], answer?: string) => {
    if (answer) guide = answer;
    await en(() => workbench.byHand.guide(run.id, input));
    await idle(run);
    return run.byHand?.thread?.at(-1);
  };
  const runTests = async (run: Run, prediction: "pass" | "fail") => {
    await en(() => workbench.byHand.runTests(run.id, { prediction }));
    await idle(run);
    return run.byHand!.tests!.at(-1)!;
  };
  /** Explain it back: answers every question in the person's own words, then grades them. */
  const answerCheck = async (run: Run) => {
    const view = await en(() => workbench.understanding.status(run.id));
    await en(() =>
      workbench.understanding.saveAnswers(run.id, {
        summary: "I retry a GET that meets a 503 up to three times, so a server that recovers in seconds no longer breaks the page.",
        items: view.plan.map((item) => ({ id: item.id, answer: "Because the server recovers within a few seconds, a second try usually works.", confidence: "think" as const })),
        changeFingerprint: view.changeFingerprint,
        openedAt: new Date(Date.now() - 120_000).toISOString(),
      }),
    );
    return view;
  };
  const gradeCheck = async (run: Run) => {
    const view = await en(() => workbench.understanding.status(run.id));
    return en(() =>
      workbench.understanding.saveGrades(run.id, {
        items: view.plan.filter((item) => item.source !== "untested").map((item) => ({ id: item.id, grade: "got" as const })),
      }),
    );
  };
  const reviewAll = async (run: Run) => {
    for (const file of await readDiff(run)) await workbench.review(run.id, file.path, true, file.fingerprint);
  };
  const preflight = async (run: Run, locale: "en" | "zh-TW" = "en") =>
    publishChecks(run, await readDiff(run), ctx.store.directory, locale, { repo: workbench.repo(repo.id) });
  return { workbench, repo, ctx, calls, github, waitFor, idle, create, edit, current, ask, runTests, answerCheck, gradeCheck, reviewAll, preflight };
}

test("the whole Learn-by-hand flow: the person writes, the guide helps without code, nothing writes but the person", async (t) => {
  skipUnderstandingCheckInTests(false);
  const f = await fixture(t);
  const run = await f.create();
  // Orientation: the guide's outline, outside team.tasks, with its code removed.
  assert.equal(run.byHand?.guidePlan?.steps.length, 2);
  assert.ok((run.byHand?.guidePlan?.removed ?? 0) > 0);
  assert.deepEqual(run.team?.tasks, []);

  // An early reveal of the outline's step names, before the person wrote a step: allowed and recorded.
  await en(() => f.workbench.byHand.revealOutline(run.id, { mode: "names" }));
  assert.equal(run.byHand?.plan?.outlineBeforeDraft, true);
  // The person's own steps (kept in the order sent), then questions on the plan.
  await en(() =>
    f.workbench.byHand.savePlan(run.id, {
      steps: [{ title: "Read getPage", files: ["src/retry.ts"] }, { title: "Retry once more on a 503", files: ["src/retry.ts"] }],
      tests: "A check that the count is three.",
      unsure: "Whether POST should retry too.",
      prediction: "getPage, because it sends the request.",
    }),
  );
  assert.deepEqual(run.byHand?.plan?.steps.map((step) => step.title), ["Read getPage", "Retry once more on a 503"]);
  await en(() => f.workbench.byHand.planQuestions(run.id));
  await f.idle(run);
  assert.equal(run.byHand?.planQuestions?.length, 1);
  await en(() => f.workbench.approvePlan(run.id));
  assert.equal(run.status, "review");
  const [, step] = run.byHand!.plan!.steps;

  // The person writes; then asks a tooling question and gets R1.
  await f.edit(run, 2);
  const tooling = await f.ask(run, { kind: "ask", entry: "tooling", question: "How do I run one test file?" }, guideAnswer("Run the test command."));
  assert.equal(tooling?.entry, "tooling");
  const r1 = await f.ask(run, { kind: "hint", stepId: step.id }, guideAnswer("Look where the status is checked."));
  assert.equal(r1?.rung, 1);
  assert.deepEqual(r1?.quotes?.map((quote) => [quote.from, quote.text]), [["base", "export async function getPage(url: string) {\n  const response = await fetch(url);"]]);
  // R2 needs an attempt first: nothing changed since R1.
  const turns = f.calls.length;
  await assert.rejects(en(() => f.workbench.byHand.guide(run.id, { kind: "hint", stepId: step.id })), refused(409, /^Try something first/));
  assert.equal(f.calls.length, turns);
  await f.edit(run, 2, 21);
  assert.equal((await f.ask(run, { kind: "hint", stepId: step.id }, guideAnswer("A retry applies when the status is 503.")))?.rung, 2);

  // The person confirms a test command; it fails, and the guide explains the failure.
  await en(() => f.workbench.byHand.confirmTestCommand(f.repo.id, { command: testCommand }));
  const failed = await f.runTests(run, "fail");
  assert.equal(failed.outcome, "failed");
  assert.equal((await f.ask(run, { kind: "test" }, guideAnswer("The test reads the count from src/retry.ts:1.")))?.kind, "test");
  // R3 (a test run since R2 is an attempt), with options; the person picks one.
  const r3 = await f.ask(
    run,
    { kind: "hint", stepId: step.id },
    guideAnswer("Two ways fit this project.", {
      options: [
        { name: "Raise the count", tradeoff: "Simple, but every 503 waits the same." },
        { name: "Retry in a loop", tradeoff: "More code, but each try can wait longer." },
      ],
    }),
  );
  assert.equal(r3?.rung, 3);
  await en(() => f.workbench.byHand.updateStep(run.id, step.id, { chosen: { entryId: r3!.id, option: 0, why: "It is the smallest change." } }));
  // After R3, the step is done only with the person's own why.
  await assert.rejects(en(() => f.workbench.byHand.updateStep(run.id, step.id, { done: true })), refused(409, /^Say in one sentence why/));
  await en(() => f.workbench.byHand.updateStep(run.id, step.id, { done: true, why: "Three tries cover a server that recovers in seconds." }));
  assert.ok(run.byHand!.plan!.steps[1].doneAt);

  // The fix, and the tests pass.
  await f.edit(run, 3);
  assert.equal((await f.runTests(run, "pass")).outcome, "passed");

  // Ready, with the guide's review of this version.
  await en(async () => f.workbench.byHand.ready(run.id, { changeFingerprint: await f.current(run), leastSure: "The count.", review: true }));
  await f.idle(run);
  const [review] = run.byHand?.reviews ?? [];
  assert.equal(review?.findings.length, 1);
  assert.equal(review.findings[0].evidence.quote, "const response = await fetch(url);");

  // How a reader sees the change: not before the person's own answer for the file.
  await assert.rejects(en(() => f.workbench.explanations(run.id, { filePath: "src/retry.ts" })), refused(409, /^Answer this file's Explain-it-back question first/));
  const view = await f.answerCheck(run);
  assert.ok(view.plan.some((item) => item.path === "src/retry.ts"));
  await en(() => f.workbench.explanations(run.id, { filePath: "src/retry.ts" }));
  await en(() => f.workbench.walkthrough(run.id, "src/retry.ts"));
  await f.waitFor(() => run.explanations?.["src/retry.ts"]?.status === "ready" && run.walkthroughs?.["src/retry.ts"]?.status === "ready", "the reader view");
  // The check, the PR text in the person's words, the ticks, the approval.
  assert.equal((await f.gradeCheck(run)).understanding.passed, true);
  await en(() => f.workbench.draft(run.id, { title: "Retry a GET three times after a 503", body: "Retries a GET after a 503, up to three times; I wrote and tested it myself." }));
  await f.reviewAll(run);
  assert.equal((await en(() => f.workbench.approve(run.id, { ...run.draft }))).status, "approved");

  // The publish preflight: no block, and nothing the project's rules would need.
  const checks = await en(() => f.preflight(run));
  assert.deepEqual(checks.filter((check) => check.kind === "block"), []);

  // What the run's history shows (DESIGN v1.2 §17).
  assert.deepEqual(f.calls.filter((call) => !call.readonly).map((call) => call.role), []);
  assert.deepEqual(run.team?.tasks, []);
  assert.deepEqual(byHandClean(run), { clean: true });
  // No stored text keeps the code the agents wrote, here or on disk.
  assert.doesNotMatch(JSON.stringify(run), new RegExp(invented));
  assert.doesNotMatch(await readFile(path.join(f.ctx.store.directory, "state.json"), "utf8"), new RegExp(invented));
  assert.ok((run.byHand?.removedTotal ?? 0) > 0);
  // A help event for each source the run used, with its kind.
  assert.deepEqual(
    [...new Set(run.byHand?.events?.map((event) => `${event.source}:${event.kind}`))].sort(),
    ["ask:answer", "explanation:explain", "hint:answer", "hint:explain", "hint:plan", "outline:plan", "plan:plan", "premise:explain", "review:review", "test:test", "walkthrough:explain"],
  );
  assert.deepEqual(helpKinds(run), ["explain", "answer", "plan", "review", "test"]);
  // The record's counts: the first prediction after each change (fail, then pass), both right.
  const summary = byHandSummary(run);
  assert.deepEqual(summary.predictions, { judged: 2, right: 2, unsure: 0 });
  assert.equal(summary.outlineBeforeDraft, true);
  assert.ok(summary.removedAnswers > 0);
  assert.deepEqual(summary.highestRungs, [{ stepId: step.id, rung: 3 }]);
  // The record says the claim, the history backing it.
  assert.ok(buildLearningExport(run, f.repo, "en").includes(claim));
});

test("a run whose history used agents, a conflict agent or a review round loses the claim in its record and preflight copy", async (t) => {
  skipUnderstandingCheckInTests(true);
  const policy = await qemuPolicy;
  const f = await fixture(t, { github: { "docs/devel/code-provenance.rst": policy } });
  const run = await f.create();
  await en(() => f.workbench.byHand.savePlan(run.id, { steps: [{ title: "Retry the GET" }] }));
  await en(() => f.workbench.approvePlan(run.id));
  await f.edit(run, 3);
  // Clean: the ban's Learn-by-hand copy states the claim.
  const banOf = async (r: Run) => (await en(() => f.preflight(r))).find((check) => check.id === "ai-ban");
  assert.ok(byHandClean(run).clean);
  assert.ok((await banOf(run))?.message.includes(claim));
  const downgrades: [string, (r: Run) => void, string][] = [
    ["a teammate agent", (r) => r.agents.push({ id: "member-1", name: "Member 1", role: "Teammate", status: "complete", detail: "" }), "agents"],
    [
      "a conflict agent whose resolutions a later sync cleared",
      (r) => {
        r.agents.push({ id: "sync", name: "Weave", role: "Conflicts", status: "complete", detail: "" });
        r.sync = { at: r.createdAt, from: r.baseSha, to: r.baseSha, snapshot: r.baseSha, conflicts: [] } as unknown as Run["sync"];
      },
      "agents",
    ],
    [
      "a review round without a kind",
      (r) => {
        r.followUps = [{ id: "r1", requestedAt: r.createdAt, feedbackUrls: [], status: "review", parentCommit: r.baseSha }] as unknown as Run["followUps"];
      },
      "rounds",
    ],
  ];
  for (const [name, downgrade, reason] of downgrades) {
    const stored: Run = structuredClone(run);
    downgrade(stored);
    assert.deepEqual(byHandClean(stored), { clean: false, reason }, name);
    const record = buildLearningExport(stored, f.repo, "en");
    assert.ok(!record.includes(claim), name);
    assert.ok(record.includes(exportByHand.withdrawn), name);
    const ban = await banOf(stored);
    assert.equal(ban?.kind, "block", name);
    assert.ok(!ban!.message.includes(claim) && !ban!.details.some((detail) => detail.includes(claim)), name);
    // The agent run's copy and no reason, as for any agent run.
    assert.match(ban!.message, /AI agents wrote this change/, name);
    assert.equal(ban!.reason, undefined, name);
    for (const check of await en(() => f.preflight(stored))) assert.ok(!JSON.stringify(check).includes("no write access"), `${name}: ${check.id}`);
  }
});

test("a run fitted to a QEMU-like project gets only the help its text names, and publishes only through the quoted confirm", async (t) => {
  skipUnderstandingCheckInTests(true);
  const policy = await qemuPolicy;
  const f = await fixture(t, { github: { "docs/devel/code-provenance.rst": policy } });
  // The rules were read at import, from the project's own file.
  const rules = f.workbench.repo(f.repo.id).contributionRules;
  assert.ok(rules?.findings.some((finding) => finding.kind === "ban" && finding.path === "docs/devel/code-provenance.rst" && finding.allows?.length));
  const run = await f.create({ learnByHand: true, byHandFit: { learningIssue: false } });
  assert.deepEqual(run.byHand?.helpLock?.kinds, ["explain", "answer", "test"]);
  // Planning help is outside the set: no step names in the outline, no reveal, no questions.
  assert.deepEqual(run.byHand?.guidePlan?.steps, []);
  const outside = (kind: string) => refused(409, new RegExp(`^Not offered in this run: the project's text it is fitted to doesn't name ${kind}\\.`));
  for (const mode of ["names", "compare"] as const)
    await assert.rejects(en(() => f.workbench.byHand.revealOutline(run.id, { mode })), outside("help with planning"));
  await en(() => f.workbench.byHand.savePlan(run.id, { steps: [{ title: "Retry the GET", files: ["src/retry.ts"] }] }));
  await assert.rejects(en(() => f.workbench.byHand.planQuestions(run.id)), outside("help with planning"));
  await en(() => f.workbench.approvePlan(run.id));
  const [step] = run.byHand!.plan!.steps;
  await f.edit(run, 2);
  // R1 (answers) and R2 (explanations) are in the set; R3 (planning) is not, with no agent turn.
  assert.equal((await f.ask(run, { kind: "hint", stepId: step.id }, guideAnswer("Look where the status is checked.")))?.rung, 1);
  await f.edit(run, 2, 21);
  assert.equal((await f.ask(run, { kind: "hint", stepId: step.id }, guideAnswer("A retry applies to a 503.")))?.rung, 2);
  await en(() => f.workbench.byHand.confirmTestCommand(f.repo.id, { command: testCommand }));
  assert.equal((await f.runTests(run, "fail")).outcome, "failed");
  const turns = f.calls.length;
  await assert.rejects(en(() => f.workbench.byHand.guide(run.id, { kind: "hint", stepId: step.id })), outside("help with planning"));
  await assert.rejects(en(() => f.workbench.byHand.guide(run.id, { kind: "hint", stepId: step.id, rung: 3 })), outside("help with planning"));
  // "My change" goes to the ladder, which has no rung left here: the exits instead.
  await assert.rejects(
    en(() => f.workbench.byHand.guide(run.id, { kind: "ask", entry: "change", stepId: step.id, question: "Is my loop right?" })),
    refused(409, /^The guide has no more hints for this step in this run/),
  );
  assert.equal(f.calls.length, turns);
  // Explain this failure is test help, which QEMU's "debugging" names.
  assert.equal((await f.ask(run, { kind: "test" }, guideAnswer("The test reads the count.")))?.kind, "test");
  await f.edit(run, 3);
  assert.equal((await f.runTests(run, "pass")).outcome, "passed");
  // Ready: the review isn't in the set; Ready itself is.
  await assert.rejects(en(async () => f.workbench.byHand.ready(run.id, { changeFingerprint: await f.current(run), review: true })), outside("reviews"));
  await en(async () => f.workbench.byHand.ready(run.id, { changeFingerprint: await f.current(run), review: false }));
  await en(() => f.workbench.draft(run.id, { title: "Retry a GET three times after a 503", body: "Retries a GET after a 503; I wrote and tested it myself." }));
  await f.reviewAll(run);
  // The quoted confirm never blocks approval.
  assert.equal((await en(() => f.workbench.approve(run.id, { ...run.draft }))).status, "approved");
  assert.deepEqual(helpKinds(run), ["explain", "answer", "test"]);
  assert.deepEqual(byHandClean(run), { clean: true });
  assert.deepEqual(f.calls.filter((call) => !call.readonly), []);

  // At publish, the rules must have been read during the run (condition d): a block that says so.
  const before = await en(() => f.preflight(run));
  const blocked = before.find((check) => check.id === "ai-ban");
  assert.equal(blocked?.kind, "block");
  assert.equal(blocked?.reason, "rules-unread");
  assert.ok(!before.some((check) => check.id === "by-hand-rules"));
  // "Check again" reads them; now the quoted confirm, and no ai-ban.
  await en(() => f.workbench.contribution.refreshRules(f.repo.id));
  const after = await en(() => f.preflight(run));
  assert.ok(!after.some((check) => check.id === "ai-ban"));
  const confirm = after.find((check) => check.id === "by-hand-rules");
  assert.equal(confirm?.kind, "confirm");
  assert.match(confirm!.message, /BELL PR is quoting the project, not deciding for it/);
  assert.ok(confirm!.details.some((detail) => detail.includes("DECLINE any contributions")));
  assert.ok(confirm!.details.some((detail) => detail.includes("researching APIs")));
  // Publishing without the tick is refused; an override with that id is no way around it.
  const others = after.filter((check) => check.kind === "confirm" && check.id !== "by-hand-rules").map((check) => check.id);
  await assert.rejects(
    en(() => f.workbench.publish(run.id, run.approvedFingerprint!, others)),
    refused(422, /its own text says some uses of AI are fine/),
  );
  await assert.rejects(
    en(() => f.workbench.publish(run.id, run.approvedFingerprint!, others, [{ id: "by-hand-rules" as never, reason: "The maintainers said it fits on the list." }])),
    (error: unknown) => error instanceof AppError && error.statusCode === 422,
  );
  // With it (and the digest of the words shown), the stand-in for GitHub gets the Draft PR.
  const published = await en(() => f.workbench.publish(run.id, run.approvedFingerprint!, [...others, "by-hand-rules"], [], confirm!.digest));
  assert.equal(published.status, "published");
  assert.match(published.prUrl ?? "", /\/pull\/1$/);
  assert.ok((await f.github!.calls()).some((call) => call[0] === "gh" && call[1] === "pr" && call[2] === "create" && call.includes("--draft")));
});
