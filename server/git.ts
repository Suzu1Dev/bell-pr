import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { git } from "./process.js";
import { secretInPatch } from "./secrets.js";
import { AppError, withRunLocale, type DiffFile, type Run } from "./types.js";
import { sm } from "./i18n/index.js";

export { secretInPatch };

export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export function parseGitHubSource(
  source: string,
): { owner: string; name: string; fullName: string; url: string } | null {
  const match = source.match(
    /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/,
  );
  if (!match || match[2] === "." || match[2] === "..") return null;
  return {
    owner: match[1],
    name: match[2],
    fullName: `${match[1]}/${match[2]}`,
    url: `https://github.com/${match[1]}/${match[2]}`,
  };
}

/** A GitHub issue page URL; pull requests, API URLs and other hosts are rejected. */
export function parseGitHubIssueUrl(
  source: string,
): { owner: string; name: string; number: number; url: string } | null {
  const match = source.match(
    /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9_.-]+)\/issues\/([1-9]\d{0,9})\/?$/,
  );
  if (!match || match[2] === "." || match[2] === "..") return null;
  return {
    owner: match[1],
    name: match[2],
    number: Number(match[3]),
    url: `https://github.com/${match[1]}/${match[2]}/issues/${match[3]}`,
  };
}

export function safeRelativePath(filePath: string) {
  return (
    !!filePath &&
    !path.isAbsolute(filePath) &&
    !filePath.split("/").some((part) => part === ".." || part === ".git") &&
    !/[\x00-\x1f\x7f\\]/.test(filePath)
  );
}

export function sensitivePath(filePath: string): boolean {
  return (
    /(^|\/)(?:\.env(?:\.(?!example$|sample$|template$)[^/]+)?|\.npmrc|\.pypirc|id_rsa|id_ed25519|credentials(?:\.[^/]+)?|\.DS_Store)(?:$|\/)/i.test(
      filePath,
    ) ||
    /\.(?:pem|p12|pfx|key)$/i.test(filePath) ||
    /(^|\/)(?:node_modules|\.bellpr|\.ssh|\.aws|\.codex|\.git)(?:\/|$)/.test(
      filePath,
    )
  );
}

export function languageFor(filePath: string) {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  return (
    (
      {
        ts: "TypeScript",
        tsx: "TSX",
        js: "JavaScript",
        jsx: "JSX",
        py: "Python",
        rs: "Rust",
        go: "Go",
        css: "CSS",
        scss: "SCSS",
        json: "JSON",
        md: "Markdown",
        yml: "YAML",
        yaml: "YAML",
        html: "HTML",
        sh: "Shell",
        sql: "SQL",
        rb: "Ruby",
        java: "Java",
      } as Record<string, string>
    )[extension] ??
    (extension || "Text")
  );
}

export function parseHunks(patch: string): DiffFile["hunks"] {
  const hunks: DiffFile["hunks"] = [];
  for (const line of patch.split("\n")) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (header)
      hunks.push({
        header: line,
        oldStart: Number(header[1]),
        newStart: Number(header[2]),
        lines: [],
      });
    else if (hunks.length) hunks[hunks.length - 1].lines.push(line);
  }
  return hunks;
}

export function parseNumstat(
  output: string,
): { path: string; additions: number; deletions: number; binary: boolean }[] {
  return output
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const match = /^([^\t]+)\t([^\t]+)\t([\s\S]+)$/.exec(entry);
      if (!match) throw new AppError((m) => m.run.diff.unparsable, 422);
      if (!safeRelativePath(match[3]))
        throw new AppError((m) => m.run.diff.renameFirst, 422);
      return {
        path: match[3],
        additions: Number(match[1]) || 0,
        deletions: Number(match[2]) || 0,
        binary: match[1] === "-",
      };
    });
}

export async function readDiff(
  run: Pick<Run, "worktreePath" | "baseSha" | "locale">,
): Promise<DiffFile[]> {
  if (!run.baseSha || !run.worktreePath) return [];
  // A held-back file's reason is part of its fingerprint and of the draft
  // fingerprint, so it is worded in the run's locale: reading the diff in
  // another language must not make a reviewed draft stale.
  const messages = withRunLocale(run, () => sm().run.diff);
  const held = messages.blocked;
  const common = ["--no-ext-diff", "--no-textconv", "--no-renames"];
  const stats = parseNumstat(
    (
      await git(run.worktreePath, [
        "diff",
        ...common,
        "--numstat",
        "-z",
        run.baseSha,
        "--",
      ])
    ).stdout,
  );
  const untracked = (
    await git(run.worktreePath, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
    ])
  ).stdout
    .split("\0")
    .filter(Boolean);
  const files: DiffFile[] = [];
  let total = 0;
  if (stats.length + untracked.length > 150)
    throw new AppError((m) => m.run.diff.tooManyFiles, 422);
  for (const stat of [
    ...stats.map((value) => ({ ...value, untracked: false })),
    ...untracked.map((filePath) => ({
      path: filePath,
      additions: 0,
      deletions: 0,
      binary: false,
      untracked: true,
    })),
  ]) {
    if (!safeRelativePath(stat.path))
      throw new AppError((m) => m.run.diff.unsupportedName, 422);
    let blocked = sensitivePath(stat.path) ? held.sensitive : undefined;
    let patch = "";
    let status: DiffFile["status"] = "modified";
    let fileMode = "";
    if (stat.untracked) {
      status = "added";
      const fullPath = path.join(run.worktreePath, stat.path);
      const metadata = await lstat(fullPath);
      fileMode = String(metadata.mode);
      if (!metadata.isFile() || metadata.isSymbolicLink())
        blocked = held.notRegularFile;
      if (metadata.size > 512_000) blocked = held.newFileTooLarge;
      if (!blocked) {
        const resolved = await realpath(fullPath);
        const root = await realpath(run.worktreePath);
        if (!resolved.startsWith(root + path.sep))
          throw new AppError((m) => m.run.diff.outsideWorktree, 422);
        patch = (
          await git(
            run.worktreePath,
            ["diff", ...common, "--no-index", "--", "/dev/null", stat.path],
            { allowedCodes: [0, 1], maxBytes: 600_000 },
          )
        ).stdout;
        stat.additions = patch
          .split("\n")
          .filter(
            (line) => line.startsWith("+") && !line.startsWith("+++"),
          ).length;
      }
    } else {
      patch = (
        await git(
          run.worktreePath,
          [
            "--literal-pathspecs",
            "diff",
            ...common,
            run.baseSha,
            "--",
            stat.path,
          ],
          { maxBytes: 600_000 },
        )
      ).stdout;
      status = patch.includes("\nnew file mode ")
        ? "added"
        : patch.includes("\ndeleted file mode ")
          ? "deleted"
          : "modified";
    }
    if (
      stat.binary ||
      patch.includes("Binary files ") ||
      patch.includes("GIT binary patch")
    )
      blocked = held.binary;
    if (secretInPatch(patch)) blocked = held.credentials;
    const fingerprint = digest(
      stat.path + "\0" + (patch || fileMode + blocked),
    );
    if (blocked) patch = messages.heldBack({ reason: blocked });
    total += Buffer.byteLength(patch);
    if (total > 2_000_000)
      throw new AppError((m) => m.run.diff.tooLarge, 422);
    files.push({
      path: stat.path,
      language: languageFor(stat.path),
      additions: stat.additions,
      deletions: stat.deletions,
      status,
      patch,
      fingerprint,
      blocked,
      hunks: parseHunks(patch),
    });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * An edited commit message or GitHub branch invalidates approval exactly like
 * title or body. Each key is added only when set, so fingerprints approved
 * before the fields existed (title and body only) keep matching.
 */
export function reviewFingerprint(files: DiffFile[], draft: Run["draft"]) {
  const commitMessage = draft.commitMessage?.trim();
  const publishBranch = draft.publishBranch?.trim();
  return digest(
    JSON.stringify({
      files: files.map((file) => [file.path, file.fingerprint]),
      draft: {
        title: draft.title,
        body: draft.body,
        ...(commitMessage ? { commitMessage } : {}),
        ...(publishBranch ? { publishBranch } : {}),
      },
    }),
  );
}

export function synchronizeReview(
  run: Pick<
    Run,
    | "reviewedFingerprints"
    | "reviewedFiles"
    | "status"
    | "draft"
    | "approvedFingerprint"
  >,
  files: DiffFile[],
) {
  const current = new Map(files.map((file) => [file.path, file.fingerprint]));
  for (const [filePath, fingerprint] of Object.entries(
    run.reviewedFingerprints,
  )) {
    if (current.get(filePath) !== fingerprint)
      delete run.reviewedFingerprints[filePath];
  }
  run.reviewedFiles = Object.keys(run.reviewedFingerprints);
  if (
    run.approvedFingerprint &&
    run.approvedFingerprint !== reviewFingerprint(files, run.draft)
  ) {
    delete run.approvedFingerprint;
    if (run.status === "approved") run.status = "review";
  }
}
