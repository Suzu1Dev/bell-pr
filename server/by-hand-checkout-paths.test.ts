// The paths a Learn-by-hand agent names (the outline's step files and
// read-first ranges, a walkthrough's refs) are kept only when they are the
// checkout's: at the base commit, or in the worktree only where Git tracks
// the file or would track it (untracked, not ignored), as the filter's
// reader reads them (server/by-hand-filter.ts turnFiles). An ignored file
// or folder (.env, node_modules, build output) never stays as a ref.
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { checkoutPaths } from "./by-hand.js";
import { git } from "./process.js";

async function repository(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-by-hand-checkout-paths-"));
  const worktreePath = path.join(directory, "repo");
  await mkdir(path.join(worktreePath, "src"), { recursive: true });
  await git(worktreePath, ["init", "-b", "main"]);
  await git(worktreePath, ["config", "user.name", "BELL Test"]);
  await git(worktreePath, ["config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(worktreePath, ".gitignore"), ".env\nnode_modules/\nbuild/\n");
  await writeFile(path.join(worktreePath, "src", "retry.ts"), "export const attempts = 1;\n");
  await git(worktreePath, ["add", "--", "."]);
  await git(worktreePath, ["commit", "-m", "initial"]);
  const baseSha = (await git(worktreePath, ["rev-parse", "HEAD"])).stdout.trim();
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, run: { baseSha, worktreePath } };
}

test("a named path in the worktree stays only when Git tracks it or would track it, never an ignored one", async (t) => {
  const { directory, run } = await repository(t);
  const root = run.worktreePath;
  // Ignored: a secret, a dependency folder, build output.
  await writeFile(path.join(root, ".env"), "API_TOKEN=abc\n");
  await mkdir(path.join(root, "node_modules", "retry-kit"), { recursive: true });
  await writeFile(path.join(root, "node_modules", "retry-kit", "index.js"), "export const retryBudget = () => 3;\n");
  await mkdir(path.join(root, "build"), { recursive: true });
  await writeFile(path.join(root, "build", "out.js"), "export const out = 1;\n");
  // The person's new file and folder (untracked, not ignored), and an ignored file the project tracks anyway.
  await mkdir(path.join(root, "lib", "backoff"), { recursive: true });
  await writeFile(path.join(root, "lib", "backoff", "index.ts"), "export const backoff = 100;\n");
  await writeFile(path.join(root, "build", "kept.js"), "export const kept = 1;\n");
  await git(root, ["add", "--force", "--", "build/kept.js"]);
  // A folder that holds only ignored files, and a link out of the worktree.
  await mkdir(path.join(root, "src", "cache"), { recursive: true });
  await writeFile(path.join(root, ".gitignore"), ".env\nnode_modules/\nbuild/\nsrc/cache/\n");
  await writeFile(path.join(root, "src", "cache", "hit.json"), "{}\n");
  await writeFile(path.join(directory, "outside.ts"), "export const secret = 1;\n");
  await symlink(path.join(directory, "outside.ts"), path.join(root, "src", "outside.ts"));

  const found = await checkoutPaths(run, [
    ".env",
    "node_modules",
    "node_modules/retry-kit/index.js",
    "build/out.js",
    "src/cache",
    "src/cache/hit.json",
    "lib/backoff/index.ts",
    "lib/backoff",
    "lib",
    "build/kept.js",
    "build",
    "src/retry.ts",
    "src",
    "src/missing.ts",
  ]);
  assert.deepEqual(Object.fromEntries(found), {
    // At the base commit.
    "src/retry.ts": "file",
    src: "folder",
    // In the worktree: what Git tracks or would track, and the folders that hold it.
    "lib/backoff/index.ts": "file",
    "lib/backoff": "folder",
    lib: "folder",
    "build/kept.js": "file",
    build: "folder",
  });
  // A link Git would track still never leads out of the worktree.
  assert.equal((await checkoutPaths(run, ["src/outside.ts"])).size, 0);
});

test("a named path is a literal path, never a pattern", async (t) => {
  const { run } = await repository(t);
  await writeFile(path.join(run.worktreePath, "src", "backoff.ts"), "export const backoff = 100;\n");
  const found = await checkoutPaths(run, ["src/*", "src/back?ff.ts", "*", ":(glob)src/**", "src/backoff.ts"]);
  assert.deepEqual(Object.fromEntries(found), { "src/backoff.ts": "file" });
});
