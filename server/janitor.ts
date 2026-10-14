/**
 * The startup janitor: removes what a crash or an interrupted step left in
 * the data directory. Only entries older than this start are touched, so
 * work that began since (a resumed run, a request) keeps its files.
 */
import { lstat, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { git } from "./process.js";
import { log } from "./log.js";
import type { WorkbenchContext } from "./workbench.js";

/** Temporary files and Git index files that outlived the step that made them. */
const rootLeftover = /^(?:team|publish|sync)-index-|\.tmp$/;
/** Analysis scratch directories and temporary cache files. */
const insightsLeftover = /^analysis-|\.tmp$/;

/** Run ids and worktree paths in state.quarantine.json, kept for a manual repair. */
async function quarantinedRuns(directory: string) {
  try {
    const value = JSON.parse(
      await readFile(path.join(directory, "state.quarantine.json"), "utf8"),
    ) as { runs?: { run?: { id?: unknown; worktreePath?: unknown } }[] };
    return (value.runs ?? []).flatMap((entry) => [
      String(entry.run?.id ?? ""),
      path.resolve(String(entry.run?.worktreePath ?? "")),
    ]);
  } catch {
    return [];
  }
}

/**
 * Deletes, in the data directory:
 * - `*.tmp`, `team-index-*`, `publish-index-*` and `sync-index-*` files;
 * - `insights/analysis-*` directories and `insights/*.tmp` files;
 * - `worktrees/<id>` and `team-worktrees/<id>` directories no run
 *   references (quarantined runs count as references), unless this start
 *   restored state.json from a backup: runs newer than the backup may still
 *   be recovered from the damaged file, so their files stay;
 * then runs `git worktree prune` in every repository, which drops Git's
 * records of worktrees whose directories are gone. Returns the removed
 * entries relative to the data directory.
 */
export async function runJanitor(
  ctx: Pick<WorkbenchContext, "store" | "lock">,
  options: { startedAt?: number } = {},
): Promise<string[]> {
  const startedAt = options.startedAt ?? Date.now();
  const { directory, data } = ctx.store;
  const removed: string[] = [];
  const names = (folder: string) =>
    readdir(folder).catch(() => [] as string[]);
  /** Removes `entry` when it predates this start and has the expected kind. */
  const removeStale = async (entry: string, kind: "file" | "directory" | "any") => {
    const info = await lstat(entry).catch(() => undefined);
    if (!info || info.mtimeMs >= startedAt) return;
    if (kind === "file" && !info.isFile()) return;
    if (kind === "directory" && !info.isDirectory()) return;
    await rm(entry, { recursive: true, force: true });
    removed.push(path.relative(directory, entry));
  };

  for (const name of await names(directory))
    if (rootLeftover.test(name))
      await removeStale(path.join(directory, name), "file");
  const insights = path.join(directory, "insights");
  for (const name of await names(insights))
    if (insightsLeftover.test(name))
      await removeStale(path.join(insights, name), "any");

  const quarantined = await quarantinedRuns(directory);
  const restored = !!ctx.store.recovery?.restoredFrom;
  if (restored) log.info("janitor.kept_worktrees", { reason: "restored_from_backup" });
  for (const folder of restored ? [] : ["worktrees", "team-worktrees"]) {
    const parent = path.join(directory, folder);
    for (const name of await names(parent)) {
      const entry = path.join(parent, name);
      // Read at removal time: a run created since the scan began is in the list.
      const referenced =
        quarantined.includes(name) ||
        quarantined.includes(path.resolve(entry)) ||
        data.runs.some(
          (run) =>
            run.id === name ||
            (!!run.worktreePath &&
              path.resolve(run.worktreePath) === path.resolve(entry)),
        );
      if (!referenced) await removeStale(entry, "directory");
    }
  }

  for (const repo of [...data.repos])
    await ctx
      .lock(`repository:${repo.id}`, () => git(repo.path, ["worktree", "prune"]))
      .catch((error: unknown) =>
        log.debug("janitor.prune_failed", { repoId: repo.id, error }),
      );
  if (removed.length)
    log.info("janitor.removed", {
      count: removed.length,
      entries: removed.slice(0, 50),
    });
  return removed;
}
