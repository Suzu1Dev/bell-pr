/**
 * A temporary integration repository for coordination tests: a bare
 * repository whose `integration` branch starts at one commit of `files`,
 * and a clone that makes participants' commits and pushes them to it.
 */
import { chmod, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { git } from "../server/process.js";

export interface TestRepo {
  bare: string;
  /** The commit `integration` starts at. */
  base: string;
  /**
   * Commits on top of `parent`: each rename first, then each file (null
   * removes it), then links, modes and submodules, and pushes the commit
   * so the bare repository has it.
   */
  commit(
    parent: string,
    files: Record<string, string | null>,
    options?: {
      renames?: [string, string][];
      message?: string;
      /** Symbolic links to make, each path to its target. */
      links?: Record<string, string>;
      /** Files to make executable. */
      executable?: string[];
      /** Submodule entries to add, each path to a commit. */
      submodules?: Record<string, string>;
    },
  ): Promise<string>;
  /** A merge of `other` into `parent`, pushed like commit(). */
  merge(parent: string, other: string): Promise<string>;
  /** Where a branch of the bare repository points. */
  head(branch?: string): Promise<string>;
  /** Moves a branch of the bare repository directly, as a push around coordination would. */
  move(sha: string, branch?: string): Promise<void>;
}

export const initialFiles: Record<string, string> = {
  "README.md": "readme\n",
  "src/a.ts": "a\n",
  "src/b.ts": "b\n",
  "lib/c.ts": "c\n",
  "docs/guide.md": "guide\n",
};

export async function makeRepo(root: string): Promise<TestRepo> {
  const bare = path.join(root, "integration.git");
  const work = path.join(root, "work");
  await git(root, ["init", "-q", "--bare", "-b", "main", bare]);
  await git(root, ["clone", "-q", bare, work]);
  await git(work, ["config", "user.name", "Coordination Test"]);
  await git(work, ["config", "user.email", "coordination@example.invalid"]);
  await git(work, ["config", "commit.gpgsign", "false"]);
  await git(work, ["checkout", "-q", "-b", "main"]);
  const write = async (files: Record<string, string | null>) => {
    for (const [file, content] of Object.entries(files)) {
      const target = path.join(work, file);
      if (content === null) await rm(target);
      else {
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, content);
      }
    }
  };
  const headOf = async (cwd: string, ref: string) =>
    (await git(cwd, ["rev-parse", ref])).stdout.trim();
  await write(initialFiles);
  await git(work, ["add", "-A"]);
  await git(work, ["commit", "-q", "-m", "initial"]);
  const base = await headOf(work, "HEAD");
  await git(work, ["push", "-q", "origin", `${base}:refs/heads/main`, `${base}:refs/heads/integration`]);
  let pushed = 0;
  const publish = async () => {
    const sha = await headOf(work, "HEAD");
    pushed += 1;
    await git(work, ["push", "-q", "origin", `${sha}:refs/heads/work-${pushed}`]);
    return sha;
  };
  return {
    bare,
    base,
    async commit(parent, files, options = {}) {
      await git(work, ["checkout", "-q", "--detach", parent]);
      for (const [from, to] of options.renames ?? []) {
        await mkdir(path.dirname(path.join(work, to)), { recursive: true });
        await git(work, ["mv", from, to]);
      }
      await write(files);
      for (const [file, target] of Object.entries(options.links ?? {})) {
        await mkdir(path.dirname(path.join(work, file)), { recursive: true });
        await symlink(target, path.join(work, file));
      }
      for (const file of options.executable ?? []) await chmod(path.join(work, file), 0o755);
      await git(work, ["add", "-A"]);
      for (const [file, sha] of Object.entries(options.submodules ?? {})) {
        // An empty directory is how Git leaves a submodule not checked out.
        await mkdir(path.join(work, file), { recursive: true });
        await git(work, ["update-index", "--add", "--cacheinfo", `160000,${sha},${file}`]);
      }
      await git(work, ["commit", "-q", "-m", options.message ?? "change"]);
      return await publish();
    },
    async merge(parent, other) {
      await git(work, ["checkout", "-q", "--detach", parent]);
      await git(work, ["merge", "-q", "--no-ff", "-m", "merge", other]);
      return await publish();
    },
    head: (branch = "integration") => headOf(bare, `refs/heads/${branch}`),
    async move(sha, branch = "integration") {
      await git(bare, ["update-ref", `refs/heads/${branch}`, sha]);
    },
  };
}
