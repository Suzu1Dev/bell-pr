// The code filter's file access (server/by-hand-filter.ts): files at the
// base commit and in the worktree, read once per turn, at most 10 per
// answer, and never outside the repository.
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { filteredError, filterGuideAnswer, filterStoredCode, filterStoredText, turnFiles } from "./by-hand-filter.js";
import { git } from "./process.js";
import { AppError } from "./types.js";

async function repository(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-by-hand-filter-"));
  const worktreePath = path.join(directory, "repo");
  await mkdir(path.join(worktreePath, "src"), { recursive: true });
  await git(worktreePath, ["init", "-b", "main"]);
  await git(worktreePath, ["config", "user.name", "BELL Test"]);
  await git(worktreePath, ["config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(worktreePath, "src", "retry.ts"), "export const attempts = 1;\nexport const delay = 0;\n");
  await git(worktreePath, ["add", "--", "."]);
  await git(worktreePath, ["commit", "-m", "initial"]);
  const baseSha = (await git(worktreePath, ["rev-parse", "HEAD"])).stdout.trim();
  // The person's edit, and a secret outside the repository.
  await writeFile(path.join(worktreePath, "src", "retry.ts"), "export const attempts = 2;\nexport const delay = 0;\n");
  await writeFile(path.join(directory, "secret.txt"), "TOKEN=abc\n");
  await symlink(path.join(directory, "secret.txt"), path.join(worktreePath, "src", "link.txt"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, run: { baseSha, worktreePath } };
}

test("a turn reads each file at base and in the worktree once, inside the repository only", async (t) => {
  const { directory, run } = await repository(t);
  const files = turnFiles(run);
  const sources = await files.sources(["src/retry.ts", "src/retry.ts", "../secret.txt", "/etc/hostname", "src/link.txt", "-p", "src/missing.ts"]);
  assert.deepEqual(Object.keys(sources.base), ["src/retry.ts", "src/link.txt", "src/missing.ts"]);
  assert.deepEqual(sources.base["src/retry.ts"], ["export const attempts = 1;", "export const delay = 0;"]);
  assert.deepEqual(sources.worktree["src/retry.ts"], ["export const attempts = 2;", "export const delay = 0;"]);
  // A link out of the worktree is never followed; a missing file has no lines.
  assert.equal(sources.worktree["src/link.txt"], undefined);
  assert.equal(sources.base["src/missing.ts"], undefined);
  // Within the turn a file is read once, even when it changes meanwhile.
  await writeFile(path.join(run.worktreePath, "src", "retry.ts"), "export const attempts = 3;\n");
  assert.deepEqual((await files.sources(["src/retry.ts"])).worktree["src/retry.ts"], ["export const attempts = 2;", "export const delay = 0;"]);
  assert.deepEqual((await turnFiles(run).sources(["src/retry.ts"])).worktree["src/retry.ts"], ["export const attempts = 3;"]);
  // At most 10 files per answer.
  const many = await turnFiles(run).sources(Array.from({ length: 14 }, (_, index) => `src/f${index}.ts`));
  assert.equal(Object.keys(many.base).length, 10);
  assert.ok(directory);
});

test("an answer is filtered against its cited files and the changed ones", async (t) => {
  const { run } = await repository(t);
  const files = turnFiles(run);
  const filtered = await filterGuideAnswer(
    files,
    {
      text: "Change `export const attempts = 2;`? You did. Then `sed -i s/2/3/ src/retry.ts`.",
      question: null,
      refs: [{ path: "src/retry.ts", line: 1, endLine: null }],
      quotes: [{ path: "src/retry.ts", startLine: 1, endLine: 1, from: "base", anchor: "attempts" }],
      options: null,
      topic: "tooling",
      askedForCode: false,
    },
    { changed: ["src/retry.ts"] },
  );
  assert.equal(filtered.value.text, "Change `export const attempts = 2;`? You did. Then ….");
  assert.deepEqual(filtered.value.quotes, [
    { path: "src/retry.ts", from: "base", startLine: 1, endLine: 1, text: "export const attempts = 1;" },
  ]);
  assert.equal(filtered.removed, 1);
  const report = await filterStoredText(files, "Use `retryLater(attempts)` here.", { changed: ["src/retry.ts"] });
  assert.deepEqual(report, { value: "Use … here.", removed: 1, dropped: 0 });
  assert.equal((await filterStoredCode(files, "export const attempts = 9;", { changed: ["src/retry.ts"] })).dropped, 1);
});

test("filteredError: one helper filters an agent turn's error and keeps BELL's own messages whole", () => {
  const fix = { label: "Sign in", command: "codex login" };
  const leaked = new AppError("codex failed: change it to\n```ts\nexport const attempts = retryBudget();\n```", 422, { fixes: [fix] });
  const filtered = filteredError(leaked);
  assert.ok(filtered instanceof AppError);
  assert.doesNotMatch(filtered.message, /retryBudget|```/);
  assert.equal((filtered as AppError).statusCode, 422);
  assert.deepEqual((filtered as AppError).fixes, [fix]);
  assert.doesNotMatch(filteredError(new Error("```ts\nreturn retry(fn);\n```")).message, /retry\(fn\)/);
  // Nothing to remove: the same error. A timeout (504) or a setup error (with a code) stays whole.
  const plain = new AppError("The guide could not start.", 422);
  assert.equal(filteredError(plain), plain);
  const timeout = new AppError("```ts\nreturn retry(fn);\n```", 504);
  assert.equal(filteredError(timeout), timeout);
});

test("a turn reads only worktree files Git tracks or would track, never ignored ones such as .env or node_modules", async (t) => {
  const { run } = await repository(t);
  const root = run.worktreePath;
  await writeFile(path.join(root, ".gitignore"), ".env\nnode_modules/\nbuild/\n");
  await writeFile(path.join(root, ".env"), "API_TOKEN=abc\n");
  await mkdir(path.join(root, "node_modules", "retry-kit"), { recursive: true });
  await writeFile(path.join(root, "node_modules", "retry-kit", "index.js"), "export const retryBudget = () => 3;\n");
  await mkdir(path.join(root, "build"), { recursive: true });
  await writeFile(path.join(root, "build", "kept.js"), "export const kept = 1;\n");
  // A file the person added and Git would track, and an ignored one the project tracks anyway.
  await writeFile(path.join(root, "src", "backoff.ts"), "export const backoff = 100;\n");
  await git(root, ["add", "--force", "--", "build/kept.js"]);
  const sources = await turnFiles(run).sources([".env", "node_modules/retry-kit/index.js", "src/backoff.ts", "build/kept.js", "src/retry.ts"]);
  assert.equal(sources.worktree[".env"], undefined);
  assert.equal(sources.worktree["node_modules/retry-kit/index.js"], undefined);
  assert.deepEqual(sources.worktree["src/backoff.ts"], ["export const backoff = 100;"]);
  assert.deepEqual(sources.worktree["build/kept.js"], ["export const kept = 1;"]);
  assert.deepEqual(sources.worktree["src/retry.ts"], ["export const attempts = 2;", "export const delay = 0;"]);
  // So a "change" quote or verbatim code from an ignored file is never kept.
  const kept = await filterStoredCode(turnFiles(run), "export const retryBudget = () => 3;", {
    changed: ["src/retry.ts"],
    cited: ["node_modules/retry-kit/index.js"],
  });
  assert.deepEqual(kept, { value: undefined, removed: 0, dropped: 1 });
});
