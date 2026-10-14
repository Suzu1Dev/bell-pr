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
import { sm } from "./i18n/index.js";
import { writeDurable } from "./fs-atomic.js";
import { initLog, log } from "./log.js";
import { lenientRead } from "./persisted-schema.js";

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

const repositorySchema = lenientRead(
  loose({
    id: text.min(1),
    name: text,
    owner: text,
    fullName: text,
    path: text,
    defaultBranch: text,
    url: text,
    language: text.optional(),
    updatedAt: text.optional(),
  }),
);

const runSchema = lenientRead(
  loose({
    id: text.min(1),
    repoId: text,
    title: text,
    prompt: text,
    status: z.enum(runStatuses),
    branch: text,
    baseBranch: text,
    baseSha: text,
    worktreePath: text,
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
    reviewedFingerprints: z.record(text),
    approvedFingerprint: text.optional(),
    reports: z.record(text).optional(),
    notes: z.record(loose({ text, fingerprint: text })).optional(),
    explanations: z
      .record(loose({ fingerprint: text, status: text }))
      .optional(),
    draftPreparation: loose({ status: text, fingerprint: text }).optional(),
    conversations: z.record(loose({})).optional(),
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
        }),
      ),
      messages: z.array(loose({})),
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
  }),
);

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
  const invalid = () => new Error("Invalid state format");
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
    this.data = await this.load();
    this.recoverInterruptedWork();
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
        if (backups.length) log.warn("store.state_missing", { backups });
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
   * Work that a restart interrupted. Each run explains it in its own
   * language, whatever the server's default is now.
   */
  private recoverInterruptedWork() {
    for (const run of this.data.runs) {
      const recovery = withRunLocale(run, () => sm().run.recovery);
      const before = { status: run.status, publishing: !!run.publishing };
      this.recoverRun(run, recovery);
      if (before.status !== run.status || before.publishing !== !!run.publishing)
        log.warn("run.recovered", {
          runId: run.id,
          from: before.status,
          to: run.status,
          publishing: before.publishing,
        });
    }
  }

  private recoverRun(
    run: Run,
    recovery: ReturnType<typeof sm>["run"]["recovery"],
  ) {
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
      return;
    }
    // An interrupted follow-up round leaves the published PR intact: its
    // edits stay in the checkout for review, push or discard.
    const round = activeFollowUp(run.followUps);
    if (round?.resolving) {
      round.resolving = false;
      round.report = recovery.conflicts;
    }
    if (round && (run.status === "running" || run.publishing)) {
      if (round.status === "running") {
        round.status = "review";
        round.error = recovery.round;
        // Rounds saved before startFollowUp cleared it still hold the last pushed message.
        delete run.draft.commitMessage;
      }
      run.status = "review";
      run.publishing = false;
      delete run.approvedFingerprint;
      for (const agent of run.agents)
        if (agent.status === "running") agent.status = "failed";
      return;
    }
    // A first publish that stopped part way: what reached GitHub is checked
    // again on the next publish, which reuses its commit and finds its PR.
    if (run.publishing) {
      run.publishing = false;
      if (run.status !== "published") {
        run.status = run.approvedFingerprint ? "approved" : "review";
        run.error = withRunLocale(
          run,
          () => sm().storage.recovery.publishingInterrupted,
        );
      }
      return;
    }
    // A queued run that never started has nothing to repair; the Workbench
    // queues it again (Workbench.resume).
    if (run.status === "queued" && !run.baseSha) return;
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

  /** state.json becomes .bak.1, and older backups move up to .bak.3. */
  private async rotateBackups() {
    const backup = (index: number) => `${this.statePath}.bak.${index}`;
    const ignoreMissing = (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    };
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
