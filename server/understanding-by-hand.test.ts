// Explain it back on the server for a Learn-by-hand run (DESIGN v1.2 F10).
// Agent runs keep their behaviour: the existing tests in
// server/understanding.test.ts pass unedited. Fake codex, claude and gh
// come first on PATH.
import test, { after, before, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { changeFingerprint } from "../shared/understanding.js";
import { readDiff } from "./git.js";
import { withLocale } from "./i18n/index.js";
import { git } from "./process.js";
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

const summary =
  "The client now retries a GET twice after a 503 and waits a little longer before each new attempt.";

test("a Learn-by-hand check asks the fixed question and accepts the person's own words back", async (t) => {
  const f = await fixture(t);
  const view = await withLocale("en", () => f.workbench.understanding.status(f.run.id));
  assert.deepEqual(
    view.plan.map((item) => [item.id, item.question]),
    [
      ["fallback:src/a.ts", "You wrote the change to `src/a.ts`. Why this way rather than another, and what would break if it were wrong?"],
      ["untested", "What did you not test, and why?"],
    ],
  );
  assert.equal(view.plan[0].copyReference, `The guide's review: ${observed} It is not idempotent.`);
  assert.equal(view.plan[1].copyReference, "No test covers a POST that meets a 503.");
  // Repeating 10+ words of the review's finding is a copy.
  await assert.rejects(
    withLocale("en", () =>
      f.workbench.understanding.saveAnswers(f.run.id, {
        summary,
        items: [
          { id: "fallback:src/a.ts", answer: "A POST that meets a 503 is retried too, which can create the same resource twice", confidence: "think" },
          { id: "untested", answer: "I did not test a server that never recovers.", confidence: "think" },
        ],
        changeFingerprint: view.changeFingerprint,
      }),
    ),
    (error: AppError) => error.statusCode === 422 && /repeats the AI-written reference/.test(error.message),
  );
  // Repeating 10+ words of their own step word for word is accurate recall, never a copy
  // (the whole reference, their words and the review's, would have called it one).
  const saved = await withLocale("en", () =>
    f.workbench.understanding.saveAnswers(f.run.id, {
      summary,
      items: [
        { id: "fallback:src/a.ts", answer: ownWords, confidence: "think" },
        { id: "untested", answer: "I did not test a server that never recovers.", confidence: "think" },
      ],
      changeFingerprint: view.changeFingerprint,
    }),
  );
  assert.equal(saved.run.understanding?.items?.length, 2);
});

