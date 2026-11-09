/**
 * Coordination across processes: a host process (test/coordination-host.ts)
 * owns a data directory's coordinator, and separate client processes
 * (test/coordination-client.ts) race against it over HTTP. Every process
 * these tests start or kill is their own child, on a temporary directory
 * and repository.
 */
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import { after, test } from "node:test";
import { makeRepo, type TestRepo } from "../test/coordination-fixtures.js";
import { dataPaths, resolveConfig } from "./config.js";
import type { ClaimView, ProjectView, TaskView } from "./coordination.js";
import { acquireWriterLock, startServer, StartupError } from "./index.js";
import { pathsMeet } from "./scope-paths.js";

const repoRoot = path.resolve(import.meta.dirname, "..");
const children = new Set<ChildProcess>();
const roots: string[] = [];
after(async () => {
  for (const child of children) child.kill("SIGKILL");
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

/** A child node process running `entry`, read line by line. */
class Child {
  readonly process: ChildProcess;
  readonly exited: Promise<number | string | null>;
  stderr = "";
  #lines: string[] = [];
  #waiting: ((line: string | undefined) => void)[] = [];
  #done = false;

  constructor(entry: string, args: string[], env: Record<string, string> = {}, preload: string[] = []) {
    const imports = [...preload, "tsx"].flatMap((module) => ["--import", module]);
    this.process = spawn(process.execPath, [...imports, entry, ...args], {
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
  tokens: Record<"alice" | "bob" | "admin", string>;
  host: Child;
  port: number;
  /**
   * Starts a host on the data directory (it sets coordination up the
   * first time), with what it printed first: { port } or { error, reason }.
   * `preload` modules run in it first.
   */
  start(
    env?: Record<string, string>,
    preload?: string[],
  ): Promise<Child & { first: { port?: number; reason?: string } }>;
  /** Kills the host and waits until its process is gone. */
  kill(): Promise<void>;
  /** Client processes that start together on "go"; one reply list per plan. */
  race(plans: Plan[]): Promise<Reply[][]>;
  /** One request as admin, from this process, to the host on `port` (the latest by default). */
  ask(request: Request, token?: string, port?: number): Promise<Answer>;
  revision(): Promise<number>;
}

async function hosted(env: Record<string, string> = {}): Promise<Hosted> {
  const root = await mkdtemp(path.join(os.tmpdir(), "bellpr-coordination-race-"));
  roots.push(root);
  const dataDir = path.join(root, "data");
  const repo = await makeRepo(root);
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
      projects: [{ id: "app", repository: repo.bare, branch: "integration" }],
      tokens: tokensFile,
    }),
  );
  await mkdir(dataDir);
  const world = {
    root,
    dataDir,
    repo,
    async start(more: Record<string, string> = {}, preload: string[] = []) {
      const host = new Child("test/coordination-host.ts", [dataDir, setupFile], more, preload);
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

const post = (path: string, body: unknown): Request => ({ method: "POST", path: `/projects/app${path}`, body });
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
 * a simulation, as these tests cannot make a real namespace.
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

/** A start refused at once, without waiting out a lease (30 s). */
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
