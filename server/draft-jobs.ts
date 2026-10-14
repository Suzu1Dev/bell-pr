/**
 * PR draft suggestions: at most one preparation job per run, started by the
 * run after the review or by the person. A suggestion never replaces a draft
 * the person already edited.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { redact } from "./process.js";
import { readDiff } from "./git.js";
import { collectDraftContext } from "./draft-sources.js";
import {
  draftFingerprint,
  draftJsonSchema,
  draftPrompt,
  parseDraftProposal,
} from "./drafts.js";
import { AppError, type Run } from "./types.js";
import { activeFollowUp } from "../shared/followups.js";
import { editable } from "./publish.js";
import { runAgent } from "./run-executor.js";
import type { WorkbenchContext } from "./workbench.js";
import { shuttingDown, sm } from "./i18n/index.js";

const now = () => new Date().toISOString();

export interface DraftOptions {
  /** Generate again even when a ready suggestion matches the diff. */
  refresh?: boolean;
  /** Started by the run after the review rather than by the person. */
  automatic?: boolean;
  /** The draft when the run finished; the suggestion replaces only that. */
  startingDraft?: Run["draft"];
}

export async function prepareRunDraft(
  ctx: WorkbenchContext,
  id: string,
  options: DraftOptions = {},
) {
  if (ctx.stopping()) throw new AppError(shuttingDown(), 503);
  let pending: Promise<void> | undefined;
  await ctx.lock(id, async () => {
    if (ctx.stopping()) throw new AppError(shuttingDown(), 503);
    const run = ctx.run(id);
    editable(run);
    if (activeFollowUp(run.followUps))
      throw new AppError((m) => m.run.draft.notForRound, 409);
    const files = await ctx.diff(id);
    if (ctx.stopping()) throw new AppError(shuttingDown(), 503);
    pending = ctx.draftJobs.get(id);
    if (pending) return;
    if (
      !options.refresh &&
      run.draftPreparation?.status === "ready" &&
      run.draftPreparation.fingerprint === draftFingerprint(run, files)
    )
      return;
    const job = generateDraft(
      ctx,
      run,
      files,
      !!options.automatic,
      options.startingDraft,
    ).finally(() => {
      ctx.draftJobs.delete(id);
      ctx.jobs.delete(job);
    });
    pending = job;
    ctx.draftJobs.set(id, job);
    ctx.jobs.add(job);
  });
  await pending;
  return { run: ctx.run(id) };
}

async function generateDraft(
  ctx: WorkbenchContext,
  run: Run,
  files: Awaited<ReturnType<typeof readDiff>>,
  automatic: boolean,
  initialDraft?: Run["draft"],
) {
  const controller = new AbortController();
  const key = `draft:${run.id}`;
  ctx.controllers.set(key, controller);
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
    await ctx.store.save();
    if (controller.signal.aborted)
      throw new AppError((m) => m.run.draft.cancelled, 409);
    preparation.context = await (
      ctx.dependencies.collectDraftContext ?? collectDraftContext
    )(ctx.repo(run.repoId), run, { signal: controller.signal });
    if (controller.signal.aborted)
      throw new AppError((m) => m.run.draft.cancelled, 409);
    const prompt = draftPrompt(run, files, preparation.context);
    temporary = await mkdtemp(path.join(os.tmpdir(), "bell-draft-"));
    const outputSchema = path.join(temporary, "response-schema.json");
    await writeFile(outputSchema, JSON.stringify(draftJsonSchema), {
      mode: 0o600,
    });
    await ctx.store.save();
    const answer = await runAgent(
      ctx,
      run,
      "draft",
      prompt,
      controller.signal,
      true,
      { cwd: temporary, outputSchema, isolated: true, timeout: "draft" },
    );
    const proposal = parseDraftProposal(answer, preparation.context);
    await ctx.lock(run.id, async () => {
      const currentFiles = await readDiff(run);
      if (fingerprint !== draftFingerprint(run, currentFiles)) {
        preparation.status = "stale";
        preparation.error = sm().run.draft.stale;
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
        ctx.log(run, "draft", sm().run.draft.applied);
      } else {
        ctx.log(run, "draft", sm().run.draft.ready);
      }
    });
  } catch (error) {
    if (preparation.status !== "stale") {
      preparation.status = "failed";
      preparation.error = controller.signal.aborted
        ? sm().run.draft.stopped
        : redact(
            error instanceof Error ? error.message : sm().run.draft.failed,
          );
    }
    ctx.log(run, "draft", preparation.error ?? sm().run.draft.incomplete);
  } finally {
    if (ctx.controllers.get(key) === controller)
      ctx.controllers.delete(key);
    if (temporary) await rm(temporary, { recursive: true, force: true });
    await ctx.store.save();
  }
}
