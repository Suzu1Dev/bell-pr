/**
 * The live boards' hub (collab-hub.ts) on a clock the test moves: who is
 * answered at once, who waits and for how long, what a change tells whom,
 * who counts as present, and the limits on waiting requests.
 */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  CollabHub,
  maxWaiters,
  maxWaitersEach,
  presenceTtl,
  type FeedQuestion,
} from "./collab-hub.js";
import type { Actor } from "./coordination.js";
import { AppError } from "./types.js";

const person = (id: string): Actor => ({ id, role: "member" });
const ada = person("m-ada");
const ben = person("m-ben");
const cy = person("m-cy");

/** A hub over boards the test changes, and what each request was answered. */
function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.parse("2026-01-01T00:00:00Z") });
  const boards = new Map([
    ["p-1", '{"held":[]}'],
    ["p-2", '{"held":[]}'],
  ]);
  const reads: string[] = [];
  const hub = new CollabHub((projectId) => {
    reads.push(projectId);
    const board = boards.get(projectId);
    if (board === undefined) throw new AppError("No such board", 404);
    return board;
  });
  /** One request: `answers` stays empty while it waits; "204" stands for no body. */
  const ask = (question: Omit<FeedQuestion, "wait"> & { wait?: number }) => {
    const answers: string[] = [];
    const gone = hub.ask({ wait: 25, ...question }, (body) => answers.push(body ?? "204"));
    return { answers, gone };
  };
  /** Makes these people present on a project and gives what a current caller sends back. */
  const current = (projectId: string, ...actors: Actor[]) => {
    let last = "";
    for (const actor of [...actors, actors[0]]) [last] = ask({ projectId, actor, wait: 0 }).answers;
    const { epoch, version, seen } = JSON.parse(last);
    return { projectId, epoch, version, seen } as const;
  };
  return { hub, boards, reads, ask, current, tick: (ms: number) => t.mock.timers.tick(ms) };
}

/** The one answer of a request that did not wait, parsed. */
function only(answers: string[]) {
  assert.equal(answers.length, 1);
  return JSON.parse(answers[0]);
}

test("a caller that is behind is answered at once; a current one waits until its time is up", (t) => {
  const f = fixture(t);
  const first = only(f.ask({ projectId: "p-1", actor: ada }).answers);
  assert.deepEqual(first, {
    epoch: f.hub.epoch,
    version: 1,
    seen: 1,
    asOf: "2026-01-01T00:00:00.000Z",
    board: { held: [] },
    present: [ada.id],
  });
  const now = { projectId: "p-1", actor: ada, epoch: first.epoch, version: 1, seen: 1 };
  // Another epoch (BELL PR restarted) or an older version: the whole board again.
  for (const behind of [{ epoch: "0".repeat(16) }, { version: 0 }, { version: undefined }])
    assert.deepEqual(only(f.ask({ ...now, ...behind }).answers).board, { held: [] });
  // Only the people changed for this caller: no board.
  const seenOnly = only(f.ask({ ...now, seen: 0 }).answers);
  assert.deepEqual(Object.keys(seenOnly), ["epoch", "version", "seen", "asOf", "present"]);

  assert.deepEqual(f.ask({ ...now, wait: 0 }).answers, ["204"]);
  const waiting = f.ask({ ...now, wait: 25 });
  f.tick(24_999);
  assert.deepEqual(waiting.answers, []);
  f.tick(1);
  assert.deepEqual(waiting.answers, ["204"]);
  // The board was read once for all of it.
  assert.deepEqual(f.reads, ["p-1"]);
});

test("one change answers every request waiting on its project with the same string, and no other", (t) => {
  const f = fixture(t);
  const one = f.current("p-1", ada, ben);
  const two = f.current("p-2", cy);
  const waiting = [f.ask({ ...one, actor: ada }), f.ask({ ...one, actor: ben })];
  const elsewhere = f.ask({ ...two, actor: cy });
  f.reads.length = 0;

  // A change that leaves the board as it was answers nobody.
  f.hub.changed("p-1");
  assert.deepEqual(f.reads, ["p-1"]);
  assert.deepEqual([...waiting, elsewhere].map((each) => each.answers.length), [0, 0, 0]);

  f.boards.set("p-1", '{"held":["src/a.ts"]}');
  f.tick(5000);
  f.hub.changed("p-1");
  assert.deepEqual(f.reads, ["p-1", "p-1"]);
  const [[body], [same]] = waiting.map((each) => each.answers);
  assert.equal(body, same);
  assert.deepEqual(JSON.parse(body), {
    epoch: f.hub.epoch,
    version: one.version + 1,
    seen: one.seen,
    asOf: "2026-01-01T00:00:05.000Z",
    board: { held: ["src/a.ts"] },
    present: [ada.id, ben.id],
  });
  assert.deepEqual(elsewhere.answers, []);

  // A change of people may show on every board: each is read again, and only p-2's differs.
  f.boards.set("p-2", '{"held":[],"people":[]}');
  f.hub.changed();
  assert.deepEqual(JSON.parse(elsewhere.answers[0]).board, { held: [], people: [] });
  // Nobody waits on p-1 now, so its board is read when someone asks next.
  assert.deepEqual(f.reads, ["p-1", "p-1", "p-2"]);
  assert.deepEqual(waiting.map((each) => each.answers.length), [1, 1]);
});

test("who is looking: a new viewer raises `seen` only, and a person is forgotten 40 s after their last request", (t) => {
  const f = fixture(t);
  const alone = f.current("p-1", ada);
  let waiting = f.ask({ ...alone, actor: ada });
  // Ben opens the board: Ada's request hears of him, without the board.
  const bens = only(f.ask({ projectId: "p-1", actor: ben, wait: 0 }).answers);
  assert.deepEqual(JSON.parse(waiting.answers[0]), {
    epoch: f.hub.epoch,
    version: alone.version,
    seen: alone.seen + 1,
    asOf: "2026-01-01T00:00:00.000Z",
    present: [ada.id, ben.id],
  });
  assert.deepEqual([bens.seen, bens.present], [alone.seen + 1, [ada.id, ben.id]]);
  assert.deepEqual(f.reads, ["p-1"]);

  // Ben never asks again. Ada keeps asking, as a page does.
  const both = { ...alone, seen: alone.seen + 1 };
  waiting = f.ask({ ...both, actor: ada });
  f.tick(25_000);
  assert.deepEqual(waiting.answers, ["204"]);
  waiting = f.ask({ ...both, actor: ada });
  f.tick(presenceTtl - 25_000 - 1);
  assert.deepEqual(waiting.answers, []);
  f.tick(1);
  assert.deepEqual(JSON.parse(waiting.answers[0]), {
    epoch: f.hub.epoch,
    version: alone.version,
    seen: alone.seen + 2,
    asOf: "2026-01-01T00:00:40.000Z",
    present: [ada.id],
  });
  // Whoever waits is present for as long as they wait, however long ago they asked.
  waiting = f.ask({ ...both, seen: alone.seen + 2, actor: ada, wait: 60 });
  f.tick(presenceTtl + 5000);
  assert.deepEqual(waiting.answers, []);
  assert.deepEqual(only(f.ask({ projectId: "p-1", actor: ben, wait: 0 }).answers).present, [
    ada.id,
    ben.id,
  ]);
});

test("at most 2 requests wait per person and 64 in all; a client that went away frees its place", (t) => {
  const f = fixture(t);
  const tooMany = (run: () => unknown) =>
    assert.throws(run, (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.deepEqual([error.statusCode, error.details], [429, { reason: "tooManyWaiters" }]);
      return true;
    });
  const one = f.current("p-1", ada);
  const two = f.current("p-2", ada);
  const first = f.ask({ ...one, actor: ada });
  const second = f.ask({ ...two, actor: ada });
  assert.equal(maxWaitersEach, 2);
  tooMany(() => f.ask({ ...one, actor: ada }));
  // Refused, not answered; and one that does not wait is never refused.
  assert.deepEqual(f.ask({ ...one, actor: ada, wait: 0 }).answers, ["204"]);
  first.gone();
  const third = f.ask({ ...one, actor: ada });
  second.gone();
  third.gone();
  // Going away twice, or after the answer, frees nothing twice.
  first.gone();

  const crowd = Array.from({ length: maxWaiters + 1 }, (_, index) => person(`m-${index}`));
  const all = f.current("p-1", ada, ...crowd);
  const parked = crowd.slice(0, maxWaiters).map((actor) => f.ask({ ...all, actor }));
  const last = crowd[maxWaiters];
  tooMany(() => f.ask({ ...all, actor: last }));
  parked[0].gone();
  const fits = f.ask({ ...all, actor: last });
  f.tick(25_000);
  assert.deepEqual(fits.answers, ["204"]);
  assert.deepEqual(parked.map((each) => each.answers.length), [0, ...Array(maxWaiters - 1).fill(1)]);
  assert.deepEqual([first, second, third].map((each) => each.answers), [[], [], []]);
});

test("close answers everyone at once; a removed person's requests end; an unreadable board ends its waiters", (t) => {
  const f = fixture(t);
  const one = f.current("p-1", ada, ben);
  const two = f.current("p-2", ada, cy);
  const park = () => [
    f.ask({ ...one, actor: ada }),
    f.ask({ ...two, actor: ada }),
    f.ask({ ...one, actor: ben }),
    f.ask({ ...two, actor: cy }),
  ];
  let waiting = park();
  f.hub.close();
  assert.deepEqual(waiting.map((each) => each.answers), [["204"], ["204"], ["204"], ["204"]]);
  // Every place is free again.
  waiting = park();

  f.hub.forget(ada.id);
  assert.deepEqual(waiting.map((each) => each.answers), [["204"], ["204"], [], []]);
  // The removal is a change of people: the others hear that she is gone.
  f.hub.changed();
  assert.deepEqual(JSON.parse(waiting[2].answers[0]).present, [ben.id]);
  assert.deepEqual(JSON.parse(waiting[3].answers[0]).present, [cy.id]);

  const stays = f.ask({ ...f.current("p-2", cy), actor: cy });
  const ends = f.ask({ ...f.current("p-1", ben), actor: ben });
  f.boards.delete("p-1");
  f.hub.changed("p-1");
  assert.deepEqual([ends.answers, stays.answers], [["204"], []]);
  // Asking again says why.
  assert.throws(() => f.ask({ projectId: "p-1", actor: ben }), /No such board/);
  // No request is left behind, whatever the clock does.
  f.hub.close();
  f.tick(10 * presenceTtl);
  assert.deepEqual(stays.answers, ["204"]);
});
