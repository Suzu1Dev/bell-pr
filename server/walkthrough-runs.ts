/**
 * Function walkthroughs of a finished run: one read-only agent turn per
 * modified code file, in the run's checkout, prepared on request (the
 * workspace asks for them file after file, the file being read first) and
 * cached by the file's diff fingerprint in Run.walkthroughs.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { checkoutLineCount, readDiff } from "./git.js";
import { currentLocale, shuttingDown, sm } from "./i18n/index.js";
import { log } from "./log.js";
import { redact } from "./process.js";
import { contributionContext } from "./prompts/team.js";
import { walkthroughPrompt } from "./prompts/walkthroughs.js";
import { runAgent } from "./run-executor.js";
import { parseAgentOutput } from "./run-events.js";
import { AppError, withRunLocale, type DiffFile, type Run } from "./types.js";
import {
  addedLines,
  parseWalkthrough,
  walkthroughJsonSchema,
  walkthroughKeyPrefix,
} from "./walkthroughs.js";
import type { WorkbenchContext } from "./workbench.js";
import type { CodeReference, FileWalkthrough } from "../shared/walkthroughs.js";
import { assertReaderView, changeFilter, recordStoredHelp } from "./learning.js";

const now = () => new Date().toISOString();

/** The file's walkthrough still waits for the job that began this version of it. */
function generating(run: Run, file: DiffFile) {
  const stored = run.walkthroughs?.[file.path];
  return (
    stored?.status === "generating" && stored.fingerprint === file.fingerprint
  );
}
/** Statuses whose diff is final enough to walk through. */
const readableStatuses: Run["status"][] = [
  "review",
  "approved",
  "published",
  "failed",
  "cancelled",
];

/**
 * Explains the functions around one file's changes, from the current
 * checkout, with a read-only agent that may search for callers. A pending
 * walkthrough (or a failed one, on retry) is generated; any other state is
 * returned as it is. Waits for a walkthrough of the same file already
 * being made.
 */
export async function walkthrough(
  ctx: WorkbenchContext,
  id: string,
  filePath: string,
  retry = false,
) {
  if (ctx.stopping()) throw new AppError(shuttingDown(), 503);
  const run = ctx.run(id);
  if (!readableStatuses.includes(run.status) || run.publishing)
    throw new AppError((m) => m.run.walkthrough.tooEarly, 409);
  // Learn by hand: after Ready, and after the file's own Explain-it-back answer (F10).
  if (run.learnByHand) {
    const files = await ctx.lock(id, () => ctx.diff(id));
    if (!files.some((entry) => entry.path === filePath))
      throw new AppError((m) => m.run.review.fileNotFound, 404);
    assertReaderView(run, files, filePath, ctx.store.data.repos.find((repo) => repo.id === run.repoId));
  }
  const key = `${id}\0${filePath}`;
  const existing = ctx.walkthroughJobs.get(key);
  if (existing) await existing;
  else {
    const file = (await ctx.lock(id, () => ctx.diff(id))).find(
      (entry) => entry.path === filePath,
    );
    if (!file) throw new AppError((m) => m.run.review.fileNotFound, 404);
    // With no job for this file, "generating" was left by a job that
    // stopped without a result: it is made again, like a pending one.
    const wanted =
      file.walkthroughStatus === "pending" ||
      file.walkthroughStatus === "generating" ||
      (retry && file.walkthroughStatus === "failed");
    if (wanted) {
      // Background work of the run: its agent and its messages use the run's language.
      const job = withRunLocale(run, () => generateWalkthrough(ctx, run, file))
        // Waited on by later requests and at shutdown; a failed save must
        // not become an unhandled rejection that stops the server.
        .catch((error) =>
          log.error("walkthrough failed", { runId: id, error: String(error) }),
        )
        .finally(() => {
          ctx.walkthroughJobs.delete(key);
          ctx.jobs.delete(job);
        });
      ctx.walkthroughJobs.set(key, job);
      ctx.jobs.add(job);
      await job;
    }
  }
  return { run, files: await ctx.lock(id, () => ctx.diff(id)) };
}

async function generateWalkthrough(
  ctx: WorkbenchContext,
  run: Run,
  file: DiffFile,
) {
  const controller = new AbortController();
  // Ends with the run id, so runBusy sees it and shutdown stops it.
  const key = `${walkthroughKeyPrefix}${file.path}:${run.id}`;
  ctx.controllers.set(key, controller);
  run.walkthroughs![file.path] = {
    fingerprint: file.fingerprint,
    status: "generating",
  };
  let temporary: string | undefined;
  try {
    await ctx.store.save();
    temporary = await mkdtemp(path.join(os.tmpdir(), "bell-walkthrough-"));
    const outputSchema = path.join(temporary, "walkthrough-schema.json");
    await writeFile(outputSchema, JSON.stringify(walkthroughJsonSchema), {
      mode: 0o600,
    });
    const answer = await runAgent(
      ctx,
      run,
      "walkthrough",
      walkthroughPrompt({
        locale: currentLocale(),
        contributionContext: `${run.title}\n${contributionContext(run)}`,
        file,
      }),
      controller.signal,
      true,
      // Isolated keeps it offline and out of the team inbox and the
      // reports; it still reads this checkout to find callers.
      { outputSchema, isolated: true },
    );
    // A sync or a premise check may have gone ahead of this job; the
    // checkout is read, and the result kept, only between them.
    await ctx.lock(run.id, async () => {
      const lineCount = await checkoutLineCount(run, file.path);
      const content = parseAgentOutput(run, "walkthrough", () =>
        parseWalkthrough(answer, lineCount, addedLines(file.patch)),
      );
      const files = await readDiff(run);
      const current = files.find((entry) => entry.path === file.path);
      // The file changed while the agent read it, or a changed premise
      // verdict asked for the walkthroughs again: the next diff asks again.
      if (
        current?.fingerprint !== file.fingerprint ||
        current.blocked ||
        !generating(run, file)
      )
        return;
      // Learn by hand: filtered (F7) and recorded as help before it is stored.
      const filtered = run.learnByHand ? await filterWalkthrough(run, files, file.path, content) : undefined;
      if (filtered) recordStoredHelp(run, "walkthrough", filtered.removed);
      run.walkthroughs![file.path] = {
        fingerprint: file.fingerprint,
        status: "ready",
        content: filtered?.value ?? content,
        generatedAt: now(),
      };
    });
  } catch (error) {
    const stored = run.walkthroughs?.[file.path];
    const message = controller.signal.aborted
      ? sm().run.walkthrough.stopped
      : redact(
          error instanceof Error ? error.message : sm().run.walkthrough.failed,
        );
    // One asked for again meanwhile is not a failure: the next diff asks again.
    if (stored && generating(run, file)) {
      run.walkthroughs![file.path] = { ...stored, status: "failed", error: message };
      ctx.log(
        run,
        "walkthrough",
        sm().run.walkthrough.notFinished({ path: file.path, reason: message }),
      );
    }
  } finally {
    if (ctx.controllers.get(key) === controller) ctx.controllers.delete(key);
    if (temporary) await rm(temporary, { recursive: true, force: true });
    await ctx.store.save();
  }
}

/** A walkthrough of the person's change, filtered (F7): every prose field. */
async function filterWalkthrough(run: Run, files: readonly DiffFile[], filePath: string, content: FileWalkthrough) {
  const cited = content.functions.flatMap((unit) => [...unit.callers, ...unit.callees].map((ref) => ref.path));
  const filter = await changeFilter(run, files, [filePath, ...cited]);
  const reference = (ref: CodeReference) => ({ ...ref, note: filter.text(ref.note) });
  const value: FileWalkthrough = {
    ...content,
    functions: content.functions.map((unit) => ({
      ...unit,
      summary: filter.text(unit.summary),
      change: filter.text(unit.change),
      steps: unit.steps.map((step) => ({ ...step, explanation: filter.text(step.explanation) })),
      callers: unit.callers.map(reference),
      callees: unit.callees.map(reference),
      analogy: filter.text(unit.analogy),
      selfCheck: { question: filter.text(unit.selfCheck.question), answer: filter.text(unit.selfCheck.answer) },
    })),
  };
  return { value, removed: filter.removed };
}
