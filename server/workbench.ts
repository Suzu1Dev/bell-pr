import { randomUUID } from "node:crypto";
import path from "node:path";
import { command, redact } from "./process.js";
import { legacyRunLocale, readDiff, synchronizeReview } from "./git.js";
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
import type { TransientSleep } from "./agent-cli.js";
import type { AgentProvider } from "../shared/models.js";
import {
  clampContributionSettings,
  proEntitlements,
  type Entitlements,
} from "../shared/plans.js";
import {
  activateAppSettings,
  AppSettingsService,
  deactivateAppSettings,
} from "./app-settings.js";
import { cliStatus, runDoctor, type DoctorAppInfo } from "./doctor.js";
import { setupError } from "./cli-errors.js";
import { enforceAgentSandbox } from "./sandbox.js";
import { analysisRunning } from "./insights.js";
import { discoveryRunning, resetDiscovery } from "./discovery.js";
import { synchronizeExplanations } from "./explanations.js";
import { currentLocale, sm, withLocale } from "./i18n/index.js";
import { parseLocale } from "../shared/i18n/locale.js";
import { closeLog, initLog, log } from "./log.js";
import { logged, logRunQueued } from "./run-events.js";
import {
  activeFollowUp,
  type FollowUpStartInput,
} from "../shared/followups.js";
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
import * as walkthroughs from "./walkthrough-runs.js";
import * as premises from "./premise-runs.js";
import { synchronizeWalkthroughs } from "./walkthroughs.js";
import {
  synchronizeUnderstanding,
  understandingFacade,
  type UnderstandingFacade,
} from "./understanding.js";
import {
  contributionFacade,
  type ContributionFacade,
} from "./contribution-facts.js";
import { learningLoopFacade, type LearningLoopFacade } from "./learning-loop.js";
import type { GuardOverride } from "../shared/contribution.js";

const now = () => new Date().toISOString();
const newId = () => randomUUID();
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
  /** Multiplies every agent turn timeout (app settings, then BELLPR_AGENT_TIMEOUT_SCALE). */
  readonly agentTimeoutScale: number;
  /**
   * Aborts work in flight: a run or its review rerun by run id; explanations,
   * the PR draft and chat by "explanations:", "draft:" or "guide:" + run id.
   */
  controllers: Map<string, AbortController>;
  /** Every background job; shutdown() waits for all of them. */
  jobs: Set<Promise<void>>;
  /** Explanations being generated, by run id. */
  explanationJobs: Map<string, Promise<void>>;
  /** Function walkthroughs being generated, one per run and file, keyed `${runId}\0${path}`. */
  walkthroughJobs: Map<string, Promise<void>>;
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
  private walkthroughJobs = new Map<string, Promise<void>>();
  private draftJobs = new Map<string, Promise<void>>();
  /** Learner-requested reviewer/tester reruns; one per run, aborted through controllers[run.id]. */
  private reviewJobs = new Map<string, Promise<void>>();
  private followUpJobs = new Map<string, Promise<void>>();
  private conflictJobs = new Map<string, Promise<void>>();
  /** Shared by every agent CLI call, including project analysis and discovery. */
  readonly agentSlots: AgentSlots;
  /**
   * The app settings in `<dataDir>/app-settings.json`. Saved limits apply
   * over the values the Workbench was created with, and environment
   * variables over both (see app-settings.ts).
   */
  readonly appSettings: AppSettingsService;
  /** The limits the Workbench was created with, used while no setting changes them. */
  private readonly base: {
    maxActiveRuns: number;
    maxAgentProcesses: number;
    agentTimeoutScale: number;
  };
  /**
   * What the current plan allows: how many runs execute at once
   * (effectiveMaxActiveRuns) and how many teammates a new run gets.
   */
  readonly entitlements: () => Entitlements;
  /** The Explain-it-back check and the per-file attempts (understanding.ts). */
  readonly understanding: UnderstandingFacade;
  /** The project's rules, GitHub facts and test reasons (contribution-facts.ts). */
  readonly contribution: ContributionFacade;
  /** Feedback tags, the practice deck, the counts and the coach debrief (learning-loop.ts). */
  readonly learningLoop: LearningLoopFacade;
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
      /**
       * The app settings of the store's data directory, when the caller
       * activated them before the store loaded (startServer); read from the
       * data directory when absent.
       */
      appSettings?: AppSettingsService;
    } = {},
  ) {
    this.agentSlots =
      dependencies.agentSlots ?? new AgentSlots(defaultAgentProcessLimit);
    this.base = {
      maxActiveRuns: dependencies.maxActiveRuns ?? defaultActiveRunLimit,
      maxAgentProcesses: this.agentSlots.limit,
      agentTimeoutScale:
        dependencies.agentTimeoutScale ?? defaultAgentTimeoutScale,
    };
    if (
      !Number.isInteger(this.base.maxActiveRuns) ||
      this.base.maxActiveRuns < 1
    )
      throw new Error("Workbench maxActiveRuns must be a positive integer.");
    this.appSettings =
      dependencies.appSettings ?? new AppSettingsService(store.directory);
    // Work no request asked for (recovery, the resumed queue, retention)
    // follows the language chosen in the app.
    activateAppSettings(this.appSettings);
    this.entitlements =
      dependencies.entitlements ?? (() => proEntitlements(this.maxActiveRuns));
    // Callbacks go through `this` so a replaced method (as tests do) applies.
    const timeoutScale = () => this.agentTimeoutScale;
    this.context = {
      store: this.store,
      agentSlots: this.agentSlots,
      // Read for each turn, so a changed app setting applies.
      get agentTimeoutScale() {
        return timeoutScale();
      },
      controllers: this.controllers,
      jobs: this.jobs,
      explanationJobs: this.explanationJobs,
      walkthroughJobs: this.walkthroughJobs,
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
    this.understanding = understandingFacade(this.context, {
      lockedBy: () => this.appSettings.lockedBy().skipUnderstandingCheck,
    });
    this.contribution = contributionFacade(this.context);
    this.learningLoop = learningLoopFacade(this.context);
    this.applySettings();
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

  /** How many runs may execute at once as configured (before the plan's limit). */
  get maxActiveRuns() {
    return this.appSettings.get().maxActiveRuns ?? this.base.maxActiveRuns;
  }

  /** How many runs drain() executes at once: the configured value within the plan's. */
  get effectiveMaxActiveRuns() {
    return Math.min(this.maxActiveRuns, this.entitlements().maxActiveRuns);
  }

  /** Multiplies every agent turn timeout. */
  get agentTimeoutScale() {
    return (
      this.appSettings.get().agentTimeoutScale ?? this.base.agentTimeoutScale
    );
  }

  /** Queued, running and paused runs together; grows with the active limit. */
  get maxQueuedRuns() {
    return Math.max(8, this.maxActiveRuns * 2);
  }

  /** Reported by GET /api/status so the settings page can show the configured caps. */
  get limits() {
    return {
      maxActiveRuns: this.maxActiveRuns,
      effectiveMaxActiveRuns: this.effectiveMaxActiveRuns,
      maxAgentProcesses: this.agentSlots.limit,
      maxQueued: this.maxQueuedRuns,
    };
  }

  /** Applies saved limits: the agent process limit, then the run queue. */
  private applySettings() {
    this.agentSlots.setLimit(
      this.appSettings.get().maxAgentProcesses ?? this.base.maxAgentProcesses,
    );
    this.drain();
  }

  /**
   * Saves app settings (PUT /api/app-settings) and applies new limits at
   * once: a higher run or process limit starts queued work.
   */
  async updateAppSettings(input: unknown) {
    const view = await this.appSettings.update(input);
    this.applySettings();
    return view;
  }

  /** Saves how many runs may execute at once and starts queued runs it allows. */
  async setMaxActiveRuns(maxActiveRuns: number) {
    return this.updateAppSettings({ maxActiveRuns });
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

  /**
   * The environment report (doctor.ts) for this data directory, with the
   * run and process limits in its app check. Probes are shared for 10
   * seconds; `force` probes again.
   */
  async doctor(options: { force?: boolean; app?: DoctorAppInfo } = {}) {
    return runDoctor({
      force: options.force,
      dataDir: this.store.directory,
      app: {
        maxActiveRuns: this.maxActiveRuns,
        effectiveMaxActiveRuns: this.effectiveMaxActiveRuns,
        maxAgentProcesses: this.agentSlots.limit,
        ...options.app,
      },
    });
  }

  /** Which agent CLIs are installed and signed in, and the GitHub account (from the doctor). */
  async status() {
    return cliStatus(await this.doctor());
  }

  /**
   * Refuses a new run before it is queued when its provider is not
   * installed or not signed in, or when it is Claude Code and its sandbox
   * cannot start (unless unsandboxed agents are allowed). Each refusal has
   * a code and the commands that fix it.
   */
  private async assertProviderReady(provider: AgentProvider) {
    const capability = await this.status();
    if (provider === "claude") {
      if (!capability.claude)
        throw new AppError((m) => m.run.queue.claudeMissing, 503, {
          code: "claude_missing",
          fixes: setupError("claude_missing").fixes,
        });
      if (!capability.claudeAuthenticated)
        throw new AppError((m) => m.run.queue.claudeSignedOut, 503, {
          code: "claude_unauthenticated",
          fixes: setupError("claude_unauthenticated").fixes,
        });
      // Every contribution run has agents that edit files.
      await enforceAgentSandbox("claude", "write");
    } else {
      if (!capability.codex)
        throw new AppError((m) => m.run.queue.codexMissing, 503, {
          code: "codex_missing",
          fixes: setupError("codex_missing").fixes,
        });
      if (!capability.codexAuthenticated)
        throw new AppError((m) => m.run.queue.codexSignedOut, 503, {
          code: "codex_unauthenticated",
          fixes: setupError("codex_unauthenticated").fixes,
        });
    }
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
    await this.assertProviderReady(modelExecution.provider ?? "codex");
    this.assertQueueCapacity();
    // The plan decides how many teammates a new run gets; runs created
    // before keep their recorded team.
    const requested = {
      ...settings,
      maxTeammates: settings?.maxTeammates ?? (3 as const),
    };
    const { settings: allowed, clamped } = clampContributionSettings(
      requested,
      this.entitlements(),
    );
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
      contributionSettings: settings
        ? { ...settings, maxTeammates: allowed.maxTeammates }
        : undefined,
      modelExecution,
      team: {
        config: {
          maxTeammates: allowed.maxTeammates,
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
    if (clamped)
      withRunLocale(run, () =>
        this.log(
          run,
          "system",
          sm().setup.plan.teamClamped({
            max: allowed.maxTeammates,
            pro: proEntitlements(1).maxTeammates,
          }),
          { kind: "notice" },
        ),
      );
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
    while (this.active < this.effectiveMaxActiveRuns && this.queue.length) {
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

  /**
   * Called after the plan changed (a license or trial started or ended):
   * starts queued runs the new plan allows. Running runs are never stopped,
   * and existing runs keep their team size.
   */
  entitlementsChanged(): void {
    this.drain();
  }

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
      // The check belonged to the plan sent back; the new plan makes its own.
      delete team.premise;
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
      synchronizeWalkthroughs(run, files);
      synchronizeDraftPreparation(run, files);
    });
    if (run.status !== "published") {
      synchronizeReview(run, files);
      synchronizeUnderstanding(run, files);
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

  /** Checks a finished run's premise again, or for the first time (premise-runs.ts). */
  async checkPremise(id: string) {
    cleanup.assertWorkspacePresent(this.run(id));
    return premises.checkPremise(this.context, id);
  }

  /** Explains the functions around one file's changes (walkthrough-runs.ts). */
  async walkthrough(id: string, filePath: string, retry = false) {
    return walkthroughs.walkthrough(this.context, id, filePath, retry);
  }

  /** The base version around a modified file's changes (learning.ts). */
  async contextLines(
    id: string,
    filePath: string,
    fingerprint: string,
    baseSha: string,
  ) {
    cleanup.assertWorkspacePresent(this.run(id));
    return learning.contextLines(this.context, id, filePath, fingerprint, baseSha);
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
    cleanup.assertWorkspacePresent(this.run(id), { update: true });
    return syncing.syncRun(this.context, id);
  }

  async undoSync(id: string) {
    cleanup.assertWorkspacePresent(this.run(id), { update: true });
    return syncing.undoSync(this.context, id);
  }

  async resolveConflicts(id: string) {
    cleanup.assertWorkspacePresent(this.run(id), { update: true });
    return syncing.resolveConflicts(this.context, id);
  }

  /** Starts a round of changes on a published PR from maintainer feedback. */
  async startFollowUp(id: string, input: FollowUpStartInput) {
    cleanup.assertWorkspacePresent(this.run(id), { update: true });
    return followUps.startFollowUp(this.context, id, input);
  }

  async discardFollowUp(id: string) {
    return logged("round.discard", { runId: id }, () =>
      followUps.discardFollowUp(this.context, id),
    );
  }

  /**
   * Publishes the first commit and PR, or pushes an open round
   * (publish.ts). `overrides` lift a block with the person's reason
   * (only `issue-has-pr`), recorded on the run.
   */
  async publish(
    id: string,
    displayedFingerprint: string,
    acknowledged: string[] = [],
    overrides: Pick<GuardOverride, "id" | "reason">[] = [],
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
          overrides,
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

  /** Deletes a project; refused while its analysis runs, which would write its cache again. */
  async removeRepository(id: string) {
    this.repo(id);
    if (analysisRunning(this.store, id))
      throw new AppError((m) => m.setup.busy.analysisRunning, 409);
    return cleanup.removeRepository(this.context, id);
  }

  /**
   * Deletes all data; refused while a project analysis or a discovery
   * search runs. The discovery services then forget their job.
   */
  async eraseAll(confirm: unknown) {
    if (confirm === "ERASE") {
      if (analysisRunning(this.store))
        throw new AppError((m) => m.setup.busy.eraseAnalysisRunning, 409);
      if (discoveryRunning(this.store))
        throw new AppError((m) => m.storage.erase.busy, 409);
    }
    const result = await cleanup.eraseAll(this.context, confirm);
    resetDiscovery(this.store);
    return result;
  }

  /** Disk use per project and run (cleanup.ts), cached for a minute unless `refresh`. */
  async storage(options: { refresh?: boolean } = {}) {
    return cleanup.storageReport(this.context, options);
  }

  async shutdown() {
    this.stopping = true;
    clearInterval(this.retentionTimer);
    deactivateAppSettings(this.appSettings);
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
    // Later entries of this process go to stderr, not this data directory.
    closeLog(this.store.directory);
  }
}
