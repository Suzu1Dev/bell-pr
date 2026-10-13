/**
 * What helps the person learn from a finished run: explanations of each
 * changed file, follow-up questions to a mentor, their own notes, the
 * maintainers' feedback on the published PR, and a fresh independent review
 * after they edited the worktree by hand.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { command, redact } from "./process.js";
import { parseGitHubSource, readDiff } from "./git.js";
import {
  conversationContentLimit,
  conversationMessageLimit,
  type ChatMessage,
} from "../shared/chat.js";
import { AppError, type Run } from "./types.js";
import { log } from "./log.js";
import {
  explanationBatches,
  explanationJsonSchema,
  explanationPrompt,
  guidePrompt,
  parseExplanations,
} from "./explanations.js";
import { parsePrFeedback, prFeedbackQuery, prNumberOf } from "./pr-feedback.js";
import { contributionContext } from "./prompts/team.js";
import { runAgent, runIndependentReview } from "./run-executor.js";
import type { WorkbenchContext } from "./workbench.js";

const now = () => new Date().toISOString();
/** Statuses whose diff is final enough to explain, discuss and annotate. */
const readableStatuses: Run["status"][] = [
  "review",
  "approved",
  "published",
  "failed",
  "cancelled",
];

/**
 * Re-reviews whatever is in the worktree now, so a learner who edited files
 * by hand gets an independent opinion. Reports are advice: status, per-file
 * reviews and approval are left exactly as they were. Resolves once the job
 * is started; the reports arrive through the normal run polling.
 */
export async function rerunReview(ctx: WorkbenchContext, id: string) {
  if (ctx.stopping()) throw new AppError("服務正在關閉，請稍後重試。", 503);
  const run = ctx.run(id);
  if (!["review", "approved"].includes(run.status) || run.publishing)
    throw new AppError("只有審閱中或已核准的工作可以重新執行審查。", 409);
  if (ctx.reviewJobs.has(id) || ctx.controllers.has(id))
    throw new AppError("這個工作的審查正在重新執行，請等待完成或先停止。", 409);
  // Registering the controller first makes a concurrent request a 409 and
  // lets 停止 abort the reviewers through the usual run-level controller.
  const controller = new AbortController();
  ctx.controllers.set(id, controller);
  let files: Awaited<ReturnType<typeof readDiff>>;
  try {
    files = await ctx.lock(id, () => ctx.diff(id));
    if (!files.length)
      throw new AppError("目前沒有程式碼差異可供審查。", 422);
  } catch (error) {
    ctx.controllers.delete(id);
    throw error;
  }
  const reviewers = run.agents.filter(
    (agent) => agent.id === "reviewer" || agent.id === "tester",
  );
  for (const agent of reviewers) {
    agent.status = "running";
    agent.detail = "等待重新審查…";
  }
  ctx.log(
    run,
    "user",
    `要求依目前工作目錄的 ${files.length} 個變更檔案重新執行獨立審查。`,
  );
  const job = (async () => {
    try {
      await runIndependentReview(
        ctx,
        run,
        files,
        run.reports?.implementer,
        controller.signal,
      );
      ctx.log(
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
      ctx.log(
        run,
        "system",
        controller.signal.aborted
          ? "已停止重新審查；原有報告與審閱狀態保留。"
          : redact(
              error instanceof Error ? error.message : "重新審查未完成。",
            ),
      );
    } finally {
      if (ctx.controllers.get(id) === controller)
        ctx.controllers.delete(id);
      ctx.reviewJobs.delete(id);
      await ctx.store.save();
    }
  })()
    // Nothing awaits this job until shutdown or cancel; a failed save above
    // must not become an unhandled rejection that stops the server.
    .catch((error) =>
      log.error("rerun review failed", { runId: id, error: String(error) }),
    )
    .finally(() => {
      ctx.jobs.delete(job);
    });
  ctx.reviewJobs.set(id, job);
  ctx.jobs.add(job);
  await ctx.store.save();
  return run;
}

export async function explanations(
  ctx: WorkbenchContext,
  id: string,
  options: { retry?: boolean; filePath?: string } = {},
) {
  if (ctx.stopping()) throw new AppError("服務正在關閉，請稍後重試。", 503);
  const run = ctx.run(id);
  if (!readableStatuses.includes(run.status) || run.publishing)
    throw new AppError("請等待開發完成後再產生變更解說。", 409);
  const files = await ctx.lock(id, () => ctx.diff(id));
  if (ctx.stopping()) throw new AppError("服務正在關閉，請稍後重試。", 503);
  if (
    options.filePath &&
    !files.some((file) => file.path === options.filePath)
  )
    throw new AppError("找不到此差異檔案。", 404);
  const existing = ctx.explanationJobs.get(id);
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
      const job = generateExplanations(ctx, run, selected).finally(() => {
        ctx.explanationJobs.delete(id);
        ctx.jobs.delete(job);
      });
      ctx.explanationJobs.set(id, job);
      ctx.jobs.add(job);
      await job;
    }
  }
  return { run, files: await ctx.lock(id, () => ctx.diff(id)) };
}

async function generateExplanations(
  ctx: WorkbenchContext,
  run: Run,
  files: Awaited<ReturnType<typeof readDiff>>,
) {
  const controller = new AbortController();
  const key = `explanations:${run.id}`;
  ctx.controllers.set(key, controller);
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
    ctx.log(run, "explanations", message);
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
    await ctx.store.save();
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
        const answer = await runAgent(
          ctx,
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
      await ctx.store.save();
    }
  } catch (error) {
    fail(files, error);
  } finally {
    if (ctx.controllers.get(key) === controller)
      ctx.controllers.delete(key);
    if (temporary) await rm(temporary, { recursive: true, force: true });
    await ctx.store.save();
  }
}

/**
 * Saves the learner's own words about one file together with the diff
 * fingerprint they described. Notes never change the review state: the
 * run status and approval stay as they are, unlike review() and draft().
 */
export async function saveNote(
  ctx: WorkbenchContext,
  id: string,
  filePath: string,
  text: string,
) {
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    if (!readableStatuses.includes(run.status))
      throw new AppError("請等待開發完成後再寫下理解。", 409);
    const file = (await ctx.diff(id)).find(
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
    await ctx.store.save();
    return run;
  });
}

export async function chat(
  ctx: WorkbenchContext,
  id: string,
  filePath: string,
  question: string,
) {
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    if (!readableStatuses.includes(run.status))
      throw new AppError("請等待開發完成後再追問。", 409);
    const file = (await ctx.diff(id)).find(
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
    ctx.controllers.set(controllerKey, controller);
    let answer: string;
    try {
      answer = await runAgent(
        ctx,
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
      ctx.controllers.delete(controllerKey);
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
    await ctx.store.save();
    return answer;
  });
}

/**
 * Reads the published PR's reviews, comments, threads and CI once, on the
 * learner's request. Read-only: BELL never replies or resolves anything on
 * GitHub, and nothing polls this. The run status is unchanged.
 */
export async function fetchPrFeedback(ctx: WorkbenchContext, id: string) {
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    if (run.status !== "published" || !run.prUrl)
      throw new AppError("PR 尚未送出，還沒有維護者回饋可以讀取。", 409);
    const repo = ctx.repo(run.repoId);
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
    ctx.log(
      run,
      "system",
      `已讀取 PR #${prNumber} 的維護者回饋：${run.prFeedback.items.length} 則。`,
    );
    await ctx.store.save();
    return run;
  });
}
