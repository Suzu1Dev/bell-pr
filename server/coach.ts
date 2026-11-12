/**
 * The coach debrief: one read-only agent turn over the person's own
 * records for one project, modelled on the mentor's chat() turn
 * (learning.ts). It returns the taste dimension maintainers raised most,
 * with quotes the server checks against the records, up to 3
 * contrasting-case drills, and one next step. It describes the work, never
 * the person, and nothing here grades anyone.
 *
 * The result is stored on the repository (at most 5, newest last); its
 * drills join the practice deck.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { coachLimits, type CoachDebrief, type CoachDrill } from "../shared/coach.js";
import type { PonytailMode } from "../shared/efficiency.js";
import { defaultContributionSettings } from "../shared/insights.js";
import type { ModelExecution } from "../shared/models.js";
import { tasteDimensions, understandingWords } from "../shared/understanding.js";
import { currentLocale, shuttingDown } from "./i18n/index.js";
import { redact } from "./process.js";
import { coachPrompt, type CoachRecord } from "./prompts/coach.js";
import { assertRunAgentAllowed } from "./codex-guard.js";
import { runAgent } from "./run-executor.js";
import { parseAgentOutput } from "./run-events.js";
import { jsonText } from "./team.js";
import { AppError, type Repository, type Run } from "./types.js";
import type { WorkbenchContext } from "./workbench.js";

/** Maintainers' comments, by GitHub's authorAssociation. */
const maintainers = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

/**
 * How much of the records one debrief reads. The stored caps already bound
 * every field; these keep the whole prompt small enough for any model,
 * newest runs first.
 */
const readLimits = {
  title: 200,
  question: 600,
  answer: 1_000,
  correction: 300,
  summary: 1_200,
  line: 300,
  forecast: 200,
  comment: 1_500,
  lesson: 200,
  roads: 12,
  comments: 15,
  /** Characters of records JSON; older runs beyond it are left out. */
  total: 120_000,
} as const;

/** The least a quote must hold to show what a maintainer raised. */
const quoteMinWords = 3;

const cut = (text: string | undefined, max: number) =>
  text?.trim() ? redact(text.trim()).slice(0, max) : undefined;
const defined = <T extends object>(value: T) =>
  Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
const newestFirst = (a: Run, b: Run) =>
  b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);

/** One run's records for the coach, or undefined when it holds none. */
function coachRecord(run: Run): CoachRecord | undefined {
  const understanding = run.understanding;
  const answers = (understanding?.items ?? []).flatMap((item) => {
    const question = cut(item.question, readLimits.question);
    if (!question) return [];
    return [
      defined({
        path: item.path,
        question,
        answer: cut(item.answer, readLimits.answer) ?? "",
        dontKnow: item.dontKnow ? (true as const) : undefined,
        confidence: item.confidence,
        grade: item.grade,
        correction: cut(item.correction, readLimits.correction),
      }),
    ];
  });
  const roads = Object.entries(run.attempts ?? {})
    .flatMap(([filePath, attempt]) => {
      const road = attempt.road;
      if (!road || (!road.choice && !road.guess?.trim() && !road.why?.trim()))
        return [];
      return [
        defined({
          path: filePath,
          guess: cut(road.guess, readLimits.line),
          choice: road.choice,
          why: cut(road.why, readLimits.line),
        }),
      ];
    })
    .slice(0, readLimits.roads);
  const forecast = understanding?.forecast;
  const tags = run.feedbackTags ?? {};
  const feedback = (run.prFeedback?.items ?? [])
    .filter(
      (item) =>
        item.body.trim() &&
        (maintainers.has(item.authorAssociation) || tags[item.url]),
    )
    // The comments the person tagged first: they chose to learn from them.
    .sort((a, b) => Number(!!tags[b.url]) - Number(!!tags[a.url]))
    .slice(0, readLimits.comments)
    .map((item) => {
      const tag = tags[item.url];
      return defined({
        author: item.author,
        association: item.authorAssociation,
        kind: item.kind,
        path: item.path,
        state: item.state,
        comment: cut(item.body, readLimits.comment)!,
        tag: tag
          ? defined({
              dimension: tag.dimension,
              sawItComing: tag.predicted,
              lesson: cut(tag.lesson, readLimits.lesson),
            })
          : undefined,
      });
    });
  const summary = cut(understanding?.summary?.text, readLimits.summary);
  const forecastRecord =
    forecast && (forecast.dimension || forecast.question?.trim())
      ? defined({
          dimension: forecast.dimension,
          question: cut(forecast.question, readLimits.forecast),
        })
      : undefined;
  if (!summary && !answers.length && !roads.length && !forecastRecord && !feedback.length)
    return undefined;
  const pr = run.prFeedback;
  const outcome =
    pr && (pr.prState || pr.merged !== undefined || pr.reviewDecision)
      ? defined({
          prState: pr.prState,
          merged: pr.merged,
          reviewDecision: pr.reviewDecision,
        })
      : undefined;
  return defined({
    title: cut(run.title, readLimits.title) ?? "",
    status: run.status,
    outcome,
    summary,
    answers: answers.length ? answers : undefined,
    roads: roads.length ? roads : undefined,
    forecast: forecastRecord,
    feedback: feedback.length ? feedback : undefined,
  });
}

/** Every text of the records, for checking the coach's quotes. */
function recordTexts(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(recordTexts);
  if (value && typeof value === "object")
    return Object.values(value).flatMap(recordTexts);
  return [];
}

/**
 * The records a debrief of `repoId` reads: the project's runs that hold
 * any (newest first, at most 20, within the size budget), the runs they
 * came from and every text in them.
 */
export function coachRecords(runs: readonly Run[], repoId: string) {
  const read: { run: Run; record: CoachRecord }[] = [];
  let size = 0;
  for (const run of runs.filter((entry) => entry.repoId === repoId).sort(newestFirst)) {
    if (read.length === coachLimits.runIds) break;
    const record = coachRecord(run);
    if (!record) continue;
    size += JSON.stringify(record).length;
    if (read.length && size > readLimits.total) break;
    read.push({ run, record });
  }
  const records = read.map((entry) => entry.record);
  return {
    runs: read.map((entry) => entry.run),
    records,
    texts: recordTexts(records),
  };
}

/**
 * What the coach returns, for the CLIs' structured output (Codex
 * --output-schema, Claude Code --json-schema): every object closed, every
 * property required, `recurring` nullable. Lengths are checked while
 * parsing, as for the other agent schemas.
 */
export const coachJsonSchema = {
  type: "object",
  properties: {
    recurring: {
      anyOf: [
        {
          type: "object",
          properties: {
            dimension: { type: "string", enum: [...tasteDimensions] },
            quotes: {
              type: "array",
              items: { type: "string" },
              maxItems: coachLimits.quotes,
            },
          },
          required: ["dimension", "quotes"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    drills: {
      type: "array",
      items: {
        type: "object",
        properties: {
          context: { type: "string" },
          optionA: { type: "string" },
          optionB: { type: "string" },
          question: { type: "string" },
          reveal: { type: "string" },
        },
        required: ["context", "optionA", "optionB", "question", "reveal"],
        additionalProperties: false,
      },
      maxItems: coachLimits.drills,
    },
    nextStep: { type: "string" },
  },
  required: ["recurring", "drills", "nextStep"],
  additionalProperties: false,
};

const field = (max: number) => z.string().trim().min(1).max(max);
/** The strict output schema, with the caps of shared/coach.ts. */
const coachAnswerSchema = z
  .object({
    recurring: z
      .object({
        // Checked against tasteDimensions below: an unknown one is dropped.
        dimension: z.string().max(40),
        // Each quote is checked below; one that is not in the records goes.
        quotes: z.array(z.string().max(coachLimits.quoteChars * 4)).max(coachLimits.quotes),
      })
      .strict()
      .nullish(),
    drills: z
      .array(
        z
          .object({
            context: field(coachLimits.contextChars),
            optionA: field(coachLimits.optionChars),
            optionB: field(coachLimits.optionChars),
            question: field(coachLimits.questionChars),
            reveal: field(coachLimits.revealChars),
          })
          .strict(),
      )
      .max(coachLimits.drills),
    nextStep: field(coachLimits.nextStepChars),
  })
  .strict();

/** Outer quotation marks a model may add around a quote. */
const quotePairs: [string, string][] = [
  ['"', '"'],
  ["'", "'"],
  ["\u201c", "\u201d"],
  ["\u2018", "\u2019"],
  // Corner brackets, as Chinese text quotes.
  ["\u300c", "\u300d"],
  ["\u300e", "\u300f"],
  ["`", "`"],
];

function unquoted(text: string) {
  const trimmed = text.trim();
  const pair = quotePairs.find(
    ([open, close]) =>
      trimmed.length > open.length + close.length &&
      trimmed.startsWith(open) &&
      trimmed.endsWith(close),
  );
  return pair ? trimmed.slice(pair[0].length, -pair[1].length).trim() : trimmed;
}

/**
 * Validates the coach's answer: strict shape and caps, or 422. Each quote
 * must be an exact passage of the records (outer quotation marks aside)
 * of at least 3 words; the others are dropped, and so is `recurring` when
 * none is left or its dimension is not a taste dimension.
 */
export function parseCoachAnswer(
  answer: string,
  texts: readonly string[],
): Pick<CoachDebrief, "recurring" | "drills" | "nextStep"> {
  let parsed: z.infer<typeof coachAnswerSchema>;
  try {
    parsed = coachAnswerSchema.parse(JSON.parse(jsonText(answer)));
  } catch {
    throw new AppError((m) => m.understanding.debriefInvalid, 422);
  }
  const dimension = tasteDimensions.find(
    (value) => value === parsed.recurring?.dimension,
  );
  const quotes = [
    ...new Set(
      (parsed.recurring?.quotes ?? [])
        .map(unquoted)
        .filter(
          (quote) =>
            quote.length <= coachLimits.quoteChars &&
            understandingWords(quote) >= quoteMinWords &&
            texts.some((text) => text.includes(quote)),
        ),
    ),
  ];
  const drills: CoachDrill[] = parsed.drills;
  return {
    ...(dimension && quotes.length ? { recurring: { dimension, quotes } } : {}),
    ...(drills.length ? { drills } : {}),
    nextStep: parsed.nextStep,
  };
}

/** How the debrief's turn runs. */
export interface DebriefOptions {
  /**
   * The model, resolved from the project's saved settings as selected (the
   * route). Without it the newest run's model is used, as chat() uses its
   * run's.
   */
  model?: () => Promise<{ modelExecution: ModelExecution; ponytailMode?: PonytailMode }>;
}

/**
 * Writes a debrief of `repoId` from the person's records, in the request's
 * language, and stores it on the repository. One at a time per project.
 */
export async function writeDebrief(
  ctx: WorkbenchContext,
  repoId: string,
  options: DebriefOptions,
  running: Set<string>,
): Promise<CoachDebrief> {
  if (ctx.stopping()) throw new AppError(shuttingDown(), 503);
  const repo = ctx.repo(repoId);
  if (running.has(repoId))
    throw new AppError((m) => m.understanding.debriefRunning, 409);
  const read = coachRecords(ctx.store.data.runs, repoId);
  if (!read.runs.length)
    throw new AppError((m) => m.understanding.debriefNoRecords, 422);
  assertRunAgentAllowed({ modelExecution: read.runs[0].modelExecution });
  running.add(repoId);
  const work = (async () => {
    const controller = new AbortController();
    const controllerKey = `coach:${repoId}`;
    ctx.controllers.set(controllerKey, controller);
    let temporary: string | undefined;
    try {
      const locale = currentLocale();
      const newest = read.runs[0];
      const selected = options.model
        ? await options.model()
        : {
            modelExecution: newest.modelExecution ?? { source: "cli-default" as const },
            ponytailMode: newest.contributionSettings?.ponytailMode,
          };
      // The coach reads only the records: never the web, and not what an
      // earlier turn of the run reported about its model.
      const {
        webAccess: _web,
        reported: _reported,
        ...modelExecution
      } = selected.modelExecution;
      temporary = await mkdtemp(path.join(os.tmpdir(), "bell-coach-"));
      const outputSchema = path.join(temporary, "coach-schema.json");
      await writeFile(outputSchema, JSON.stringify(coachJsonSchema), { mode: 0o600 });
      // The turn runs on a copy of the newest run, so its log, efficiency
      // and status lines stay off the person's runs; the agent works in an
      // empty folder and receives the records in the prompt.
      const { team: _team, efficiency: _efficiency, ...base } = newest;
      const ponytailMode =
        selected.ponytailMode ?? base.contributionSettings?.ponytailMode;
      const host: Run = {
        ...base,
        agents: [],
        logs: [],
        reports: {},
        worktreePath: temporary,
        modelExecution,
        // runAgent reads the efficiency mode from here.
        contributionSettings: {
          ...(base.contributionSettings ?? defaultContributionSettings),
          ...(ponytailMode ? { ponytailMode } : {}),
        },
      };
      const answer = await runAgent(
        ctx,
        host,
        "coach",
        coachPrompt({ locale, project: repo.fullName, records: read.records }),
        controller.signal,
        true,
        { cwd: temporary, outputSchema, isolated: true },
      );
      const result = parseAgentOutput(host, "coach", () =>
        parseCoachAnswer(answer, read.texts),
      );
      const debrief: CoachDebrief = {
        at: new Date().toISOString(),
        locale,
        runIds: read.runs.map((run) => run.id),
        ...result,
      };
      // The project may have been removed while the coach wrote.
      const stored = ctx.repo(repoId);
      stored.debriefs = [...(stored.debriefs ?? []), debrief].slice(-coachLimits.debriefs);
      await ctx.store.save();
      return debrief;
    } finally {
      if (ctx.controllers.get(controllerKey) === controller)
        ctx.controllers.delete(controllerKey);
      if (temporary) await rm(temporary, { recursive: true, force: true });
      running.delete(repoId);
    }
  })();
  // Shutdown waits for the turn and its save, as for other agent work.
  const tracked: Promise<void> = work.then(
    () => undefined,
    () => undefined,
  );
  ctx.jobs.add(tracked);
  void tracked.finally(() => ctx.jobs.delete(tracked));
  return work;
}

/**
 * The stored debriefs of a project as this build can show them, newest
 * first. A taste dimension a later build wrote and this build does not
 * know leaves its recurring line out.
 */
export function readableDebriefs(repo: Repository): CoachDebrief[] {
  return [...(repo.debriefs ?? [])]
    .sort((a, b) => b.at.localeCompare(a.at))
    .map(({ recurring, ...debrief }) =>
      recurring && tasteDimensions.includes(recurring.dimension)
        ? { ...debrief, recurring }
        : debrief,
    );
}
