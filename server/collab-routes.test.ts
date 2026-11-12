/**
 * The group routes behind the request guard (routes/collab.ts): who may
 * use each one, invites as a browser meets them, and what never reaches a
 * log or a file. Synthetic tokens only; the clock is real, so time-based
 * rules live in collab-invites.test.ts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { collabFixture as fixture, outcome, type Headers } from "../test/collab-fixture.js";
import { CollabInvites, inviteTtl, maxInvites } from "./collab-invites.js";
import { participantHeader } from "./coordination-routes.js";
import { failureLimit } from "./pairing.js";

const wrong = { code: "0000-0000" };

test("before setup the group routes say so, only the person at the host sets it up, and a stopped group stays stopped", async (t) => {
  const f = await fixture(t);
  const phone = await f.device("Phone");
  const asks: [string, unknown][] = [
    ["/invites", { name: "Ben" }],
    ["/invites", { self: true }],
    ["/join", wrong],
    ["/people/m-0000000001/remove", {}],
  ];
  const expectNotReady = async (state: string) => {
    for (const who of [f.install, phone]) {
      for (const [urlPath, body] of asks) {
        const reply = await f.post(urlPath, who, body);
        assert.equal(outcome(reply), `503 ${state}`, urlPath);
        assert.deepEqual(Object.keys(reply.json).sort(), ["error", "reason"]);
      }
      const tasksReply = await f.send("GET", "/api/collab/projects/p-0000000000/tasks", who);
      assert.equal(outcome(tasksReply), `503 ${state}`, "GET /projects/:project/tasks");
      assert.deepEqual(Object.keys(tasksReply.json).sort(), ["error", "reason"]);
    }
  };
  assert.deepEqual((await f.info(f.install)).json, { state: "notSetUp", host: true });
  assert.deepEqual((await f.info(phone)).json, { state: "notSetUp", host: false });
  await expectNotReady("notSetUp");
  assert.equal(outcome(await f.post("/setup", phone)), "403 hostOnly");
  assert.equal(existsSync(f.paths.coordination) || existsSync(f.paths.collab), false);

  const setup = await f.post("/setup", f.install);
  assert.equal(setup.status, 201, setup.body);
  assert.deepEqual(Object.keys(setup.json).sort(), ["groupId", "state"]);
  assert.match(setup.json.groupId, /^g-[0-9a-f]{16}$/);
  const { groupId } = setup.json;
  assert.equal(outcome(await f.post("/setup", f.install)), "409 exists");
  await f.start();
  assert.deepEqual((await f.info(phone)).json, { state: "ready", groupId, host: false });

  await f.start(() => rm(f.paths.coordination));
  assert.deepEqual((await f.info(f.install)).json, {
    state: "stopped",
    reason: "missing",
    groupId,
    host: true,
  });
  await expectNotReady("stopped");
  // A restart alone did not bring it back: both languages say to fix the cause first.
  const said = async (locale: string) =>
    (await f.post("/join", { ...f.install, "x-bell-locale": locale }, wrong)).json.error;
  assert.equal(
    await said("en"),
    "Group work has stopped. Fix the cause on the host (`bell-pr group status` or the log on the host names it), then restart BELL PR.",
  );
  assert.equal(
    await said("zh-TW"),
    "小組協作已停止。請先在主機上排除原因（`bell-pr group status` 或主機的記錄會顯示原因），再重新啟動 BELL PR。",
  );
  assert.equal(outcome(await f.post("/setup", f.install)), "409 missing");
  assert.equal(existsSync(f.paths.coordination), false);
  // Asking while group work is not ready is no failure worth a log line.
  assert.equal(f.logged.some((line) => line.includes("Request failed")), false);
});

test("who may use each route: the person at the host, a device, a member, an admin, a removed person", async (t) => {
  const f = await fixture(t);
  const c = await f.cast();
  type Who = keyof typeof c.who;
  const all = (answer: string) =>
    Object.fromEntries(Object.keys(c.who).map((who) => [who, answer])) as Record<Who, string>;
  const outsiders = { device: "403 notJoined", removed: "403 notJoined", stranger: "403 notJoined" };
  const rows: [string, string, unknown, Record<Who, string>][] = [
    ["GET", "", undefined, all("200")],
    ["POST", "/setup", {}, { ...all("403 hostOnly"), install: "409 exists" }],
    [
      "POST",
      "/invites",
      { name: "Dee" },
      { ...outsiders, install: "201", member: "403 adminOnly", admin: "201" },
    ],
    [
      "POST",
      "/invites",
      { self: true },
      { ...outsiders, install: "403 notJoined", member: "201", admin: "201" },
    ],
    ["POST", "/join", wrong, all("400 invalidCode")],
    [
      "POST",
      `/people/${c.cy.id}/remove`,
      {},
      { ...outsiders, install: "403 notJoined", member: "403 adminOnly", admin: "200" },
    ],
    [
      "POST",
      `/people/${c.ada.id}/remove`,
      {},
      { ...outsiders, install: "403 notJoined", member: "403 adminOnly", admin: "409 self" },
    ],
  ];
  for (const [method, urlPath, body, expected] of rows) {
    const name = `${method} /api/collab${urlPath} ${JSON.stringify(body)}`;
    for (const who of Object.keys(c.who) as Who[]) {
      const reply = await f.send(method, `/api/collab${urlPath}`, c.who[who], body);
      assert.equal(outcome(reply), expected[who], `${name} as ${who}`);
      if (reply.status >= 400) assert.equal(typeof reply.json.error, "string");
    }
    // 401 is the guard's alone: no app token, whatever the participant token.
    const noAppToken = await f.send(method, `/api/collab${urlPath}`, {
      [participantHeader]: c.ada.token,
    }, body);
    assert.equal(noAppToken.status, 401, name);
  }

  assert.deepEqual((await f.info(c.who.admin)).json, {
    state: "ready",
    groupId: c.groupId,
    host: false,
    me: { id: c.ada.id, name: "Ada", admin: true },
  });
  assert.deepEqual((await f.info(c.who.member)).json.me, { id: c.ben.id, name: "Ben" });
  for (const who of ["install", "device", "removed", "stranger"] as const) {
    const { json } = await f.info(c.who[who]);
    assert.deepEqual(json, { state: "ready", groupId: c.groupId, host: who === "install" }, who);
  }
  assert.ok(f.logged.some((line) => line.includes(`group: ${c.ben.id} joined`)));
  assert.ok(f.logged.some((line) => line.includes(`group: ${c.cy.id} removed by ${c.ada.id}`)));
  await f.nothingLeaked();
});

test("an invite code works once, 20 wait at most, a restart voids them; wrong codes lock only their sender", async (t) => {
  const f = await fixture(t);
  const c = await f.cast();
  const code = await f.invite(c.who.admin, { name: " Dee " });
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  const dee = await f.join(c.who.device, code.toLowerCase());
  assert.deepEqual(Object.keys(dee).sort(), ["groupId", "id", "name", "token"]);
  assert.deepEqual([dee.groupId, dee.name], [c.groupId, "Dee"]);
  assert.match(dee.id, /^m-[0-9a-f]{10}$/);
  assert.match(dee.token, /^bpc_[A-Za-z0-9_-]{43}$/);
  assert.equal(outcome(await f.post("/join", f.install, { code })), "400 invalidCode");
  // The person at the host joins too; only a paired device is recorded.
  const host = await f.join(f.install, await f.invite(f.install, { name: "Host", admin: true }));
  assert.equal(host.admin, true);
  const { people } = JSON.parse((await f.files())[0]);
  assert.match(people[dee.id].deviceId, /^dev_[0-9a-f]{32}$/);
  assert.deepEqual(Object.keys(people[host.id]).sort(), ["admin", "joinedAt", "name"]);

  const forLocked = await f.invite(c.who.admin, { name: "Eve" });
  const forOther = await f.invite(c.who.admin, { name: "Fay" });
  const locked = c.devices.none;
  for (let attempt = 1; attempt < failureLimit; attempt++)
    assert.equal(outcome(await f.post("/join", locked, wrong)), "400 invalidCode");
  const tenth = await f.post("/join", locked, wrong);
  assert.equal(outcome(tenth), "429 joinLocked");
  assert.equal(tenth.json.retryAfter, 15 * 60);
  // Locked means locked for the right code too; nobody else is, and no code was voided.
  const right = await f.post("/join", locked, { code: forLocked });
  assert.equal(outcome(right), "429 joinLocked");
  assert.ok(right.json.retryAfter > 14 * 60 && right.json.retryAfter <= 15 * 60);
  assert.equal(outcome(await f.post("/join", f.install, wrong)), "400 invalidCode");
  assert.equal((await f.join(await f.device("Tablet F"), forOther)).name, "Fay");

  // forLocked still waits, so 19 more fit.
  for (let more = 1; more < maxInvites; more++) await f.invite(f.install, { name: `More ${more}` });
  const full = await f.post("/invites", { ...f.install, "x-bell-locale": "en" }, { name: "One too many" });
  assert.equal(outcome(full), "429 tooManyInvites");
  // The message takes its numbers from the limits themselves.
  assert.equal(
    full.json.error,
    `${maxInvites} invite codes are already waiting. Wait until one is used or expires (${inviteTtl / 60_000} minutes).`,
  );
  assert.equal(outcome(await f.post("/invites", c.who.member, { self: true })), "429 tooManyInvites");

  await f.start();
  assert.equal(outcome(await f.post("/join", f.install, { code: forLocked })), "400 invalidCode");
  // People and their tokens are kept; only the codes went.
  assert.deepEqual((await f.info(c.who.member)).json.me, { id: c.ben.id, name: "Ben" });
  assert.equal((await f.join(locked, await f.invite(f.install, { name: "Eve" }))).name, "Eve");
  await f.nothingLeaked();
});

test("use on another device: the same person and token, and nobody is added", async (t) => {
  const f = await fixture(t);
  const c = await f.cast();
  const before = await f.files();
  const tablet = await f.device("Tablet");
  assert.deepEqual(await f.join(tablet, await f.invite(c.who.member, { self: true })), {
    groupId: c.groupId,
    id: c.ben.id,
    name: "Ben",
    token: c.ben.token,
  });
  assert.deepEqual(await f.join(f.install, await f.invite(c.who.admin, { self: true })), {
    groupId: c.groupId,
    id: c.ada.id,
    name: "Ada",
    admin: true,
    token: c.ada.token,
  });
  assert.deepEqual(await f.files(), before);

  // A person removed before the code is used gets nothing from it.
  const late = await f.invite(c.who.member, { self: true });
  assert.equal(outcome(await f.post(`/people/${c.ben.id}/remove`, c.who.admin)), "200");
  assert.equal(outcome(await f.post("/join", tablet, { code: late })), "400 invalidCode");
  await f.nothingLeaked();
});

test("remove: the person leaves the group; their device is unpaired only when asked", async (t) => {
  const f = await fixture(t);
  const c = await f.cast();
  const remove = (id: string, body: unknown = {}) => f.post(`/people/${id}/remove`, c.who.admin, body);
  for (const id of ["m-ffffffffff", "constructor", "__proto__"])
    assert.equal(outcome(await remove(id)), "404 unknownPerson", id);

  assert.deepEqual((await remove(c.ben.id)).json, { revoked: 0, unpaired: false });
  // Still a paired device, no longer a participant: 403, never 401.
  assert.deepEqual((await f.info(c.who.member)).json, {
    state: "ready",
    groupId: c.groupId,
    host: false,
  });
  assert.equal(outcome(await f.post("/invites", c.who.member, { self: true })), "403 notJoined");
  const removedAt = () => f.files().then(([side]) => JSON.parse(side).people[c.ben.id].removedAt);
  const first = await removedAt();
  assert.ok(Date.parse(first));

  // Asked again with the tick box: the device they joined from goes, the date stays.
  assert.deepEqual((await remove(c.ben.id, { unpair: true })).json, { revoked: 0, unpaired: true });
  assert.equal(await removedAt(), first);
  // The log has the removal once: the second request removed nobody.
  assert.equal(f.logged.filter((line) => line.includes(`group: ${c.ben.id} removed by`)).length, 1);
  assert.equal((await f.info(c.who.member)).status, 401);
  assert.equal((await f.info(c.who.admin)).status, 200);
  // Nothing to unpair for someone who joined at the host.
  const host = await f.join(f.install, await f.invite(f.install, { name: "Host", admin: true }));
  assert.deepEqual((await remove(host.id, { unpair: true })).json, { revoked: 0, unpaired: false });
  // A removed admin is nobody: the participant answer, not the admin one.
  assert.equal(
    outcome(await f.post(`/people/${c.ada.id}/remove`, { ...f.install, [participantHeader]: host.token })),
    "403 notJoined",
  );
  await f.nothingLeaked();
});

test("remove with the tick box never unpairs the asking device or one a current person joined from", async (t) => {
  const f = await fixture(t);
  const c = await f.cast();
  const remove = (who: Headers, id: string) => f.post(`/people/${id}/remove`, who, { unpair: true });
  // Two people joined from one paired device: it stays while either is in the group.
  const shared = await f.device("Shared laptop");
  const gil = await f.join(shared, await f.invite(c.who.admin, { name: "Gil" }));
  const hal = await f.join(shared, await f.invite(c.who.admin, { name: "Hal" }));
  assert.deepEqual((await remove(c.who.admin, gil.id)).json, { revoked: 0, unpaired: false });
  assert.equal((await f.info(shared)).status, 200);
  assert.deepEqual((await remove(c.who.admin, hal.id)).json, { revoked: 0, unpaired: true });
  assert.equal((await f.info(shared)).status, 401);

  // The admin also uses the tablet Ivy joined from: asked from it, it stays paired.
  const tablet = await f.device("Tablet");
  const ivy = await f.join(tablet, await f.invite(c.who.admin, { name: "Ivy" }));
  const onTablet = { ...tablet, [participantHeader]: c.ada.token };
  assert.deepEqual((await remove(onTablet, ivy.id)).json, { revoked: 0, unpaired: false });
  assert.equal((await f.info(onTablet)).status, 200);
  assert.deepEqual((await remove(c.who.admin, ivy.id)).json, { revoked: 0, unpaired: true });
  assert.equal((await f.info(onTablet)).status, 401);
});

test("a removed admin's waiting codes add nobody and no longer count; two admins cannot remove each other", async (t) => {
  const f = await fixture(t);
  const c = await f.cast();
  const admin = async (name: string) => {
    const phone = await f.device(`Phone ${name}`);
    const joined = await f.join(phone, await f.invite(f.install, { name, admin: true }));
    return { id: joined.id, who: { ...phone, [participantHeader]: joined.token } };
  };
  const removeAsAda = (id: string) => f.post(`/people/${id}/remove`, c.who.admin);

  // Even a code the removal did not reach is refused when it is used.
  const dee = await admin("Dee");
  const unreached = t.mock.method(CollabInvites.prototype, "drop", () => {});
  const outlived = await f.invite(dee.who, { name: "Eve", admin: true });
  assert.equal(outcome(await removeAsAda(dee.id)), "200");
  unreached.mock.restore();
  const before = await f.files();
  assert.equal(outcome(await f.post("/join", c.who.device, { code: outlived })), "400 invalidCode");
  assert.deepEqual(await f.files(), before);

  // The removal voids what the person left waiting, and only that.
  const fay = await admin("Fay");
  const fromFay: string[] = [];
  for (const body of [{ name: "Gil", admin: true }, { name: "Hal" }, { self: true }])
    fromFay.push(await f.invite(fay.who, body));
  // At the host, with Fay's participant token riding along: still the host's code.
  const fromHost = await f.invite({ ...fay.who, ...f.install }, { name: "Ida" });
  const fromAda = await f.invite(c.who.admin, { name: "Jo" });
  assert.equal(outcome(await removeAsAda(fay.id)), "200");
  // Two still wait, so 18 more fit.
  for (let more = 2; more < maxInvites; more++) await f.invite(f.install, { name: `More ${more}` });
  assert.equal(outcome(await f.post("/invites", f.install, { name: "One too many" })), "429 tooManyInvites");
  for (const code of fromFay)
    assert.equal(outcome(await f.post("/join", c.who.device, { code })), "400 invalidCode");
  assert.equal((await f.join(c.who.device, fromHost)).name, "Ida");
  assert.equal((await f.join(c.who.device, fromAda)).name, "Jo");

  // Removals land one at a time: the admin removed first removes nobody.
  const gus = await admin("Gus");
  const both = await Promise.all([
    removeAsAda(gus.id),
    f.post(`/people/${c.ada.id}/remove`, gus.who),
  ]);
  assert.deepEqual(both.map(outcome).sort(), ["200", "403 notJoined"]);
  const { people } = JSON.parse((await f.files())[0]);
  assert.equal([c.ada.id, gus.id].filter((id) => people[id].removedAt).length, 1);
  await f.nothingLeaked();
});

test("bodies are strict: unknown fields, bad names and long codes are refused", async (t) => {
  const f = await fixture(t);
  const c = await f.cast();
  const before = await f.files();
  const bad: [string, Headers, unknown][] = [
    ["/setup", f.install, { force: true }],
    ["/invites", f.install, {}],
    ["/invites", f.install, { name: " " }],
    ["/invites", f.install, { name: "n".repeat(41) }],
    ["/invites", f.install, { name: "Ben‮" }],
    ["/invites", f.install, { name: "Ben", admin: false }],
    ["/invites", c.who.admin, { self: true, name: "Ben" }],
    ["/join", f.install, { code: "0".repeat(33) }],
    ["/join", f.install, { ...wrong, name: "Ben" }],
    [`/people/${c.ben.id}/remove`, c.who.admin, { unpair: false }],
  ];
  for (const [urlPath, who, body] of bad) {
    const reply = await f.post(urlPath, who, body);
    assert.equal(reply.status, 400, `${urlPath} ${JSON.stringify(body)}`);
    assert.equal(typeof reply.json.error, "string");
  }
  assert.deepEqual(await f.files(), before);
  assert.deepEqual((await f.info(c.who.member)).json.me, { id: c.ben.id, name: "Ben" });
});
