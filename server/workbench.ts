import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { command, agentEnvironment, redact } from "./process.js";
import { readDiff, synchronizeReview } from "./git.js";
import { claimReadyTasks, type TeamAgentRunner } from "./team.js";
import { removeTaskWorktree } from "./team-workspace.js";
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
  type DiffFile,
  type Repository,
  type Run,
  type RunLogEntry,
} from "./types.js";
import { getModelCatalog, resolveModelExecution } from "./models.js";
import { agentLoginCheck, type TransientSleep } from "./agent-cli.js";
import type { AgentProvider } from "../shared/models.js";
import { synchronizeExplanations } from "./explanations.js";

import { collectDraftContext } from "./draft-sources.js";
import {
  draftFingerprint,
  draftJsonSchema,
  draftPrompt,
  parseDraftProposal,
  synchronizeDraftPreparation,
} from "./drafts.js";
import * as repositories from "./repositories.js";
import * as executor from "./run-executor.js";
import * as publishing from "./publish.js";
import * as learning from "./learning.js";

const now = () => new Date().toISOString();
const newId = () => randomUUID();

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
  dependencies: {
    /** Agent CLI invocations only; Git and gh keep using the real command. */
    command?: typeof command;
    /** Answers agent turns in place of the CLI, as tests do. */
    agentRunner?: TeamAgentRunner;
    /** Wait between retries of a turn that lost the OAuth refresh race. */
    sleep?: TransientSleep;
  };
  /** True once shutdown() has begun; no new background work starts. */
  stopping(): boolean;
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
      jobs: this.jobs,
      explanationJobs: this.explanationJobs,
      draftJobs: this.draftJobs,
      reviewJobs: this.reviewJobs,
      dependencies: {
        command: dependencies.command,
        agentRunner,
        sleep: dependencies.sleep,
      },
      stopping: () => this.stopping,
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

  async rerunReview(id: string) {
    return learning.rerunReview(this.context, id);
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
    return learning.explanations(this.context, id, options);
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

  async saveNote(id: string, filePath: string, text: string) {
    return learning.saveNote(this.context, id, filePath, text);
  }

  async chat(id: string, filePath: string, question: string) {
    return learning.chat(this.context, id, filePath, question);
  }

  async fetchPrFeedback(id: string) {
    return learning.fetchPrFeedback(this.context, id);
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
