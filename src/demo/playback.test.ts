import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { defaultContributionSettings } from "../../shared/insights";
import { locales } from "../../shared/i18n/locale";
import { getDemo } from "./index";
import {
  createDemoPlayback,
  demoPrUrl,
  playbackTiming,
  type PlaybackClock,
  type PlaybackEvent,
  type PlaybackRunEvent,
} from "./playback";
import type { DemoContent } from "./types";

/** A clock whose time only moves when the test says so. */
function fakeClock(start = Date.parse("2026-10-03T01:30:00.000Z")) {
  let now = start;
  let sequence = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const earliest = () => {
    let found: [number, { at: number; callback: () => void }] | undefined;
    for (const entry of timers)
      if (!found || entry[1].at < found[1].at) found = entry;
    return found;
  };
  const fire = ([id, timer]: [number, { at: number; callback: () => void }]) => {
    timers.delete(id);
    now = timer.at;
    timer.callback();
  };
  const clock: PlaybackClock = {
    now: () => now,
    setTimeout(callback, ms) {
      const id = ++sequence;
      timers.set(id, { at: now + ms, callback });
      return id;
    },
    clearTimeout(handle) {
      timers.delete(handle as number);
    },
  };
  return {
    clock,
    now: () => now,
    pending: () => timers.size,
    /** Moves time forward by `ms`, firing every timer that falls due. */
    advance(ms: number) {
      const end = now + ms;
      for (let next = earliest(); next && next[1].at <= end; next = earliest())
        fire(next);
      now = end;
    },
    /** Fires timers until none is left. */
    runAll() {
      for (let steps = 0, next = earliest(); next; next = earliest()) {
        if (++steps > 10_000) throw new Error("The playback never settles.");
        fire(next);
      }
    },
  };
}

function record(playback: ReturnType<typeof createDemoPlayback>, time: () => number) {
  const events: { at: number; event: PlaybackEvent }[] = [];
  playback.subscribe((event) => events.push({ at: time(), event }));
  return {
    events,
    runs: () =>
      events.flatMap(({ at, event }) =>
        event.kind === "run" ? [{ at, ...event }] : [],
      ),
  };
}

/** `values` without consecutive repeats. */
const steps = <T>(values: T[]) =>
  values.filter((value, index) => index === 0 || value !== values[index - 1]);

/** The demo parts the playback reads, to prove it never changes them. */
const snapshot = (demo: DemoContent) =>
  JSON.stringify([
    demo.repo,
    demo.run,
    demo.team,
    demo.files,
    demo.insights,
    demo.draftPreparation,
    demo.importSteps,
    demo.analysisSteps,
    demo.publishedCard,
  ]);

for (const locale of locales)
  test(`the ${locale} run plays from queued to published in order`, () => {
    const startedAt = performance.now();
    const demo = getDemo(locale);
    const before = snapshot(demo);
    const time = fakeClock();
    const playback = createDemoPlayback({ demo, clock: time.clock });
    const { runs } = record(playback, time.now);
    assert.equal(playback.current(), undefined);

    playback.start();
    const queued = runs()[0];
    assert.equal(queued.run.status, "queued");
    assert.equal(queued.run.team?.phase, "planning");
    assert.deepEqual(queued.run.team?.tasks, []);
    assert.deepEqual(queued.run.logs, []);
    assert.deepEqual(queued.files, []);
    assert.equal(queued.sample, true);
    assert.deepEqual(
      queued.run.agents.map((agent) => [agent.id, agent.status]),
      [["lead", "waiting"], ["reviewer", "waiting"], ["tester", "waiting"]],
    );

    // Planning ends at the plan, which waits for approval however long.
    time.runAll();
    const waiting = runs().at(-1)!;
    assert.equal(waiting.run.status, "awaiting_plan");
    assert.equal(waiting.run.team?.phase, "awaiting_approval");
    assert.equal(waiting.run.team?.planSummary, demo.team.planSummary);
    assert.deepEqual(
      waiting.run.team?.tasks.map((task) => [task.id, task.status]),
      demo.team.tasks.map((task) => [task.id, "pending"]),
    );
    assert.deepEqual(
      waiting.run.agents.map((agent) => agent.id),
      demo.run.agents.map((agent) => agent.id),
    );
    const leadLines = demo.run.logs
      .filter((entry) => entry.agent === "lead")
      .map((entry) => entry.message);
    assert.ok(leadLines.length > 0);
    assert.deepEqual(
      waiting.run.logs.map((entry) => entry.message),
      leadLines,
    );
    const planning = runs().filter(
      ({ run }) => run.status === "running" && run.team?.phase === "planning",
    );
    // The lines stream in: one event per line after the Lead starts.
    assert.equal(planning.length, leadLines.length + 1);
    assert.equal(time.pending(), 0);
    const count = runs().length;
    time.advance(60_000);
    assert.equal(runs().length, count);
    assert.equal(playback.approve(), false);
    assert.equal(playback.publish(), false);

    assert.equal(playback.approvePlan(), true);
    assert.equal(playback.approvePlan(), false);
    time.runAll();
    const all = runs();
    assert.deepEqual(steps(all.map(({ run }) => run.status)), [
      "queued",
      "running",
      "awaiting_plan",
      "running",
      "review",
    ]);
    assert.deepEqual(steps(all.map(({ run }) => run.team?.phase)), [
      "planning",
      "awaiting_approval",
      "developing",
      "integrating",
      "reviewing",
      "complete",
    ]);

    // Each task goes pending → running → complete, after its dependencies,
    // one step every 1.5 s.
    const developing = all.filter(({ run }) => run.team?.phase === "developing");
    for (const task of demo.team.tasks) {
      const states = developing.map(
        ({ run }) => run.team!.tasks.find((each) => each.id === task.id)!.status,
      );
      assert.deepEqual(steps(states), ["pending", "running", "complete"], task.id);
      const startedAt = developing.find(
        ({ run }) =>
          run.team!.tasks.find((each) => each.id === task.id)!.status === "running",
      )!;
      for (const dependency of task.dependsOn)
        assert.equal(
          startedAt.run.team!.tasks.find((each) => each.id === dependency)!.status,
          "complete",
          `${task.id} after ${dependency}`,
        );
    }
    const gaps = developing.slice(1).map(({ at }, index) => at - developing[index].at);
    assert.ok(gaps.length >= 3);
    for (const gap of gaps) assert.equal(gap, playbackTiming.task);
    const finished = developing.at(-1)!.run;
    for (const task of finished.team!.tasks) {
      const source = demo.team.tasks.find((each) => each.id === task.id)!;
      assert.equal(task.report, source.report);
      assert.deepEqual(task.checks, source.checks);
      assert.ok(Date.parse(task.startedAt!) < Date.parse(task.completedAt!));
    }
    // Team messages appear while the team works, not before approval.
    assert.deepEqual(waiting.run.team?.messages, []);
    assert.ok(developing[0].run.team!.messages.length > 0);

    // Review: explanations go from generating to ready, file by file.
    const reviewing = all.filter(({ run }) => run.status === "review");
    const first = reviewing[0];
    assert.deepEqual(
      first.files.map((file) => [file.path, file.explanationStatus, file.explanation]),
      demo.files.map((file) => [file.path, "generating", undefined]),
    );
    assert.equal(first.run.draftPreparation?.status, "generating");
    assert.deepEqual(first.run.reports, demo.run.reports);
    assert.ok(first.run.agents.every((agent) => agent.status === "complete"));
    const last = reviewing.at(-1)!;
    assert.deepEqual(
      last.files,
      demo.files.map((file) => ({ ...file, explanationStatus: "ready" })),
    );
    assert.deepEqual(last.run.draftPreparation, demo.draftPreparation);
    assert.equal(reviewing.length, demo.files.length + 1);
    for (let index = 1; index < reviewing.length; index++)
      assert.equal(
        reviewing[index].files.filter((file) => file.explanationStatus === "ready").length,
        index,
      );

    // Every text comes from the demo, and every demo log line appears once.
    assert.deepEqual(
      [...last.run.logs.map((entry) => entry.message)].sort(),
      demo.run.logs.map((entry) => entry.message).sort(),
    );
    assert.deepEqual(
      last.run.team!.messages.map((message) => message.content),
      demo.team.messages.map((message) => message.content),
    );
    for (const entry of last.run.logs) assert.ok(!Number.isNaN(Date.parse(entry.time)));
    for (const message of last.run.team!.messages)
      assert.ok(!Number.isNaN(Date.parse(message.createdAt)));

    // Approve, then publish the sample PR.
    assert.equal(playback.approve(), true);
    assert.equal(playback.current()!.run.status, "approved");
    assert.equal(playback.publish(), true);
    assert.equal(playback.publish(), false);
    assert.equal(playback.current()!.run.publishing, true);
    assert.equal(playback.current()!.publishedCard, undefined);
    time.runAll();
    const done = playback.current()!;
    assert.equal(done.run.status, "published");
    assert.equal(done.run.prUrl, demoPrUrl);
    assert.equal(done.run.prUrl, "#demo-pr");
    assert.equal(done.run.publishing, undefined);
    assert.equal(done.sample, true);
    assert.deepEqual(done.publishedCard, demo.publishedCard);
    assert.equal(playback.approve(), false);
    assert.equal(playback.publish(), false);

    assert.equal(time.pending(), 0);
    assert.equal(snapshot(demo), before);
    assert.ok(performance.now() - startedAt < 1000);
  });

test("speed divides every wait", () => {
  const durations = [1, 4].map((speed) => {
    const time = fakeClock();
    const playback = createDemoPlayback({ demo: getDemo("en"), speed, clock: time.clock });
    const begin = time.now();
    playback.start();
    time.runAll();
    const planned = time.now() - begin;
    playback.approvePlan();
    time.runAll();
    return { planned, reviewed: time.now() - begin - planned };
  });
  assert.equal(durations[0].planned, durations[1].planned * 4);
  assert.equal(durations[0].reviewed, durations[1].reviewed * 4);
  // A speed that is not a positive number plays in real time.
  const time = fakeClock();
  const playback = createDemoPlayback({ demo: getDemo("en"), speed: Number.NaN, clock: time.clock });
  playback.start();
  time.runAll();
  assert.equal(time.now() - Date.parse("2026-10-03T01:30:00.000Z"), durations[0].planned);
});

test("the contribution settings shape the run, and plan approval can be off", () => {
  const time = fakeClock();
  const demo = getDemo("en");
  const playback = createDemoPlayback({ demo, speed: 4, clock: time.clock });
  const settings = {
    ...defaultContributionSettings,
    provider: "claude" as const,
    requirePlanApproval: false,
  };
  playback.start(settings);
  time.runAll();
  const { run } = playback.current()!;
  assert.equal(run.status, "review");
  assert.deepEqual(run.contributionSettings, settings);
  assert.equal(run.team?.config.provider, "claude");
  assert.equal(run.team?.config.requirePlanApproval, false);
  assert.ok(run.team?.approvedAt);
  // The demo's own team config is untouched.
  assert.equal(demo.team.config.provider, "codex");
});

test("importSample plays the clone lines, then the sample repository", async () => {
  const time = fakeClock();
  const demo = getDemo("en");
  const playback = createDemoPlayback({ demo, clock: time.clock });
  const { events } = record(playback, time.now);
  const imported = playback.importSample("openfetch-sample/open-fetch");
  // The first line shows at once.
  assert.equal(events.length, 1);
  time.runAll();
  assert.deepEqual(await imported, demo.repo);
  const lines = events.map(({ event }) => event);
  assert.deepEqual(
    lines.map((event) => event.kind === "import" && event.phase),
    ["cloning", "cloning", "reading", "reading", "ready"],
  );
  assert.deepEqual(
    lines.flatMap((event) =>
      event.kind === "import" && event.phase !== "ready" ? [event.line] : [],
    ),
    demo.importSteps,
  );
  const progress = lines.map((event) => (event.kind === "import" ? event.progress : -1));
  for (let index = 1; index < progress.length; index++)
    assert.ok(progress[index] > progress[index - 1]);
  assert.equal(progress.at(-1), 1);
  const ready = lines.at(-1)!;
  assert.ok(ready.kind === "import" && ready.phase === "ready");
  assert.deepEqual(ready.repo, demo.repo);
  assert.notEqual(ready.repo, demo.repo);
  // No run events: the import has its own timeline.
  assert.equal(playback.current(), undefined);
});

test("analyzeSample plays the analysis lines, then the insights", async () => {
  const time = fakeClock();
  const demo = getDemo("zh-TW");
  const playback = createDemoPlayback({ demo, speed: 2, clock: time.clock });
  const { events } = record(playback, time.now);
  const analyzed = playback.analyzeSample();
  time.runAll();
  assert.deepEqual(await analyzed, demo.insights);
  const loading = events.flatMap(({ event }) =>
    event.kind === "insights" && event.status === "loading" ? [event] : [],
  );
  assert.deepEqual(
    loading.map((event) => event.step),
    demo.analysisSteps,
  );
  assert.deepEqual(
    loading.map((event) => event.index),
    demo.analysisSteps!.map((_, index) => index),
  );
  const gaps = events.slice(1).map(({ at }, index) => at - events[index].at);
  assert.deepEqual(gaps, [
    ...demo.analysisSteps!.slice(1).map(() => playbackTiming.analysisStep / 2),
    playbackTiming.analysisReady / 2,
  ]);
  const ready = events.at(-1)!.event;
  assert.ok(ready.kind === "insights" && ready.status === "ready");
  assert.deepEqual(ready.insights, demo.insights);
});

test("stop cancels every timer and settles what was pending", async () => {
  const time = fakeClock();
  const playback = createDemoPlayback({ demo: getDemo("en"), clock: time.clock });
  const { events } = record(playback, time.now);
  playback.start();
  time.advance(playbackTiming.queued);
  const imported = playback.importSample("anything");
  const analyzed = playback.analyzeSample();
  assert.ok(time.pending() >= 3);
  playback.stop();
  assert.equal(time.pending(), 0);
  assert.equal(await imported, undefined);
  assert.equal(await analyzed, undefined);
  const count = events.length;
  time.advance(600_000);
  assert.equal(events.length, count);
  assert.equal(playback.current()!.run.status, "running");

  // Later calls start afresh.
  playback.start();
  time.runAll();
  assert.equal(playback.current()!.run.status, "awaiting_plan");

  // A publish cut short by stop() can be tried again.
  playback.approvePlan();
  time.runAll();
  assert.equal(playback.publish(), true);
  playback.stop();
  assert.equal(time.pending(), 0);
  assert.equal(playback.publish(), true);
  time.runAll();
  assert.equal(playback.current()!.run.status, "published");
});

test("a restart, an unsubscribe or a failing subscriber leaves the rest playing", () => {
  const time = fakeClock();
  const playback = createDemoPlayback({ demo: getDemo("en"), clock: time.clock });
  const failures: unknown[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => failures.push(args);
  try {
    playback.subscribe(() => {
      throw new Error("view failed");
    });
    const seen: PlaybackRunEvent[] = [];
    const unsubscribe = playback.subscribe(
      (event) => event.kind === "run" && seen.push(event),
    );
    playback.start();
    time.advance(playbackTiming.queued);
    // A restart drops the old timeline: no step of it fires later.
    playback.start();
    assert.equal(playback.current()!.run.status, "queued");
    time.runAll();
    assert.deepEqual(steps(seen.map(({ run }) => run.status)), [
      "queued",
      "running",
      "queued",
      "running",
      "awaiting_plan",
    ]);
    assert.equal(failures.length, seen.length);
    unsubscribe();
    playback.approvePlan();
    time.runAll();
    assert.equal(seen.at(-1)!.run.status, "awaiting_plan");
    assert.equal(playback.current()!.run.status, "review");
  } finally {
    console.error = originalError;
  }
});

test("each event is a copy the view may keep or change", () => {
  const time = fakeClock();
  const demo = getDemo("en");
  const playback = createDemoPlayback({ demo, clock: time.clock });
  const seen: PlaybackRunEvent[] = [];
  playback.subscribe((event) => event.kind === "run" && seen.push(event));
  playback.start();
  time.runAll();
  seen[0].run.logs.push({ time: "", agent: "lead", message: "changed by a view" });
  seen.at(-1)!.run.team!.tasks[0].title = "changed by a view";
  playback.approvePlan();
  time.runAll();
  const { run } = playback.current()!;
  assert.ok(run.logs.every((entry) => entry.message !== "changed by a view"));
  assert.equal(run.team!.tasks[0].title, demo.team.tasks[0].title);
  assert.notEqual(seen[0].run, seen[1].run);
});
