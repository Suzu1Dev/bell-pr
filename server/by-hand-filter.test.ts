// The code filter's file access (server/by-hand-filter.ts): files at the
// base commit and in the worktree, read once per turn, at most 10 per
// answer, and never outside the repository.
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { filterGuideAnswer, filterStoredCode, filterStoredText, turnFiles } from "./by-hand-filter.js";
import { git } from "./process.js";

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
