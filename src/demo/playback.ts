/**
 * The scripted demo playback: the sample project's contribution told step by
 * step in the browser, so a tour, a screen share or the promo video shows a
 * run moving through every state. It is a pure timeline over `DemoContent`
 * with an injectable clock: no request reaches the server or GitHub, and
 * every text comes from the demo copy.
 *
 * A run plays like a real one:
 *
 *   1. queued;
 *   2. running, team phase "planning", with the Lead's log lines;
 *   3. awaiting_plan (phase "awaiting_approval") until approvePlan(), unless
 *      the settings turn plan approval off;
 *   4. running: each task goes pending → running → complete, about every
 *      1.5 s / speed and in dependency order, while the team's messages and
 *      log lines appear;
 *   5. integrating and reviewing, then status "review": every file's
 *      explanation goes from "generating" to "ready", then the PR guidance;
 *   6. approved, through approve() (publish() approves first when needed);
 *   7. published, with prUrl "#demo-pr" and the published card.
 *
 * importSample() and analyzeSample() play the import of the sample
 * repository and its analysis on their own timelines.
 */
import type {
  ContributionSettings,
  ProjectInsights,
} from "../../shared/insights";
import type { TeamMessage, TeamTask } from "../../shared/team";
import type { Agent, DiffFile, Repo, Run } from "../types";
import type { DemoContent, DemoPublishedCard } from "./types";

/** Time for the playback; tests pass a fake one. */
export interface PlaybackClock {
  /** Epoch milliseconds; log lines and messages are stamped with it. */
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** The browser's (or Node's) own clock. */
export const systemClock: PlaybackClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Milliseconds between steps at speed 1; the speed divides them. */
export const playbackTiming = {
  /** Queued until the Lead starts planning. */
  queued: 1200,
  /** Between the Lead's log lines, and from the last one to the plan. */
  planLine: 900,
  /** One task step: pending → running, or running → complete. */
  task: 1500,
  /** The Lead integrating the tasks' work. */
  integrate: 1500,
  /** The Reviewer and the Test analyst at work. */
  review: 1500,
  /** Between two files whose explanation becomes ready. */
  explanation: 600,
  /** Pushing the sample branch until the Draft PR shows as opened. */
  publish: 1200,
  /** Between two import progress lines. */
  importLine: 700,
  /** From the last import line until the repository is ready. */
  importReady: 600,
  /** Between two analysis lines. */
  analysisStep: 900,
  /** From the last analysis line until the overview is ready. */
  analysisReady: 700,
} as const;

/** The demo's fixed fragment link for its sample Draft PR. */
export const demoPrUrl = "#demo-pr";

/** The playing run and its changed files after each step. */
export interface PlaybackRunEvent {
  kind: "run";
  run: Run;
  /**
   * None until the team finishes; then the demo diff, each file with its
   * `explanationStatus` ("generating", then "ready" with its explanation).
   */
  files: DiffFile[];
  /** Always true: the sample project, nothing created on GitHub. */
  sample: true;
  /** Set once the run is published: the card the workspace shows. */
  publishedCard?: DemoPublishedCard;
}

/** One progress line of the sample import, then the repository. */
export type PlaybackImportEvent =
  | {
      kind: "import";
      phase: "cloning" | "reading";
      line: string;
      /** The line's index in `importSteps`. */
      step: number;
      /** Between 0 and 1, rising with each line. */
      progress: number;
    }
  | { kind: "import"; phase: "ready"; repo: Repo; progress: 1 };

/** One loading line of the sample analysis, then the insights. */
export type PlaybackInsightsEvent =
  | {
      kind: "insights";
      status: "loading";
      step: string;
      /** The line's index in `analysisSteps`. */
      index: number;
      /** Between 0 and 1, rising with each line. */
      progress: number;
    }
  | { kind: "insights"; status: "ready"; insights: ProjectInsights };

export type PlaybackEvent =
  | PlaybackRunEvent
  | PlaybackImportEvent
  | PlaybackInsightsEvent;

export interface DemoPlaybackOptions {
  /** The demo in the UI language, from getDemo(locale). It is not changed. */
  demo: DemoContent;
  /** 1 is real time; 4 runs four times as fast. Default 1. */
  speed?: number;
  clock?: PlaybackClock;
}

export interface DemoPlayback {
  /** Starts (or restarts) the run from "queued". */
  start(settings?: ContributionSettings): void;
  /** Approves the plan while the run awaits it; false otherwise. */
  approvePlan(): boolean;
  /** Approves the reviewed run ("review" → "approved"); false otherwise. */
  approve(): boolean;
  /**
   * Publishes the sample Draft PR from "review" or "approved"; false
   * otherwise. Nothing is sent anywhere.
   */
  publish(): boolean;
  /**
   * Plays the import of the sample repository, whatever `input` names (the
   * lines name the sample). Resolves with the repository, or with undefined
   * when stopped or restarted first.
   */
  importSample(input: string): Promise<Repo | undefined>;
  /**
   * Plays the analysis of the sample repository. Resolves with the
   * insights, or with undefined when stopped or restarted first.
   */
  analyzeSample(): Promise<ProjectInsights | undefined>;
  /** Calls `callback` with every event from now on; returns the unsubscribe. */
  subscribe(callback: (event: PlaybackEvent) => void): () => void;
  /** The last run event, if the run has started. */
  current(): PlaybackRunEvent | undefined;
  /**
   * Cancels every timer. Pending import and analysis promises resolve with
   * undefined, and a publish cut short can be retried; later calls start
   * afresh.
   */
  stop(): void;
}

/** One sequence of steps, at most one timer pending at a time. */
interface Lane {
  schedule(ms: number, step: () => void): void;
  cancel(): void;
}

const copy = <T>(value: T): T => structuredClone(value);

export function createDemoPlayback({
  demo,
  speed = 1,
  clock = systemClock,
}: DemoPlaybackOptions): DemoPlayback {
  const rate = Number.isFinite(speed) && speed > 0 ? speed : 1;
  const lanes: Lane[] = [];
  function lane(): Lane {
    let handle: unknown;
    let pending = false;
    const created: Lane = {
      schedule(ms, step) {
        created.cancel();
        pending = true;
        handle = clock.setTimeout(() => {
          pending = false;
          step();
        }, Math.round(ms / rate));
      },
      cancel() {
        if (pending) clock.clearTimeout(handle);
        pending = false;
      },
    };
    lanes.push(created);
    return created;
  }
  const runLane = lane();
  const explanationLane = lane();
  const publishLane = lane();
  const importLane = lane();
  const analysisLane = lane();

  const subscribers = new Set<(event: PlaybackEvent) => void>();
  function emit(event: PlaybackEvent) {
    for (const subscriber of [...subscribers]) {
      try {
        subscriber(event);
      } catch (error) {
        // One failing view must not stop the playback for the others.
        console.error("[BELL-PR] A demo playback subscriber failed", error);
      }
    }
  }
  const time = () => new Date(clock.now()).toISOString();

  // The run being played. Each event carries copies, so a view can keep or
  // change what it got.
  let run: Run | undefined;
  let files: DiffFile[] = [];
  let published = false;
  let lastRun: PlaybackRunEvent | undefined;
  const shownLogs = new Set<number>();
  const shownMessages = new Set<string>();
  const owners = new Set(demo.team.tasks.map((task) => task.owner));

  function emitRun() {
    if (!run) return;
    lastRun = {
      kind: "run",
      run: copy(run),
      files: copy(files),
      sample: true,
      ...(published && demo.publishedCard
        ? { publishedCard: { ...demo.publishedCard } }
        : {}),
    };
    emit(lastRun);
  }

  function agent(id: string): Agent | undefined {
    return run?.agents.find((candidate) => candidate.id === id);
  }

  function setAgent(id: string, status: Agent["status"]) {
    const found = agent(id);
    if (found) found.status = status;
  }

  /** Appends the demo log lines of `agents` (all agents when omitted) not shown yet. */
  function appendLogs(agents?: Set<string>) {
    demo.run.logs.forEach((entry, index) => {
      if (!run || shownLogs.has(index)) return;
      if (agents && !agents.has(entry.agent)) return;
      shownLogs.add(index);
      run.logs.push({ ...entry, time: time() });
    });
  }

  /** Shows the team messages sent by `senders` (all when omitted) not shown yet. */
  function deliverMessages(senders?: Set<string>) {
    for (const message of demo.team.messages) {
      if (!run?.team || shownMessages.has(message.id)) continue;
      if (senders && !senders.has(message.from)) continue;
      shownMessages.add(message.id);
      const sentAt = time();
      const shown: TeamMessage = { ...copy(message), createdAt: sentAt };
      if (shown.status === "delivered") shown.deliveredAt = sentAt;
      run.team.messages.push(shown);
    }
  }

  /** Members run while one of their tasks does and finish with their last task. */
  function updateMembers() {
    const tasks = run?.team?.tasks ?? [];
    for (const owner of owners) {
      const own = tasks.filter((task) => task.owner === owner);
      setAgent(
        owner,
        own.some((task) => task.status === "running")
          ? "running"
          : own.length && own.every((task) => task.status === "complete")
            ? "complete"
            : "waiting",
      );
    }
  }

  function start(settings?: ContributionSettings) {
    for (const each of [runLane, explanationLane, publishLane]) each.cancel();
    shownLogs.clear();
    shownMessages.clear();
    files = [];
    published = false;
    const base = demo.run;
    const config = { ...demo.team.config };
    if (settings) {
      config.requirePlanApproval = settings.requirePlanApproval;
      if (settings.provider) config.provider = settings.provider;
    }
    run = {
      id: base.id,
      repoId: base.repoId,
      title: base.title,
      prompt: base.prompt,
      status: "queued",
      branch: base.branch,
      baseBranch: base.baseBranch,
      createdAt: time(),
      // The teammates join once the Lead's plan names them.
      agents: base.agents
        .filter((member) => !owners.has(member.id))
        .map((member) => ({ ...member, status: "waiting" })),
      logs: [],
      draft: { ...base.draft },
      reviewedFiles: [],
      reports: {},
      ...(settings ? { contributionSettings: copy(settings) } : {}),
      team: {
        config,
        phase: "planning",
        planSummary: "",
        tasks: [],
        messages: [],
      },
    };
    emitRun();
    runLane.schedule(playbackTiming.queued, plan);
  }

  function plan() {
    if (!run?.team) return;
    run.status = "running";
    run.team.phase = "planning";
    setAgent("lead", "running");
    emitRun();
    runLane.schedule(playbackTiming.planLine, planLine);
  }

  /** One Lead log line per step, then the plan. */
  function planLine() {
    const next = demo.run.logs.findIndex(
      (entry, index) => entry.agent === "lead" && !shownLogs.has(index),
    );
    if (next < 0) {
      presentPlan();
      return;
    }
    shownLogs.add(next);
    run?.logs.push({ ...demo.run.logs[next], time: time() });
    emitRun();
    runLane.schedule(playbackTiming.planLine, planLine);
  }

  function presentPlan() {
    if (!run?.team) return;
    const team = run.team;
    team.planSummary = demo.team.planSummary;
    team.tasks = demo.team.tasks.map(
      (task): TeamTask => ({
        id: task.id,
        title: task.title,
        description: task.description,
        owner: task.owner,
        files: [...task.files],
        dependsOn: [...task.dependsOn],
        status: "pending",
      }),
    );
    const members = demo.run.agents
      .filter((member) => owners.has(member.id))
      .map((member): Agent => ({ ...member, status: "waiting" }));
    const lead = run.agents.findIndex((member) => member.id === "lead");
    run.agents.splice(lead + 1, 0, ...members);
    setAgent("lead", "complete");
    if (team.config.requirePlanApproval) {
      run.status = "awaiting_plan";
      team.phase = "awaiting_approval";
      emitRun();
      return;
    }
    team.approvedAt = time();
    develop();
  }

  function approvePlan(): boolean {
    if (run?.status !== "awaiting_plan" || !run.team) return false;
    run.team.approvedAt = time();
    develop();
    return true;
  }

  function develop() {
    if (!run?.team) return;
    run.status = "running";
    run.team.phase = "developing";
    // The Lead's briefing reaches the team as work starts; a teammate's
    // messages follow its first finished task.
    const briefing = demo.team.messages
      .map((message) => message.from)
      .filter((sender) => !owners.has(sender));
    deliverMessages(new Set(briefing));
    emitRun();
    runLane.schedule(playbackTiming.task, taskStep);
  }

  /** Completes the running tasks, then starts every task that can start. */
  function taskStep() {
    const tasks = run?.team?.tasks;
    if (!run || !tasks) return;
    const finished = new Set<string>();
    for (const task of tasks) {
      if (task.status !== "running") continue;
      const done = demo.team.tasks.find((each) => each.id === task.id);
      task.status = "complete";
      task.completedAt = time();
      if (done?.report) task.report = done.report;
      if (done?.checks) task.checks = copy(done.checks);
      if (done?.integratedFiles) task.integratedFiles = [...done.integratedFiles];
      finished.add(task.owner);
    }
    appendLogs(finished);
    deliverMessages(finished);
    const complete = new Set(
      tasks.filter((task) => task.status === "complete").map((task) => task.id),
    );
    for (const task of tasks)
      if (
        task.status === "pending" &&
        task.dependsOn.every((dependency) => complete.has(dependency))
      ) {
        task.status = "running";
        task.startedAt = time();
      }
    updateMembers();
    emitRun();
    if (tasks.some((task) => task.status === "running"))
      runLane.schedule(playbackTiming.task, taskStep);
    else runLane.schedule(playbackTiming.integrate, integrate);
  }

  function integrate() {
    if (!run?.team) return;
    run.team.phase = "integrating";
    setAgent("lead", "running");
    emitRun();
    runLane.schedule(playbackTiming.review, review);
  }

  function review() {
    if (!run?.team) return;
    run.team.phase = "reviewing";
    setAgent("lead", "complete");
    const implementer = demo.run.reports?.implementer;
    if (implementer) run.reports = { ...run.reports, implementer };
    for (const reviewer of ["reviewer", "tester"]) setAgent(reviewer, "running");
    emitRun();
    runLane.schedule(playbackTiming.review, finishReview);
  }

  function finishReview() {
    if (!run?.team) return;
    run.status = "review";
    run.team.phase = "complete";
    for (const member of run.agents) member.status = "complete";
    run.reports = { ...run.reports, ...demo.run.reports };
    appendLogs();
    deliverMessages();
    files = demo.files.map(({ explanation: _explanation, ...file }) => ({
      ...copy(file),
      explanationStatus: "generating",
    }));
    run.draftPreparation = {
      status: "generating",
      fingerprint: demo.draftPreparation.fingerprint,
    };
    emitRun();
    explanationLane.schedule(playbackTiming.explanation, () => explain(0));
  }

  function explain(index: number) {
    const ready = demo.files[index];
    if (!run || !ready) return;
    files[index] = {
      ...copy(ready),
      explanationStatus: ready.explanation ? "ready" : "unavailable",
    };
    const last = index === demo.files.length - 1;
    if (last) run.draftPreparation = copy(demo.draftPreparation);
    emitRun();
    if (!last)
      explanationLane.schedule(playbackTiming.explanation, () =>
        explain(index + 1),
      );
  }

  function approve(): boolean {
    if (run?.status !== "review") return false;
    run.status = "approved";
    emitRun();
    return true;
  }

  function publish(): boolean {
    if (!run || run.publishing) return false;
    if (run.status === "review") approve();
    if (run.status !== "approved") return false;
    run.publishing = true;
    emitRun();
    publishLane.schedule(playbackTiming.publish, () => {
      if (!run) return;
      delete run.publishing;
      run.status = "published";
      run.prUrl = demoPrUrl;
      run.publishedBranch = run.branch;
      published = true;
      emitRun();
    });
    return true;
  }

  let settleImport: ((repo: Repo | undefined) => void) | undefined;
  function importSample(_input: string): Promise<Repo | undefined> {
    importLane.cancel();
    settleImport?.(undefined);
    const steps = demo.importSteps ?? [];
    const cloning = Math.ceil(steps.length / 2);
    return new Promise((resolve) => {
      settleImport = resolve;
      const step = (index: number) => {
        if (index < steps.length) {
          emit({
            kind: "import",
            phase: index < cloning ? "cloning" : "reading",
            line: steps[index],
            step: index,
            progress: (index + 1) / (steps.length + 1),
          });
          importLane.schedule(
            index + 1 < steps.length
              ? playbackTiming.importLine
              : playbackTiming.importReady,
            () => step(index + 1),
          );
          return;
        }
        settleImport = undefined;
        emit({ kind: "import", phase: "ready", repo: copy(demo.repo), progress: 1 });
        resolve(copy(demo.repo));
      };
      step(0);
    });
  }

  let settleAnalysis: ((insights: ProjectInsights | undefined) => void) | undefined;
  function analyzeSample(): Promise<ProjectInsights | undefined> {
    analysisLane.cancel();
    settleAnalysis?.(undefined);
    const steps = demo.analysisSteps ?? [];
    return new Promise((resolve) => {
      settleAnalysis = resolve;
      const step = (index: number) => {
        if (index < steps.length) {
          emit({
            kind: "insights",
            status: "loading",
            step: steps[index],
            index,
            progress: (index + 1) / (steps.length + 1),
          });
          analysisLane.schedule(
            index + 1 < steps.length
              ? playbackTiming.analysisStep
              : playbackTiming.analysisReady,
            () => step(index + 1),
          );
          return;
        }
        settleAnalysis = undefined;
        emit({ kind: "insights", status: "ready", insights: copy(demo.insights) });
        resolve(copy(demo.insights));
      };
      step(0);
    });
  }

  return {
    start,
    approvePlan,
    approve,
    publish,
    importSample,
    analyzeSample,
    subscribe(callback) {
      subscribers.add(callback);
      return () => {
        subscribers.delete(callback);
      };
    },
    current: () => lastRun,
    stop() {
      for (const each of lanes) each.cancel();
      // A publish cut short can be tried again.
      if (run) delete run.publishing;
      settleImport?.(undefined);
      settleAnalysis?.(undefined);
      settleImport = undefined;
      settleAnalysis = undefined;
    },
  };
}
