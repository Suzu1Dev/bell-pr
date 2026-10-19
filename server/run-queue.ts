/**
 * The Workbench's run queue: runs wait in order for one of the plan's
 * active slots, then execute (run-executor.ts) in their own locale. It also
 * caps queued, running and paused runs together, queues again the runs a
 * restart left queued, and keeps each run's executing jobs so that
 * cancelling can wait for them.
 */
import { sm } from "./i18n/index.js";
import { log } from "./log.js";
import { logRunQueued } from "./run-events.js";
import { executeRun } from "./run-executor.js";
import { AppError, withRunLocale } from "./types.js";
import type { WorkbenchContext } from "./workbench.js";

export class RunQueue {
  private queue: string[] = [];
  private active = 0;
  private runJobs = new Map<string, Set<Promise<void>>>();

  constructor(
    private readonly ctx: WorkbenchContext,
    private readonly limits: {
      /** How many runs execute at once (Workbench.effectiveMaxActiveRuns). */
      active: () => number;
      /** Queued, running and paused runs together (Workbench.maxQueuedRuns). */
      queued: () => number;
    },
  ) {}

  /** Queues the run and starts it as soon as the active limit allows. */
  push(id: string) {
    this.queue.push(id);
    this.drain();
  }

  /**
   * Queues again, oldest first, the runs a restart left queued before they
   * started (Store keeps them queued). Runs beyond the queue capacity, or
   * whose project is gone, fail with the reason and can be retried.
   */
  resume() {
    const store = this.ctx.store;
    const queued = store.data.runs
      .filter((run) => run.status === "queued" && !this.queue.includes(run.id))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (!queued.length) return;
    let used = store.data.runs.filter((run) =>
      ["running", "awaiting_plan"].includes(run.status),
    ).length;
    let failed = false;
    for (const run of queued) {
      const full = used >= this.limits.queued();
      const orphaned = !store.data.repos.some((repo) => repo.id === run.repoId);
      if (full || orphaned) {
        run.status = "failed";
        run.error = withRunLocale(run, () =>
          orphaned
            ? sm().run.repos.notFound
            : sm().run.queue.full({ max: this.limits.queued() }),
        );
        if (run.team) run.team.phase = "failed";
        failed = true;
        log.warn("run.not_resumed", {
          runId: run.id,
          reason: orphaned ? "repository_missing" : "queue_full",
        });
        continue;
      }
      used++;
      withRunLocale(run, () =>
        this.ctx.log(run, "system", sm().storage.recovery.resumed),
      );
      logRunQueued(run, "resumed");
      this.queue.push(run.id);
    }
    if (failed) void store.save().catch(() => undefined);
    this.drain();
  }

  /** New and retried runs share the same cap on queued, running and paused work. */
  assertCapacity() {
    if (
      this.ctx.store.data.runs.filter((run) =>
        ["queued", "running", "awaiting_plan"].includes(run.status),
      ).length >= this.limits.queued()
    )
      throw new AppError(
        (m) => m.run.queue.full({ max: this.limits.queued() }),
        429,
      );
  }

  /** Starts queued runs while the active limit allows. */
  drain() {
    if (this.ctx.stopping()) return;
    while (this.active < this.limits.active() && this.queue.length) {
      const id = this.queue.shift()!;
      const run = this.ctx.run(id);
      if (run.status !== "queued") continue;
      this.active++;
      // Whoever drains the queue (a request, another run finishing), the
      // run executes in its own locale.
      const job = withRunLocale(run, () => executeRun(this.ctx, id))
        .catch((error) => {
          log.error("run.persist_failed", { runId: id, error });
        })
        .finally(() => {
          this.active--;
          this.ctx.jobs.delete(job);
          const pending = this.runJobs.get(id);
          pending?.delete(job);
          if (pending?.size === 0) this.runJobs.delete(id);
          this.drain();
        });
      this.ctx.jobs.add(job);
      const pending = this.runJobs.get(id) ?? new Set<Promise<void>>();
      pending.add(job);
      this.runJobs.set(id, pending);
    }
  }

  /** Waits until the run's executing jobs have finished their cleanup. */
  async settled(id: string) {
    await Promise.allSettled([...(this.runJobs.get(id) ?? [])]);
  }

  /**
   * Empties the queue at shutdown. A run that never started stays queued
   * and starts again on the next start (resume); one that already has a
   * worktree is cancelled.
   */
  clear() {
    for (const id of this.queue) {
      const run = this.ctx.run(id);
      if (run.status === "queued" && run.baseSha) run.status = "cancelled";
    }
    this.queue = [];
  }
}
