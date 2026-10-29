import { command } from "./process.js";
import { legacyRunLocale, readDiff, synchronizeReview } from "./git.js";
import type { TeamAgentRunner } from "./team.js";
import type { ContributionSettings } from "../shared/insights.js";
import { Store } from "./store.js";
import {
  AgentSlots,
  defaultActiveRunLimit,
  defaultAgentProcessLimit,
} from "./agent-slots.js";
import { defaultAgentTimeoutScale } from "./agent-timeouts.js";
import { AppError, type Repository, type Run, type RunLogEntry } from "./types.js";
import { getModelCatalog } from "./models.js";
import type { TransientSleep } from "./agent-cli.js";
import type { AgentProvider } from "../shared/models.js";
import {
  activateAppSettings,
  AppSettingsService,
  deactivateAppSettings,
} from "./app-settings.js";
import { cliStatus, runDoctor, type DoctorAppInfo } from "./doctor.js";
import { analysisRunning } from "./insights.js";
import { discoveryRunning, resetDiscovery } from "./discovery.js";
import { synchronizeExplanations } from "./explanations.js";
import { sm, withLocale } from "./i18n/index.js";
import { parseLocale } from "../shared/i18n/locale.js";
import { closeLog, initLog, log } from "./log.js";
import { logged } from "./run-events.js";
import {
  activeFollowUp,
  type FollowUpStartInput,
} from "../shared/followups.js";
import * as cleanup from "./cleanup.js";
import { runJanitor } from "./janitor.js";
import { restoreAgentHead } from "./pr-branch.js";

import { collectDraftContext } from "./draft-sources.js";
import { synchronizeDraftPreparation } from "./drafts.js";
import * as repositories from "./repositories.js";
import * as executor from "./run-executor.js";
import { retryTeam } from "./team-retry.js";
import * as teamPlan from "./team-plan.js";
import { createRun, type NewRunMode, type NewRunSources } from "./new-run.js";
import { RunQueue } from "./run-queue.js";
import * as publishing from "./publish.js";
import * as learning from "./learning.js";
import * as drafting from "./draft-jobs.js";
import * as sessions from "./session-runs.js";
import * as syncing from "./sync-runs.js";
import * as followUps from "./followup-runs.js";
import * as walkthroughs from "./walkthrough-runs.js";
import * as premises from "./premise-runs.js";
import { commitDetail, listCommits } from "./commits.js";
import { splitRun } from "./split-run.js";
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
import { byHandFacade, type ByHandFacade } from "./by-hand.js";
import type { GuardOverride } from "../shared/contribution.js";
import type { SplitRequest } from "../shared/split.js";
import type { WorkbenchContext } from "./workbench-context.js";

export type { WorkbenchContext };

/** How often the retention period is applied while the server runs. */
const retentionIntervalMs = 24 * 60 * 60 * 1000;

export class Workbench {
  private controllers = new Map<string, AbortController>();
  private stopping = false;
  private jobs = new Set<Promise<void>>();
  private locks = new Map<string, Promise<unknown>>();
  private explanationJobs = new Map<string, Promise<void>>();
  private walkthroughJobs = new Map<string, Promise<void>>();
  private draftJobs = new Map<string, Promise<void>>();
  private sessionJobs = new Map<string, Promise<void>>();
  /** Learner-requested reviewer/tester reruns; one per run, aborted through controllers[run.id]. */
  private reviewJobs = new Map<string, Promise<void>>();
  private followUpJobs = new Map<string, Promise<void>>();
  private conflictJobs = new Map<string, Promise<void>>();
  /** Learn-by-hand guide turns, reviews and test runs, by `<kind>:<run id>`. */
  private byHandJobs = new Map<string, Promise<void>>();
  private byHandApi?: ByHandFacade;
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
  /** The Explain-it-back check and the per-file attempts (understanding.ts). */
  readonly understanding: UnderstandingFacade;
  /** The project's rules, GitHub facts and test reasons (contribution-facts.ts). */
  readonly contribution: ContributionFacade;
  /** Feedback tags, the practice deck, the counts and the coach debrief (learning-loop.ts). */
  readonly learningLoop: LearningLoopFacade;
  private readonly context: WorkbenchContext;
  /** Runs waiting for an active slot, and the ones executing (run-queue.ts). */
  private readonly runQueue: RunQueue;
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
      sessionJobs: this.sessionJobs,
      reviewJobs: this.reviewJobs,
      followUpJobs: this.followUpJobs,
      conflictJobs: this.conflictJobs,
      byHandJobs: this.byHandJobs,
      dependencies: {
        command: dependencies.command,
        agentRunner,
        sleep: dependencies.sleep,
        collectDraftContext: dependencies.collectDraftContext,
      },
      stopping: () => this.stopping,
      assertQueueCapacity: () => this.runQueue.assertCapacity(),
      enqueue: (id) => this.runQueue.push(id),
      log: executor.appendRunLog,
      run: (id) => this.run(id),
      repo: (id) => this.repo(id),
      lock: (id, task) => this.lock(id, task),
      diff: (id) => this.diff(id),
      explanations: (id) => this.explanations(id),
      prepareRunDraft: (id, options) => this.prepareRunDraft(id, options),
    };
    this.runQueue = new RunQueue(this.context, {
      active: () => this.maxActiveRuns,
      queued: () => this.maxQueuedRuns,
    });
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
   * Puts back the branches of agents a restart stopped, then removes crash
   * leftovers (janitor.ts), then frees the files of runs past the retention
   * period. Entries newer than `startedAt` are kept.
   */
  private async startMaintenance(startedAt: number) {
    try {
      await this.restoreInterruptedHeads();
      await runJanitor(this.context, { startedAt });
      await this.applyRetention();
    } catch (error) {
      log.warn("maintenance.failed", { error });
    }
  }

  /**
   * A writable agent the restart stopped may have committed or switched
   * branches, which its own end undoes (followup-runs.ts, sync-runs.ts):
   * the same is done here, so the kept edits can be pushed. Each run's lock
   * is taken while the Workbench is created, so a push or discard waits.
   */
  private async restoreInterruptedHeads() {
    await Promise.all(
      this.store.interruptedAgents.splice(0).map(({ runId, head, sync }) =>
        this.lock(runId, async () => {
          const run = this.run(runId);
          const moved = sync
            ? await syncing.restoreSyncHead(run, head)
            : await restoreAgentHead(run, head);
          if (!moved) return;
          log.warn("run.head_restored", { runId, head });
          await this.diff(runId);
        }).catch((error: unknown) =>
          log.warn("run.head_restore_failed", { runId, error }),
        ),
      ),
    );
  }

  /** Queues again the runs a restart left queued (run-queue.ts). */
  resume() {
    this.runQueue.resume();
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

  /** How many runs may execute at once: the app setting, else the value the Workbench was created with. */
  get maxActiveRuns() {
    return this.appSettings.get().maxActiveRuns ?? this.base.maxActiveRuns;
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

  /** Learn by hand: the person's plan, the guide and their test runs (by-hand.ts). */
  get byHand(): ByHandFacade {
    return (this.byHandApi ??= byHandFacade(this.context));
  }

  /** Reported by GET /api/status so the settings page can show the configured caps. */
  get limits() {
    return {
      maxActiveRuns: this.maxActiveRuns,
      maxAgentProcesses: this.agentSlots.limit,
      maxQueued: this.maxQueuedRuns,
    };
  }

  /** Applies saved limits: the agent process limit, then the run queue. */
  private applySettings() {
    this.agentSlots.setLimit(
      this.appSettings.get().maxAgentProcesses ?? this.base.maxAgentProcesses,
    );
    this.runQueue.drain();
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
        maxAgentProcesses: this.agentSlots.limit,
        ...options.app,
      },
    });
  }

  /** Which agent CLIs are installed and signed in, and the GitHub account (from the doctor). */
  async status() {
    return cliStatus(await this.doctor());
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

  /** Creates a run and queues it (new-run.ts); `mode` makes it a Learn-by-hand run. */
  async createRun(
    repoId: string,
    prompt: string,
    title?: string,
    settings?: ContributionSettings,
    mode: NewRunMode = {},
  ) {
    // Through `this`, so a replaced method (as tests do) applies.
    const sources: NewRunSources = {
      models: (provider) => this.models(provider),
      status: () => this.status(),
    };
    return createRun(this.context, sources, repoId, prompt, title, settings, mode);
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
    return teamPlan.sendTeamMessage(this.context, id, input);
  }

  async approvePlan(id: string) {
    return teamPlan.approvePlan(this.context, id);
  }

  /** Sends a plan back to the lead with the person's feedback (team-plan.ts). */
  async revisePlan(id: string, feedback: string) {
    return teamPlan.revisePlan(this.context, id, feedback);
  }

  async retryTeam(id: string, message?: string) {
    return retryTeam(this.context, id, message);
  }

  async startSession(id: string, content: string) {
    return sessions.startSession(this.context, id, content);
  }

  async cancelSession(id: string) {
    return sessions.cancelSession(this.context, id);
  }

  async cancel(id: string) {
    const run = this.run(id);
    if (this.sessionJobs.has(id)) return this.cancelSession(id);
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
    // Stop ends a Learn-by-hand guide turn, review or test run; the run keeps its status.
    const byHand = ["guide", "review", "tests"].map((kind) => `${kind}:${id}`);
    const jobs = byHand.flatMap((key) => this.byHandJobs.get(key) ?? []);
    if (jobs.length) {
      for (const key of byHand) this.controllers.get(key)?.abort();
      await Promise.allSettled(jobs);
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
    await this.runQueue.settled(id);
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

  /** Splits a contribution into separate ones (split-run.ts). */
  async split(id: string, input: SplitRequest) {
    return splitRun(this.context, id, input);
  }

  /** The commits on a published contribution's branch, oldest first (commits.ts). */
  async commits(id: string) {
    const run = this.run(id);
    cleanup.assertWorkspacePresent(run);
    return listCommits(run);
  }

  /** What one of those commits changed, with the review screen's protections. */
  async commit(id: string, sha: string) {
    const run = this.run(id);
    cleanup.assertWorkspacePresent(run);
    return commitDetail(run, sha);
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
   * (only `issue-has-pr`), recorded on the run; `rulesDigest` binds the
   * quoted confirm's tick to the words read.
   */
  async publish(
    id: string,
    displayedFingerprint: string,
    acknowledged: string[] = [],
    overrides: Pick<GuardOverride, "id" | "reason">[] = [],
    rulesDigest?: string,
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
          rulesDigest,
        ),
    );
  }

  /** Preserves a failed pre-push commit and returns its contribution to review. */
  async recoverPublish(id: string, commit: string) {
    return publishing.recoverPublish(this.context, id, commit);
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
    this.runQueue.clear();
    for (const controller of this.controllers.values()) controller.abort();
    await Promise.allSettled([...this.jobs, ...this.byHandJobs.values(), this.maintenance]);
    await this.store.save();
    // Later entries of this process go to stderr, not this data directory.
    closeLog(this.store.directory);
  }
}
