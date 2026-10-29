/**
 * PR draft suggestions: at most one preparation job per run, started by the
 * run after the review or by the person. A suggestion never replaces a draft
 * the person already edited. A Learn-by-hand run gets none: its PR text is
 * the person's own, and it may start from the project's PR template
 * (`template`, the façade's GET …/by-hand/template).
 */
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { git, redact } from "./process.js";
import { readDiff } from "./git.js";
import { collectDraftContext, documentKind } from "./draft-sources.js";
import { assertWorkspacePresent } from "./cleanup.js";
import type { ByHandTemplate } from "../shared/by-hand.js";
import {
  automaticCommitMessage,
  draftFingerprint,
  draftJsonSchema,
  draftPrompt,
  parseDraftProposal,
} from "./drafts.js";
import { sessionReport } from "./session.js";
import { agentLabel } from "./agent-cli.js";
import { AppError, type Run } from "./types.js";
import { sameDraftProse } from "../shared/draft-checks.js";
import { activeFollowUp } from "../shared/followups.js";
import { editable } from "./publish.js";
import { assertRunAgentAllowed } from "./codex-guard.js";
import { runAgent } from "./run-executor.js";
import { parseAgentOutput } from "./run-events.js";
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

/**
 * Starts the PR draft suggestion, or waits for the one running. A draft the
 * person asks for follows the request's locale; the automatic one after the
 * review runs in the run's locale, like the rest of executeRun.
 */
export async function prepareRunDraft(
  ctx: WorkbenchContext,
  id: string,
  options: DraftOptions = {},
) {
  if (ctx.stopping()) throw new AppError(shuttingDown(), 503);
  assertRunAgentAllowed(ctx.run(id));
  // Learn by hand: the pull request text is the person's own (DESIGN v1.2 F11).
  if (ctx.run(id).learnByHand)
    throw new AppError((m) => m.byHand.flow.draftRefused, 409);
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
  const appliedBody = appliedSuggestion(run.draftPreparation, run.draft);
  const sameDiff = run.draftPreparation?.fingerprint === fingerprint;
  // The editor may still hold a dropped suggestion, unsaved.
  const earlierBodies = sameDiff
    ? run.draftPreparation?.earlierBodies
    : earlierSuggestions(run.draftPreparation);
  const preparation: NonNullable<Run["draftPreparation"]> = {
    ...(sameDiff ? run.draftPreparation : {}),
    // Another diff drops the suggestion; the draft may still be its text.
    ...(appliedBody ? { appliedBody } : {}),
    ...(earlierBodies ? { earlierBodies } : {}),
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
    const repo = ctx.repo(run.repoId);
    preparation.context = await (
      ctx.dependencies.collectDraftContext ?? collectDraftContext
    )(repo, run, { signal: controller.signal });
    if (controller.signal.aborted)
      throw new AppError((m) => m.run.draft.cancelled, 409);
    const evidence = run.session && sessionReport(run.session.messages);
    const prompt = draftPrompt(
      evidence ? { ...run, reports: { ...run.reports, session: evidence } } : run,
      files, preparation.context, repo.url,
    );
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
    const context = preparation.context;
    const proposal = parseAgentOutput(run, "draft", () =>
      parseDraftProposal(answer, context, {
        learnByHand: run.learnByHand,
        assistant: agentLabel(run.modelExecution?.provider),
      }),
    );
    await ctx.lock(run.id, async () => {
      const currentFiles = await readDiff(run);
      if (fingerprint !== draftFingerprint(run, currentFiles)) {
        preparation.status = "stale";
        preparation.error = sm().run.draft.stale;
        return;
      }
      preparation.status = "ready";
      // The draft may still be the suggestion this one replaces.
      const replaced = appliedSuggestion(preparation, run.draft);
      if (replaced) preparation.appliedBody = replaced;
      // The editor may hold it unsaved, to be saved after this one lands.
      const earlier = earlierSuggestions(preparation);
      if (earlier) preparation.earlierBodies = earlier;
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
          run.draft.commitMessage?.trim() || automaticCommitMessage(proposal);
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

/**
 * The suggestion's body while the draft is still that text, else the one
 * kept earlier: what the checks on unrevised text compare the draft with
 * once a regeneration drops or replaces `proposal`.
 */
function appliedSuggestion(
  preparation: Run["draftPreparation"],
  draft: Run["draft"],
) {
  const body = preparation?.proposal?.body;
  return body?.trim() && sameDraftProse(draft.body, body)
    ? body
    : preparation?.appliedBody;
}

/**
 * The suggestion bodies a regeneration replaced or dropped, newest first and
 * at most five, with the current suggestion's body added: what the checks
 * on unrevised text also compare the draft with, whether or not it was saved.
 */
function earlierSuggestions(preparation: Run["draftPreparation"]) {
  const body = preparation?.proposal?.body;
  const kept = preparation?.earlierBodies;
  if (!body?.trim()) return kept;
  return [
    body,
    ...(kept ?? []).filter((earlier) => !sameDraftProse(earlier, body)),
  ].slice(0, 5);
}

/** At most three templates, each at most 20 kB; a larger one is left out rather than cut. */
const templateLimits = { files: 3, bytes: 20_000 };

/** GET /api/runs/:id/by-hand/template: the project's PR templates from the run's folder, verbatim (F11). */
export async function template(
  ctx: WorkbenchContext,
  id: string,
): Promise<{ templates: ByHandTemplate[] }> {
  const run = ctx.run(id);
  assertWorkspacePresent(run);
  const { stdout } = await git(run.worktreePath, [
    "ls-files", "-z", "--", ":(glob,icase)**/pull_request_template*", ":(glob,icase)**/pull_request_template/**",
  ]);
  // The draft sources' own detection; single templates first, then a folder of them.
  const found = stdout.split("\0").filter((file) => file && documentKind(file) === "template");
  const depth = (file: string) => file.split("/").length;
  found.sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
  const root = await realpath(run.worktreePath);
  const templates: ByHandTemplate[] = [];
  for (const file of found) {
    if (templates.length >= templateLimits.files) break;
    // Only a file at its own path: a link (or a linked folder) the project tracks could point at
    // the person's own files, such as an ignored .env.
    const own = path.join(root, file);
    const full = await realpath(own).catch(() => "");
    if (full !== own) continue;
    const info = await lstat(full);
    if (!info.isFile() || info.size > templateLimits.bytes) continue;
    templates.push({ path: file, content: await readFile(full, "utf8") });
  }
  return { templates };
}
