// The walkthrough answers of DESIGN v1.2 D1 on the server: the attempt
// route's strict schema and saveAttempt. Fake codex, claude and gh come
// first on PATH.
import test, { after, before, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { changeFingerprint } from "../shared/understanding.js";
import { readDiff } from "./git.js";
import { withLocale } from "./i18n/index.js";
import { git } from "./process.js";
import { attemptSchema } from "./routes/understanding.js";
import { Store } from "./store.js";
import { AppError, type Run } from "./types.js";
import { Workbench } from "./workbench.js";

const previousPath = process.env.PATH;
let fakeBin: string;

before(async () => {
  fakeBin = await mkdtemp(path.join(os.tmpdir(), "bell-understanding-lbh-bin-"));
  for (const name of ["codex", "claude", "gh"])
    await writeFile(path.join(fakeBin, name), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  process.env.PATH = `${fakeBin}${path.delimiter}${previousPath}`;
});

after(async () => {
  process.env.PATH = previousPath;
  await rm(fakeBin, { recursive: true, force: true });
});

const lines = (name: string, count: number) =>
  Array.from({ length: count }, (_, index) => `export const ${name}${index} = ${index};`).join("\n") + "\n";
const ownWords =
  "Retry a GET twice after a 503, waiting a little longer before each new attempt so the server can recover";
const observed = "A POST that meets a 503 is retried too, which can create the same resource twice on the server.";

async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-understanding-lbh-"));
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
  t.after(async () => {
    await workbench.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  const repo = await workbench.importRepository(repository);
  await writeFile(path.join(repository, "src", "a.ts"), lines("a", 40));
  const run: Run = {
    id: "lbh-check-run",
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
    reports: { tester: "No test covers a POST that meets a 503." },
  };
  store.data.runs.push(run);
  const files = await readDiff(run);
  const ready = changeFingerprint(files);
  run.learnByHand = true;
  run.byHand = {
    plan: {
      steps: [{ id: "s1", title: "Retry a GET twice after a 503", files: ["src/a.ts"], how: ownWords }],
      savedAt: new Date().toISOString(),
      confirmedAt: new Date().toISOString(),
    },
    ready: { at: new Date().toISOString(), changeFingerprint: ready, review: true },
    reviews: [
      {
        at: new Date().toISOString(),
        changeFingerprint: ready,
        verified: "Your last run passed.",
        checked: ["the retry loop"],
        findings: [{ path: "src/a.ts", line: 3, observed, evidence: { type: "rule" }, why: "It is not idempotent.", question: "Which methods should retry?" }],
      },
    ],
  };
  return { workbench, run, files };
}

test("once an answer is on record, a second tab can't change it before the grade (quiz and walkthrough unit)", async (t) => {
  const f = await fixture(t);
  delete f.run.learnByHand;
  const [file] = f.files;
  const save = (input: Omit<Parameters<typeof f.workbench.understanding.saveAttempt>[1], "filePath" | "fingerprint">) =>
    withLocale("en", () => f.workbench.understanding.saveAttempt(f.run.id, { filePath: file.path, fingerprint: file.fingerprint, ...input }));
  const answered = (error: AppError) =>
    error.statusCode === 409 && /^Your answer is already saved/.test(error.message);
  // Tab A answers and sees the reference; tab B, still open on the question, then sends something else.
  await save({ quiz: { answer: "It exports forty constants", confidence: "think" } });
  await assert.rejects(save({ quiz: { answer: "Each constant equals its line number" } }), answered);
  await assert.rejects(save({ quiz: { answer: "It exports forty constants", confidence: "sure" } }), answered);
  await assert.rejects(save({ quiz: { skipped: true } }), answered);
  // The same answer sent again is fine, and so is the grade.
  await save({ quiz: { answer: " It exports forty constants ", confidence: "think" } });
  await save({ quiz: { grade: "got" } });
  assert.deepEqual(
    { ...f.run.attempts?.[file.path]?.quiz, at: "" },
    { answer: "It exports forty constants", confidence: "think", grade: "got", at: "" },
  );
  // A walkthrough unit the same way (D1).
  await save({ walkthrough: { unit: "a0:1", answer: "It exports the first constant", confidence: "guess" } });
  await assert.rejects(save({ walkthrough: { unit: "a0:1", answer: "It exports a0, which is 0" } }), answered);
  await assert.rejects(save({ walkthrough: { unit: "a0:1", confidence: "sure" } }), answered);
  await assert.rejects(save({ walkthrough: { unit: "a0:1", skipped: true } }), answered);
  await save({ walkthrough: { unit: "a0:1", answer: "It exports the first constant", confidence: "guess" } });
  await save({ walkthrough: { unit: "a0:1", grade: "partly" } });
  const unit = f.run.attempts?.[file.path]?.walkthroughs?.["a0:1"];
  assert.deepEqual([unit?.answer, unit?.confidence, unit?.grade], ["It exports the first constant", "guess", "partly"]);
  // Another unit is its own question.
  await save({ walkthrough: { unit: "a1:2", answer: "It exports a1", confidence: "sure" } });
});

test("a walkthrough unit's answer is stored with the file's attempt, final once graded (D1)", async (t) => {
  const f = await fixture(t);
  delete f.run.learnByHand;
  const [file] = f.files;
  const input = attemptSchema.parse({
    filePath: file.path,
    fingerprint: file.fingerprint,
    walkthrough: { unit: "a0:1", answer: "It exports the first constant", confidence: "think" },
  });
  await f.workbench.understanding.saveAttempt(f.run.id, input);
  await f.workbench.understanding.saveAttempt(f.run.id, { filePath: file.path, fingerprint: file.fingerprint, walkthrough: { unit: "a0:1", grade: "partly" } });
  assert.deepEqual(
    Object.fromEntries(Object.entries(f.run.attempts![file.path].walkthroughs!).map(([unit, answer]) => [unit, [answer.answer, answer.confidence, answer.grade]])),
    { "a0:1": ["It exports the first constant", "think", "partly"] },
  );
  await assert.rejects(
    f.workbench.understanding.saveAttempt(f.run.id, { filePath: file.path, fingerprint: file.fingerprint, walkthrough: { unit: "a0:1", answer: "Something else" } }),
    (error: AppError) => error.statusCode === 409,
  );
  // Strict: unknown keys and over-long keys are refused, and a walkthrough alone is an attempt.
  assert.throws(() => attemptSchema.parse({ ...input, walkthrough: { ...input.walkthrough, why: "x" } }));
  assert.throws(() => attemptSchema.parse({ ...input, walkthrough: { unit: "x".repeat(301) } }));
  assert.throws(() => attemptSchema.parse({ filePath: file.path, fingerprint: file.fingerprint }));
  // At most 12 units per file.
  for (let index = 0; index < 11; index++)
    await f.workbench.understanding.saveAttempt(f.run.id, { filePath: file.path, fingerprint: file.fingerprint, walkthrough: { unit: `u${index}:1`, skipped: true } });
  await assert.rejects(
    f.workbench.understanding.saveAttempt(f.run.id, { filePath: file.path, fingerprint: file.fingerprint, walkthrough: { unit: "u99:1", skipped: true } }),
    (error: AppError) => error.statusCode === 409,
  );
});
