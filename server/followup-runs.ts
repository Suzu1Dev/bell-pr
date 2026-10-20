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
import { AppError, withRunLocale, type Run } from "./types.js";
import type { TeamCheck } from "../shared/team.js";
import {
  activeFollowUp,
  followUpRestatementLimit,
  type FollowUpRestatement,
  type FollowUpRound,
  type FollowUpStartInput,
} from "../shared/followups.js";
import { understandingWords } from "../shared/understanding.js";
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
import { feedbackForAgent } from "./explanations.js";
import { contributionContext } from "./prompts/team.js";
import { followUpPrompt } from "./prompts/followups.js";
import { log } from "./log.js";
import { parseAgentOutput } from "./run-events.js";
import { currentLocale, shuttingDown, sm } from "./i18n/index.js";
import type { WorkbenchContext } from "./workbench.js";

const now = () => new Date().toISOString();
const newId = () => randomUUID();

/** A restatement holds at least this many words, counted as the check counts them (DESIGN §5.5). */
const restatementMinWords = 3;

/**
 * The person's restatement of each selected comment, in the order of the
 * selection: exactly one per comment, at least 3 words and at most 300
 * characters each. Anything else is refused with 422.
 */
function checkRestatements(
  feedbackUrls: string[],
  given: FollowUpRestatement[],
): FollowUpRestatement[] {
  const refused = () =>
    new AppError(
      (m) =>
        m.understanding.restatementRequired({
          min: restatementMinWords,
          max: followUpRestatementLimit,
        }),
      422,
    );
  const texts = new Map<string, string>();
  for (const entry of given) {
    const text = entry.text.trim();
    if (
      !feedbackUrls.includes(entry.url) ||
      texts.has(entry.url) ||
      understandingWords(text) < restatementMinWords ||
      text.length > followUpRestatementLimit
    )
      throw refused();
    texts.set(entry.url, text);
  }
  if (feedbackUrls.some((url) => !texts.has(url))) throw refused();
  return feedbackUrls.map((url) => ({ url, text: texts.get(url)! }));
}

/**
 * Starts a round of changes on a published PR from the maintainer feedback
 * the person selected. One writable agent edits the run's checkout, which
 * still holds the pushed PR head; the person then reviews, approves and
 * pushes the result as one more commit on the same branch.
 *
 * Each selected comment needs the person's restatement in their own words,
 * which becomes the agent's task. The route always passes `restatements`
 * (an empty list when the request had none); a caller that leaves the
 * field out entirely is code written before restatements existed, and its
 * round is started as before.
 */
export async function startFollowUp(
  ctx: WorkbenchContext,
  id: string,
  input: FollowUpStartInput,
) {
  if (ctx.stopping()) throw new AppError(shuttingDown(), 503);
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    // No AI round in Learn by hand (until v1.2.1): the person pushes with their own Git.
    if (run.learnByHand) throw new AppError((m) => m.byHand.followUpRefused, 409);
    if (activeFollowUp(run.followUps))
      throw new AppError((m) => m.run.followUp.inProgress, 409);
    // A round that just ended may still be cleaning up outside the lock.
    await ctx.followUpJobs.get(id)?.catch(() => undefined);
    if (ctx.followUpJobs.has(id) || ctx.controllers.has(id))
      throw new AppError((m) => m.run.followUp.busy, 409);
    if (
      run.status !== "published" ||
      !run.prUrl ||
      !run.publishCommit ||
      !run.headRepository ||
      run.publishing
    )
      throw new AppError((m) => m.run.followUp.notPublished, 409);
    const feedbackUrls = [...new Set(input.feedbackUrls)];
    const items = run.prFeedback?.items ?? [];
    if (feedbackUrls.some((url) => !items.some((item) => item.url === url)))
      throw new AppError((m) => m.run.followUp.feedbackNotInLatest, 409);
    const note = input.note?.trim();
    if (!feedbackUrls.length && !note)
      throw new AppError((m) => m.run.followUp.inputRequired, 422);
    const restatements =
      input.restatements === undefined
        ? undefined
        : checkRestatements(feedbackUrls, input.restatements);
    // The checkout must still be exactly the pushed PR head.
    const head = (
      await git(run.worktreePath, ["rev-parse", "HEAD"])
    ).stdout.trim();
    if (head !== run.publishCommit || (await worktreeDirty(run)))
      throw new AppError((m) => m.run.followUp.checkoutDiffers, 409);
    // Rounds build on the PR head: take over commits added on GitHub, and
    // refuse rewritten history before the agent spends any time.
    await adoptRemoteCommits(ctx, run);
    assertRemoteHead(run, await remoteBranchHead(run), run.publishCommit!);
    const round: FollowUpRound = {
      id: newId().slice(0, 8),
      requestedAt: now(),
      feedbackUrls,
      ...(note ? { note } : {}),
      ...(restatements?.length ? { restatements } : {}),
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
        detail: sm().run.agents.followUp,
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
      sm().run.followUp.requested({
        feedback: feedbackUrls.length,
        note: !!note,
        round: run.followUps.length,
      }),
    );
    const controller = new AbortController();
    ctx.controllers.set(id, controller);
    const job = withRunLocale(run, () =>
      runFollowUp(ctx, run, round, controller),
    )
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
  let succeeded = false;
  const started = Date.now();
  log.info("round.started", { runId: run.id, round: round.id });
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
    const feedback = (run.prFeedback?.items ?? []).filter((item) =>
      round.feedbackUrls.includes(item.url),
    );
    // A comment by someone outside the project could carry instructions
    // that lead the agent to the web: with such a comment selected, this
    // writable turn stays offline instead of dropping what the person chose.
    const offline =
      run.modelExecution?.webAccess === true &&
      feedbackForAgent(feedback, true).length < feedback.length;
    const answer = await runAgent(
      ctx,
      run,
      "followup",
      followUpPrompt({
        // The run's locale: startFollowUp runs this job under withRunLocale.
        locale: currentLocale(),
        contributionContext: contributionContext(run),
        pullRequest: {
          url: run.prUrl!,
          title: run.draft.title,
          body: run.draft.body,
        },
        previousCommitMessage,
        feedback,
        restatements: round.restatements,
        note: round.note,
        changedFiles: files.map((file) => file.path),
        provider: run.modelExecution?.provider,
      }),
      controller.signal,
      false,
      { outputSchema, checks, offline },
    );
    const result = parseAgentOutput(run, "follow-up", () =>
      parseFollowUpResult(answer, round.feedbackUrls),
    );
    await ctx.lock(run.id, async () => {
      round.report = result.summary;
      round.addressed = result.addressed;
      round.notAddressed = result.notAddressed;
      if (result.setup.length) round.setup = result.setup;
      // Commands the application saw run, not the agent's own list.
      if (checks.length) round.checks = checks;
      const moved = await restoreAgentHead(run, round.parentCommit);
      if (!(await worktreeDirty(run))) {
        round.status = "failed";
        round.error = sm().run.followUp.noChanges;
        await restoreParentMessage(run, round);
        run.status = "published";
        ctx.log(run, "followup", round.error);
        return;
      }
      if (moved) round.error = sm().run.followUp.agentCommitted;
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
        sm().run.followUp.done({ round: roundNumber, agentCommitted: moved }),
      );
    });
  } catch (error) {
    await ctx.lock(run.id, async () => {
      const reason = controller.signal.aborted
        ? sm().run.followUp.stoppedReason
        : redact(
            error instanceof Error
              ? error.message
              : sm().run.followUp.incompleteReason,
          );
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
      round.error = dirty ? sm().run.followUp.keptEdits({ reason }) : reason;
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
        ? sm().run.agents.followUpDone
        : round.status === "review"
          ? sm().run.agents.followUpStoppedKept
          : sm().run.agents.followUpStopped;
    }
    if (ctx.controllers.get(run.id) === controller)
      ctx.controllers.delete(run.id);
    if (temporary) await rm(temporary, { recursive: true, force: true });
    (succeeded ? log.info : log.warn)(
      succeeded ? "round.finished" : "round.failed",
      {
        runId: run.id,
        round: round.id,
        status: round.status,
        durationMs: Date.now() - started,
      },
    );
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
      throw new AppError((m) => m.run.followUp.nothingToDiscard, 409);
    if (round.commit) {
      // A commit is only safe to drop when the PR on GitHub does not have it.
      if (await prHasCommit(ctx, run, round.commit))
        throw new AppError((m) => m.run.followUp.alreadyPushed, 409);
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
    ctx.log(run, "user", sm().run.followUp.discarded);
    await ctx.store.save();
    return run;
  });
}
