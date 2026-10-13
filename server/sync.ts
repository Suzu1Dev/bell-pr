import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { safeRelativePath } from "./git.js";
import { git } from "./process.js";
import { AppError } from "./types.js";

/** Internal commits that never leave the machine carry BELL's own identity. */
const internalIdentity = {
  GIT_AUTHOR_NAME: "BELL",
  GIT_AUTHOR_EMAIL: "bell@localhost.invalid",
  GIT_COMMITTER_NAME: "BELL",
  GIT_COMMITTER_EMAIL: "bell@localhost.invalid",
};

/**
 * Commits the checkout as it is, tracked edits and new files that are not
 * ignored, on top of HEAD. A private index is used, so the checkout's own
 * index and files are untouched. The commit is a local backup, never pushed.
 */
export async function snapshotCheckout(cwd: string, indexPath: string) {
  const env = { ...process.env, GIT_INDEX_FILE: indexPath };
  try {
    await git(cwd, ["read-tree", "HEAD"], { env });
    await git(cwd, ["add", "-A", "--", "."], { env });
    const tree = (await git(cwd, ["write-tree"], { env })).stdout.trim();
    return (
      await git(cwd, ["commit-tree", tree, "-p", "HEAD"], {
        input: "BELL: checkout before syncing with the target branch\n",
        env: { ...process.env, ...internalIdentity },
      })
    ).stdout.trim();
  } finally {
    await rm(indexPath, { force: true });
  }
}

/**
 * Three-way merges two commits without touching any checkout. The tree holds
 * conflict markers in every listed conflict, the way `git merge` writes them.
 */
export async function mergeCommits(
  cwd: string,
  ours: string,
  theirs: string,
  base?: string,
) {
  const result = await git(
    cwd,
    [
      "merge-tree",
      "--write-tree",
      "--name-only",
      "--no-messages",
      "-z",
      ...(base ? [`--merge-base=${base}`] : []),
      ours,
      theirs,
    ],
    { allowedCodes: [0, 1] },
  );
  const [tree = "", ...conflicts] = result.stdout.split("\0").filter(Boolean);
  if (!/^[0-9a-f]{40,64}$/.test(tree))
    throw new AppError("無法計算合併結果。", 500);
  return {
    tree,
    conflicts: [...new Set(conflicts)].filter((file) => safeRelativePath(file)),
  };
}

/**
 * Makes the checkout's files match `tree` while HEAD and the index stay at
 * `head`, so the difference reads as uncommitted changes, which is how BELL
 * keeps a contribution until it is published.
 */
export async function checkoutTreeOnto(cwd: string, tree: string, head: string) {
  await git(cwd, ["read-tree", "-u", "--reset", tree]);
  await git(cwd, ["read-tree", head]);
}

const conflictMarker = /^(?:<{7}|>{7})(?: |$)|^={7}$/m;

/** The conflicted files that still hold conflict markers. */
export async function filesWithConflictMarkers(cwd: string, files: string[]) {
  const open: string[] = [];
  for (const file of files) {
    if (!safeRelativePath(file)) continue;
    const content = await readFile(path.join(cwd, file), "utf8").catch(() => "");
    if (conflictMarker.test(content)) open.push(file);
  }
  return open;
}

/** Replaces the commit ids git writes after conflict markers with readable labels. */
export async function labelConflictMarkers(
  cwd: string,
  files: string[],
  labels: Record<string, string>,
) {
  for (const file of files) {
    if (!safeRelativePath(file)) continue;
    const full = path.join(cwd, file);
    const content = await readFile(full, "utf8").catch(() => undefined);
    if (content === undefined) continue;
    const labelled = content.replace(
      /^(<{7}|>{7}) ([0-9a-f]{40,64})$/gm,
      (line, marker: string, commit: string) =>
        labels[commit] ? `${marker} ${labels[commit]}` : line,
    );
    if (labelled !== content) await writeFile(full, labelled);
  }
}
