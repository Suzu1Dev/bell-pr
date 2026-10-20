import type { AgentSlots } from "./agent-slots.js";
import type { TransientSleep } from "./agent-cli.js";
import type { collectDraftContext } from "./draft-sources.js";
import type * as drafting from "./draft-jobs.js";
import type { command } from "./process.js";
import type { Store } from "./store.js";
import type { TeamAgentRunner } from "./team.js";
import type { DiffFile, Repository, Run, RunLogEntry } from "./types.js";

/**
 * What the modules that do the Workbench's work receive instead of the
 * class: shared state and the façade operations they call back. They import
 * only this type from workbench.ts, so there is no import cycle.
 */
export interface WorkbenchContext {
  store: Store;
  /** Shared by every agent CLI call, including project analysis and discovery. */
  agentSlots: AgentSlots;
  /** Multiplies every agent turn timeout (app settings, then BELLPR_AGENT_TIMEOUT_SCALE). */
  readonly agentTimeoutScale: number;
  /**
   * Aborts work in flight: a run or its review rerun by run id; explanations,
   * the PR draft and chat by "explanations:", "draft:" or "guide:" + run id.
   */
  controllers: Map<string, AbortController>;
  /** Every background job; shutdown() waits for all of them. */
  jobs: Set<Promise<void>>;
  /** Explanations being generated, by run id. */
  explanationJobs: Map<string, Promise<void>>;
  /** Function walkthroughs being generated, one per run and file, keyed `${runId}\0${path}`. */
  walkthroughJobs: Map<string, Promise<void>>;
  /** PR draft preparation in progress, by run id. */
  draftJobs: Map<string, Promise<void>>;
  /** Learner-requested reviewer/tester reruns; one per run, aborted through controllers[run.id]. */
  reviewJobs: Map<string, Promise<void>>;
  /** Review follow-up rounds and sync conflict resolutions, by run id; aborted through controllers[run.id]. */
  followUpJobs: Map<string, Promise<void>>;
  conflictJobs: Map<string, Promise<void>>;
  /**
   * Learn-by-hand jobs, keyed `guide:<id>`, `review:<id>` and `tests:<id>`,
   * each aborted through `controllers` under the same key; cancel() and
   * shutdown() abort and await them.
   */
  byHandJobs: Map<string, Promise<void>>;
  dependencies: {
    /** Agent CLI invocations only; Git and gh keep using the real command. */
    command?: typeof command;
    /** Answers agent turns in place of the CLI, as tests do. */
    agentRunner?: TeamAgentRunner;
    /** Wait between retries of a turn that lost the OAuth refresh race. */
    sleep?: TransientSleep;
    /** Reads the target project's contribution rules for the PR draft. */
    collectDraftContext?: typeof collectDraftContext;
  };
  /** True once shutdown() has begun; no new background work starts. */
  stopping(): boolean;
  /** Throws 429 once queued, running and paused runs reach the cap. */
  assertQueueCapacity(): void;
  /** Queues the run and starts it as soon as the active limit allows. */
  enqueue(id: string): void;
  /** Appends to the run's own log, which is saved with the run. */
  log(
    run: Run,
    agent: string,
    message: string,
    entry?: Pick<RunLogEntry, "kind" | "detail">,
  ): void;
  run(id: string): Run;
  repo(id: string): Repository;
  /** Runs one task per key at a time, in call order (see Workbench.lock). */
  lock<T>(id: string, task: () => Promise<T>): Promise<T>;
  /** Reads the run's diff and brings explanations, draft and review state up to date. */
  diff(id: string): Promise<DiffFile[]>;
  /** Explains the changed files once development is complete. */
  explanations(id: string): Promise<{ run: Run; files: DiffFile[] }>;
  /** Starts the run's PR draft preparation, or waits for the one running. */
  prepareRunDraft(
    id: string,
    options: drafting.DraftOptions,
  ): Promise<{ run: Run }>;
}
