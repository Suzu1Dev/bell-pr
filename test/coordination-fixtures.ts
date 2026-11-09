/**
 * A temporary integration repository for coordination tests: a bare
 * repository whose `integration` branch starts at one commit of `files`,
 * and a clone that makes participants' commits and pushes them to it.
 */
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
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
  /** A merge of `other` into `parent`, pushed like commit(); `ours` keeps `parent`'s files. */
  merge(parent: string, other: string, strategy?: "ours"): Promise<string>;
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
    async merge(parent, other, strategy) {
      await git(work, ["checkout", "-q", "--detach", parent]);
      await git(work, ["merge", "-q", "--no-ff", ...(strategy ? ["-s", strategy] : []), "-m", "merge", other]);
      return await publish();
    },
    head: (branch = "integration") => headOf(bare, `refs/heads/${branch}`),
    async move(sha, branch = "integration") {
      await git(bare, ["update-ref", `refs/heads/${branch}`, sha]);
    },
  };
}

/**
 * Writes the commit-graph of every commit the bare repository reaches, as
 * Git makes it: one file, or a split chain of one layer. Any graph already
 * there goes first, because Git writes a graph from the commits it reads
 * through the old one.
 */
export async function writeCommitGraph(bare: string, layout: "single" | "split") {
  const info = path.join(bare, "objects", "info");
  await rm(path.join(info, "commit-graph"), { force: true });
  await rm(path.join(info, "commit-graphs"), { recursive: true, force: true });
  await git(bare, ["commit-graph", "write", "--reachable", ...(layout === "split" ? ["--split=no-merge"] : [])]);
}

/**
 * Rewrites one commit's parents or tree in the graph writeCommitGraph wrote,
 * with a checksum that matches, so Git loads it like one it wrote. Git
 * writes the files read-only; write access to the repository directory
 * replaces them, which a push does not give.
 */
export async function forgeCommitGraph(
  bare: string,
  layout: "single" | "split",
  commit: string,
  change: { parents?: string[]; tree?: string },
) {
  const replace = async (file: string, data: Buffer | string) => {
    await writeFile(`${file}.tmp`, data);
    await rename(`${file}.tmp`, file);
  };
  const info = path.join(bare, "objects", "info");
  if (layout === "single") {
    const file = path.join(info, "commit-graph");
    return await replace(file, forgedGraph(await readFile(file), commit, change));
  }
  const dir = path.join(info, "commit-graphs");
  const chain = path.join(dir, "commit-graph-chain");
  const layers = (await readFile(chain, "utf8")).trim().split("\n");
  if (layers.length !== 1) throw new Error("forgeCommitGraph expects one layer");
  const data = forgedGraph(await readFile(path.join(dir, `graph-${layers[0]}.graph`)), commit, change);
  const hash = data.subarray(-20).toString("hex");
  await writeFile(path.join(dir, `graph-${hash}.graph`), data);
  await replace(chain, `${hash}\n`);
}

/** A SHA-1 commit-graph layer with one commit's CDAT row changed and its checksum redone. */
function forgedGraph(graph: Buffer, commit: string, change: { parents?: string[]; tree?: string }) {
  const out = Buffer.from(graph);
  if (out.toString("latin1", 0, 4) !== "CGPH" || out[5] !== 1) throw new Error("not a SHA-1 commit-graph");
  const chunks: Record<string, number> = {};
  for (let i = 0; i < out[6]; i++) {
    const at = 8 + i * 12;
    chunks[out.toString("latin1", at, at + 4)] = Number(out.readBigUInt64BE(at + 4));
  }
  if (chunks.BASE !== undefined) throw new Error("forgeCommitGraph expects one layer");
  const count = out.readUInt32BE(chunks.OIDF + 255 * 4);
  const position = (sha: string) => {
    for (let i = 0; i < count; i++)
      if (out.toString("hex", chunks.OIDL + i * 20, chunks.OIDL + (i + 1) * 20) === sha) return i;
    throw new Error(`${sha} is not in the commit-graph`);
  };
  // Each row: tree id, first and second parent positions, generation and date.
  const row = chunks.CDAT + position(commit) * 36;
  if (change.tree) Buffer.from(change.tree, "hex").copy(out, row);
  if (change.parents) {
    if (change.parents.length > 2) throw new Error("forgeCommitGraph takes at most two parents");
    const none = 0x70000000;
    const [first, second] = change.parents.map(position);
    out.writeUInt32BE(first ?? none, row + 20);
    out.writeUInt32BE(second ?? none, row + 24);
  }
  createHash("sha1").update(out.subarray(0, -20)).digest().copy(out, out.length - 20);
  return out;
}
