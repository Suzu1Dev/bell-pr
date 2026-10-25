/**
 * Splitting a contribution into separate ones (shared/split.ts). Each new
 * contribution is a run of its own in status `review`: its branch and
 * worktree start at the original's base commit, and the files it was given
 * are applied to that worktree the way integrateTeamTask applies a task's
 * files, so they are the files as they are now in the original's worktree,
 * hand edits included. The original run is left as it was; it only records
 * what it was split into.
 *
 * What is bound to a file's unchanged content (explanations, walkthroughs,
 * the person's notes and review marks) moves with the file. What belongs to
 * a whole change (the PR text, the approval, the understanding check, the
 * reports) does not: each contribution is explained and approved on its own.
 */
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { activeFollowUp } from "../shared/followups.js";
import { planTaskPaths } from "../shared/reviewability.js";
import type { SplitRef, SplitRequest } from "../shared/split.js";
import { assertWorkspacePresent } from "./cleanup.js";
import { assertRefName, readDiff } from "./git.js";
import { shuttingDown, sm } from "./i18n/index.js";
import { log } from "./log.js";
import { git } from "./process.js";
import { editable } from "./publish.js";
import { assertConflictsResolved } from "./sync-runs.js";
import {
  AppError,
  withRunLocale,
  type DiffFile,
  type Repository,
  type Run,
} from "./types.js";
import type { WorkbenchContext } from "./workbench-context.js";

/** The longest request prompt a contribution made by a split keeps. */
const promptChars = 4000;

/** Keeps the entries of a record whose key is one of `paths`. */
function onlyPaths<T>(record: Record<string, T> | undefined, paths: ReadonlySet<string>) {
  const kept = Object.entries(record ?? {}).filter(([key]) => paths.has(key));
  return kept.length ? Object.fromEntries(structuredClone(kept)) : undefined;
}

/** Checks what the person asked for against the run's diff; 422 for a request that cannot be met. */
function assertRequest(input: SplitRequest, files: readonly DiffFile[]) {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const seen = new Set<string>();
  for (const { paths } of input.contributions)
    for (const filePath of paths) {
      const file = byPath.get(filePath);
      if (!file)
        throw new AppError((m) => m.run.split.unknownPath({ path: filePath }), 422);
      if (seen.has(filePath))
        throw new AppError((m) => m.run.split.duplicatePath({ path: filePath }), 422);
      seen.add(filePath);
      if (file.blocked)
        throw new AppError((m) => m.run.split.heldBack({ path: filePath }), 422);
    }
  return byPath;
}

/** Removes a worktree and branch made for a contribution that was not kept. */
async function discardCheckout(repo: Repository, branch: string, worktreePath: string) {
  try {
    await git(repo.path, ["worktree", "remove", "--force", worktreePath]);
  } catch {
    await rm(worktreePath, { recursive: true, force: true });
    await git(repo.path, ["worktree", "prune"]).catch(() => undefined);
  }
  await git(repo.path, ["branch", "-D", branch]).catch(() => undefined);
}

/**
 * Makes one contribution from `paths` of `source`: the branch and worktree
 * first, then the files, then a check that the worktree's diff is exactly
 * those files with the same content. The caller holds the repository lock.
 */
async function createContribution(
  ctx: WorkbenchContext,
  source: Run,
  repo: Repository,
  title: string,
  paths: readonly string[],
  files: ReadonlyMap<string, DiffFile>,
): Promise<Run> {
  const id = randomUUID();
  const branch = `fix/${id.slice(0, 8)}`;
  assertRefName(branch);
  const worktreePath = path.join(ctx.store.directory, "worktrees", id);
  await mkdir(path.dirname(worktreePath), { recursive: true, mode: 0o700 });
  // The branch comes first and on its own: `worktree add -b` keeps the branch
  // it made when the checkout fails, before this function could remove it.
  await git(repo.path, ["branch", "--no-track", branch, source.baseSha]);
  try {
    await git(repo.path, ["worktree", "add", worktreePath, branch], { timeoutMs: 60_000 });
    const chosen = paths.map((filePath) => files.get(filePath)!);
    const patch = chosen.map((file) => file.patch).join("\n");
    await git(worktreePath, ["apply", "--check", "--whitespace=nowarn", "-"], { input: patch });
    await git(worktreePath, ["apply", "--whitespace=nowarn", "-"], { input: patch });
    const copied = await readDiff({
      worktreePath,
      baseSha: source.baseSha,
      locale: source.locale,
    });
    const same =
      copied.length === chosen.length &&
      chosen.every(
        (file) =>
          copied.find((other) => other.path === file.path)?.fingerprint === file.fingerprint,
      );
    if (!same) throw new AppError((m) => m.run.split.notReproduced, 500);
    return contributionRun(ctx, source, { id, title, branch, worktreePath }, new Set(paths), files);
  } catch (error) {
    // Whatever fails once the checkout exists, it does not stay behind.
    await discardCheckout(repo, branch, worktreePath);
    throw error;
  }
}

/**
 * The run record of a contribution made from the `own` files of `source`. It
 * touches nothing outside memory, so it cannot leave a checkout behind; a
 * source without a plan (`team` is optional) gives a contribution without one.
 */
function contributionRun(
  ctx: WorkbenchContext,
  source: Run,
  made: { id: string; title: string; branch: string; worktreePath: string },
  own: ReadonlySet<string>,
  files: ReadonlyMap<string, DiffFile>,
): Run {
  const { id, title, branch, worktreePath } = made;
  const changed = [...files.keys()];
  const tasks = (source.team?.tasks ?? [])
    .filter((task) => planTaskPaths(changed, task).some((filePath) => own.has(filePath)))
    .map((task) => {
      const { worktreePath: _removed, worktreeRemoved: _gone, ...rest } = structuredClone(task);
      return {
        ...rest,
        integratedFiles: planTaskPaths(changed, task).filter((filePath) => own.has(filePath)),
      };
    });
  const kept = new Set(tasks.map((task) => task.id));
  for (const task of tasks) task.dependsOn = task.dependsOn.filter((other) => kept.has(other));
  const owners = new Set(tasks.map((task) => task.owner));
  const prompt = [title, ...tasks.map((task) => task.description)]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, promptChars);
  const reviewedFingerprints = Object.fromEntries(
    Object.entries(source.reviewedFingerprints).filter(
      ([filePath, fingerprint]) =>
        own.has(filePath) && files.get(filePath)?.fingerprint === fingerprint,
    ),
  );
  const created = new Date().toISOString();
  const explanations = onlyPaths(source.explanations, own);
  // A job still writing an explanation writes it to the original only, and
  // the new run asks for one only while it is pending.
  for (const entry of Object.values(explanations ?? {}))
    if (entry.status === "generating") entry.status = "pending";
  const walkthroughs = onlyPaths(source.walkthroughs, own);
  const notes = onlyPaths(source.notes, own);
  const reports = onlyPaths(source.reports, kept);
  const facts = source.contributionFacts ? structuredClone(source.contributionFacts) : undefined;
  const settings = source.contributionSettings
    ? structuredClone(source.contributionSettings)
    : undefined;
  const text = withRunLocale(source, () => sm().run);

  const run: Run = {
    id,
    repoId: source.repoId,
    title,
    prompt,
    status: "review",
    branch,
    baseBranch: source.baseBranch,
    baseSha: source.baseSha,
    worktreePath,
    createdAt: created,
    ...(source.locale ? { locale: source.locale } : {}),
    // The lead planned and the teammates built these files; the reviewer and the
    // test analyst have not looked at this contribution yet (a re-review asks them to).
    agents: source.agents
      .filter((agent) => ["lead", "reviewer", "tester"].includes(agent.id) || owners.has(agent.id))
      .map((agent) =>
        ["reviewer", "tester"].includes(agent.id)
          ? {
              ...structuredClone(agent),
              status: "waiting" as const,
              detail: agent.id === "reviewer" ? text.agents.reviewer : text.agents.tester,
            }
          : structuredClone(agent),
      ),
    logs: [],
    draft: { title, body: "" },
    reviewedFiles: Object.keys(reviewedFingerprints),
    reviewedFingerprints,
    reports: reports ?? {},
    ...(settings ? { contributionSettings: settings } : {}),
    ...(source.modelExecution ? { modelExecution: structuredClone(source.modelExecution) } : {}),
    ...(facts ? { contributionFacts: facts } : {}),
    ...(source.unsandboxed ? { unsandboxed: true as const } : {}),
    ...(explanations ? { explanations } : {}),
    ...(walkthroughs ? { walkthroughs } : {}),
    ...(notes ? { notes } : {}),
    ...(source.team
      ? {
          team: {
            config: structuredClone(source.team.config),
            phase: "complete" as const,
            planSummary: title,
            tasks,
            messages: [],
            ...(source.team.approvedAt ? { approvedAt: source.team.approvedAt } : {}),
          },
        }
      : {}),
    splitFrom: { runId: source.id, title: source.title },
  };
  ctx.log(run, "lead", text.split.startedFrom({ title: source.title }), { kind: "notice" });
  return run;
}

/**
 * POST /api/runs/:id/split. All of it or none of it: a contribution that
 * fails to come out the same as the files it was made from is removed
 * together with the ones made before it, and the original is not touched.
 * Starts a PR draft for each new contribution afterwards, in the background.
 */
export async function splitRun(
  ctx: WorkbenchContext,
  id: string,
  input: SplitRequest,
): Promise<{ run: Run; created: Run[] }> {
  if (ctx.stopping()) throw new AppError(shuttingDown(), 503);
  const result = await ctx.lock(id, async () => {
    const source = ctx.run(id);
    if (source.learnByHand) throw new AppError((m) => m.run.split.byHand, 409);
    editable(source);
    if (source.prUrl || source.publishedBranch)
      throw new AppError((m) => m.run.split.published, 409);
    if (activeFollowUp(source.followUps)) throw new AppError((m) => m.run.split.followUp, 409);
    if (source.splitInto?.length)
      throw new AppError((m) => m.run.split.alreadySplit({ count: source.splitInto!.length }), 409);
    assertWorkspacePresent(source);
    // A part would carry the markers without the sync that guards approval and publishing.
    await assertConflictsResolved(source);
    const files = assertRequest(input, await ctx.diff(id));
    const repo = ctx.repo(source.repoId);

    const created: Run[] = [];
    try {
      for (const contribution of input.contributions)
        created.push(
          await ctx.lock(`repository:${repo.id}`, () =>
            createContribution(ctx, source, repo, contribution.title, contribution.paths, files),
          ),
        );
    } catch (error) {
      await ctx.lock(`repository:${repo.id}`, async () => {
        for (const run of created) await discardCheckout(repo, run.branch, run.worktreePath);
      });
      throw error;
    }

    const refs: SplitRef[] = created.map((run) => ({ runId: run.id, title: run.title }));
    source.splitInto = refs;
    ctx.log(source, "lead", sm().run.split.wasSplit({ count: created.length }), { kind: "notice" });
    // The first contribution ends up first in the list, as the person ordered them.
    for (const run of [...created].reverse()) ctx.store.data.runs.unshift(run);
    await ctx.store.save();
    return { run: source, created };
  });

  // The drafts are prepared in the background. The job is tracked, so shutdown()
  // waits for it instead of leaving a draft writing after the server has stopped.
  const drafts: Promise<void> = Promise.allSettled(
    result.created.map((run) =>
      ctx.prepareRunDraft(run.id, { automatic: true }).catch((error: unknown) => {
        log.warn("split.draft_failed", {
          runId: run.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }),
    ),
  )
    .then(() => undefined)
    .finally(() => ctx.jobs.delete(drafts));
  ctx.jobs.add(drafts);
  return result;
}
