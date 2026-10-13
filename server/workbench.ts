import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { command, agentEnvironment, redact } from "./process.js";
import { parseGitHubSource, readDiff, synchronizeReview } from "./git.js";
import { claimReadyTasks, type TeamAgentRunner } from "./team.js";
import { removeTaskWorktree } from "./team-workspace.js";
import { maxPlanRevisions } from "../shared/team.js";
import {
  conversationContentLimit,
  conversationMessageLimit,
  type ChatMessage,
} from "../shared/chat.js";
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
  type DiffFile,
  type Repository,
  type Run,
  type RunLogEntry,
} from "./types.js";
import { getModelCatalog, resolveModelExecution } from "./models.js";
import { agentLoginCheck, type TransientSleep } from "./agent-cli.js";
import type { AgentProvider } from "../shared/models.js";
import {
  explanationBatches,
  explanationJsonSchema,
  explanationPrompt,
  guidePrompt,
  parseExplanations,
  synchronizeExplanations,
} from "./explanations.js";

import { collectDraftContext } from "./draft-sources.js";
import { parsePrFeedback, prFeedbackQuery, prNumberOf } from "./pr-feedback.js";
import {
  draftFingerprint,
  draftJsonSchema,
  draftPrompt,
  parseDraftProposal,
  synchronizeDraftPreparation,
} from "./drafts.js";
import { contributionContext } from "./prompts/team.js";
import * as repositories from "./repositories.js";
import * as executor from "./run-executor.js";
import * as publishing from "./publish.js";

const now = () => new Date().toISOString();
const newId = () => randomUUID();
/** Statuses whose diff is final enough to explain, discuss and annotate. */
const readableStatuses: Run["status"][] = [
  "review",
  "approved",
  "published",
  "failed",
  "cancelled",
];

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
  /** PR draft preparation in progress, by run id. */
  draftJobs: Map<string, Promise<void>>;
  dependencies: {
    /** Agent CLI invocations only; Git and gh keep using the real command. */
    command?: typeof command;
    /** Answers agent turns in place of the CLI, as tests do. */
    agentRunner?: TeamAgentRunner;
    /** Wait between retries of a turn that lost the OAuth refresh race. */
    sleep?: TransientSleep;
  };
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
    options: {
      refresh?: boolean;
      automatic?: boolean;
      startingDraft?: Run["draft"];
    },
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
  private readonly context: WorkbenchContext;
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
    } = {},
  ) {
    this.agentSlots =
      dependencies.agentSlots ?? new AgentSlots(defaultAgentProcessLimit);
    this.maxActiveRuns = dependencies.maxActiveRuns ?? defaultActiveRunLimit;
    this.agentTimeoutScale =
      dependencies.agentTimeoutScale ?? defaultAgentTimeoutScale;
    if (!Number.isInteger(this.maxActiveRuns) || this.maxActiveRuns < 1)
      throw new Error("Workbench maxActiveRuns must be a positive integer.");
    // Callbacks go through `this` so a replaced method (as tests do) applies.
    this.context = {
      store: this.store,
      agentSlots: this.agentSlots,
      agentTimeoutScale: this.agentTimeoutScale,
      controllers: this.controllers,
      draftJobs: this.draftJobs,
      dependencies: {
        command: dependencies.command,
        agentRunner,
        sleep: dependencies.sleep,
      },
      log: executor.appendRunLog,
      run: (id) => this.run(id),
      repo: (id) => this.repo(id),
      lock: (id, task) => this.lock(id, task),
      diff: (id) => this.diff(id),
      explanations: (id) => this.explanations(id),
      prepareRunDraft: (id, options) => this.prepareRunDraft(id, options),
    };
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
    if (!repo) throw new AppError("找不到 Repository。", 404);
    return repo;
  }

  run(id: string) {
    const run = this.store.data.runs.find((value) => value.id === id);
    if (!run) throw new AppError("找不到工作。", 404);
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
        throw new AppError(
          "尚未安裝 Claude Code CLI。請先安裝並執行 claude auth login。",
          503,
        );
      if (!capability.claudeAuthenticated)
        throw new AppError(
          "Claude Code 尚未登入。請先在終端機執行 claude auth login。",
          503,
        );
    } else {
      if (!capability.codex)
        throw new AppError(
          "尚未安裝 Codex CLI。請先安裝並執行 codex login。",
          503,
        );
      if (!capability.codexAuthenticated)
        throw new AppError("Codex 尚未登入。請先在終端機執行 codex login。", 503);
    }
    this.assertQueueCapacity();
    const id = newId();
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
      agents: [
        {
          id: "lead",
          name: "Atlas",
          role: "Team lead",
          status: "waiting",
          detail: "分析專案與拆解需求",
        },
        {
          id: "reviewer",
          name: "Lens",
          role: "Reviewer",
          status: "waiting",
          detail: "獨立審查正確性與維護性",
        },
        {
          id: "tester",
          name: "Scout",
          role: "Test analyst",
          status: "waiting",
          detail: "檢查測試證據與回歸風險",
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
        `最多可同時排入 ${this.maxQueuedRuns} 個工作；請等待現有工作完成。`,
        429,
      );
  }

  private drain() {
    if (this.stopping) return;
    while (this.active < this.maxActiveRuns && this.queue.length) {
      const id = this.queue.shift()!;
      if (this.run(id).status !== "queued") continue;
      this.active++;
      const job = executor
        .executeRun(this.context, id)
        .catch((error) => {
          console.error(
            `[BELL-PR] run ${id} could not persist final state:`,
            redact(
              error instanceof Error
                ? (error.stack ?? error.message)
                : String(error),
            ),
          );
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
        throw new AppError("團隊已停止工作，請使用程式碼追問功能。", 409);
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
        throw new AppError("目前沒有等待核准的團隊計畫。", 409);
      run.team.approvedAt = now();
      run.team.phase = "developing";
      run.status = "queued";
      this.log(run, "user", "已核准任務分工與檔案範圍，團隊進入開發佇列。");
      await this.store.save();
      this.queue.push(id);
      this.drain();
      return run;
    });
  }

  /**
  /**
   * Sends back to the lead a plan the person did not approve. The planning
   * branch of execute() runs again with the feedback attached; there is no
   * second planning path. Messages queued to tasks of the old plan stay in the
   * inbox under their old task ids and are not forwarded.
   */
  async revisePlan(id: string, feedback: string) {
    return this.lock(id, async () => {
      const run = this.run(id);
      const team = run.team;
      if (run.status !== "awaiting_plan" || !team?.tasks.length)
        throw new AppError("目前沒有等待核准的團隊計畫。", 409);
      const content = redact(feedback.trim());
      if (!content || content.length > 4000)
        throw new AppError("退回意見必須介於 1 至 4000 字。", 400);
      const revisions = (team.planRevisions ??= []);
      if (revisions.length >= maxPlanRevisions)
        throw new AppError(
          `已重擬 ${maxPlanRevisions} 次，請核准目前計畫，或取消後調整需求再建立新工作。`,
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
        `已退回計畫並補充意見（第 ${revisions.length}/${maxPlanRevisions} 次），Lead 將依意見重新規劃。`,
      );
      await this.store.save();
      this.queue.push(id);
      this.drain();
      return run;
    });
  }

  /**
   * Resumes a failed or cancelled team run instead of starting over: completed
   * tasks keep their integrated patches, failed and blocked tasks start again
   * from a fresh snapshot, and a run whose tasks are all complete only re-runs
   * integration and review. An unapproved plan returns to the approval step so
   * cancelling during approval cannot be used to skip it.
   */
  async retryTeam(id: string, message?: string) {
    return this.lock(id, async () => {
      const run = this.run(id);
      const team = run.team;
      if (
        !["failed", "cancelled"].includes(run.status) ||
        !run.baseSha ||
        !team?.tasks.length
      )
        throw new AppError(
          "只有已失敗或已取消、且 Lead 已建立計畫的團隊工作可以重試。",
          409,
        );
      // A cancelled run keeps its controller until the worker has exited; the
      // controller is dropped in the same tick as a failed status, so this is
      // race-free where the job set (cleared later) is not.
      if (this.controllers.has(id))
        throw new AppError("此工作仍在收尾，請稍後再重試。", 409);
      this.assertQueueCapacity();
      const retried = team.tasks.filter(
        (task) => task.status === "failed" || task.status === "blocked",
      );
      const kept = team.tasks.filter((task) => task.status === "complete");
      // The same path is reused by the next attempt, so the old checkout has to
      // go first; its unintegrated edits are discarded with it.
      for (const task of retried)
        await this.lock(`repository:${run.repoId}`, () =>
          removeTaskWorktree(run, task),
        );
      for (const task of retried) {
        task.status = "pending";
        delete task.worktreePath;
        delete task.worktreeRemoved;
        delete task.baseSha;
        delete task.report;
        delete task.startedAt;
        delete task.completedAt;
        delete task.acceptsMessages;
        delete run.reports?.[task.id];
        const member = run.agents.find((agent) => agent.id === task.owner);
        if (member) {
          member.status = "waiting";
          member.detail = "等待重新認領任務，使用新的獨立工作目錄";
        }
      }
      claimReadyTasks(team.tasks, 0); // Recompute ready/pending without claiming.
      delete run.error;
      if (message) {
        // sendTeamMessage stays closed for finished runs; the retry itself is
        // the only way to brief the restarted tasks (or the lead when none).
        // Queued before the approval check so a briefing is never dropped.
        if (retried.length)
          for (const task of retried)
            executor.queueTeamMessage(
              this.context,
              run,
              "user",
              task.id,
              message,
            );
        else
          executor.queueTeamMessage(this.context, run, "user", "lead", message);
      }
      if (team.config.requirePlanApproval && !team.approvedAt) {
        team.phase = "awaiting_approval";
        run.status = "awaiting_plan";
        this.log(run, "user", "要求重試；計畫尚未核准，先回到等待核准。");
        await this.store.save();
        return run;
      }
      team.phase = "developing";
      run.status = "queued";
      this.log(
        run,
        "user",
        retried.length
          ? `重試失敗的子任務：${kept.length} 個已完成任務不重跑，${retried.length} 個任務以新快照重新開始。`
          : kept.length === team.tasks.length
            ? "重試：所有子任務都已完成，直接重跑整合與獨立審查。"
            : "重試：繼續執行尚未開始的子任務。",
      );
      await this.store.save();
      this.queue.push(id);
      this.drain();
      return run;
    });
  }

  async cancel(id: string) {
    const run = this.run(id);
    const rerun = this.reviewJobs.get(id);
    if (rerun) {
      // Stopping a re-review only aborts the reviewers; the run keeps its status.
      this.controllers.get(id)?.abort();
      await Promise.allSettled([rerun]);
      return run;
    }
    if (!["queued", "running", "awaiting_plan"].includes(run.status))
      throw new AppError("只有排隊、等待計畫核准或執行中的工作可取消。", 409);
    this.controllers.get(id)?.abort();
    run.status = "cancelled";
    if (run.team) run.team.phase = "cancelled";
    this.log(
      run,
      "system",
      "已要求取消；失敗或取消任務的隔離工作目錄保留，已整合任務的目錄已自動移除。可用「重試失敗的子任務」接續。",
    );
    await this.store.save();
    // Do not hold a run/repository/integration lock here: workers must finish
    // their cleanup and persist final task states before the HTTP response.
    // Queued or already-paused plans have no active work to wait for.
    await Promise.allSettled([...(this.runJobs.get(id) ?? [])]);
    return run;
  }

  /**
   * Re-reviews whatever is in the worktree now, so a learner who edited files
   * by hand gets an independent opinion. Reports are advice: status, per-file
   * reviews and approval are left exactly as they were. Resolves once the job
   * is started; the reports arrive through the normal run polling.
   */
  async rerunReview(id: string) {
    if (this.stopping) throw new AppError("服務正在關閉，請稍後重試。", 503);
    const run = this.run(id);
    if (!["review", "approved"].includes(run.status) || run.publishing)
      throw new AppError("只有審閱中或已核准的工作可以重新執行審查。", 409);
    if (this.reviewJobs.has(id) || this.controllers.has(id))
      throw new AppError("這個工作的審查正在重新執行，請等待完成或先停止。", 409);
    // Registering the controller first makes a concurrent request a 409 and
    // lets 停止 abort the reviewers through the usual run-level controller.
    const controller = new AbortController();
    this.controllers.set(id, controller);
    let files: Awaited<ReturnType<typeof readDiff>>;
    try {
      files = await this.lock(id, () => this.diff(id));
      if (!files.length)
        throw new AppError("目前沒有程式碼差異可供審查。", 422);
    } catch (error) {
      this.controllers.delete(id);
      throw error;
    }
    const reviewers = run.agents.filter(
      (agent) => agent.id === "reviewer" || agent.id === "tester",
    );
    for (const agent of reviewers) {
      agent.status = "running";
      agent.detail = "等待重新審查…";
    }
    this.log(
      run,
      "user",
      `要求依目前工作目錄的 ${files.length} 個變更檔案重新執行獨立審查。`,
    );
    const job = (async () => {
      try {
        await executor.runIndependentReview(
          this.context,
          run,
          files,
          run.reports?.implementer,
          controller.signal,
        );
        this.log(
          run,
          "system",
          "獨立審查已更新；報告是建議，審閱狀態與核准不變。",
        );
      } catch (error) {
        for (const agent of reviewers)
          if (agent.status === "running") {
            agent.status = "failed";
            agent.detail = "執行中斷或失敗";
          }
        this.log(
          run,
          "system",
          controller.signal.aborted
            ? "已停止重新審查；原有報告與審閱狀態保留。"
            : redact(
                error instanceof Error ? error.message : "重新審查未完成。",
              ),
        );
      } finally {
        if (this.controllers.get(id) === controller)
          this.controllers.delete(id);
        this.reviewJobs.delete(id);
        await this.store.save();
      }
    })().finally(() => {
      this.jobs.delete(job);
    });
    this.reviewJobs.set(id, job);
    this.jobs.add(job);
    await this.store.save();
    return run;
  }

  async diff(id: string) {
    const run = this.run(id);
    const files = await readDiff(run);
    synchronizeExplanations(run, files);
    synchronizeDraftPreparation(run, files);
    if (run.status !== "published") {
      synchronizeReview(run, files);
    }
    await this.store.save();
    return files;
  }

  async explanations(
    id: string,
    options: { retry?: boolean; filePath?: string } = {},
  ) {
    if (this.stopping) throw new AppError("服務正在關閉，請稍後重試。", 503);
    const run = this.run(id);
    if (!readableStatuses.includes(run.status) || run.publishing)
      throw new AppError("請等待開發完成後再產生變更解說。", 409);
    const files = await this.lock(id, () => this.diff(id));
    if (this.stopping) throw new AppError("服務正在關閉，請稍後重試。", 503);
    if (
      options.filePath &&
      !files.some((file) => file.path === options.filePath)
    )
      throw new AppError("找不到此差異檔案。", 404);
    const existing = this.explanationJobs.get(id);
    if (existing) await existing;
    else {
      const selected = files.filter((file) => {
        if (options.filePath && options.filePath !== file.path) return false;
        return (
          file.explanationStatus === "pending" ||
          (options.retry && file.explanationStatus === "failed")
        );
      });
      if (selected.length) {
        const job = this.generateExplanations(run, selected).finally(() => {
          this.explanationJobs.delete(id);
          this.jobs.delete(job);
        });
        this.explanationJobs.set(id, job);
        this.jobs.add(job);
        await job;
      }
    }
    return { run, files: await this.lock(id, () => this.diff(id)) };
  }

  private async generateExplanations(
    run: Run,
    files: Awaited<ReturnType<typeof readDiff>>,
  ) {
    const controller = new AbortController();
    const key = `explanations:${run.id}`;
    this.controllers.set(key, controller);
    const fail = (batch: typeof files, error: unknown) => {
      const message = controller.signal.aborted
        ? "解說產生已中斷；已完成的程式碼變更仍保留，可重試解說。"
        : redact(
            error instanceof Error
              ? error.message
              : "變更解說產生失敗，請重試。",
          );
      for (const file of batch) {
        const stored = run.explanations?.[file.path];
        if (
          stored?.fingerprint === file.fingerprint &&
          stored.status === "generating"
        )
          run.explanations![file.path] = {
            ...stored,
            status: "failed",
            error: message,
          };
      }
      this.log(run, "explanations", message);
    };
    for (const file of files) {
      const stored = run.explanations![file.path];
      run.explanations![file.path] = {
        ...(stored?.fingerprint === file.fingerprint ? stored : {}),
        fingerprint: file.fingerprint,
        status: "generating",
      };
      delete run.explanations![file.path].error;
    }
    let temporary: string | undefined;
    try {
      await this.store.save();
      if (controller.signal.aborted)
        throw new AppError("解說產生已取消。", 409);
      temporary = await mkdtemp(path.join(os.tmpdir(), "bell-explanations-"));
      const outputSchema = path.join(temporary, "response-schema.json");
      await writeFile(outputSchema, JSON.stringify(explanationJsonSchema), {
        mode: 0o600,
      });
      for (const batch of explanationBatches(files)) {
        if (controller.signal.aborted)
          throw new AppError("解說產生已取消。", 409);
        try {
          const answer = await executor.runAgent(
            this.context,
            run,
            "explanations",
            explanationPrompt(
              batch,
              `${run.title}\n${contributionContext(run)}`,
            ),
            controller.signal,
            true,
            {
              cwd: temporary,
              outputSchema,
              isolated: true,
              timeout: "explanations",
            },
          );
          const generated = parseExplanations(answer, batch);
          const current = new Map(
            (await readDiff(run)).map((file) => [file.path, file]),
          );
          for (const entry of generated) {
            const file = batch.find((file) => file.path === entry.path)!;
            if (
              current.get(file.path)?.fingerprint !== file.fingerprint ||
              current.get(file.path)?.blocked
            )
              continue;
            const { path: _path, ...content } = entry;
            run.explanations![file.path] = {
              fingerprint: file.fingerprint,
              status: "ready",
              content,
              generatedAt: now(),
            };
          }
        } catch (error) {
          fail(batch, error);
        }
        await this.store.save();
      }
    } catch (error) {
      fail(files, error);
    } finally {
      if (this.controllers.get(key) === controller)
        this.controllers.delete(key);
      if (temporary) await rm(temporary, { recursive: true, force: true });
      await this.store.save();
    }
  }

  async prepareDraft(id: string, options: { refresh?: boolean } = {}) {
    return this.prepareRunDraft(id, options);
  }

  private async prepareRunDraft(
    id: string,
    options: {
      refresh?: boolean;
      automatic?: boolean;
      startingDraft?: Run["draft"];
    } = {},
  ) {
    if (this.stopping) throw new AppError("服務正在關閉，請稍後重試。", 503);
    let pending: Promise<void> | undefined;
    await this.lock(id, async () => {
      if (this.stopping) throw new AppError("服務正在關閉，請稍後重試。", 503);
      const run = this.run(id);
      this.editable(run);
      const files = await this.diff(id);
      if (this.stopping) throw new AppError("服務正在關閉，請稍後重試。", 503);
      pending = this.draftJobs.get(id);
      if (pending) return;
      if (
        !options.refresh &&
        run.draftPreparation?.status === "ready" &&
        run.draftPreparation.fingerprint === draftFingerprint(run, files)
      )
        return;
      const job = this.generateDraft(
        run,
        files,
        !!options.automatic,
        options.startingDraft,
      ).finally(() => {
        this.draftJobs.delete(id);
        this.jobs.delete(job);
      });
      pending = job;
      this.draftJobs.set(id, job);
      this.jobs.add(job);
    });
    await pending;
    return { run: this.run(id) };
  }

  private async generateDraft(
    run: Run,
    files: Awaited<ReturnType<typeof readDiff>>,
    automatic: boolean,
    initialDraft?: Run["draft"],
  ) {
    const controller = new AbortController();
    const key = `draft:${run.id}`;
    this.controllers.set(key, controller);
    const fingerprint = draftFingerprint(run, files);
    const startingDraft = initialDraft ?? { ...run.draft };
    const preparation: NonNullable<Run["draftPreparation"]> = {
      ...(run.draftPreparation?.fingerprint === fingerprint
        ? run.draftPreparation
        : {}),
      status: "generating",
      fingerprint,
    };
    delete preparation.error;
    run.draftPreparation = preparation;
    let temporary: string | undefined;
    try {
      await this.store.save();
      if (controller.signal.aborted)
        throw new AppError("PR 草稿產生已取消。", 409);
      preparation.context = await (
        this.dependencies.collectDraftContext ?? collectDraftContext
      )(this.repo(run.repoId), run, { signal: controller.signal });
      if (controller.signal.aborted)
        throw new AppError("PR 草稿產生已取消。", 409);
      const prompt = draftPrompt(run, files, preparation.context);
      temporary = await mkdtemp(path.join(os.tmpdir(), "bell-draft-"));
      const outputSchema = path.join(temporary, "response-schema.json");
      await writeFile(outputSchema, JSON.stringify(draftJsonSchema), {
        mode: 0o600,
      });
      await this.store.save();
      const answer = await executor.runAgent(
        this.context,
        run,
        "draft",
        prompt,
        controller.signal,
        true,
        { cwd: temporary, outputSchema, isolated: true, timeout: "draft" },
      );
      const proposal = parseDraftProposal(answer, preparation.context);
      await this.lock(run.id, async () => {
        const currentFiles = await readDiff(run);
        if (fingerprint !== draftFingerprint(run, currentFiles)) {
          preparation.status = "stale";
          preparation.error =
            "程式碼差異已更新；請重新產生符合目前變更的 PR 草稿建議。";
          return;
        }
        preparation.status = "ready";
        preparation.proposal = proposal;
        preparation.generatedAt = now();
        if (
          automatic &&
          run.status === "review" &&
          !run.publishing &&
          !run.approvedFingerprint &&
          run.draft.title === startingDraft.title &&
          run.draft.body === startingDraft.body
        ) {
          // A message the person already wrote wins over the suggestion.
          const commitMessage =
            run.draft.commitMessage?.trim() ||
            proposal.commitMessageSuggestion?.message;
          run.draft = {
            title: proposal.title,
            body: proposal.body,
            ...(commitMessage ? { commitMessage } : {}),
            ...(run.draft.publishBranch
              ? { publishBranch: run.draft.publishBranch }
              : {}),
          };
          this.log(
            run,
            "draft",
            "已把 PR 草稿建議放進編輯區。這是模型寫的原文，送出前請用自己的話確認內容，並處理核對清單與勾選項目。",
          );
        } else {
          this.log(
            run,
            "draft",
            "PR 草稿建議已準備完成，現有草稿保留；可在 PR 草稿區檢視並套用。",
          );
        }
      });
    } catch (error) {
      if (preparation.status !== "stale") {
        preparation.status = "failed";
        preparation.error = controller.signal.aborted
          ? "PR 草稿建議產生已中斷；現有草稿與已完成變更仍保留，可重新產生。"
          : redact(
              error instanceof Error
                ? error.message
                : "PR 草稿建議產生失敗，請重試。",
            );
      }
      this.log(run, "draft", preparation.error ?? "PR 草稿建議未完成。");
    } finally {
      if (this.controllers.get(key) === controller)
        this.controllers.delete(key);
      if (temporary) await rm(temporary, { recursive: true, force: true });
      await this.store.save();
    }
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

  /**
   * Saves the learner's own words about one file together with the diff
   * fingerprint they described. Notes never change the review state: the
   * run status and approval stay as they are, unlike review() and draft().
   */
  async saveNote(id: string, filePath: string, text: string) {
    return this.lock(id, async () => {
      const run = this.run(id);
      if (!readableStatuses.includes(run.status))
        throw new AppError("請等待開發完成後再寫下理解。", 409);
      const file = (await this.diff(id)).find(
        (value) => value.path === filePath,
      );
      if (!file) throw new AppError("找不到此差異檔案。", 404);
      const notes = (run.notes ??= {});
      if (text.trim())
        notes[filePath] = {
          text,
          fingerprint: file.fingerprint,
          updatedAt: now(),
        };
      else delete notes[filePath];
      await this.store.save();
      return run;
    });
  }

  async chat(id: string, filePath: string, question: string) {
    return this.lock(id, async () => {
      const run = this.run(id);
      if (!readableStatuses.includes(run.status))
        throw new AppError("請等待開發完成後再追問。", 409);
      const file = (await this.diff(id)).find(
        (value) => value.path === filePath,
      );
      if (!file || file.blocked)
        throw new AppError("此檔案目前無法用於追問。", 422);
      // The run record is the only copy of the conversation: turns about an
      // older version of the file stay readable but are not fed back.
      const stored = run.conversations?.[filePath]?.messages ?? [];
      const messages = stored
        .filter((message) => message.fingerprint === file.fingerprint)
        .map(
          (message) =>
            `${message.role === "user" ? "User" : "Mentor"}: ${message.content}`,
        );
      // Only thread comments attached to this file reach the mentor.
      const feedback = (run.prFeedback?.items ?? []).filter(
        (item) => item.path === file.path,
      );
      const controller = new AbortController();
      const controllerKey = `guide:${id}`;
      this.controllers.set(controllerKey, controller);
      let answer: string;
      try {
        answer = await executor.runAgent(
          this.context,
          run,
          "guide",
          guidePrompt({
            contributionContext: contributionContext(run),
            run,
            file,
            messages,
            question,
            feedback,
          }),
          controller.signal,
        );
      } finally {
        this.controllers.delete(controllerKey);
      }
      const turn = (role: ChatMessage["role"], content: string): ChatMessage => ({
        role,
        content: redact(content).slice(0, conversationContentLimit),
        fingerprint: file.fingerprint,
      });
      run.conversations ??= {};
      run.conversations[filePath] = {
        fingerprint: file.fingerprint,
        messages: [
          ...stored,
          turn("user", question),
          turn("assistant", answer),
        ].slice(-conversationMessageLimit),
        updatedAt: now(),
      };
      await this.store.save();
      return answer;
    });
  }

  /**
   * Reads the published PR's reviews, comments, threads and CI once, on the
   * learner's request. Read-only: BELL never replies or resolves anything on
   * GitHub, and nothing polls this. The run status is unchanged.
   */
  async fetchPrFeedback(id: string) {
    return this.lock(id, async () => {
      const run = this.run(id);
      if (run.status !== "published" || !run.prUrl)
        throw new AppError("PR 尚未送出，還沒有維護者回饋可以讀取。", 409);
      const repo = this.repo(run.repoId);
      const remote = parseGitHubSource(repo.url);
      const prNumber = remote && prNumberOf(run.prUrl, remote.url);
      if (!remote || !prNumber)
        throw new AppError("PR 網址與此 Repository 不一致，無法讀取回饋。", 422);
      const result = await command(
        "gh",
        [
          "api",
          "--hostname",
          "github.com",
          "graphql",
          "-f",
          `query=${prFeedbackQuery}`,
          "-f",
          `owner=${remote.owner}`,
          "-f",
          `name=${remote.name}`,
          "-F",
          `number=${prNumber}`,
        ],
        { cwd: repo.path, timeoutMs: 20_000, maxBytes: 4_000_000 },
      );
      let response: unknown;
      try {
        response = JSON.parse(result.stdout);
      } catch {
        throw new AppError("GitHub 回應不是有效的 JSON。", 502);
      }
      run.prFeedback = parsePrFeedback(response, {
        repositoryUrl: remote.url,
        prNumber,
        fetchedAt: now(),
      });
      this.log(
        run,
        "system",
        `已讀取 PR #${prNumber} 的維護者回饋：${run.prFeedback.items.length} 則。`,
      );
      await this.store.save();
      return run;
    });
  }

  async publish(
    id: string,
    displayedFingerprint: string,
    acknowledged: string[] = [],
  ) {
    return publishing.publish(
      this.context,
      id,
      displayedFingerprint,
      acknowledged,
    );
  }

  async shutdown() {
    this.stopping = true;
    for (const id of this.queue) {
      const run = this.run(id);
      if (run.status === "queued") run.status = "cancelled";
    }
    this.queue = [];
    for (const controller of this.controllers.values()) controller.abort();
    await Promise.allSettled([...this.jobs]);
    await this.store.save();
  }
}
