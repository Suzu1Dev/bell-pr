/**
 * Two contributions of one person in this BELL PR (DESIGN, group mode
 * Phase 0). Nothing here is written or sent anywhere: the paths another
 * unfinished run of the same project changes, or plans to change, are read
 * from its record and its checkout when they are needed, at plan approval
 * and before publishing.
 *
 * - A plan or a change that meets another run's paths needs the person's
 *   confirmation (`group-own-overlap`): whichever is merged second may
 *   conflict with the first.
 * - A part of a split that builds on another part (`Run.group.after`)
 *   needs it too when that part is not merged yet (`split-order`).
 *
 * A pull request's file stops counting once its change to that file is in
 * the checked run's base: the PR was read as merged, its commit is in that
 * base, or the base's history brought its content of the file in (a squash
 * or rebase merge, also when the file changed again later). A PR read as
 * closed stops its run holding files, but a part built on it still waits.
 */
import { createHash, randomUUID } from "node:crypto";
import { copyFile, rm, stat, utimes } from "node:fs/promises";
import path from "node:path";
import type { DraftCheck } from "../shared/draft-checks.js";
import { activeFollowUp } from "../shared/followups.js";
import type { LocalOverlap, TeamTask } from "../shared/team.js";
import { sm } from "./i18n/index.js";
import { assertGitConfigSafe, git } from "./process.js";
import type { DiffFile, Repository, Run } from "./types.js";
import type { WorkbenchContext } from "./workbench-context.js";

/** What a check reads: the instance's runs, the project's clone, and the data directory for temporary index files. */
export interface LocalScope {
  runs: readonly Run[];
  repo: Repository;
  directory: string;
}

/** Statuses of runs whose paths count: everything that may still change or reach the project. */
const holdingStatuses: Run["status"][] = [
  "queued",
  "running",
  "awaiting_plan",
  "review",
  "approved",
  "published",
];
/** Checkouts read at once, so a project with many runs does not start dozens of git processes together. */
const readsAtOnce = 4;

/** ASCII lower case only, so every build and Node release folds alike. */
const fold = (value: string) => value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
const directory = (scope: string) => (scope.endsWith("/") ? scope : `${scope}/`);

/**
 * Whether two paths or scopes name a common file: the same, or one is a
 * directory above the other. An exact name also meets what is below it,
 * because a file and a directory cannot share a name.
 */
export function pathsMeet(left: string, right: string) {
  const [a, b] = [fold(left), fold(right)];
  return a === b || b.startsWith(directory(a)) || a.startsWith(directory(b));
}

const names = (output: string) => output.split("\0").filter(Boolean);
/** Whether the run's pull request was read as merged (Read feedback). */
const readMerged = (run: Run) => run.prFeedback?.merged === true || run.prFeedback?.prState?.toUpperCase() === "MERGED";
/** A Learn-by-hand step file as the person typed it, spelled as Git lists paths. */
const stepFile = (file: string) => file.trim().replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");

/**
 * The changed and untracked paths of an unpublished run's checkout against
 * its base, or undefined when its changes cannot be read. The diff
 * refreshes a copy of the checkout's index, so it never takes that
 * checkout's index.lock while the run's own Git steps may need it. The copy
 * keeps the index's time: Git compares the content of a file changed in
 * the same instant as its index ("racily clean"), and a newer copy would
 * hide it. A directory with nothing tracked in it is listed once, as
 * "dir/", and a failed listing of untracked files keeps the diff.
 */
async function changedPaths(run: Run, dataDirectory: string) {
  if (!run.worktreePath || !run.baseSha) return undefined;
  const index = path.join(dataDirectory, `group-index-${randomUUID()}`);
  let changed: string[];
  try {
    // Diffing runs the checkout's filters; a configuration that sets any is not read.
    await assertGitConfigSafe(run.worktreePath);
    const own = path.resolve(
      run.worktreePath,
      (await git(run.worktreePath, ["rev-parse", "--git-path", "index"])).stdout.trim(),
    );
    // The time is read first: an index written meanwhile then only makes the copy look older.
    // A Date has milliseconds only, so the copy may be a little older too; Git then compares more files.
    const { atime, mtime } = await stat(own);
    await copyFile(own, index);
    await utimes(index, atime, mtime);
    const env = { ...process.env, GIT_INDEX_FILE: index };
    changed = names((await git(run.worktreePath, ["diff", "--no-renames", "--name-only", "-z", run.baseSha, "--"], { env })).stdout);
  } catch {
    return undefined;
  } finally {
    await rm(index, { force: true }).catch(() => undefined);
  }
  try {
    changed.push(
      ...names((await git(run.worktreePath, ["ls-files", "--others", "--exclude-standard", "--directory", "-z"])).stdout),
    );
  } catch {
    // Too many to list: the tracked changes still count.
  }
  return changed;
}

/**
 * The commit a run's pull request holds: the head of its branch in BELL's
 * clone, which has commits the person made in its folder, or else the
 * commit BELL last pushed. Undefined for a run never pushed.
 */
async function prHead(repo: Repository, run: Run) {
  if (!run.publishCommit) return undefined;
  try {
    const head = await git(repo.path, ["rev-parse", "--verify", "--quiet", `refs/heads/${run.branch}^{commit}`], {
      allowedCodes: [0, 1],
    });
    return head.stdout.trim() || run.publishCommit;
  } catch {
    return run.publishCommit;
  }
}

/** The files a pull request changes, read in BELL's clone, which shares the checkout's objects. */
async function publishedPaths(repo: Repository, run: Run, head: string | undefined) {
  if (head && run.baseSha)
    try {
      return names((await git(repo.path, ["diff", "--no-renames", "--name-only", "-z", run.baseSha, head, "--"])).stdout);
    } catch {
      // Removed with its branch and pruned: what the person reviewed is what was published.
    }
  return Object.keys(run.reviewedFingerprints);
}

/**
 * Which of `paths` a pull request's change (at `head`) has in `base`: all
 * of them when it was read as merged or `head` is an ancestor of `base` (a
 * merge commit); otherwise each file whose published content is the
 * content at `base`, or that a first-parent commit of `base` since the
 * run's own base brought in or took out again (a squash or rebase merge,
 * maybe edited later). A deletion is in only while `base` lacks the file:
 * any commit may have deleted it once. With `every`, it stops at the first
 * file that is not in. Anything that cannot be read is not in.
 */
async function landedPaths(
  repo: Repository,
  run: Run,
  head: string | undefined,
  paths: readonly string[],
  base: string | undefined,
  every = false,
) {
  if (readMerged(run)) return new Set(paths);
  const landed = new Set<string>();
  if (!head || !base) return landed;
  try {
    const ancestor = await git(repo.path, ["merge-base", "--is-ancestor", head, base], { allowedCodes: [0, 1] });
    if (ancestor.code === 0) return new Set(paths);
    // cat-file reads one name per line.
    const readable = paths.filter((file) => !file.includes("\n"));
    if (every && readable.length < paths.length) return landed;
    const objects = (
      await git(repo.path, ["cat-file", "--batch-check=%(objectname)"], {
        input: [head, base].flatMap((commit) => readable.map((file) => `${commit}:${file}\n`)).join(""),
      })
    ).stdout.split("\n");
    // A file absent from a commit reads as "<commit>:<path> missing".
    const blob = (line = "") => (line.endsWith(" missing") ? undefined : line);
    for (const [index, file] of readable.entries()) {
      const published = blob(objects[index]);
      let found = published === blob(objects[index + readable.length]);
      if (!found && published && run.baseSha) {
        const history = await git(repo.path, [
          "--literal-pathspecs",
          "log",
          "--format=%H",
          "--first-parent",
          "--ancestry-path",
          "--max-count=1",
          `--find-object=${published}`,
          `${run.baseSha}..${base}`,
          "--",
          file,
        ]).catch(() => undefined);
        found = !!history?.stdout.trim();
      }
      if (found) landed.add(file);
      else if (every) return landed;
    }
  } catch {
    // Not readable: nothing has landed.
  }
  return landed;
}

/**
 * What another run holds: `pr` for what its pull request changes (whose
 * files stop counting once merged), `local` for its plan while the plan
 * is still to be carried out (team scopes, or a Learn-by-hand run's step
 * files) and what its checkout changed. A run whose PR was read as merged
 * or closed, or whose checkout was removed before it was pushed, holds
 * nothing; an original that was split holds only the files none of its
 * parts hold.
 */
interface Holding {
  local: string[];
  pr: string[];
  head?: string;
  /** Every file it has, its parts' included: what a split moved out of the original it came from. */
  files: string[];
}

function holdings(scope: LocalScope) {
  const known = new Map<string, Promise<Holding>>();
  const hold = (other: Run): Promise<Holding> => {
    let held = known.get(other.id);
    if (!held) known.set(other.id, (held = read(other)));
    return held;
  };
  const read = async (other: Run): Promise<Holding> => {
    const pushed = !!other.publishCommit;
    if (pushed && (readMerged(other) || other.prFeedback?.prState?.toUpperCase() === "CLOSED"))
      return { local: [], pr: [], files: [] };
    const head = await prHead(scope.repo, other);
    const pr = pushed ? await publishedPaths(scope.repo, other, head) : [];
    if (other.status === "published" || other.workspaceRemovedAt) return { local: [], pr, head, files: pr };
    const open = !pushed && !activeFollowUp(other.followUps);
    const planned = !open
      ? []
      : other.learnByHand
        ? ["awaiting_plan", "review", "approved"].includes(other.status)
          ? (other.byHand?.plan?.steps ?? []).flatMap((step) => (step.files ?? []).map(stepFile))
          : []
        : ["queued", "running", "awaiting_plan"].includes(other.status) &&
            !["complete", "failed", "cancelled"].includes(other.team?.phase ?? "")
          ? (other.team?.tasks ?? []).flatMap((task) => task.files)
          : [];
    const changed = (await changedPaths(other, scope.directory)) ?? Object.keys(other.reviewedFingerprints);
    const files = [...new Set([...planned, ...changed, ...pr])];
    let local = [...new Set([...planned, ...changed])];
    const parts = (other.splitInto ?? []).flatMap((ref) => scope.runs.filter((run) => run.id === ref.runId));
    if (parts.length) {
      const moved = new Set((await Promise.all(parts.map(hold))).flatMap((part) => part.files));
      local = local.filter((file) => !moved.has(file));
    }
    return { local, pr, head, files };
  };
  return hold;
}

/** The original a run was split from, followed to the first one; the run itself when it was never split from another. */
function splitRoot(runs: readonly Run[], run: Run) {
  let root = run;
  for (let hops = 0; root.splitFrom && hops < runs.length; hops++) {
    const parent = runs.find((candidate) => candidate.id === root.splitFrom!.runId);
    if (!parent) return root.splitFrom.runId;
    root = parent;
  }
  return root.id;
}

/** Runs `work` on each item, at most `limit` at a time, keeping the order. */
async function inTurn<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (let index = next++; index < items.length; index = next++) results[index] = await work(items[index]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * The other unfinished runs of `run`'s project whose paths meet `mine`,
 * each with its paths that do and, when `tasks` are given, the ids of the
 * tasks whose scopes meet them. Runs of one split (the original, its parts
 * and their parts) are one change and never count against each other.
 */
export async function localOverlaps(
  scope: LocalScope,
  run: Run,
  mine: readonly string[],
  tasks: readonly TeamTask[] = [],
): Promise<LocalOverlap[]> {
  if (!mine.length) return [];
  const family = splitRoot(scope.runs, run);
  const others = scope.runs.filter(
    (other) =>
      other.id !== run.id &&
      other.repoId === run.repoId &&
      holdingStatuses.includes(other.status) &&
      splitRoot(scope.runs, other) !== family,
  );
  const hold = holdings(scope);
  const meets = (held: string) => mine.some((own) => pathsMeet(held, own));
  const found = await inTurn(others, readsAtOnce, async (other): Promise<LocalOverlap | undefined> => {
    const held = await hold(other);
    const local = held.local.filter(meets);
    let fromPr = held.pr.filter((file) => meets(file) && !local.includes(file));
    if (fromPr.length) {
      const landed = await landedPaths(scope.repo, other, held.head, fromPr, run.baseSha);
      fromPr = fromPr.filter((file) => !landed.has(file));
    }
    const paths = [...new Set([...local, ...fromPr])].sort();
    if (!paths.length) return undefined;
    const taskIds = tasks
      .filter((task) => task.files.some((file) => paths.some((path) => pathsMeet(path, file))))
      .map((task) => task.id);
    return {
      runId: other.id,
      title: other.title,
      status: other.status,
      paths,
      ...(taskIds.length ? { taskIds } : {}),
    };
  });
  return found.filter((overlap): overlap is LocalOverlap => overlap !== undefined);
}

/** The scope of a check made with the Workbench context. */
export function localScope(ctx: Pick<WorkbenchContext, "store" | "repo">, run: Run): LocalScope {
  return { runs: ctx.store.data.runs, repo: ctx.repo(run.repoId), directory: ctx.store.directory };
}

/** The files a plan covers: the team's task scopes, or a Learn-by-hand run's step files. */
function planFiles(run: Run) {
  return run.learnByHand
    ? (run.byHand?.plan?.steps ?? []).flatMap((step) => (step.files ?? []).map(stepFile))
    : (run.team?.tasks ?? []).flatMap((task) => task.files);
}

/**
 * The overlaps of `run`'s plan, with the tasks each one meets, and a digest
 * of the plan's files and the runs it overlaps. Approving needs that digest
 * back, so a tick never counts for another plan or for a run the person was
 * not shown; more files of a run they confirmed (its agents may still be
 * writing) are the same overlap.
 */
export async function planOverlaps(ctx: Pick<WorkbenchContext, "store" | "repo">, run: Run) {
  const files = planFiles(run);
  const overlaps = await localOverlaps(localScope(ctx, run), run, files, run.learnByHand ? [] : run.team?.tasks);
  const digest = createHash("sha256")
    .update(JSON.stringify([[...new Set(files)].sort(), overlaps.map((overlap) => overlap.runId)]))
    .digest("hex");
  return { overlaps, digest };
}

/**
 * The parts of the same split that `run` builds on and that are not merged
 * into its base yet, a closed one included; a part deleted since is no
 * longer listed.
 */
export async function splitOrder(scope: LocalScope, run: Run) {
  const waiting: Pick<Run, "id" | "title" | "status" | "prUrl">[] = [];
  for (const id of run.group?.after ?? []) {
    const before = scope.runs.find((other) => other.id === id);
    if (!before) continue;
    if (readMerged(before)) continue;
    if (before.publishCommit) {
      const head = await prHead(scope.repo, before);
      const paths = await publishedPaths(scope.repo, before, head);
      if (paths.length && (await landedPaths(scope.repo, before, head, paths, run.baseSha, true)).size === paths.length)
        continue;
    }
    waiting.push({ id: before.id, title: before.title, status: before.status, prUrl: before.prUrl });
  }
  return waiting;
}

/**
 * The two publish confirms of this module for `run` and its `files`, in
 * the server's locale like the other checks the publish dialog shows.
 */
export async function localPublishChecks(
  scope: LocalScope,
  run: Run,
  files: readonly DiffFile[],
): Promise<DraftCheck[]> {
  const m = sm().run.local;
  const checks: DraftCheck[] = [];
  const overlaps = await localOverlaps(scope, run, files.map((file) => file.path));
  if (overlaps.length)
    checks.push({
      id: "group-own-overlap",
      kind: "confirm",
      message: m.publishOverlap,
      details: overlaps.map((overlap) => m.overlapWith(overlap)),
    });
  const order = await splitOrder(scope, run);
  if (order.length)
    checks.push({
      id: "split-order",
      kind: "confirm",
      message: m.splitOrder,
      details: order.map((before) => m.buildsOn(before)),
    });
  return checks;
}
