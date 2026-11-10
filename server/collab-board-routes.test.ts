/**
 * The group's repositories and their boards (routes/collab-board.ts), as
 * requests through the request guard, with real git repositories in a
 * temporary folder and the real clock. What depends on the time is tested
 * where the clock can be set: collab-hub.test.ts and collab-limits.test.ts.
 */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { CollabBoard, CollabHold } from "../shared/collab.js";
import { collabFixture, outcome, type Headers, type Reply } from "../test/collab-fixture.js";
import { CollabHub } from "./collab-hub.js";
import { participantHeader } from "./coordination-routes.js";
import { Coordinator, coordinationLimits } from "./coordination.js";
import { git } from "./process.js";
import {
  checkLimit,
  maxPathLength,
  maxPaths,
  maxTitle,
  workLimit,
} from "./routes/collab-board.js";
import { AppError, type Repository, type Run } from "./types.js";

/** Waits, a moment at a time and ten seconds at most, until `done` says so. */
async function until(done: () => boolean) {
  for (let turn = 0; turn < 2000 && !done(); turn += 1) await sleep(5);
  assert.ok(done());
}

/** A contribution of this BELL PR, as the store keeps one. */
const run = (id: string, repoId: string): Run => ({
  id,
  repoId,
  title: id,
  prompt: id,
  status: "review",
  branch: `bellpr/${id}`,
  baseBranch: "main",
  baseSha: "a".repeat(40),
  worktreePath: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  agents: [],
  logs: [],
  draft: { title: id, body: "" },
  reviewedFiles: [],
  reviewedFingerprints: {},
});

/**
 * The fixture's group (Ada the admin, Ben, and Cy who was removed) with one
 * more member, Dee, and what the tests ask of the boards.
 */
async function group(t: TestContext, options?: Parameters<typeof collabFixture>[1]) {
  const f = await collabFixture(t, options);
  const cast = await f.cast();
  const desk = await f.device("Desk D");
  const dee = await f.join(desk, await f.invite(cast.who.admin, { name: "Dee" }));
  const who = { ...cast.who, dee: { ...desk, [participantHeader]: dee.token } as Headers };
  const sources = await mkdtemp(path.join(tmpdir(), "bell-collab-sources-"));
  t.after(() => rm(sources, { recursive: true, force: true }));
  const asks = t.mock.method(CollabHub.prototype, "ask");

  /** A repository of this BELL PR: one commit on `main`, and a branch the group has no use for. */
  const repository = async (name: string) => {
    const folder = path.join(sources, name);
    await mkdir(folder);
    await git(folder, ["init", "-q", "-b", "main"]);
    await git(folder, ["config", "user.name", "Collab Test"]);
    await git(folder, ["config", "user.email", "collab@example.invalid"]);
    await git(folder, ["config", "commit.gpgsign", "false"]);
    await writeFile(path.join(folder, "README.md"), `${name}\n`);
    await git(folder, ["add", "README.md"]);
    await git(folder, ["commit", "-q", "-m", "first"]);
    await git(folder, ["branch", "side"]);
    const repo: Repository = {
      id: `repo-${name}`,
      name,
      owner: "local",
      fullName: `local/${name}`,
      path: folder,
      defaultBranch: "main",
      url: "",
    };
    f.store.data.repos.push(repo);
    return repo;
  };
  /** A new repository, added to the group by the admin: its project id. */
  const add = async (name: string) => {
    const repo = await repository(name);
    const added = await f.post("/projects", who.admin, { repoId: repo.id });
    assert.equal(added.status, 201, added.body);
    return added.json.project.id as string;
  };

  const feed = (asWho: Headers, project: string, query = "", signal?: AbortSignal) =>
    f.send("GET", `/api/collab/projects/${project}/feed${query}`, asWho, undefined, signal);
  /** The board as someone who has none yet is given it. */
  const board = async (project: string, asWho = who.admin): Promise<CollabBoard> => {
    const reply = await feed(asWho, project);
    assert.equal(reply.status, 200, reply.body);
    return reply.json.board;
  };
  /**
   * A feed request that has the current board and waits. The test goes on
   * once the server has the request; `query` is what it asked with.
   */
  const park = async (asWho: Headers, project: string, signal?: AbortSignal) => {
    const { json } = await feed(asWho, project);
    const query = `?epoch=${json.epoch}&version=${json.version}&seen=${json.seen}&wait=25`;
    const before = asks.mock.callCount();
    const reply = feed(asWho, project, query, signal);
    // Awaited by the test, later.
    reply.catch(() => undefined);
    await until(() => asks.mock.callCount() > before);
    return { reply, query };
  };
  const check = (asWho: Headers, project: string, scopes: unknown) =>
    f.post(`/projects/${project}/check`, asWho, { scopes });
  const work = (asWho: Headers, project: string, body: unknown) =>
    f.post(`/projects/${project}/work`, asWho, body);
  const hold = async (asWho: Headers, project: string, body: unknown): Promise<CollabHold> => {
    const made = await work(asWho, project, body);
    assert.equal(made.status, 201, made.body);
    return made.json.hold;
  };
  const release = (
    asWho: Headers,
    project: string,
    held: Pick<CollabHold, "claimId" | "fence">,
  ) => f.post(`/projects/${project}/holds/${held.claimId}/release`, asWho, { fence: held.fence });
  const revoke = (asWho: Headers, project: string, claimId: string, body: unknown = {}) =>
    f.post(`/projects/${project}/holds/${claimId}/revoke`, asWho, body);

  return {
    ...cast,
    f,
    dee,
    who,
    sources,
    repository,
    add,
    feed,
    board,
    park,
    check,
    work,
    hold,
    release,
    revoke,
  };
}

/** The fields a refusal of group work may have. */
const refusalFields = ["reason", "error", "conflicts", "retryAfter", "invalid", "meets"];
const fieldsOf = (reply: Reply) => Object.keys(reply.json).sort();

test("add a repository: the group gets its own bare copy of the default branch, once; a copy that fails leaves nothing", async (t) => {
  const g = await group(t);
  const { f, who } = g;
  const widgets = await g.repository("widgets");
  const gadgets = await g.repository("gadgets");
  // Not offered: its folder is gone, or it has no branch of that name.
  const gone = await g.repository("gone");
  await rm(gone.path, { recursive: true });
  const branchless = await g.repository("branchless");
  branchless.defaultBranch = "trunk";
  const list = (asWho: Headers) => f.send("GET", "/api/collab/projects", asWho);
  const add = (asWho: Headers, body: unknown) => f.post("/projects", asWho, body);
  const storage = async () => ({
    used: Buffer.byteLength((await f.files())[1]),
    max: coordinationLimits.bytes,
  });

  const before = await list(who.admin);
  assert.deepEqual([before.status, before.json], [200, {
    projects: [],
    addable: [
      { repoId: widgets.id, name: "local/widgets" },
      { repoId: gadgets.id, name: "local/gadgets" },
    ],
    storage: await storage(),
  }]);
  // A member is told the group's repositories, and nothing of this BELL PR's others.
  const asMember = await list(who.member);
  assert.deepEqual([asMember.status, asMember.json], [200, { projects: [] }]);

  assert.equal(outcome(await add(who.member, { repoId: widgets.id })), "403 adminOnly");
  for (const repoId of ["repo-none", "__proto__", "constructor"])
    assert.equal(outcome(await add(who.admin, { repoId })), "400 unknownRepository", repoId);
  for (const body of [{}, { repoId: 7 }, { repoId: widgets.id, name: "Widgets" }])
    assert.equal((await add(who.admin, body)).status, 400, JSON.stringify(body));
  assert.equal(existsSync(f.paths.collabRepos), false);

  const added = await add(who.admin, { repoId: widgets.id });
  assert.equal(added.status, 201, added.body);
  const id: string = added.json.project.id;
  assert.match(id, /^p-[0-9a-f]{10}$/);
  assert.deepEqual(added.json, { project: { id, name: "local/widgets" } });
  // The copy is bare and has the default branch alone, where the repository has it.
  const copy = path.join(f.paths.collabRepos, `${id}.git`);
  const head = (await git(widgets.path, ["rev-parse", "main"])).stdout.trim();
  assert.equal((await git(copy, ["rev-parse", "--is-bare-repository"])).stdout.trim(), "true");
  const refs = await git(copy, ["for-each-ref", "--format=%(refname) %(objectname)"]);
  assert.equal(refs.stdout.trim(), `refs/heads/main ${head}`);
  // Named in the side file, defined in the coordinator on that copy, and on the board.
  const entry = JSON.parse((await f.files())[0]).projects[id];
  assert.deepEqual(Object.keys(entry), ["name", "repoId", "addedAt"]);
  assert.deepEqual([entry.name, entry.repoId], ["local/widgets", widgets.id]);
  const coordinator = f.collab.coordinator();
  assert.equal(coordinator.project(coordinator.authenticate(g.ada.token), id).branch.sha, head);
  assert.deepEqual(await g.board(id), {
    project: { id, name: "local/widgets", repoId: widgets.id },
    people: [
      { id: g.ada.id, name: "Ada", admin: true },
      { id: g.ben.id, name: "Ben" },
      { id: g.dee.id, name: "Dee" },
    ],
    held: [],
    released: [],
  });

  assert.equal(outcome(await add(who.admin, { repoId: widgets.id })), "409 alreadyAdded");
  const after = await list(who.admin);
  assert.deepEqual(after.json, {
    projects: [{ id, name: "local/widgets" }],
    addable: [{ repoId: gadgets.id, name: "local/gadgets" }],
    storage: await storage(),
  });
  assert.deepEqual((await list(who.member)).json, { projects: [{ id, name: "local/widgets" }] });

  // A copy that fails leaves no folder and no entry, and the answer says nothing of this computer.
  const kept = await f.files();
  for (const repo of [gone, branchless]) {
    const failed = await add({ ...who.admin, "x-bell-locale": "en" }, { repoId: repo.id });
    assert.deepEqual([failed.status, failed.json], [500, {
      reason: "cloneFailed",
      error: "BELL PR could not copy the repository for the group. The log on the host has the details.",
    }]);
    for (const word of ["/", "\\", "fatal", g.sources, f.directory])
      assert.equal(failed.body.includes(word), false, word);
  }
  assert.deepEqual(await f.files(), kept);
  assert.deepEqual(await readdir(f.paths.collabRepos), [`${id}.git`]);
  // Why it failed is in the log on the host.
  const copies = f.logged.filter((line) => line.includes("Group work could not copy a repository"));
  assert.equal(copies.length, 2);
  assert.ok(copies.every((line) => line.includes("fatal")));

  // BELL PR forgets the repository: the group keeps it under the name it had.
  f.store.data.repos.splice(0);
  assert.deepEqual((await list(who.admin)).json, {
    projects: [{ id, name: "local/widgets" }],
    addable: [],
    storage: await storage(),
  });
  assert.equal((await g.board(id)).project.name, "local/widgets");
  await f.nothingLeaked();
});

test("work: a title and paths become a hold; a held path in the way is refused with who holds it, and nothing is made", async (t) => {
  const g = await group(t);
  const { f, who, ada, ben, dee } = g;
  const project = await g.add("widgets");

  const made = await g.work(who.member, project, {
    title: "  Fix the\tparser\u202e ",
    scopes: ["./src/parser/", "docs/guide.md"],
  });
  assert.equal(made.status, 201, made.body);
  assert.deepEqual(Object.keys(made.json), ["hold"]);
  const held: CollabHold = made.json.hold;
  assert.deepEqual(Object.keys(held), [
    "claimId",
    "taskId",
    "title",
    "holder",
    "scopes",
    "fence",
    "since",
  ]);
  assert.match(held.taskId, /^t-[0-9a-f]{10}$/);
  assert.ok(Date.parse(held.since) > 0);
  assert.deepEqual([held.title, held.holder, held.scopes, held.fence], [
    "Fix the parser",
    ben.id,
    ["src/parser", "docs/guide.md"],
    1,
  ]);
  assert.deepEqual((await g.board(project)).held, [held]);

  // In the way: inside a held folder, the same path in another case, and the asker's own hold.
  const kept = await f.files();
  const inTheWay: [Headers, string][] = [
    [who.dee, "src/parser/lexer.ts"],
    [who.admin, "SRC/Parser"],
    [who.member, "src"],
  ];
  for (const [asWho, scope] of inTheWay) {
    const refused = await g.work({ ...asWho, "x-bell-locale": "en" }, project, {
      title: "Another",
      scopes: ["lib", scope],
    });
    assert.deepEqual([refused.status, refused.json], [409, {
      reason: "conflict",
      error: "Someone already holds a path that is in the way. Nothing was held.",
      conflicts: [{ scope: "src/parser", holder: "Ben", title: "Fix the parser", since: held.since }],
    }], scope);
  }
  const inChinese = await g.work({ ...who.dee, "x-bell-locale": "zh-TW" }, project, {
    title: "Another",
    scopes: ["docs"],
  });
  assert.equal(inChinese.json.error, "已經有人佔用了會互相衝突的路徑，所以這次沒有佔用任何路徑。");
  assert.equal(inChinese.json.conflicts[0].scope, "docs/guide.md");
  assert.deepEqual(await f.files(), kept);

  // Asking first: which of these paths cannot be held as sent, and which meet a hold.
  const asked = await g.check(who.dee, project, [
    "constructor/x",
    "__proto__",
    "src/parser/lexer.ts",
    "lib",
  ]);
  assert.equal(asked.status, 200, asked.body);
  assert.ok(Date.parse(asked.json.asOf) > 0);
  assert.deepEqual({ ...asked.json, asOf: "" }, {
    asOf: "",
    invalid: ["constructor/x", "__proto__"],
    meets: [
      {
        scope: "src/parser",
        claimId: held.claimId,
        taskId: held.taskId,
        title: "Fix the parser",
        holder: "Ben",
      },
    ],
  });
  assert.deepEqual(await f.files(), kept);

  // Only its holder releases a hold, and only with its fence.
  assert.equal(outcome(await g.release(who.dee, project, held)), "403 notHolder");
  assert.equal(outcome(await g.release(who.admin, project, held)), "403 notHolder");
  const stale = await g.release(who.member, project, { ...held, fence: held.fence + 1 });
  assert.equal(outcome(stale), "409 staleFence");
  assert.deepEqual(fieldsOf(stale), ["error", "reason"]);
  const released = await g.release(who.member, project, held);
  assert.deepEqual([released.status, released.json], [200, { ok: true }]);
  assert.equal(outcome(await g.release(who.member, project, held)), "409 ended");

  // Free again: anyone takes the task, under its title and with the paths they name.
  const again = await g.hold(who.dee, project, { taskId: held.taskId, scopes: ["src"] });
  assert.notEqual(again.claimId, held.claimId);
  assert.deepEqual([again.taskId, again.title, again.holder, again.scopes, again.fence], [
    held.taskId,
    "Fix the parser",
    dee.id,
    ["src"],
    2,
  ]);
  const taken = await g.work(who.member, project, { taskId: held.taskId, scopes: ["lib"] });
  assert.equal(outcome(taken), "409 taskClaimed");
  for (const taskId of ["t-0000000000", "__proto__"]) {
    const unknown = await g.work(who.member, project, { taskId, scopes: ["lib"] });
    assert.equal(outcome(unknown), "404 unknownTask", taskId);
  }

  // Only an admin ends someone else's hold.
  assert.equal(outcome(await g.revoke(who.member, project, again.claimId)), "403 adminOnly");
  const revoked = await g.revoke(who.admin, project, again.claimId, { reason: " Off\tsick\n" });
  assert.deepEqual([revoked.status, revoked.json], [200, { ok: true }]);
  assert.equal(outcome(await g.revoke(who.admin, project, again.claimId)), "409 ended");
  assert.equal(outcome(await g.revoke(who.admin, project, "no-such-hold")), "404 unknownClaim");
  const noHold = await g.release(who.member, project, { claimId: "no-such-hold", fence: 1 });
  assert.equal(outcome(noHold), "404 unknownClaim");
  const [free] = (await g.board(project)).released;
  assert.deepEqual({ ...free, at: "" }, {
    taskId: held.taskId,
    title: "Fix the parser",
    scopes: ["src"],
    at: "",
    by: ada.id,
    how: "revoked",
    reason: "Off sick",
  });

  // A contribution of this BELL PR goes with a task only when it is this repository's.
  const gadgets = await g.repository("gadgets");
  f.store.data.runs.push(run("run-widgets", "repo-widgets"), run("run-gadgets", gadgets.id));
  const before = await f.files();
  for (const runId of ["run-gadgets", "run-none", "__proto__"]) {
    const refused = await g.work(who.member, project, { title: "With a run", scopes: ["lib"], runId });
    assert.equal(outcome(refused), "400 unknownRun", runId);
  }
  assert.deepEqual(await f.files(), before);
  const withRun = await g.hold(who.member, project, {
    title: "With a run",
    scopes: ["lib"],
    runId: "run-widgets",
  });
  assert.deepEqual(Object.keys(withRun), [
    "claimId",
    "taskId",
    "title",
    "runId",
    "holder",
    "scopes",
    "fence",
    "since",
  ]);
  assert.equal(withRun.runId, "run-widgets");
  const saved = JSON.parse((await f.files())[0]).tasks[`${project}/${withRun.taskId}`];
  assert.deepEqual(Object.keys(saved), ["title", "runId", "createdAt"]);
  assert.deepEqual([saved.title, saved.runId], ["With a run", "run-widgets"]);
  await f.nothingLeaked();
});

test("the board: what is held, oldest first; what is free to take, newest first and 20 at most; and the people", async (t) => {
  // Two holds a person, so the coordinator is full for Ben at the third.
  const g = await group(t, { limits: { participantHeldClaims: 2 } });
  const { who, ada, ben, dee } = g;
  const project = await g.add("widgets");
  const one = await g.hold(who.member, project, { title: "One", scopes: ["one"] });
  const two = await g.hold(who.member, project, { title: "Two", scopes: ["two"] });
  const full = await g.work({ ...who.member, "x-bell-locale": "en" }, project, {
    title: "Three",
    scopes: ["three"],
  });
  // The reason and a sentence, and none of the coordinator's numbers.
  assert.deepEqual([full.status, full.json], [409, {
    reason: "full",
    error: "The group's record is full. Ask the host to reset group storage.",
  }]);
  let board = await g.board(project, who.member);
  assert.deepEqual(board.held, [one, two]);
  // The task was made before the hold was refused: nobody held it yet, and it is free to take.
  assert.equal(board.released.length, 1);
  const [three] = board.released;
  assert.ok(Date.parse(three.at) >= Date.parse(two.since));
  assert.deepEqual({ ...three, taskId: "", at: "" }, {
    taskId: "",
    title: "Three",
    scopes: [],
    at: "",
    how: "never",
  });
  await g.hold(who.dee, project, { taskId: three.taskId, scopes: ["three"] });

  // 21 more, each released before the next is made.
  const titles: string[] = [];
  for (let n = 1; n <= 21; n += 1) {
    const made = await g.hold(who.dee, project, { title: `Task ${n}`, scopes: [`area-${n}`] });
    assert.equal((await g.release(who.dee, project, made)).status, 200);
    titles.unshift(`Task ${n}`);
  }
  board = await g.board(project);
  assert.deepEqual(board.released.map((task) => task.title), titles.slice(0, 20));
  assert.ok(board.released.every((task) => task.how === "released" && task.by === dee.id));
  assert.equal(board.moreReleased, 1);
  assert.deepEqual(board.held.map((hold) => hold.title), ["One", "Two", "Three"]);

  // An admin ends One with a reason, then Ben lets go of Two.
  await sleep(2);
  const revoked = await g.revoke(who.admin, project, one.claimId, { reason: "Needed elsewhere" });
  assert.equal(revoked.status, 200, revoked.body);
  await sleep(2);
  assert.equal((await g.release(who.member, project, two)).status, 200);
  board = await g.board(project);
  assert.deepEqual(board.released.slice(0, 3).map((task) => ({ ...task, at: "" })), [
    { taskId: two.taskId, title: "Two", scopes: ["two"], at: "", by: ben.id, how: "released" },
    {
      taskId: one.taskId,
      title: "One",
      scopes: ["one"],
      at: "",
      by: ada.id,
      how: "revoked",
      reason: "Needed elsewhere",
    },
    { ...board.released[2], title: "Task 21", at: "" },
  ]);
  assert.equal(board.released.length, 20);
  assert.equal(board.moreReleased, 3);
  assert.deepEqual(board.held.map((hold) => [hold.title, hold.holder]), [["Three", dee.id]]);
  // Cy was removed and holds nothing: not on the board.
  assert.deepEqual(board.people, [
    { id: ada.id, name: "Ada", admin: true },
    { id: ben.id, name: "Ben" },
    { id: dee.id, name: "Dee" },
  ]);
  assert.deepEqual(board.project, { id: project, name: "local/widgets", repoId: "repo-widgets" });
});

test("remove: what the person holds ends in every repository, and so does their waiting request", async (t) => {
  const g = await group(t);
  const { f, who, ada, ben, dee } = g;
  const widgets = await g.add("widgets");
  const gadgets = await g.add("gadgets");
  const first = await g.hold(who.member, widgets, { title: "First", scopes: ["a"] });
  await g.hold(who.member, widgets, { title: "Second", scopes: ["b"] });
  await g.hold(who.member, gadgets, { title: "Third", scopes: ["a"] });
  const hers = await g.hold(who.dee, gadgets, { title: "Fourth", scopes: ["b"] });
  // One of his holds cannot end just now, as when it ended a moment before.
  const revoke = Coordinator.prototype.revoke;
  let refused = 0;
  t.mock.method(
    Coordinator.prototype,
    "revoke",
    function (this: Coordinator, ...args: Parameters<Coordinator["revoke"]>) {
      if (args[2] !== first.claimId || refused) return revoke.apply(this, args);
      refused += 1;
      return Promise.reject(new AppError("Not now", 409, { details: { reason: "ended" } }));
    },
  );
  const waiting = await g.park(who.member, widgets);

  const removed = await f.post(`/people/${ben.id}/remove`, who.admin);
  assert.deepEqual([removed.status, removed.json], [200, { revoked: 2, unpaired: false }]);
  assert.equal(refused, 1);
  // His waiting request ended with nothing to read, and he may ask no more.
  const ended = await waiting.reply;
  assert.deepEqual([ended.status, ended.body], [204, ""]);
  assert.equal(outcome(await g.feed(who.member, widgets)), "403 notJoined");
  assert.equal(outcome(await g.release(who.member, widgets, first)), "403 notJoined");

  // The hold that stayed is on the board under his name, and he with it.
  let board = await g.board(widgets);
  assert.deepEqual(board.held, [first]);
  assert.deepEqual(board.people, [
    { id: ada.id, name: "Ada", admin: true },
    { id: ben.id, name: "Ben", removed: true },
    { id: dee.id, name: "Dee" },
  ]);
  assert.deepEqual(board.released.map((task) => [task.title, task.how, task.by]), [
    ["Second", "revoked", ada.id],
  ]);
  // In the other repository he holds nothing now, so he is not on its board.
  const other = await g.board(gadgets);
  assert.deepEqual(other.held, [hers]);
  assert.deepEqual(other.people.map((person) => person.name), ["Ada", "Dee"]);
  assert.deepEqual(other.released.map((task) => [task.title, task.how, task.by]), [
    ["Third", "revoked", ada.id],
  ]);

  // The admin ends what stayed: he is gone from that board too.
  assert.equal((await g.revoke(who.admin, widgets, first.claimId)).status, 200);
  board = await g.board(widgets);
  assert.deepEqual(board.held, []);
  assert.deepEqual(board.people.map((person) => person.name), ["Ada", "Dee"]);
  assert.deepEqual(board.released.map((task) => task.title).sort(), ["First", "Second"]);
  const again = await f.post(`/people/${ben.id}/remove`, who.admin);
  assert.deepEqual([again.status, again.json], [200, { revoked: 0, unpaired: false }]);
  await f.nothingLeaked();
});

test("the feed: the board at once for who is behind; who is current waits for a change, two requests a person at most", async (t) => {
  const g = await group(t);
  const { who, ben } = g;
  const project = await g.add("widgets");

  const first = await g.feed(who.member, project);
  assert.equal(first.status, 200, first.body);
  assert.match(String(first.headers["content-type"]), /^application\/json/);
  assert.equal(first.headers["cache-control"], "no-store");
  assert.deepEqual(Object.keys(first.json), ["epoch", "version", "seen", "asOf", "board", "present"]);
  assert.match(first.json.epoch, /^[0-9a-f]{16}$/);
  assert.deepEqual([first.json.version, first.json.seen, first.json.present], [1, 1, [ben.id]]);
  assert.deepEqual(first.json.board.held, []);
  // Current, and not willing to wait: nothing to read.
  const current = `?epoch=${first.json.epoch}&version=1&seen=1`;
  const nothing = await g.feed(who.member, project, current);
  assert.deepEqual([nothing.status, nothing.body], [204, ""]);
  // Another epoch (BELL PR started again since) is behind, whatever its numbers.
  const restarted = await g.feed(who.member, project, "?epoch=0000000000000000&version=1&seen=1");
  assert.deepEqual([restarted.status, restarted.json.version], [200, 1]);
  for (const query of ["?wait=26", "?wait=soon", "?version=-1", "?seen=1.5", `?epoch=${"e".repeat(65)}`])
    assert.equal((await g.feed(who.member, project, query)).status, 400, query);

  // Current and waiting: answered when someone takes work, with the new board.
  const waiting = await g.park(who.member, project);
  const held = await g.hold(who.dee, project, { title: "Parser", scopes: ["src"] });
  const told = await waiting.reply;
  assert.equal(told.status, 200, told.body);
  assert.deepEqual([told.json.version, told.json.seen, told.json.present], [2, 1, [ben.id]]);
  assert.deepEqual(told.json.board.held, [held]);

  // Dee looks too, and waits. Then two requests of one person wait; a third
  // is refused until one of them goes away.
  const hers = await g.park(who.dee, project);
  const gone = new AbortController();
  const one = await g.park(who.member, project, gone.signal);
  const two = await g.park(who.member, project);
  assert.match(two.query, /&seen=2&/);
  const third = await g.feed(who.member, project, two.query);
  assert.equal(outcome(third), "429 tooManyWaiters");
  assert.deepEqual(fieldsOf(third), ["error", "reason"]);
  gone.abort();
  await assert.rejects(one.reply);
  // The server hears of it a moment later; then a request waits its second and has nothing to read.
  let retried = third;
  for (let turn = 0; turn < 2000 && retried.status === 429; turn += 1) {
    await sleep(5);
    retried = await g.feed(who.member, project, two.query.replace("wait=25", "wait=1"));
  }
  assert.deepEqual([retried.status, retried.body], [204, ""]);

  // One change answers everyone who waits, with the same words.
  assert.equal((await g.release(who.dee, project, held)).status, 200);
  const [his, her] = await Promise.all([two.reply, hers.reply]);
  assert.equal(his.status, 200, his.body);
  assert.equal(his.body, her.body);
  assert.deepEqual([his.json.version, his.json.board.held], [3, []]);
  assert.deepEqual(his.json.board.released.map((task: { title: string }) => task.title), ["Parser"]);
});

test("who may use the repositories and the boards: people of the group, and no 401 for a participant reason", async (t) => {
  const g = await group(t);
  const { f } = g;
  const project = await g.add("widgets");
  const prototype = Object.getOwnPropertyNames(Object.prototype);
  const who = {
    install: g.who.install,
    device: g.who.device,
    member: g.who.member,
    admin: g.who.admin,
    removed: g.who.removed,
    stranger: g.who.stranger,
  };
  type Who = keyof typeof who;
  const at = `/projects/${project}`;
  // What the two people of the group are answered; everyone else is not one of it.
  const rows: [string, string, unknown, { member: string; admin: string }][] = [
    ["GET", "/projects", undefined, { member: "200", admin: "200" }],
    [
      "POST",
      "/projects",
      { repoId: "repo-none" },
      { member: "403 adminOnly", admin: "400 unknownRepository" },
    ],
    ["GET", `${at}/feed`, undefined, { member: "200", admin: "200" }],
    ["POST", `${at}/check`, { scopes: ["src"] }, { member: "200", admin: "200" }],
    // The member is asked first and takes the path, so the admin finds it held.
    ["POST", `${at}/work`, { title: "Parser", scopes: ["src"] }, { member: "201", admin: "409 conflict" }],
    [
      "POST",
      `${at}/holds/no-such-hold/release`,
      { fence: 1 },
      { member: "404 unknownClaim", admin: "404 unknownClaim" },
    ],
    [
      "POST",
      `${at}/holds/no-such-hold/revoke`,
      {},
      { member: "403 adminOnly", admin: "404 unknownClaim" },
    ],
  ];
  for (const [method, urlPath, body, expected] of rows) {
    const name = `${method} /api/collab${urlPath}`;
    for (const asWho of Object.keys(who) as Who[]) {
      const reply = await f.send(method, `/api/collab${urlPath}`, who[asWho], body);
      const answer = asWho === "member" || asWho === "admin" ? expected[asWho] : "403 notJoined";
      assert.equal(outcome(reply), answer, `${name} as ${asWho}`);
      if (reply.status < 400) continue;
      assert.equal(typeof reply.json.error, "string");
      for (const field of Object.keys(reply.json))
        assert.ok(refusalFields.includes(field), `${name} as ${asWho}: ${field}`);
    }
    // 401 is the guard's alone: no app token, whatever the participant token.
    const noAppToken = await f.send(method, `/api/collab${urlPath}`, {
      [participantHeader]: g.ada.token,
    }, body);
    assert.equal(noAppToken.status, 401, name);
  }

  // No repository of the group, or the name of something every object has.
  for (const id of ["p-0000000000", "__proto__", "constructor"]) {
    const base = `/projects/${id}`;
    const replies = [
      await f.send("GET", `/api/collab${base}/feed`, who.member),
      await f.post(`${base}/check`, who.member, { scopes: ["src"] }),
      await f.post(`${base}/work`, who.member, { title: "Parser", scopes: ["lib"] }),
      await f.post(`${base}/holds/no-such-hold/release`, who.member, { fence: 1 }),
      await f.post(`${base}/holds/no-such-hold/revoke`, who.admin, {}),
    ];
    for (const reply of replies) assert.equal(outcome(reply), "404 unknownProject", id);
  }
  assert.deepEqual(Object.getOwnPropertyNames(Object.prototype), prototype);
  // A refusal is no failure worth a log line.
  assert.equal(f.logged.some((line) => line.includes("Request failed")), false);
  await f.nothingLeaked();
});

test("a host that stops answers 503 on every route, frees nothing, and does not wait for a request that waits", async (t) => {
  const g = await group(t);
  const { f, who } = g;
  const project = await g.add("widgets");
  const held = await g.hold(who.member, project, { title: "Parser", scopes: ["src"] });
  const waiting = await g.park(who.dee, project);
  const kept = await f.files();

  const started = Date.now();
  await f.collab.close();
  const ended = await waiting.reply;
  // Well before the 25 seconds the request was willing to wait.
  assert.ok(Date.now() - started < 10_000);
  assert.deepEqual([ended.status, ended.body, ended.headers.connection], [204, "", "close"]);

  const calls = [
    () => f.send("GET", "/api/collab/projects", who.admin),
    () => f.post("/projects", who.admin, { repoId: "repo-widgets" }),
    () => g.feed(who.member, project),
    () => g.check(who.member, project, ["src"]),
    () => g.work(who.member, project, { title: "More", scopes: ["lib"] }),
    () => g.release(who.member, project, held),
    () => g.revoke(who.admin, project, held.claimId),
    () => f.post(`/people/${g.ben.id}/remove`, who.admin),
  ];
  for (const [index, call] of calls.entries()) {
    const reply = await call();
    assert.equal(outcome(reply), "503 stopped", `call ${index}`);
    assert.deepEqual(fieldsOf(reply), ["error", "reason"]);
  }
  assert.deepEqual(await f.files(), kept);

  // Started again, the hold is where it was.
  await f.start();
  assert.deepEqual((await g.board(project)).held, [held]);
});

test("what a person may send: 50 paths of 300 characters, a title of 120, and so many calls in a while", async (t) => {
  const g = await group(t);
  const { f, who } = g;
  const project = await g.add("widgets");
  const kept = await f.files();
  const sent = { work: 0, check: 0 };
  const work = (body: unknown) => {
    sent.work += 1;
    return g.work({ ...who.member, "x-bell-locale": "en" }, project, body);
  };
  const check = (scopes: unknown) => {
    sent.check += 1;
    return g.check({ ...who.member, "x-bell-locale": "en" }, project, scopes);
  };
  const many = Array.from({ length: maxPaths + 1 }, (_, n) => `area-${n}`);
  const long = `${"dir/".repeat(maxPathLength / 4 - 1)}file`;
  assert.equal(long.length, maxPathLength);

  for (const reply of [await work({ title: "Many", scopes: many }), await check(many)]) {
    assert.deepEqual([reply.status, reply.json], [400, {
      reason: "tooManyScopes",
      error: "One hold takes at most 50 paths.",
    }]);
  }
  // A path too long is not said back; the others that cannot be held are.
  const refusals: [unknown, string[]][] = [
    [{ title: "Long", scopes: [`${long}s`] }, []],
    [{ title: "None", scopes: [] }, []],
    [
      { title: "Names", scopes: ["lib", "constructor/x", "__proto__", "a/prototype", "../up"] },
      ["constructor/x", "__proto__", "a/prototype", "../up"],
    ],
  ];
  for (const [body, invalid] of refusals) {
    const refused = await work(body);
    assert.equal(outcome(refused), "400 invalidScope", JSON.stringify(body).slice(0, 60));
    assert.deepEqual(refused.json.invalid, invalid);
    assert.deepEqual(fieldsOf(refused), ["error", "invalid", "reason"]);
    assert.match(refused.json.error, /at most 300 characters/);
  }
  const tooLong = await check([`${long}s`]);
  assert.deepEqual([outcome(tooLong), tooLong.json.invalid], ["400 invalidScope", []]);
  // Bodies are strict, and a title is one line of 120 characters with something to read in it.
  const bad = [
    {},
    { scopes: ["lib"] },
    { title: "t".repeat(maxTitle + 1), scopes: ["lib"] },
    { title: " \t\u202e\n", scopes: ["lib"] },
    { title: "Both", taskId: "t-0000000000", scopes: ["lib"] },
    { title: "More", scopes: ["lib"], more: true },
    { title: "Text", scopes: "lib" },
    { title: "Run", scopes: ["lib"], runId: 7 },
    { taskId: "t-0000000000", scopes: ["lib"], runId: "run-1" },
  ];
  for (const body of bad) assert.equal((await work(body)).status, 400, JSON.stringify(body));
  for (const scopes of [undefined, "lib", [7]])
    assert.equal((await check(scopes)).status, 400, JSON.stringify(scopes));
  assert.deepEqual(await f.files(), kept);

  // As long as it may be.
  const largest = await work({ title: "t".repeat(maxTitle), scopes: [long] });
  assert.equal(largest.status, 201, largest.body);
  assert.deepEqual(largest.json.hold.scopes, [long]);
  const withOne = await f.files();

  // Refused calls count as well: the 31st within ten minutes is asked to wait.
  while (sent.work < workLimit.max) assert.equal((await work({})).status, 400);
  const slow = await work({ title: "One more", scopes: ["lib"] });
  assert.equal(outcome(slow), "429 slowDown");
  assert.deepEqual(fieldsOf(slow), ["error", "reason", "retryAfter"]);
  const { retryAfter } = slow.json;
  assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1);
  assert.ok(retryAfter <= workLimit.windowMs / 1000);
  assert.equal(
    slow.json.error,
    `Too many requests in a short time. Try again in ${retryAfter} seconds.`,
  );
  assert.deepEqual(await f.files(), withOne);
  // Each person is counted alone, and each kind of call.
  await g.hold(who.dee, project, { title: "Hers", scopes: ["lib"] });
  while (sent.check < checkLimit.max) assert.equal((await check(["lib"])).status, 200);
  const hurried = await check(["lib"]);
  assert.equal(outcome(hurried), "429 slowDown");
  assert.ok(hurried.json.retryAfter >= 1 && hurried.json.retryAfter <= checkLimit.windowMs / 1000);
  assert.equal((await g.check(who.dee, project, ["lib"])).status, 200);
});
