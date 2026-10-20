// The filter's file reader (server/by-hand-filter.ts) takes paths from agent
// output: a path that is no file of the checkout at base or in the worktree
// has no lines, so it can't carry code as a "file" of one empty line, a ref
// or a read-first range. Globs, folders, unnormalised paths, backslashes,
// control characters, links out of the worktree and binary files are never
// read as text.
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { filterGuideAnswer, turnFiles } from "./by-hand-filter.js";
import { git } from "./process.js";

async function repository(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-by-hand-paths-"));
  const worktreePath = path.join(directory, "repo");
  await mkdir(path.join(worktreePath, "src"), { recursive: true });
  await git(worktreePath, ["init", "-b", "main"]);
  await git(worktreePath, ["config", "user.name", "BELL Test"]);
  await git(worktreePath, ["config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(worktreePath, "src", "retry.ts"), "export const attempts = 1;\n");
  await writeFile(path.join(worktreePath, "src", "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0x0a, 0x41, 0x42]));
  await git(worktreePath, ["add", "--", "."]);
  await git(worktreePath, ["commit", "-m", "initial"]);
  const baseSha = (await git(worktreePath, ["rev-parse", "HEAD"])).stdout.trim();
  // A folder outside the repository, reached through a link to the folder.
  await mkdir(path.join(directory, "outside"));
  await writeFile(path.join(directory, "outside", "notes.ts"), "export const secret = 1;\n");
  await symlink(path.join(directory, "outside"), path.join(worktreePath, "src", "out"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { baseSha, worktreePath };
}

test("a path that is no file of the checkout has no lines at base, globs and folders included", async (t) => {
  const run = await repository(t);
  const named = ["src/*", "src/retry.ts[1]", "src/re?ry.ts", "return delay*2;", "src", "src/out/notes.ts", "src/logo.png"];
  const sources = await turnFiles(run).sources(named);
  for (const file of named) {
    assert.equal(sources.base[file], undefined, `base ${file}`);
    assert.equal(sources.worktree[file], undefined, `worktree ${file}`);
  }
  assert.deepEqual((await turnFiles(run).sources(["src/retry.ts"])).base["src/retry.ts"], ["export const attempts = 1;"]);
});

test("only a normalised repository path is read: no dot parts, double slashes, backslashes or control characters", async (t) => {
  const run = await repository(t);
  const named = ["./src/retry.ts", "src//retry.ts", "src/./retry.ts", "src/../src/retry.ts", "src\\retry.ts", "src/retry.ts\n```", "src/\u0000retry.ts", "src/"];
  const sources = await turnFiles(run).sources(named);
  assert.deepEqual(Object.keys(sources.base), []);
  assert.deepEqual(Object.keys(sources.worktree), []);
});

test("a ref or a quote at a path that is no file is dropped, so its path never stores code", async (t) => {
  const run = await repository(t);
  const filtered = await filterGuideAnswer(
    turnFiles(run),
    {
      text: "Look there.",
      question: null,
      refs: [
        { path: "return delay*2**attempt;", line: 1, endLine: null },
        { path: "src/[retry]", line: 1, endLine: null },
        { path: "src/retry.ts", line: 1, endLine: null },
      ],
      quotes: [{ path: "x?=delay*2", startLine: 1, endLine: 1, from: "base", anchor: null }],
      options: null,
      topic: "project",
      askedForCode: false,
    },
    { changed: [] },
  );
  assert.deepEqual(filtered.value.refs, [{ path: "src/retry.ts", line: 1 }]);
  assert.deepEqual(filtered.value.quotes, []);
  assert.equal(filtered.dropped, 3);
});
