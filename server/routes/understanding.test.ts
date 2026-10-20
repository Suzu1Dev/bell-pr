// The understanding routes over HTTP: strict request schemas, and the v1.1
// records reaching the endpoints that list them.
// Fake codex, claude and gh come first on PATH.
import test, { after, before, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { createApp } from "../index.js";
import { git } from "../process.js";
import { readDiff } from "../git.js";
import { Store } from "../store.js";
import type { Run } from "../types.js";
import { Workbench } from "../workbench.js";

const previousPath = process.env.PATH;
let fakeBin: string;

before(async () => {
  fakeBin = await mkdtemp(path.join(os.tmpdir(), "bell-understanding-routes-bin-"));
  for (const name of ["codex", "claude", "gh"])
    await writeFile(path.join(fakeBin, name), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  process.env.PATH = `${fakeBin}${path.delimiter}${previousPath}`;
});

after(async () => {
  process.env.PATH = previousPath;
  await rm(fakeBin, { recursive: true, force: true });
});

async function serve(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-understanding-routes-"));
  const repository = path.join(directory, "repo");
  await mkdir(path.join(repository, "src"), { recursive: true });
  await git(repository, ["init", "-b", "main"]);
  await git(repository, ["config", "user.name", "BELL Test"]);
  await git(repository, ["config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(repository, "src", "a.ts"), "export const a = 0;\n");
  await git(repository, ["add", "--", "."]);
  await git(repository, ["commit", "-m", "initial"]);
  const baseSha = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const workbench = new Workbench(store);
  const repo = await workbench.importRepository(repository);
  const run: Run = {
    id: "route-run",
    repoId: repo.id,
    title: "Add constants",
    prompt: "Add constants.",
    status: "review",
    branch: "main",
    baseBranch: "main",
    baseSha,
    worktreePath: repository,
    createdAt: new Date().toISOString(),
    locale: "en",
    agents: [],
    logs: [],
    draft: { title: "Add constants", body: "Adds constants." },
    reviewedFiles: [],
    reviewedFingerprints: {},
  };
  store.data.runs.push(run);
  await writeFile(
    path.join(repository, "src", "a.ts"),
    Array.from({ length: 30 }, (_, index) => `export const a${index} = ${index};`).join("\n") + "\n",
  );
  const app = createApp(workbench, {
    staticDirectory: path.join(directory, "missing"),
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
  const call = (method: string, endpoint: string, body?: unknown) =>
    // The tests read whatever JSON each route answers.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Promise<{ status: number; body: any }>((resolve, reject) => {
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
  return { call, run, repo, store, workbench };
}

const summary =
  "The module now exports thirty numbered constants, so callers can import each value by name instead of computing it.";

test("every understanding route answers", async (t) => {
  const { call, run } = await serve(t);
  const [file] = await readDiff(run);
  const view = await call("GET", `/runs/${run.id}/understanding`);
  assert.equal(view.status, 200);
  assert.deepEqual(
    view.body.understanding.plan.map((item: { id: string }) => item.id),
    ["fallback:src/a.ts", "untested"],
  );
  assert.match(view.body.understanding.changeFingerprint, /^[0-9a-f]{16}$/);
  const attempt = await call("PATCH", `/runs/${run.id}/attempts`, {
    filePath: "src/a.ts",
    fingerprint: file.fingerprint,
    road: { guess: "a generated array", choice: "keep" },
  });
  assert.equal(attempt.status, 200);
  assert.equal(attempt.body.run.attempts["src/a.ts"].road.choice, "keep");
  const answers = await call("PUT", `/runs/${run.id}/understanding/answers`, {
    summary,
    items: [
      { id: "fallback:src/a.ts", answer: "It adds thirty numbered constants.", confidence: "sure" },
      { id: "untested", answer: "I did not run the importing code.", confidence: "think" },
    ],
    changeFingerprint: view.body.understanding.changeFingerprint,
    openedAt: new Date().toISOString(),
  });
  assert.equal(answers.status, 200);
  assert.deepEqual(answers.body.understanding.missing, [{ part: "grade", itemId: "fallback:src/a.ts" }]);
  const grades = await call("PUT", `/runs/${run.id}/understanding/grades`, {
    items: [{ id: "fallback:src/a.ts", grade: "got" }],
  });
  assert.equal(grades.status, 200);
  assert.equal(grades.body.understanding.passed, true);
  assert.equal((await call("PUT", `/runs/${run.id}/forecast`, { dimension: "naming" })).status, 200);
  assert.equal(
    (await call("POST", `/runs/${run.id}/understanding/summary`, { changeFingerprint: view.body.understanding.changeFingerprint })).status,
    200,
  );
  const restarted = await call("DELETE", `/runs/${run.id}/understanding`, {});
  assert.equal(restarted.status, 200);
  assert.equal(restarted.body.understanding.passed, false);
  assert.equal((await call("GET", "/runs/missing/understanding")).status, 404);
});

test("the request schemas are strict", async (t) => {
  const { call, run } = await serve(t);
  const [file] = await readDiff(run);
  const view = (await call("GET", `/runs/${run.id}/understanding`)).body.understanding;
  const refused: [string, string, unknown][] = [
    ["PUT", "/understanding/answers", { summary, items: [], changeFingerprint: view.changeFingerprint, extra: 1 }],
    ["PUT", "/understanding/answers", { summary, items: [], changeFingerprint: "not-hex" }],
    ["PUT", "/understanding/answers", { items: [{ id: "untested", answer: "x", confidence: "very" }], changeFingerprint: view.changeFingerprint }],
    ["PUT", "/understanding/grades", { items: [{ id: "untested", grade: "perfect" }] }],
    ["PUT", "/understanding/grades", { items: [], forecast: { dimension: "speed" } }],
    ["POST", "/understanding/summary", { changeFingerprint: view.changeFingerprint, text: "x".repeat(1201) }],
    ["PUT", "/forecast", { question: "x".repeat(201) }],
    ["PATCH", "/attempts", { filePath: "src/a.ts", fingerprint: file.fingerprint }],
    ["PATCH", "/attempts", { filePath: "src/a.ts", fingerprint: file.fingerprint, quiz: { grade: "got", note: "x" } }],
  ];
  for (const [method, endpoint, body] of refused) {
    const response = await call(method, `/runs/${run.id}${endpoint}`, body);
    assert.equal(response.status, 400, `${method} ${endpoint} ${JSON.stringify(body)}`);
  }
  const empty = await call("PATCH", `/runs/${run.id}/attempts`, { filePath: "src/a.ts", fingerprint: file.fingerprint });
  assert.match(empty.body.error, /Send a quiz answer or a road choice\./);
});

test("the repository list leaves out debriefs, and the learning page carries the check record", async (t) => {
  const { call, run, repo } = await serve(t);
  repo.debriefs = [
    { at: "2026-10-20T00:00:00.000Z", locale: "en", runIds: [run.id], nextStep: "Write the missing test first." },
  ];
  run.understanding = { history: [{ passedAt: "2026-10-15T00:00:00.000Z", questions: 2, misses: 0, confidentMisses: 0 }] };
  run.understandingCheckOff = true;
  run.notes = { "src/a.ts": { text: "Thirty constants.", fingerprint: "f", updatedAt: "2026-10-15T00:00:00.000Z" } };
  const repos = await call("GET", "/repos");
  assert.equal(repos.status, 200);
  assert.equal("debriefs" in repos.body.repos[0], false);
  assert.equal(repos.body.repos[0].id, repo.id);
  const learning = await call("GET", "/learning");
  assert.equal(learning.status, 200);
  const listed = learning.body.runs.find((entry: { id: string }) => entry.id === run.id);
  assert.deepEqual(listed.understanding, run.understanding);
  assert.equal(listed.understandingCheckOff, true);
  // The run list leaves the record out, but keeps the "Check off" mark.
  const runs = await call("GET", "/runs");
  const summaryRow = runs.body.runs.find((entry: { id: string }) => entry.id === run.id);
  assert.equal("understanding" in summaryRow, false);
  assert.equal(summaryRow.understandingCheckOff, true);
});

test("a follow-up round request may carry restatements, checked only for their caps", async (t) => {
  const { call } = await serve(t);
  const url = "https://github.com/acme/widgets/pull/3#discussion_r1";
  // A valid request reaches the Workbench, which does not know the run.
  const accepted = await call("POST", "/runs/missing/follow-ups", {
    feedbackUrls: [url],
    restatements: [{ url, text: "They want a test for the empty name." }],
  });
  assert.equal(accepted.status, 404);
  for (const restatements of [
    [{ url, text: "x".repeat(301) }],
    [{ url: "not a url", text: "fine" }],
    [{ url, text: "fine", extra: true }],
    Array.from({ length: 21 }, () => ({ url, text: "fine" })),
  ])
    assert.equal(
      (await call("POST", "/runs/missing/follow-ups", { feedbackUrls: [url], restatements })).status,
      400,
    );
});
