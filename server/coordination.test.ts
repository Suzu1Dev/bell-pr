import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { makeRepo, type TestRepo } from "../test/coordination-fixtures.js";
import { dataPaths } from "./config.js";
import {
  changedFiles,
  coordinationLimits,
  Coordinator,
  type Actor,
  type ClaimView,
  type CoordinatorOptions,
} from "./coordination.js";
import { writeDurable } from "./fs-atomic.js";
import { acquireWriterLock } from "./index.js";
import { git } from "./process.js";
import { pathsMeet } from "./scope-paths.js";
import { AppError } from "./types.js";
import type { WriterLock } from "./writer-lock.js";

const roots: string[] = [];
const locks: WriterLock[] = [];
after(async () => {
  for (const lock of locks) lock.release();
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

/** The status and stable reason of the refusal `action` must end in. */
async function refusal(action: () => unknown) {
  try {
    await action();
  } catch (error) {
    if (error instanceof AppError)
      return { status: error.statusCode, reason: error.details?.reason };
    throw error;
  }
  return assert.fail("expected a refusal");
}

interface World {
  dataDir: string;
  /** The data directory's strict lock, which this process holds. */
  lock: WriterLock;
  repo: TestRepo;
  coordinator: Coordinator;
  alice: Actor;
  bob: Actor;
  admin: Actor;
  /** Opens the coordinator again from disk, as a restarted host would. */
  reopen(overrides?: Partial<CoordinatorOptions>): Promise<Coordinator>;
  onDisk(): Promise<{
    revision: number;
    projects: { claims: { id: string; status: string; scopes: string[] }[]; pending?: unknown }[];
  }>;
}

/** A coordinator with alice, bob (members), admin and project "app" on a fresh repository. */
async function world(overrides: Partial<CoordinatorOptions> = {}): Promise<World> {
  const root = await mkdtemp(path.join(os.tmpdir(), "bellpr-coordination-"));
  roots.push(root);
  const dataDir = path.join(root, "data");
  await mkdir(dataDir);
  const repo = await makeRepo(root);
  const lock = await acquireWriterLock(dataDir);
  locks.push(lock);
  const options: CoordinatorOptions = { dataDir, lock, ...overrides };
  const coordinator = await Coordinator.create(options);
  const tokens: Record<string, string> = {};
  for (const [id, role] of [["alice", "member"], ["bob", "member"], ["admin", "admin"]] as const)
    tokens[id] = (await coordinator.addParticipant(id, role)).token;
  await coordinator.defineProject("app", repo.bare, "integration");
  const signIn = (into: World, opened: Coordinator) => {
    into.coordinator = opened;
    into.alice = opened.authenticate(tokens.alice);
    into.bob = opened.authenticate(tokens.bob);
    into.admin = opened.authenticate(tokens.admin);
  };
  const result = {
    dataDir,
    lock,
    repo,
    async reopen(more: Partial<CoordinatorOptions> = {}) {
      signIn(result, await Coordinator.open({ ...options, ...more }));
      return result.coordinator;
    },
    async onDisk() {
      return JSON.parse(await readFile(dataPaths(dataDir).coordination, "utf8"));
    },
  } as World;
  signIn(result, coordinator);
  return result;
}

const held = (w: World) =>
  w.coordinator.project(w.admin, "app").claims.filter((claim) => claim.status === "held");

describe("claims", () => {
  test("of two participants claiming the same files at once, exactly one gets them", async () => {
    const w = await world();
    const pairs = [
      ["area0", "AREA0/x.ts"],
      ["./area1/", "area1"],
      ["area2/deep/file.ts", "area2/deep"],
      ["Area3", "area3/"],
    ];
    for (let round = 0; round < 20; round += 1) {
      const [mine, theirs] = pairs[round % pairs.length].map((scope) =>
        scope.replace(/\d/, String(round)),
      );
      await w.coordinator.defineTask(w.alice, "app", { id: `a${round}` });
      await w.coordinator.defineTask(w.bob, "app", { id: `b${round}` });
      const outcomes = await Promise.allSettled([
        w.coordinator.claim(w.alice, "app", { taskId: `a${round}`, scopes: [mine] }),
        w.coordinator.claim(w.bob, "app", { taskId: `b${round}`, scopes: [theirs] }),
      ]);
      const granted = outcomes.filter((outcome) => outcome.status === "fulfilled");
      const refused = outcomes.filter((outcome) => outcome.status === "rejected");
      assert.equal(granted.length, 1, `round ${round}`);
      assert.equal((refused[0].reason as AppError).details?.reason, "conflict");
    }
    const claims = held(w);
    assert.equal(claims.length, 20);
    await w.reopen();
    assert.deepEqual(held(w), claims);
  });

  test("claims on different files coexist", async () => {
    const w = await world();
    await w.coordinator.defineTask(w.alice, "app", { id: "one" });
    await w.coordinator.defineTask(w.bob, "app", { id: "two" });
    const [one, two] = await Promise.all([
      w.coordinator.claim(w.alice, "app", { taskId: "one", scopes: ["src/a"] }),
      w.coordinator.claim(w.bob, "app", { taskId: "two", scopes: ["src/a.ts", "src/ab", "lib"] }),
    ]);
    assert.deepEqual(one.scopes, ["src/a"]);
    assert.deepEqual(two.scopes, ["src/a.ts", "src/ab", "lib"]);
    assert.ok(two.fence > one.fence || one.fence > two.fence);
    assert.equal(held(w).length, 2);
  });

  test("a task waits for its dependencies, and a failed or unknown one stops it", async () => {
    const w = await world();
    await w.coordinator.defineTask(w.alice, "app", { id: "base" });
    await w.coordinator.defineTask(w.alice, "app", { id: "mid", dependsOn: ["base"] });
    assert.deepEqual(
      await refusal(() => w.coordinator.defineTask(w.alice, "app", { id: "x", dependsOn: ["nope"] })),
      { status: 400, reason: "dependencyUnknown" },
    );
    assert.deepEqual(
      await refusal(() => w.coordinator.claim(w.bob, "app", { taskId: "mid", scopes: ["lib"] })),
      { status: 409, reason: "dependencyPending" },
    );
    const base = await w.coordinator.claim(w.alice, "app", { taskId: "base", scopes: ["src"] });
    assert.deepEqual(
      await refusal(() => w.coordinator.failTask(w.bob, "app", "base", {})),
      { status: 403, reason: "notFailable" },
    );
    await w.coordinator.failTask(w.alice, "app", "base", { reason: "broken build" });
    assert.equal(
      w.coordinator.project(w.alice, "app").claims.find((claim) => claim.id === base.id)?.status,
      "released",
    );
    assert.deepEqual(
      await refusal(() => w.coordinator.claim(w.bob, "app", { taskId: "mid", scopes: ["lib"] })),
      { status: 409, reason: "dependencyFailed" },
    );
    assert.deepEqual(
      await refusal(() => w.coordinator.claim(w.bob, "app", { taskId: "base", scopes: ["lib"] })),
      { status: 409, reason: "taskClosed" },
    );
    assert.equal(held(w).length, 0);
  });

  test("a widening that conflicts leaves the claim exactly as it was", async () => {
    const w = await world();
    await w.coordinator.defineTask(w.alice, "app", { id: "one" });
    await w.coordinator.defineTask(w.bob, "app", { id: "two" });
    const mine = await w.coordinator.claim(w.alice, "app", { taskId: "one", scopes: ["src"] });
    await w.coordinator.claim(w.bob, "app", { taskId: "two", scopes: ["lib"] });
    const before = (await w.onDisk()).revision;
    assert.deepEqual(
      await refusal(() =>
        w.coordinator.expand(w.alice, "app", mine.id, { fence: mine.fence, scopes: ["docs", "LIB/c.ts"] }),
      ),
      { status: 409, reason: "conflict" },
    );
    assert.equal((await w.onDisk()).revision, before);
    const unchanged = held(w).find((claim) => claim.id === mine.id)!;
    assert.deepEqual([unchanged.scopes, unchanged.fence], [["src"], mine.fence]);
    const wider = await w.coordinator.expand(w.alice, "app", mine.id, {
      fence: mine.fence,
      scopes: ["docs", "SRC"],
    });
    assert.deepEqual([wider.scopes, wider.fence], [["src", "docs"], mine.fence]);
    // Widening and a new claim for the same files at once: one of them.
    await w.coordinator.defineTask(w.bob, "app", { id: "three" });
    const outcomes = await Promise.allSettled([
      w.coordinator.expand(w.alice, "app", mine.id, { fence: mine.fence, scopes: ["web"] }),
      w.coordinator.claim(w.bob, "app", { taskId: "three", scopes: ["web/index.html"] }),
    ]);
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  });

  test("a conflict names exactly the held claims a brute-force comparison finds, in order", async () => {
    const w = await world();
    let seed = 7;
    const random = (below: number) => {
      seed = (seed * 48_271) % 2_147_483_647;
      return seed % below;
    };
    const parts = ["a", "A", "b", "a-b", "a.b", "a b", "ab", "B"];
    const scope = () =>
      Array.from({ length: 1 + random(3) }, () => parts[random(parts.length)]).join("/");
    let [refusals, several] = [0, 0];
    for (let round = 0; round < 80; round += 1) {
      const actor = random(2) ? w.alice : w.bob;
      await w.coordinator.defineTask(actor, "app", { id: `t${round}` });
      const wanted = [...new Map(Array.from({ length: 1 + random(3) }, scope).map((s) => [s.toLowerCase(), s])).values()];
      const expected = held(w)
        .filter((claim) => claim.scopes.some((a) => wanted.some((b) => pathsMeet(a, b))))
        .map((claim) => claim.id);
      const outcome = await w.coordinator.claim(actor, "app", { taskId: `t${round}`, scopes: wanted }).then(
        () => [],
        (error: AppError) => {
          assert.equal(error.details?.reason, "conflict", JSON.stringify(wanted));
          return (error.details?.conflicts as { claimId: string }[]).map((conflict) => conflict.claimId);
        },
      );
      assert.deepEqual(outcome, expected, JSON.stringify(wanted));
      refusals += outcome.length ? 1 : 0;
      several += outcome.length > 1 ? 1 : 0;
    }
    assert.ok(held(w).length > 5 && refusals > 20 && several > 5, `${held(w).length} ${refusals} ${several}`);
  });

  test("only the holder releases a claim, and only an admin revokes one", async () => {
    const w = await world();
    await w.coordinator.defineTask(w.alice, "app", { id: "one" });
    const mine = await w.coordinator.claim(w.alice, "app", { taskId: "one", scopes: ["src"] });
    assert.deepEqual(
      await refusal(() => w.coordinator.release(w.bob, "app", mine.id, { fence: mine.fence })),
      { status: 403, reason: "notHolder" },
    );
    assert.deepEqual(
      await refusal(() => w.coordinator.revoke(w.bob, "app", mine.id, {})),
      { status: 403, reason: "adminOnly" },
    );
    assert.deepEqual(
      await refusal(() => w.coordinator.release(w.alice, "app", mine.id, { fence: mine.fence + 1 })),
      { status: 409, reason: "staleFence" },
    );
    assert.equal(held(w).length, 1);
    const released = await w.coordinator.release(w.alice, "app", mine.id, { fence: mine.fence });
    assert.deepEqual([released.status, released.endedBy], ["released", "alice"]);
    assert.deepEqual(
      await refusal(() => w.coordinator.release(w.alice, "app", mine.id, { fence: mine.fence })),
      { status: 409, reason: "ended" },
    );
  });

  test("who is asking comes from the token alone", async () => {
    const w = await world();
    for (const token of [undefined, "", "bpc_", `bpc_${"A".repeat(43)}`, "Bearer x"])
      assert.deepEqual(await refusal(() => w.coordinator.authenticate(token)), {
        status: 401,
        reason: "unauthenticated",
      });
    await w.coordinator.defineTask(w.alice, "app", { id: "one" });
    const mine = await w.coordinator.claim(w.alice, "app", { taskId: "one", scopes: ["src"] });
    // An actor that only says it is the admin is no one.
    const forged = { id: "admin", role: "admin" } as const;
    assert.deepEqual(await refusal(() => w.coordinator.revoke(forged, "app", mine.id, {})), {
      status: 401,
      reason: "unauthenticated",
    });
    const text = await readFile(dataPaths(w.dataDir).coordination, "utf8");
    assert.doesNotMatch(text, /bpc_/);
  });

  test("a scope that cannot be compared reliably is refused, and nothing is claimed", async () => {
    const w = await world();
    await w.coordinator.defineTask(w.alice, "app", { id: "one" });
    const before = (await w.onDisk()).revision;
    const unreliable = [
      "",
      ".",
      "./",
      "/src",
      "../x",
      "src/../lib",
      "src\\a",
      "src//a",
      "src/./a",
      "src/Ä.md",
      "docs/é",
      "src.",
      "src ",
      " src",
      "PROGRA~1",
      "a/b~1/c",
      ".git",
      ".GIT/x",
      "src/.Git",
      "a/*.ts",
      "a/{b,c}",
      "C:x",
      "node_modules",
      ".env",
      "keys/x.pem",
      "a\u0000b",
    ];
    for (const scope of unreliable)
      assert.deepEqual(
        await refusal(() => w.coordinator.claim(w.alice, "app", { taskId: "one", scopes: ["lib", scope] })),
        { status: 400, reason: "invalidScope" },
        JSON.stringify(scope),
      );
    assert.equal((await w.onDisk()).revision, before);
    const claim = await w.coordinator.claim(w.alice, "app", {
      taskId: "one",
      scopes: ["./src/", "SRC", "lib/x.ts"],
    });
    assert.deepEqual(claim.scopes, ["src", "lib/x.ts"]);
  });

  test("authorize checks the holder, the fence and every path", async () => {
    const w = await world();
    await w.coordinator.defineTask(w.alice, "app", { id: "one" });
    const mine = await w.coordinator.claim(w.alice, "app", { taskId: "one", scopes: ["src"] });
    const ask = (actor: Actor, fence: number, paths: string[]) =>
      w.coordinator.authorize(actor, "app", { claimId: mine.id, fence, paths });
    assert.deepEqual(ask(w.alice, mine.fence, ["src/a.ts", "SRC/new/b.ts", "src"]), {
      claimId: mine.id,
      fence: mine.fence,
    });
    assert.deepEqual(await refusal(() => ask(w.alice, mine.fence, ["src/a.ts", "lib/c.ts"])), {
      status: 403,
      reason: "outOfScope",
    });
    assert.deepEqual(await refusal(() => ask(w.alice, mine.fence, ["srcx/a.ts"])), {
      status: 403,
      reason: "outOfScope",
    });
    for (const file of ["../x", "src\\a", "src//a", "src/./a", "src/.GIT/config", "/src/a", ""])
      assert.deepEqual(await refusal(() => ask(w.alice, mine.fence, [file])), {
        status: 400,
        reason: "unreliablePath",
      });
    assert.deepEqual(await refusal(() => ask(w.alice, mine.fence + 1, ["src/a.ts"])), {
      status: 409,
      reason: "staleFence",
    });
    assert.deepEqual(await refusal(() => ask(w.bob, mine.fence, ["src/a.ts"])), {
      status: 403,
      reason: "notHolder",
    });
  });
});

describe("the coordination file", () => {
  test("a claim whose write fails is not granted, and nothing is answered until reopened", async () => {
    let failing = false;
    const w = await world({
      write: (file, data, opts) =>
        failing ? Promise.reject(new Error("disk full")) : writeDurable(file, data, opts),
    });
    await w.coordinator.defineTask(w.alice, "app", { id: "one" });
    await w.coordinator.defineTask(w.bob, "app", { id: "two" });
    failing = true;
    assert.deepEqual(
      await refusal(() => w.coordinator.claim(w.alice, "app", { taskId: "one", scopes: ["src"] })),
      { status: 503, reason: "unavailable" },
    );
    failing = false;
    // Memory and disk may disagree now, so nothing is answered from memory.
    assert.deepEqual(
      await refusal(() => w.coordinator.claim(w.bob, "app", { taskId: "two", scopes: ["lib"] })),
      { status: 503, reason: "unavailable" },
    );
    assert.deepEqual(await refusal(() => w.coordinator.project(w.alice, "app")), {
      status: 503,
      reason: "unavailable",
    });
    await w.reopen();
    assert.equal(held(w).length, 0);
    const theirs = await w.coordinator.claim(w.bob, "app", { taskId: "two", scopes: ["src"] });
    assert.equal(theirs.holder, "bob");
  });

  test("a write that fails after it landed still never grants a file twice", async () => {
    let landThenFail = false;
    const w = await world({
      write: async (file, data, opts) => {
        await writeDurable(file, data, opts);
        if (landThenFail) throw new Error("fsync reported an error");
      },
    });
    await w.coordinator.defineTask(w.alice, "app", { id: "one" });
    await w.coordinator.defineTask(w.bob, "app", { id: "two" });
    landThenFail = true;
    assert.equal(
      (await refusal(() => w.coordinator.claim(w.alice, "app", { taskId: "one", scopes: ["src"] }))).reason,
      "unavailable",
    );
    landThenFail = false;
    // The file decides: the claim landed, so bob cannot have the same files.
    await w.reopen();
    assert.deepEqual(held(w).map((claim) => [claim.holder, claim.scopes]), [["alice", ["src"]]]);
    assert.deepEqual(
      await refusal(() => w.coordinator.claim(w.bob, "app", { taskId: "two", scopes: ["src/a.ts"] })),
      { status: 409, reason: "conflict" },
    );
  });

  test("a missing, damaged, newer or inconsistent file is refused, never read as empty", async () => {
    const w = await world();
    await w.coordinator.defineTask(w.alice, "app", { id: "one" });
    await w.coordinator.defineTask(w.bob, "app", { id: "two" });
    const mine = await w.coordinator.claim(w.alice, "app", { taskId: "one", scopes: ["src"] });
    const file = dataPaths(w.dataDir).coordination;
    const good = await readFile(file, "utf8");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- edits arbitrary file contents
    const edited = (edit: (state: any) => void) => {
      const state = JSON.parse(good);
      edit(state);
      return JSON.stringify(state);
    };
    const cases: [string, string | undefined][] = [
      ["missing", undefined],
      ["damaged", "{"],
      ["damaged", ""],
      ["damaged", edited((state) => (state.version = 2))],
      ["damaged", edited((state) => (state.format = "something-else"))],
      ["damaged", edited((state) => (state.projects[0].claims[0].status = "paused"))],
      ["damaged", edited((state) => (state.participants[0].role = "owner"))],
      [
        "damaged",
        // A second held claim on the same files, otherwise well formed.
        edited((state) => {
          const project = state.projects[0];
          project.fence += 1;
          project.claims.push({
            ...project.claims[0],
            id: "00000000-0000-4000-8000-000000000000",
            taskId: "two",
            holder: "bob",
            scopes: ["SRC/a.ts"],
            fence: project.fence,
          });
        }),
      ],
      ["damaged", edited((state) => (state.projects[0].claims[0].holder = "mallory"))],
      ["damaged", edited((state) => (state.projects[0].claims[0].fence = 99))],
      ["damaged", edited((state) => (state.projects[0].claims[0].scopes = ["src/Ä"]))],
      ["damaged", edited((state) => (state.projects[0].tasks[0].dependsOn = ["two"]))],
    ];
    for (const [reason, content] of cases) {
      if (content === undefined) await rm(file);
      else await writeFile(file, content);
      assert.deepEqual(await refusal(() => w.reopen()), { status: 503, reason }, content);
    }
    await writeFile(file, good);
    await w.reopen();
    assert.deepEqual(held(w).map((claim) => claim.id), [mine.id]);
    assert.deepEqual(await refusal(() => Coordinator.create({ dataDir: w.dataDir, lock: w.lock })), {
      status: 409,
      reason: "exists",
    });
  });

  test("a lost data-directory lock stops every write", async () => {
    const w = await world();
    await w.coordinator.defineTask(w.alice, "app", { id: "one" });
    const file = dataPaths(w.dataDir).lock;
    const mine = await readFile(file, "utf8");
    const before = await w.onDisk();
    // Another start's lock lies there now, as after a person removed this one.
    await writeFile(file, JSON.stringify({ ...JSON.parse(mine), pid: process.pid + 1 }));
    assert.deepEqual(
      await refusal(() => w.coordinator.claim(w.alice, "app", { taskId: "one", scopes: ["src"] })),
      { status: 503, reason: "notSingleWriter" },
    );
    assert.deepEqual(await w.onDisk(), before);
    // The lock file names this process again: the coordinator stays stopped.
    await writeFile(file, mine);
    assert.equal(
      (await refusal(() => w.coordinator.claim(w.alice, "app", { taskId: "one", scopes: ["src"] }))).reason,
      "notSingleWriter",
    );
    await rm(file);
    assert.deepEqual(await refusal(() => w.reopen()), { status: 503, reason: "notSingleWriter" });
    await writeFile(file, mine);
    await w.reopen();
    assert.equal(held(w).length, 0);
    assert.deepEqual(await w.onDisk(), before);
  });

  test("only the strict lock this process holds on the same directory opens coordination", async () => {
    const w = await world();
    const other = await world();
    const standIns: unknown[] = [
      { dataDir: w.dataDir, holds: () => true, release() {} },
      Object.freeze({ ...w.lock }),
      other.lock,
      undefined,
    ];
    const opens = [
      (options: CoordinatorOptions) => Coordinator.open(options),
      (options: CoordinatorOptions) => Coordinator.create(options),
    ];
    for (const lock of standIns)
      for (const open of opens)
        assert.deepEqual(
          await refusal(() => open({ dataDir: w.dataDir, lock: lock as WriterLock })),
          { status: 503, reason: "notSingleWriter" },
        );
    w.lock.release();
    assert.deepEqual(await refusal(() => w.reopen()), { status: 503, reason: "notSingleWriter" });
    const again = await acquireWriterLock(w.dataDir);
    locks.push(again);
    await w.reopen({ lock: again });
    assert.equal(held(w).length, 0);
  });

  test("keys a newer build added survive this build's writes", async () => {
    const w = await world();
    await w.coordinator.defineTask(w.alice, "app", { id: "one" });
    await w.coordinator.claim(w.alice, "app", { taskId: "one", scopes: ["src"] });
    const file = dataPaths(w.dataDir).coordination;
    const state = JSON.parse(await readFile(file, "utf8"));
    state.futureSetting = { kept: true };
    state.projects[0].claims[0].futureNote = "kept";
    await writeFile(file, JSON.stringify(state));
    await w.reopen();
    await w.coordinator.defineTask(w.bob, "app", { id: "two" });
    const after = JSON.parse(await readFile(file, "utf8"));
    assert.deepEqual(after.futureSetting, { kept: true });
    assert.equal(after.projects[0].claims[0].futureNote, "kept");
    assert.equal(w.coordinator.project(w.alice, "app").claims[0].scopes[0], "src");
    assert.equal("futureNote" in w.coordinator.project(w.alice, "app").claims[0], false);
  });
});

describe("revocation", () => {
  test("a revoked claim's fence authorises nothing, and the next grant takes a higher one", async () => {
    const w = await world();
    await w.coordinator.defineTask(w.alice, "app", { id: "one" });
    const old = await w.coordinator.claim(w.alice, "app", { taskId: "one", scopes: ["src"] });
    const change = await w.repo.commit(w.repo.base, { "src/a.ts": "changed\n" });
    const revoked = await w.coordinator.revoke(w.admin, "app", old.id, { reason: "left the team" });
    assert.deepEqual([revoked.status, revoked.endedBy, revoked.reason], ["revoked", "admin", "left the team"]);
    const ended = { status: 409, reason: "ended" };
    assert.deepEqual(
      await refusal(() => w.coordinator.authorize(w.alice, "app", { claimId: old.id, fence: old.fence, paths: ["src/a.ts"] })),
      ended,
    );
    assert.deepEqual(
      await refusal(() => w.coordinator.expand(w.alice, "app", old.id, { fence: old.fence, scopes: ["lib"] })),
      ended,
    );
    assert.deepEqual(
      await refusal(() => w.coordinator.release(w.alice, "app", old.id, { fence: old.fence })),
      ended,
    );
    assert.deepEqual(
      await refusal(() =>
        w.coordinator.integrate(w.alice, "app", old.id, { fence: old.fence, base: w.repo.base, commit: change }),
      ),
      ended,
    );
    assert.equal(await w.repo.head(), w.repo.base);
    const next = await w.coordinator.claim(w.bob, "app", { taskId: "one", scopes: ["src"] });
    assert.ok(next.fence > old.fence);
    // The old holder cannot borrow the new claim either.
    assert.deepEqual(
      await refusal(() => w.coordinator.authorize(w.alice, "app", { claimId: next.id, fence: next.fence, paths: ["src/a.ts"] })),
      { status: 403, reason: "notHolder" },
    );
    await w.reopen();
    assert.deepEqual(
      await refusal(() => w.coordinator.authorize(w.alice, "app", { claimId: old.id, fence: old.fence, paths: ["src/a.ts"] })),
      ended,
    );
  });
});

describe("integration", () => {
  async function claimed(w: World, actor: Actor, task: string, scopes: string[], dependsOn?: string[]) {
    await w.coordinator.defineTask(actor, "app", { id: task, dependsOn });
    return await w.coordinator.claim(actor, "app", { taskId: task, scopes });
  }

  test("moves the branch to a change within the claim and unblocks dependants", async () => {
    const w = await world();
    const mine = await claimed(w, w.alice, "one", ["src"]);
    await w.coordinator.defineTask(w.bob, "app", { id: "after", dependsOn: ["one"] });
    const first = await w.repo.commit(w.repo.base, { "src/a.ts": "1\n" });
    const change = await w.repo.commit(first, { "src/new/b.ts": "2\n" });
    const done = await w.coordinator.integrate(w.alice, "app", mine.id, {
      fence: mine.fence,
      base: w.repo.base,
      commit: change,
    });
    assert.deepEqual(
      [done.claim.status, done.task.status, done.task.integratedSha, done.branch.sha],
      ["integrated", "integrated", change, change],
    );
    assert.equal(await w.repo.head(), change);
    assert.equal(await w.repo.head("main"), w.repo.base);
    const next = await w.coordinator.claim(w.bob, "app", { taskId: "after", scopes: ["src"] });
    assert.equal(next.holder, "bob");
    await w.reopen();
    assert.equal(w.coordinator.project(w.bob, "app").branch.sha, change);
  });

  test("refuses a change touching anything outside the claim, renames and reverts included", async () => {
    const w = await world();
    const mine = await claimed(w, w.alice, "one", ["src"]);
    const outside = await w.repo.commit(w.repo.base, { "src/a.ts": "1\n", "lib/c.ts": "2\n" });
    const renamedIn = await w.repo.commit(w.repo.base, {}, { renames: [["lib/c.ts", "src/c.ts"]] });
    const renamedOut = await w.repo.commit(w.repo.base, {}, { renames: [["src/b.ts", "lib/b.ts"]] });
    const touched = await w.repo.commit(w.repo.base, { "docs/guide.md": "temporary\n" });
    const reverted = await w.repo.commit(touched, { "docs/guide.md": "guide\n", "src/a.ts": "3\n" });
    const inside = await w.repo.commit(w.repo.base, { "src/a.ts": "4\n" });
    for (const [commit, file] of [
      [outside, "lib/c.ts"],
      [renamedIn, "lib/c.ts"],
      [renamedOut, "lib/b.ts"],
      [reverted, "docs/guide.md"],
    ]) {
      const error = await w.coordinator
        .integrate(w.alice, "app", mine.id, { fence: mine.fence, base: w.repo.base, commit })
        .then(() => assert.fail("integrated"), (thrown: AppError) => thrown);
      assert.deepEqual([error.statusCode, error.details?.reason, error.details?.path], [403, "outOfScope", file]);
    }
    assert.equal(await w.repo.head(), w.repo.base);
    assert.equal(held(w)[0].id, mine.id);
    await w.coordinator.integrate(w.alice, "app", mine.id, { fence: mine.fence, base: w.repo.base, commit: inside });
    assert.equal(await w.repo.head(), inside);
  });

  test("replace refs pushed to the repository never decide what a change is", async () => {
    const w = await world();
    const mine = await claimed(w, w.alice, "lib", ["lib"]);
    const bobs = await claimed(w, w.bob, "bob", ["src/a.ts"]);
    const replace = (original: string, shown: string) =>
      git(w.repo.bare, ["replace", "-f", original, shown]);
    const integrate = (claim: ClaimView, base: string, commit: string) =>
      refusal(() => w.coordinator.integrate(w.alice, "app", claim.id, { fence: claim.fence, base, commit }));
    // A change to bob's file, shown as one to lib/c.ts alone.
    const hidden = await w.repo.commit(w.repo.base, { "lib/c.ts": "1\n", "src/a.ts": "alice\n" });
    await replace(hidden, await w.repo.commit(w.repo.base, { "lib/c.ts": "1\n" }));
    assert.deepEqual(await integrate(mine, w.repo.base, hidden), { status: 403, reason: "outOfScope" });
    // A merge bringing bob's file in, shown as one commit on the base.
    const side = await w.repo.commit(w.repo.base, { "src/a.ts": "side\n" });
    const merge = await w.repo.merge(await w.repo.commit(w.repo.base, { "lib/c.ts": "2\n" }), side);
    await replace(merge, await w.repo.commit(w.repo.base, { "lib/c.ts": "2\n" }));
    assert.deepEqual(await integrate(mine, w.repo.base, merge), { status: 409, reason: "mergeCommit" });
    // A commit beside the branch, shown as one on top of it: the branch would lose a commit.
    const first = await w.repo.commit(w.repo.base, { "lib/c.ts": "3\n" });
    await w.coordinator.integrate(w.alice, "app", mine.id, { fence: mine.fence, base: w.repo.base, commit: first });
    const next = await claimed(w, w.alice, "lib-2", ["lib"]);
    const beside = await w.repo.commit(w.repo.base, { "lib/c.ts": "4\n" });
    await replace(beside, await w.repo.commit(first, { "lib/c.ts": "4\n" }));
    assert.deepEqual(await integrate(next, first, beside), { status: 409, reason: "notFastForward" });

    assert.equal(await w.repo.head(), first);
    const file = await git(w.repo.bare, ["--no-replace-objects", "cat-file", "blob", `${first}:src/a.ts`]);
    assert.equal(file.stdout, "a\n");
    assert.deepEqual(held(w).map((claim) => claim.id), [bobs.id, next.id]);
  });

  test("a graft file in the repository never decides what a change's history is", async () => {
    const w = await world();
    const mine = await claimed(w, w.alice, "lib", ["lib"]);
    const bobs = await claimed(w, w.bob, "bob", ["src/a.ts"]);
    const { base, bare } = w.repo;
    const tree = async (commit: string) => (await git(bare, ["rev-parse", `${commit}^{tree}`])).stdout.trim();
    const commitTree = async (of: string, parents: string[]) => {
      const identity = ["-c", "user.name=Coordination Test", "-c", "user.email=coordination@example.invalid"];
      const made = await git(bare, [
        ...identity,
        "commit-tree",
        await tree(of),
        ...parents.flatMap((parent) => ["-p", parent]),
        "-m",
        "change",
      ]);
      return made.stdout.trim();
    };
    // Writing info/grafts takes write access to the repository directory; a push cannot.
    const graft = (commit: string, parents: string[]) =>
      writeFile(path.join(bare, "info", "grafts"), `${[commit, ...parents].join(" ")}\n`);
    const integrate = (commit: string) =>
      w.coordinator
        .integrate(w.alice, "app", mine.id, { fence: mine.fence, base, commit })
        .then(
          () => assert.fail("integrated"),
          (error: AppError) => [error.statusCode, error.details?.reason, error.details?.kind, error.details?.path],
        );
    const secret = "TOKEN=not-real\n";
    // A change to lib alone, whose real parent is an unrelated history with
    // a secret and bob's file; the graft names the base instead.
    const unrelated = await commitTree(await w.repo.commit(base, { "src/.env": secret, "src/a.ts": "other\n" }), []);
    const forged = await commitTree(await w.repo.commit(base, { "lib/c.ts": "1\n" }), [unrelated]);
    await graft(forged, [base]);
    assert.deepEqual(await integrate(forged), [409, "notFastForward", undefined, undefined]);
    // A merge that brings both in, grafted down to its first parent.
    const side = await w.repo.commit(base, { "src/.env": secret, "src/a.ts": "side\n" });
    const lib = await w.repo.commit(base, { "lib/c.ts": "2\n" });
    const merge = await commitTree(lib, [lib, side]);
    await graft(merge, [lib]);
    assert.deepEqual(await integrate(merge), [409, "mergeCommit", undefined, undefined]);
    // A secret added in one commit and removed in the next, the first grafted away.
    const added = await w.repo.commit(base, { "lib/.env": secret, "lib/c.ts": "3\n" });
    const removed = await w.repo.commit(added, { "lib/.env": null });
    await graft(removed, [base]);
    assert.deepEqual(await integrate(removed), [403, "needsManualHandling", "sensitive", "lib/.env"]);
    // Nothing moved and bob still holds his file; a change as it is integrates.
    assert.equal(await w.repo.head(), base);
    assert.deepEqual(held(w).map((claim) => claim.id).sort(), [mine.id, bobs.id].sort());
    const inside = await w.repo.commit(base, { "lib/c.ts": "4\n" });
    await w.coordinator.integrate(w.alice, "app", mine.id, { fence: mine.fence, base, commit: inside });
    assert.equal(await w.repo.head(), inside);
    assert.deepEqual(held(w).map((claim) => claim.id), [bobs.id]);
  });

  test("a shallow file in the repository only hides history, and a change it hides is refused", async () => {
    const w = await world();
    const mine = await claimed(w, w.alice, "lib", ["lib"]);
    const bobs = await claimed(w, w.bob, "bob", ["src/a.ts"]);
    const { base, bare } = w.repo;
    const change = await w.repo.commit(base, { "lib/c.ts": "1\n" });
    // A change to bob's file in a middle commit, undone by the last one.
    const middle = await w.repo.commit(base, { "src/a.ts": "alice\n" });
    const last = await w.repo.commit(middle, { "lib/c.ts": "2\n", "src/a.ts": "a\n" });
    const side = await w.repo.commit(base, { "src/a.ts": "side\n" });
    const merge = await w.repo.merge(await w.repo.commit(base, { "lib/c.ts": "3\n" }), side);
    const outside = await w.repo.commit(base, { "src/a.ts": "alice\n" });
    const inside = await w.repo.commit(base, { "lib/c.ts": "4\n" });
    // Writing the shallow file takes write access to the repository directory; a push cannot.
    const integrate = async (commit: string, ...shallow: string[]) => {
      await writeFile(path.join(bare, "shallow"), shallow.map((sha) => `${sha}\n`).join(""));
      return await refusal(() => w.coordinator.integrate(w.alice, "app", mine.id, { fence: mine.fence, base, commit }));
    };
    assert.deepEqual(await integrate(change, change), { status: 409, reason: "notFastForward" });
    assert.deepEqual(await integrate(last, middle), { status: 409, reason: "notFastForward" });
    assert.deepEqual(await integrate(merge, side), { status: 409, reason: "mergeCommit" });
    assert.deepEqual(await integrate(merge, merge), { status: 409, reason: "notFastForward" });
    assert.deepEqual(await integrate(outside, base), { status: 403, reason: "outOfScope" });
    // Nothing moved and bob still holds his file; with the base shallow, a change as it is integrates.
    assert.equal(await w.repo.head(), base);
    assert.deepEqual(held(w).map((claim) => claim.id).sort(), [mine.id, bobs.id].sort());
    await w.coordinator.integrate(w.alice, "app", mine.id, { fence: mine.fence, base, commit: inside });
    assert.equal(await w.repo.head(), inside);
    assert.deepEqual(held(w).map((claim) => claim.id), [bobs.id]);
  });

  test("refuses secrets, links, submodules and names it cannot read exactly, in any commit, before the branch moves", async () => {
    const w = await world();
    const mine = await claimed(w, w.alice, "lib", ["lib"]);
    const bobs = await claimed(w, w.bob, "bob", ["src/a.ts"]);
    const { base } = w.repo;
    const secret = await w.repo.commit(base, { "lib/.env": "TOKEN=1\n" });
    const manual = (path: string, kind: string) => ({ status: 403, reason: "needsManualHandling", path, kind });
    for (const [commit, expected] of [
      [await w.repo.commit(base, { "\nlib/x.ts": "x\n" }), { status: 400, reason: "unreliablePath" }],
      [await w.repo.commit(base, { "lib/\u0007x.ts": "x\n" }), { status: 400, reason: "unreliablePath" }],
      [secret, manual("lib/.env", "sensitive")],
      [await w.repo.commit(base, { "lib/deploy.pem": "key\n" }), manual("lib/deploy.pem", "sensitive")],
      [await w.repo.commit(base, { "lib/NODE_MODULES/x.js": "x\n" }), manual("lib/NODE_MODULES/x.js", "sensitive")],
      [await w.repo.commit(base, {}, { links: { "lib/into-bobs-file": "../src/a.ts" } }), manual("lib/into-bobs-file", "symlink")],
      [await w.repo.commit(base, {}, { links: { "lib/abs-link": "/etc/passwd" } }), manual("lib/abs-link", "symlink")],
      [await w.repo.commit(base, { "lib/c.ts": null }, { links: { "lib/c.ts": "../src/a.ts" } }), manual("lib/c.ts", "symlink")],
      [await w.repo.commit(base, {}, { submodules: { "lib/sub": base } }), manual("lib/sub", "submodule")],
      // Added in one commit and removed in the next: the branch would still carry it.
      [await w.repo.commit(secret, { "lib/.env": null, "lib/c.ts": "1\n" }), manual("lib/.env", "sensitive")],
      [await w.repo.commit(base, {}, { renames: [["lib/c.ts", "lib/key.pem"]] }), manual("lib/key.pem", "sensitive")],
      [await w.repo.commit(base, {}, { renames: [["src/a.ts", "lib/a.ts"]] }), { status: 403, reason: "outOfScope", path: "src/a.ts" }],
    ] as const) {
      const error = await w.coordinator
        .integrate(w.alice, "app", mine.id, { fence: mine.fence, base, commit })
        .then(() => assert.fail("integrated"), (thrown: AppError) => thrown);
      const { reason, path, kind } = error.details ?? {};
      assert.deepEqual(
        { status: error.statusCode, reason, ...(path === undefined ? {} : { path }), ...(kind === undefined ? {} : { kind }) },
        expected,
      );
    }
    assert.equal(await w.repo.head(), base);
    assert.deepEqual(held(w).map((claim) => claim.id), [mine.id, bobs.id]);
  });

  test("integrates regular files exactly as named, executable and example files included", async () => {
    const w = await world();
    const mine = await claimed(w, w.alice, "lib", ["lib"]);
    const change = await w.repo.commit(
      w.repo.base,
      { "lib/c.ts": "1\n", "lib/.env.example": "TOKEN=\n", "lib/run.sh": "#!/bin/sh\n", "lib/說明 notes.md": "x\n" },
      { executable: ["lib/run.sh"] },
    );
    const done = await w.coordinator.integrate(w.alice, "app", mine.id, { fence: mine.fence, base: w.repo.base, commit: change });
    assert.equal(done.branch.sha, change);
    assert.equal(await w.repo.head(), change);
  });

  test("of two integrations onto the same base, exactly one moves the branch; the other syncs and retries", async () => {
    const w = await world();
    const mine = await claimed(w, w.alice, "one", ["src"]);
    const theirs = await claimed(w, w.bob, "two", ["lib"]);
    const a = await w.repo.commit(w.repo.base, { "src/a.ts": "alice\n" });
    const b = await w.repo.commit(w.repo.base, { "lib/c.ts": "bob\n" });
    const outcomes = await Promise.allSettled([
      w.coordinator.integrate(w.alice, "app", mine.id, { fence: mine.fence, base: w.repo.base, commit: a }),
      w.coordinator.integrate(w.bob, "app", theirs.id, { fence: theirs.fence, base: w.repo.base, commit: b }),
    ]);
    const won = outcomes.findIndex((outcome) => outcome.status === "fulfilled");
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    const lost = outcomes[1 - won] as PromiseRejectedResult;
    const winner = [a, b][won];
    assert.deepEqual(
      [lost.reason.details.reason, lost.reason.details.current],
      ["staleBase", winner],
    );
    assert.equal(await w.repo.head(), winner);
    // The loser rebuilds its change on the new branch head and integrates.
    const [loser, claim, files] =
      won === 0 ? [w.bob, theirs, { "lib/c.ts": "bob\n" }] : [w.alice, mine, { "src/a.ts": "alice\n" }];
    const synced = await w.repo.commit(winner, files);
    await w.coordinator.integrate(loser, "app", claim.id, { fence: claim.fence, base: winner, commit: synced });
    assert.equal(await w.repo.head(), synced);
  });

  test("refuses changes that are not a short linear series on the base", async () => {
    const w = await world();
    const mine = await claimed(w, w.alice, "one", ["src"]);
    const change = await w.repo.commit(w.repo.base, { "src/a.ts": "1\n" });
    const elsewhere = await w.repo.commit(change, { "src/b.ts": "2\n" });
    const side = await w.repo.commit(w.repo.base, { "src/b.ts": "3\n" });
    const merged = await w.repo.merge(change, side);
    const integrate = (base: string, commit: string) =>
      refusal(() => w.coordinator.integrate(w.alice, "app", mine.id, { fence: mine.fence, base, commit }));
    assert.deepEqual(await integrate(w.repo.base, "HEAD"), { status: 400, reason: "invalidCommit" });
    assert.deepEqual(await integrate(w.repo.base, "f".repeat(40)), { status: 409, reason: "unknownCommit" });
    assert.deepEqual(await integrate(w.repo.base, w.repo.base), { status: 400, reason: "empty" });
    assert.deepEqual(await integrate(change, elsewhere), { status: 409, reason: "staleBase" });
    assert.deepEqual(await integrate(w.repo.base, merged), { status: 409, reason: "mergeCommit" });
    await w.repo.move(side);
    await w.coordinator.adoptBaseline(w.admin, "app", { sha: side });
    assert.deepEqual(await integrate(side, change), { status: 409, reason: "notFastForward" });
    assert.equal(await w.repo.head(), side);
  });

  test("a branch moved around coordination stops integration until an admin adopts it", async () => {
    const w = await world();
    const mine = await claimed(w, w.alice, "one", ["src"]);
    const pushed = await w.repo.commit(w.repo.base, { "README.md": "pushed directly\n" });
    await w.repo.move(pushed);
    const change = await w.repo.commit(pushed, { "src/a.ts": "1\n" });
    const integrate = () =>
      w.coordinator.integrate(w.alice, "app", mine.id, { fence: mine.fence, base: pushed, commit: change });
    assert.deepEqual(await refusal(integrate), { status: 409, reason: "baselineMoved" });
    assert.deepEqual(await refusal(() => w.coordinator.adoptBaseline(w.alice, "app", { sha: pushed })), {
      status: 403,
      reason: "adminOnly",
    });
    assert.deepEqual(
      await refusal(() => w.coordinator.adoptBaseline(w.admin, "app", { sha: w.repo.base })),
      { status: 409, reason: "staleBase" },
    );
    await w.coordinator.adoptBaseline(w.admin, "app", { sha: pushed });
    await integrate();
    assert.equal(await w.repo.head(), change);
  });

  test("a branch moved between the checks and the swap is never overwritten", async () => {
    const w = await world({
      onStep: async (step) => {
        if (step === "intent-saved") await w.repo.move(pushed);
      },
    });
    const mine = await claimed(w, w.alice, "one", ["src"]);
    const change = await w.repo.commit(w.repo.base, { "src/a.ts": "1\n" });
    const pushed = await w.repo.commit(w.repo.base, { "README.md": "pushed meanwhile\n" });
    const error = await w.coordinator
      .integrate(w.alice, "app", mine.id, { fence: mine.fence, base: w.repo.base, commit: change })
      .then(() => assert.fail("integrated"), (thrown: AppError) => thrown);
    assert.deepEqual([error.statusCode, error.details?.reason, error.details?.current], [409, "staleBase", pushed]);
    assert.equal(await w.repo.head(), pushed);
    const project = w.coordinator.project(w.alice, "app");
    assert.deepEqual([project.branch.sha, project.claims[0].status], [w.repo.base, "held"]);
    assert.equal((await w.onDisk()).projects[0].pending, undefined);
  });

  test("an integration stopped before the branch moved settles as not done on reopen", async () => {
    let crash = true;
    const w = await world({
      onStep: (step) => {
        if (crash && step === "intent-saved") throw new Error("process died");
      },
    });
    const mine = await claimed(w, w.alice, "one", ["src"]);
    const change = await w.repo.commit(w.repo.base, { "src/a.ts": "1\n" });
    const integrate = () =>
      w.coordinator.integrate(w.alice, "app", mine.id, { fence: mine.fence, base: w.repo.base, commit: change });
    assert.deepEqual(await refusal(integrate), { status: 503, reason: "unavailable" });
    assert.ok((await w.onDisk()).projects[0].pending);
    assert.equal(await w.repo.head(), w.repo.base);
    crash = false;
    await w.reopen();
    assert.equal((await w.onDisk()).projects[0].pending, undefined);
    assert.deepEqual(held(w).map((claim) => claim.id), [mine.id]);
    await integrate();
    assert.equal(await w.repo.head(), change);
  });

  test("an integration that loses the lock once its intent is saved leaves the branch, and reopening settles it", async () => {
    let lose = true;
    let file = "";
    let mine = "";
    const w = await world({
      onStep: async (step) => {
        // Another start's lock lies there now, as after a person removed this one.
        if (lose && step === "intent-saved")
          await writeFile(file, JSON.stringify({ ...JSON.parse(mine), pid: process.pid + 1 }));
      },
    });
    file = dataPaths(w.dataDir).lock;
    mine = await readFile(file, "utf8");
    const claim = await claimed(w, w.alice, "one", ["src"]);
    const change = await w.repo.commit(w.repo.base, { "src/a.ts": "1\n" });
    const integrate = () =>
      w.coordinator.integrate(w.alice, "app", claim.id, { fence: claim.fence, base: w.repo.base, commit: change });
    assert.deepEqual(await refusal(integrate), { status: 503, reason: "notSingleWriter" });
    assert.equal(await w.repo.head(), w.repo.base);
    assert.ok((await w.onDisk()).projects[0].pending);
    assert.equal((await refusal(integrate)).reason, "notSingleWriter");
    // Once the lock is this process's again, reopening finds the branch unmoved.
    lose = false;
    await writeFile(file, mine);
    await w.reopen();
    assert.equal((await w.onDisk()).projects[0].pending, undefined);
    assert.deepEqual(held(w).map((each) => each.id), [claim.id]);
    await integrate();
    assert.equal(await w.repo.head(), change);
  });

  test("an integration whose outcome failed to save after the branch moved settles as done on reopen", async () => {
    let writes = 0;
    let failAt = Infinity;
    const w = await world({
      write: (file, data, opts) => {
        writes += 1;
        return writes === failAt ? Promise.reject(new Error("disk full")) : writeDurable(file, data, opts);
      },
    });
    const mine = await claimed(w, w.alice, "one", ["src"]);
    const change = await w.repo.commit(w.repo.base, { "src/a.ts": "1\n" });
    // The intent is the next write and the outcome the one after it.
    failAt = writes + 2;
    assert.deepEqual(
      await refusal(() =>
        w.coordinator.integrate(w.alice, "app", mine.id, { fence: mine.fence, base: w.repo.base, commit: change }),
      ),
      { status: 503, reason: "unavailable" },
    );
    assert.equal(await w.repo.head(), change);
    await w.reopen();
    const project = w.coordinator.project(w.alice, "app");
    assert.deepEqual(
      [project.branch.sha, project.tasks[0].status, project.claims[0].status],
      [change, "integrated", "integrated"],
    );
  });

  test("an interrupted integration the branch cannot settle keeps coordination stopped", async () => {
    const w = await world({
      onStep: (step) => {
        if (step === "intent-saved") throw new Error("process died");
      },
    });
    const mine = await claimed(w, w.alice, "one", ["src"]);
    const change = await w.repo.commit(w.repo.base, { "src/a.ts": "1\n" });
    const other = await w.repo.commit(w.repo.base, { "src/b.ts": "2\n" });
    await refusal(() =>
      w.coordinator.integrate(w.alice, "app", mine.id, { fence: mine.fence, base: w.repo.base, commit: change }),
    );
    await w.repo.move(other);
    assert.deepEqual(await refusal(() => w.reopen({ onStep: undefined })), {
      status: 503,
      reason: "recoveryUndecided",
    });
    await w.repo.move(w.repo.base);
    await w.reopen({ onStep: undefined });
    assert.deepEqual(held(w).map((claim) => claim.id), [mine.id]);
  });

  test("a stale fence or another participant cannot integrate a held claim", async () => {
    const w = await world();
    const mine = await claimed(w, w.alice, "one", ["src"]);
    const change = await w.repo.commit(w.repo.base, { "src/a.ts": "1\n" });
    assert.deepEqual(
      await refusal(() =>
        w.coordinator.integrate(w.bob, "app", mine.id, { fence: mine.fence, base: w.repo.base, commit: change }),
      ),
      { status: 403, reason: "notHolder" },
    );
    assert.deepEqual(
      await refusal(() =>
        w.coordinator.integrate(w.alice, "app", mine.id, { fence: mine.fence + 1, base: w.repo.base, commit: change }),
      ),
      { status: 409, reason: "staleFence" },
    );
    assert.equal(await w.repo.head(), w.repo.base);
  });
});

describe("changedFiles", () => {
  const [a, b] = ["a".repeat(40), "b".repeat(40)];
  const record = (status: string, modes = "100644 100644") =>
    `:${modes} ${"1".repeat(40)} ${"2".repeat(40)} ${status}`;

  test("reads every path exactly as Git stores it, control characters included", () => {
    assert.deepEqual(
      changedFiles(`${a}\0${record("M")}\0\nlib/x.ts\0${b}\0${record("A", "000000 120000")}\0lib/l\0`, [a, b]),
      [
        { path: "\nlib/x.ts", modes: ["100644", "100644"] },
        { path: "lib/l", modes: ["000000", "120000"] },
      ],
    );
    assert.deepEqual(changedFiles(`${a}\0${b}\0`, [a, b]), []);
  });

  test("output in any other shape is refused, never guessed at", () => {
    for (const output of [
      "",
      `${a}\0${record("M")}\0lib/x.ts\0${b}`,
      `${a}\0${b}\0${record("M")}\0`,
      `${a}\0`,
      `${b}\0${a}\0`,
      `${record("M")}\0lib/x.ts\0${a}\0${b}\0`,
      `${a}\0${record("R100")}\0lib/x.ts\0lib/y.ts\0${b}\0`,
      `${a}\0${record("M")}\nlib/x.ts\0${b}\0`,
      `${a} ${b}\n`,
    ])
      assert.equal(changedFiles(output, [a, b]), undefined, JSON.stringify(output));
  });
});

describe("capacity", () => {
  const file = (w: World) => dataPaths(w.dataDir).coordination;
  const bytesOnDisk = async (w: World) => (await readFile(file(w))).length;
  /** Longer than any reason kept, of characters JSON writes in six bytes each. */
  const longestReason = "\u0001".repeat(600);

  /** What a refused change must leave as it was: the file, the answers and the branch. */
  async function snapshot(w: World) {
    return {
      file: await readFile(file(w), "utf8"),
      project: w.coordinator.project(w.admin, "app"),
      head: await w.repo.head(),
    };
  }

  async function details(action: () => unknown) {
    try {
      await action();
    } catch (error) {
      if (error instanceof AppError) return error.details;
      throw error;
    }
    return assert.fail("expected a refusal");
  }

  /** Every ended claim's fence still authorises nothing. */
  function assertEnded(w: World, claims: ClaimView[]) {
    for (const claim of claims)
      assert.throws(
        () => w.coordinator.authorize(claim.holder === "bob" ? w.bob : w.alice, "app", {
          claimId: claim.id,
          fence: claim.fence,
          paths: [],
        }),
        (error: AppError) => error.details?.reason === "ended",
      );
  }

  test("repeated claim and release up to the claim limit: the next claim changes nothing, held claims still settle", async () => {
    const limits = { claims: 6 };
    const w = await world({ limits });
    for (const id of ["a", "b", "loop"]) await w.coordinator.defineTask(w.alice, "app", { id });
    const mine = await w.coordinator.claim(w.alice, "app", { taskId: "a", scopes: ["src"] });
    const theirs = await w.coordinator.claim(w.bob, "app", { taskId: "b", scopes: ["lib"] });
    const ended: ClaimView[] = [];
    for (let round = 0; round < 4; round += 1) {
      const claim = await w.coordinator.claim(w.alice, "app", { taskId: "loop", scopes: ["docs"] });
      ended.push(await w.coordinator.release(w.alice, "app", claim.id, { fence: claim.fence }));
    }
    const before = await snapshot(w);
    assert.deepEqual(
      await details(() => w.coordinator.claim(w.alice, "app", { taskId: "loop", scopes: ["docs"] })),
      { reason: "full", limit: "claims", max: 6 },
    );
    assert.deepEqual(await snapshot(w), before);
    assertEnded(w, ended);

    // Held claims are still managed: widened, released and integrated.
    await w.coordinator.expand(w.alice, "app", mine.id, { fence: mine.fence, scopes: ["README.md"] });
    ended.push(await w.coordinator.release(w.bob, "app", theirs.id, { fence: theirs.fence }));
    const change = await w.repo.commit(w.repo.base, { "src/a.ts": "1\n", "README.md": "2\n" });
    const done = await w.coordinator.integrate(w.alice, "app", mine.id, {
      fence: mine.fence,
      base: w.repo.base,
      commit: change,
    });
    assert.equal(await w.repo.head(), change);
    ended.push(done.claim);

    await w.reopen({ limits });
    assert.equal(w.coordinator.project(w.alice, "app").fence, 6);
    assertEnded(w, ended);
    assert.deepEqual(
      await refusal(() => w.coordinator.claim(w.alice, "app", { taskId: "loop", scopes: ["docs"] })),
      { status: 409, reason: "full" },
    );
    // A file with more claims than a build allows still opens there.
    await w.reopen({ limits: { claims: 2 } });
    assertEnded(w, ended);
  });

  test("at the byte limit the next claim changes nothing, and every held claim still ends in its longest way", async () => {
    const w = await world();
    for (let task = 0; task < 30; task += 1)
      await w.coordinator.defineTask(w.alice, "app", { id: `t${task}` });
    const limits = { bytes: (await bytesOnDisk(w)) + 30_000 };
    let crash = false;
    const onStep = (step: string) => {
      if (crash && step === "ref-updated") throw new Error("process died");
    };
    await w.reopen({ limits, onStep });

    const holding: ClaimView[] = [];
    const ended: ClaimView[] = [];
    for (let task = 0; ; task += 1) {
      assert.ok(task < 30, "the byte limit was never reached");
      const actor = task % 2 ? w.bob : w.alice;
      const before = await snapshot(w);
      const attempt = await w.coordinator
        .claim(actor, "app", { taskId: `t${task}`, scopes: [`docs/${task}`] })
        .catch((error: unknown) => error);
      if (attempt instanceof AppError) {
        assert.deepEqual(attempt.details, { reason: "full", limit: "bytes", max: limits.bytes });
        assert.deepEqual(await snapshot(w), before);
        // The other participant, on another task, is refused the same way.
        const other = await w.coordinator
          .claim(actor === w.bob ? w.alice : w.bob, "app", { taskId: `t${task + 1}`, scopes: [`docs/${task + 1}`] })
          .catch((error: unknown) => error);
        assert.ok(other instanceof AppError, "the other participant's claim was granted");
        assert.deepEqual([other.statusCode, other.details], [409, { reason: "full", limit: "bytes", max: limits.bytes }]);
        assert.deepEqual(await snapshot(w), before);
        break;
      }
      const claim = attempt as ClaimView;
      // Every third claim is given straight back, so claims and releases repeat up to the limit.
      if (task % 3 === 2) ended.push(await w.coordinator.release(actor, "app", claim.id, { fence: claim.fence }));
      else holding.push(claim);
    }
    assert.ok(holding.length >= 3);
    assert.ok((await bytesOnDisk(w)) <= limits.bytes);

    // The first held claim integrates, and the process dies right after the branch moved.
    const [first, second, ...rest] = holding;
    const change = await w.repo.commit(w.repo.base, { [`docs/0/new.md`]: "1\n" });
    crash = true;
    assert.deepEqual(
      await refusal(() =>
        w.coordinator.integrate(w.alice, "app", first.id, { fence: first.fence, base: w.repo.base, commit: change }),
      ),
      { status: 503, reason: "unavailable" },
    );
    crash = false;
    assert.equal(await w.repo.head(), change);
    await w.reopen({ limits, onStep });
    assert.equal(w.coordinator.project(w.alice, "app").claims.find((claim) => claim.id === first.id)?.status, "integrated");
    assert.ok((await bytesOnDisk(w)) <= limits.bytes);
    ended.push(first);

    // Its holder fails the next one, and an admin revokes the rest, each with the longest reason.
    await w.coordinator.failTask(w.bob, "app", second.taskId, { reason: longestReason });
    ended.push(second);
    assert.ok((await bytesOnDisk(w)) <= limits.bytes);
    for (const claim of rest) {
      const revoked = await w.coordinator.revoke(w.admin, "app", claim.id, { reason: longestReason });
      assert.equal(revoked.reason?.length, 500);
      assert.ok((await bytesOnDisk(w)) <= limits.bytes);
      ended.push(claim);
    }
    // Every task left open fails too.
    for (const task of w.coordinator.project(w.admin, "app").tasks)
      if (task.status === "open") {
        await w.coordinator.failTask(w.admin, "app", task.id, { reason: longestReason });
        assert.ok((await bytesOnDisk(w)) <= limits.bytes);
      }

    await w.reopen({ limits, onStep });
    assert.equal(held(w).length, 0);
    assertEnded(w, ended);
    assert.equal(w.coordinator.project(w.admin, "app").branch.sha, change);
  });

  test("participants, projects and per-project tasks stop at their limits before anything changes", async () => {
    const limits = { participants: 4, projects: 2, tasks: 2 };
    const w = await world({ limits });
    await w.coordinator.addParticipant("carol", "member");
    await w.coordinator.defineProject("site", w.repo.bare, "main");
    await w.repo.move(w.repo.base, "third");
    await w.coordinator.defineTask(w.alice, "app", { id: "one" });
    await w.coordinator.defineTask(w.alice, "app", { id: "two" });
    const before = await snapshot(w);
    assert.deepEqual(await details(() => w.coordinator.addParticipant("dave", "member")), {
      reason: "full",
      limit: "participants",
      max: 4,
    });
    assert.deepEqual(await details(() => w.coordinator.defineProject("third", w.repo.bare, "third")), {
      reason: "full",
      limit: "projects",
      max: 2,
    });
    assert.deepEqual(await details(() => w.coordinator.defineTask(w.alice, "app", { id: "three" })), {
      reason: "full",
      limit: "tasks",
      max: 2,
    });
    assert.deepEqual(await snapshot(w), before);
    // The task limit is per project.
    await w.coordinator.defineTask(w.alice, "site", { id: "three" });
    await w.reopen({ limits });
    assert.deepEqual(
      w.coordinator.project(w.alice, "app").tasks.map((task) => task.id),
      ["one", "two"],
    );
  });

  test("held claims and scopes stop at their limits per project and per participant; ending them never does", async () => {
    const limits = { heldClaims: 3, heldScopes: 5, participantHeldClaims: 2, participantHeldScopes: 4 };
    const w = await world({ limits });
    await w.coordinator.defineProject("site", w.repo.bare, "main");
    for (const id of ["a", "b", "c", "d", "e"]) await w.coordinator.defineTask(w.alice, "app", { id });
    await w.coordinator.defineTask(w.alice, "site", { id: "s" });
    const claim = (actor: Actor, project: string, taskId: string, scopes: string[]) =>
      w.coordinator.claim(actor, project, { taskId, scopes });
    const refused = async (action: () => unknown, limit: string, max: number) => {
      const before = await snapshot(w);
      assert.deepEqual(await details(action), { reason: "full", limit, max });
      assert.deepEqual(await snapshot(w), before);
    };
    const first = await claim(w.alice, "app", "a", ["src"]);
    const second = await claim(w.alice, "app", "b", ["lib", "docs"]);
    // Alice's limits count her claims in every project.
    await refused(() => claim(w.alice, "site", "s", ["x"]), "participantHeldClaims", 2);
    await refused(
      () => w.coordinator.expand(w.alice, "app", second.id, { fence: second.fence, scopes: ["x", "y"] }),
      "participantHeldScopes",
      4,
    );
    const third = await claim(w.bob, "app", "c", ["web"]);
    await refused(() => claim(w.bob, "app", "d", ["x"]), "heldClaims", 3);
    await refused(
      () => w.coordinator.expand(w.bob, "app", third.id, { fence: third.fence, scopes: ["x", "y"] }),
      "heldScopes",
      5,
    );

    // A build with lower limits opens the file and still ends every claim.
    await w.reopen({ limits: { heldClaims: 1, heldScopes: 1, participantHeldClaims: 1, participantHeldScopes: 1 } });
    assert.deepEqual(await refusal(() => claim(w.bob, "app", "d", ["x"])), { status: 409, reason: "full" });
    await w.coordinator.release(w.alice, "app", first.id, { fence: first.fence });
    const change = await w.repo.commit(w.repo.base, { "lib/c.ts": "1\n" });
    await w.coordinator.integrate(w.alice, "app", second.id, { fence: second.fence, base: w.repo.base, commit: change });
    await w.coordinator.revoke(w.admin, "app", third.id, {});
    assert.deepEqual(held(w), []);
    await claim(w.bob, "app", "d", ["x"]);
  });

  test("the most scopes, dependencies and the longest reason this build writes read back", async () => {
    const w = await world();
    const dependsOn: string[] = [];
    for (let task = 0; task < 50; task += 1) {
      await w.coordinator.defineTask(w.admin, "app", { id: `d${task}` });
      dependsOn.push(`d${task}`);
    }
    await w.coordinator.defineTask(w.admin, "app", { id: "late", dependsOn });
    assert.deepEqual(
      await refusal(() =>
        w.coordinator.defineTask(w.admin, "app", { id: "later", dependsOn: [...dependsOn, "late"] }),
      ),
      { status: 400, reason: "tooManyDependencies" },
    );
    await w.coordinator.defineTask(w.alice, "app", { id: "wide" });
    const scopes = Array.from({ length: 200 }, (_, index) => `wide/${"x".repeat(1000)}/${index}`);
    scopes[0] = `w${"y".repeat(1023)}`;
    const mine = await w.coordinator.claim(w.alice, "app", { taskId: "wide", scopes });
    assert.deepEqual(
      await refusal(() =>
        w.coordinator.expand(w.alice, "app", mine.id, { fence: mine.fence, scopes: ["src"] }),
      ),
      { status: 400, reason: "tooManyScopes" },
    );
    await w.coordinator.revoke(w.admin, "app", mine.id, { reason: longestReason });
    await w.reopen();
    const project = w.coordinator.project(w.admin, "app");
    assert.equal(project.tasks.find((task) => task.id === "late")?.dependsOn.length, 50);
    const claim = project.claims.find((candidate) => candidate.id === mine.id);
    assert.deepEqual([claim?.scopes.length, claim?.scopes[0].length, claim?.reason], [200, 1024, longestReason.slice(0, 500)]);
  });

  test("a file over this build's byte limit opens and settles; one past what the reader takes is refused", async () => {
    const w = await world();
    for (let task = 0; task < 10; task += 1)
      await w.coordinator.defineTask(w.alice, "app", { id: `t${task}` });
    const mine = await w.coordinator.claim(w.alice, "app", { taskId: "t0", scopes: ["src"] });
    // As if a build with a higher limit wrote it.
    const limits = { bytes: Math.floor((await bytesOnDisk(w)) * 0.8) };
    await w.reopen({ limits });
    const before = await snapshot(w);
    assert.deepEqual(
      await details(() => w.coordinator.claim(w.alice, "app", { taskId: "t1", scopes: ["lib"] })),
      { reason: "full", limit: "bytes", max: limits.bytes },
    );
    assert.deepEqual(await snapshot(w), before);
    await w.coordinator.revoke(w.admin, "app", mine.id, { reason: longestReason });
    await w.reopen({ limits });
    assert.equal(held(w).length, 0);

    const size = await bytesOnDisk(w);
    assert.deepEqual(await refusal(() => w.reopen({ limits: { bytes: Math.floor(size / 4) - 1 } })), {
      status: 503,
      reason: "damaged",
    });
    await w.reopen();
  });

  test("under the default limits a file past 8 MiB opens and takes nothing new, and one past 32 MiB does not open", async () => {
    const w = await world();
    await w.coordinator.defineTask(w.alice, "app", { id: "one" });
    const mine = await w.coordinator.claim(w.alice, "app", { taskId: "one", scopes: ["src"] });
    assert.equal(coordinationLimits.bytes, 8 * 1024 * 1024);
    // A key a newer build added, long enough to bring the file to `bytes`.
    const grow = async (bytes: number) => {
      const state = await w.onDisk();
      const text = `${JSON.stringify({ ...state, later: "" }, null, 2)}\n`;
      await writeFile(file(w), `${JSON.stringify({ ...state, later: "x".repeat(bytes - Buffer.byteLength(text)) }, null, 2)}\n`);
      assert.equal(await bytesOnDisk(w), bytes);
    };
    await grow(8 * 1024 * 1024 + 1);
    await w.reopen();
    const before = await snapshot(w);
    assert.deepEqual(
      await details(() => w.coordinator.defineTask(w.bob, "app", { id: "two" })),
      { reason: "full", limit: "bytes", max: 8 * 1024 * 1024 },
    );
    assert.deepEqual(await snapshot(w), before);
    await w.coordinator.release(w.alice, "app", mine.id, { fence: mine.fence });
    await w.reopen();
    assert.equal(held(w).length, 0);
    await grow(32 * 1024 * 1024);
    await w.reopen();
    await grow(32 * 1024 * 1024 + 1);
    assert.deepEqual(await refusal(() => w.reopen()), { status: 503, reason: "damaged" });
  });

  test("an integration whose intent the reader could not read back never moves the branch", async () => {
    const w = await world();
    await w.coordinator.defineTask(w.alice, "app", { id: "one" });
    const mine = await w.coordinator.claim(w.alice, "app", { taskId: "one", scopes: ["src"] });
    const change = await w.repo.commit(w.repo.base, { "src/a.ts": "1\n" });
    // The reader takes four times the limit: just enough for the file as it is, not for an intent.
    await w.reopen({ limits: { bytes: Math.ceil((await bytesOnDisk(w)) / 4) } });
    const before = await snapshot(w);
    const integrate = () =>
      w.coordinator.integrate(w.alice, "app", mine.id, { fence: mine.fence, base: w.repo.base, commit: change });
    assert.deepEqual(await refusal(integrate), { status: 500, reason: "inconsistent" });
    assert.deepEqual(await snapshot(w), before);
    // Nothing stopped: the claim still authorises, and under the usual limits it integrates.
    w.coordinator.authorize(w.alice, "app", { claimId: mine.id, fence: mine.fence, paths: ["src/a.ts"] });
    await w.reopen();
    await integrate();
    assert.equal(await w.repo.head(), change);
  });
});
