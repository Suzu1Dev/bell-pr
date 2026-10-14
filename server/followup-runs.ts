/**
 * Review follow-up rounds on a published PR: from the maintainer feedback
 * the person selected, one writable agent edits the run's checkout, which
 * still holds the pushed PR head; the person then reviews, approves and
 * pushes the result as one more commit on the same branch (publish.ts), or
 * discards it. The PR title and description stay as published.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { git, redact } from "./process.js";
import { readDiff } from "./git.js";
import { AppError, type Run } from "./types.js";
import type { TeamCheck } from "../shared/team.js";
import { activeFollowUp, type FollowUpRound } from "../shared/followups.js";
import { followUpJsonSchema, parseFollowUpResult } from "./followups.js";
import {
  adoptRemoteCommits,
  assertRemoteHead,
  prHasCommit,
  remoteBranchHead,
  restoreAgentHead,
  worktreeDirty,
} from "./pr-branch.js";
import { runAgent } from "./run-executor.js";
import { contributionContext, teamBoundaries } from "./prompts/team.js";
import { followUpPrompt } from "./prompts/followups.js";
import { log } from "./log.js";
import type { WorkbenchContext } from "./workbench.js";

const now = () => new Date().toISOString();
const newId = () => randomUUID();

/**
 * Starts a round of changes on a published PR from the maintainer feedback
 * the person selected. One writable agent edits the run's checkout, which
 * still holds the pushed PR head; the person then reviews, approves and
 * pushes the result as one more commit on the same branch.
 */
export async function startFollowUp(
  ctx: WorkbenchContext,
  id: string,
  input: { feedbackUrls: string[]; note?: string },
) {
  if (ctx.stopping()) throw new AppError("服務正在關閉，請稍後重試。", 503);
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    if (activeFollowUp(run.followUps))
      throw new AppError("這個工作已有一輪修正在進行。", 409);
    // A round that just ended may still be cleaning up outside the lock.
    await ctx.followUpJobs.get(id)?.catch(() => undefined);
    if (ctx.followUpJobs.has(id) || ctx.controllers.has(id))
      throw new AppError("這個工作已有一輪修正或審查在進行。", 409);
    if (
      run.status !== "published" ||
      !run.prUrl ||
      !run.publishCommit ||
      !run.headRepository ||
      run.publishing
    )
      throw new AppError("只有已送出 PR 的工作可以依 review 繼續修正。", 409);
    const feedbackUrls = [...new Set(input.feedbackUrls)];
    const items = run.prFeedback?.items ?? [];
    if (feedbackUrls.some((url) => !items.some((item) => item.url === url)))
      throw new AppError(
        "選取的回饋不在最近一次讀取的結果中；請重新讀取回饋後再選。",
        409,
      );
    const note = input.note?.trim();
    if (!feedbackUrls.length && !note)
      throw new AppError("請至少選一則回饋，或寫下這輪要修正的內容。", 422);
    // The checkout must still be exactly the pushed PR head.
    const head = (
      await git(run.worktreePath, ["rev-parse", "HEAD"])
    ).stdout.trim();
    if (head !== run.publishCommit || (await worktreeDirty(run)))
      throw new AppError(
        "工作目錄和已推送的 PR 內容不一致；請先還原工作目錄裡的修改再開始修正。",
        409,
      );
    // Rounds build on the PR head: take over commits added on GitHub, and
    // refuse rewritten history before the agent spends any time.
    await adoptRemoteCommits(ctx, run);
    assertRemoteHead(run, await remoteBranchHead(run), run.publishCommit!);
    const round: FollowUpRound = {
      id: newId().slice(0, 8),
      requestedAt: now(),
      feedbackUrls,
      ...(note ? { note } : {}),
      status: "running",
      parentCommit: run.publishCommit,
    };
    (run.followUps ??= []).push(round);
    if (!run.agents.some((agent) => agent.id === "followup"))
      run.agents.push({
        id: "followup",
        name: "Mend",
        role: "Review follow-up",
        status: "waiting",
        detail: "依維護者回饋修正",
      });
    // Only this round's own message may be pushed: the agent's or the person's.
    const { commitMessage: _previous, ...draft } = run.draft;
    run.draft = draft;
    run.status = "running";
    delete run.approvedFingerprint;
    delete run.error;
    ctx.log(
      run,
      "user",
      `要求依 ${feedbackUrls.length} 則維護者回饋${note ? "與補充說明" : ""}進行第 ${run.followUps.length} 輪修正。`,
    );
    const controller = new AbortController();
    ctx.controllers.set(id, controller);
    const job = runFollowUp(ctx, run, round, controller)
      // Nothing awaits this job until shutdown or cancel; a failed save
      // must not become an unhandled rejection that stops the server.
      .catch((error) =>
        log.error("follow-up round failed", {
          runId: id,
          error: String(error),
        }),
      )
      .finally(() => {
        ctx.followUpJobs.delete(id);
        ctx.jobs.delete(job);
      });
    ctx.followUpJobs.set(id, job);
    ctx.jobs.add(job);
    await ctx.store.save();
    return run;
  });
}

/** The pushed commit's message, shown again once a round ends without a commit. */
async function restoreParentMessage(run: Run, round: FollowUpRound) {
  const message = (
    await git(run.worktreePath, [
      "log",
      "-1",
      "--format=%B",
      round.parentCommit,
    ])
  ).stdout.trim();
  const { commitMessage: _round, ...draft } = run.draft;
  run.draft =
    message && message !== draft.title
      ? { ...draft, commitMessage: message }
      : draft;
}

async function runFollowUp(
  ctx: WorkbenchContext,
  run: Run,
  round: FollowUpRound,
  controller: AbortController,
) {
  let temporary: string | undefined;
  const checks: TeamCheck[] = [];
  const roundNumber = (run.followUps?.indexOf(round) ?? 0) + 1;
  const committedNote =
    "Agent 自行建立了 commit 或切換了分支；已還原到已推送的 PR，修改保留在工作目錄供你審閱。";
  let succeeded = false;
  try {
    const files = await readDiff(run);
    temporary = await mkdtemp(path.join(os.tmpdir(), "bell-followup-"));
    const outputSchema = path.join(temporary, "followup-schema.json");
    await writeFile(outputSchema, JSON.stringify(followUpJsonSchema), {
      mode: 0o600,
    });
    const previousCommitMessage = (
      await git(run.worktreePath, [
        "log",
        "-1",
        "--format=%B",
        round.parentCommit,
      ])
    ).stdout.trim();
    const answer = await runAgent(
      ctx,
      run,
      "followup",
      followUpPrompt({
        boundaries: teamBoundaries,
        contributionContext: contributionContext(run),
        pullRequest: {
          url: run.prUrl!,
          title: run.draft.title,
          body: run.draft.body,
        },
        previousCommitMessage,
        feedback: (run.prFeedback?.items ?? []).filter((item) =>
          round.feedbackUrls.includes(item.url),
        ),
        note: round.note,
        changedFiles: files.map((file) => file.path),
      }),
      controller.signal,
      false,
      { outputSchema, checks },
    );
    const result = parseFollowUpResult(answer, round.feedbackUrls);
    await ctx.lock(run.id, async () => {
      round.report = result.summary;
      round.addressed = result.addressed;
      round.notAddressed = result.notAddressed;
      // Commands the application saw run, not the agent's own list.
      if (checks.length) round.checks = checks;
      const moved = await restoreAgentHead(run, round.parentCommit);
      if (!(await worktreeDirty(run))) {
        round.status = "failed";
        round.error =
          "Agent 沒有修改任何檔案；請看下方的說明，必要時調整選取的回饋或補充說明再試一次。";
        await restoreParentMessage(run, round);
        run.status = "published";
        ctx.log(run, "followup", round.error);
        return;
      }
      if (moved) round.error = committedNote;
      // An empty message is stored as absent; the person then writes one.
      const { commitMessage: _empty, ...draft } = run.draft;
      run.draft = result.commitMessage
        ? { ...draft, commitMessage: result.commitMessage }
        : draft;
      // Re-read the diff first, so reviews of the files this round changed are
      // cleared before anything can see the run as ready for review.
      await ctx.diff(run.id);
      round.status = "review";
      run.status = "review";
      succeeded = true;
      ctx.log(
        run,
        "system",
        `第 ${roundNumber} 輪修正完成，請逐檔審閱這輪改到的檔案，確認提交訊息後再推送。${moved ? committedNote : ""}`,
      );
    });
  } catch (error) {
    await ctx.lock(run.id, async () => {
      const reason = controller.signal.aborted
        ? "這輪修正已停止"
        : redact(error instanceof Error ? error.message : "這輪修正未完成");
      // What BELL saw the agent run is evidence even when its answer is lost.
      if (checks.length) round.checks = checks;
      await restoreAgentHead(run, round.parentCommit).catch(() => undefined);
      // Edits already made stay for review or discard; a clean checkout is simply published again.
      const dirty = await worktreeDirty(run).catch(() => true);
      round.status = dirty
        ? "review"
        : controller.signal.aborted
          ? "cancelled"
          : "failed";
      round.error = dirty
        ? `${reason}；工作目錄保留了部分修改，可以審閱、寫好提交訊息後推送，或放棄這輪修正。`
        : reason;
      if (dirty) await ctx.diff(run.id).catch(() => undefined);
      else await restoreParentMessage(run, round).catch(() => undefined);
      run.status = dirty ? "review" : "published";
      ctx.log(run, "system", round.error);
    });
  } finally {
    const agent = run.agents.find((value) => value.id === "followup");
    if (agent) {
      agent.status = succeeded ? "complete" : "failed";
      agent.detail = succeeded
        ? "修正完成，等待審閱"
        : round.status === "review"
          ? "修正中斷，修改保留待審閱"
          : "修正中斷或沒有修改";
    }
    if (ctx.controllers.get(run.id) === controller)
      ctx.controllers.delete(run.id);
    if (temporary) await rm(temporary, { recursive: true, force: true });
    await ctx.store.save();
  }
}

/** Throws the round's edits away and returns the checkout to the pushed PR head. */
export async function discardFollowUp(ctx: WorkbenchContext, id: string) {
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    const round = activeFollowUp(run.followUps);
    if (
      !round ||
      round.status !== "review" ||
      run.publishing ||
      !["review", "approved"].includes(run.status)
    )
      throw new AppError("目前沒有可以放棄的修正。", 409);
    if (round.commit) {
      // A commit is only safe to drop when the PR on GitHub does not have it.
      if (await prHasCommit(ctx, run, round.commit))
        throw new AppError(
          "這輪修正已推送到 PR；請再按一次推送，讓 BELL 記錄完成。",
          409,
        );
      await git(run.worktreePath, [
        "update-ref",
        `refs/heads/${run.branch}`,
        round.parentCommit,
      ]);
      delete round.commit;
    }
    await git(run.worktreePath, ["reset", "--hard", round.parentCommit]);
    // Ignored files such as build output stay; only the round's new files go.
    await git(run.worktreePath, ["clean", "-fd"]);
    if (round.previousBase) run.baseSha = round.previousBase;
    await restoreParentMessage(run, round);
    round.status = "discarded";
    run.status = "published";
    delete run.approvedFingerprint;
    delete run.error;
    const files = await ctx.diff(id);
    // The checkout is the pushed head again, whose files were all reviewed
    // before it was pushed, except files changed by commits taken over from
    // GitHub since the last reviewed push.
    const unreviewed = new Set<string>();
    const pushed = run.followUps!.filter(
      (entry) => entry !== round && entry.status === "published",
    );
    for (const entry of pushed.reverse()) {
      if (!entry.adopted || !entry.commit) break;
      const changed = await git(run.worktreePath, [
        "diff",
        "--name-only",
        "-z",
        "--no-renames",
        entry.parentCommit,
        entry.commit,
      ]);
      for (const file of changed.stdout.split("\0").filter(Boolean))
        unreviewed.add(file);
    }
    run.reviewedFingerprints = Object.fromEntries(
      files
        .filter((file) => !file.blocked && !unreviewed.has(file.path))
        .map((file) => [file.path, file.fingerprint]),
    );
    run.reviewedFiles = Object.keys(run.reviewedFingerprints);
    ctx.log(run, "user", "已放棄這輪修正，工作目錄回到已推送的 PR 內容。");
    await ctx.store.save();
    return run;
  });
}
