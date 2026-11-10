import assert from "node:assert/strict";
import test, { mock, type TestContext } from "node:test";
import { createGroupStore } from "./store";

const me = { id: "u1", name: "Ada", admin: true };
const people = [me, { id: "u2", name: "Ben" }];
const hold = (claimId: string, holder = "u1") => ({
  claimId,
  title: `Task ${claimId}`,
  holder,
  scopes: [`src/${claimId}`],
  fence: 1,
  since: "2026-11-10T09:00:00.000Z",
});
/** A feed answer for repository p1; without `held` it says only who is present. */
const feed = (version: number, held?: ReturnType<typeof hold>[], present = ["u1"]) => ({
  epoch: "e1",
  version,
  seen: present.length,
  asOf: "2026-11-10T09:00:05.000Z",
  present,
  ...(held && { board: { project: { id: "p1", name: "shop" }, people, held } }),
});
const first = "/projects/p1/feed?wait=25";
const ids = (holds: { claimId: string }[] = []) => holds.map((item) => item.claimId);

/** Lets the store read an answer and ask again. */
async function settle() {
  for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setImmediate(resolve));
}

/**
 * A store that has joined and waits for the board of p1, with a server whose
 * answers the test gives one at a time and a clock the test moves.
 */
async function joined(
  t: TestContext,
  projects = [
    { id: "p1", name: "shop" },
    { id: "p2", name: "site" },
  ],
) {
  const asked: { path: string; token: string | null; answer(response: Response): void }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((answer, fail) => {
      // As fetch does when the request is given up.
      init?.signal?.addEventListener("abort", () => fail(init.signal!.reason));
      asked.push({
        path: String(input).replace("/api/collab", ""),
        token: new Headers(init?.headers).get("x-bell-participant"),
        answer,
      });
    })) as typeof fetch;
  mock.timers.enable({ apis: ["setTimeout"] });
  const store = createGroupStore();
  t.after(() => {
    store.close();
    mock.timers.reset();
    globalThis.fetch = realFetch;
  });
  /** Answers the oldest request, which is for `path`: 204 without a body. Resolves with its participant token. */
  async function answer(path: string, body?: unknown, status = body === undefined ? 204 : 200) {
    const request = asked.shift();
    assert.equal(request?.path, path);
    request!.answer(
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await settle();
    return request!.token;
  }
  const joining = store.join("the code");
  await settle();
  await answer("/join", { token: "first" });
  await joining;
  await answer("", { state: "ready", host: false, me });
  await answer("/projects", { projects });
  return {
    store,
    answer,
    /** The requests that wait for an answer. */
    waiting: () => asked.map((request) => request.path),
    async pass(ms: number) {
      mock.timers.tick(ms);
      await settle();
    },
  };
}

test("a board keeps the server's order and the objects that did not change", async (t) => {
  const { store, answer } = await joined(t);
  await answer(first, feed(1, [hold("b"), hold("a")]));
  const one = store.get();
  assert.deepEqual(ids(one.held), ["b", "a"]);
  // The first board of a repository marks nothing.
  assert.deepEqual([one.added, one.ended, one.link, one.asOf], [[], [], "live", feed(1).asOf]);

  await answer(`${first}&epoch=e1&version=1&seen=1`, feed(2, [hold("b"), hold("a"), hold("c", "u2")]));
  const two = store.get();
  assert.deepEqual(ids(two.held), ["b", "a", "c"]);
  assert.equal(two.held![0], one.held![0]);
  assert.equal(two.held![1], one.held![1]);
  assert.equal(two.people, one.people);
  assert.equal(two.present, one.present);
  assert.deepEqual([ids(two.added), two.ended], [["c"], []]);

  // Only who is present changed: the answer has no board, and the one in hand stays.
  await answer(`${first}&epoch=e1&version=2&seen=1`, feed(2, undefined, ["u1", "u2"]));
  const three = store.get();
  assert.equal(three.held, two.held);
  assert.equal(three.people, two.people);
  assert.deepEqual(three.present, ["u1", "u2"]);

  await answer(`${first}&epoch=e1&version=2&seen=2`, feed(3, [hold("a"), hold("c", "u2")], ["u1", "u2"]));
  const four = store.get();
  assert.equal(four.held![0], two.held![1]);
  assert.equal(four.held![1], two.held![2]);
  assert.equal(four.present, three.present);
  assert.deepEqual([ids(four.held), ids(four.added), ids(four.ended)], [["a", "c"], [], ["b"]]);

  // Nothing changed in 25 seconds: the same board, confirmed by this clock.
  await answer(`${first}&epoch=e1&version=3&seen=2`);
  assert.equal(store.get().held, four.held);
  assert.equal(typeof store.get().asOf, "number");
});

test("failures wait 1, 2, 5 and then 15 seconds, and an answer starts that again", async (t) => {
  const { store, answer, waiting, pass } = await joined(t);
  for (const seconds of [1, 2, 5, 15, 15]) {
    await answer(first, { error: "boom" }, 500);
    assert.equal(store.get().link, "reconnecting");
    await pass(seconds * 1000 - 1);
    assert.deepEqual(waiting(), []);
    await pass(1);
    assert.deepEqual(waiting(), [first]);
  }
  await answer(first, feed(1, [hold("a")]));
  assert.equal(store.get().link, "live");
  await answer(`${first}&epoch=e1&version=1&seen=1`, { error: "boom" }, 500);
  // The board in hand stays while the page reconnects.
  assert.deepEqual([store.get().link, ids(store.get().held)], ["reconnecting", ["a"]]);
  await pass(1000);
  assert.deepEqual(waiting(), [`${first}&epoch=e1&version=1&seen=1`]);
});

test("with no place for a waiting request the page asks every 10 seconds, then waits again", async (t) => {
  const { store, answer, waiting, pass } = await joined(t);
  const refusal = { reason: "tooManyWaiters", error: "Too many requests are waiting." };
  await answer(first, refusal, 429);
  assert.equal(store.get().link, "polling");
  // At once, and without waiting. When that one is refused too, the next is 10 seconds later.
  await answer("/projects/p1/feed?wait=0", refusal, 429);
  await pass(9_999);
  assert.deepEqual(waiting(), []);
  await pass(1);
  await answer("/projects/p1/feed?wait=0", feed(1, [hold("a")]));
  assert.deepEqual([store.get().link, ids(store.get().held)], ["polling", ["a"]]);
  for (let poll = 0; poll < 5; poll++) {
    await pass(9_999);
    assert.deepEqual(waiting(), []);
    await pass(1);
    await answer("/projects/p1/feed?wait=0&epoch=e1&version=1&seen=1");
  }
  await pass(10_000);
  await answer(`${first}&epoch=e1&version=1&seen=1`);
  assert.equal(store.get().link, "live");
});

test("a feed request that is not answered in 40 seconds is given up, and the page reconnects", async (t) => {
  const { store, answer, waiting, pass } = await joined(t);
  await answer(first, feed(1, [hold("a")]));
  const next = `${first}&epoch=e1&version=1&seen=1`;
  await pass(39_999);
  assert.equal(store.get().link, "live");
  await pass(1);
  // The board in hand stays, and is no longer said to be live.
  assert.deepEqual([store.get().link, ids(store.get().held)], ["reconnecting", ["a"]]);
  await pass(1000);
  // The request that was given up, and the one after it.
  assert.deepEqual(waiting(), [next, next]);
});

test("a request before the board is given up after 40 seconds too", async (t) => {
  const { store, answer, waiting, pass } = await joined(t);
  // The repository is gone: the list is asked for again, and gets no answer.
  await answer(first, { reason: "unknownProject", error: "No such repository." }, 404);
  await pass(1000);
  assert.deepEqual(waiting(), ["/projects"]);
  await pass(40_000);
  assert.equal(store.get().link, "reconnecting");
  await pass(2000);
  assert.deepEqual(waiting(), ["/projects", "/projects"]);
  // The one given up is answered too late and the next one in time: no longer "Reconnecting".
  await answer("/projects", { projects: [] });
  await answer("/projects", { projects: [] });
  assert.equal(store.get().link, "live");
});

test("a group without a repository is asked for its list every 10 seconds", async (t) => {
  const { store, answer, waiting, pass } = await joined(t, []);
  assert.deepEqual([store.get().projects, waiting()], [[], []]);
  await pass(10_000);
  // Still none, but one was imported meanwhile: an admin's card offers it.
  await answer("/projects", { projects: [], addable: [{ repoId: "r1", name: "shop" }] });
  assert.deepEqual(store.get().addable, [{ repoId: "r1", name: "shop" }]);
  await pass(10_000);
  // An admin added one meanwhile: its board follows without a reload.
  await answer("/projects", { projects: [{ id: "p1", name: "shop" }] });
  await answer(first, feed(1, [hold("a")]));
  assert.deepEqual([store.get().project, ids(store.get().held)], ["p1", ["a"]]);
});

test("with no repository yet a list only adds to what can be added", async (t) => {
  const { store, answer, pass } = await joined(t, []);
  await pass(10_000);
  await answer("/projects", { projects: [], addable: [{ repoId: "r1", name: "shop" }] });
  await pass(10_000);
  const failed = assert.rejects(store.add("r1"));
  await settle();
  // The list leaves out a repository that is being copied: the card keeps it, also after a failed copy.
  await answer("/projects", { projects: [], addable: [{ repoId: "r2", name: "site" }] });
  await answer("/projects", { reason: "cloneFailed", error: "The copy failed." }, 500);
  await failed;
  assert.deepEqual(
    store.get().addable?.map((repo) => repo.repoId),
    ["r1", "r2"],
  );
});

test("an answered add asks for the list again, for what came while it was copied", async (t) => {
  const { store, answer, pass } = await joined(t, []);
  await pass(10_000);
  const adding = store.add("r1");
  await settle();
  // The list asked before the answer is still empty; another admin's repository comes after it.
  await answer("/projects", { projects: [], addable: [{ repoId: "r2", name: "site" }] });
  await answer("/projects", { project: { id: "p1", name: "shop" } }, 201);
  await adding;
  const both = [
    { id: "p2", name: "site" },
    { id: "p1", name: "shop" },
  ];
  await answer("/projects", { projects: both, addable: [] });
  assert.deepEqual(store.get().projects, both);
  assert.equal(store.get().project, "p1");
  assert.deepEqual(store.get().addable, []);
});

test('an answered first add no longer shows "Reconnecting"', async (t) => {
  const { store, answer, pass } = await joined(t, []);
  await pass(10_000);
  await answer("/projects", { error: "Away." }, 500);
  assert.equal(store.get().link, "reconnecting");
  const adding = store.add("r1");
  await settle();
  await answer("/projects", { project: { id: "p1", name: "shop" } }, 201);
  await adding;
  assert.equal(store.get().link, "live");
});

test("when group work stops the board goes, and the page asks where group work stands", async (t) => {
  const { store, answer, pass } = await joined(t);
  await answer(first, feed(1, [hold("a")]));
  await answer(
    `${first}&epoch=e1&version=1&seen=1`,
    { reason: "stopped", error: "Group work has stopped." },
    503,
  );
  const { info, held, people: shown, asOf } = store.get();
  assert.deepEqual([info?.state, info?.me, held, shown, asOf], ["stopped", undefined, undefined, [], undefined]);
  await pass(1000);
  await answer("", { state: "stopped", reason: "lockLost", host: false });
  assert.equal(store.get().info?.reason, "lockLost");
  await pass(2000);
  // Ready again: the whole board is asked for.
  await answer("", { state: "ready", host: false, me });
  await answer(first, feed(1, []));
  assert.deepEqual(store.get().held, []);
  // Reset at the host: not set up, which is not "stopped".
  await answer(`${first}&epoch=e1&version=1&seen=1`, { reason: "notSetUp", error: "Not set up." }, 503);
  assert.equal(store.get().info?.state, "notSetUp");
});

test("an answer that comes after another repository was chosen, or after the page closed, is dropped", async (t) => {
  const { store, answer, waiting } = await joined(t);
  store.choose("p2");
  await settle();
  assert.deepEqual(waiting(), [first, "/projects/p2/feed?wait=25"]);
  await answer(first, feed(1, [hold("a")]));
  assert.deepEqual([store.get().project, store.get().held], ["p2", undefined]);
  store.close();
  await answer("/projects/p2/feed?wait=25", feed(1, [hold("b")]));
  assert.equal(store.get().held, undefined);
  assert.deepEqual(waiting(), []);
  // What ends after the page left (an add, a join, a stale fence) starts nothing again.
  store.reload();
  await settle();
  assert.deepEqual(waiting(), []);
});

test("a person the server no longer knows gets its sentence, and keeps the token until a join gives another", async (t) => {
  const { store, answer, waiting, pass } = await joined(t);
  const sentence = "You are not in this group.";
  assert.equal(await answer(first, { reason: "notJoined", error: sentence }, 403), "first");
  const { refused, info, held } = store.get();
  assert.deepEqual([refused, info?.me, held], [sentence, undefined, undefined]);
  // The join card is next: nothing is asked meanwhile.
  await pass(60_000);
  assert.deepEqual(waiting(), []);
  // After a reload the same token is sent.
  store.open();
  await settle();
  assert.equal(await answer("", { state: "ready", host: false }), "first");
  const joining = store.join("another code");
  await settle();
  assert.equal(await answer("/join", { token: "second" }), null);
  await joining;
  // The join card is gone before the next answer: a second press cannot send the code again.
  assert.deepEqual([store.get().refused, store.get().info], [undefined, undefined]);
  assert.equal(await answer("", { state: "ready", host: false, me }), "second");
  // They may be another person now: the repositories are asked for again.
  assert.deepEqual(waiting(), ["/projects"]);
});
