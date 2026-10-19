import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { assertGitConfigSafe, git } from "./process.js";
import { redact, secretInPatch } from "./secrets.js";
import { AppError, type DiffFile, type Run } from "./types.js";
import { sm, withLocale } from "./i18n/index.js";
import { parseLocale, type Locale } from "../shared/i18n/locale.js";
import { ciConfigPath } from "../shared/draft-checks.js";

export { ciConfigPath, secretInPatch };

/**
 * The only language of the builds that saved runs without a locale: text
 * those builds saved on a run (diff reasons, explanations, the draft) is
 * read and kept in it.
 */
export const legacyRunLocale: Locale = "zh-TW";

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

/** Pages inside a GitHub repository whose address names the repository. */
const repositoryPages = new Set(["tree", "blob", "issues", "pull", "pulls"]);

/**
 * What a person may type to import a project, made into what the import
 * reads: `owner/repo` and `github.com/owner/repo` (with or without
 * `https://` or `www.`) become `https://github.com/owner/repo`, a
 * repository page (`/tree/…`, `/blob/…`, `/issues/…`, `/pull/…`) becomes
 * the repository, and `~/` is the home directory. Anything else is
 * returned trimmed and unchanged, for the import to accept or refuse.
 */
export function normalizeRepositorySource(input: string, home: string): string {
  const source = input.trim();
  if (source === "~") return home;
  if (source.startsWith("~/")) return path.join(home, source.slice(2));
  const web = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^?#]*)(?:[?#].*)?$/i.exec(
    source,
  );
  if (web) {
    const [owner, name, page, ...rest] = web[1].split("/");
    const trailing = page === undefined || (page === "" && !rest.length);
    if (owner && name && (trailing || repositoryPages.has(page))) {
      const parsed = parseGitHubSource(`https://github.com/${owner}/${name}`);
      if (parsed) return parsed.url;
    }
    return source;
  }
  const shorthand =
    /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(source);
  if (shorthand && shorthand[2] !== "." && shorthand[2] !== "..")
    return `https://github.com/${shorthand[1]}/${shorthand[2]}`;
  return source;
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

/**
 * Path segments that would reach an object's prototype when a path is used
 * as a key, as notes, explanations, reviews and conversations are stored.
 */
const prototypeSegments = new Set(["__proto__", "constructor", "prototype"]);

export function safeRelativePath(filePath: string) {
  return (
    !!filePath &&
    !path.isAbsolute(filePath) &&
    !filePath
      .split("/")
      .some(
        (part) =>
          part === ".." || part === ".git" || prototypeSegments.has(part),
      ) &&
    !/[\x00-\x1f\x7f\\]/.test(filePath)
  );
}

/**
 * A branch name that is safe in a refspec and a ref path, following
 * `git check-ref-format`: no leading "-" or "+" (an option or a forced
 * push), no ":" (a second refspec side), no "..", "@{", glob or control
 * characters, and no "/." or ".lock" components.
 */
export function safeRefName(name: string) {
  return (
    !!name &&
    name.length <= 255 &&
    !/^[-+/.]/.test(name) &&
    !/[/.]$/.test(name) &&
    name !== "@" &&
    !name.includes("..") &&
    !name.includes("//") &&
    !name.includes("@{") &&
    !name.includes("/.") &&
    !/\.lock(?:\/|$)/.test(name) &&
    !/[ ~^:?*[\\]/.test(name) &&
    ![...name].some((char) => char.charCodeAt(0) < 0x20 || char === "\u007f")
  );
}

/** Throws before an unsafe branch name reaches a URL, ref or refspec. */
export function assertRefName(name: string) {
  if (!safeRefName(name))
    throw new AppError((m) => m.security.invalidRemote, 409);
}

/** Throws unless `fullName` is a plain GitHub owner/name pair. */
export function assertGitHubRepository(fullName: string) {
  if (parseGitHubSource(`https://github.com/${fullName}`)?.fullName !== fullName)
    throw new AppError((m) => m.security.invalidRemote, 409);
}

/**
 * Files held back from review and publishing. GitHub Actions workflows and
 * other CI configuration are not among them: they are published after the
 * person confirms them (the `workflows` publish check, ciConfigPath).
 */
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

/** The largest base version shown around a diff; the same bound as a new file. */
export const contextFileLimit = 512_000;

/**
 * A changed file as it was at the run's base commit, split into lines. The
 * lines a diff leaves out are unchanged, so they read the same here as in
 * the checkout. Callers check the path against the current diff first.
 */
export async function baseFileLines(
  run: Pick<Run, "worktreePath" | "baseSha">,
  filePath: string,
) {
  const blob = `${run.baseSha}:${filePath}`;
  // A submodule is a commit, not file content.
  const type = (await git(run.worktreePath, ["cat-file", "-t", blob])).stdout.trim();
  if (type !== "blob") throw new AppError((m) => m.run.context.notAFile, 422);
  const size = Number(
    (await git(run.worktreePath, ["cat-file", "-s", blob])).stdout.trim(),
  );
  if (!(size <= contextFileLimit))
    throw new AppError((m) => m.run.context.tooLarge, 422);
  const content = (
    await git(run.worktreePath, ["cat-file", "blob", blob], {
      maxBytes: contextFileLimit + 1_000,
    })
  ).stdout;
  if (content.includes("\0"))
    throw new AppError((m) => m.run.context.binary, 422);
  if (secretInPatch(content))
    throw new AppError((m) => m.run.context.credentials, 422);
  // Masked line by line, so password=… or URL credentials never leave and numbering holds.
  const lines = content.split("\n").map(redact);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** How many lines a file of the checkout has, read with the same checks as a new file. */
export async function checkoutLineCount(
  run: Pick<Run, "worktreePath">,
  filePath: string,
) {
  const fullPath = path.join(run.worktreePath, filePath);
  const metadata = await lstat(fullPath);
  if (!metadata.isFile() || metadata.size > contextFileLimit)
    throw new AppError((m) => m.run.context.unreadable, 422);
  const resolved = await realpath(fullPath);
  if (!resolved.startsWith((await realpath(run.worktreePath)) + path.sep))
    throw new AppError((m) => m.run.diff.outsideWorktree, 422);
  const lines = (await readFile(resolved, "utf8")).split("\n");
  return lines.at(-1) === "" ? lines.length - 1 : lines.length;
}

export async function readDiff(
  run: Pick<Run, "worktreePath" | "baseSha" | "locale">,
): Promise<DiffFile[]> {
  if (!run.baseSha || !run.worktreePath) return [];
  // Diffing runs the checkout's filters; refuse a configuration that sets any.
  await assertGitConfigSafe(run.worktreePath);
  // A held-back file's reason is part of its fingerprint and of the draft
  // fingerprint, so it is worded in the run's locale: reading the diff in
  // another language must not make a reviewed draft stale. A run saved
  // before runs recorded a locale was fingerprinted by a build that worded
  // these reasons in zh-TW only, so it keeps that wording.
  const messages = withLocale(
    parseLocale(run.locale) ?? legacyRunLocale,
    () => sm().run.diff,
  );
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
