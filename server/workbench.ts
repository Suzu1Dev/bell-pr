import { randomUUID } from "node:crypto";
import path from "node:path";
import { command, agentEnvironment, redact } from "./process.js";
import { readDiff, synchronizeReview } from "./git.js";
import type { TeamAgentRunner } from "./team.js";
import { maxPlanRevisions } from "../shared/team.js";
import type { ContributionSettings } from "../shared/insights.js";
import { Store } from "./store.js";
import {
  AgentSlots,
  defaultActiveRunLimit,
  defaultAgentProcessLimit,
} from "./agent-slots.js";
import { defaultAgentTimeoutScale } from "./agent-timeouts.js";
import {
  AppError,
  withRunLocale,
  type DiffFile,
  type Repository,
  type Run,
  type RunLogEntry,
} from "./types.js";
import { getModelCatalog, resolveModelExecution } from "./models.js";
import { agentLoginCheck, type TransientSleep } from "./agent-cli.js";
import type { AgentProvider } from "../shared/models.js";
import { proEntitlements, type Entitlements } from "../shared/plans.js";
import { synchronizeExplanations } from "./explanations.js";
import { currentLocale, sm, withLocale } from "./i18n/index.js";
import { parseLocale, type Locale } from "../shared/i18n/locale.js";
import { initLog, log } from "./log.js";
import { logged, logRunQueued } from "./run-events.js";
import { activeFollowUp } from "../shared/followups.js";
import * as cleanup from "./cleanup.js";
import { runJanitor } from "./janitor.js";

import { collectDraftContext } from "./draft-sources.js";
import { synchronizeDraftPreparation } from "./drafts.js";
import * as repositories from "./repositories.js";
import * as executor from "./run-executor.js";
import { retryTeam } from "./team-retry.js";
import * as publishing from "./publish.js";
import * as learning from "./learning.js";
import * as drafting from "./draft-jobs.js";
import * as syncing from "./sync-runs.js";
import * as followUps from "./followup-runs.js";

const now = () => new Date().toISOString();
const newId = () => randomUUID();
/** The only language of the builds that saved runs without a locale (as in git.ts readDiff). */
const legacyRunLocale: Locale = "zh-TW";
/** How often the retention period is applied while the server runs. */
const retentionIntervalMs = 24 * 60 * 60 * 1000;

/**
 * What the modules that do the Workbench's work receive instead of the
 * class: shared state and the façade operations they call back. They import
 * only this type from workbench.ts, so there is no import cycle.
 */
export interface WorkbenchContext {
  store: Store;
  /** Shared by every agent CLI call, including project analysis and discovery. */
  agentSlots: AgentSlots;
  /** BELLPR_AGENT_TIMEOUT_SCALE; multiplies every agent turn timeout. */
  agentTimeoutScale: number;
  /**
   * Aborts work in flight: a run or its review rerun by run id; explanations,
   * the PR draft and chat by "explanations:", "draft:" or "guide:" + run id.
   */
  controllers: Map<string, AbortController>;
  /** Every background job; shutdown() waits for all of them. */
  jobs: Set<Promise<void>>;
  /** Explanations being generated, by run id. */
  explanationJobs: Map<string, Promise<void>>;
  /** PR draft preparation in progress, by run id. */
  draftJobs: Map<string, Promise<void>>;
  /** Learner-requested reviewer/tester reruns; one per run, aborted through controllers[run.id]. */
  reviewJobs: Map<string, Promise<void>>;
  /** Review follow-up rounds and sync conflict resolutions, by run id; aborted through controllers[run.id]. */
  followUpJobs: Map<string, Promise<void>>;
  conflictJobs: Map<string, Promise<void>>;
  dependencies: {
    /** Agent CLI invocations only; Git and gh keep using the real command. */
    command?: typeof command;
    /** Answers agent turns in place of the CLI, as tests do. */
    agentRunner?: TeamAgentRunner;
    /** Wait between retries of a turn that lost the OAuth refresh race. */
    sleep?: TransientSleep;
    /** Reads the target project's contribution rules for the PR draft. */
    collectDraftContext?: typeof collectDraftContext;
  };
  /** True once shutdown() has begun; no new background work starts. */
  stopping(): boolean;
  /** Throws 429 once queued, running and paused runs reach the cap. */
  assertQueueCapacity(): void;
  /** Queues the run and starts it as soon as the active limit allows. */
  enqueue(id: string): void;
  /** Appends to the run's own log, which is saved with the run. */
  log(
    run: Run,
    agent: string,
    message: string,
    entry?: Pick<RunLogEntry, "kind" | "detail">,
  ): void;
  run(id: string): Run;
  repo(id: string): Repository;
  /** Runs one task per key at a time, in call order (see Workbench.lock). */
  lock<T>(id: string, task: () => Promise<T>): Promise<T>;
  /** Reads the run's diff and brings explanations, draft and review state up to date. */
  diff(id: string): Promise<DiffFile[]>;
  /** Explains the changed files once development is complete. */
  explanations(id: string): Promise<{ run: Run; files: DiffFile[] }>;
  /** Starts the run's PR draft preparation, or waits for the one running. */
  prepareRunDraft(
    id: string,
    options: drafting.DraftOptions,
  ): Promise<{ run: Run }>;
}

export class Workbench {
  private controllers = new Map<string, AbortController>();
  private queue: string[] = [];
  private active = 0;
  private stopping = false;
  private jobs = new Set<Promise<void>>();
  private runJobs = new Map<string, Set<Promise<void>>>();
  private locks = new Map<string, Promise<unknown>>();
  private explanationJobs = new Map<string, Promise<void>>();
  private draftJobs = new Map<string, Promise<void>>();
  /** Learner-requested reviewer/tester reruns; one per run, aborted through controllers[run.id]. */
  private reviewJobs = new Map<string, Promise<void>>();
  private followUpJobs = new Map<string, Promise<void>>();
  private conflictJobs = new Map<string, Promise<void>>();
  private statusCache?: {
    time: number;
    value: {
      codex: boolean;
      github: boolean;
      githubUser?: string;
      codexAuthenticated: boolean;
      claude: boolean;
      claudeAuthenticated: boolean;
    };
  };
  /** Shared by every agent CLI call, including project analysis and discovery. */
  readonly agentSlots: AgentSlots;
  /** How many runs drain() executes at once; each run still takes CLI slots per agent. */
  readonly maxActiveRuns: number;
  /** BELLPR_AGENT_TIMEOUT_SCALE; multiplies every agent turn timeout. */
  readonly agentTimeoutScale: number;
  /**
   * What the current plan allows. Nothing reads it yet: the queue and the
   * team size apply it once licensing lands, so runs behave as before.
   */
  readonly entitlements: () => Entitlements;
  private readonly context: WorkbenchContext;
  /** The startup janitor, then the first retention pass; never rejects. */
  readonly maintenance: Promise<void>;
  private retentionTimer?: NodeJS.Timeout;
  constructor(
    public store: Store,
    agentRunner?: TeamAgentRunner,
    private dependencies: {
      getModelCatalog?: typeof getModelCatalog;
      collectDraftContext?: typeof collectDraftContext;
      agentSlots?: AgentSlots;
      maxActiveRuns?: number;
      agentTimeoutScale?: number;
      /** Agent CLI invocations only; Git and gh keep using the real command. */
      command?: typeof command;
      /** Wait between retries of a turn that lost the OAuth refresh race. */
      sleep?: TransientSleep;
      /** The plan's limits; Pro with maxActiveRuns when absent (library and tests). */
      entitlements?: () => Entitlements;
    } = {},
  ) {
    this.agentSlots =
      dependencies.agentSlots ?? new AgentSlots(defaultAgentProcessLimit);
    this.maxActiveRuns = dependencies.maxActiveRuns ?? defaultActiveRunLimit;
    this.agentTimeoutScale =
      dependencies.agentTimeoutScale ?? defaultAgentTimeoutScale;
    if (!Number.isInteger(this.maxActiveRuns) || this.maxActiveRuns < 1)
      throw new Error("Workbench maxActiveRuns must be a positive integer.");
    this.entitlements =
      dependencies.entitlements ?? (() => proEntitlements(this.maxActiveRuns));
    // Callbacks go through `this` so a replaced method (as tests do) applies.
    this.context = {
      store: this.store,
      agentSlots: this.agentSlots,
      agentTimeoutScale: this.agentTimeoutScale,
      controllers: this.controllers,
      jobs: this.jobs,
      explanationJobs: this.explanationJobs,
      draftJobs: this.draftJobs,
      reviewJobs: this.reviewJobs,
      followUpJobs: this.followUpJobs,
      conflictJobs: this.conflictJobs,
      dependencies: {
        command: dependencies.command,
        agentRunner,
        sleep: dependencies.sleep,
        collectDraftContext: dependencies.collectDraftContext,
      },
      stopping: () => this.stopping,
      assertQueueCapacity: () => this.assertQueueCapacity(),
      enqueue: (id) => {
        this.queue.push(id);
        this.drain();
      },
      log: executor.appendRunLog,
      run: (id) => this.run(id),
      repo: (id) => this.repo(id),
      lock: (id, task) => this.lock(id, task),
      diff: (id) => this.diff(id),
      explanations: (id) => this.explanations(id),
      prepareRunDraft: (id, options) => this.prepareRunDraft(id, options),
    };
    // Server logs go to the data directory from here on (see log.ts).
    initLog(store.directory);
    const startedAt = Date.now();
    this.maintenance = this.startMaintenance(startedAt);
    this.retentionTimer = setInterval(() => {
      void this.applyRetention();
    }, retentionIntervalMs);
    this.retentionTimer.unref();
    this.resume();
  }

  /**
   * Removes crash leftovers (janitor.ts), then frees the files of runs
   * past the retention period. Entries newer than `startedAt` are kept.
   */
  private async startMaintenance(startedAt: number) {
    try {
      await runJanitor(this.context, { startedAt });
      await this.applyRetention();
    } catch (error) {
      log.warn("maintenance.failed", { error });
    }
  }

  /**
   * Queues again, oldest first, the runs a restart left queued before they
   * started (Store keeps them queued). Runs beyond the queue capacity, or
   * whose project is gone, fail with the reason and can be retried.
   */
  resume() {
    const queued = this.store.data.runs
      .filter((run) => run.status === "queued" && !this.queue.includes(run.id))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (!queued.length) return;
    let used = this.store.data.runs.filter((run) =>
      ["running", "awaiting_plan"].includes(run.status),
    ).length;
    let failed = false;
    for (const run of queued) {
      const full = used >= this.maxQueuedRuns;
      const orphaned = !this.store.data.repos.some((repo) => repo.id === run.repoId);
      if (full || orphaned) {
        run.status = "failed";
        run.error = withRunLocale(run, () =>
          orphaned
            ? sm().run.repos.notFound
            : sm().run.queue.full({ max: this.maxQueuedRuns }),
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
        this.log(run, "system", sm().storage.recovery.resumed),
      );
      logRunQueued(run, "resumed");
      this.queue.push(run.id);
    }
    if (failed) void this.store.save().catch(() => undefined);
    this.drain();
  }

  /** Frees the files of finished runs past the retention period (cleanup.ts). */
  async applyRetention() {
    if (this.stopping) return [];
    try {
      return await cleanup.applyRetention(this.context);
    } catch (error) {
      log.warn("retention.failed", { error });
      return [];
    }
  }

  /** Queued, running and paused runs together; grows with the active limit. */
  get maxQueuedRuns() {
    return Math.max(8, this.maxActiveRuns * 2);
  }

  /** Reported by GET /api/status so the settings page can show the configured caps. */
  get limits() {
    return {
      maxActiveRuns: this.maxActiveRuns,
      maxAgentProcesses: this.agentSlots.limit,
      maxQueued: this.maxQueuedRuns,
    };
  }

  models(provider?: AgentProvider) {
    return (this.dependencies.getModelCatalog ?? getModelCatalog)(provider);
  }

  repo(id: string) {
    const repo = this.store.data.repos.find((value) => value.id === id);
    if (!repo) throw new AppError((m) => m.run.repos.notFound, 404);
    return repo;
  }

  run(id: string) {
    const run = this.store.data.runs.find((value) => value.id === id);
    if (!run) throw new AppError((m) => m.run.queue.runNotFound, 404);
    return run;
  }

  async lock<T>(id: string, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    this.locks.set(id, current);
    try {
      return await current;
    } finally {
      if (this.locks.get(id) === current) this.locks.delete(id);
    }
  }

  async status() {
    if (this.statusCache && Date.now() - this.statusCache.time < 10_000)
      return this.statusCache.value;
    const claudeLogin = agentLoginCheck("claude");
    const [codex, auth, github, claude, claudeAuth] = await Promise.allSettled([
      command("codex", ["--version"], { timeoutMs: 5000 }),
      command("codex", ["login", "status"], { timeoutMs: 5000 }),
      command("gh", ["api", "user", "--jq", ".login"], { timeoutMs: 10_000 }),
      command("claude", ["--version"], { timeoutMs: 5000 }),
      command(claudeLogin.executable, claudeLogin.args, {
        timeoutMs: 10_000,
        env: agentEnvironment(),
      }),
    ]);
    const value = {
      codex: codex.status === "fulfilled",
      codexAuthenticated: auth.status === "fulfilled",
      claude: claude.status === "fulfilled",
      claudeAuthenticated: claudeAuth.status === "fulfilled",
      github: github.status === "fulfilled",
      ...(github.status === "fulfilled"
        ? { githubUser: github.value.stdout.trim() }
        : {}),
    };
    this.statusCache = { value, time: Date.now() };
    return value;
  }

  async importRepository(source: string) {
    return repositories.importRepository(this.context, source);
  }

  /** Whether BELL made this clone and may update it; a local import is never changed. */
  managedClone(repo: Repository) {
    return repositories.managedClone(this.store.directory, repo);
  }

  async updateRepository(id: string) {
    return repositories.updateRepository(this.context, id);
  }

  async createRun(
    repoId: string,
    prompt: string,
    title?: string,
    settings?: ContributionSettings,
  ) {
    const repo = this.repo(repoId);
    const modelExecution = resolveModelExecution(
      settings ?? {},
      await this.models(settings?.provider),
    );
    const capability = await this.status();
    if (modelExecution.provider === "claude") {
      if (!capability.claude)
        throw new AppError((m) => m.run.queue.claudeMissing, 503);
      if (!capability.claudeAuthenticated)
        throw new AppError((m) => m.run.queue.claudeSignedOut, 503);
    } else {
      if (!capability.codex)
        throw new AppError((m) => m.run.queue.codexMissing, 503);
      if (!capability.codexAuthenticated)
        throw new AppError((m) => m.run.queue.codexSignedOut, 503);
    }
    this.assertQueueCapacity();
    const id = newId();
    const agents = sm().run.agents;
    const run: Run = {
      id,
      repoId,
      title: title || prompt.slice(0, 72),
      prompt,
      status: "queued",
      // Every run branch uses the fix/ prefix; the GitHub branch field can override it per run.
      branch: `fix/${id.slice(0, 8)}`,
      baseBranch: repo.defaultBranch,
      baseSha: "",
      worktreePath: path.join(this.store.directory, "worktrees", id),
      createdAt: now(),
      // The request's locale; the run's background work and agents use it.
      locale: currentLocale(),
      agents: [
        {
          id: "lead",
          name: "Atlas",
          role: "Team lead",
          status: "waiting",
          detail: agents.lead,
        },
        {
          id: "reviewer",
          name: "Lens",
          role: "Reviewer",
          status: "waiting",
          detail: agents.reviewer,
        },
        {
          id: "tester",
          name: "Scout",
          role: "Test analyst",
          status: "waiting",
          detail: agents.tester,
        },
      ],
      logs: [],
      draft: { title: title || prompt.slice(0, 72), body: "" },
      reviewedFiles: [],
      reviewedFingerprints: {},
      reports: {},
      contributionSettings: settings ? { ...settings } : undefined,
      modelExecution,
      team: {
        config: {
          maxTeammates: settings?.maxTeammates ?? 3,
          requirePlanApproval: settings?.requirePlanApproval ?? true,
          provider: modelExecution.provider ?? "codex",
          protocol: "bell-shared-tasks",
          messageDelivery: "between-turns",
        },
        phase: "planning",
        planSummary: "",
        tasks: [],
        messages: [],
      },
    };
    this.store.data.runs.unshift(run);
    await this.store.save();
    logRunQueued(run, "created");
    this.queue.push(id);
    this.drain();
    return run;
  }

  /** New and retried runs share the same cap on queued, running and paused work. */
  private assertQueueCapacity() {
    if (
      this.store.data.runs.filter((run) =>
        ["queued", "running", "awaiting_plan"].includes(run.status),
      ).length >= this.maxQueuedRuns
    )
      throw new AppError(
        (m) => m.run.queue.full({ max: this.maxQueuedRuns }),
        429,
      );
  }

  private drain() {
    if (this.stopping) return;
    while (this.active < this.maxActiveRuns && this.queue.length) {
      const id = this.queue.shift()!;
      const run = this.run(id);
      if (run.status !== "queued") continue;
      this.active++;
      // Whoever drains the queue (a request, another run finishing), the
      // run executes in its own locale.
      const job = withRunLocale(run, () =>
        executor.executeRun(this.context, id),
      )
        .catch((error) => {
          log.error("run.persist_failed", { runId: id, error });
        })
        .finally(() => {
          this.active--;
          this.jobs.delete(job);
          const pending = this.runJobs.get(id);
          pending?.delete(job);
          if (pending?.size === 0) this.runJobs.delete(id);
          this.drain();
        });
      this.jobs.add(job);
      const pending = this.runJobs.get(id) ?? new Set<Promise<void>>();
      pending.add(job);
      this.runJobs.set(id, pending);
    }
  }

  /** 4A: drain the queue when entitlements change. */
  entitlementsChanged(): void {}

  /** Appends to the run's own log through the context (see appendRunLog). */
  private log(
    run: Run,
    agent: string,
    message: string,
    entry?: Pick<RunLogEntry, "kind" | "detail">,
  ) {
    this.context.log(run, agent, message, entry);
  }

  async sendTeamMessage(id: string, input: { to: string; content: string }) {
    return this.lock(`team-message:${id}`, async () => {
      const run = this.run(id);
      if (!["queued", "running", "awaiting_plan"].includes(run.status))
        throw new AppError((m) => m.run.queue.teamStopped, 409);
      executor.queueTeamMessage(
        this.context,
        run,
        "user",
        input.to,
        input.content,
      );
      await this.store.save();
      return run;
    });
  }

  async approvePlan(id: string) {
    return this.lock(id, async () => {
      const run = this.run(id);
      if (run.status !== "awaiting_plan" || !run.team?.tasks.length)
        throw new AppError((m) => m.run.queue.noPlanToApprove, 409);
      run.team.approvedAt = now();
      run.team.phase = "developing";
      run.status = "queued";
      this.log(run, "user", sm().run.queue.planApproved);
      await this.store.save();
      logRunQueued(run, "plan_approved");
      this.queue.push(id);
      this.drain();
      return run;
    });
  }

  /**
   * Sends back to the lead a plan the person did not approve. The planning
   * branch of executeRun() runs again with the feedback attached; there is no
   * second planning path. Messages queued to tasks of the old plan stay in the
   * inbox under their old task ids and are not forwarded.
   */
  async revisePlan(id: string, feedback: string) {
    return this.lock(id, async () => {
      const run = this.run(id);
      const team = run.team;
      if (run.status !== "awaiting_plan" || !team?.tasks.length)
        throw new AppError((m) => m.run.queue.noPlanToApprove, 409);
      const content = redact(feedback.trim());
      if (!content || content.length > 4000)
        throw new AppError((m) => m.run.queue.feedbackLength, 400);
      const revisions = (team.planRevisions ??= []);
      if (revisions.length >= maxPlanRevisions)
        throw new AppError(
          (m) => m.run.queue.revisionLimit({ max: maxPlanRevisions }),
          409,
        );
      revisions.push({
        feedback: content,
        previousSummary: team.planSummary,
        previousTasks: team.tasks.map(({ id, title, files, dependsOn }) => ({
          id,
          title,
          files,
          dependsOn,
        })),
        createdAt: now(),
      });
      // The planning branch inserts one agent per member of the new plan;
      // the old members must go first or they would be listed twice.
      run.agents = run.agents.filter((agent) => !/^member-/.test(agent.id));
      team.tasks = [];
      team.planSummary = "";
      team.phase = "planning";
      run.status = "queued";
      this.log(
        run,
        "user",
        sm().run.queue.planSentBack({
          revision: revisions.length,
          max: maxPlanRevisions,
        }),
      );
      await this.store.save();
      logRunQueued(run, "plan_revised");
      this.queue.push(id);
      this.drain();
      return run;
    });
  }

  async retryTeam(id: string, message?: string) {
    return retryTeam(this.context, id, message);
  }

  async cancel(id: string) {
    const run = this.run(id);
    // Stopping a re-review only aborts the reviewers; the run keeps its status.
    // A conflict resolution or a follow-up round keeps the edits made so far
    // for review, and a published PR stays published.
    const side =
      this.reviewJobs.get(id) ??
      this.conflictJobs.get(id) ??
      this.followUpJobs.get(id);
    if (side) {
      this.controllers.get(id)?.abort();
      await Promise.allSettled([side]);
      return run;
    }
    if (!["queued", "running", "awaiting_plan"].includes(run.status))
      throw new AppError((m) => m.run.queue.cancelNotAllowed, 409);
    this.controllers.get(id)?.abort();
    run.status = "cancelled";
    if (run.team) run.team.phase = "cancelled";
    this.log(run, "system", sm().run.queue.cancelRequested);
    await this.store.save();
    // Do not hold a run/repository/integration lock here: workers must finish
    // their cleanup and persist final task states before the HTTP response.
    // Queued or already-paused plans have no active work to wait for.
    await Promise.allSettled([...(this.runJobs.get(id) ?? [])]);
    return run;
  }

  async rerunReview(id: string) {
    return learning.rerunReview(this.context, id);
  }

  async diff(id: string) {
    const run = this.run(id);
    cleanup.assertWorkspacePresent(run);
    const files = await readDiff(run);
    // Text saved on the run is worded in the run's language, never the
    // viewer's; runs saved without a locale were written in zh-TW.
    withLocale(parseLocale(run.locale) ?? legacyRunLocale, () => {
      synchronizeExplanations(run, files);
      synchronizeDraftPreparation(run, files);
    });
    if (run.status !== "published") {
      synchronizeReview(run, files);
    }
    await syncing.refreshConflicts(run);
    await this.store.save();
    return files;
  }

  async explanations(
    id: string,
    options: { retry?: boolean; filePath?: string } = {},
  ) {
    return learning.explanations(this.context, id, options);
  }

  async prepareDraft(id: string, options: { refresh?: boolean } = {}) {
    return this.prepareRunDraft(id, options);
  }

  private async prepareRunDraft(
    id: string,
    options: drafting.DraftOptions = {},
  ) {
    return drafting.prepareRunDraft(this.context, id, options);
  }

  editable(run: Run) {
    publishing.editable(run);
  }

  async draft(id: string, draft: Run["draft"]) {
    return publishing.saveDraft(this.context, id, draft);
  }

  async review(
    id: string,
    filePath: string,
    reviewed: boolean,
    displayedFingerprint: string,
  ) {
    return publishing.review(
      this.context,
      id,
      filePath,
      reviewed,
      displayedFingerprint,
    );
  }

  async approve(id: string, displayedDraft: Run["draft"]) {
    return publishing.approve(this.context, id, displayedDraft);
  }

  async saveNote(id: string, filePath: string, text: string) {
    return learning.saveNote(this.context, id, filePath, text);
  }

  async chat(id: string, filePath: string, question: string) {
    return learning.chat(this.context, id, filePath, question);
  }

  async fetchPrFeedback(id: string) {
    return learning.fetchPrFeedback(this.context, id);
  }

  /** Moves a run onto the latest commit of its target branch (see sync-runs.ts). */
  async syncRun(id: string) {
    return syncing.syncRun(this.context, id);
  }

  async undoSync(id: string) {
    return syncing.undoSync(this.context, id);
  }

  async resolveConflicts(id: string) {
    return syncing.resolveConflicts(this.context, id);
  }

  /** Starts a round of changes on a published PR from maintainer feedback. */
  async startFollowUp(
    id: string,
    input: { feedbackUrls: string[]; note?: string },
  ) {
    return followUps.startFollowUp(this.context, id, input);
  }

  async discardFollowUp(id: string) {
    return logged("round.discard", { runId: id }, () =>
      followUps.discardFollowUp(this.context, id),
    );
  }

  /** Publishes the first commit and PR, or pushes an open round (publish.ts). */
  async publish(
    id: string,
    displayedFingerprint: string,
    acknowledged: string[] = [],
  ) {
    const round = activeFollowUp(this.run(id).followUps);
    return logged(
      "publish",
      { runId: id, ...(round ? { round: round.id } : {}) },
      () =>
        publishing.publish(
          this.context,
          id,
          displayedFingerprint,
          acknowledged,
        ),
    );
  }

  /** Frees a finished run's working files; the run and its notes stay. */
  async removeWorkspace(id: string) {
    return cleanup.archiveRunWorkspace(this.context, this.run(id));
  }

  async removeRun(id: string) {
    return cleanup.removeRun(this.context, id);
  }

  async removeRepository(id: string) {
    return cleanup.removeRepository(this.context, id);
  }

  async eraseAll(confirm: unknown) {
    return cleanup.eraseAll(this.context, confirm);
  }

  /** Disk use per project and run (cleanup.ts), cached for a minute. */
  async storage() {
    return cleanup.storageReport(this.context);
  }

  async shutdown() {
    this.stopping = true;
    clearInterval(this.retentionTimer);
    // A run that never started stays queued and starts again on the next
    // start (resume); one that already has a worktree is cancelled.
    for (const id of this.queue) {
      const run = this.run(id);
      if (run.status === "queued" && run.baseSha) run.status = "cancelled";
    }
    this.queue = [];
    for (const controller of this.controllers.values()) controller.abort();
    await Promise.allSettled([...this.jobs, this.maintenance]);
    await this.store.save();
  }
}
