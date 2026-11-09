/**
 * Coordination across processes: a host process (test/coordination-host.ts)
 * owns a data directory's coordinator, and separate client processes
 * (test/coordination-client.ts) race against it over HTTP. Every process
 * these tests start or kill is their own child, on a temporary directory
 * and repository.
 */
import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readlinkSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import { after, test } from "node:test";
import { makeRepo, type TestRepo, type UpdateRefBarrier, updateRefBarrier } from "../test/coordination-fixtures.js";
import { dataPaths, resolveConfig } from "./config.js";
import type { ClaimView, ProjectView, TaskView } from "./coordination.js";
import { sm } from "./i18n/index.js";
import { acquireWriterLock, type LockInfo, startServer, StartupError } from "./index.js";
import { pathsMeet } from "./scope-paths.js";

const repoRoot = path.resolve(import.meta.dirname, "..");
const children = new Set<ChildProcess>();
const roots: string[] = [];
const barriers: UpdateRefBarrier[] = [];
after(async () => {
  for (const barrier of barriers) barrier.close();
  for (const child of children) child.kill("SIGKILL");
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

/** A child node process running `entry`, read line by line; `wrap` is the command it runs under. */
class Child {
  readonly process: ChildProcess;
  readonly exited: Promise<number | string | null>;
  stderr = "";
  #lines: string[] = [];
  #waiting: ((line: string | undefined) => void)[] = [];
  #done = false;

  constructor(
    entry: string,
    args: string[],
    env: Record<string, string> = {},
    preload: string[] = [],
    wrap: string[] = [],
  ) {
    const imports = [...preload, "tsx"].flatMap((module) => ["--import", module]);
    const [command, ...prefix] = [...wrap, process.execPath];
    this.process = spawn(command, [...prefix, ...imports, entry, ...args], {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    children.add(this.process);
    createInterface({ input: this.process.stdout! }).on("line", (line) => {
      const waiter = this.#waiting.shift();
      if (waiter) waiter(line);
      else this.#lines.push(line);
    });
    this.process.stderr!.on("data", (chunk: Buffer) => {
      if (this.stderr.length < 20_000) this.stderr += chunk;
    });
    this.exited = new Promise((resolve) =>
      this.process.on("exit", (code, signal) => {
        children.delete(this.process);
        this.#done = true;
        for (const waiter of this.#waiting.splice(0)) waiter(undefined);
        resolve(code ?? signal);
      }),
    );
  }

  /** The next line it prints; fails if it exits first. */
  async line(): Promise<string> {
    const line =
      this.#lines.shift() ??
      (this.#done ? undefined : await new Promise<string | undefined>((resolve) => this.#waiting.push(resolve)));
    if (line === undefined) assert.fail(`child exited without a line:\n${this.stderr}`);
    return line;
  }
}

/** A reply body: a view, or a refusal's reason and message. */
interface Body {
  task?: TaskView;
  claim?: ClaimView;
  project?: ProjectView;
  reason?: string;
  current?: string;
  error?: string;
}
type Answer = { status: number; body: Body };
type Reply = Answer | { error: string };
const answered = (reply: Reply): reply is Answer => "status" in reply;
interface Request {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
}
interface Plan {
  token: string;
  requests: Request[];
  parallel?: boolean;
}

interface Hosted {
  root: string;
  dataDir: string;
  repo: TestRepo;
  /** A second project's repository, when asked for. */
  lib?: TestRepo;
  tokens: Record<"alice" | "bob" | "admin", string>;
  host: Child;
  port: number;
  /**
   * Starts a host on the data directory (it sets coordination up the
   * first time), with what it printed first: { port } or { error, reason }.
   * `preload` modules run in it first; `wrap` is the command it runs under.
   */
  start(
    env?: Record<string, string>,
    preload?: string[],
    wrap?: string[],
  ): Promise<Child & { first: { port?: number; error?: string; reason?: string } }>;
  /** Kills the host and waits until its process is gone. */
  kill(): Promise<void>;
  /** Client processes that start together on "go"; one reply list per plan. */
  race(plans: Plan[]): Promise<Reply[][]>;
  /** One request as admin, from this process, to the host on `port` (the latest by default). */
  ask(request: Request, token?: string, port?: number): Promise<Answer>;
  revision(): Promise<number>;
}

async function hosted(env: Record<string, string> = {}, more: { lib?: boolean } = {}): Promise<Hosted> {
  const root = await mkdtemp(path.join(os.tmpdir(), "bellpr-coordination-race-"));
  roots.push(root);
  const dataDir = path.join(root, "data");
  const repo = await makeRepo(root);
  let lib: TestRepo | undefined;
  if (more.lib) {
    await mkdir(path.join(root, "lib"));
    lib = await makeRepo(path.join(root, "lib"));
  }
  const setupFile = path.join(root, "setup.json");
  const tokensFile = path.join(root, "tokens.json");
  await writeFile(
    setupFile,
    JSON.stringify({
      participants: [
        { id: "alice", role: "member" },
        { id: "bob", role: "member" },
        { id: "admin", role: "admin" },
      ],
      projects: [
        { id: "app", repository: repo.bare, branch: "integration" },
        ...(lib ? [{ id: "lib", repository: lib.bare, branch: "integration" }] : []),
      ],
      tokens: tokensFile,
    }),
  );
  await mkdir(dataDir);
  const world = {
    root,
    dataDir,
    repo,
    lib,
    async start(more: Record<string, string> = {}, preload: string[] = [], wrap: string[] = []) {
      const host = new Child("test/coordination-host.ts", [dataDir, setupFile], more, preload, wrap);
      const first = JSON.parse(await host.line());
      if (first.port) {
        world.host = host;
        world.port = first.port;
      }
      return Object.assign(host, { first });
    },
    async kill() {
      world.host.process.kill("SIGKILL");
      await world.host.exited;
    },
    async race(plans: Plan[]) {
      const clients = plans.map(
        (plan) =>
          new Child("test/coordination-client.ts", [JSON.stringify({ port: world.port, ...plan })]),
      );
      for (const client of clients) assert.equal(await client.line(), "ready");
      for (const client of clients) client.process.stdin!.write("go\n");
      return await Promise.all(clients.map(async (client) => JSON.parse(await client.line()) as Reply[]));
    },
    async ask(request: Request, token = world.tokens.admin, port = world.port) {
      const response = await fetch(`http://127.0.0.1:${port}/api/coordination${request.path}`, {
        method: request.method,
        headers: { "content-type": "application/json", "x-bell-participant": token },
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
      });
      return { status: response.status, body: (await response.json()) as Body };
    },
    async revision() {
      return JSON.parse(await readFile(dataPaths(dataDir).coordination, "utf8")).revision as number;
    },
  } as Hosted;
  const host = await world.start(env);
  assert.ok(world.port, `host did not start:\n${host.stderr}`);
  world.tokens = JSON.parse(await readFile(tokensFile, "utf8"));
  return world;
}

const postIn = (project: string, path: string, body: unknown): Request => ({
  method: "POST",
  path: `/projects/${project}${path}`,
  body,
});
const post = (path: string, body: unknown): Request => postIn("app", path, body);
const project = async (world: Hosted) =>
  (await world.ask({ method: "GET", path: "/projects/app" })).body.project!;
const heldClaims = async (world: Hosted) =>
  (await project(world)).claims.filter((claim) => claim.status === "held");

async function defineTasks(world: Hosted, ids: string[]) {
  for (const id of ids) assert.equal((await world.ask(post("/tasks", { id }))).status, 201);
}

/**
 * Preloaded into a host, it gives that process another host name, so its
 * locks read as written in another PID namespace (a container elsewhere):
 * a simulation. The tests at the end make a real namespace where they can.
 */
const elsewhere = `data:text/javascript,${encodeURIComponent('import os from "node:os"; os.hostname = () => "elsewhere";')}`;

const lockFile = (world: Hosted) => dataPaths(world.dataDir).lock;
/** What the data directory holds besides its lock: claims and temp files a start left. */
const lockLitter = async (world: Hosted) =>
  (await readdir(world.dataDir)).filter((name) => name.startsWith(`${path.basename(lockFile(world))}.`));

async function freePort() {
  const probe = createServer().listen(0, "127.0.0.1");
  await new Promise((resolve) => probe.once("listening", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/** An ordinary BELL PR start on the data directory, from this process, on 127.0.0.1 only. */
async function startHere(dataDir: string) {
  const env = { ...process.env, BELLPR_LOCALE: "en", BELLPR_NO_OPEN: "1", BELLPR_DATA_DIR: "" };
  return await startServer({
    config: resolveConfig({ host: "127.0.0.1", port: String(await freePort()), dataDir }, env),
    handleExit: false,
    print: () => {},
    warn: () => {},
  });
}

/** A start refused at once, without waiting out a lease (30 s); the refusal. */
async function refused(start: Promise<{ shutdown?: () => Promise<void>; release?: () => void }>) {
  const begun = Date.now();
  const outcome = await start.then(
    async (started) => {
      await started.shutdown?.();
      started.release?.();
      return "started";
    },
    (error: unknown) => error,
  );
  assert.ok(outcome instanceof StartupError, String(outcome));
  assert.ok(Date.now() - begun < 10_000, `refused after ${Date.now() - begun} ms`);
  return outcome;
}

/** The refusal of a start that cannot show the lock's holder stopped. */
const unconfirmed = (world: Hosted) =>
  sm().cli.start.dataDirHolderUnconfirmed({ dataDir: world.dataDir, file: lockFile(world) });

/** A host started on the data directory, which must be refused with `message`. */
async function hostRefused(world: Hosted, message: string, wrap: string[] = []) {
  const contender = await world.start({}, [], wrap);
  // One that took the directory over is stopped, so the test fails at once.
  if (contender.first.port) contender.process.kill("SIGKILL");
  assert.deepEqual([contender.first.error, await contender.exited], [message, 1], contender.stderr);
}

function assertDisjoint(claims: { scopes: string[] }[]) {
  for (const [index, claim] of claims.entries())
    for (const other of claims.slice(index + 1))
      assert.equal(
        claim.scopes.some((a) => other.scopes.some((b) => pathsMeet(a, b))),
        false,
        `${claim.scopes} meets ${other.scopes}`,
      );
}

test(
  "two client processes claiming the same files at once: one gets each, and a body cannot name its holder",
  { timeout: 120_000 },
  async () => {
    const world = await hosted();
    const areas = 15;
    await defineTasks(world, [...Array(areas)].flatMap((_, i) => [`a${i}`, `b${i}`]));
    const [alice, bob, intruder] = await world.race([
      {
        token: world.tokens.alice,
        parallel: true,
        requests: [...Array(areas)].map((_, i) => post("/claims", { taskId: `a${i}`, scopes: [`area${i}`] })),
      },
      {
        token: world.tokens.bob,
        parallel: true,
        requests: [
          ...[...Array(areas)].map((_, i) => post("/claims", { taskId: `b${i}`, scopes: [`AREA${i}/x.ts`] })),
          post("/claims", { taskId: "b0", scopes: ["elsewhere"], holder: "alice" }),
        ],
      },
      { token: "", requests: [post("/claims", { taskId: "b1", scopes: ["other"] })] },
    ]);
    for (let i = 0; i < areas; i += 1) {
      const pair = [alice[i], bob[i]] as Answer[];
      assert.deepEqual(
        pair.map((reply) => reply.status).sort(),
        [201, 409],
        `area ${i}: ${JSON.stringify(pair)}`,
      );
      assert.equal(pair.find((reply) => reply.status === 409)!.body.reason, "conflict");
    }
    const forged = bob[areas] as Answer;
    assert.deepEqual([forged.status, forged.body.reason], [400, "invalidRequest"]);
    const anonymous = intruder[0] as Answer;
    assert.deepEqual([anonymous.status, anonymous.body.reason], [401, "unauthenticated"]);
    const granted = [...alice, ...bob]
      .filter((reply) => answered(reply) && reply.status === 201)
      .map((reply) => (reply as Answer).body.claim!);
    const held = await heldClaims(world);
    assert.deepEqual(
      held.map((claim) => claim.id).sort(),
      granted.map((claim) => claim.id).sort(),
    );
    assertDisjoint(held);
    // A restart restores every claim as it was.
    await world.kill();
    await world.start();
    assert.deepEqual(await heldClaims(world), held);
  },
);

test(
  "only an admin reopens a failed task over HTTP; clients racing for it then get one claim each, and a restart keeps it all",
  { timeout: 120_000 },
  async () => {
    const world = await hosted();
    const rounds = 8;
    await defineTasks(world, [...Array(rounds)].flatMap((_, i) => [`r${i}`, `s${i}`]));
    const old: ClaimView[] = [];
    for (let i = 0; i < rounds; i += 1) {
      const claimed = await world.ask(post("/claims", { taskId: `r${i}`, scopes: [`src/${i}`] }), world.tokens.alice);
      assert.equal(claimed.status, 201);
      old.push(claimed.body.claim!);
      const failed = await world.ask(post(`/tasks/r${i}/fail`, { reason: "broken build" }), world.tokens.alice);
      assert.equal(failed.status, 200);
    }
    const before = await project(world);
    const revision = await world.revision();
    const refusals: [string, string, unknown, number, string][] = [
      // The task's creator and holder, another member, no one, and a token nobody was given.
      ["r0", world.tokens.alice, {}, 403, "adminOnly"],
      ["r0", world.tokens.bob, {}, 403, "adminOnly"],
      ["r0", "", {}, 401, "unauthenticated"],
      ["r0", `bpc_${"A".repeat(43)}`, {}, 401, "unauthenticated"],
      // A body never says who is asking, and a reason has a limit.
      ["r0", world.tokens.admin, { by: "alice" }, 400, "invalidRequest"],
      ["r0", world.tokens.admin, { actor: "admin", reason: "retry" }, 400, "invalidRequest"],
      ["r0", world.tokens.admin, { owner: "admin" }, 400, "invalidRequest"],
      ["r0", world.tokens.admin, { reason: "x".repeat(501) }, 400, "invalidRequest"],
      // A task that has not failed, or does not exist.
      ["s0", world.tokens.admin, {}, 409, "notFailed"],
      ["nope", world.tokens.admin, {}, 404, "unknownTask"],
    ];
    for (const [task, token, body, status, reason] of refusals) {
      const reply = await world.ask(post(`/tasks/${task}/reopen`, body), token);
      assert.deepEqual([reply.status, reply.body.reason], [status, reason], JSON.stringify(body));
    }
    assert.deepEqual(await project(world), before);
    assert.equal(await world.revision(), revision);

    // Two clients reopen each task at once: exactly one reopening is kept.
    const reopen = [...Array(rounds)].map((_, i) => post(`/tasks/r${i}/reopen`, { reason: "retry" }));
    const [first, second] = await world.race([
      { token: world.tokens.admin, parallel: true, requests: reopen },
      { token: world.tokens.admin, parallel: true, requests: reopen },
    ]);
    for (let i = 0; i < rounds; i += 1) {
      const pair = [first[i], second[i]] as Answer[];
      assert.deepEqual(pair.map((reply) => reply.status).sort(), [200, 409], JSON.stringify(pair));
      assert.equal(pair.find((reply) => reply.status === 409)!.body.reason, "notFailed");
    }

    // Two clients claim each reopened task at once, and other tasks on other files alongside.
    const half = rounds / 2;
    const [alice, bob] = await world.race([
      {
        token: world.tokens.alice,
        parallel: true,
        requests: [
          ...[...Array(rounds)].map((_, i) => post("/claims", { taskId: `r${i}`, scopes: [`src/${i}`] })),
          ...[...Array(half)].map((_, i) => post("/claims", { taskId: `s${i}`, scopes: [`docs/${i}`] })),
        ],
      },
      {
        token: world.tokens.bob,
        parallel: true,
        requests: [
          ...[...Array(rounds)].map((_, i) => post("/claims", { taskId: `r${i}`, scopes: [`lib/${i}`] })),
          ...[...Array(half)].map((_, i) => post("/claims", { taskId: `s${i + half}`, scopes: [`docs/${i + half}`] })),
        ],
      },
    ]);
    for (let i = 0; i < rounds; i += 1) {
      const pair = [alice[i], bob[i]] as Answer[];
      assert.deepEqual(pair.map((reply) => reply.status).sort(), [201, 409], `task r${i}: ${JSON.stringify(pair)}`);
      assert.equal(pair.find((reply) => reply.status === 409)!.body.reason, "taskClaimed");
      assert.ok(pair.find((reply) => reply.status === 201)!.body.claim!.fence > old[i].fence);
    }
    for (const reply of [...alice.slice(rounds), ...bob.slice(rounds)])
      assert.equal((reply as Answer).status, 201, JSON.stringify(reply));
    const held = await heldClaims(world);
    assert.equal(held.length, rounds * 2);
    assertDisjoint(held);

    // The old fences authorise nothing, before a restart and after it.
    const ended = async () => {
      for (const claim of old) {
        const reply = await world.ask(
          post(`/claims/${claim.id}/authorize`, { fence: claim.fence, paths: [`src/${claim.taskId.slice(1)}/a.ts`] }),
          world.tokens.alice,
        );
        assert.deepEqual([reply.status, reply.body.reason], [409, "ended"]);
      }
    };
    await ended();
    const after = await project(world);
    await world.kill();
    await world.start();
    assert.deepEqual(await project(world), after);
    await ended();
    for (let i = 0; i < rounds; i += 1) {
      const task = after.tasks.find((candidate) => candidate.id === `r${i}`)!;
      assert.deepEqual(
        [task.status, task.createdBy, task.reopenings?.map(({ by, reason }) => [by, reason])],
        ["open", "admin", [["admin", "retry"]]],
      );
      const claim = after.claims.find((candidate) => candidate.id === old[i].id)!;
      assert.deepEqual([claim.status, claim.endedBy, claim.reason, claim.fence], ["released", "alice", "broken build", old[i].fence]);
    }
  },
);

test(
  "a host killed while claims are in flight never grants a file twice after it restarts",
  { timeout: 120_000 },
  async () => {
    const world = await hosted({ BELLPR_TEST_COORDINATION_WRITE_DELAY_MS: "25" });
    const areas = 30;
    await defineTasks(world, [...Array(areas)].flatMap((_, i) => [`a${i}`, `b${i}`]));
    const start = await world.revision();
    const racing = world.race([
      {
        token: world.tokens.alice,
        parallel: true,
        requests: [...Array(areas)].map((_, i) => post("/claims", { taskId: `a${i}`, scopes: [`area${i}/src`] })),
      },
      {
        token: world.tokens.bob,
        parallel: true,
        requests: [...Array(areas)].map((_, i) => post("/claims", { taskId: `b${i}`, scopes: [`Area${i}`] })),
      },
    ]);
    // Kill it after a few grants, with most requests still waiting.
    const deadline = Date.now() + 30_000;
    while ((await world.revision()) < start + 6) {
      assert.ok(Date.now() < deadline, "no claim was granted");
      await sleep(5);
    }
    await world.kill();
    const [alice, bob] = await racing;
    const replies = [...alice, ...bob];
    const granted = replies
      .filter(answered)
      .filter((reply) => reply.status === 201)
      .map((reply) => reply.body.claim!);
    assert.ok(granted.length >= 1, JSON.stringify(replies));
    assert.ok(replies.some((reply) => "error" in reply), "the kill cut some requests off");
    const restarted = await world.start();
    assert.ok(restarted.first.port, restarted.stderr);
    const held = await heldClaims(world);
    // Every grant a client saw survived, and nothing on disk overlaps.
    for (const claim of granted)
      assert.ok(
        held.some((candidate) => candidate.id === claim.id && candidate.holder === claim.holder),
        `grant ${claim.id} was lost`,
      );
    assertDisjoint(held);
    // An area someone holds stays theirs: the other side is still refused.
    const taken = held[0];
    const area = /^area(\d+)/i.exec(taken.scopes[0])![1];
    const other: "alice" | "bob" = taken.holder === "alice" ? "bob" : "alice";
    const retry = await world.ask(
      post("/claims", { taskId: `${other === "alice" ? "a" : "b"}${area}`, scopes: [`area${area}`] }),
      world.tokens[other],
    );
    assert.deepEqual([retry.status, retry.body.reason], [409, "conflict"], JSON.stringify(retry.body));
  },
);

test("a second host on the same data directory does not start", { timeout: 120_000 }, async () => {
  const world = await hosted();
  const first = world.host;
  const second = await world.start();
  assert.deepEqual([second.first.reason, await second.exited], ["StartupError", 1]);
  assert.equal(world.host, first);
  assert.equal((await world.ask({ method: "GET", path: "/projects/app" })).status, 200);
});

for (const step of ["intent-saved", "ref-updated"] as const)
  test(`a host killed at ${step} during an integration settles it on restart`, { timeout: 120_000 }, async () => {
    const world = await hosted({ BELLPR_TEST_COORDINATION_CRASH: step });
    await defineTasks(world, ["one"]);
    const claimed = await world.ask(post("/claims", { taskId: "one", scopes: ["src"] }), world.tokens.alice);
    const claim = claimed.body.claim!;
    const change = await world.repo.commit(world.repo.base, { "src/a.ts": "changed\n" });
    const integrate = post(`/claims/${claim.id}/integrate`, {
      fence: claim.fence,
      base: world.repo.base,
      commit: change,
    });
    const [[cut]] = await world.race([{ token: world.tokens.alice, requests: [integrate] }]);
    assert.ok("error" in cut, JSON.stringify(cut));
    assert.equal(await world.host.exited, "SIGKILL");
    const restarted = await world.start();
    assert.ok(restarted.first.port && world.host === restarted, restarted.stderr);
    const after = await project(world);
    if (step === "intent-saved") {
      assert.equal(await world.repo.head(), world.repo.base);
      assert.deepEqual([after.branch.sha, after.claims[0].status, after.tasks[0].status], [world.repo.base, "held", "open"]);
      const again = await world.ask(integrate, world.tokens.alice);
      assert.equal(again.status, 200, JSON.stringify(again.body));
      assert.equal(await world.repo.head(), change);
    } else {
      assert.equal(await world.repo.head(), change);
      assert.deepEqual(
        [after.branch.sha, after.claims[0].status, after.tasks[0].status, after.tasks[0].integratedSha],
        [change, "integrated", "integrated", change],
      );
    }
    const onDisk = JSON.parse(await readFile(dataPaths(world.dataDir).coordination, "utf8"));
    assert.equal(onDisk.projects[0].pending, undefined);
  });

test(
  "an integration a crash cut off and the branch cannot settle closes only its project until an admin settles it",
  { timeout: 180_000 },
  async () => {
    const world = await hosted({ BELLPR_TEST_COORDINATION_CRASH: "intent-saved" }, { lib: true });
    const lib = world.lib!;
    const { alice, bob, admin } = world.tokens;
    await defineTasks(world, ["one", "two", "spare"]);
    assert.equal((await world.ask(post("/tasks", { id: "after", dependsOn: ["one"] }))).status, 201);
    for (const id of ["l1", "l2"]) assert.equal((await world.ask(postIn("lib", "/tasks", { id }))).status, 201);
    const mine = (await world.ask(post("/claims", { taskId: "one", scopes: ["src"] }), alice)).body.claim!;
    const theirs = (await world.ask(post("/claims", { taskId: "two", scopes: ["lib"] }), bob)).body.claim!;
    const libClaim = (await world.ask(postIn("lib", "/claims", { taskId: "l1", scopes: ["src"] }), alice)).body.claim!;
    const change = await world.repo.commit(world.repo.base, { "src/a.ts": "changed\n" });
    const elsewhere = await world.repo.commit(world.repo.base, { "README.md": "pushed by hand\n" });
    const libChange = await lib.commit(lib.base, { "src/a.ts": "lib\n" });
    const integrate = post(`/claims/${mine.id}/integrate`, { fence: mine.fence, base: world.repo.base, commit: change });
    const [[cut]] = await world.race([{ token: alice, requests: [integrate] }]);
    assert.ok("error" in cut, JSON.stringify(cut));
    assert.equal(await world.host.exited, "SIGKILL");
    // Before coordination is back, someone pushes around it.
    await world.repo.move(elsewhere);
    const restarted = await world.start();
    assert.ok(restarted.first.port && world.host === restarted, restarted.stderr);

    // Any participant reads why app is closed.
    const read = await world.ask({ method: "GET", path: "/projects/app" }, bob);
    const pending = read.body.project!.undecided!;
    assert.deepEqual(
      { ...pending, startedAt: "" },
      { claimId: mine.id, fence: mine.fence, from: world.repo.base, to: change, startedAt: "" },
    );
    const file = () => readFile(dataPaths(world.dataDir).coordination, "utf8");
    const now = async () => ({ file: await file(), heads: [await world.repo.head(), await lib.head()] });
    const before = await now();
    assert.deepEqual(before.heads, [elsewhere, lib.base]);

    const changes: [string, Request, string][] = [
      ["define a task", post("/tasks", { id: "new" }), admin],
      ["claim", post("/claims", { taskId: "spare", scopes: ["docs"] }), bob],
      ["expand", post(`/claims/${mine.id}/expand`, { fence: mine.fence, scopes: ["docs"] }), alice],
      ["release", post(`/claims/${theirs.id}/release`, { fence: theirs.fence }), bob],
      ["revoke", post(`/claims/${mine.id}/revoke`, { reason: "stuck" }), admin],
      ["fail", post("/tasks/one/fail", {}), alice],
      ["reopen", post("/tasks/two/reopen", {}), admin],
      ["authorize", post(`/claims/${mine.id}/authorize`, { fence: mine.fence, paths: ["src/a.ts"] }), alice],
      ["integrate", integrate, alice],
      ["adopt", post("/baseline/adopt", { sha: elsewhere }), admin],
    ];
    for (const [name, request, token] of changes) {
      const reply = await world.ask(request, token);
      assert.deepEqual([reply.status, reply.body.reason], [409, "recoveryUndecided"], name);
    }
    const settle = (head: string, more: object = {}) => post("/recovery/settle", { ...pending, head, ...more });
    const refusals: [string, Request, string, number, string][] = [
      ["a member", settle(elsewhere), alice, 403, "adminOnly"],
      ["no participant", settle(elsewhere), "", 401, "unauthenticated"],
      ["an owner named in the body", settle(elsewhere, { owner: "admin" }), admin, 400, "invalidRequest"],
      ["who settled named in the body", settle(elsewhere, { by: "alice" }), admin, 400, "invalidRequest"],
      ["a stale intent", settle(elsewhere, { startedAt: new Date(0).toISOString() }), admin, 409, "stalePending"],
      ["a branch at a third commit", settle(elsewhere), admin, 409, "branchElsewhere"],
      ["the change it is not at", settle(change), admin, 409, "branchElsewhere"],
    ];
    for (const [name, request, token, status, reason] of refusals) {
      const reply = await world.ask(request, token);
      assert.deepEqual([reply.status, reply.body.reason], [status, reason], `${name}: ${JSON.stringify(reply.body)}`);
      if (reason === "branchElsewhere") assert.equal(reply.body.current, elsewhere);
    }
    assert.deepEqual(await now(), before);

    // Lib authorizes and integrates as before.
    const authorized = await world.ask(
      postIn("lib", `/claims/${libClaim.id}/authorize`, { fence: libClaim.fence, paths: ["src/a.ts"] }),
      alice,
    );
    assert.equal(authorized.status, 200, JSON.stringify(authorized.body));
    const libIntegrated = await world.ask(
      postIn("lib", `/claims/${libClaim.id}/integrate`, { fence: libClaim.fence, base: lib.base, commit: libChange }),
      alice,
    );
    assert.equal(libIntegrated.status, 200, JSON.stringify(libIntegrated.body));
    assert.deepEqual([await world.repo.head(), await lib.head()], [elsewhere, libChange]);

    // A host killed and started again finds app as closed as it was.
    const closed = await project(world);
    await world.kill();
    assert.ok((await world.start()).first.port);
    assert.deepEqual(await project(world), closed);
    assert.equal((await world.ask(changes[1][1], bob)).body.reason, "recoveryUndecided");

    // The branch, repaired by hand, is back at the base. Two admins settle while others change both projects.
    await world.repo.move(world.repo.base);
    const [[first], [second], [libClaimed], [appClaimed]] = await world.race([
      { token: admin, requests: [settle(world.repo.base)] },
      { token: admin, requests: [settle(world.repo.base)] },
      { token: bob, requests: [postIn("lib", "/claims", { taskId: "l2", scopes: ["lib"] })] },
      { token: bob, requests: [post("/claims", { taskId: "spare", scopes: ["docs"] })] },
    ]);
    const settles = [first, second] as Answer[];
    assert.deepEqual(
      settles.map((reply) => [reply.status, reply.body.reason ?? ""]).sort(),
      [[200, ""], [409, "nothingToSettle"]],
      JSON.stringify(settles),
    );
    assert.equal((libClaimed as Answer).status, 201, JSON.stringify(libClaimed));
    const app = appClaimed as Answer;
    assert.ok(app.status === 201 || app.body.reason === "recoveryUndecided", JSON.stringify(app));
    const settled = await project(world);
    assert.equal(settled.undecided, undefined);
    assert.deepEqual(
      settled.recoveries?.map(({ at, ...record }) => ({ ...record, at: Date.parse(at) >= Date.parse(pending.startedAt) })),
      [{ ...pending, by: "admin", outcome: "notIntegrated", at: true }],
    );
    // The claim is held under its fence, and the change integrates again; then its dependant starts.
    assert.deepEqual(settled.claims.find((claim) => claim.id === mine.id), mine);
    assert.deepEqual(settled.claims.find((claim) => claim.id === theirs.id), theirs);
    const again = await world.ask(integrate, alice);
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(await world.repo.head(), change);
    assert.equal((await world.ask(post("/claims", { taskId: "after", scopes: ["src"] }), bob)).status, 201);

    const kept = (await project(world)).recoveries;
    await world.kill();
    assert.ok((await world.start()).first.port);
    assert.deepEqual((await project(world)).recoveries, kept);
    const onDisk = JSON.parse(await file());
    assert.deepEqual([onDisk.projects[0].pending, onDisk.projects[0].recoveries.length], [undefined, 1]);
  },
);

test(
  "two client processes integrating onto the same base: one moves the branch, the other is told to sync",
  { timeout: 120_000 },
  async () => {
    const world = await hosted();
    await defineTasks(world, ["one", "two"]);
    const mine = (await world.ask(post("/claims", { taskId: "one", scopes: ["src"] }), world.tokens.alice)).body.claim!;
    const theirs = (await world.ask(post("/claims", { taskId: "two", scopes: ["lib"] }), world.tokens.bob)).body.claim!;
    const a = await world.repo.commit(world.repo.base, { "src/a.ts": "alice\n" });
    const b = await world.repo.commit(world.repo.base, { "lib/c.ts": "bob\n" });
    const [[alice], [bob]] = await world.race([
      {
        token: world.tokens.alice,
        requests: [post(`/claims/${mine.id}/integrate`, { fence: mine.fence, base: world.repo.base, commit: a })],
      },
      {
        token: world.tokens.bob,
        requests: [post(`/claims/${theirs.id}/integrate`, { fence: theirs.fence, base: world.repo.base, commit: b })],
      },
    ]);
    const replies = [alice, bob] as Answer[];
    assert.deepEqual(replies.map((reply) => reply.status).sort(), [200, 409], JSON.stringify(replies));
    const winner = replies[0].status === 200 ? a : b;
    const loser = replies.find((reply) => reply.status === 409)!;
    assert.deepEqual([loser.body.reason, loser.body.current], ["staleBase", winner]);
    assert.equal(await world.repo.head(), winner);
    assert.equal((await project(world)).branch.sha, winner);
  },
);

test(
  "a paused host keeps its data directory however old its lock looks, then writes, and gives it up when closed",
  { timeout: 120_000 },
  async (t) => {
    const world = await hosted();
    await defineTasks(world, ["one"]);
    const paused = world.host;
    const file = lockFile(world);
    const lock = await readFile(file, "utf8");
    assert.equal(JSON.parse(lock).strict, true);
    paused.process.kill("SIGSTOP");
    try {
      // Not renewed for an hour, as when its machine slept or its clock is behind.
      const hourAgo = new Date(Date.now() - 3_600_000);
      await utimes(file, hourAgo, hourAgo);
      for (const preload of [[], [elsewhere]]) {
        const contender = await world.start({}, preload);
        // One that took the directory over is stopped, so the test fails at once.
        if (contender.first.port) contender.process.kill("SIGKILL");
        assert.deepEqual([contender.first.reason, await contender.exited], ["StartupError", 1], contender.stderr);
      }
      await refused(acquireWriterLock(world.dataDir));
      await refused(startHere(world.dataDir));
      t.mock.method(os, "hostname", () => "elsewhere");
      await refused(acquireWriterLock(world.dataDir));
      await refused(startHere(world.dataDir));
      t.mock.restoreAll();
      assert.equal(await readFile(file, "utf8"), lock);
      assert.deepEqual(await lockLitter(world), []);
    } finally {
      paused.process.kill("SIGCONT");
    }
    assert.equal(world.host, paused);
    const claimed = await world.ask(post("/claims", { taskId: "one", scopes: ["src"] }), world.tokens.alice);
    assert.equal(claimed.status, 201, JSON.stringify(claimed.body));
    const again = await world.start();
    if (again.first.port) again.process.kill("SIGKILL");
    assert.deepEqual([again.first.reason, await again.exited], ["StartupError", 1]);
    // Closed, it removes its lock, and the next host opens with the claim.
    paused.process.kill("SIGTERM");
    assert.equal(await paused.exited, 0, paused.stderr);
    await assert.rejects(readFile(file), { code: "ENOENT" });
    const next = await world.start();
    assert.ok(next.first.port, next.stderr);
    assert.deepEqual((await heldClaims(world)).map((claim) => claim.id), [claimed.body.claim!.id]);
  },
);

test(
  "a host whose lock was replaced refuses every write and leaves the other start's lock",
  { timeout: 120_000 },
  async () => {
    const world = await hosted();
    await defineTasks(world, ["one"]);
    const claim = (await world.ask(post("/claims", { taskId: "one", scopes: ["src"] }), world.tokens.alice)).body
      .claim!;
    const file = lockFile(world);
    // As after a person removed its lock and a start in another container wrote one.
    const theirs = `${JSON.stringify({ ...JSON.parse(await readFile(file, "utf8")), pidNamespace: "elsewhere pid:[1]" })}\n`;
    await writeFile(file, theirs);
    const revision = await world.revision();
    const change = await world.repo.commit(world.repo.base, { "src/a.ts": "changed\n" });
    const replies = [
      await world.ask(post("/tasks", { id: "two" })),
      await world.ask(
        post(`/claims/${claim.id}/integrate`, { fence: claim.fence, base: world.repo.base, commit: change }),
        world.tokens.alice,
      ),
    ];
    assert.deepEqual(
      replies.map((reply) => [reply.status, reply.body.reason]),
      [
        [503, "notSingleWriter"],
        [503, "notSingleWriter"],
      ],
    );
    assert.equal(await world.revision(), revision);
    assert.equal(await world.repo.head(), world.repo.base);
    world.host.process.kill("SIGTERM");
    assert.equal(await world.host.exited, 0, world.host.stderr);
    assert.equal(await readFile(file, "utf8"), theirs);
  },
);

test(
  "once a person removes a paused host's lock another host starts, and the resumed one is refused when it writes",
  { timeout: 120_000 },
  async () => {
    const world = await hosted();
    await defineTasks(world, ["one", "two"]);
    const paused = world.host;
    const pausedPort = world.port;
    paused.process.kill("SIGSTOP");
    try {
      // By hand, which only a person who knows the host has stopped should do.
      await rm(lockFile(world));
      const other = await world.start();
      assert.ok(other.first.port, other.stderr);
      const mine = await world.ask(post("/claims", { taskId: "one", scopes: ["src"] }), world.tokens.alice);
      assert.equal(mine.status, 201, JSON.stringify(mine.body));
    } finally {
      paused.process.kill("SIGCONT");
    }
    const revision = await world.revision();
    // It finds out before writing; that check is no fence against a write already under way.
    const late = await world.ask(post("/claims", { taskId: "two", scopes: ["lib"] }), world.tokens.bob, pausedPort);
    assert.deepEqual([late.status, late.body.reason], [503, "notSingleWriter"]);
    assert.equal(await world.revision(), revision);
    assert.deepEqual((await heldClaims(world)).map((claim) => claim.holder), ["alice"]);
  },
);

test("hosts racing for the lock a killed host left: exactly one starts", { timeout: 120_000 }, async () => {
  const world = await hosted();
  const file = lockFile(world);
  for (let round = 0; round < 3; round += 1) {
    await world.kill();
    const stale = await readFile(file, "utf8");
    const starts = await Promise.all([...Array(4)].map(() => world.start()));
    const started = starts.filter((start) => start.first.port);
    assert.equal(started.length, 1, starts.map((start) => JSON.stringify(start.first)).join("\n"));
    for (const start of starts.filter((each) => !each.first.port))
      assert.deepEqual([start.first.reason, await start.exited], ["StartupError", 1], start.stderr);
    const lock = await readFile(file, "utf8");
    assert.notEqual(lock, stale);
    assert.deepEqual([JSON.parse(lock).pid, JSON.parse(lock).strict], [started[0].process.pid, true]);
    assert.equal(world.host, started[0]);
    assert.deepEqual(await lockLitter(world), []);
    assert.equal((await world.ask({ method: "GET", path: "/projects/app" })).status, 200);
  }
});

/** The update-ref barrier is a shell script on FIFOs, run and checked on Linux only. */
const linuxOnly = process.platform !== "linux" && "the update-ref barrier is checked on Linux only";

/**
 * Restarts the host with `git` behind an update-ref barrier, then starts an
 * integration of a change to src that the barrier holds after
 * coordination's last lock check, before the branch moves: Git runs with
 * hooks off, so a command in front of it on PATH is the one place a test
 * can stop there.
 */
async function heldIntegration(world: Hosted) {
  await defineTasks(world, ["one"]);
  const claim = (await world.ask(post("/claims", { taskId: "one", scopes: ["src"] }), world.tokens.alice)).body
    .claim!;
  const change = await world.repo.commit(world.repo.base, { "src/a.ts": "changed\n" });
  const barrier = await updateRefBarrier(path.join(world.root, "barrier"));
  barriers.push(barrier);
  world.host.process.kill("SIGTERM");
  assert.equal(await world.host.exited, 0, world.host.stderr);
  const host = await world.start({ PATH: `${barrier.bin}${path.delimiter}${process.env.PATH}` });
  assert.ok(host.first.port, host.stderr);
  const integrate = post(`/claims/${claim.id}/integrate`, {
    fence: claim.fence,
    base: world.repo.base,
    commit: change,
  });
  await barrier.arm();
  const reply = world.ask(integrate, world.tokens.alice);
  reply.catch(() => {});
  const argv = await barrier.reached();
  assert.deepEqual(argv.slice(argv.indexOf("update-ref")), [
    "update-ref",
    "-m",
    "bell-pr: integrate one",
    "refs/heads/integration",
    change,
    world.repo.base,
  ]);
  // The intent is saved; the branch has not moved.
  const onDisk = JSON.parse(await readFile(dataPaths(world.dataDir).coordination, "utf8"));
  assert.deepEqual(
    { ...onDisk.projects[0].pending, startedAt: "" },
    { claimId: claim.id, fence: claim.fence, from: world.repo.base, to: change, startedAt: "" },
  );
  assert.equal(await world.repo.head(), world.repo.base);
  return { claim, change, integrate, reply, barrier, host };
}

const authorize = (claim: ClaimView) =>
  post(`/claims/${claim.id}/authorize`, { fence: claim.fence, paths: ["src/a.ts"] });

test(
  "an integration held between its last lock check and update-ref keeps the lock from every start, running or paused, then lands",
  { timeout: 120_000, skip: linuxOnly },
  async (t) => {
    const world = await hosted();
    const { claim, change, integrate, reply, barrier, host } = await heldIntegration(world);
    const file = lockFile(world);
    const lock = await readFile(file, "utf8");
    assert.deepEqual([JSON.parse(lock).pid, JSON.parse(lock).strict], [host.process.pid, true]);
    const inUse = sm().cli.start.dataDirInUse({ dataDir: world.dataDir, pid: host.process.pid! });
    const contend = async () => {
      await hostRefused(world, inUse);
      assert.equal((await refused(acquireWriterLock(world.dataDir))).message, inUse);
      assert.equal((await refused(startHere(world.dataDir))).message, inUse);
      assert.equal(await readFile(file, "utf8"), lock);
      assert.deepEqual(await lockLitter(world), []);
      assert.equal(await world.repo.head(), world.repo.base);
    };
    await contend();
    host.process.kill("SIGSTOP");
    try {
      // Not renewed for an hour, as when its machine slept or its clock is behind.
      const hourAgo = new Date(Date.now() - 3_600_000);
      await utimes(file, hourAgo, hourAgo);
      await contend();
    } finally {
      host.process.kill("SIGCONT");
    }
    barrier.release();
    const done = await reply;
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(await world.repo.head(), change);
    const after = await project(world);
    assert.deepEqual(
      [after.branch.sha, after.claims[0].status, after.tasks[0].status, after.tasks[0].integratedSha],
      [change, "integrated", "integrated", change],
    );
    // Closed, it gives the lock up; a restart reads the same, and the fence is spent.
    host.process.kill("SIGTERM");
    assert.equal(await host.exited, 0, host.stderr);
    await assert.rejects(readFile(file), { code: "ENOENT" });
    assert.ok((await world.start()).first.port);
    assert.deepEqual(await project(world), after);
    const onDisk = JSON.parse(await readFile(dataPaths(world.dataDir).coordination, "utf8"));
    assert.equal(onDisk.projects[0].pending, undefined);
    for (const request of [authorize(claim), integrate]) {
      const spent = await world.ask(request, world.tokens.alice);
      assert.deepEqual([spent.status, spent.body.reason], [409, "ended"], request.path);
    }
    t.diagnostic(
      JSON.stringify({
        held: "update-ref after the last lock check",
        contenders: "a strict host, acquireWriterLock, an ordinary start: refused, running and paused with the lock an hour old",
        integrate: done.status,
        head: "change",
        restart: "integrated, pending cleared, fence ended",
      }),
    );
  },
);

test(
  "outside the rule: a lock removed by hand while an integration is held lets its update-ref land under a second host's records",
  { timeout: 120_000, skip: linuxOnly },
  async (t) => {
    const world = await hosted();
    const { claim, change, integrate, reply, barrier, host } = await heldIntegration(world);
    // By hand, which only a person who knows the host has stopped should do; it has not.
    await rm(lockFile(world));
    const second = await world.start();
    assert.ok(second.first.port, second.stderr);
    // Opening, it found the intent with the branch still at the base: nothing integrated.
    const opened = await project(world);
    assert.deepEqual(
      [opened.branch.sha, opened.claims[0].status, opened.tasks[0].status, opened.undecided],
      [world.repo.base, "held", "open", undefined],
    );
    barrier.release();
    const late = await reply;
    assert.deepEqual([late.status, late.body.reason], [503, "notSingleWriter"]);
    // The check before update-ref is no fence: the branch moved all the same.
    assert.equal(await world.repo.head(), change);
    // The second host's records never say so: to them the claim is still held, its fence
    // still authorizes, and the branch moved outside coordination.
    assert.deepEqual(await project(world), opened);
    const authorized = await world.ask(authorize(claim), world.tokens.alice);
    assert.equal(authorized.status, 200, JSON.stringify(authorized.body));
    const again = await world.ask(integrate, world.tokens.alice);
    assert.deepEqual([again.status, again.body.reason], [409, "baselineMoved"]);
    // The first host, closed, leaves the second one's lock; a restart reads the same.
    const lock = await readFile(lockFile(world), "utf8");
    host.process.kill("SIGTERM");
    assert.equal(await host.exited, 0, host.stderr);
    assert.equal(await readFile(lockFile(world), "utf8"), lock);
    second.process.kill("SIGTERM");
    assert.equal(await second.exited, 0, second.stderr);
    assert.ok((await world.start()).first.port);
    assert.deepEqual(await project(world), opened);
    const restarted = await world.ask(integrate, world.tokens.alice);
    assert.deepEqual([restarted.status, restarted.body.reason], [409, "baselineMoved"]);
    t.diagnostic(
      JSON.stringify({
        late: [late.status, late.body.reason],
        head: "change",
        records: { branch: "base", claim: opened.claims[0].status, task: opened.tasks[0].status },
        authorize: [authorized.status, authorized.body.reason ?? ""],
        integrate: [again.status, again.body.reason],
        restart: [restarted.status, restarted.body.reason],
      }),
    );
  },
);

test(
  "outside the rule: a lock replaced by hand while an integration is held: its update-ref lands and the next opening records it",
  { timeout: 120_000, skip: linuxOnly },
  async (t) => {
    const world = await hosted();
    const { claim, change, integrate, reply, barrier, host } = await heldIntegration(world);
    const file = lockFile(world);
    // As after a person removed its lock and a start in another container wrote one.
    const theirs = `${JSON.stringify({ ...JSON.parse(await readFile(file, "utf8")), pidNamespace: "elsewhere pid:[1]" })}\n`;
    await writeFile(file, theirs);
    const revision = await world.revision();
    barrier.release();
    const late = await reply;
    assert.deepEqual([late.status, late.body.reason], [503, "notSingleWriter"]);
    assert.equal(await world.repo.head(), change);
    // Its outcome was never written: the intent stays.
    assert.equal(await world.revision(), revision);
    const pending = JSON.parse(await readFile(dataPaths(world.dataDir).coordination, "utf8")).projects[0].pending;
    assert.deepEqual([pending.from, pending.to], [world.repo.base, change]);
    host.process.kill("SIGTERM");
    assert.equal(await host.exited, 0, host.stderr);
    assert.equal(await readFile(file, "utf8"), theirs);
    // No start takes the replaced lock over, until a person removes it.
    await hostRefused(world, unconfirmed(world));
    await rm(file);
    assert.ok((await world.start()).first.port);
    // Opening finds the branch at the change and records the integration.
    const after = await project(world);
    assert.deepEqual(
      [after.branch.sha, after.claims[0].status, after.tasks[0].status, after.tasks[0].integratedSha, after.undecided],
      [change, "integrated", "integrated", change, undefined],
    );
    for (const request of [authorize(claim), integrate]) {
      const spent = await world.ask(request, world.tokens.alice);
      assert.deepEqual([spent.status, spent.body.reason], [409, "ended"], request.path);
    }
    t.diagnostic(
      JSON.stringify({
        late: [late.status, late.body.reason],
        head: "change",
        intent: "kept",
        reopened: { branch: "change", claim: after.claims[0].status, task: after.tasks[0].status },
      }),
    );
  },
);

/** How kill(pid, 0) answers here: "alive", or its error code. */
function signalable(pid: number) {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code;
  }
}

/** Linux: this process's PID namespace, as a lock records it after the host name. */
const pidNamespaceHere = process.platform === "linux" ? readlinkSync("/proc/self/ns/pid") : undefined;
/** bwrap's arguments for a new PID namespace that sees this machine's files, with a /proc of its own. */
const unsharePid = ["--unshare-pid", "--dev-bind", "/", "/", "--proc", "/proc", "--die-with-parent", "--"];
/**
 * A command that runs one in a new PID namespace after `burn` processes
 * there (bwrap is pid 1 in it and the shell 2), so that its pid is past
 * theirs; the shell forks it and exits with its status.
 */
const inNewPidNamespace = (burn = 0) => [
  "bwrap",
  ...unsharePid,
  "/bin/sh",
  "-c",
  'i=0; while [ "$i" -lt "$0" ]; do /bin/true; i=$((i + 1)); done; "$@"; exit $?',
  String(burn),
];
/** Why these tests cannot make a real PID namespace here, or false. Nothing simulates one instead. */
const noPidNamespace = (() => {
  if (process.platform !== "linux") return "PID namespaces are Linux only";
  const probe = spawnSync("bwrap", [...unsharePid, "readlink", "/proc/self/ns/pid"], { encoding: "utf8" });
  if (probe.error) return `bwrap does not run: ${probe.error.message}`;
  if (probe.status !== 0) return `bwrap made no PID namespace (exit ${probe.status}): ${probe.stderr.trim()}`;
  if (probe.stdout.trim() === pidNamespaceHere) return "bwrap stayed in this PID namespace";
  return false;
})();

/** The pid here of the process whose pid is `pid` in PID namespace `namespace`. */
async function pidHere(namespace: string, pid: number) {
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      if (readlinkSync(`/proc/${entry}/ns/pid`) !== namespace) continue;
      const nspid = /^NSpid:\s+(.+)$/m.exec(await readFile(`/proc/${entry}/status`, "utf8"))?.[1].split(/\s+/);
      if (nspid?.at(-1) === String(pid)) return Number(entry);
    } catch {
      // Gone, or another user's.
    }
  }
  return undefined;
}

/** A sha-256 prefix, to tell values apart in a test's output without printing them. */
const digest = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 12);

test(
  "a lock written in a real other PID namespace, its pid no process here, is never taken over: running, paused, expired or killed",
  { timeout: 180_000, skip: noPidNamespace },
  async (t) => {
    const world = await hosted();
    await defineTasks(world, ["one"]);
    world.host.process.kill("SIGTERM");
    assert.equal(await world.host.exited, 0, world.host.stderr);
    // The lowest pid from 300 that names no process here: Linux gives out pids from 300 again when they wrap.
    let free = 300;
    while (free < 5000 && signalable(free) !== "ESRCH") free += 1;
    assert.ok(free < 5000, "no pid below 5000 is free here");
    const holder = await world.start({}, [], inNewPidNamespace(free - 3));
    assert.ok(holder.first.port, holder.stderr);
    const file = lockFile(world);
    const lock = await readFile(file, "utf8");
    const info = JSON.parse(lock) as LockInfo;
    const namespace = info.pidNamespace!.slice(info.pidNamespace!.lastIndexOf(" ") + 1);
    assert.notEqual(namespace, pidNamespaceHere);
    assert.equal(info.strict, true);
    const holderHere = await pidHere(namespace, info.pid);
    assert.ok(holderHere !== undefined && holderHere !== info.pid, String(holderHere));
    const contend = async (when: string) => {
      // To a start here, the lock's pid names no process at all.
      const lockPidHere = signalable(info.pid);
      assert.equal(lockPidHere, "ESRCH");
      await hostRefused(world, unconfirmed(world));
      assert.equal((await refused(acquireWriterLock(world.dataDir))).message, unconfirmed(world));
      assert.equal((await refused(startHere(world.dataDir))).message, unconfirmed(world));
      assert.equal(await readFile(file, "utf8"), lock);
      assert.deepEqual(await lockLitter(world), []);
      t.diagnostic(JSON.stringify({ when, lockPidHere, strictHost: "refused", acquireWriterLock: "refused", ordinary: "refused" }));
    };
    t.diagnostic(
      JSON.stringify({
        here: pidNamespaceHere,
        holder: namespace,
        lockPid: info.pid,
        holderPidHere: holderHere,
        hostName: digest(info.pidNamespace!.slice(0, info.pidNamespace!.lastIndexOf(" "))),
      }),
    );
    await contend("running");
    process.kill(holderHere, "SIGSTOP");
    try {
      const hourAgo = new Date(Date.now() - 3_600_000);
      await utimes(file, hourAgo, hourAgo);
      await contend("paused, lock an hour old");
    } finally {
      process.kill(holderHere, "SIGCONT");
    }
    // Resumed, it still writes.
    const claimed = await world.ask(post("/claims", { taskId: "one", scopes: ["src"] }), world.tokens.alice);
    assert.equal(claimed.status, 201, JSON.stringify(claimed.body));
    // Killed, it leaves its lock, and nothing here can tell that it stopped.
    process.kill(holderHere, "SIGKILL");
    const exit = await holder.exited;
    assert.equal(exit, 137, holder.stderr);
    assert.equal(signalable(holderHere), "ESRCH");
    t.diagnostic(JSON.stringify({ killed: holderHere, exit }));
    await contend("killed");
    // Once a person removes it, a start here opens with the claim.
    await rm(file);
    assert.ok((await world.start()).first.port);
    assert.deepEqual((await heldClaims(world)).map((claim) => claim.id), [claimed.body.claim!.id]);
  },
);

test(
  "starts in a real other PID namespace, which cannot see the holder's pid, never take its lock: running, paused, expired or killed",
  { timeout: 180_000, skip: noPidNamespace },
  async (t) => {
    const world = await hosted();
    await defineTasks(world, ["one"]);
    const file = lockFile(world);
    const lock = await readFile(file, "utf8");
    const holderPid = (JSON.parse(lock) as LockInfo).pid;
    const contend = async (when: string) => {
      const contender = new Child("test/lock-contender.ts", [world.dataDir], {}, [], inNewPidNamespace());
      const report = JSON.parse(await contender.line());
      const exit = await contender.exited;
      const said = (message: string) => (message === unconfirmed(world) ? "dataDirHolderUnconfirmed" : message);
      t.diagnostic(
        JSON.stringify({ when, ...report, strict: said(report.strict), ordinary: said(report.ordinary), exit }),
      );
      assert.notEqual(report.pidNamespace, pidNamespaceHere);
      assert.deepEqual(
        [report.holderPid, report.holderHere, report.strict, report.ordinary, exit],
        [holderPid, "ESRCH", unconfirmed(world), unconfirmed(world), 1],
        contender.stderr,
      );
      assert.equal(await readFile(file, "utf8"), lock);
      assert.deepEqual(await lockLitter(world), []);
    };
    await contend("running");
    world.host.process.kill("SIGSTOP");
    try {
      const hourAgo = new Date(Date.now() - 3_600_000);
      await utimes(file, hourAgo, hourAgo);
      await contend("paused, lock an hour old");
    } finally {
      world.host.process.kill("SIGCONT");
    }
    const claimed = await world.ask(post("/claims", { taskId: "one", scopes: ["src"] }), world.tokens.alice);
    assert.equal(claimed.status, 201, JSON.stringify(claimed.body));
    await world.kill();
    await contend("killed");
    // In the holder's own namespace a start sees that it stopped, and opens with the claim.
    assert.ok((await world.start()).first.port);
    assert.deepEqual((await heldClaims(world)).map((claim) => claim.id), [claimed.body.claim!.id]);
  },
);
