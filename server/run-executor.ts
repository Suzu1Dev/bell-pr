/**
 * Runs a contribution for the Workbench queue: one agent CLI turn
 * (runAgent), the run log, team messages, and the team phases in order:
 * the lead's plan, the members in their own worktrees, integration, and the
 * independent reviewer and test analyst. retryTeam resumes a failed or
 * cancelled run from its task board.
 */
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { command, git, agentEnvironment, redact } from "./process.js";
import { readDiff } from "./git.js";
import {
  claimReadyTasks,
  consumeTeamInbox,
  hasTeamInbox,
  memberReportJsonSchema,
  parseMemberResult,
  parseTeamPlan,
  reviewDiffContext,
  teamPlanJsonSchema,
} from "./team.js";
import {
  createTeamSnapshot,
  integrateTeamTask,
  removeTaskWorktree,
} from "./team-workspace.js";
import {
  maxTeamTaskChecks,
  type TeamCheck,
  type TeamTask,
} from "../shared/team.js";
import { defaultPonytailMode } from "../shared/efficiency.js";
import { addEfficiency, applyPonytail, trackEfficiency } from "./efficiency.js";
import {
  type AgentTimeoutKind,
  agentTimeoutMs,
  describeAgentTimeout,
  hasExtendedAgentTimeout,
  withAgentTimeoutHint,
} from "./agent-timeouts.js";
import { AppError, type Run, type RunLogEntry } from "./types.js";
import {
  agentCommand,
  agentEventReader,
  agentLabel,
  applyReportedModel,
  retryTransientAuth,
} from "./agent-cli.js";
import { draftFingerprint } from "./drafts.js";
import { createRunWorktree } from "./repositories.js";
import {
  coordinationPrompt,
  independentReviewContext,
  integrationPrompt,
  leadPlanPrompt,
  memberPrompt,
  memberTurnPrompt,
  reviewerPrompt,
  teamBoundaries,
  testerPrompt,
  webBoundaries,
} from "./prompts/team.js";
import type { WorkbenchContext } from "./workbench.js";

const now = () => new Date().toISOString();
const newId = () => randomUUID();

/** kind is omitted for plain messages so saved logs keep the shape older entries have. */
export function appendRunLog(
  run: Run,
  agent: string,
  message: string,
  entry: Pick<RunLogEntry, "kind" | "detail"> = {},
) {
  run.logs.push({
    time: now(),
    agent,
    message: redact(message).slice(0, 1600),
    ...(entry.kind && entry.kind !== "message" ? { kind: entry.kind } : {}),
    ...(entry.detail ? { detail: redact(entry.detail).slice(0, 300) } : {}),
  });
  if (run.logs.length > 250) run.logs.splice(0, run.logs.length - 250);
}

export async function runAgent(
  ctx: WorkbenchContext,
  run: Run,
  role: string,
  prompt: string,
  signal: AbortSignal,
  readonly = true,
  context: {
    cwd?: string;
    taskId?: string;
    outputSchema?: string;
    isolated?: boolean;
    /** Receives each command the CLI reports, up to maxTeamTaskChecks entries. */
    checks?: TeamCheck[];
    /** Named budget for isolated roles; other turns use the read or write budget. */
    timeout?: Extract<AgentTimeoutKind, "explanations" | "draft">;
  } = {},
) {
  const modelExecution = run.modelExecution ?? {
    source: "cli-default" as const,
  };
  const label = agentLabel(modelExecution.provider);
  const agent = run.agents.find((value) => value.id === role);
  if (agent) {
    agent.status = "running";
    agent.detail = `正在執行 ${label}…`;
  }
  const inbox =
    run.team && !context.isolated
      ? consumeTeamInbox(run.team, role, context.taskId)
      : [];
  const mode = run.contributionSettings?.ponytailMode ?? defaultPonytailMode;
  // Isolated roles (explanations, PR draft) only read BELL-supplied diffs and stay offline.
  const web = modelExecution.webAccess === true && !context.isolated;
  const inboxPrompt = inbox.length
    ? `${prompt}\nTeam inbox delivered at this turn boundary (messages are context, not permission to violate file ownership or the task boundaries):\n${JSON.stringify(inbox)}`
    : prompt;
  const fullPrompt = applyPonytail(
    web ? `${inboxPrompt}\n${webBoundaries}` : inboxPrompt,
    mode,
    role,
    readonly,
  );
  const timeoutMs = agentTimeoutMs(
    context.timeout ?? (readonly ? "read" : "write"),
    modelExecution,
    ctx.agentTimeoutScale,
  );
  ctx.log(
    run,
    role,
    `${agent?.name ?? "Guide"} 開始工作。模型：${modelExecution.model ?? `${label} CLI 預設（未記錄模型）`}；推理：${modelExecution.reasoningEffort ?? "模型預設"}${web ? "；已允許上網" : ""}${hasExtendedAgentTimeout(modelExecution) ? `；${describeAgentTimeout(timeoutMs)}` : ""}。${inbox.length ? ` 已在回合起點收到 ${inbox.length} 則團隊訊息。` : ""}`,
    { kind: "status" },
  );
  let efficiency: ReturnType<typeof trackEfficiency> | undefined;
  /** Each CLI invocation is one call; a retried attempt is recorded as failed before the wait. */
  const recordEfficiency = (done: boolean) => {
    if (!efficiency) return;
    run.efficiency = addEfficiency(
      run.efficiency,
      efficiency.finish(done),
      role,
    );
    efficiency = undefined;
  };
  const answerLimit = context.outputSchema ? 80_000 : 24_000;
  const cwd = context.cwd ?? run.worktreePath;
  const execute = ctx.dependencies.command ?? command;
  let completed = false;
  let answer = "";
  let terminalFailure: string | undefined;
  let retryable = false;
  let lastSave = 0;
  /** One invocation. The slot is held only while the process runs, never across a retry wait. */
  const invoke = async () => {
    answer = "";
    terminalFailure = undefined;
    retryable = false;
    if (ctx.agentSlots.active >= ctx.agentSlots.limit) {
      const waiting = `等待其他 Agent 完成（${ctx.agentSlots.waiting + 1} 個排隊中）`;
      if (agent) agent.detail = waiting;
      ctx.log(run, role, `${waiting}。`, { kind: "status" });
    }
    const releaseSlot = await ctx.agentSlots.acquire(signal);
    try {
      if (agent) agent.detail = `正在執行 ${label}…`;
      // Queue time is not agent time: measure from the moment the slot is held.
      const call = trackEfficiency(mode);
      efficiency = call;
      if (ctx.dependencies.agentRunner) {
        answer = redact(
          await ctx.dependencies.agentRunner({
            role,
            taskId: context.taskId,
            prompt: fullPrompt,
            cwd,
            readonly,
            signal,
            modelExecution,
          }),
        ).slice(0, answerLimit);
        return { retryable };
      }
      const cli = await agentCommand(modelExecution, {
        cwd,
        access: readonly ? "read" : "write",
        outputSchema: context.outputSchema,
        skipGitRepoCheck: context.isolated,
        web,
      });
      const read = agentEventReader(modelExecution.provider);
      await execute(cli.executable, cli.args, {
        input: fullPrompt,
        cwd,
        signal,
        timeoutMs,
        maxBytes: 8_000_000,
        env: agentEnvironment(),
        onLine: (line, stream) => {
          if (stream !== "stdout") return;
          try {
            const event = JSON.parse(line);
            call.observe(event);
            for (const item of read(event)) {
              // A notice (retry, rate limit, denied tool) replaces the status line until the agent is seen working again.
              if (agent && item.kind !== "notice" && item.kind !== "session" && item.kind !== "usage-by-model")
                agent.detail = `正在執行 ${label}…`;
              if (item.kind === "message" || item.kind === "final") {
                const text = redact(item.text).slice(0, answerLimit);
                // Claude Code repeats its last message as the final result; log it once.
                if (item.kind === "message" || text !== answer)
                  ctx.log(
                    run,
                    role,
                    context.isolated
                      ? "結構化結果已回傳，正在驗證來源與內容。"
                      : text,
                  );
                answer = text;
              } else if (item.kind === "command") {
                // The reader already redacted and shortened the command; the outcome is an exit code or a success/failure word.
                if (
                  item.command &&
                  context.checks &&
                  context.checks.length < maxTeamTaskChecks
                )
                  context.checks.push({
                    command: item.command,
                    outcome: item.outcome,
                  });
                ctx.log(
                  run,
                  role,
                  item.command ?? `執行檢查完成（${item.outcome}）。`,
                  { kind: "command", detail: item.outcome },
                );
              } else if (item.kind === "file-change") {
                const edited =
                  item.path && path.isAbsolute(item.path)
                    ? path.relative(cwd, item.path)
                    : item.path;
                ctx.log(
                  run,
                  role,
                  edited ? `已更新 ${edited}。` : "已更新工作目錄中的檔案。",
                  { kind: "file", detail: edited },
                );
              } else if (item.kind === "web") {
                // The reader already redacted and shortened the query or URL; page content is never logged.
                ctx.log(
                  run,
                  role,
                  `${item.action === "search" ? "搜尋網路" : "讀取網頁"}：${item.detail}`,
                  { kind: "status", detail: item.detail },
                );
              } else if (item.kind === "notice") {
                // Retries, rate limits and denied tools are visible before the timeout, not failures.
                const notice = redact(item.message);
                if (agent) agent.detail = notice;
                ctx.log(run, role, notice, { kind: "notice" });
              } else if (
                item.kind === "session" ||
                item.kind === "usage-by-model"
              ) {
                if (
                  run.modelExecution &&
                  applyReportedModel(run.modelExecution, item)
                )
                  ctx.log(
                    run,
                    role,
                    `${label} 回報實際模型：${run.modelExecution.reported?.model}（${modelExecution.model ? `--model 傳入 ${modelExecution.model}` : "未傳入 --model"}${run.modelExecution.reported?.cliVersion ? `，CLI ${run.modelExecution.reported.cliVersion}` : ""}）。`,
                    { kind: "status" },
                  );
              } else if (item.kind === "error") {
                if (item.terminal) {
                  terminalFailure = redact(item.message);
                  retryable = item.retryable === true;
                }
                ctx.log(run, role, redact(item.message));
              }
            }
            if (Date.now() - lastSave > 1500) {
              lastSave = Date.now();
              void ctx.store.save().catch(() => undefined);
            }
          } catch {
            /* Only documented JSONL events are used; never return raw tool output. */
          }
        },
      }).catch((error: unknown) => {
        // claude exits non-zero after losing the OAuth refresh race; its result event
        // (flushed before the rejection) already classified the attempt as retryable.
        if (!retryable)
          throw withAgentTimeoutHint(error, cli.executable, timeoutMs);
      });
      return { retryable };
    } finally {
      releaseSlot();
    }
  };
  try {
    await ctx.store.save();
    await retryTransientAuth(invoke, {
      signal,
      sleep: ctx.dependencies.sleep,
      onRetry: (notice) => {
        recordEfficiency(false);
        if (agent) agent.detail = notice;
        ctx.log(run, role, notice, { kind: "notice" });
      },
    });
    if (signal.aborted) throw new AppError("工作已取消。", 409);
    if (terminalFailure) throw new AppError(terminalFailure, 422);
    if (!answer.trim())
      throw new AppError(`${label} 沒有回傳工作報告。`, 422);
    if (agent) {
      agent.status = "complete";
      agent.detail = "已完成，報告可供審閱";
    }
    if (!context.isolated) {
      run.reports ??= {};
      run.reports[role] = answer;
    }
    completed = true;
    return answer;
  } catch (error) {
    if (agent) {
      agent.status = "failed";
      agent.detail = "執行中斷或失敗";
    }
    throw error;
  } finally {
    recordEfficiency(completed);
    await ctx.store.save();
  }
}

export function queueTeamMessage(
  ctx: WorkbenchContext,
  run: Run,
  from: string,
  to: string,
  content: string,
) {
  const team = run.team;
  if (!team) throw new AppError("此工作沒有 Agent Team。", 409);
  const activeTasks = team.tasks.filter(
    (task) =>
      ["pending", "ready", "running"].includes(task.status) &&
      task.acceptsMessages !== false,
  );
  const validTargets = new Set([
    "lead",
    ...activeTasks.flatMap((task) => [task.id, task.owner]),
  ]);
  if (team.phase === "reviewing") {
    for (const id of ["reviewer", "tester"])
      if (run.agents.find((agent) => agent.id === id)?.status === "waiting")
        validTargets.add(id);
  }
  if (to !== "all" && !validTargets.has(to))
    throw new AppError(
      "此成員或任務已完成，無法再排入訊息；請傳給 Lead。",
      409,
    );
  if (!content.trim() || content.length > 4000)
    throw new AppError("團隊訊息必須介於 1 至 4000 字。", 400);
  if (team.messages.length >= 200)
    throw new AppError("此工作的團隊訊息已達 200 則上限。", 429);
  const recipients =
    to === "all"
      ? [...new Set(["lead", ...activeTasks.map((task) => task.owner)])]
      : [to];
  const message = {
    id: newId(),
    from,
    to,
    content: redact(content.trim()),
    createdAt: now(),
    status: "queued" as const,
    recipients,
    deliveredTo: [] as string[],
  };
  team.messages.push(message);
  ctx.log(run, from, `已排入給 ${to} 的團隊訊息，將在下一回合起點送達。`);
  return message;
}

/**
 * Reviewer and test analyst read the supplied diff in parallel; both
 * reports are stored by runAgent. Used after team integration and when the
 * learner re-runs the review on a hand-edited worktree.
 */
export async function runIndependentReview(
  ctx: WorkbenchContext,
  run: Run,
  files: Awaited<ReturnType<typeof readDiff>>,
  leadReport: string | undefined,
  signal: AbortSignal,
) {
  const reviewContext = independentReviewContext(run, files, leadReport);
  const results = await Promise.allSettled([
    runAgent(
      ctx,
      run,
      "reviewer",
      reviewerPrompt(reviewContext),
      signal,
    ),
    runAgent(
      ctx,
      run,
      "tester",
      testerPrompt(reviewContext, run.team),
      signal,
    ),
  ]);
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  if (signal.aborted) throw new AppError("工作已取消。", 409);
}

async function executeTeamTask(
  ctx: WorkbenchContext,
  run: Run,
  task: TeamTask,
  boundaries: string,
  reportSchema: string,
  signal: AbortSignal,
) {
  const team = run.team!;
  // A retried task keeps the previous error until its fresh first turn can
  // explain to the teammate why the earlier attempt was rejected.
  const previousFailure = task.error;
  delete task.error;
  try {
    await ctx.lock(`integration:${run.id}`, async () => {
      if (signal.aborted) throw new AppError("工作已取消。", 409);
      task.baseSha = await createTeamSnapshot(
        run,
        ctx.store.directory,
        signal,
      );
      task.worktreePath = path.join(
        ctx.store.directory,
        "team-worktrees",
        run.id,
        task.id,
      );
      await mkdir(path.dirname(task.worktreePath), {
        recursive: true,
        mode: 0o700,
      });
      await ctx.lock(`repository:${run.repoId}`, () =>
        git(
          run.worktreePath,
          ["worktree", "add", "--detach", task.worktreePath!, task.baseSha!],
          { signal },
        ),
      );
    });
    ctx.log(
      run,
      task.owner,
      `領取任務 ${task.title}；獨立工作目錄與檔案範圍已建立。`,
    );
    await ctx.store.save();
    const context = memberPrompt(boundaries, run, team, task);
    // Commands seen across all turns of this task; stored only when the CLI reported some.
    const checks: TeamCheck[] = task.checks ?? [];
    for (let turn = 0; turn < 3; turn++) {
      const answer = await runAgent(
        ctx,
        run,
        task.owner,
        memberTurnPrompt(context, turn, previousFailure, task.report),
        signal,
        false,
        {
          cwd: task.worktreePath,
          taskId: task.id,
          // Not isolated: the inbox and run.reports still belong to this turn.
          outputSchema: reportSchema,
          checks,
        },
      );
      if (checks.length) task.checks = checks;
      const result = parseMemberResult(answer);
      task.report = result.report;
      run.reports![task.id] = result.report;
      for (const message of result.messages) {
        try {
          queueTeamMessage(ctx, run, task.owner, message.to, message.content);
        } catch (error) {
          ctx.log(
            run,
            task.owner,
            `協調訊息未排入：${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      await ctx.store.save();
      if (!hasTeamInbox(team, task.owner, task.id)) break;
      if (turn === 2)
        ctx.log(
          run,
          task.owner,
          "已達每個任務 3 回合上限；尚未送達的訊息保留在團隊收件匣，交由 Lead 在整合時檢視。",
        );
    }
    task.acceptsMessages = false;
    if (signal.aborted) throw new AppError("工作已取消。", 409);
    const integrated = await ctx.lock(`integration:${run.id}`, () =>
      integrateTeamTask(run, task, signal),
    );
    if (signal.aborted) throw new AppError("工作已取消。", 409);
    task.status = "complete";
    task.completedAt = now();
    task.integratedFiles = integrated;
    ctx.log(
      run,
      task.owner,
      `${task.title} 完成，${integrated.length} 個檔案通過範圍檢查並整合${integrated.length ? `：${integrated.join("、")}` : ""}。`,
      { kind: "file", detail: integrated.join("\n") },
    );
    // The integrated diff now lives in the run worktree; a leftover checkout
    // would only cost disk. Failed tasks keep theirs so the diff can be read.
    try {
      await ctx.lock(`repository:${run.repoId}`, () =>
        removeTaskWorktree(run, task),
      );
      ctx.log(
        run,
        "system",
        `整合後的差異已在本次工作的 worktree，${task.owner} 的獨立 checkout 已不需保留，已移除。`,
      );
    } catch (error) {
      ctx.log(
        run,
        "system",
        `無法移除 ${task.id} 的隔離工作目錄，可手動清理：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } catch (error) {
    task.status = "failed";
    task.acceptsMessages = false;
    task.error = redact(
      error instanceof Error ? error.message : "任務失敗。",
    );
    const member = run.agents.find((agent) => agent.id === task.owner);
    if (member) {
      member.status = "failed";
      member.detail = task.error;
    }
    ctx.log(run, task.owner, task.error);
    throw error;
  } finally {
    await ctx.store.save();
  }
}

async function executeTeamTasks(
  ctx: WorkbenchContext,
  run: Run,
  boundaries: string,
  reportSchema: string,
  signal: AbortSignal,
) {
  const team = run.team!;
  const running = new Map<string, Promise<void>>();
  const stopWorkers = new AbortController();
  const workerSignal = AbortSignal.any([signal, stopWorkers.signal]);
  let failure: unknown;
  while (true) {
    if (!failure && !signal.aborted) {
      const claimed = claimReadyTasks(team.tasks, team.config.maxTeammates);
      for (const task of claimed) {
        const job = executeTeamTask(
          ctx,
          run,
          task,
          boundaries,
          reportSchema,
          workerSignal,
        )
          .catch((error: unknown) => {
            failure ??= error;
            stopWorkers.abort();
          })
          .finally(() => {
            running.delete(task.id);
          });
        running.set(task.id, job);
      }
      if (claimed.length) await ctx.store.save();
    }
    if (!running.size) break;
    await Promise.race(running.values());
  }
  claimReadyTasks(team.tasks, 0); // Propagate failed dependencies without claiming new tasks.
  if (failure) throw failure;
  if (signal.aborted) throw new AppError("工作已取消。", 409);
  if (team.tasks.some((task) => task.status !== "complete"))
    throw new AppError(
      "任務依賴或檔案分工阻止團隊繼續，請檢視共享任務清單。",
      422,
    );
}

export async function executeRun(ctx: WorkbenchContext, id: string) {
  const run = ctx.run(id);
  const repo = ctx.repo(run.repoId);
  const controller = new AbortController();
  ctx.controllers.set(id, controller);
  const signal = controller.signal;
  // Output schemas live in a temporary directory, never in a task worktree
  // where they would become unassigned files and fail integration.
  let schemaDirectory: string | undefined;
  try {
    run.status = "running";
    schemaDirectory = await mkdtemp(path.join(os.tmpdir(), "bell-team-"));
    const planSchema = path.join(schemaDirectory, "plan-schema.json");
    const reportSchema = path.join(schemaDirectory, "report-schema.json");
    await writeFile(planSchema, JSON.stringify(teamPlanJsonSchema), {
      mode: 0o600,
    });
    await writeFile(reportSchema, JSON.stringify(memberReportJsonSchema), {
      mode: 0o600,
    });
    if (!run.baseSha) {
      ctx.log(run, "system", "建立獨立 Git worktree。");
      await ctx.store.save();
      await ctx.lock(`repository:${repo.id}`, () =>
        createRunWorktree(run, repo, signal),
      );
      await ctx.store.save();
    }
    const boundaries = teamBoundaries;
    const team = run.team;
    if (!team)
      throw new AppError(
        "舊工作無法重新派工，請建立新的 Agent Team 工作。",
        409,
      );
    if (!team.tasks.length) {
      team.phase = "planning";
      const revisions = team.planRevisions ?? [];
      const plan = await runAgent(
        ctx,
        run,
        "lead",
        leadPlanPrompt(
          boundaries,
          run,
          team.config.maxTeammates,
          revisions,
        ),
        signal,
        true,
        { outputSchema: planSchema },
      );
      const parsed = parseTeamPlan(plan, team.config.maxTeammates);
      team.planSummary = parsed.summary;
      team.tasks = parsed.tasks;
      if (revisions.length && parsed.revisionNotes)
        revisions[revisions.length - 1].revisionNotes = parsed.revisionNotes;
      const members = [...new Set(team.tasks.map((task) => task.owner))];
      run.agents.splice(
        1,
        0,
        ...members.map((owner, index) => ({
          id: owner,
          name: `Teammate ${index + 1}`,
          role: "Developer",
          status: "waiting" as const,
          detail: "等待認領共享任務，使用獨立工作目錄",
        })),
      );
      ctx.log(
        run,
        "lead",
        `已建立 ${team.tasks.length} 個有依賴與檔案範圍的任務，最多 ${team.config.maxTeammates} 位 teammate 同時工作。`,
      );
      if (team.config.requirePlanApproval) {
        team.phase = "awaiting_approval";
        run.status = "awaiting_plan";
        ctx.log(run, "lead", "等待你核准計畫；尚未開始修改程式碼。");
        return;
      }
      team.approvedAt = now();
    }
    team.phase = "developing";
    await ctx.store.save();
    await executeTeamTasks(ctx, run, boundaries, reportSchema, signal);
    const files = await readDiff(run);
    if (!files.length)
      throw new AppError(
        "Agent Team 沒有產生程式碼差異。請檢查任務報告或調整方向。",
        422,
      );
    team.phase = "integrating";
    // Read-only roles may have no shell (Claude read access), so the diff
    // itself travels in the prompt instead of being fetched with git.
    const diffContext = reviewDiffContext(files);
    let implementation = await runAgent(
      ctx,
      run,
      "lead",
      integrationPrompt(boundaries, run, team, diffContext),
      signal,
    );
    run.reports!.implementer = implementation;
    team.phase = "reviewing";
    await runIndependentReview(ctx, run, files, implementation, signal);
    for (let turn = 0; turn < 3 && hasTeamInbox(team, "lead"); turn++) {
      implementation = await runAgent(
        ctx,
        run,
        "lead",
        coordinationPrompt(boundaries, run, diffContext, implementation),
        signal,
      );
    }
    run.reports!.implementer = implementation;
    // The body stays empty until the draft agent proposes one: the agents'
    // reports remain on the review tab and are not a PR description.
    const automaticDraft = { ...run.draft };
    run.status = "review";
    run.draftPreparation = {
      status: "generating",
      fingerprint: draftFingerprint(run, files),
    };
    team.phase = "complete";
    ctx.log(
      run,
      "system",
      `團隊開發與獨立審查完成，共 ${files.length} 個變更檔案，等待逐檔審閱。`,
    );
    await ctx.store.save();
    // Development is complete; optional preparation failures cannot fail the run.
    await Promise.allSettled([
      ctx.explanations(id),
      ctx.prepareRunDraft(id, {
        automatic: true,
        startingDraft: automaticDraft,
      }).catch(async (error) => {
        if (
          run.draftPreparation?.status === "generating" &&
          !ctx.draftJobs.has(id)
        ) {
          run.draftPreparation.status = "failed";
          run.draftPreparation.error = redact(
            error instanceof Error
              ? error.message
              : "PR 草稿建議未完成，請重試。",
          );
          ctx.log(run, "draft", run.draftPreparation.error);
          await ctx.store.save();
        }
      }),
    ]);
  } catch (error) {
    run.status = signal.aborted ? "cancelled" : "failed";
    if (run.team) run.team.phase = run.status;
    run.error = redact(error instanceof Error ? error.message : "工作失敗。");
    ctx.log(run, "system", run.error);
    for (const agent of run.agents)
      if (agent.status === "running") agent.status = "failed";
  } finally {
    if (ctx.controllers.get(id) === controller) ctx.controllers.delete(id);
    if (schemaDirectory)
      await rm(schemaDirectory, { recursive: true, force: true }).catch(
        () => undefined,
      );
    await ctx.store.save();
  }
}

/**
 * Resumes a failed or cancelled team run instead of starting over: completed
 * tasks keep their integrated patches, failed and blocked tasks start again
 * from a fresh snapshot, and a run whose tasks are all complete only re-runs
 * integration and review. An unapproved plan returns to the approval step so
 * cancelling during approval cannot be used to skip it.
 */
export async function retryTeam(
  ctx: WorkbenchContext,
  id: string,
  message?: string,
) {
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
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
    if (ctx.controllers.has(id))
      throw new AppError("此工作仍在收尾，請稍後再重試。", 409);
    ctx.assertQueueCapacity();
    const retried = team.tasks.filter(
      (task) => task.status === "failed" || task.status === "blocked",
    );
    const kept = team.tasks.filter((task) => task.status === "complete");
    // The same path is reused by the next attempt, so the old checkout has to
    // go first; its unintegrated edits are discarded with it.
    for (const task of retried)
      await ctx.lock(`repository:${run.repoId}`, () =>
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
          queueTeamMessage(ctx, run, "user", task.id, message);
      else queueTeamMessage(ctx, run, "user", "lead", message);
    }
    if (team.config.requirePlanApproval && !team.approvedAt) {
      team.phase = "awaiting_approval";
      run.status = "awaiting_plan";
      ctx.log(run, "user", "要求重試；計畫尚未核准，先回到等待核准。");
      await ctx.store.save();
      return run;
    }
    team.phase = "developing";
    run.status = "queued";
    ctx.log(
      run,
      "user",
      retried.length
        ? `重試失敗的子任務：${kept.length} 個已完成任務不重跑，${retried.length} 個任務以新快照重新開始。`
        : kept.length === team.tasks.length
          ? "重試：所有子任務都已完成，直接重跑整合與獨立審查。"
          : "重試：繼續執行尚未開始的子任務。",
    );
    await ctx.store.save();
    ctx.enqueue(id);
    return run;
  });
}
