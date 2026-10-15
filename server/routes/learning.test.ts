// The learning-loop routes over HTTP: feedback tags, the practice deck and
// the plain counts are open on every plan, with strict request schemas.
// Fake codex, claude and gh come first on PATH, so no agent CLI or GitHub
// call can run.
import test, { after, before, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { createApp } from "../index.js";
import { fixedLicense, type LicenseService } from "../license.js";
import { Store } from "../store.js";
import type { Repository, Run } from "../types.js";
import { Workbench } from "../workbench.js";
import { learningPageSize } from "./learning.js";

const previousPath = process.env.PATH;
let fakeBin: string;

before(async () => {
  fakeBin = await mkdtemp(path.join(os.tmpdir(), "bell-learning-routes-bin-"));
  for (const name of ["codex", "claude", "gh"])
    await writeFile(path.join(fakeBin, name), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  process.env.PATH = `${fakeBin}${path.delimiter}${previousPath}`;
});

after(async () => {
  process.env.PATH = previousPath;
  await rm(fakeBin, { recursive: true, force: true });
});

const prUrl = "https://github.com/acme/widgets/pull/3";
const commentUrl = `${prUrl}#discussion_r7`;
const reviewUrl = `${prUrl}#pullrequestreview-8`;

function learningRepo(id = "repo-learning"): Repository {
  return {
    id,
    name: "widgets",
    owner: "acme",
    fullName: "acme/widgets",
    path: `/nonexistent/${id}`,
    defaultBranch: "main",
    url: "https://github.com/acme/widgets",
  };
}

function learningRun(fields: Partial<Run> & Pick<Run, "id">): Run {
  return {
    repoId: "repo-learning",
    title: "Retry failed requests",
    prompt: "Retry temporary failures.",
    status: "published",
    branch: "fix/learning",
    baseBranch: "main",
    baseSha: "",
    worktreePath: `/nonexistent/worktrees/${fields.id}`,
    createdAt: "2026-10-10T00:00:00.000Z",
    locale: "en",
    agents: [],
    logs: [],
    draft: { title: "Retry failed requests", body: "Retries." },
    reviewedFiles: [],
    reviewedFingerprints: {},
    ...fields,
  };
}

/** A published run whose maintainer feedback was read: one thread comment and one review. */
function publishedRun(): Run {
  return learningRun({
    id: "published",
    prUrl,
    publishCommit: "a".repeat(40),
    prFeedback: {
      fetchedAt: "2026-10-12T00:00:00.000Z",
      prNumber: 3,
      prState: "OPEN",
      reviewDecision: "CHANGES_REQUESTED",
      items: [
        {
          kind: "thread",
          author: "maintainer",
          authorAssociation: "MEMBER",
          body: "Honor the Retry-After header here.",
          path: "src/client.ts",
          line: 12,
          url: commentUrl,
          createdAt: "2026-10-11T00:00:00Z",
        },
        {
          kind: "review",
          author: "maintainer",
          authorAssociation: "MEMBER",
          state: "CHANGES_REQUESTED",
          body: "Please add a test for the exhausted case.",
          url: reviewUrl,
          createdAt: "2026-10-11T00:00:00Z",
        },
      ],
    },
  });
}

async function serveLearning(
  t: TestContext,
  { license = fixedLicense("free"), runs = [publishedRun()], repos = [learningRepo()], workbench: make }: {
    license?: LicenseService;
    runs?: Run[];
    repos?: Repository[];
    workbench?: (store: Store) => Workbench;
  } = {},
) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-learning-routes-"));
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  store.data.repos.push(...repos);
  store.data.runs.push(...runs);
  await store.save();
  const workbench = make ? make(store) : new Workbench(store);
  const app = createApp(workbench, {
    staticDirectory: path.join(directory, "missing"),
    license,
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.locals.insights.shutdown();
    await app.locals.discovery.shutdown();
    await workbench.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  const call = (method: string, endpoint: string, body?: unknown, locale = "en") =>
    // The tests read whatever JSON each route answers.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Promise<{ status: number; body: any }>((resolve, reject) => {
      const text = body === undefined ? undefined : JSON.stringify(body);
      const req = request(
        `http://127.0.0.1:${port}/api${endpoint}`,
        {
          method,
          headers: {
            "Content-Type": "application/json",
            Host: "127.0.0.1:4311",
            "X-Bell-Locale": locale,
            ...(text === undefined ? {} : { "Content-Length": Buffer.byteLength(text) }),
          },
        },
        (response) => {
          let raw = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => (raw += chunk));
          response.on("end", () => resolve({ status: response.statusCode!, body: raw ? JSON.parse(raw) : {} }));
        },
      );
      req.on("error", reject);
      req.end(text);
    });
  const saved = async () =>
    JSON.parse(await readFile(path.join(store.directory, "state.json"), "utf8")) as {
      runs: Run[];
      repos: Repository[];
    };
  return { call, store, workbench, saved, directory };
}

test("feedback tags: published runs only, comments of the latest read only, merged and cleared field by field", async (t) => {
  const review = learningRun({ id: "in-review", status: "review" });
  const { call, store, saved } = await serveLearning(t, { runs: [publishedRun(), review] });
  const run = store.data.runs[0];
  // Free plan: tagging feedback BELL already read is never gated.
  const unpublished = await call("PATCH", `/runs/${review.id}/feedback-tags`, { url: commentUrl, dimension: "risk" });
  assert.equal(unpublished.status, 409);
  assert.equal(
    unpublished.body.error,
    "Maintainer feedback can be tagged once the pull request is sent and its feedback is read.",
  );
  const unknown = await call("PATCH", `/runs/${run.id}/feedback-tags`, { url: `${prUrl}#discussion_r999`, dimension: "risk" });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error, "This comment is not in the latest feedback read. Read the feedback again, then tag it.");
  for (const body of [
    { url: commentUrl },
    { url: commentUrl, dimension: "vibes" },
    { url: commentUrl, predicted: "yes" },
    { url: commentUrl, lesson: "x".repeat(201) },
    { url: commentUrl, dimension: "risk", extra: true },
    { url: "not a url", dimension: "risk" },
  ])
    assert.equal((await call("PATCH", `/runs/${run.id}/feedback-tags`, body)).status, 400, JSON.stringify(body));
  assert.equal(run.feedbackTags, undefined);

  // The dimension chip, then "Saw it coming".
  let response = await call("PATCH", `/runs/${run.id}/feedback-tags`, { url: reviewUrl, dimension: "tests" });
  assert.equal(response.status, 200);
  response = await call("PATCH", `/runs/${run.id}/feedback-tags`, { url: reviewUrl, predicted: true });
  const tag = response.body.run.feedbackTags[reviewUrl];
  assert.deepEqual([tag.dimension, tag.predicted, tag.lesson], ["tests", true, undefined]);
  assert.match(tag.at, /^\d{4}-\d\d-\d\dT/);
  // A foreseen comment is not practised.
  assert.equal(response.body.run.practice, undefined);
  // null unsets a chip; a tag with nothing left goes.
  response = await call("PATCH", `/runs/${run.id}/feedback-tags`, { url: reviewUrl, dimension: null });
  assert.deepEqual(Object.keys(response.body.run.feedbackTags[reviewUrl]).sort(), ["at", "predicted"]);
  response = await call("PATCH", `/runs/${run.id}/feedback-tags`, { url: reviewUrl, predicted: null });
  assert.equal(reviewUrl in response.body.run.feedbackTags, false);
  // Stored for good.
  assert.deepEqual((await saved()).runs[0].feedbackTags, {});
});

test('"Surprised me" with a lesson goes to the practice deck, due tomorrow, and leaves it when it is no longer a surprise', async (t) => {
  const { call, store } = await serveLearning(t);
  const run = store.data.runs[0];
  const key = `feedback:${commentUrl}`;
  const tag = (body: Record<string, unknown>) =>
    call("PATCH", `/runs/${run.id}/feedback-tags`, { url: commentUrl, ...body });
  // Read afresh each time: every request replaces the schedule.
  const schedule = () => run.practice?.[key];
  // Surprised, the lesson not written yet: nothing to practise.
  await tag({ predicted: false });
  assert.equal(schedule(), undefined);
  const before = Date.now();
  await tag({ lesson: "  Read what the server asks for before choosing a wait.  " });
  assert.equal(run.feedbackTags![commentUrl].lesson, "Read what the server asks for before choosing a wait.");
  const scheduled = schedule()!;
  assert.deepEqual(Object.keys(scheduled).sort(), ["box", "dueAt"]);
  assert.equal(scheduled.box, 0);
  const wait = Date.parse(scheduled.dueAt) - before;
  assert.ok(wait >= 24 * 3_600_000 - 1_000 && wait <= 24 * 3_600_000 + 60_000, String(wait));
  // Not due today: the deck says when it comes back.
  const today = await call("GET", "/learning/practice");
  assert.equal(today.status, 200);
  assert.deepEqual(today.body.items, []);
  assert.equal(today.body.nextDueAt, scheduled.dueAt);
  const tomorrow = await call("GET", `/learning/practice?now=${encodeURIComponent(scheduled.dueAt)}`);
  assert.deepEqual(
    tomorrow.body.items.map((item: { key: string }) => item.key),
    [key],
  );
  const [item] = tomorrow.body.items;
  assert.equal(item.reference, "Honor the Retry-After header here.");
  assert.equal(item.earlier, "Read what the server asks for before choosing a wait.");
  assert.equal(item.codeAvailable, true);
  // Practised: the schedule moves on, and a dimension change keeps it.
  await call("POST", `/runs/${run.id}/practice`, { key, confidence: "think", grade: "got" });
  assert.equal(schedule()!.box, 1);
  await tag({ dimension: "risk" });
  assert.equal(schedule()!.box, 1);
  // A rewritten lesson starts it over.
  await tag({ lesson: "Check the response headers the server sends before choosing." });
  assert.equal(schedule()!.box, 0);
  // "Saw it coming" after all: it leaves the deck.
  await tag({ predicted: true });
  assert.equal(schedule(), undefined);
});

test("a run keeps at most 100 feedback tags, dropping the ones tagged longest ago", async (t) => {
  const published = publishedRun();
  const urls = Array.from({ length: 100 }, (_, index) => `${prUrl}#discussion_r${1000 + index}`);
  published.prFeedback!.items.push(
    ...urls.map((url) => ({ ...published.prFeedback!.items[0], url })),
  );
  published.feedbackTags = Object.fromEntries(
    urls.map((url, index) => [
      url,
      { dimension: "scope" as const, at: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString() },
    ]),
  );
  const { call, store } = await serveLearning(t, { runs: [published] });
  const response = await call("PATCH", `/runs/published/feedback-tags`, { url: commentUrl, dimension: "risk" });
  assert.equal(response.status, 200);
  const tags = store.data.runs[0].feedbackTags!;
  assert.equal(Object.keys(tags).length, 100);
  assert.ok(commentUrl in tags);
  assert.equal(urls[0] in tags, false);
  assert.ok(urls[1] in tags);
});

test("practice answers store the grade and confidence only, never the answer, on the run that owns the item", async (t) => {
  const graded = learningRun({
    id: "graded",
    understanding: {
      items: [
        {
          id: "selfCheck:src/retry.ts",
          path: "src/retry.ts",
          fingerprint: "f".repeat(64),
          source: "selfCheck",
          question: "What is the ceiling on the third retry?",
          answer: "It doubles every time.",
          confidence: "sure",
          lockedAt: "2026-10-11T00:00:00.000Z",
          grade: "missed",
          correction: "The ceiling is capped by maxDelay.",
          gradedAt: "2026-10-11T00:01:00.000Z",
        },
      ],
    },
  });
  const other = learningRun({ id: "other" });
  const { call, store, saved } = await serveLearning(t, { runs: [graded, other] });
  const deck = await call("GET", "/learning/practice");
  assert.equal(deck.status, 200);
  assert.deepEqual(deck.body.items.map((item: { key: string }) => item.key), ["check:selfCheck:src/retry.ts"]);
  assert.equal(deck.body.items[0].earlier, "The ceiling is capped by maxDelay.");
  const key = "check:selfCheck:src/retry.ts";
  const answer = "The ceiling grows to four times the base delay, capped by maxDelay.";
  // The schema has no place for the answer: a client that sends it is refused.
  const withAnswer = await call("POST", `/runs/${graded.id}/practice`, { key, confidence: "sure", grade: "got", answer });
  assert.equal(withAnswer.status, 400);
  for (const body of [
    { key, confidence: "certain", grade: "got" },
    { key, confidence: "sure", grade: "perfect" },
    { key: "", confidence: "sure", grade: "got" },
    { key, grade: "got" },
  ])
    assert.equal((await call("POST", `/runs/${graded.id}/practice`, body)).status, 400, JSON.stringify(body));
  // A key of another run, or no item at all.
  const elsewhere = await call("POST", `/runs/${other.id}/practice`, { key, confidence: "sure", grade: "got" });
  assert.equal(elsewhere.status, 404);
  assert.equal(elsewhere.body.error, "This practice item is no longer part of this run. Reload the practice deck.");
  assert.equal((await call("POST", "/runs/missing/practice", { key, confidence: "sure", grade: "got" })).status, 404);

  const recorded = await call("POST", `/runs/${graded.id}/practice`, { key, confidence: "think", grade: "got" });
  assert.equal(recorded.status, 200);
  const state = recorded.body.run.practice[key];
  assert.deepEqual(Object.keys(state).sort(), ["box", "dueAt", "lastAt", "lastConfidence", "lastGrade"]);
  assert.deepEqual([state.box, state.lastGrade, state.lastConfidence], [1, "got", "think"]);
  // Due again in 3 days, so today's deck is empty and says when.
  const after = await call("GET", "/learning/practice");
  assert.deepEqual(after.body, { items: [], nextDueAt: state.dueAt });
  // Nothing the person typed reached the saved state.
  const file = await readFile(path.join(store.directory, "state.json"), "utf8");
  assert.ok(!file.includes(answer));
  assert.deepEqual((await saved()).runs[0].practice, { [key]: state });
  // The query's time must be a time.
  assert.equal((await call("GET", "/learning/practice?now=tomorrow")).status, 400);
});

test("the counts read every run, beyond the first learning page, and answer on Free", async (t) => {
  const runs = Array.from({ length: 25 }, (_, index) =>
    learningRun({
      id: `run-${String(index).padStart(2, "0")}`,
      createdAt: new Date(Date.UTC(2026, 9, 1, index)).toISOString(),
      status: index % 5 === 0 ? "review" : "published",
      // Every run explained back; three approved with the check off.
      understanding: {
        items: [
          {
            id: "selfCheck:src/a.ts",
            path: "src/a.ts",
            source: "selfCheck",
            question: "Why?",
            answer: "Because it retries.",
            confidence: "sure",
            lockedAt: "2026-10-01T00:00:00.000Z",
            grade: index % 2 ? "got" : "missed",
            ...(index % 2 ? {} : { correction: "It waits longer each time." }),
          },
        ],
        history: [{ passedAt: new Date(Date.UTC(2026, 9, 1, index, 5)).toISOString(), questions: 1, misses: index % 2 ? 0 : 1, confidentMisses: index % 2 ? 0 : 1, seconds: 60 + index }],
      },
      ...(index < 3 ? { understandingCheckOff: true } : {}),
      ...(index < 6
        ? { feedbackTags: { [`${prUrl}#r${index}`]: { dimension: "tests" as const, predicted: index % 2 === 0, at: "2026-10-02T00:00:00.000Z" } } }
        : {}),
    }),
  );
  const { call } = await serveLearning(t, { runs });
  // The learning page shows 20 runs at a time, and only runs with explanations or notes.
  const page = await call("GET", "/learning");
  assert.equal(page.body.runs.length, 0);
  assert.ok(runs.length > learningPageSize);
  const counts = await call("GET", "/learning/counts");
  assert.equal(counts.status, 200);
  assert.equal(counts.body.runs, 25);
  assert.equal(counts.body.approved, 20);
  assert.equal(counts.body.explainedBack, 25);
  assert.equal(counts.body.checkOff, 3);
  assert.equal(counts.body.graded, 25);
  assert.deepEqual(counts.body.byConfidence.sure, { graded: 25, got: 12 });
  assert.deepEqual(counts.body.forecastHits, { hits: 3, of: 6 });
  assert.deepEqual(counts.body.feedback, { tagged: 6, prs: 6, dimensions: [{ dimension: "tests", prs: 6 }] });
  // The median of the last 10 timed checks (runs 15-24: 75-84 seconds).
  assert.deepEqual(counts.body.checkSeconds, { timed: 25, median: 80 });
});

test("every learning-loop read and write answers on Free; none is gated", async (t) => {
  const { call } = await serveLearning(t);
  for (const [method, endpoint, body] of [
    ["GET", "/learning/counts"],
    ["GET", "/learning/practice"],
    ["PATCH", "/runs/published/feedback-tags", { url: commentUrl, dimension: "risk" }],
  ] as const) {
    const response = await call(method, endpoint, body);
    assert.equal(response.status, 200, endpoint);
  }
  const routes = await readFile(path.join(import.meta.dirname, "learning.ts"), "utf8");
  // Only the debrief's POST may be gated.
  for (const line of routes.split("\n").filter((entry) => entry.includes("requirePro(")))
    assert.match(line, /app\.post\("\/api\/learning\/debrief"/);
});
