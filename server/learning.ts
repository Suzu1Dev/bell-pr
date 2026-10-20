/**
 * What helps the person learn from a finished run: explanations of each
 * changed file, follow-up questions to a mentor, their own notes, the
 * maintainers' feedback on the published PR, and a fresh independent review
 * after they edited the worktree by hand. In a Learn-by-hand run:
 * explanations of the person's own code only after Ready and their own
 * answer, the Ask tab through the guide, every agent text filtered before
 * it is stored, and the person's pushed follow-up commits taken over at the
 * feedback read.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { command, redact } from "./process.js";
import { baseFileLines, parseGitHubSource, readDiff } from "./git.js";
import {
  conversationContentLimit,
  conversationMessageLimit,
  type ChatMessage,
} from "../shared/chat.js";
import { AppError, withRunLocale, type DiffFile, type Repository, type Run } from "./types.js";
import { log } from "./log.js";
import { shuttingDown, sm, type ServerMessages } from "./i18n/index.js";
import {
  explanationBatches,
  explanationJsonSchema,
  explanationPrompt,
  feedbackForAgent,
  guidePrompt,
  parseExplanations,
} from "./explanations.js";
import { parsePrFeedback, prFeedbackQuery, prNumberOf } from "./pr-feedback.js";
import { contributionContext } from "./prompts/team.js";
import { runAgent, runIndependentReview } from "./run-executor.js";
import { parseAgentOutput } from "./run-events.js";
import type { WorkbenchContext } from "./workbench.js";
import { filterAgentText, filterCodeField } from "../shared/by-hand-filter.js";
import type { ChangeExplanation } from "../shared/explanations.js";
import * as guide from "./by-hand-guide.js";
import { filteredError, turnFiles } from "./by-hand-filter.js";
import { assertHelpAllowed, recordHelp } from "./by-hand-record.js";
import { takeOverOwnCommits } from "./by-hand-takeover.js";
import { assertReady, countRemoved, reviewAgain } from "./by-hand.js";
import { planUnderstanding, understandingRequired } from "./understanding.js";

const now = () => new Date().toISOString();
const refuse = (message: (m: ServerMessages) => string) => new AppError(message, 409);
/** The person's diff, which the filter accepts code from. */
const patches = (files: readonly DiffFile[]) => files.map((file) => file.patch).join("\n");
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
  if (ctx.stopping()) throw new AppError(shuttingDown(), 503);
  const run = ctx.run(id);
  // Learn by hand: the guide's review of the ready version (409 before Ready), never the team's prompts.
  if (run.learnByHand) return reviewAgain(ctx, id);
  if (!["review", "approved"].includes(run.status) || run.publishing)
    throw new AppError((m) => m.run.review.rerunNotAllowed, 409);
  if (ctx.reviewJobs.has(id) || ctx.controllers.has(id))
    throw new AppError((m) => m.run.review.rerunRunning, 409);
  // Registering the controller first makes a concurrent request a 409 and
  // lets Stop abort the reviewers through the usual run-level controller.
  const controller = new AbortController();
  ctx.controllers.set(id, controller);
  let files: Awaited<ReturnType<typeof readDiff>>;
  try {
    files = await ctx.lock(id, () => ctx.diff(id));
    if (!files.length)
      throw new AppError((m) => m.run.review.nothingToReview, 422);
  } catch (error) {
    ctx.controllers.delete(id);
    throw error;
  }
  const reviewers = run.agents.filter(
    (agent) => agent.id === "reviewer" || agent.id === "tester",
  );
  for (const agent of reviewers) {
    agent.status = "running";
    agent.detail = sm().run.agents.rerunWaiting;
  }
  ctx.log(
    run,
    "user",
    sm().run.review.rerunRequested({ files: files.length }),
  );
  // The rerun is background work of the run: it uses the run's locale.
  const job = withRunLocale(run, async () => {
    try {
      await runIndependentReview(
        ctx,
        run,
        files,
        run.reports?.implementer,
        controller.signal,
      );
      ctx.log(run, "system", sm().run.review.rerunDone);
    } catch (error) {
      for (const agent of reviewers)
        if (agent.status === "running") {
          agent.status = "failed";
          agent.detail = sm().run.agents.failed;
        }
      ctx.log(
        run,
        "system",
        controller.signal.aborted
          ? sm().run.review.rerunStopped
          : redact(
              error instanceof Error
                ? error.message
                : sm().run.review.rerunIncomplete,
            ),
      );
    } finally {
      if (ctx.controllers.get(id) === controller)
        ctx.controllers.delete(id);
      ctx.reviewJobs.delete(id);
      await ctx.store.save();
    }
  })
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
  if (ctx.stopping()) throw new AppError(shuttingDown(), 503);
  const run = ctx.run(id);
  if (!readableStatuses.includes(run.status) || run.publishing)
    throw new AppError((m) => m.run.review.explanationsTooEarly, 409);
  const files = await ctx.lock(id, () => ctx.diff(id));
  if (ctx.stopping()) throw new AppError(shuttingDown(), 503);
  if (
    options.filePath &&
    !files.some((file) => file.path === options.filePath)
  )
    throw new AppError((m) => m.run.review.fileNotFound, 404);
  // Learn by hand: after Ready, one file, after its own Explain-it-back answer (F10).
  if (run.learnByHand)
    assertReaderView(run, files, options.filePath, ctx.store.data.repos.find((repo) => repo.id === run.repoId));
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
      const job = generateExplanations(ctx, run, selected)
        // Waited on by later requests and at shutdown; a failed save must
        // not become an unhandled rejection that stops the server.
        .catch((error) =>
          log.error("explanations failed", { runId: id, error: String(error) }),
        )
        .finally(() => {
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
  const fail = (batch: typeof files, failure: unknown) => {
    // Learn by hand: what the agent may have written in its error is filtered (F7).
    const error = run.learnByHand ? filteredError(failure) : failure;
    const message = controller.signal.aborted
      ? sm().run.review.explanationsStopped
      : redact(
          error instanceof Error
            ? error.message
            : sm().run.review.explanationsFailed,
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
      throw new AppError((m) => m.run.review.explanationsCancelled, 409);
    temporary = await mkdtemp(path.join(os.tmpdir(), "bell-explanations-"));
    const outputSchema = path.join(temporary, "response-schema.json");
    await writeFile(outputSchema, JSON.stringify(explanationJsonSchema), {
      mode: 0o600,
    });
    for (const batch of explanationBatches(files)) {
      if (controller.signal.aborted)
        throw new AppError((m) => m.run.review.explanationsCancelled, 409);
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
        const generated = parseAgentOutput(run, "explanations", () =>
          parseExplanations(answer, batch),
        );
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
          // Learn by hand: filtered (F7) and recorded as help before it is stored.
          const filtered = run.learnByHand
            ? await filterExplanation(run, [...current.values()], file.path, content)
            : undefined;
          if (filtered) recordStoredHelp(run, "explanation", filtered.removed);
          run.explanations![file.path] = {
            fingerprint: file.fingerprint,
            status: "ready",
            content: filtered?.value ?? content,
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
 * The base version of a modified file in the current diff, for reading the
 * unchanged code around its hunks. The fingerprint ties the request to the
 * diff the person sees, and the base commit to the version it was read
 * from (a sync can keep a patch, and so its fingerprint, while the base
 * moves); added and deleted files are shown whole already.
 */
export async function contextLines(
  ctx: WorkbenchContext,
  id: string,
  filePath: string,
  fingerprint: string,
  baseSha: string,
) {
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    if (run.baseSha !== baseSha)
      throw new AppError((m) => m.run.context.baseMoved, 409);
    const file = (await readDiff(run)).find((entry) => entry.path === filePath);
    if (!file) throw new AppError((m) => m.run.review.fileNotFound, 404);
    if (file.blocked) throw new AppError((m) => m.run.context.blocked, 409);
    if (file.fingerprint !== fingerprint)
      throw new AppError((m) => m.run.context.stale, 409);
    if (file.status !== "modified")
      throw new AppError((m) => m.run.context.wholeFile, 409);
    return { lines: await baseFileLines(run, filePath) };
  });
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
      throw new AppError((m) => m.run.review.notesTooEarly, 409);
    const file = (await ctx.diff(id)).find(
      (value) => value.path === filePath,
    );
    if (!file) throw new AppError((m) => m.run.review.fileNotFound, 404);
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

/**
 * Answers a question about one changed file. Unlike the run's background
 * work, the mentor answers in the language of the person asking: the
 * request's locale, not the run's.
 */
export async function chat(
  ctx: WorkbenchContext,
  id: string,
  filePath: string,
  question: string,
) {
  if (ctx.run(id).learnByHand) return chatByHand(ctx, id, filePath, question);
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    if (!readableStatuses.includes(run.status))
      throw new AppError((m) => m.run.review.chatTooEarly, 409);
    const file = (await ctx.diff(id)).find(
      (value) => value.path === filePath,
    );
    if (!file || file.blocked)
      throw new AppError((m) => m.run.review.chatUnavailable, 422);
    // The run record is the only copy of the conversation: turns about an
    // older version of the file stay readable but are not fed back.
    const stored = run.conversations?.[filePath]?.messages ?? [];
    const messages = stored
      .filter((message) => message.fingerprint === file.fingerprint)
      .map(
        (message) =>
          `${message.role === "user" ? "User" : "Mentor"}: ${message.content}`,
      );
    // Only thread comments attached to this file reach the mentor, and with
    // web access on only those of the repository's own people.
    const feedback = feedbackForAgent(
      (run.prFeedback?.items ?? []).filter((item) => item.path === file.path),
      run.modelExecution?.webAccess === true,
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
 * Reads the published PR's reviews, comments, threads, CI and state (open,
 * merged or closed, and the review decision) once, on the learner's
 * request. Read-only: BELL never replies or resolves anything on GitHub,
 * and nothing polls this. The run status is unchanged.
 */
export async function fetchPrFeedback(ctx: WorkbenchContext, id: string) {
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    if (run.status !== "published" || !run.prUrl)
      throw new AppError((m) => m.run.review.feedbackUnpublished, 409);
    const repo = ctx.repo(run.repoId);
    const remote = parseGitHubSource(repo.url);
    const prNumber = remote && prNumberOf(run.prUrl, remote.url);
    if (!remote || !prNumber)
      throw new AppError((m) => m.run.review.feedbackMismatch, 422);
    // Learn by hand: commits the person pushed from the run's folder are taken over first.
    if (run.learnByHand) await takeOverOwnCommits(ctx, run);
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
      throw new AppError((m) => m.run.review.githubInvalidJson, 502);
    }
    run.prFeedback = parsePrFeedback(response, {
      repositoryUrl: remote.url,
      prNumber,
      fetchedAt: now(),
    });
    ctx.log(
      run,
      "system",
      sm().run.review.feedbackRead({
        number: prNumber,
        items: run.prFeedback.items.length,
      }),
    );
    await ctx.store.save();
    return run;
  });
}

// Learn by hand (DESIGN v1.2): "How a reader sees your change" (F10), the
// per-file Ask tab after Ready (F6) and the filter of what agents wrote
// about the person's change (F7).

/**
 * A filter of what an agent wrote about the person's change, before it is
 * stored (F7), over the changed files and the `cited` ones (at most 10,
 * cited first) at base and in the worktree; `removed` counts what it took
 * out.
 */
export async function changeFilter(run: Run, files: readonly DiffFile[], cited: readonly string[] = []) {
  const changed = files.map((file) => file.path);
  const sources = await turnFiles(run).sources([...cited.filter(Boolean), ...changed], {
    diff: patches(files),
    protectedFiles: changed,
  });
  let removed = 0;
  const text = (value: string) => {
    const filtered = filterAgentText(value, sources);
    removed += filtered.removed;
    return filtered.value;
  };
  return {
    get removed() {
      return removed;
    },
    text,
    /**
     * A field that may hold code: kept as written when it is verbatim lines
     * of base or worktree (rule 3), otherwise filtered as prose (rules 1-2).
     * An explanation's example before/after is everyday prose by its prompt,
     * and a card without an example is made again (synchronizeExplanations),
     * so the field is never dropped whole.
     */
    code: (value: string) => (filterCodeField(value, sources).value !== undefined ? value : text(value)),
  };
}

/** An explanation card of the person's change, filtered (F7) field by field. */
export async function filterExplanation(run: Run, files: readonly DiffFile[], filePath: string, content: ChangeExplanation) {
  const filter = await changeFilter(run, files, [filePath]);
  const example = content.example && {
    scenario: filter.text(content.example.scenario),
    before: filter.code(content.example.before),
    after: filter.code(content.example.after),
  };
  const value: ChangeExplanation = {
    summary: filter.text(content.summary),
    reason: filter.text(content.reason),
    concept: filter.text(content.concept),
    tip: filter.text(content.tip),
    ...(example ? { example } : {}),
    ...(content.alternatives ? { alternatives: filter.text(content.alternatives) } : {}),
    ...(content.lookup ? { lookup: content.lookup.map(filter.text) } : {}),
    ...(content.selfCheck
      ? { selfCheck: { question: filter.text(content.selfCheck.question), answer: filter.text(content.selfCheck.answer) } }
      : {}),
  };
  return { value, removed: filter.removed };
}

/** Stores filtered output's removals on the run and records its help event (F13). */
export function recordStoredHelp(run: Run, source: "explanation" | "walkthrough" | "premise", removed: number) {
  recordHelp(run, { source, ...(removed ? { removed } : {}) });
  countRemoved(run, removed);
}


/**
 * "How a reader sees your change" (F10): after Ready, one file per
 * request, and only when that file's Explain-it-back question has an
 * answer at its current version, or the file has no question and every
 * question is answered, or the check is off.
 */
export function assertReaderView(run: Run, files: readonly DiffFile[], filePath: string | undefined, repo?: Repository) {
  assertReady(run, files);
  if (!filePath) throw refuse((m) => m.byHand.flow.oneFile);
  assertHelpAllowed(run, "explain");
  if (!understandingRequired()) return;
  const saved = run.understanding?.items ?? [];
  const answered = (item: { id: string; path?: string; fingerprint?: string }) =>
    saved.some((entry) => entry.id === item.id && entry.path === item.path && (!item.path || entry.fingerprint === item.fingerprint));
  const plan = planUnderstanding(run, files, repo);
  const own = plan.find((item) => item.path === filePath);
  if (own ? answered(own) : plan.every(answered)) return;
  throw refuse((m) => m.byHand.flow.answerFirst);
}

/**
 * The per-file Ask tab of a Learn-by-hand run (F6): after Ready only, the
 * guide's chat (server/by-hand-guide.ts) instead of the mentor; it filters
 * the answer and records its help event. The run lock is held to read the
 * change and to save, never across the turn, and the answer is stored in
 * `run.conversations` as an agent run's answer is. It takes the guide's
 * one slot (`guide:<id>`) under the lock, so a guide job is never
 * displaced and Stop ends whichever turn holds it.
 */
async function chatByHand(ctx: WorkbenchContext, id: string, filePath: string, question: string) {
  const key = `guide:${id}`;
  const controller = new AbortController();
  const { run, file } = await ctx.lock(id, async () => {
    const run = ctx.run(id);
    if (!readableStatuses.includes(run.status)) throw new AppError((m) => m.run.review.chatTooEarly, 409);
    const files = await ctx.diff(id);
    assertReady(run, files);
    const file = files.find((value) => value.path === filePath);
    if (!file || file.blocked) throw new AppError((m) => m.run.review.chatUnavailable, 422);
    assertHelpAllowed(run, "answer");
    // One guide turn at a time: a guide job or another question holds the key.
    if (ctx.byHandJobs.has(key) || ctx.controllers.has(key)) throw new AppError((m) => m.byHand.busy, 409);
    // Taken under the lock, so a guide job asked for meanwhile waits for it and Stop ends this turn.
    ctx.controllers.set(key, controller);
    return { run, file };
  });
  let answer: string;
  try {
    answer = await guide.chat(ctx, run, filePath, question, controller.signal);
  } finally {
    if (ctx.controllers.get(key) === controller) ctx.controllers.delete(key);
  }
  return ctx.lock(id, async () => {
    const stored = run.conversations?.[filePath]?.messages ?? [];
    const turn = (role: ChatMessage["role"], content: string): ChatMessage => ({
      role,
      content: redact(content).slice(0, conversationContentLimit),
      fingerprint: file.fingerprint,
    });
    run.conversations = {
      ...run.conversations,
      [filePath]: {
        fingerprint: file.fingerprint,
        messages: [...stored, turn("user", question), turn("assistant", answer)].slice(-conversationMessageLimit),
        updatedAt: now(),
      },
    };
    await ctx.store.save();
    return answer;
  });
}
