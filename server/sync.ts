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
 * Conflicts git could not mark: a file deleted on one side and changed on
 * the other, or a binary file changed on both. git keeps one side without
 * markers, so nothing would stop that side from being published unseen.
 */
export async function conflictsWithoutMarkers(
  cwd: string,
  tree: string,
  conflicts: string[],
) {
  if (!conflicts.length) return [];
  const result = await git(
    cwd,
    [
      "--literal-pathspecs",
      "grep",
      "-l",
      "-z",
      "-G",
      "-e",
      "^<<<<<<< ",
      "-e",
      "^>>>>>>> ",
      "-e",
      "^=======$",
      tree,
      "--",
      ...conflicts,
    ],
    { allowedCodes: [0, 1] },
  );
  const marked = new Set(
    result.stdout
      .split("\0")
      .filter(Boolean)
      .map((entry) => entry.slice(tree.length + 1)),
  );
  return conflicts.filter((file) => !marked.has(file));
}

/**
 * Makes the checkout's files match `tree` while the index holds `base`, so
 * the difference reads as uncommitted changes against it, which is how BELL
 * keeps a contribution until it is published. HEAD is not moved.
 */
export async function checkoutTreeOnto(cwd: string, tree: string, base: string) {
  await git(cwd, ["read-tree", "-u", "--reset", tree]);
  await git(cwd, ["read-tree", base]);
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

/**
 * Replaces the commit ids git writes after conflict markers with readable
 * labels. Files are read as latin1, one character per byte, so text in any
 * encoding (Big5, Shift-JIS, …) is written back byte for byte.
 */
export async function labelConflictMarkers(
  cwd: string,
  files: string[],
  labels: Record<string, string>,
) {
  for (const file of files) {
    if (!safeRelativePath(file)) continue;
    const full = path.join(cwd, file);
    const content = await readFile(full, "latin1").catch(() => undefined);
    if (content === undefined) continue;
    const labelled = content.replace(
      /^(<{7}|>{7}) ([0-9a-f]{40,64})(\r?)$/gm,
      (line, marker: string, commit: string, cr: string) =>
        labels[commit]
          ? `${marker} ${Buffer.from(labels[commit]).toString("latin1")}${cr}`
          : line,
    );
    if (labelled !== content) await writeFile(full, labelled, "latin1");
  }
}

/** What the conflict-resolving agent returns after editing the checkout. */
export const conflictJsonSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    files: {
      type: "array",
      items: {
        type: "object",
        properties: { path: { type: "string" }, resolution: { type: "string" } },
        required: ["path", "resolution"],
        additionalProperties: false,
      },
      maxItems: 150,
    },
  },
  required: ["summary", "files"],
  additionalProperties: false,
};

/**
 * Reads the agent's account leniently: the files are already edited, and
 * whether markers remain is checked on disk, not taken from this answer.
 */
export function parseConflictResult(answer: string, conflicts: string[]) {
  let value: unknown;
  try {
    value = JSON.parse(
      answer
        .trim()
        .replace(/^```(?:json)?\s*\n?/, "")
        .replace(/\n?```$/, ""),
    );
  } catch {
    throw new AppError("Agent 回傳的解衝突結果格式不完整", 422);
  }
  const record = (value ?? {}) as { summary?: unknown; files?: unknown };
  const text = (input: unknown, max: number) =>
    typeof input === "string" ? input.trim().slice(0, max) : "";
  return {
    summary: text(record.summary, 8_000),
    resolutions: (Array.isArray(record.files) ? record.files : [])
      .map((entry) => ({
        path: text((entry as { path?: unknown })?.path, 1_024),
        resolution: text((entry as { resolution?: unknown })?.resolution, 1_200),
      }))
      .filter((entry) => entry.resolution && conflicts.includes(entry.path)),
  };
}

/** The writable turn that resolves merge conflict markers left by a sync. */
export function conflictPrompt(input: {
  boundaries: string;
  contributionContext: string;
  task: { title: string; prompt: string };
  baseBranch: string;
  conflicts: string[];
}) {
  return `${input.boundaries}
You are resolving merge conflicts left after BELL moved this contribution onto the latest ${input.baseBranch}. Work only in this checkout. These files hold conflict markers: ${JSON.stringify(input.conflicts)}. In each block, the side labelled "latest ${input.baseBranch}" is the target branch as it is now and the side labelled "this contribution" or "this pull request" is the person's change; either side may come first. Keep the target branch's new work and re-apply the contribution's intent on top of it; when the two truly contradict, keep the target branch's behaviour and explain what of the contribution could not be kept. Edit only these files, except for the smallest follow-on edit a rename or signature change on the target branch forces in a file the contribution already changes. Remove every conflict marker. Run relevant existing checks. Do not commit, stage or change .git.
Return JSON: summary (Traditional Chinese: how you resolved the conflicts and anything the person should check) and files [{path, resolution}] with one Traditional Chinese sentence per resolved file.
${input.contributionContext}
Task: ${JSON.stringify(input.task)}`;
}
