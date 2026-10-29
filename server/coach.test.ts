// The coach debrief on the server: which records it reads, the strict
// answer with checked quotes, and a read-only turn that leaves the
// person's runs alone. Agent turns are answered by `agentRunner` or a fake
// `command`; fake codex, claude and gh come first on PATH.
import test, { after, before, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { codexAccessMode } from "./agent-cli.js";
import { coachJsonSchema, coachRecords, parseCoachAnswer } from "./coach.js";
import { withLocale } from "./i18n/index.js";
import { respondIn } from "./prompt-language.js";
import type { command } from "./process.js";
import { Store } from "./store.js";
import type { TeamAgentInput } from "./team.js";
import { AppError, type Repository, type Run } from "./types.js";
import { Workbench } from "./workbench.js";
import type { PrFeedbackItem } from "../shared/pr-feedback.js";

const previousPath = process.env.PATH;
let fakeBin: string;

before(async () => {
  fakeBin = await mkdtemp(path.join(os.tmpdir(), "bell-coach-bin-"));
  for (const name of ["codex", "claude", "gh"])
    await writeFile(path.join(fakeBin, name), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  process.env.PATH = `${fakeBin}${path.delimiter}${previousPath}`;
});

after(async () => {
  process.env.PATH = previousPath;
  await rm(fakeBin, { recursive: true, force: true });
});

const prUrl = "https://github.com/acme/widgets/pull/3";
const testComment = "Please add a test for the exhausted case: after maxRetries, the last error should be thrown.";
const riskComment = "Honor Retry-After for 429 and 503 responses before retrying.";

function comment(id: number, body: string, association = "MEMBER"): PrFeedbackItem {
  return {
    kind: "review",
    author: association === "MEMBER" ? "maintainer" : "passer-by",
    authorAssociation: association,
    body,
    url: `${prUrl}#pullrequestreview-${id}`,
    createdAt: "2026-10-11T00:00:00Z",
  };
}

function run(fields: Partial<Run> & Pick<Run, "id">): Run {
  return {
    repoId: "repo-coach",
    title: `Run ${fields.id}`,
    prompt: "Do it.",
    status: "published",
    branch: "fix/coach",
    baseBranch: "main",
    baseSha: "",
    worktreePath: `/nonexistent/worktrees/${fields.id}`,
    createdAt: "2026-10-10T00:00:00.000Z",
    locale: "en",
    agents: [],
    logs: [],
    draft: { title: "t", body: "b" },
    reviewedFiles: [],
    reviewedFingerprints: {},
    ...fields,
  };
}

const repo: Repository = {
  id: "repo-coach",
  name: "widgets",
  owner: "acme",
  fullName: "acme/widgets",
  path: "/nonexistent/repos/widgets",
  defaultBranch: "main",
  url: "https://github.com/acme/widgets",
};

/** A published run with every kind of record, a later run with a summary only, and runs without records. */
function history(): Run[] {
  return [
    run({
      id: "retry",
      title: "Retry failed requests",
      createdAt: "2026-10-10T00:00:00.000Z",
      understanding: {
        summary: { text: "The client retries failed GET requests with growing waits, so short outages recover.", changeFingerprint: "0".repeat(16), at: "2026-10-11T00:00:00.000Z" },
        items: [
          {
            id: "selfCheck:src/retry.ts",
            path: "src/retry.ts",
            source: "selfCheck",
            question: "What is the ceiling on the third retry?",
            answer: "It doubles every time.",
            confidence: "think",
            lockedAt: "2026-10-11T00:00:00.000Z",
            grade: "partly",
            correction: "The ceiling is capped by maxDelay.",
          },
        ],
        forecast: { dimension: "tests", question: "Whether the last attempt is tested.", at: "2026-10-11T00:00:00.000Z" },
      },
      attempts: {
        "src/retry.ts": { fingerprint: "f".repeat(64), road: { guess: "A fixed one-second wait.", choice: "keep", why: "Many clients retry at once.", at: "2026-10-11T00:00:00.000Z" } },
      },
      prFeedback: {
        fetchedAt: "2026-10-12T00:00:00.000Z",
        prNumber: 3,
        prState: "OPEN",
        reviewDecision: "CHANGES_REQUESTED",
        items: [
          comment(1, testComment),
          comment(2, "Drive-by: looks fine to me.", "NONE"),
          comment(3, riskComment),
          comment(4, "Tagged by the person although not a maintainer.", "CONTRIBUTOR"),
          comment(5, "   ", "MEMBER"),
        ],
      },
      feedbackTags: {
        [`${prUrl}#pullrequestreview-3`]: { dimension: "risk", predicted: false, lesson: "Read the headers first.", at: "2026-10-12T01:00:00.000Z" },
        [`${prUrl}#pullrequestreview-4`]: { dimension: "scope", at: "2026-10-12T01:00:00.000Z" },
      },
    }),
    run({
      id: "readme",
      title: "Fix the README typo",
      status: "approved",
      createdAt: "2026-10-13T00:00:00.000Z",
      modelExecution: { provider: "codex", model: "gpt-test", webAccess: true, source: "selected", reported: { model: "gpt-reported" } },
      understanding: { summary: { text: "Fixes a typo in the install section of the README file for new users.", changeFingerprint: "1".repeat(16), at: "2026-10-13T00:00:00.000Z" } },
    }),
    // Nothing to learn from yet.
    run({ id: "empty", status: "review", createdAt: "2026-10-14T00:00:00.000Z" }),
    // Another project.
    run({ id: "elsewhere", repoId: "repo-other", understanding: { summary: { text: "Something else entirely.", changeFingerprint: "2".repeat(16), at: "2026-10-01T00:00:00.000Z" } } }),
  ];
}

test("the debrief reads the project's runs with records, newest first, with maintainer and tagged comments only", () => {
  const read = coachRecords(history(), "repo-coach");
  assert.deepEqual(read.runs.map((entry) => entry.id), ["readme", "retry"]);
  const [readme, retry] = read.records;
  assert.deepEqual(readme, {
    title: "Fix the README typo",
    status: "approved",
    summary: "Fixes a typo in the install section of the README file for new users.",
  });
  assert.deepEqual(retry.outcome, { prState: "OPEN", reviewDecision: "CHANGES_REQUESTED" });
  assert.deepEqual(retry.answers, [
    {
      path: "src/retry.ts",
      question: "What is the ceiling on the third retry?",
      answer: "It doubles every time.",
      confidence: "think",
      grade: "partly",
      correction: "The ceiling is capped by maxDelay.",
    },
  ]);
  assert.deepEqual(retry.roads, [
    { path: "src/retry.ts", guess: "A fixed one-second wait.", choice: "keep", why: "Many clients retry at once." },
  ]);
  assert.deepEqual(retry.forecast, { dimension: "tests", question: "Whether the last attempt is tested." });
  // The person's tagged comments first; a drive-by comment and an empty one are left out.
  assert.deepEqual(
    retry.feedback!.map((entry) => [entry.comment, entry.tag]),
    [
      [riskComment, { dimension: "risk", sawItComing: false, lesson: "Read the headers first." }],
      ["Tagged by the person although not a maintainer.", { dimension: "scope" }],
      [testComment, undefined],
    ],
  );
  assert.ok(read.texts.includes(testComment));
  // At most 20 runs, the newest.
  const many = Array.from({ length: 25 }, (_, index) =>
    run({
      id: `run-${index}`,
      createdAt: new Date(Date.UTC(2026, 9, 1, index)).toISOString(),
      understanding: { summary: { text: `Summary ${index}.`, changeFingerprint: "0".repeat(16), at: "2026-10-01T00:00:00.000Z" } },
    }),
  );
  const capped = coachRecords(many, "repo-coach");
  assert.equal(capped.runs.length, 20);
  assert.equal(capped.runs[0].id, "run-24");
  assert.equal(capped.runs.at(-1)!.id, "run-5");
  // Long records stop at the size budget, keeping the newest run.
  const long = Array.from({ length: 6 }, (_, index) =>
    run({
      id: `long-${index}`,
      createdAt: new Date(Date.UTC(2026, 9, 1, index)).toISOString(),
      prFeedback: {
        fetchedAt: "2026-10-12T00:00:00.000Z",
        prNumber: 3,
        items: Array.from({ length: 15 }, (_, item) => comment(item, "x".repeat(4_000))),
      },
    }),
  );
  const budgeted = coachRecords(long, "repo-coach");
  assert.ok(budgeted.runs.length >= 1 && budgeted.runs.length < 6);
  assert.equal(budgeted.runs[0].id, "long-5");
  assert.ok(budgeted.records[0].feedback!.every((entry) => entry.comment.length === 1_500));
  assert.deepEqual(coachRecords(history(), "repo-none").runs, []);
});

const answer = (fields: Record<string, unknown> = {}) =>
  JSON.stringify({
    recurring: { dimension: "tests", quotes: [testComment] },
    drills: [
      {
        context: "How withRetry waits between attempts.",
        optionA: "Wait a fixed second.",
        optionB: "Wait a random time under a doubling ceiling.",
        question: "Which fits this project, and why?",
        reveal: "B spreads retries from many clients; A is simpler for one client.",
      },
    ],
    nextStep: "Write the last-attempt test before the next pull request here.",
    ...fields,
  });

test("the coach's answer is strict and capped, and only quotes found in the records are kept", () => {
  const texts = coachRecords(history(), "repo-coach").texts;
  const parsed = parseCoachAnswer(answer(), texts);
  assert.deepEqual(parsed.recurring, { dimension: "tests", quotes: [testComment] });
  assert.equal(parsed.drills!.length, 1);
  assert.equal(parsed.nextStep, "Write the last-attempt test before the next pull request here.");
  // Quotation marks around a quote are not part of it; a changed, made-up,
  // too short or repeated quote is dropped.
  const quotes = parseCoachAnswer(
    answer({
      recurring: {
        dimension: "tests",
        quotes: [`\u201c${riskComment}\u201d`, "Please add tests for everything.", "the last"],
      },
    }),
    texts,
  );
  assert.deepEqual(quotes.recurring, { dimension: "tests", quotes: [riskComment] });
  const repeated = parseCoachAnswer(
    answer({ recurring: { dimension: "risk", quotes: [riskComment, ` ${riskComment} `, testComment.toUpperCase()] } }),
    texts,
  );
  assert.deepEqual(repeated.recurring, { dimension: "risk", quotes: [riskComment] });
  // Corner brackets, as a Chinese answer quotes.
  assert.deepEqual(
    parseCoachAnswer(answer({ recurring: { dimension: "tests", quotes: [`\u300c${testComment}\u300d`] } }), texts).recurring,
    { dimension: "tests", quotes: [testComment] },
  );
  // No quote left, or no taste dimension: no recurring line.
  assert.equal("recurring" in parseCoachAnswer(answer({ recurring: { dimension: "tests", quotes: ["Invented words of nobody."] } }), texts), false);
  assert.equal("recurring" in parseCoachAnswer(answer({ recurring: { dimension: "vibes", quotes: [testComment] } }), texts), false);
  assert.equal("recurring" in parseCoachAnswer(answer({ recurring: null }), texts), false);
  assert.equal("drills" in parseCoachAnswer(answer({ drills: [] }), texts), false);
  // Everything else is strict: shape, item counts and the caps of shared/coach.ts.
  const drill = JSON.parse(answer()).drills[0];
  for (const invalid of [
    "not json",
    answer({ extra: true }),
    answer({ nextStep: "" }),
    answer({ nextStep: "x".repeat(301) }),
    answer({ drills: [drill, drill, drill, drill] }),
    answer({ drills: [{ ...drill, reveal: "x".repeat(1_201) }] }),
    answer({ drills: [{ ...drill, hint: "no" }] }),
    answer({ recurring: { dimension: "tests", quotes: [testComment], why: "no" } }),
    answer({ recurring: { dimension: "tests", quotes: [testComment, testComment, testComment, testComment] } }),
  ])
    assert.throws(
      () => withLocale("en", () => parseCoachAnswer(invalid, texts)),
      (error: AppError) =>
        error.statusCode === 422 &&
        error.message === "The coach's answer was incomplete or not in the expected form, so nothing was saved. Try again.",
      invalid.slice(0, 80),
    );
  // The CLI schema closes every object and requires every property.
  assert.deepEqual(coachJsonSchema.required, ["recurring", "drills", "nextStep"]);
  assert.equal(coachJsonSchema.additionalProperties, false);
});

async function fixture(
  t: TestContext,
  dependencies: { runner?: (input: TeamAgentInput) => Promise<string>; command?: typeof command } = {},
) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-coach-"));
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  store.data.repos.push({ ...repo });
  store.data.runs.push(...history());
  await store.save();
  const workbench = new Workbench(store, dependencies.runner, {
    getModelCatalog: async () => ({ models: [], source: "codex" }),
    ...(dependencies.command ? { command: dependencies.command } : {}),
  });
  t.after(async () => {
    await workbench.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, store, workbench };
}

test("a debrief is one read-only turn in an empty folder, in the request's language, stored newest last, 5 at most", async (t) => {
  const turns: TeamAgentInput[] = [];
  let reply = answer();
  const f = await fixture(t, {
    runner: async (input) => {
      turns.push(input);
      // The folder is BELL's own and holds only the output schema.
      assert.ok(existsSync(path.join(input.cwd, "coach-schema.json")));
      return reply;
    },
  });
  const before = JSON.stringify(f.store.data.runs);
  const debrief = await withLocale("en", () => f.workbench.learningLoop.debrief(repo.id));
  assert.equal(turns.length, 1);
  const [turn] = turns;
  assert.equal(turn.role, "coach");
  // No write access, no web and no workspace of the person's.
  assert.equal(turn.readonly, true);
  assert.equal(turn.modelExecution.webAccess, undefined);
  assert.equal(turn.modelExecution.reported, undefined);
  assert.equal(turn.modelExecution.model, "gpt-test");
  assert.ok(turn.cwd.startsWith(path.join(os.tmpdir(), "bell-coach-")));
  assert.ok(!f.store.data.runs.some((entry) => turn.cwd === entry.worktreePath));
  assert.equal(existsSync(turn.cwd), false);
  assert.ok(turn.prompt.includes(respondIn("en")));
  assert.ok(turn.prompt.includes(JSON.stringify(testComment)));
  assert.ok(!turn.prompt.includes("Drive-by: looks fine to me."));
  // The person's runs are as they were: no log line, report or efficiency entry.
  assert.equal(JSON.stringify(f.store.data.runs), before);
  assert.deepEqual(
    { ...debrief, at: "<at>" },
    {
      at: "<at>",
      locale: "en",
      runIds: ["readme", "retry"],
      recurring: { dimension: "tests", quotes: [testComment] },
      drills: JSON.parse(answer()).drills,
      nextStep: "Write the last-attempt test before the next pull request here.",
    },
  );
  const saved = JSON.parse(await readFile(path.join(f.store.directory, "state.json"), "utf8"));
  assert.deepEqual(saved.repos[0].debriefs, [debrief]);
  // In Chinese the debrief records its language; stored newest last, at most 5,
  // and read newest first.
  for (let index = 0; index < 5; index++) {
    reply = answer({ nextStep: `Next step ${index}.` });
    await withLocale("zh-TW", () => f.workbench.learningLoop.debrief(repo.id));
  }
  assert.ok(turns.at(-1)!.prompt.includes(respondIn("zh-TW")));
  const stored = f.store.data.repos[0].debriefs!;
  assert.equal(stored.length, 5);
  assert.deepEqual(stored.map((entry) => entry.nextStep), [0, 1, 2, 3, 4].map((index) => `Next step ${index}.`));
  assert.equal(stored[0].locale, "zh-TW");
  const read = await f.workbench.learningLoop.debriefs(repo.id);
  assert.equal(read[0].nextStep, "Next step 4.");
  // The drills join the practice deck on the newest run the debrief read.
  const deck = await f.workbench.learningLoop.practice("2026-10-20T00:00:00.000Z");
  const drills = deck.items.filter((item) => item.kind === "drill");
  assert.ok(drills.every((item) => item.runId === "readme"));
});

test("an unchecked answer, a project without records and a second debrief at once are refused, and nothing is stored", async (t) => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => (release = resolve));
  let reply = answer({ recurring: { dimension: "tests", quotes: ["Words nobody wrote at all."] } });
  const f = await fixture(t, {
    runner: async () => {
      await waiting;
      return reply;
    },
  });
  // Unverified quotes go, and with them the recurring line.
  const first = withLocale("en", () => f.workbench.learningLoop.debrief(repo.id));
  await assert.rejects(
    withLocale("en", () => f.workbench.learningLoop.debrief(repo.id)),
    (error: AppError) => error.statusCode === 409 && error.message === "A coach debrief of this project is already being written.",
  );
  release();
  assert.equal("recurring" in (await first), false);
  reply = "{}";
  await assert.rejects(
    f.workbench.learningLoop.debrief(repo.id),
    (error: AppError) => error.statusCode === 422,
  );
  assert.equal(f.store.data.repos[0].debriefs!.length, 1);
  f.store.data.repos.push({ ...repo, id: "repo-quiet" });
  await assert.rejects(
    withLocale("en", () => f.workbench.learningLoop.debrief("repo-quiet")),
    (error: AppError) =>
      error.statusCode === 422 &&
      error.message ===
        "There is nothing to debrief yet. Take the understanding check, or read and tag maintainer feedback, on a run of this project first.",
  );
  await assert.rejects(f.workbench.learningLoop.debrief("repo-missing"), (error: AppError) => error.statusCode === 404);
  await assert.rejects(f.workbench.learningLoop.debriefs("repo-missing"), (error: AppError) => error.statusCode === 404);
  assert.deepEqual(await f.workbench.learningLoop.debriefs("repo-quiet"), []);
});

test("the coach's CLI runs read-only in BELL's empty folder, offline, even when the settings allow the web", async (t) => {
  const calls: { executable: string; args: string[]; cwd?: string }[] = [];
  const f = await fixture(t, {
    command: async (executable, args, options) => {
      calls.push({ executable, args, cwd: options?.cwd });
      options?.onLine?.(
        JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: answer() } }),
        "stdout",
      );
      return { stdout: "", stderr: "", code: 0 };
    },
  });
  await f.workbench.learningLoop.debrief(repo.id, {
    model: async () => ({
      modelExecution: { provider: "codex", model: "gpt-saved", webAccess: true, source: "selected" },
      ponytailMode: "full",
    }),
  });
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call.executable, "codex");
  const flag = (name: string) => call.args[call.args.indexOf(name) + 1];
  assert.equal(codexAccessMode(call.args), "read-only");
  assert.ok(!call.args.includes("--sandbox"));
  assert.equal(flag("--model"), "gpt-saved");
  assert.ok(call.args.includes("--skip-git-repo-check"));
  assert.ok(!call.args.some((arg) => arg.includes("web_search")));
  assert.equal(flag("-C"), call.cwd);
  assert.ok(call.cwd!.startsWith(path.join(os.tmpdir(), "bell-coach-")));
  assert.ok(flag("--output-schema").startsWith(call.cwd!));
});
