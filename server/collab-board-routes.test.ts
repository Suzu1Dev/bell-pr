/**
 * The group's repositories and their boards (routes/collab-board.ts), as
 * requests through the request guard, with real git repositories in a
 * temporary folder and the real clock. What depends on the time is tested
 * where the clock can be set: collab-hub.test.ts and collab-limits.test.ts.
 */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { CollabBoard, CollabHold } from "../shared/collab.js";
import { collabFixture, outcome, type Headers, type Reply } from "../test/collab-fixture.js";
import type { CollabHost } from "./collab-host.js";
import { CollabHub } from "./collab-hub.js";
import { participantHeader } from "./coordination-routes.js";
import { Coordinator, coordinationLimits } from "./coordination.js";
import { git } from "./process.js";
import {
  checkLimit,
  maxPathLength,
  maxPaths,
  maxTitle,
  maxUntaken,
  workLimit,
} from "./routes/collab-board.js";
import { AppError, type Repository } from "./types.js";

/** Waits, a moment at a time and ten seconds at most, until `done` says so. */
async function until(done: () => boolean) {
  for (let turn = 0; turn < 2000 && !done(); turn += 1) await sleep(5);
  assert.ok(done());
}

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

/** The fields a refusal in the access table may have: no row there names a dependency. */
const refusalFields = ["reason", "error", "conflicts", "retryAfter", "invalid"];
const fieldsOf = (reply: Reply) => Object.keys(reply.json).sort();

/**
 * Holds up the first take between its task and its hold: `reached` once it
 * is there, and `go` lets it on.
 */
function heldUp(t: TestContext) {
  const claim = Coordinator.prototype.claim;
  const first = { reached: false, go: () => {} };
  const gate = new Promise<void>((resolve) => (first.go = resolve));
  t.mock.method(
    Coordinator.prototype,
    "claim",
    async function (this: Coordinator, ...args: Parameters<Coordinator["claim"]>) {
      if (!first.reached) {
        first.reached = true;
        await gate;
      }
      return claim.apply(this, args);
    },
  );
  return first;
}

test("add a repository: the group gets its own bare copy of the default branch, once; a copy that fails leaves nothing", async (t) => {
  const g = await group(t);
  const { f, who } = g;
  const widgets = await g.repository("widgets");
  const gadgets = await g.repository("gadgets");
  // Not offered: its folder is gone, it has no branch of that name, or the
  // coordinator takes no branch of that name.
  const gone = await g.repository("gone");
  await rm(gone.path, { recursive: true });
  const branchless = await g.repository("branchless");
  branchless.defaultBranch = "trunk";
  const odd = await g.repository("odd");
  odd.defaultBranch = "release+1";
  await git(odd.path, ["branch", odd.defaultBranch]);
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
  // Every active group member sees addable repositories and can add projects to the group.
  const asMember = await list(who.member);
  assert.deepEqual([asMember.status, asMember.json], [before.status, before.json]);

  assert.equal(outcome(await add(who.stranger, { repoId: widgets.id })), "403 notJoined");
  for (const repoId of ["repo-none", "__proto__", "constructor"])
    assert.equal(outcome(await add(who.member, { repoId })), "400 unknownRepository", repoId);
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
  });

  assert.equal(outcome(await add(who.admin, { repoId: widgets.id })), "409 alreadyAdded");
  const after = await list(who.admin);
  assert.deepEqual(after.json, {
    projects: [{ id, name: "local/widgets" }],
    addable: [{ repoId: gadgets.id, name: "local/gadgets" }],
    storage: await storage(),
  });
  assert.deepEqual((await list(who.member)).json, after.json);

  // A copy that fails, or one the coordinator then refuses, leaves no folder and
  // no entry, and the answer says nothing of this computer.
  const kept = await f.files();
  for (const repo of [gone, branchless, odd]) {
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
  assert.equal(copies.length, 3);
  assert.equal(copies.filter((line) => line.includes("fatal")).length, 2);

  // BELL PR forgets the repository: the group keeps it under the name it had.
  f.store.data.repos.splice(0);
  assert.deepEqual((await list(who.admin)).json, {
    projects: [{ id, name: "local/widgets" }],
    addable: [],
    storage: await storage(),
  });
  assert.equal((await g.board(id)).project.name, "local/widgets");

  // A name longer than the side file takes is cut to what it takes; a regular member can add it.
  const long = await g.repository("long");
  long.fullName = `local/${"n".repeat(200)}`;
  const cut = await add(who.member, { repoId: long.id });
  assert.deepEqual([cut.status, cut.json.project.name], [201, long.fullName.slice(0, 200)]);
  await f.nothingLeaked();
});

test("work: a title and paths become a hold; a held path in the way is refused with who holds it, and nothing is made", async (t) => {
  const g = await group(t);
  const { f, who, ben, dee } = g;
  const project = await g.add("widgets");

  const made = await g.work(who.member, project, {
    title: "  Fix the\tparser\u202e ",
    scopes: ["./src/parser/", "docs/guide.md"],
  });
  assert.equal(made.status, 201, made.body);
  assert.deepEqual(Object.keys(made.json), ["hold", "changing"]);
  assert.deepEqual(made.json.changing, []);
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
      error: "Someone already holds a path that overlaps yours. Nothing was held.",
      conflicts: [{ scope: "src/parser", holder: "Ben", title: "Fix the parser", since: held.since }],
    }], scope);
  }
  const inChinese = await g.work({ ...who.dee, "x-bell-locale": "zh-TW" }, project, {
    title: "Another",
    scopes: ["docs"],
  });
  assert.equal(inChinese.json.error, "已經有人佔用了和你重疊的路徑，所以這次沒有佔用任何路徑。");
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
    changing: [],
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

  // Free again: anyone holds those paths, as a new task with a new title.
  const again = await g.hold(who.dee, project, { title: "Parser, again", scopes: ["src"] });
  assert.notEqual(again.taskId, held.taskId);
  assert.deepEqual([again.title, again.holder, again.scopes, again.fence], [
    "Parser, again",
    dee.id,
    ["src"],
    2,
  ]);
  // The side file keeps the title of a task and nothing else.
  const saved = JSON.parse((await f.files())[0]).tasks;
  assert.deepEqual(saved[`${project}/${again.taskId}`], { title: "Parser, again" });

  // Only an admin ends someone else's hold, and says nothing with it.
  assert.equal(outcome(await g.revoke(who.member, project, again.claimId)), "403 adminOnly");
  const worded = await g.revoke(who.admin, project, again.claimId, { reason: "Off sick" });
  assert.equal(worded.status, 400, worded.body);
  const revoked = await g.revoke(who.admin, project, again.claimId);
  assert.deepEqual([revoked.status, revoked.json], [200, { ok: true }]);
  assert.equal(outcome(await g.revoke(who.admin, project, again.claimId)), "409 ended");
  assert.equal(outcome(await g.revoke(who.admin, project, "no-such-hold")), "404 unknownClaim");
  const noHold = await g.release(who.member, project, { claimId: "no-such-hold", fence: 1 });
  assert.equal(outcome(noHold), "404 unknownClaim");
  assert.deepEqual((await g.board(project)).held, []);
  await f.nothingLeaked();
});

test("work: a path that someone took in between is refused as a held path is", async (t) => {
  const g = await group(t);
  const { who } = g;
  const project = await g.add("widgets");
  // Ben's take is on its way when Dee takes the folder above his.
  const first = heldUp(t);
  const his = g.work(who.member, project, { title: "Parser", scopes: ["src/parser"] });
  await until(() => first.reached);
  const hers = await g.hold(who.dee, project, { title: "Sources", scopes: ["src"] });
  first.go();
  const refused = await his;
  assert.equal(outcome(refused), "409 conflict");
  assert.deepEqual(refused.json.conflicts, [
    { scope: "src", holder: "Dee", title: "Sources", since: hers.since },
  ]);
  assert.deepEqual((await g.board(project)).held, [hers]);
});

test("dependsOn: work is held only once each task it names is done; a task not done, or not the repository's, is refused and nothing is made", async (t) => {
  const g = await group(t);
  const { f, who } = g;
  const project = await g.add("widgets");
  const other = await g.add("gadgets");
  const en = (asWho: Headers): Headers => ({ ...asWho, "x-bell-locale": "en" });
  const ui = (dependsOn: unknown, asWho = who.dee) =>
    g.work(asWho, project, { title: "UI", scopes: ["web"], dependsOn });
  const finish = (held: CollabHold, asWho: Headers, body: unknown) =>
    f.post(`/projects/${project}/holds/${held.claimId}/release`, asWho, body);
  const savedTask = async (taskId: string) =>
    JSON.parse((await f.files())[0]).tasks[`${project}/${taskId}`];

  const api = await g.hold(who.member, project, { title: "API", scopes: ["src/api"] });
  const elsewhere = await g.hold(who.dee, other, { title: "Elsewhere", scopes: ["lib"] });
  const kept = await f.files();

  // Not a task of this repository: an id nobody made, another repository's
  // task, and an id that is no task at all. Only those are named back.
  for (const dependsOn of [["t-0000000000"], [elsewhere.taskId], [api.taskId, "__proto__"]]) {
    const refused = await ui(dependsOn, en(who.dee));
    assert.deepEqual([refused.status, refused.json], [400, {
      reason: "dependencyUnknown",
      error: "This work depends on a task this repository does not have. Nothing was held.",
      unknown: dependsOn.filter((id) => id !== api.taskId),
    }], dependsOn.join());
  }
  // Not a list of ids: the body's shape.
  for (const dependsOn of [api.taskId, [7]])
    assert.equal((await ui(dependsOn)).status, 400, JSON.stringify(dependsOn));
  // More than 50 ids, in the person's language; an id longer than a task's is no task.
  const fiftyOne = Array.from({ length: 51 }, (_, index) => `t-${index}`);
  const tooMany = await ui(fiftyOne, en(who.dee));
  assert.deepEqual([tooMany.status, tooMany.json], [400, {
    reason: "tooManyDependencies",
    error: "One work request depends on at most 50 tasks.",
  }]);
  const inChineseTooMany = await ui(fiftyOne, { ...who.dee, "x-bell-locale": "zh-TW" });
  assert.equal(inChineseTooMany.json.error, "一項工作最多相依 50 個任務。");
  const long = "t".repeat(65);
  assert.deepEqual((await ui([long, api.taskId], en(who.dee))).json, {
    reason: "dependencyUnknown",
    error: "This work depends on a task this repository does not have. Nothing was held.",
    unknown: [long],
  });

  // Blocked: API is held and not done. Nothing is made, nothing is held.
  const blocked = await ui([api.taskId], en(who.dee));
  assert.deepEqual([blocked.status, blocked.json], [409, {
    reason: "dependencyPending",
    error: "This work depends on a task that is not done yet. Nothing was held.",
    pending: [{ taskId: api.taskId, title: "API", held: true }],
  }]);
  const inChinese = await ui([api.taskId], { ...who.dee, "x-bell-locale": "zh-TW" });
  assert.equal(inChinese.json.error, "這個任務相依的任務還沒完成，所以這次沒有佔用任何路徑。");
  // Blocked comes first: the paths are free, and would be in the way of nobody.
  assert.deepEqual(await f.files(), kept);
  assert.deepEqual((await g.board(project)).held, [api]);

  // Released without `done`, or revoked: not done, and never now, since
  // that task is not held again.
  assert.equal((await g.release(who.member, project, api)).status, 200);
  assert.deepEqual((await ui([api.taskId])).json.pending, [
    { taskId: api.taskId, title: "API", held: false },
  ]);
  const second = await g.hold(who.member, project, { title: "API 2", scopes: ["src/api"] });
  assert.equal((await g.revoke(who.admin, project, second.claimId)).status, 200);
  assert.equal(outcome(await ui([second.taskId])), "409 dependencyPending");
  assert.deepEqual(await savedTask(second.taskId), { title: "API 2" });

  // Only its holder says it is done, and only in a release that is taken.
  const third = await g.hold(who.member, project, { title: "API 3", scopes: ["src/api"] });
  assert.equal(outcome(await finish(third, who.dee, { fence: third.fence, done: true })), "403 notHolder");
  const stale = await finish(third, who.member, { fence: third.fence + 1, done: true });
  assert.equal(outcome(stale), "409 staleFence");
  assert.equal((await finish(third, who.member, { fence: third.fence, done: "yes" })).status, 400);
  assert.equal(outcome(await ui([third.taskId])), "409 dependencyPending");
  assert.deepEqual(await savedTask(third.taskId), { title: "API 3" });

  // Done: the hold ends, the side file says when, and the work that waited is held.
  const done = await finish(third, who.member, { fence: third.fence, done: true });
  assert.deepEqual([done.status, done.json], [200, { ok: true }]);
  const finished = await savedTask(third.taskId);
  assert.deepEqual(Object.keys(finished), ["title", "doneAt"]);
  assert.ok(Date.parse(finished.doneAt) > 0);
  assert.equal(outcome(await finish(third, who.member, { fence: third.fence, done: true })), "409 ended");
  const waited = await ui([third.taskId, third.taskId]);
  assert.equal(waited.status, 201, waited.body);
  const held: CollabHold = waited.json.hold;
  // Named twice is named once.
  assert.deepEqual(held.dependsOn, [{ taskId: third.taskId, title: "API 3" }]);
  assert.deepEqual(await savedTask(held.taskId), { title: "UI", dependsOn: [third.taskId] });
  // The coordinator's task names none: its own rule would wait for an integration.
  const coordinator = f.collab.coordinator();
  const view = coordinator.project(coordinator.authenticate(g.dee.token), project);
  assert.deepEqual(view.tasks.find((task) => task.id === held.taskId)?.dependsOn, []);

  // One done and one not: waiting for that one alone.
  const docs = await g.work(who.member, project, {
    title: "Docs",
    scopes: ["docs"],
    dependsOn: [third.taskId, held.taskId],
  });
  assert.equal(outcome(docs), "409 dependencyPending");
  assert.deepEqual(docs.json.pending, [{ taskId: held.taskId, title: "UI", held: true }]);
  // No cycle can form: work makes a new task each time, it names only tasks
  // made before it, and what a task names never changes.
  assert.deepEqual(await savedTask(third.taskId), finished);
  await f.nothingLeaked();
});

test("dependsOn on the board: a hold names the tasks it waited for, the feed wakes for a task done, and done stays done after a restart", async (t) => {
  const g = await group(t);
  const { f, who } = g;
  const project = await g.add("widgets");
  const api = await g.hold(who.member, project, { title: "API", scopes: ["src/api"] });

  const first = await g.park(who.dee, project);
  const released = await f.post(`/projects/${project}/holds/${api.claimId}/release`, who.member, {
    fence: api.fence,
    done: true,
  });
  assert.equal(released.status, 200, released.body);
  assert.deepEqual((await first.reply).json.board.held, []);

  const second = await g.park(who.dee, project);
  const ui = await g.hold(who.admin, project, { title: "UI", scopes: ["web"], dependsOn: [api.taskId] });
  assert.deepEqual(Object.keys(ui), [
    "claimId",
    "taskId",
    "title",
    "holder",
    "scopes",
    "fence",
    "since",
    "dependsOn",
  ]);
  const told = await second.reply;
  assert.equal(told.status, 200, told.body);
  assert.deepEqual(told.json.board.held, [ui]);
  assert.deepEqual(told.json.board.held[0].dependsOn, [{ taskId: api.taskId, title: "API" }]);

  await f.start();
  assert.deepEqual((await g.board(project)).held, [ui]);
  const docs = await g.hold(who.dee, project, {
    title: "Docs",
    scopes: ["docs"],
    dependsOn: [api.taskId],
  });
  assert.deepEqual(docs.dependsOn, [{ taskId: api.taskId, title: "API" }]);
});

test("the task list offers active and done prerequisites, not unfinished ended holds", async (t) => {
  const g = await group(t);
  const { f, who } = g;
  const project = await g.add("widgets");
  const other = await g.add("gadgets");
  const elsewhere = await g.hold(who.dee, other, { title: "Elsewhere", scopes: ["lib/other.ts"] });
  const otherFinished = await g.hold(who.member, other, { title: "Gadgets done", scopes: ["docs/other.md"] });
  assert.equal(
    (
      await f.post(`/projects/${other}/holds/${otherFinished.claimId}/release`, who.member, {
        fence: otherFinished.fence,
        done: true,
      })
    ).status,
    200,
  );
  const list = (asWho: Headers = who.dee, id = project) =>
    f.send("GET", `/api/collab/projects/${id}/tasks`, asWho);

  const first = await g.hold(who.member, project, { title: "API", scopes: ["src/secret/api.ts"] });
  assert.deepEqual((await list()).json, {
    tasks: [{ taskId: first.taskId, title: "API", status: "held" }],
  });

  // Omitted `done`, explicit `done: false`, admin revoke, and removal auto-revoke all drop from `/tasks`.
  await g.release(who.member, project, first);
  assert.deepEqual((await list()).json, { tasks: [] });
  const pending = await g.work(who.dee, project, {
    title: "UI",
    scopes: ["web"],
    dependsOn: [first.taskId],
  });
  assert.deepEqual(pending.json.pending, [{ taskId: first.taskId, title: "API", held: false }]);

  const explicitFalse = await g.hold(who.member, project, { title: "Draft API", scopes: ["src/secret/draft.ts"] });
  const releasedFalse = await f.post(`/projects/${project}/holds/${explicitFalse.claimId}/release`, who.member, {
    fence: explicitFalse.fence,
    done: false,
  });
  assert.equal(releasedFalse.status, 200, releasedFalse.body);
  assert.deepEqual((await list()).json, { tasks: [] });

  const revokedHold = await g.hold(who.member, project, { title: "Abandoned", scopes: ["src/secret/abandoned.ts"] });
  assert.equal((await g.revoke(who.admin, project, revokedHold.claimId)).status, 200);
  assert.deepEqual((await list()).json, { tasks: [] });

  const deskE = await f.device("Desk E");
  const eve = await f.join(deskE, await f.invite(who.admin, { name: "Eve" }));
  const whoEve: Headers = { ...deskE, [participantHeader]: eve.token };
  await g.hold(whoEve, project, { title: "Eve hold", scopes: ["src/secret/eve.ts"] });
  assert.equal((await f.post(`/people/${eve.id}/remove`, who.admin)).status, 200);
  assert.deepEqual((await list()).json, { tasks: [] });

  const second = await g.hold(who.member, project, { title: "API 2", scopes: ["src/secret/api2.ts"] });
  const done = await f.post(`/projects/${project}/holds/${second.claimId}/release`, who.member, {
    fence: second.fence,
    done: true,
  });
  assert.equal(done.status, 200, done.body);
  const dependent = await g.hold(who.dee, project, {
    title: "UI",
    scopes: ["web/secret/ui.tsx"],
    dependsOn: [second.taskId],
  });

  const checkPayload = async () => {
    const reply = await list(who.member);
    assert.equal(reply.status, 200, reply.body);
    assert.deepEqual(Object.keys(reply.json), ["tasks"]);
    assert.deepEqual(reply.json, {
      tasks: [
        { taskId: second.taskId, title: "API 2", status: "done" },
        { taskId: dependent.taskId, title: "UI", status: "held" },
      ],
    });
    for (const entry of reply.json.tasks)
      assert.deepEqual(Object.keys(entry).sort(), ["status", "taskId", "title"]);
    for (const forbidden of [
      "scopes",
      "holder",
      "claimId",
      "fence",
      "since",
      "dependsOn",
      "src/secret",
      "web/secret",
      "lib/other.ts",
      "docs/other.md",
      "Elsewhere",
      "Gadgets done",
      "Ben",
      "Dee",
      "Eve",
      g.ben.id,
      g.dee.id,
      eve.id,
      second.claimId,
      dependent.claimId,
      "bpc_",
    ])
      assert.equal(reply.body.includes(forbidden), false, `leaked ${forbidden}`);
  };
  await checkPayload();

  // Strict cross-project isolation in both directions, and preserved across restart.
  const otherReply = await list(who.dee, other);
  assert.deepEqual(otherReply.json, {
    tasks: [
      { taskId: elsewhere.taskId, title: "Elsewhere", status: "held" },
      { taskId: otherFinished.taskId, title: "Gadgets done", status: "done" },
    ],
  });
  for (const cross of [second.taskId, dependent.taskId, "API 2", "UI"])
    assert.equal(otherReply.body.includes(cross), false, `cross-project leak ${cross}`);

  const unknown = await list(who.dee, "no-such");
  assert.equal(outcome(unknown), "404 unknownProject");
  assert.deepEqual(fieldsOf(unknown), ["error", "reason"]);

  await f.start();
  await checkPayload();
  await f.nothingLeaked();
});

/**
 * Holds up the host's next side-file write, which fails when `fails`.
 * `meanwhile` runs `steps` once the write is on its way, then lets it on,
 * also when a step fails: a write held up for good would hold up the end
 * of the test.
 */
function writeHeldUp(t: TestContext, host: CollabHost, { fails = false } = {}) {
  const saveSide = host.saveSide;
  let reached = false;
  let go = () => {};
  const gate = new Promise<void>((resolve) => (go = resolve));
  t.mock.method(host, "saveSide", async (change: Parameters<CollabHost["saveSide"]>[0]) => {
    if (!reached) {
      reached = true;
      await gate;
      if (fails) throw new Error("EIO: i/o error, write");
    }
    return saveSide(change);
  });
  return {
    async meanwhile<T>(steps: () => Promise<T>): Promise<T> {
      try {
        await until(() => reached);
        return await steps();
      } finally {
        go();
      }
    },
  };
}

test("dependsOn during a done release: the work waits for the done write and is held, instead of reading the task as ended and never done", async (t) => {
  const g = await group(t);
  const { f, who } = g;
  const project = await g.add("widgets");
  const other = await g.add("gadgets");
  const api = await g.hold(who.member, project, { title: "API", scopes: ["src/api"] });
  const runs = t.mock.method(f.collab, "run");

  const write = writeHeldUp(t, f.collab);
  const released = f.post(`/projects/${project}/holds/${api.claimId}/release`, who.member, {
    fence: api.fence,
    done: true,
  });
  const { waited, docs, early } = await write.meanwhile(async () => {
    // The hold has ended, and the side file does not say done yet.
    assert.deepEqual((await g.board(project)).held, []);
    // The work that waits for API is with the host, after the release.
    const before = runs.mock.callCount();
    let answered = false;
    const waited = g.work(who.dee, project, { title: "UI", scopes: ["web"], dependsOn: [api.taskId] });
    void waited.then(() => (answered = true));
    await until(() => runs.mock.callCount() > before);
    // Work that names no task, and work in another repository, do not wait.
    const docs = await g.hold(who.admin, project, { title: "Docs", scopes: ["docs"] });
    await g.hold(who.admin, other, { title: "Elsewhere", scopes: ["lib"], dependsOn: [] });
    return { waited, docs, early: answered };
  });
  assert.equal(early, false, "answered while the done write was on its way");
  assert.deepEqual((await released).json, { ok: true });
  const ui = await waited;
  assert.equal(ui.status, 201, ui.body);
  assert.deepEqual(ui.json.hold.dependsOn, [{ taskId: api.taskId, title: "API" }]);
  assert.deepEqual((await g.board(project)).held, [docs, ui.json.hold]);
});

test("a done write that fails: the release says the hold ended and cannot be done now, and the work that waited for it is told so", async (t) => {
  const g = await group(t);
  const { f, who } = g;
  const project = await g.add("widgets");
  const api = await g.hold(who.member, project, { title: "API", scopes: ["src/api"] });
  const runs = t.mock.method(f.collab, "run");
  const finish = (asWho: Headers) =>
    f.post(`/projects/${project}/holds/${api.claimId}/release`, asWho, {
      fence: api.fence,
      done: true,
    });

  const write = writeHeldUp(t, f.collab, { fails: true });
  const released = finish({ ...who.member, "x-bell-locale": "en" });
  const waited = write.meanwhile(async () => {
    const before = runs.mock.callCount();
    const waited = g.work(who.dee, project, { title: "UI", scopes: ["web"], dependsOn: [api.taskId] });
    await until(() => runs.mock.callCount() > before);
    return { waited };
  });

  const failed = await released;
  assert.deepEqual([failed.status, failed.json], [500, {
    reason: "doneNotSaved",
    error:
      "The hold ended, but its task can never be marked done now. Work waiting on it must name another task. See the log on the host.",
  }]);
  assert.ok(f.logged.some((line) => line.includes("could not save that a task is done")));
  // The work after it in the queue is answered, with what is true now.
  const ui = await (await waited).waited;
  assert.equal(outcome(ui), "409 dependencyPending");
  assert.deepEqual(ui.json.pending, [{ taskId: api.taskId, title: "API", held: false }]);
  assert.equal(outcome(await finish(who.member)), "409 ended");
  // Group work goes on.
  const next = await g.work(who.dee, project, { title: "UI", scopes: ["web"] });
  assert.equal(next.status, 201, next.body);
});

test("the board: what is held, oldest first, and the people; a hold that ended or was refused is not on it", async (t) => {
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
  assert.deepEqual(Object.keys(board), ["project", "people", "held"]);
  assert.deepEqual(board.held, [one, two]);

  // An admin ends One, Ben lets go of Two, and Dee holds the paths Ben was refused.
  assert.equal((await g.revoke(who.admin, project, one.claimId)).status, 200);
  assert.equal((await g.release(who.member, project, two)).status, 200);
  const three = await g.hold(who.dee, project, { title: "Three", scopes: ["three"] });
  board = await g.board(project);
  assert.deepEqual(board.held, [three]);
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
  // In the other repository he holds nothing now, so he is not on its board.
  const other = await g.board(gadgets);
  assert.deepEqual(other.held, [hers]);
  assert.deepEqual(other.people.map((person) => person.name), ["Ada", "Dee"]);

  // The admin ends what stayed: he is gone from that board too.
  assert.equal((await g.revoke(who.admin, widgets, first.claimId)).status, 200);
  board = await g.board(widgets);
  assert.deepEqual(board.held, []);
  assert.deepEqual(board.people.map((person) => person.name), ["Ada", "Dee"]);
  const again = await f.post(`/people/${ben.id}/remove`, who.admin);
  assert.deepEqual([again.status, again.json], [200, { revoked: 0, unpaired: false }]);
  await f.nothingLeaked();
});

test("remove: a take under way for the removed person is refused, and holds nothing", async (t) => {
  const g = await group(t);
  const { f, who, ben } = g;
  const project = await g.add("widgets");
  const first = heldUp(t);
  const taking = g.work(who.member, project, { title: "Parser", scopes: ["src"] });
  await until(() => first.reached);

  const removed = await f.post(`/people/${ben.id}/remove`, who.admin);
  assert.deepEqual([removed.status, removed.json], [200, { revoked: 0, unpaired: false }]);
  first.go();
  assert.equal(outcome(await taking), "403 notJoined");
  const board = await g.board(project);
  assert.deepEqual(board.held, []);
  assert.deepEqual(board.people.map((person) => person.name), ["Ada", "Dee"]);
});

test("remove: a take under way whose hold cannot be released again is answered that failure", async (t) => {
  const g = await group(t);
  const { f, who, ben } = g;
  const project = await g.add("widgets");
  const first = heldUp(t);
  t.mock.method(Coordinator.prototype, "release", () =>
    Promise.reject(new AppError("No room", 507, { details: { reason: "full" } })),
  );
  const taking = g.work(who.member, project, { title: "Parser", scopes: ["src"] });
  await until(() => first.reached);

  assert.equal((await f.post(`/people/${ben.id}/remove`, who.admin)).status, 200);
  first.go();
  assert.equal(outcome(await taking), "507 full");
  // The hold stayed, under his name, for an admin to end.
  const board = await g.board(project);
  assert.deepEqual(board.held.map((hold) => hold.title), ["Parser"]);
  assert.deepEqual(
    board.people.find((person) => person.id === ben.id),
    { id: ben.id, name: "Ben", removed: true },
  );
});

test("the feed: the board at once for who is behind; who is current waits for a change, two requests a person at most", async (t) => {
  const g = await group(t);
  const { f, who, ben } = g;
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

  // Someone joins the group: who waits is given the board with them on it.
  const again = await g.park(who.dee, project);
  const eve = await f.join(await f.device("Phone E"), await f.invite(who.admin, { name: "Eve" }));
  const joined = await again.reply;
  assert.deepEqual(joined.json.board.people.at(-1), { id: eve.id, name: "Eve" });
});

test("the feed: a person's connection that never reads keeps eight answers at most; more are refused", async (t) => {
  const g = await group(t);
  const { f, who } = g;
  const project = await g.add("widgets");
  const { json } = await g.feed(who.member, project);
  const request = (query: string) =>
    [
      `GET /api/collab/projects/${project}/feed${query} HTTP/1.1`,
      "host: 127.0.0.1:4311",
      ...Object.entries(who.member).map(([name, value]) => `${name}: ${value}`),
      "\r\n",
    ].join("\r\n");
  // One connection of Ben's: a request that waits, and behind it eight that are
  // given the board at once. None of those answers can leave before the first.
  const socket = connect(f.port, "127.0.0.1");
  t.after(() => socket.destroy());
  socket.write(
    request(`?epoch=${json.epoch}&version=${json.version}&seen=${json.seen}&wait=25`) +
      request("").repeat(maxUntaken),
  );
  const asked = async (expected: number) => {
    let reply = await g.feed(who.member, project, "?wait=0");
    for (let turn = 0; turn < 2000 && reply.status !== expected; turn += 1) {
      await sleep(5);
      reply = await g.feed(who.member, project, "?wait=0");
    }
    return reply;
  };
  const refused = await asked(429);
  assert.equal(outcome(refused), "429 tooManyWaiters");
  assert.deepEqual(fieldsOf(refused), ["error", "reason"]);
  // Only he is: someone else is given the board as ever.
  assert.equal((await g.feed(who.dee, project)).status, 200);
  // The connection goes, and its answers with it.
  socket.destroy();
  assert.equal((await asked(200)).status, 200);
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
      { member: "400 unknownRepository", admin: "400 unknownRepository" },
    ],
    ["GET", `${at}/feed`, undefined, { member: "200", admin: "200" }],
    ["POST", `${at}/check`, { scopes: ["src"] }, { member: "200", admin: "200" }],
    // The member is asked first and takes the path, so the admin finds it held.
    ["POST", `${at}/work`, { title: "Parser", scopes: ["src/secret/parser.ts"] }, { member: "201", admin: "409 conflict" }],
    ["GET", `${at}/tasks`, undefined, { member: "200", admin: "200" }],
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
  const assertNoTaskOrPathLeak = (reply: Reply, label: string) => {
    for (const leaked of ["src/secret/parser.ts", "\"tasks\"", "bpc_"])
      assert.equal(reply.body.includes(leaked), false, `${label}: leaked ${leaked}`);
  };
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
      if (urlPath === `${at}/tasks`) {
        assert.equal(reply.body.includes("Parser"), false, `${name} as ${asWho}: leaked title`);
        assertNoTaskOrPathLeak(reply, `${name} as ${asWho}`);
      }
    }
    // 401 is the guard's alone: no app token, whatever the participant token.
    const noAppToken = await f.send(method, `/api/collab${urlPath}`, {
      [participantHeader]: g.ada.token,
    }, body);
    assert.equal(noAppToken.status, 401, name);
    assert.equal(noAppToken.body.includes("Parser"), false, `${name} 401 leaked title`);
    assertNoTaskOrPathLeak(noAppToken, `${name} noAppToken`);
  }

  // `/tasks` auth & revocation edges: untrusted Bearer or unpaired device -> 401;
  // paired member device without X-Bell-Participant, malformed token, or removed member -> 403 notJoined.
  const deskE = await f.device("Desk E");
  const eve = await f.join(deskE, await f.invite(who.admin, { name: "Eve" }));
  const unpaired = await f.post(`/people/${eve.id}/remove`, who.admin, { unpair: true });
  assert.deepEqual([unpaired.status, unpaired.json.unpaired], [200, true]);
  for (const [label, badAuth] of [
    ["missing Authorization", {}],
    ["untrusted Bearer with valid participant", { authorization: "Bearer untrusted-token", [participantHeader]: g.ada.token }],
    ["unpaired device with removed participant", { ...deskE, [participantHeader]: eve.token }],
    ["unpaired device with active participant", { ...deskE, [participantHeader]: g.ben.token }],
  ] as [string, Headers][]) {
    const reply = await f.send("GET", `/api/collab${at}/tasks`, badAuth);
    assert.equal(reply.status, 401, label);
    assert.equal(reply.body.includes("Parser"), false, `${label}: leaked title`);
    assertNoTaskOrPathLeak(reply, label);
  }
  for (const [label, unjoinedHeaders] of [
    ["paired member device without X-Bell-Participant", g.devices.ben],
    ["empty X-Bell-Participant", { ...g.devices.ben, [participantHeader]: "" }],
    ["malformed X-Bell-Participant", { ...g.devices.ben, [participantHeader]: "not-a-bpc-token" }],
    ["removed Eve token on paired device", { ...who.device, [participantHeader]: eve.token }],
  ] as [string, Headers][]) {
    const reply = await f.send("GET", `/api/collab${at}/tasks`, unjoinedHeaders);
    assert.equal(outcome(reply), "403 notJoined", label);
    assert.deepEqual(fieldsOf(reply), ["error", "reason"]);
    assert.equal(reply.body.includes("Parser"), false, `${label}: leaked title`);
    assertNoTaskOrPathLeak(reply, label);
  }

  // No repository of the group, or the name of something every object has.
  for (const id of ["p-0000000000", "__proto__", "constructor", "toString"]) {
    const base = `/projects/${id}`;
    const replies = [
      await f.send("GET", `/api/collab${base}/tasks`, who.member),
      await f.send("GET", `/api/collab${base}/feed`, who.member),
      await f.post(`${base}/check`, who.member, { scopes: ["src"] }),
      await f.post(`${base}/work`, who.member, { title: "Parser", scopes: ["lib"] }),
      await f.post(`${base}/holds/no-such-hold/release`, who.member, { fence: 1 }),
      await f.post(`${base}/holds/no-such-hold/revoke`, who.admin, {}),
    ];
    for (const reply of replies) {
      assert.equal(outcome(reply), "404 unknownProject", id);
      assertNoTaskOrPathLeak(reply, `404 ${id}`);
    }
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
    () => f.send("GET", `/api/collab/projects/${project}/tasks`, who.member),
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

test("group work that stops while BELL PR runs answers a request that waits, once a request finds out", async (t) => {
  const g = await group(t);
  const { f, who } = g;
  const project = await g.add("widgets");
  const waiting = await g.park(who.dee, project);
  // The coordinator breaks. Nothing changes a board; the next request of anyone finds out.
  t.mock.method(Coordinator.prototype, "authenticate", () => {
    throw new AppError("Broken", 503, { details: { reason: "damaged" } });
  });
  const started = Date.now();
  assert.deepEqual((await f.info(who.install)).json, {
    state: "stopped",
    reason: "damaged",
    groupId: g.groupId,
    host: true,
  });
  const ended = await waiting.reply;
  // Well before the 25 seconds the request was willing to wait.
  assert.ok(Date.now() - started < 10_000);
  assert.deepEqual([ended.status, ended.body, ended.headers.connection], [204, "", "close"]);
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
    { title: "Run", scopes: ["lib"], runId: "run-1" },
    { taskId: "t-0000000000", scopes: ["lib"] },
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

test("a path through a committed symbolic link or into a submodule cannot be held", async (t) => {
  const g = await group(t);
  const { f, who } = g;
  const repo = await g.repository("links");
  await mkdir(path.join(repo.path, "src", "api"), { recursive: true });
  await writeFile(path.join(repo.path, "src", "api", "users.ts"), "export {};\n");
  await symlink("src/api", path.join(repo.path, "alias"));
  await symlink("README.md", path.join(repo.path, "readme"));
  await git(repo.path, ["add", "-A"]);
  // A submodule as Git records it: one entry, whatever is inside it.
  await git(repo.path, ["update-index", "--add", "--cacheinfo", `160000,${"1".repeat(40)},vendor/lib`]);
  await git(repo.path, ["commit", "-q", "-m", "links"]);
  // Only the default branch counts: on another one, `docs` is a link too.
  await git(repo.path, ["checkout", "-q", "-b", "linked"]);
  await symlink("src", path.join(repo.path, "docs"));
  await git(repo.path, ["add", "docs"]);
  await git(repo.path, ["commit", "-q", "-m", "docs link"]);
  await git(repo.path, ["checkout", "-q", "main"]);
  const added = await f.post("/projects", who.admin, { repoId: repo.id });
  assert.equal(added.status, 201, added.body);
  const project = added.json.project.id as string;

  // In another case too: on a disk that does not tell case apart, ALIAS opens the link.
  const asked = [
    "./alias/users.ts",
    "alias/",
    "readme",
    "vendor/lib/x.ts",
    "ALIAS/users.ts",
    "Readme",
    "VENDOR/Lib/x.ts",
    "src/api/users.ts",
    "SRC/Api/users.ts",
  ];
  const linked = asked.slice(0, -2);
  const checked = await g.check(who.member, project, asked);
  assert.equal(checked.status, 200, checked.body);
  assert.deepEqual([checked.json.invalid, checked.json.meets], [linked, []]);
  const refused = await g.work(who.member, project, { title: "Users", scopes: asked });
  assert.equal(outcome(refused), "400 invalidScope");
  assert.deepEqual(refused.json.invalid, linked);
  // The real path, the submodule as a whole and a path that is a link on another branch.
  const held = await g.hold(who.member, project, {
    title: "Users",
    scopes: ["src/api/users.ts", "vendor/lib", "docs/guide.md"],
  });
  assert.deepEqual(held.scopes, ["src/api/users.ts", "vendor/lib", "docs/guide.md"]);

  // Unread when BELL PR's clone has no default branch: held as before.
  await git(repo.path, ["checkout", "-q", "linked"]);
  await git(repo.path, ["branch", "-q", "-D", "main"]);
  const unread = await g.hold(who.dee, project, { title: "Alias", scopes: ["alias/users.ts"] });
  assert.deepEqual(unread.scopes, ["alias/users.ts"]);
});
