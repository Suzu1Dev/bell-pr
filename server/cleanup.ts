/**
 * Freeing disk space and deleting data: a run's working files (its Git
 * worktree, its teammates' checkouts, its branch in BELL's own clone and
 * its sync ref), whole runs, projects and all data, plus the retention
 * period that frees finished runs' files on its own.
 *
 * Nothing outside the data directory is deleted. In a repository the
 * person imported from their own disk, only Git's records of BELL's
 * worktrees and BELL's own refs/bellpr/ refs are touched, never a branch.
 */
import { createHash } from "node:crypto";
import { lstat, readdir, rm, truncate } from "node:fs/promises";
import type { Stats } from "node:fs";
import path from "node:path";
import { git } from "./process.js";
import { AppError, withRunLocale, type Repository, type Run } from "./types.js";
import { activeFollowUp } from "../shared/followups.js";
import { managedClone } from "./repositories.js";
import { runBusy } from "./sync-runs.js";
import { log } from "./log.js";
import { sm } from "./i18n/index.js";
import type { WorkbenchContext } from "./workbench.js";

const dayMs = 24 * 60 * 60 * 1000;
/** Statuses whose files a cleanup must leave alone: the run is still working on them. */
const activeStatuses: Run["status"][] = ["queued", "running", "awaiting_plan"];
/** Statuses the retention period applies to; review, approved and the active ones never. */
const finishedStatuses: Run["status"][] = ["published", "cancelled", "failed"];

let retentionDaysSource: (() => number | undefined) | undefined;

/**
 * Sets where the retention period (in days) comes from, such as the app
 * settings. Without a source, or when it returns nothing valid,
 * BELLPR_RETENTION_DAYS applies, then 14 days. No argument removes it.
 */
export function setRetentionDaysSource(fn?: () => number | undefined): void {
  retentionDaysSource = fn;
}

const validDays = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 365
    ? value
    : undefined;

/** Days after its last activity that a finished run keeps its working files. */
export function retentionDays(): number {
  let configured: number | undefined;
  try {
    configured = validDays(retentionDaysSource?.());
  } catch {
    // An unreadable setting must not stop cleanup; use the next source.
  }
  const fromEnvironment = process.env.BELLPR_RETENTION_DAYS?.trim();
  return (
    configured ??
    validDays(fromEnvironment ? Number(fromEnvironment) : undefined) ??
    14
  );
}

/** True when `child` is strictly inside `parent` (both made absolute). */
export function insideDirectory(parent: string, child: string) {
  if (!child) return false;
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

const exists = (target: string) =>
  lstat(target).then(
    () => true,
    () => false,
  );

/** Disk use of a file or directory tree in bytes, without following links. */
export async function directorySize(target: string): Promise<number> {
  const bytes = (info: Stats) =>
    typeof info.blocks === "number" && info.blocks > 0
      ? info.blocks * 512
      : info.size;
  let total = 0;
  const pending = [target];
  while (pending.length) {
    // A bounded batch keeps the number of open directory handles small.
    await Promise.all(
      pending.splice(0, 32).map(async (entry) => {
        const info = await lstat(entry).catch(() => undefined);
        if (!info) return;
        total += bytes(info);
        if (!info.isDirectory()) return;
        for (const name of await readdir(entry).catch(() => []))
          pending.push(path.join(entry, name));
      }),
    );
  }
  return total;
}

/**
 * The working files are gone: the diff, reviews, publishing and the
 * agents need them. Throws 410 `workspace_removed`.
 */
export function assertWorkspacePresent(run: Pick<Run, "workspaceRemovedAt">) {
  if (run.workspaceRemovedAt)
    throw new AppError((m) => m.storage.workspace.removed, 410, {
      code: "workspace_removed",
    });
}

/** Queued, running, paused or publishing, or an agent job still works on it. */
export function runActive(ctx: WorkbenchContext, run: Run) {
  return (
    activeStatuses.includes(run.status) ||
    !!run.publishing ||
    runBusy(ctx, run.id)
  );
}

/** Where a run's files may live: its worktree only inside <data>/worktrees. */
function runPaths(ctx: WorkbenchContext, run: Run) {
  const directory = ctx.store.directory;
  return {
    worktree: insideDirectory(path.join(directory, "worktrees"), run.worktreePath)
      ? run.worktreePath
      : undefined,
    team: path.join(directory, "team-worktrees", run.id),
    leftovers: [
      path.join(directory, `publish-index-${run.id}`),
      path.join(directory, `sync-index-${run.id}`),
    ],
  };
}

/**
 * Whether cleanup can remove this run's files: an existing worktree outside
 * the data directory (an old data directory moved elsewhere, or a test
 * fixture) is never deleted.
 */
async function ownsWorkspace(ctx: WorkbenchContext, run: Run) {
  return (
    !!runPaths(ctx, run).worktree ||
    !run.worktreePath ||
    !(await exists(run.worktreePath))
  );
}

/** Whether the run still has a worktree or a teammate checkout on disk. */
async function hasWorkspaceFiles(ctx: WorkbenchContext, run: Run) {
  const paths = runPaths(ctx, run);
  return (
    (!!paths.worktree && (await exists(paths.worktree))) ||
    (await exists(paths.team))
  );
}

const findRepository = (ctx: WorkbenchContext, id: string) =>
  ctx.store.data.repos.find((repo) => repo.id === id);

/**
 * Removes the run's working files; the caller holds the run lock and has
 * checked that the run is not active. Under the repository lock:
 * `git worktree remove --force`, the teammates' checkouts, `git worktree
 * prune`, the refs/bellpr/sync/<run> ref, and the run's branch when the
 * repository is BELL's own clone under <data>/repositories. Returns the
 * bytes freed.
 */
async function removeWorkspace(
  ctx: WorkbenchContext,
  run: Run,
  repo: Repository | undefined,
) {
  const paths = runPaths(ctx, run);
  const bytes =
    (paths.worktree ? await directorySize(paths.worktree) : 0) +
    (await directorySize(paths.team));
  const work = async () => {
    const repository = repo && (await exists(repo.path)) ? repo.path : undefined;
    const quietly = (args: string[]) =>
      repository
        ? git(repository, args).then(
            () => true,
            (error: unknown) => {
              log.debug("cleanup.git_failed", { runId: run.id, args, error });
              return false;
            },
          )
        : Promise.resolve(false);
    if (paths.worktree)
      await quietly(["worktree", "remove", "--force", paths.worktree]);
    if (paths.worktree)
      await rm(paths.worktree, { recursive: true, force: true });
    await rm(paths.team, { recursive: true, force: true });
    for (const leftover of paths.leftovers) {
      await rm(leftover, { force: true });
      await rm(`${leftover}.lock`, { force: true });
    }
    await quietly(["worktree", "prune"]);
    await quietly(["update-ref", "-d", `refs/bellpr/sync/${run.id}`]);
    // Only BELL's own clone; a person's repository keeps every branch.
    if (
      repo &&
      managedClone(ctx.store.directory, repo) &&
      run.branch &&
      run.branch !== repo.defaultBranch &&
      run.branch !== run.baseBranch
    )
      await quietly(["branch", "-D", "--", run.branch]);
  };
  await (repo ? ctx.lock(`repository:${repo.id}`, work) : work());
  return bytes;
}

/**
 * Frees a finished run's disk space: its Git worktree, its teammates'
 * checkouts, its branch in BELL's own clone and its sync ref. The run, its
 * reports, notes and explanations stay; the diff then answers 410
 * `workspace_removed`. Refused (409) while the run is still working, and
 * when its worktree lies outside the data directory.
 */
export async function archiveRunWorkspace(
  ctx: WorkbenchContext,
  run: Run,
  repo: Repository | undefined = findRepository(ctx, run.repoId),
  options: { retentionDays?: number } = {},
) {
  return ctx.lock(run.id, async () => {
    if (run.workspaceRemovedAt) return run;
    if (runActive(ctx, run))
      throw new AppError((m) => m.storage.workspace.busy, 409);
    if (!(await ownsWorkspace(ctx, run)))
      throw new AppError((m) => m.storage.workspace.outsideData, 409);
    const bytes = await removeWorkspace(ctx, run, repo);
    run.workspaceRemovedAt = new Date().toISOString();
    run.workspaceBytes = bytes;
    ctx.log(
      run,
      "system",
      options.retentionDays
        ? sm().storage.workspace.retentionLog({ bytes, days: options.retentionDays })
        : sm().storage.workspace.removedLog({ bytes }),
    );
    log.info("run.workspace_removed", {
      runId: run.id,
      bytes,
      reason: options.retentionDays ? "retention" : "request",
    });
    invalidateStorageReport(ctx);
    await ctx.store.save();
    return run;
  });
}

/** Deletes a run that is not working: its files first, then its record. */
export async function removeRun(ctx: WorkbenchContext, id: string) {
  const run = ctx.run(id);
  await ctx.lock(id, async () => {
    if (runActive(ctx, run))
      throw new AppError((m) => m.storage.workspace.busy, 409);
    // A worktree outside the data directory is left where it is.
    if (!run.workspaceRemovedAt && (await ownsWorkspace(ctx, run)))
      await removeWorkspace(ctx, run, findRepository(ctx, run.repoId));
    const index = ctx.store.data.runs.indexOf(run);
    if (index >= 0) ctx.store.data.runs.splice(index, 1);
    log.info("run.removed", { runId: id });
    invalidateStorageReport(ctx);
    await ctx.store.save();
  });
  return { removed: id };
}

/** The insights cache file of a repository. */
export function insightsCachePath(directory: string, repoId: string) {
  return path.join(
    directory,
    "insights",
    `${createHash("sha256").update(repoId).digest("hex")}.json`,
  );
}

/**
 * Deletes a project with its runs, its analysis and, when BELL cloned it
 * under <data>/repositories, the clone. A repository the person imported
 * from their own disk stays on disk. Refused while one of its runs works.
 */
export async function removeRepository(ctx: WorkbenchContext, id: string) {
  const repo = ctx.repo(id);
  const runsOf = () => ctx.store.data.runs.filter((run) => run.repoId === id);
  if (runsOf().some((run) => runActive(ctx, run)))
    throw new AppError((m) => m.storage.repos.busy, 409);
  for (const run of runsOf()) await removeRun(ctx, run.id);
  await ctx.lock(`repository:${id}`, async () => {
    // A run started meanwhile keeps the project.
    if (runsOf().length) throw new AppError((m) => m.storage.repos.busy, 409);
    if (insideDirectory(path.join(ctx.store.directory, "repositories"), repo.path))
      await rm(repo.path, { recursive: true, force: true });
    await rm(insightsCachePath(ctx.store.directory, id), { force: true });
    const index = ctx.store.data.repos.indexOf(repo);
    if (index >= 0) ctx.store.data.repos.splice(index, 1);
    log.info("repo.removed", { repoId: id, clone: managedClone(ctx.store.directory, repo) });
    invalidateStorageReport(ctx);
    await ctx.store.save();
  });
  return { removed: id };
}

/** What `eraseAll` deletes from the data directory besides projects and runs. */
const erasedEntries = [
  "repositories",
  "worktrees",
  "team-worktrees",
  "insights",
  "discovery.json",
  "state.quarantine.json",
];

/**
 * Deletes every project, run, analysis, discovery result, log, backup and
 * leftover in the data directory. Settings, the license and the running
 * server's own files (its lock and agent registry) stay. Needs
 * `confirm === "ERASE"` and refuses while anything still works.
 */
export async function eraseAll(ctx: WorkbenchContext, confirm: unknown) {
  if (confirm !== "ERASE")
    throw new AppError((m) => m.storage.erase.confirm, 400);
  const { data, directory } = ctx.store;
  if (data.runs.some((run) => runActive(ctx, run)) || ctx.jobs.size)
    throw new AppError((m) => m.storage.erase.busy, 409);
  const counts = { runs: data.runs.length, repos: data.repos.length };
  // Git's records in repositories outside the data directory go first.
  for (const run of [...data.runs]) await removeRun(ctx, run.id);
  for (const repo of [...data.repos]) await removeRepository(ctx, repo.id);
  for (const name of await readdir(directory).catch(() => [] as string[])) {
    if (
      erasedEntries.includes(name) ||
      /^state\.json\.(?:bak\.\d+|corrupt-.+)$/.test(name) ||
      /^(?:team|publish|sync)-index-/.test(name) ||
      name.endsWith(".tmp")
    )
      await rm(path.join(directory, name), { recursive: true, force: true });
  }
  // Today's log file stays open for writing, so it is emptied instead.
  const logs = path.join(directory, "logs");
  const logFiles = (await readdir(logs).catch(() => [] as string[]))
    .filter((name) => /^bell-pr-.+\.log$/.test(name))
    .sort();
  for (const [index, name] of logFiles.entries())
    await (index === logFiles.length - 1
      ? truncate(path.join(logs, name), 0)
      : rm(path.join(logs, name), { force: true }));
  data.repos.splice(0);
  data.runs.splice(0);
  ctx.store.recovery = undefined;
  invalidateStorageReport(ctx);
  await ctx.store.save();
  log.warn("data.erased", counts);
  return { erased: counts };
}

/** When the run last changed: its newest log line, round or sync. */
function lastActivity(run: Run) {
  const times = [
    run.createdAt,
    run.logs.at(-1)?.time,
    run.sync?.at,
    ...(run.followUps ?? []).flatMap((round) => [round.requestedAt, round.publishedAt]),
  ]
    .map((time) => (time ? Date.parse(time) : NaN))
    .filter(Number.isFinite);
  return times.length ? Math.max(...times) : 0;
}

/**
 * Frees the working files of published, cancelled and failed runs whose
 * last activity is older than the retention period. Runs that are queued,
 * running, awaiting their plan, in review, approved or publishing, and
 * published runs with an open round, are never touched; nor are runs with
 * no files on disk (one cancelled before it started can still be retried).
 * Each run's log line is written in the run's own language. A shutdown
 * stops the pass between runs.
 */
export async function applyRetention(ctx: WorkbenchContext, now = Date.now()) {
  const days = retentionDays();
  const cutoff = now - days * dayMs;
  const archived: string[] = [];
  for (const run of [...ctx.store.data.runs]) {
    if (ctx.stopping()) break;
    if (
      !finishedStatuses.includes(run.status) ||
      run.workspaceRemovedAt ||
      activeFollowUp(run.followUps) ||
      runActive(ctx, run) ||
      lastActivity(run) > cutoff ||
      !(await ownsWorkspace(ctx, run)) ||
      !(await hasWorkspaceFiles(ctx, run))
    )
      continue;
    try {
      await withRunLocale(run, () =>
        archiveRunWorkspace(ctx, run, undefined, { retentionDays: days }),
      );
      archived.push(run.id);
    } catch (error) {
      log.warn("retention.skipped", { runId: run.id, error });
    }
  }
  if (archived.length)
    log.info("retention.applied", { days, runs: archived.length });
  return archived;
}

/** Sizes by path, measured in one walk of the data directory. */
async function measure(directory: string) {
  const sizes = new Map<string, number>();
  const split = new Set(["repositories", "worktrees", "team-worktrees"]);
  let total = 0;
  for (const name of await readdir(directory).catch(() => [] as string[])) {
    const entry = path.join(directory, name);
    if (!split.has(name)) {
      const bytes = await directorySize(entry);
      sizes.set(entry, bytes);
      total += bytes;
      continue;
    }
    // The folder itself, then each clone or worktree on its own.
    const info = await lstat(entry).catch(() => undefined);
    if (!info?.isDirectory()) continue;
    total += typeof info.blocks === "number" && info.blocks > 0 ? info.blocks * 512 : info.size;
    for (const child of await readdir(entry).catch(() => [] as string[])) {
      const bytes = await directorySize(path.join(entry, child));
      sizes.set(path.join(entry, child), bytes);
      total += bytes;
    }
  }
  return { sizes, total };
}

export interface StorageReport {
  measuredAt: string;
  retentionDays: number;
  /** Everything in the data directory. */
  totalBytes: number;
  /** Log files and the analysis cache; the rest of the total is state, settings and leftovers. */
  logsBytes: number;
  insightsBytes: number;
  repos: {
    id: string;
    fullName: string;
    /** BELL's own clone in the data directory; false for a repository on the person's disk. */
    managed: boolean;
    /** The clone's size; null when it is not in the data directory. */
    bytes: number | null;
  }[];
  runs: {
    id: string;
    repoId: string;
    title: string;
    status: Run["status"];
    createdAt: string;
    /** The worktree and teammates' checkouts; null when the worktree is outside the data directory. */
    bytes: number | null;
    workspaceRemovedAt?: string;
    /** Bytes freed when the files were removed. */
    workspaceBytes?: number;
    /** DELETE /api/runs/:id/workspace would succeed now. */
    removable: boolean;
  }[];
}

const reports = new Map<string, { time: number; report: Promise<StorageReport> }>();

function invalidateStorageReport(ctx: WorkbenchContext) {
  reports.delete(ctx.store.directory);
}

/**
 * Disk use per project and per run, from one asynchronous walk of the data
 * directory, cached for 60 seconds. Paths are not included.
 */
export function storageReport(ctx: WorkbenchContext): Promise<StorageReport> {
  const cached = reports.get(ctx.store.directory);
  if (cached && Date.now() - cached.time < 60_000) return cached.report;
  const report = buildStorageReport(ctx);
  reports.set(ctx.store.directory, { time: Date.now(), report });
  report.catch(() => invalidateStorageReport(ctx));
  return report;
}

async function buildStorageReport(ctx: WorkbenchContext): Promise<StorageReport> {
  const { directory, data } = ctx.store;
  const { sizes, total } = await measure(directory);
  const runs = await Promise.all(
    data.runs.map(async (run) => {
      const paths = runPaths(ctx, run);
      const owned = await ownsWorkspace(ctx, run);
      return {
        id: run.id,
        repoId: run.repoId,
        title: run.title,
        status: run.status,
        createdAt: run.createdAt,
        bytes: run.workspaceRemovedAt
          ? 0
          : owned
            ? (paths.worktree ? (sizes.get(paths.worktree) ?? 0) : 0) +
              (sizes.get(paths.team) ?? 0)
            : null,
        ...(run.workspaceRemovedAt
          ? {
              workspaceRemovedAt: run.workspaceRemovedAt,
              workspaceBytes: run.workspaceBytes,
            }
          : {}),
        removable: !run.workspaceRemovedAt && owned && !runActive(ctx, run),
      };
    }),
  );
  const clones = path.join(directory, "repositories");
  return {
    measuredAt: new Date().toISOString(),
    retentionDays: retentionDays(),
    totalBytes: total,
    logsBytes: sizes.get(path.join(directory, "logs")) ?? 0,
    insightsBytes: sizes.get(path.join(directory, "insights")) ?? 0,
    repos: data.repos.map((repo) => {
      const inside = insideDirectory(clones, repo.path);
      return {
        id: repo.id,
        fullName: repo.fullName,
        managed: managedClone(directory, repo),
        // A clone is one directory directly under repositories/.
        bytes: inside ? (sizes.get(path.resolve(repo.path)) ?? 0) : null,
      };
    }),
    runs,
  };
}
