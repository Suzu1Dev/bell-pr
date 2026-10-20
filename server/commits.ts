/**
 * The commits of a published contribution, read from its own checkout:
 * what the PR head has that its base does not, each labelled from BELL's
 * records, and what one of them changed, with the review screen's
 * protections. Nothing is written and GitHub is never asked.
 */
import type {
  CommitDetail,
  CommitFile,
  CommitSummary,
} from "../shared/commits.js";
import { safeRelativePath, secretInPatch, sensitivePath } from "./git.js";
import { git } from "./process.js";
import { AppError, type Run } from "./types.js";
import { sm } from "./i18n/index.js";

/** Commits listed per run; a PR with more is cut to the newest. */
const commitLimit = 200;
const fileLimit = 150;
const patchLimit = 600_000;
const detailLimit = 2_000_000;

const common = ["--no-ext-diff", "--no-textconv", "--no-renames"];

type CommitRun = Pick<Run, "worktreePath" | "baseSha" | "publishCommit" | "followUps">;

/**
 * Per-file line counts of a diff. Unlike parseNumstat for the review diff,
 * an odd path does not fail the whole history; the detail view blocks it.
 */
async function numstat(cwd: string, from: string, to: string) {
  const output = (
    await git(cwd, ["diff", ...common, "--numstat", "-z", from, to])
  ).stdout;
  return output
    .split("\0")
    .filter(Boolean)
    .flatMap((entry) => {
      const match = /^([^\t]+)\t([^\t]+)\t([\s\S]+)$/.exec(entry);
      return match
        ? [
            {
              path: match[3],
              additions: Number(match[1]) || 0,
              deletions: Number(match[2]) || 0,
              binary: match[1] === "-",
            },
          ]
        : [];
    });
}

/**
 * The commits on a published contribution's branch, oldest first: everything
 * the PR head has that its base does not. Each is labelled from BELL's own
 * records: the first push, review rounds, syncs with the target branch and
 * commits taken over from GitHub. An unpublished run has none yet.
 */
export async function listCommits(run: CommitRun): Promise<CommitSummary[]> {
  if (!run.publishCommit || !run.baseSha || !run.worktreePath) return [];
  const log = (
    await git(run.worktreePath, [
      "log",
      "--no-color",
      "--reverse",
      `--max-count=${commitLimit}`,
      "--format=%H%x00%P%x00%an%x00%aI%x00%s%x00%b%x1e",
      `${run.baseSha}..${run.publishCommit}`,
    ])
  ).stdout;
  const rounds = (run.followUps ?? []).filter(
    (round) => round.status === "published" && round.commit,
  );
  const sync = new Set(
    rounds
      .filter((round) => round.kind === "sync" && !round.adopted)
      .map((round) => round.commit),
  );
  const review = new Map<string, number>();
  for (const round of rounds)
    if (round.kind !== "sync" && !round.adopted)
      review.set(round.commit!, review.size + 1);
  // A takeover records the range GitHub added, not each commit in it.
  const adopted = new Set<string>();
  for (const round of rounds.filter((entry) => entry.adopted))
    for (const sha of (
      await git(run.worktreePath, ["rev-list", `${round.parentCommit}..${round.commit}`])
    ).stdout.split("\n"))
      if (sha) adopted.add(sha);
  const commits: CommitSummary[] = [];
  let initialSeen = false;
  for (const record of log.split("\x1e")) {
    const [sha, parents, author, date, subject, body] = record
      .replace(/^\n/, "")
      .split("\0");
    if (!sha || !/^[0-9a-f]{40,64}$/.test(sha)) continue;
    const parentList = (parents ?? "").split(" ").filter(Boolean);
    const source = sync.has(sha)
      ? "sync"
      : review.has(sha)
        ? "review"
        : adopted.has(sha)
          ? "adopted"
          : initialSeen
            ? "other"
            : "initial";
    if (source === "initial") initialSeen = true;
    const stats = parentList[0]
      ? await numstat(run.worktreePath, parentList[0], sha)
      : [];
    commits.push({
      sha,
      parents: parentList,
      author: author ?? "",
      date: date ?? "",
      subject: subject ?? "",
      body: (body ?? "").trim(),
      source,
      ...(source === "review" ? { round: review.get(sha) } : {}),
      files: stats.length,
      additions: stats.reduce((sum, file) => sum + file.additions, 0),
      deletions: stats.reduce((sum, file) => sum + file.deletions, 0),
    });
  }
  return commits;
}

/**
 * What one commit of the contribution changed, against its first parent,
 * with the review screen's protections: sensitive paths, credentials and
 * binary files are named but not shown, and patches stay within the same
 * size limits. Only commits on the contribution's own branch are read. The
 * reasons are worded in the locale in effect (the reader's).
 */
export async function commitDetail(
  run: CommitRun,
  sha: string,
): Promise<CommitDetail> {
  const commit = (await listCommits(run)).find((entry) => entry.sha === sha);
  if (!commit) throw new AppError((m) => m.run.commits.notFound, 404);
  const parent = commit.parents[0];
  if (!parent) return { files: [], omitted: 0 };
  const reasons = sm().run.commits;
  const stats = await numstat(run.worktreePath, parent, sha);
  // A for added, D for deleted, from the same comparison.
  const kinds = new Map<string, string>();
  const names = (
    await git(run.worktreePath, ["diff", ...common, "--name-status", "-z", parent, sha])
  ).stdout.split("\0");
  for (let index = 0; index + 1 < names.length; index += 2)
    kinds.set(names[index + 1], names[index]);
  const files: CommitFile[] = [];
  let total = 0;
  let omitted = 0;
  for (const stat of stats) {
    if (files.length >= fileLimit || total >= detailLimit) {
      omitted++;
      continue;
    }
    let blocked = !safeRelativePath(stat.path)
      ? reasons.unsupportedName
      : sensitivePath(stat.path)
        ? reasons.sensitive
        : stat.binary
          ? reasons.binary
          : undefined;
    let patch = "";
    if (!blocked) {
      try {
        patch = (
          await git(
            run.worktreePath,
            ["--literal-pathspecs", "diff", ...common, parent, sha, "--", stat.path],
            { maxBytes: patchLimit },
          )
        ).stdout;
      } catch {
        blocked = reasons.tooLarge;
      }
      if (!blocked && secretInPatch(patch)) blocked = reasons.credentials;
      if (blocked) patch = "";
    }
    const kind = kinds.get(stat.path);
    const status = kind === "A" ? "added" : kind === "D" ? "deleted" : "modified";
    total += Buffer.byteLength(patch);
    files.push({
      path: stat.path,
      status,
      additions: stat.additions,
      deletions: stat.deletions,
      patch,
      ...(blocked ? { blocked } : {}),
    });
  }
  return { files, omitted };
}
