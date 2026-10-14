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
 * The width git writes each file's conflict markers in: 7, unless the
 * checkout's `conflict-marker-size` attribute sets another. merge-tree reads
 * the same attributes, so markers are always looked for at the width written.
 */
async function markerWidths(cwd: string, files: string[]) {
  const widths = new Map<string, number>();
  if (!files.length) return widths;
  const fields = (
    await git(cwd, ["check-attr", "-z", "conflict-marker-size", "--", ...files])
  ).stdout.split("\0");
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const width = Number(fields[index + 2]);
    if (Number.isInteger(width) && width > 0) widths.set(fields[index], width);
  }
  return widths;
}

const markerLine = (width: number) =>
  new RegExp(`^(?:<{${width}}|>{${width}})(?: |\\r?$)|^={${width}}\\r?$`, "m");

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
  const widths = await markerWidths(cwd, conflicts);
  const byWidth = new Map<number, string[]>();
  for (const file of conflicts) {
    const width = widths.get(file) ?? 7;
    byWidth.set(width, [...(byWidth.get(width) ?? []), file]);
  }
  const marked = new Set<string>();
  for (const [width, files] of byWidth) {
    const result = await git(
      cwd,
      [
        "--literal-pathspecs",
        "grep",
        "-l",
        "-z",
        "-G",
        "-e",
        `^${"<".repeat(width)} `,
        "-e",
        `^${">".repeat(width)} `,
        "-e",
        `^${"=".repeat(width)}$`,
        tree,
        "--",
        ...files,
      ],
      { allowedCodes: [0, 1] },
    );
    for (const entry of result.stdout.split("\0").filter(Boolean))
      marked.add(entry.slice(tree.length + 1));
  }
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

/** The conflicted files that still hold conflict markers. */
export async function filesWithConflictMarkers(cwd: string, files: string[]) {
  const safe = files.filter((file) => safeRelativePath(file));
  const widths = await markerWidths(cwd, safe);
  const open: string[] = [];
  for (const file of safe) {
    const content = await readFile(path.join(cwd, file), "utf8").catch(() => "");
    if (markerLine(widths.get(file) ?? 7).test(content)) open.push(file);
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
  const safe = files.filter((file) => safeRelativePath(file));
  const widths = await markerWidths(cwd, safe);
  for (const file of safe) {
    const full = path.join(cwd, file);
    const content = await readFile(full, "latin1").catch(() => undefined);
    if (content === undefined) continue;
    const width = widths.get(file) ?? 7;
    const labelled = content.replace(
      new RegExp(`^(<{${width}}|>{${width}}) ([0-9a-f]{40,64})(\\r?)$`, "gm"),
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
