import {
  chmod,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  withRunLocale,
  type Database,
  type Repository,
  type Run,
  type RunStatus,
} from "./types.js";
import { activeFollowUp } from "../shared/followups.js";
import { withStoredReach } from "../shared/project-policy.js";
import { splitLimits } from "../shared/split.js";
import { sm } from "./i18n/index.js";
import { writeDurable } from "./fs-atomic.js";
import { initLog, log } from "./log.js";
import { lenientRead } from "./persisted-schema.js";
import { bindStoredGitDirs } from "./process.js";

/** What loading state.json had to repair at this start; GET /api/status shows it. */
export interface StoreRecovery {
  /** The backup the state came from because state.json was unreadable, such as "state.json.bak.1". */
  restoredFrom?: string;
  /** Runs that failed validation and were moved to state.quarantine.json. */
  quarantinedRuns: number;
  /** Repositories moved there for the same reason; absent when none. */
  quarantinedRepos?: number;
}

const stateFile = "state.json";
const quarantineFile = "state.quarantine.json";
const backupCount = 3;

const runStatuses = [
  "queued",
  "running",
  "awaiting_plan",
  "review",
  "approved",
  "published",
  "failed",
  "cancelled",
] as const satisfies readonly RunStatus[];

/**
 * The read schema of state.json. Every object passes unknown fields through,
 * so a field written by a newer build survives a load and save here. Only
 * the fields this build reads without checking are required, all of which
 * every build has written since the first one; a run or repository that
 * fails is moved to state.quarantine.json instead of stopping the server.
 */
const loose = <T extends z.ZodRawShape>(shape: T) =>
  z.object(shape).passthrough();
const text = z.string();
const list = z.array(text);
const count = z.number();
/**
 * The fields added in v1.1 (all optional). Their caps are the write caps;
 * lenientRead allows four times as much, so a later build may raise them
 * within that margin. Vocabularies (confidences, grades, dimensions, policy
 * kinds) are plain text, so a value from a later build still loads. A
 * value of one of these fields that this build cannot read is left out
 * (`catch`) instead of moving the whole run or repository to quarantine.
 */
const later = <T extends z.ZodTypeAny>(schema: T) =>
  schema.optional().catch(undefined);

const doorSchema = loose({
  hasPullRequests: z.boolean().optional(),
  pullRequestCreationPolicy: text.optional(),
  archived: z.boolean().optional(),
  disabled: z.boolean().optional(),
  viewerPermission: text.optional(),
  login: text.optional(),
});

/** Carve-out quotes of a project rule and the help kinds each names (PolicyFinding.allows). */
const allowsSchema = z
  .array(loose({ line: count, quote: text.max(300), kinds: list.max(5) }))
  .max(3);
/** A finding from BELL's checked list of off-repository rules (PolicyFinding.source). */
const registrySourceSchema = loose({
  registry: text.max(60),
  url: text.max(300),
  version: text.max(80).optional(),
  checkedOn: text,
});

const contributionRulesSchema = loose({
  baseSha: text.optional(),
  checkedAt: text,
  door: doorSchema.optional(),
  findings: z
    .array(
      loose({
        kind: text,
        path: text,
        line: count,
        quote: text.max(300),
        contribution: z.boolean(),
        // v1.2: a finding from BELL's checked list of off-repository rules,
        // and the carve-outs that name kinds of help.
        source: later(registrySourceSchema),
        allows: later(allowsSchema),
        // v1.2: a ban's or reserved-issue rule's reach (text, so a later
        // value loads) and a ban that stops the quoted confirm.
        reach: later(text),
        stopsConfirm: later(z.literal(true)),
      }),
    )
    .max(30),
  filesRead: list.max(60),
  generated: list.max(30).optional(),
  mergedSizes: z
    .array(
      loose({
        number: count,
        additions: count,
        deletions: count,
        changedFiles: count,
      }),
    )
    .max(3)
    .optional(),
  orgDefaults: text.optional(),
  unknown: list.optional(),
  // v1.2: the project's human help channels.
  channels: later(
    z
      .array(loose({ label: text.max(80), url: text.max(300), path: text.optional(), line: count.optional() }))
      .max(5),
  ),
});

const debriefSchema = loose({
  at: text,
  locale: text,
  runIds: list.max(20),
  recurring: loose({ dimension: text, quotes: z.array(text.max(300)).max(3) }).optional(),
  drills: z
    .array(
      loose({
        context: text.max(600),
        optionA: text.max(1200),
        optionB: text.max(1200),
        question: text.max(300),
        reveal: text.max(1200),
      }),
    )
    .max(3)
    .optional(),
  nextStep: text.max(300),
});

const understandingSchema = loose({
  summary: loose({
    text: text.max(1200),
    changeFingerprint: text,
    at: text,
    confirmedAt: text.optional(),
  }).optional(),
  items: z
    .array(
      loose({
        id: text,
        path: text.optional(),
        fingerprint: text.optional(),
        source: text,
        question: text.max(1800),
        answer: text.max(1000),
        dontKnow: z.boolean().optional(),
        confidence: text,
        lockedAt: text,
        grade: text.optional(),
        correction: text.max(300).optional(),
        gradedAt: text.optional(),
      }),
    )
    .max(6)
    .optional(),
  passedAt: text.optional(),
  passedFingerprint: text.optional(),
  passedFiles: z.record(text, text).optional(),
  startedAt: text.optional(),
  forecast: loose({
    dimension: text.optional(),
    question: text.max(200).optional(),
    at: text,
  }).optional(),
  history: z
    .array(
      loose({
        passedAt: text,
        questions: count,
        misses: count,
        confidentMisses: count,
        seconds: count.optional(),
        round: text.optional(),
      }),
    )
    .max(20)
    .optional(),
});

const attemptSchema = loose({
  fingerprint: text,
  quiz: loose({
    answer: text.max(1000).optional(),
    confidence: text.optional(),
    grade: text.optional(),
    skipped: z.boolean().optional(),
    at: text,
  }).optional(),
  road: loose({
    guess: text.max(300).optional(),
    choice: text.optional(),
    why: text.max(300).optional(),
    at: text,
  }).optional(),
  // v1.2: walkthrough units' "Check yourself" answers, keyed name:startLine (12 at most).
  walkthroughs: later(
    z.record(
      text.max(300),
      loose({
        answer: text.max(1000).optional(),
        confidence: text.optional(),
        grade: text.optional(),
        skipped: z.boolean().optional(),
        at: text,
      }),
    ),
  ),
});

/**
 * A Learn-by-hand run's record (`RunCore.byHand`, shared/by-hand.ts), with
 * its write caps. Each part is read on its own, so a part this build cannot
 * read is left out without the rest.
 */
const guideEntrySchema = loose({
  id: text,
  at: text,
  kind: text,
  stepId: text.optional(),
  rung: count.optional(),
  entry: text.optional(),
  question: text.max(600).optional(),
  tried: text.max(300).optional(),
  text: text.max(1200),
  ask: text.max(300).optional(),
  refs: z.array(loose({ path: text, line: count, endLine: count.optional() })).max(5).optional(),
  quotes: z
    .array(loose({ path: text, startLine: count, endLine: count, from: text, text: text.max(1200) }))
    .max(3)
    .optional(),
  options: z.array(loose({ name: text.max(80), tradeoff: text.max(300) })).max(3).optional(),
  removed: count.optional(),
  dropped: count.optional(),
  changeFingerprint: text.optional(),
  model: text.optional(),
});
const helpLockSchema = loose({
  kinds: list.max(5),
  at: text,
  rulesCheckedAt: text,
  rules: z
    .array(
      loose({
        kind: text,
        path: text,
        line: count,
        quote: text.max(300),
        allows: allowsSchema,
        source: registrySourceSchema.optional(),
      }),
    )
    .max(4),
});
const byHandSchema = loose({
  guidePlan: later(
    loose({
      summary: text.max(1200),
      steps: z.array(loose({ title: text.max(80), files: list.max(8) })).max(8),
      readFirst: z
        .array(loose({ path: text, startLine: count, endLine: count, why: text.max(200) }))
        .max(5)
        .optional(),
      at: text,
      removed: count.optional(),
      dropped: count.optional(),
    }),
  ),
  plan: later(
    loose({
      steps: z
        .array(
          loose({
            id: text,
            title: text.max(120),
            files: list.max(8).optional(),
            how: text.max(400).optional(),
            doneAt: text.optional(),
            parkedAt: text.optional(),
            maxRung: count.optional(),
            why: text.max(300).optional(),
            chosen: loose({ entryId: text, option: count, why: text.max(300) }).optional(),
          }),
        )
        .max(12),
      tests: text.max(600).optional(),
      unsure: text.max(600).optional(),
      prediction: text.max(300).optional(),
      savedAt: text,
      confirmedAt: text.optional(),
      outlineAt: text.optional(),
      outlineBeforeDraft: z.literal(true).optional(),
    }),
  ),
  planQuestions: later(z.array(guideEntrySchema).max(3)),
  thread: later(z.array(guideEntrySchema).max(40)),
  hints: later(
    z.record(
      text,
      loose({
        rung: count,
        at: text,
        fingerprint: text,
        testRunAt: text.optional(),
        tried: text.max(300).optional(),
      }),
    ),
  ),
  talks: later(z.array(loose({ stepId: text.optional(), at: text })).max(30)),
  tests: later(
    z
      .array(
        loose({
          at: text,
          command: text.max(300),
          changeFingerprint: text,
          outcome: text,
          exitCode: count.optional(),
          ms: count,
          prediction: text.optional(),
          expect: text.max(200).optional(),
          outputTail: text.max(4000).optional(),
          tailHash: text.optional(),
          newFiles: list.max(10).optional(),
          reported: z.literal(true).optional(),
        }),
      )
      .max(10),
  ),
  ready: later(
    loose({ at: text, changeFingerprint: text, leastSure: text.max(300).optional(), review: z.boolean() }),
  ),
  readyHistory: later(
    z.array(loose({ at: text, changeFingerprint: text, review: z.boolean() })).max(10),
  ),
  reviews: later(
    z
      .array(
        loose({
          at: text,
          changeFingerprint: text,
          leastSure: text.max(300).optional(),
          testRunAt: text.optional(),
          verified: text.max(400),
          checked: list.max(8),
          findings: z
            .array(
              loose({
                path: text,
                line: count.optional(),
                observed: text.max(400),
                evidence: loose({
                  type: text,
                  path: text.optional(),
                  line: count.optional(),
                  quote: text.max(300).optional(),
                }),
                why: text.max(300),
                question: text.max(300),
                dimension: text.optional(),
              }),
            )
            .max(3),
          removed: count.optional(),
        }),
      )
      .max(6),
  ),
  events: later(
    z
      .array(
        loose({
          at: text,
          kind: text,
          source: text,
          rung: count.optional(),
          stepId: text.optional(),
          model: text.optional(),
          cli: text.optional(),
          removed: count.optional(),
        }),
      )
      .max(300),
  ),
  agentWrites: later(count),
  removedTotal: later(count),
  checkIns: later(
    z
      .array(loose({ stepId: text.optional(), signal: text, choice: text.optional(), at: text }))
      .max(20),
  ),
  exits: later(z.array(loose({ stepId: text.optional(), exit: text, at: text })).max(20)),
  leftAt: later(text),
  busy: later(loose({ kind: text, since: text })),
  helpLock: later(helpLockSchema),
});

/** What an agent reported the machine lacks (TeamTask.setup, FollowUpRound.setup); its write caps. */
const setupNeedsSchema = z
  .array(loose({ need: text.max(120), command: text.max(300), reason: text.max(600) }))
  .max(10);

const pacingSchema = loose({
  openPrs: count.optional(),
  mergedPrs: count.optional(),
  waitingPrs: count.optional(),
  waitingUrls: list.max(10).optional(),
  viewerPermission: text.optional(),
});

const contributionFactsSchema = loose({
  checkedAt: text,
  door: doorSchema.optional(),
  issue: loose({ url: text }).optional(),
  pacing: pacingSchema.optional(),
  unknown: list.optional(),
});

/** Read schema of a repository in state.json (lenientRead wraps it below). */
export const repositoryReadSchema = loose({
    id: text.min(1),
    name: text,
    owner: text,
    fullName: text,
    path: text,
    defaultBranch: text,
    url: text,
    language: text.optional(),
    updatedAt: text.optional(),
    contributionRules: later(contributionRulesSchema),
    debriefs: later(z.array(debriefSchema).max(5)),
    // v1.2 (Learn by hand).
    testCommand: later(loose({ command: text.max(300), confirmedAt: text })),
});

const repositorySchema = lenientRead(repositoryReadSchema);

const splitRefSchema = loose({
  runId: text.min(1).max(80),
  title: text.max(splitLimits.titleChars),
});

/** Read schema of a run in state.json (lenientRead wraps it below). */
export const runReadSchema = loose({
    id: text.min(1),
    repoId: text,
    title: text,
    prompt: text,
    status: z.enum(runStatuses),
    branch: text,
    baseBranch: text,
    baseSha: text,
    worktreePath: text,
    gitDir: later(text),
    createdAt: text,
    agents: z.array(
      loose({
        id: text,
        name: text,
        role: text,
        status: z.enum(["waiting", "running", "complete", "failed"]),
        detail: text,
      }),
    ),
    logs: z.array(
      loose({
        time: text,
        agent: text,
        message: text,
        kind: text.optional(),
        detail: text.optional(),
      }),
    ),
    draft: loose({
      title: text,
      body: text,
      commitMessage: text.optional(),
      publishBranch: text.optional(),
    }),
    reviewedFiles: list,
    reviewedFingerprints: z.record(text, text),
    approvedFingerprint: text.optional(),
    reports: z.record(text, text).optional(),
    notes: z.record(text, loose({ text, fingerprint: text })).optional(),
    explanations: z
      .record(text, loose({ fingerprint: text, status: text }))
      .optional(),
    walkthroughs: later(z.record(text, loose({ fingerprint: text, status: text }))),
    draftPreparation: loose({
      status: text,
      fingerprint: text,
      appliedBody: later(text),
      earlierBodies: later(list),
    }).optional(),
    conversations: z.record(text, loose({})).optional(),
    team: loose({
      config: loose({}),
      phase: text,
      planSummary: text,
      tasks: z.array(
        loose({
          id: text,
          title: text,
          owner: text,
          files: list,
          dependsOn: list,
          status: text,
          setup: later(setupNeedsSchema),
          gitDir: later(text),
        }),
      ),
      messages: z.array(loose({})),
      premise: later(
        loose({ verdict: text, statement: text.max(1_000), evidence: text.max(3_000) }),
      ),
    }).optional(),
    followUps: z
      .array(
        loose({
          id: text,
          status: z.enum([
            "running",
            "review",
            "published",
            "failed",
            "cancelled",
            "discarded",
          ]),
          parentCommit: text,
          feedbackUrls: list,
          restatements: later(
            z.array(loose({ url: text, text: text.max(300) })).max(20),
          ),
          setup: later(setupNeedsSchema),
        }),
      )
      .optional(),
    sync: loose({ from: text, to: text, snapshot: text, conflicts: list }).optional(),
    prUrl: text.optional(),
    error: text.optional(),
    publishing: z.boolean().optional(),
    publishCommit: text.optional(),
    publishedBranch: text.optional(),
    headRepository: text.optional(),
    locale: text.optional(),
    unsandboxed: z.boolean().optional(),
    workspaceRemovedAt: text.optional(),
    workspaceBytes: z.number().optional(),
    // Only the fields added in v1.1; the rest of the feedback passes through.
    prFeedback: loose({
      prState: later(text),
      merged: later(z.boolean()),
      reviewDecision: later(text),
    }).optional(),
    understanding: later(understandingSchema),
    understandingCheckOff: later(z.boolean()),
    attempts: later(z.record(text, attemptSchema)),
    feedbackTags: later(
      z.record(
        text,
        loose({
          dimension: text.optional(),
          predicted: z.boolean().optional(),
          lesson: text.max(200).optional(),
          at: text,
        }),
      ),
    ),
    practice: later(
      z.record(
        text,
        loose({
          box: count,
          dueAt: text,
          lastAt: text.optional(),
          lastGrade: text.optional(),
          lastConfidence: text.optional(),
        }),
      ),
    ),
    contributionFacts: later(contributionFactsSchema),
    guardOverrides: later(
      z.array(loose({ id: text.max(40), reason: text.max(200), at: text })).max(8),
    ),
    reviewability: later(loose({ testReasons: z.record(text, text.max(300)).optional() })),
    // v1.2 (Learn by hand), optional in the same way.
    learnByHand: later(z.literal(true)),
    byHand: later(byHandSchema),
    // Splitting a contribution, optional in the same way.
    splitFrom: later(splitRefSchema),
    splitInto: later(z.array(splitRefSchema).max(splitLimits.maxContributions)),
});

const runSchema = lenientRead(runReadSchema);

/** state.json as this build reads it; each repository and run is checked on its own. */
export const persistedDatabaseSchema = z
  .object({
    version: z.literal(1),
    repos: z.array(repositorySchema),
    runs: z.array(runSchema),
  })
  .passthrough();

type Parsed =
  | { data: Record<string, unknown> & { repos: unknown[]; runs: unknown[] } }
  | { error: Error; corrupt: boolean };

/**
 * Reads the top level of a state file. A file that is not JSON or not an
 * object with the two lists is corrupt (a backup may replace it); a version
 * other than 1 is a newer format that this build must not overwrite.
 */
function parseState(content: string): Parsed {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (error) {
    return { error: error as Error, corrupt: true };
  }
  const invalid = () => new Error(sm().run.recovery.invalidStateFormat);
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { error: invalid(), corrupt: true };
  const state = value as Record<string, unknown>;
  if (typeof state.version === "number" && state.version !== 1)
    return { error: invalid(), corrupt: false };
  if (
    state.version !== 1 ||
    !Array.isArray(state.repos) ||
    !Array.isArray(state.runs)
  )
    return { error: invalid(), corrupt: true };
  return { data: state as Record<string, unknown> & { repos: unknown[]; runs: unknown[] } };
}

/** The zod problems in one line, without the values themselves. */
function describeIssues(error: z.ZodError) {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ")
    .slice(0, 500);
}

export class Store {
  data: Database = { version: 1, repos: [], runs: [] };
  /** What the last initialize() repaired; absent when the state loaded cleanly. */
  recovery?: StoreRecovery;
  /**
   * The backups found when state.json was missing at the last initialize().
   * None is restored on its own, so the janitor keeps the run files a
   * restored backup would still need.
   */
  backupsWithoutState?: string[];
  /**
   * The writable agents the last initialize() found stopped: a follow-up
   * round or a conflict resolution, with the commit the run's branch sat on
   * before the agent ran (`sync`: a conflict agent, whose index goes back to
   * the base too). Kept in memory only; the Workbench puts each branch back
   * at startup, as the agent's own end would have.
   */
  interruptedAgents: { runId: string; head: string; sync: boolean }[] = [];
  /** The write in progress and the one queued behind it (see save()). */
  private writing?: Promise<void>;
  private queued?: Promise<void>;
  private rotated = false;
  constructor(public directory: string) {}

  private get statePath() {
    return path.join(this.directory, stateFile);
  }

  async initialize() {
    await this.prepareDirectory();
    // Recovery below is logged to the data directory's files too.
    initLog(this.directory);
    this.recovery = undefined;
    this.backupsWithoutState = undefined;
    this.interruptedAgents = [];
    this.data = await this.load();
    await bindStoredGitDirs(this.data.repos, this.data.runs);
    // Rules an older build stored carry no reach: read it from each quote, as a rules read does now.
    for (const repo of this.data.repos)
      if (repo.contributionRules)
        repo.contributionRules.findings = repo.contributionRules.findings.map(withStoredReach);
    const before = new Map(
      this.data.runs.map((run) => [run, { status: run.status, publishing: !!run.publishing }]),
    );
    for (const run of this.data.runs) {
      // Each run explains the interruption in its own language, whatever
      // the server's default is now.
      const recovery = withRunLocale(run, () => sm().run.recovery);
      if (run.draftPreparation?.status === "generating") {
        run.draftPreparation.status = "failed";
        run.draftPreparation.error = recovery.draft;
      }
      for (const explanation of Object.values(run.explanations ?? {})) {
        if (explanation.status === "generating") {
          explanation.status = "failed";
          explanation.error = recovery.explanation;
        }
      }
      for (const walkthrough of Object.values(run.walkthroughs ?? {})) {
        if (walkthrough.status === "generating") {
          walkthrough.status = "failed";
          walkthrough.error = recovery.walkthrough;
        }
      }
      // A guide turn or a test run a restart stopped is over; nothing waits for it.
      if (run.byHand?.busy) delete run.byHand.busy;
      // A re-review interrupted by a crash leaves reviewer/tester agents "running" on a finished run.
      if (!["running", "queued"].includes(run.status) && !run.publishing) {
        for (const agent of run.agents)
          if (agent.status === "running") {
            agent.status = "failed";
            agent.detail = recovery.review;
          }
      }
      // An interrupted conflict resolution keeps its edits for review.
      if (run.sync?.resolving && run.status === "running") {
        run.sync.resolving = false;
        run.sync.report = recovery.conflicts;
        run.status = "review";
        for (const agent of run.agents)
          if (agent.status === "running") agent.status = "failed";
        this.interruptedAgents.push({ runId: run.id, head: run.baseSha, sync: true });
        continue;
      }
      // An interrupted follow-up round leaves the published PR intact: its
      // edits stay in the checkout for review, push or discard.
      const round = activeFollowUp(run.followUps);
      if (round?.resolving) {
        round.resolving = false;
        round.report = recovery.conflicts;
        this.interruptedAgents.push({ runId: run.id, head: round.parentCommit, sync: true });
      }
      if (round && (run.status === "running" || run.publishing)) {
        if (round.status === "running") {
          round.status = "review";
          round.error = recovery.round;
          // Rounds saved before startFollowUp cleared it still hold the last pushed message.
          delete run.draft.commitMessage;
          this.interruptedAgents.push({ runId: run.id, head: round.parentCommit, sync: false });
        }
        run.status = "review";
        run.publishing = false;
        delete run.approvedFingerprint;
        for (const agent of run.agents)
          if (agent.status === "running") agent.status = "failed";
        continue;
      }
      // A first publish that stopped part way: what reached GitHub is
      // checked again on the next publish, which reuses its commit and
      // finds its PR.
      if (run.publishing) {
        run.publishing = false;
        if (run.status !== "published") {
          run.status = run.approvedFingerprint ? "approved" : "review";
          run.error = withRunLocale(
            run,
            () => sm().storage.recovery.publishingInterrupted,
          );
        }
        continue;
      }
      // A queued run that never started has nothing to repair; the
      // Workbench queues it again (Workbench.resume).
      if (run.status === "queued" && !run.baseSha) continue;
      if (run.status === "running" || run.status === "queued") {
        run.status = "failed";
        run.error = recovery.run;
        for (const agent of run.agents)
          if (agent.status === "running") agent.status = "failed";
        if (run.team) {
          run.team.phase = "failed";
          for (const task of run.team.tasks)
            if (task.status === "running") {
              task.status = "failed";
              task.error = recovery.task;
            }
        }
      }
    }
    for (const [run, was] of before)
      if (was.status !== run.status || was.publishing !== !!run.publishing)
        log.warn("run.recovered", {
          runId: run.id,
          from: was.status,
          to: run.status,
          publishing: was.publishing,
        });
    await this.save();
  }

  /** Creates the data directory private to this user, and refuses one another user owns. */
  private async prepareDirectory() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const info = await stat(this.directory);
    if (typeof process.getuid === "function" && info.uid !== process.getuid())
      throw new Error(sm().storage.store.dataDirOwner({ path: this.directory }));
    if (process.platform !== "win32" && (info.mode & 0o777) !== 0o700)
      await chmod(this.directory, 0o700).catch((error) =>
        log.warn("store.data_dir_mode", { error }),
      );
  }

  /**
   * Reads state.json. When it is truncated or not JSON, the newest backup
   * that reads cleanly takes its place and the broken file is kept as
   * state.json.corrupt-<time>; without such a backup the start fails and
   * names the file, as before.
   */
  private async load(): Promise<Database> {
    let content: string;
    try {
      content = await readFile(this.statePath, "utf8");
    } catch (error) {
      // A missing file is a first start, or data the person removed on
      // purpose; backups are never restored without a damaged state.json,
      // but the log says they exist.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        const backups = await readdir(this.directory).then(
          (names) => names.filter((name) => name.startsWith(`${stateFile}.bak.`)),
          () => [] as string[],
        );
        if (backups.length) {
          this.backupsWithoutState = backups;
          log.warn("store.state_missing", { backups });
        }
        return { version: 1, repos: [], runs: [] };
      }
      throw this.unreadable(error);
    }
    const parsed = parseState(content);
    if ("data" in parsed) return this.validate(parsed.data);
    if (parsed.corrupt)
      for (let index = 1; index <= backupCount; index++) {
        const backup = `${this.statePath}.bak.${index}`;
        const candidate = parseState(
          await readFile(backup, "utf8").catch(() => ""),
        );
        if (!("data" in candidate)) continue;
        const corrupt = `${stateFile}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
        await rename(this.statePath, path.join(this.directory, corrupt));
        this.recovery = {
          restoredFrom: path.basename(backup),
          quarantinedRuns: 0,
        };
        log.warn("store.restored_from_backup", {
          backup: path.basename(backup),
          corruptCopy: corrupt,
          reason: parsed.error.message,
        });
        return this.validate(candidate.data);
      }
    throw this.unreadable(parsed.error);
  }

  private unreadable(error: unknown) {
    return new Error(
      sm().run.recovery.unreadableState({
        path: this.statePath,
        reason: error instanceof Error ? error.message : String(error),
      }),
      { cause: error },
    );
  }

  /**
   * Checks each repository and run on its own. Invalid ones are appended to
   * state.quarantine.json, durably, before the state is saved without them.
   */
  private async validate(
    state: Record<string, unknown> & { repos: unknown[]; runs: unknown[] },
  ): Promise<Database> {
    const quarantined: Record<"repos" | "runs", unknown[]> = {
      repos: [],
      runs: [],
    };
    const keep = <T>(
      kind: "repos" | "runs",
      schema: z.ZodType<unknown>,
      values: unknown[],
    ) =>
      values.flatMap((value) => {
        const result = schema.safeParse(value);
        if (result.success) return [result.data as T];
        quarantined[kind].push({
          quarantinedAt: new Date().toISOString(),
          reason: describeIssues(result.error),
          [kind === "repos" ? "repo" : "run"]: value,
        });
        return [];
      });
    const { shape } = persistedDatabaseSchema;
    const repos = keep<Repository>("repos", shape.repos.element, state.repos);
    const runs = keep<Run>("runs", shape.runs.element, state.runs);
    if (quarantined.repos.length || quarantined.runs.length) {
      await this.quarantine(quarantined);
      this.recovery = {
        ...this.recovery,
        quarantinedRuns: quarantined.runs.length,
        ...(quarantined.repos.length
          ? { quarantinedRepos: quarantined.repos.length }
          : {}),
      };
      log.warn("store.quarantined", {
        runs: quarantined.runs.length,
        repos: quarantined.repos.length,
        file: quarantineFile,
      });
    }
    return { ...state, version: 1, repos, runs };
  }

  private async quarantine(entries: Record<"repos" | "runs", unknown[]>) {
    const file = path.join(this.directory, quarantineFile);
    let existing: { repos: unknown[]; runs: unknown[] } = { repos: [], runs: [] };
    try {
      const value = JSON.parse(await readFile(file, "utf8"));
      if (Array.isArray(value?.runs))
        existing = {
          repos: Array.isArray(value.repos) ? value.repos : [],
          runs: value.runs,
        };
    } catch {
      // Missing or unreadable: start a new list (an unreadable one is replaced).
    }
    await writeDurable(
      file,
      JSON.stringify({
        version: 1,
        repos: [...existing.repos, ...entries.repos],
        runs: [...existing.runs, ...entries.runs],
      }),
    );
  }

  /**
   * Writes the whole state to state.json. Writes are coalesced: one is in
   * flight at a time and at most one more waits behind it, taking its
   * snapshot when it starts. The promise resolves once the data as it was
   * when save() was called is on disk (a later snapshot may include more).
   * The first write of each Store rotates state.json into
   * state.json.bak.1 to .bak.3.
   */
  save(): Promise<void> {
    if (this.queued) return this.queued;
    if (!this.writing) return this.startWrite();
    const queued = this.writing
      .catch(() => undefined)
      .then(() => {
        this.queued = undefined;
        return this.startWrite();
      });
    this.queued = queued;
    return queued;
  }

  private startWrite(): Promise<void> {
    const write: Promise<void> = this.write().finally(() => {
      if (this.writing === write) this.writing = undefined;
    });
    this.writing = write;
    return write;
  }

  private async write() {
    const snapshot = JSON.stringify(this.data);
    if (!this.rotated) {
      this.rotated = true;
      await this.rotateBackups().catch((error) =>
        log.warn("store.backup_failed", { error }),
      );
    }
    await writeDurable(this.statePath, snapshot);
  }

  /**
   * state.json becomes .bak.1, and older backups move up to .bak.3. Without
   * a state.json (a first start, a missing file or one replaced by a backup)
   * the backups stay as they are, so none is dropped for nothing.
   */
  private async rotateBackups() {
    const backup = (index: number) => `${this.statePath}.bak.${index}`;
    const ignoreMissing = (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    };
    try {
      await stat(this.statePath);
    } catch (error) {
      ignoreMissing(error as NodeJS.ErrnoException);
      return;
    }
    for (let index = backupCount - 1; index >= 1; index--)
      await rename(backup(index), backup(index + 1)).catch(ignoreMissing);
    const temporary = `${backup(1)}.${process.pid}.tmp`;
    try {
      await copyFile(this.statePath, temporary);
      await chmod(temporary, 0o600);
      await rename(temporary, backup(1));
    } catch (error) {
      await rm(temporary, { force: true });
      ignoreMissing(error as NodeJS.ErrnoException);
    }
  }
}
