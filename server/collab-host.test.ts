/** Group work's host (collab-host.ts): its states, the side file, and work in flight. */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { openCollabHost, type CollabHost } from "./collab-host.js";
import { dataPaths } from "./config.js";
import { acquireWriterLock, readLock } from "./index.js";
import { log } from "./log.js";
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

/** Both files' text, undefined for one that is not there. */
const bytes = (files: { side: string; core: string }) =>
  Promise.all([files.side, files.core].map((file) => readFile(file, "utf8").catch(() => undefined)));

/** A data directory under the strict lock, and a host on it that can be started again. */
async function world() {
  const root = await mkdtemp(path.join(os.tmpdir(), "bellpr-collab-host-"));
  roots.push(root);
  const dataDir = path.join(root, "data");
  await mkdir(dataDir);
  const paths = dataPaths(dataDir);
  const result = {
    dataDir,
    files: { side: paths.collab, core: paths.coordination },
    lock: undefined as unknown as WriterLock,
    host: undefined as unknown as CollabHost,
    /** As a restart of BELL PR: the lock goes, comes back, and both files are read again. */
    async restart() {
      result.lock?.release();
      result.lock = await acquireWriterLock(dataDir);
      locks.push(result.lock);
      result.host = await openCollabHost({ dataDir, lock: result.lock });
      return result.host;
    },
    /** Stops, lets `change` edit the files, and starts again. */
    async restartAfter(change: () => Promise<unknown>) {
      result.lock.release();
      await change();
      return result.restart();
    },
  };
  await result.restart();
  return result;
}

/** A world whose group is set up, with one member. */
async function group() {
  const w = await world();
  await w.host.setUp();
  const ben = await w.host.coordinator().addParticipant("m-0000000001", "member");
  await w.host.saveSide((draft) => {
    draft.people = { [ben.id]: { name: "Ben", joinedAt: "2026-01-01T00:00:00.000Z" } };
  });
  return { w, ben };
}

test("not set up, then set up once, and a restart keeps the group", async (t) => {
  t.mock.method(log, "warn", () => {});
  const w = await world();
  assert.deepEqual(w.host.status(), { state: "notSetUp" });
  assert.deepEqual(await refusal(() => w.host.coordinator()), { status: 503, reason: "notSetUp" });
  assert.deepEqual(await refusal(() => w.host.saveSide(() => {})), {
    status: 503,
    reason: "notSetUp",
  });
  // Opening and asking wrote nothing.
  assert.equal(existsSync(w.files.side), false);
  assert.equal(existsSync(w.files.core), false);

  await w.host.setUp();
  assert.deepEqual(w.host.status(), { state: "ready" });
  const { groupId, setUpAt } = w.host.side();
  assert.match(groupId!, /^g-[0-9a-f]{16}$/);
  assert.ok(Date.parse(setUpAt!));
  assert.equal(existsSync(w.files.core), true);
  assert.deepEqual(await refusal(() => w.host.setUp()), { status: 409, reason: "exists" });

  const ben = await w.host.coordinator().addParticipant("m-0000000001", "member");
  await w.host.saveSide((draft) => {
    draft.people = { [ben.id]: { name: "Ben" } };
  });
  const again = await w.restart();
  assert.deepEqual(again.status(), { state: "ready" });
  assert.deepEqual(again.side(), { groupId, setUpAt, people: { [ben.id]: { name: "Ben" } } });
  assert.deepEqual(again.coordinator().authenticate(ben.token), { id: ben.id, role: "member" });
});

test("a group whose files are gone or damaged stays stopped, and nothing is made again", async (t) => {
  const warned = t.mock.method(log, "warn", () => {});
  const cases: [string, (files: { side: string; core: string }) => Promise<unknown>, string][] = [
    ["the coordination file is gone", (files) => rm(files.core), "missing"],
    ["the coordination file is damaged", (files) => writeFile(files.core, "{"), "damaged"],
    ["the side file is damaged", (files) => writeFile(files.side, "{"), "sideDamaged"],
    ["the side file is gone", (files) => rm(files.side), "sideMissing"],
    [
      "the side file names no group",
      (files) => writeFile(files.side, JSON.stringify({ setUpAt: "2026-01-01T00:00:00.000Z" })),
      "sideDamaged",
    ],
  ];
  for (const [name, damage, reason] of cases) {
    const { w, ben } = await group();
    let before: (string | undefined)[] = [];
    const host = await w.restartAfter(async () => {
      await damage(w.files);
      before = await bytes(w.files);
    });
    assert.deepEqual(host.status(), { state: "stopped", reason }, name);
    assert.deepEqual(await refusal(() => host.coordinator()), { status: 503, reason: "stopped" });
    assert.deepEqual(await refusal(() => host.setUp()), { status: 409, reason: "missing" }, name);
    assert.deepEqual(
      await refusal(() =>
        host.saveSide((draft) => {
          draft.people = { [ben.id]: { name: "Changed" } };
        }),
      ),
      { status: 503, reason: "stopped" },
      name,
    );
    // Still stopped after another restart: only a person's repair ends it.
    assert.deepEqual((await w.restart()).status(), { state: "stopped", reason }, name);
    assert.deepEqual(await bytes(w.files), before, name);
  }
  assert.equal(
    warned.mock.calls.every(({ arguments: [message] }) => message === "Group work stopped"),
    true,
  );
});

test("a coordinator that breaks while BELL PR runs stops group work for good", async (t) => {
  t.mock.method(log, "warn", () => {});
  const { w } = await group();
  const core = w.host.coordinator();
  // The lock is no longer this host's: the coordinator refuses to write and stays broken.
  w.lock.release();
  assert.deepEqual(await refusal(() => core.addParticipant("m-0000000002", "member")), {
    status: 503,
    reason: "notSingleWriter",
  });
  assert.deepEqual(w.host.status(), { state: "stopped", reason: "notSingleWriter" });
  assert.deepEqual(await refusal(() => w.host.coordinator()), { status: 503, reason: "stopped" });
  assert.deepEqual(await refusal(() => w.host.setUp()), { status: 409, reason: "missing" });

  // Without the lock group work is not ready, before anything is written or asked of the core.
  const { w: idle } = await group();
  const untouched = await bytes(idle.files);
  idle.lock.release();
  assert.deepEqual(idle.host.status(), { state: "stopped", reason: "notSingleWriter" });
  assert.deepEqual(await refusal(() => idle.host.coordinator()), { status: 503, reason: "stopped" });
  assert.deepEqual(await bytes(idle.files), untouched);

  // Nor is the side file written once the lock is gone.
  const { w: other, ben } = await group();
  const before = await readFile(other.files.side, "utf8");
  other.lock.release();
  assert.deepEqual(await refusal(() => other.host.saveSide((draft) => void (draft.people = {}))), {
    status: 503,
    reason: "stopped",
  });
  assert.deepEqual(other.host.status(), { state: "stopped", reason: "notSingleWriter" });
  assert.equal(await readFile(other.files.side, "utf8"), before);
  assert.deepEqual(Object.keys(other.host.side().people!), [ben.id]);
});

test("the side file: one change at a time, written strictly, read leniently", async () => {
  const { w, ben } = await group();
  await Promise.all(
    ["m-0000000002", "m-0000000003", "m-0000000004"].map((id) =>
      w.host.saveSide((draft) => {
        draft.people![id] = { name: id, admin: true };
      }),
    ),
  );
  assert.equal(Object.keys(w.host.side().people!).length, 4);
  // A change the write schema refuses reaches neither the file nor side().
  const before = await readFile(w.files.side, "utf8");
  await assert.rejects(
    w.host.saveSide((draft) => {
      draft.people![ben.id].name = "n".repeat(41);
    }),
  );
  await assert.rejects(
    w.host.saveSide((draft) => Object.assign(draft, { secret: `bpc_${"t".repeat(43)}` })),
  );
  assert.equal(await readFile(w.files.side, "utf8"), before);
  assert.equal(w.host.side().people![ben.id].name, "Ben");
  if (process.platform !== "win32") assert.equal((await stat(w.files.side)).mode & 0o777, 0o600);

  // A file from a newer build still loads: what this build does not know is left out.
  const host = await w.restartAfter(async () => {
    const newer = JSON.parse(before);
    newer.later = { any: "thing" };
    newer.people[ben.id].later = 1;
    await writeFile(w.files.side, JSON.stringify(newer));
  });
  assert.deepEqual(host.status(), { state: "ready" });
  assert.deepEqual(host.side(), JSON.parse(before));
});

test("run tells the listeners once the work has landed, and close waits for work in flight", async (t) => {
  const warned = t.mock.method(log, "warn", () => {});
  const { w } = await group();
  const heard: (string | undefined)[] = [];
  w.host.onChange((projectId) => heard.push(projectId));
  const once: (string | undefined)[] = [];
  const unsubscribe = w.host.onChange((projectId) => once.push(projectId));
  w.host.onChange(() => {
    throw new Error("a listener that fails");
  });

  let landed = false;
  assert.equal(
    await w.host.run(async () => {
      assert.deepEqual(heard, []);
      landed = true;
      return 7;
    }, "p-0000000001"),
    7,
  );
  assert.equal(landed, true);
  assert.deepEqual(heard, ["p-0000000001"]);
  unsubscribe();
  // Also after a refusal, and the refusal reaches the caller.
  await assert.rejects(
    w.host.run(async () => {
      throw new Error("refused");
    }),
    /refused/,
  );
  assert.deepEqual(heard, ["p-0000000001", undefined]);
  assert.equal(warned.mock.callCount(), 2);

  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const inFlight = w.host.run(async () => {
    await gate;
    return w.host.coordinator().addParticipant("m-0000000002", "member");
  }, "p-0000000002");
  let closed = false;
  const closing = w.host.close().then(() => (closed = true));
  // close() told the listeners at once, refuses new work, and still waits.
  assert.deepEqual(heard.slice(2), [undefined]);
  assert.deepEqual(w.host.status(), { state: "stopped", reason: "closed" });
  assert.deepEqual(await refusal(() => w.host.run(async () => 1)), {
    status: 503,
    reason: "stopped",
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(closed, false);
  release();
  const added = await inFlight;
  await closing;
  assert.equal(closed, true);
  assert.deepEqual(heard.slice(2), [undefined, "p-0000000002"]);
  assert.match(await readFile(w.files.core, "utf8"), new RegExp(added.id));

  // A second close says nothing more, and who stopped listening heard only the first change.
  await w.host.close();
  assert.equal(heard.length, 4);
  assert.deepEqual(once, ["p-0000000001"]);
});

test("the strict lock names the address it is given, and port 0 without one", async () => {
  const w = await world();
  const plain = readLock(w.dataDir)!;
  assert.equal(plain.strict, true);
  assert.equal(plain.port, 0);
  assert.equal("host" in plain || "url" in plain, false);
  w.lock.release();
  const address = { port: 4311, host: "127.0.0.1", url: "http://127.0.0.1:4311" };
  w.lock = await acquireWriterLock(w.dataDir, address);
  locks.push(w.lock);
  const named = readLock(w.dataDir)!;
  assert.deepEqual(
    { port: named.port, host: named.host, url: named.url, strict: named.strict },
    { ...address, strict: true },
  );
  assert.deepEqual(Object.keys(named).sort(), [...Object.keys(plain), "host", "url"].sort());
  // Group work opens under it as under the lock without an address.
  const host = await openCollabHost({ dataDir: w.dataDir, lock: w.lock });
  await host.setUp();
  assert.deepEqual(host.status(), { state: "ready" });
});
