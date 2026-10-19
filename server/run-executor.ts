/**
 * Runs a contribution for the Workbench queue: one agent CLI turn
 * (runAgent), the run log, team messages, and the team phases in order:
 * the lead's plan, the members in their own worktrees, integration, and the
 * independent reviewer and test analyst. team-retry.ts resumes a failed or
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
import { cancelled, currentLocale, sm } from "./i18n/index.js";
import type { Locale } from "../shared/i18n/locale.js";
import {
  adoptLegacyCheckout,
  completePartialClone,
  createRunWorktree,
} from "./repositories.js";
import {
  agentSpawn,
  enterPhase,
  parseAgentOutput,
  runLifecycle,
} from "./run-events.js";
import {
  coordinationPrompt,
  independentReviewContext,
  integrationPrompt,
  leadPlanPrompt,
  memberPrompt,
  memberTurnPrompt,
  reviewerPrompt,
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
    /** Keeps this turn off the web even when the run allows web access. */
    offline?: boolean;
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
  const running = sm().run.agents.running({ cli: label });
  if (agent) {
    agent.status = "running";
    agent.detail = running;
  }
  const inbox =
    run.team && !context.isolated
      ? consumeTeamInbox(run.team, role, context.taskId)
      : [];
  const mode = run.contributionSettings?.ponytailMode ?? defaultPonytailMode;
  // Isolated roles (explanations, PR draft) only read BELL-supplied diffs and stay offline.
  const web =
    modelExecution.webAccess === true && !context.isolated && !context.offline;
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
    sm().run.team.started({
      name: agent?.name ?? "Guide",
      cli: label,
      model: modelExecution.model,
      effort: modelExecution.reasoningEffort,
      web,
      timeout: hasExtendedAgentTimeout(modelExecution)
        ? describeAgentTimeout(timeoutMs)
        : undefined,
      inbox: inbox.length,
    }),
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
      const queued = ctx.agentSlots.waiting + 1;
      if (agent) agent.detail = sm().run.agents.waitingForSlot({ queued });
      ctx.log(run, role, sm().run.team.waitingForSlot({ queued }), {
        kind: "status",
      });
    }
    const releaseSlot = await ctx.agentSlots.acquire(signal);
    try {
      if (agent) agent.detail = running;
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
      // Marks the run once when an agent runs without the OS sandbox
      // because the person allowed it in Settings (agentCommand decides).
      if (cli.unsandboxed && !run.unsandboxed) {
        run.unsandboxed = true;
        ctx.log(run, role, sm().run.unsandboxedNotice, { kind: "notice" });
      }
      const read = agentEventReader(modelExecution.provider);
      const spawned = agentSpawn(run, role, cli.executable, timeoutMs);
      await execute(cli.executable, cli.args, {
        input: fullPrompt,
        cwd,
        signal,
        timeoutMs,
        maxBytes: 8_000_000,
        env: agentEnvironment(modelExecution.provider ?? "codex"),
        onLine: (line, stream) => {
          if (stream !== "stdout") return;
          try {
            const event = JSON.parse(line);
            call.observe(event);
            for (const item of read(event)) {
              // A notice (retry, rate limit, denied tool) replaces the status line until the agent is seen working again.
              if (agent && item.kind !== "notice" && item.kind !== "session" && item.kind !== "usage-by-model")
                agent.detail = running;
              if (item.kind === "message" || item.kind === "final") {
                const text = redact(item.text).slice(0, answerLimit);
                // Claude Code repeats its last message as the final result; log it once.
                if (item.kind === "message" || text !== answer)
                  ctx.log(
                    run,
                    role,
                    context.isolated
                      ? sm().run.team.structuredResult
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
                  item.command ??
                    sm().run.team.checkFinished({ outcome: item.outcome }),
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
                  edited
                    ? sm().run.team.fileUpdated({ path: edited })
                    : sm().run.team.filesUpdated,
                  { kind: "file", detail: edited },
                );
              } else if (item.kind === "web") {
                // The reader already redacted and shortened the query or URL; page content is never logged.
                ctx.log(
                  run,
                  role,
                  item.action === "search"
                    ? sm().run.team.webSearch({ detail: item.detail })
                    : sm().run.team.webFetch({ detail: item.detail }),
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
                    sm().run.team.reportedModel({
                      cli: label,
                      model: String(run.modelExecution.reported?.model),
                      requested: modelExecution.model,
                      version: run.modelExecution.reported?.cliVersion,
                    }),
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
      }).then(spawned.exited, (error: unknown) => {
        spawned.failed(error);
        // claude exits non-zero after losing the OAuth refresh race; its result event
        // (flushed before the rejection) already classified the attempt as retryable.
        if (!retryable)
          throw withAgentTimeoutHint(
            error,
            cli.executable,
            timeoutMs,
            terminalFailure,
          );
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
    if (signal.aborted) throw new AppError(cancelled(), 409);
    if (terminalFailure) throw new AppError(terminalFailure, 422);
    if (!answer.trim())
      throw new AppError((m) => m.run.team.noReport({ cli: label }), 422);
    if (agent) {
      agent.status = "complete";
      agent.detail = sm().run.agents.complete;
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
      agent.detail = sm().run.agents.failed;
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
  if (!team) throw new AppError((m) => m.run.team.noTeam, 409);
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
    throw new AppError((m) => m.run.team.messageTargetClosed, 409);
  if (!content.trim() || content.length > 4000)
    throw new AppError((m) => m.run.team.messageLength, 400);
  if (team.messages.length >= 200)
    throw new AppError((m) => m.run.team.messageLimit, 429);
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
  ctx.log(run, from, sm().run.team.messageQueued({ to }));
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
  // Both callers run under the run's locale (withRunLocale).
  const locale = currentLocale();
  const results = await Promise.allSettled([
    runAgent(
      ctx,
      run,
      "reviewer",
      reviewerPrompt(reviewContext, locale),
      signal,
    ),
    runAgent(
      ctx,
      run,
      "tester",
      testerPrompt(reviewContext, run.team, locale),
      signal,
    ),
  ]);
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  if (signal.aborted) throw new AppError(cancelled(), 409);
}

async function executeTeamTask(
  ctx: WorkbenchContext,
  run: Run,
  task: TeamTask,
  locale: Locale,
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
      if (signal.aborted) throw new AppError(cancelled(), 409);
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
    ctx.log(run, task.owner, sm().run.team.taskClaimed({ title: task.title }));
    await ctx.store.save();
    const context = memberPrompt(locale, run, team, task);
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
      const result = parseAgentOutput(run, "member-report", () =>
        parseMemberResult(answer),
      );
      task.report = result.report;
      run.reports![task.id] = result.report;
      for (const message of result.messages) {
        try {
          queueTeamMessage(ctx, run, task.owner, message.to, message.content);
        } catch (error) {
          ctx.log(
            run,
            task.owner,
            sm().run.team.messageNotQueued({
              reason: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      }
      await ctx.store.save();
      if (!hasTeamInbox(team, task.owner, task.id)) break;
      if (turn === 2) ctx.log(run, task.owner, sm().run.team.turnLimit);
    }
    task.acceptsMessages = false;
    if (signal.aborted) throw new AppError(cancelled(), 409);
    const integrated = await ctx.lock(`integration:${run.id}`, () =>
      integrateTeamTask(run, task, signal),
    );
    if (signal.aborted) throw new AppError(cancelled(), 409);
    task.status = "complete";
    task.completedAt = now();
    task.integratedFiles = integrated;
    ctx.log(
      run,
      task.owner,
      sm().run.team.taskIntegrated({ title: task.title, files: integrated }),
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
        sm().run.team.checkoutRemoved({ owner: task.owner }),
      );
    } catch (error) {
      ctx.log(
        run,
        "system",
        sm().run.team.checkoutNotRemoved({
          task: task.id,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  } catch (error) {
    task.status = "failed";
    task.acceptsMessages = false;
    task.error = redact(
      error instanceof Error ? error.message : sm().run.team.taskFailed,
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
  locale: Locale,
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
          locale,
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
  if (signal.aborted) throw new AppError(cancelled(), 409);
  if (team.tasks.some((task) => task.status !== "complete"))
    throw new AppError((m) => m.run.team.stuck, 422);
}

export async function executeRun(ctx: WorkbenchContext, id: string) {
  const run = ctx.run(id);
  const repo = ctx.repo(run.repoId);
  const controller = new AbortController();
  ctx.controllers.set(id, controller);
  const signal = controller.signal;
  const finished = runLifecycle(run);
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
      ctx.log(run, "system", sm().run.team.creatingWorktree);
      await ctx.store.save();
      await ctx.lock(`repository:${repo.id}`, async () => {
        // A project an earlier build worked on in place moves to a clone.
        await adoptLegacyCheckout(ctx, repo, run);
        await completePartialClone(ctx, repo, signal);
        await createRunWorktree(run, repo, signal);
      });
      await ctx.store.save();
    }
    // The run's locale: the Workbench queue runs executeRun under withRunLocale.
    const locale = currentLocale();
    const team = run.team;
    if (!team) throw new AppError((m) => m.run.team.legacyRun, 409);
    if (!team.tasks.length) {
      enterPhase(run, team, "planning");
      const revisions = team.planRevisions ?? [];
      const plan = await runAgent(
        ctx,
        run,
        "lead",
        leadPlanPrompt(
          locale,
          run,
          team.config.maxTeammates,
          revisions,
        ),
        signal,
        true,
        { outputSchema: planSchema },
      );
      const parsed = parseAgentOutput(run, "team-plan", () =>
        parseTeamPlan(plan, team.config.maxTeammates),
      );
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
          detail: sm().run.agents.member,
        })),
      );
      ctx.log(
        run,
        "lead",
        sm().run.team.planCreated({
          tasks: team.tasks.length,
          max: team.config.maxTeammates,
        }),
      );
      if (team.config.requirePlanApproval) {
        enterPhase(run, team, "awaiting_approval");
        run.status = "awaiting_plan";
        ctx.log(run, "lead", sm().run.team.awaitingApproval);
        return;
      }
      team.approvedAt = now();
    }
    enterPhase(run, team, "developing");
    await ctx.store.save();
    await executeTeamTasks(ctx, run, locale, reportSchema, signal);
    const files = await readDiff(run);
    if (!files.length) throw new AppError((m) => m.run.team.noChanges, 422);
    enterPhase(run, team, "integrating");
    // Read-only roles may have no shell (Claude read access), so the diff
    // itself travels in the prompt instead of being fetched with git.
    const diffContext = reviewDiffContext(files);
    let implementation = await runAgent(
      ctx,
      run,
      "lead",
      integrationPrompt(locale, run, team, diffContext),
      signal,
    );
    run.reports!.implementer = implementation;
    enterPhase(run, team, "reviewing");
    await runIndependentReview(ctx, run, files, implementation, signal);
    for (let turn = 0; turn < 3 && hasTeamInbox(team, "lead"); turn++) {
      implementation = await runAgent(
        ctx,
        run,
        "lead",
        coordinationPrompt(locale, run, diffContext, implementation),
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
    enterPhase(run, team, "complete");
    ctx.log(run, "system", sm().run.team.done({ files: files.length }));
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
              : sm().run.team.draftIncomplete,
          );
          ctx.log(run, "draft", run.draftPreparation.error);
          await ctx.store.save();
        }
      }),
    ]);
  } catch (error) {
    run.status = signal.aborted ? "cancelled" : "failed";
    if (run.team) run.team.phase = run.status;
    run.error = redact(
      error instanceof Error ? error.message : sm().run.team.runFailed,
    );
    ctx.log(run, "system", run.error);
    for (const agent of run.agents)
      if (agent.status === "running") agent.status = "failed";
  } finally {
    if (ctx.controllers.get(id) === controller) ctx.controllers.delete(id);
    if (schemaDirectory)
      await rm(schemaDirectory, { recursive: true, force: true }).catch(
        () => undefined,
      );
    finished();
    await ctx.store.save();
  }
}
