/**
 * Five end-to-end test cases verifying:
 * 1. Non-admin members importing & adding repositories to the group (`POST /api/repos` + `POST /api/collab/projects`)
 * 2. Targeted email invites: re-issue replacement, server restart persistence (`collab.json`), expiry, blank `name` fallback & email login
 * 3. Shareable open invite links: multi-member self-registration, duplicate-email guard & member email self-service update
 * 4. Security & Tailscale boundaries: disabled/removed inviter link revocation, Tailscale email auto-claim, disabled-account bypass block & secret redaction
 * 5. Frontend DOM interactions: `PairPage` `#invite=` prefill + `/#/group` redirect, `InviteDialog` link + `mailto:`, and `AddProjectDialog` import-and-add
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { request, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { createElement } from "react";
import { collabFixture, outcome } from "../test/collab-fixture.js";
import { PairPage, takePairHash } from "../src/PairPage.js";
import { AddProjectDialog, InviteDialog } from "../src/collab/GroupPage.js";
import { assertNoHan, renderEn, renderZh } from "../src/test-utils/render.js";
import { loadOrCreateApiToken } from "./api-token.js";
import { createApp } from "./app.js";
import { openCollabHost } from "./collab-host.js";
import { participantHeader } from "./coordination-routes.js";
import { acquireWriterLock } from "./index.js";
import { git } from "./process.js";
import { redact, secretInPatch } from "./secrets.js";
import { Store } from "./store.js";
import { Workbench } from "./workbench.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonBody = any;

async function makeRepo(root: string, name: string): Promise<string> {
  const folder = path.join(root, name);
  await mkdir(path.join(folder, "src"), { recursive: true });
  await writeFile(path.join(folder, "src/index.ts"), `export const app = "${name}";\n`, "utf8");
  await git(folder, ["init", "-q", "-b", "main"]);
  await git(folder, ["config", "user.name", "Test"]);
  await git(folder, ["config", "user.email", "test@example.test"]);
  await git(folder, ["add", "-A"]);
  await git(folder, ["commit", "-q", "-m", "init"]);
  return folder;
}

function httpSend(
  port: number,
  method: string,
  urlPath: string,
  headers: Record<string, string> = {},
  body?: unknown,
): Promise<{ status: number; headers: IncomingHttpHeaders; body: string; json: JsonBody }> {
  return new Promise((resolve, reject) => {
    const text = body === undefined ? "" : JSON.stringify(body);
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path: urlPath,
        method,
        headers: {
          host: "127.0.0.1:4311",
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(text)),
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          let json: JsonBody;
          try {
            json = JSON.parse(data);
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data, json });
        });
      },
    );
    req.on("error", reject);
    req.end(text);
  });
}

test("TC1: Non-admin member imports a brand-new repository and adds it to the group; outsiders and removed members are blocked", async (t: TestContext) => {
  const f = await collabFixture(t);
  const cast = await f.cast();
  const sources = await mkdtemp(path.join(os.tmpdir(), "bell-tc1-"));
  t.after(() => rm(sources, { recursive: true, force: true }));

  // Admin generates an email invite for a regular member (`member1@example.test`)
  const invite = await f.post("/invites", cast.who.admin, { email: "member1@example.test" });
  assert.equal(invite.status, 201, invite.body);

  // Member registers from an unpaired browser and receives both deviceToken (`bpd_`) and session token (`bpa_`)
  const reg = await f.post("/auth/register", {}, {
    code: invite.json.inviteUrl,
    email: "member1@example.test",
    name: "Mia",
    password: "mia-secure-password",
  });
  assert.equal(reg.status, 201, reg.body);
  assert.equal(reg.json.admin, undefined);
  assert.match(reg.json.deviceToken, /^bpd_/);

  const miaHeaders = {
    authorization: `Bearer ${reg.json.deviceToken}`,
    [participantHeader]: reg.json.token,
  };

  // Initially zero repos in BELL PR -> Mia sees empty `projects` and empty `addable`
  const emptyList = await f.send("GET", "/api/collab/projects", miaHeaders);
  assert.equal(emptyList.status, 200);
  assert.deepEqual(emptyList.json.projects, []);
  assert.deepEqual(emptyList.json.addable, []);

  // Mia imports a brand-new repository via `POST /api/repos` using her minted device token
  const repoPath = await makeRepo(sources, "mia-service");
  const imported = await f.send("POST", "/api/repos", miaHeaders, { source: repoPath });
  assert.equal(imported.status, 201, imported.body);
  const repoId = imported.json.repo.id as string;

  // Mia sees it in `addable` and adds it to the group (`POST /api/collab/projects`) without admin rights
  const beforeAdd = await f.send("GET", "/api/collab/projects", miaHeaders);
  assert.deepEqual(beforeAdd.json.addable, [{ repoId, name: "local/mia-service" }]);

  // Unjoined device and removed member are strictly refused
  assert.equal(
    outcome(await f.post("/projects", cast.who.device, { repoId })),
    "403 notJoined",
  );
  assert.equal(
    outcome(await f.post("/projects", cast.who.removed, { repoId })),
    "403 notJoined",
  );

  const added = await f.post("/projects", miaHeaders, { repoId });
  assert.equal(added.status, 201, added.body);
  const projectId = added.json.project.id as string;

  // Mia immediately takes a hold on the newly added project
  const hold = await f.post(`/projects/${projectId}/work`, miaHeaders, {
    title: "Bootstrap service",
    scopes: ["src/index.ts#L1-L1"],
  });
  assert.equal(hold.status, 201, hold.body);
});

test("TC2: Targeted email invite re-issue replacement, CollabHost restart persistence, expiry, blank name fallback & case-insensitive login", async (t: TestContext) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "bell-tc2-"));
  const tokenFile = path.join(dataDir, "api-token");
  const apiToken = await loadOrCreateApiToken(tokenFile);
  const lock = await acquireWriterLock(dataDir);
  const store = new Store(dataDir);
  await store.initialize();

  let collab = await openCollabHost({ dataDir, lock });
  const startServerOnHost = async (currentHost: typeof collab) => {
    const workbench = new Workbench(store);
    const app = createApp(workbench, {
      staticDirectory: path.join(dataDir, "missing"),
      port: 4311,
      apiTokenFile: tokenFile,
      collab: currentHost,
      trustVpn: true,
      tailscaleAuth: true,
    });
    const srv = app.listen(0, "127.0.0.1");
    await once(srv, "listening");
    return {
      srv,
      port: (srv.address() as AddressInfo).port,
      stop: async () => {
        await new Promise<void>((resolve) => srv.close(() => resolve()));
        await app.locals.insights.shutdown();
        await app.locals.discovery.shutdown();
        await workbench.shutdown();
      },
    };
  };

  let running = await startServerOnHost(collab);
  let port = running.port;
  const installHeaders = { authorization: `Bearer ${apiToken}` };

  t.after(async () => {
    await running.stop();
    await collab.close();
    lock.release();
    await rm(dataDir, { recursive: true, force: true });
  });

  const adminBoot = await httpSend(port, "POST", "/api/collab/bootstrap", installHeaders, {
    name: "Admin",
    username: "root_admin",
    password: "admin-password-123",
  });
  assert.equal(adminBoot.status, 201, adminBoot.body);
  const adminHeaders = {
    ...installHeaders,
    [participantHeader]: adminBoot.json.token,
  };

  // Issue targeted invite #1 for Alice, then re-issue #2 for the same email (mixed case)
  const first = await httpSend(port, "POST", "/api/collab/invites", adminHeaders, {
    email: "Alice.Wang@Example.Test",
  });
  assert.equal(first.status, 201);
  const second = await httpSend(port, "POST", "/api/collab/invites", adminHeaders, {
    email: "  alice.wang@example.test  ",
  });
  assert.equal(second.status, 201);
  assert.notEqual(first.json.inviteToken, second.json.inviteToken);

  // First invite was cleanly replaced
  const firstInfo = await httpSend(port, "POST", "/api/collab/auth/invite-info", {}, {
    code: first.json.inviteToken,
  });
  assert.equal(firstInfo.json.valid, false);

  // Also inject an expired invite in collab.json to verify expiry handling across restart
  await collab.saveSide((draft) => {
    (draft.emailInvites ??= {})["i-expired001"] = {
      tokenHash: "0".repeat(64),
      email: "expired@example.test",
      createdAt: "2020-01-01T00:00:00.000Z",
      expiresAt: "2020-01-02T00:00:00.000Z",
    };
  });

  // Simulate service restart: close HTTP + CollabHost, reopen from disk (`collab.json`)
  await running.stop();
  await collab.close();
  collab = await openCollabHost({ dataDir, lock });
  running = await startServerOnHost(collab);
  port = running.port;

  // Second invite survived the restart!
  const secondInfo = await httpSend(port, "POST", "/api/collab/auth/invite-info", {}, {
    code: second.json.inviteUrl,
  });
  assert.equal(secondInfo.status, 200);
  assert.equal(secondInfo.json.valid, true);
  assert.equal(secondInfo.json.email, "alice.wang@example.test");

  // Alice registers sending `name: "   "` (blank optional display name) -> falls back cleanly to `alice.wang`
  const reg = await httpSend(port, "POST", "/api/collab/auth/register", {}, {
    code: second.json.inviteToken,
    email: "Alice.Wang@Example.Test",
    name: "   ",
    password: "alice-password-999",
  });
  assert.equal(reg.status, 201, reg.body);
  assert.equal(reg.json.name, "alice.wang");
  assert.equal(reg.json.email, "alice.wang@example.test");

  // Alice logs in from another browser using uppercase email
  const login = await httpSend(port, "POST", "/api/collab/auth/login", {}, {
    username: "ALICE.WANG@EXAMPLE.TEST",
    password: "alice-password-999",
  });
  assert.equal(login.status, 200, login.body);
  assert.equal(login.json.id, reg.json.id);
});

test("TC3: Open shareable link allows multi-teammate registration, blocks duplicate emails, and supports self-service email update", async (t: TestContext) => {
  const f = await collabFixture(t);
  const cast = await f.cast();

  const open = await f.post("/invites", cast.who.admin, { link: true });
  assert.equal(open.status, 201, open.body);
  assert.equal(open.json.email, undefined);

  const info = await f.post("/auth/invite-info", {}, { code: open.json.inviteToken });
  assert.equal(info.json.valid, true);
  assert.equal(info.json.email, undefined);

  // Three teammates register sequentially with the same link
  const emails = ["one@example.test", "two@example.test", "three@example.test"];
  const registeredIds: string[] = [];
  let firstToken = "";
  let firstDeviceToken = "";
  for (const [idx, email] of emails.entries()) {
    const codeInput = idx % 2 === 0 ? open.json.inviteUrl : open.json.inviteToken;
    const reply = await f.post("/auth/register", {}, {
      code: codeInput,
      email,
      name: `Member ${idx + 1}`,
      password: `member-pass-${idx + 1}-ok`,
    });
    assert.equal(reply.status, 201, reply.body);
    registeredIds.push(reply.json.id);
    if (idx === 0) {
      firstToken = reply.json.token;
      firstDeviceToken = reply.json.deviceToken;
    }
  }
  assert.equal(new Set(registeredIds).size, 3);

  // Duplicate email cannot register again
  assert.equal(
    outcome(
      await f.post("/auth/register", {}, {
        code: open.json.inviteToken,
        email: "ONE@example.test",
        password: "another-password-123",
      }),
    ),
    "409 emailTaken",
  );

  // Member 1 updates their own email via self-service `PATCH /api/collab/people/:id` and logs in with new email
  const m1Headers = {
    authorization: `Bearer ${firstDeviceToken}`,
    [participantHeader]: firstToken,
  };
  const conflictPatch = await f.send(
    "PATCH",
    `/api/collab/people/${registeredIds[0]}`,
    m1Headers,
    { email: "two@example.test" },
  );
  assert.equal(outcome(conflictPatch), "409 emailTaken");

  const okPatch = await f.send(
    "PATCH",
    `/api/collab/people/${registeredIds[0]}`,
    m1Headers,
    { email: "one-new@example.test" },
  );
  assert.equal(okPatch.status, 200, okPatch.body);
  assert.equal(okPatch.json.person.email, "one-new@example.test");

  const loginNewEmail = await f.post("/auth/login", {}, {
    username: "one-new@example.test",
    password: "member-pass-1-ok",
  });
  assert.equal(loginNewEmail.status, 200, loginNewEmail.body);
  assert.equal(loginNewEmail.json.id, registeredIds[0]);
});

test("TC4: Security boundaries — disabled inviter link revocation, Tailscale email auto-claim, disabled-user bypass block & secret redaction", async (t: TestContext) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "bell-tc4-"));
  const tokenFile = path.join(dataDir, "api-token");
  const apiToken = await loadOrCreateApiToken(tokenFile);
  const lock = await acquireWriterLock(dataDir);
  const store = new Store(dataDir);
  await store.initialize();
  const collab = await openCollabHost({ dataDir, lock });

  const workbench = new Workbench(store);
  const app = createApp(workbench, {
    staticDirectory: path.join(dataDir, "missing"),
    port: 4311,
    apiTokenFile: tokenFile,
    collab,
    trustVpn: true,
    tailscaleAuth: true,
  });
  const srv = app.listen(0, "127.0.0.1");
  await once(srv, "listening");
  const port = (srv.address() as AddressInfo).port;

  t.after(async () => {
    await collab.close();
    await new Promise<void>((resolve) => srv.close(() => resolve()));
    await app.locals.insights.shutdown();
    await app.locals.discovery.shutdown();
    await workbench.shutdown();
    lock.release();
    await rm(dataDir, { recursive: true, force: true });
  });

  // Root admin bootstraps
  const rootBoot = await httpSend(
    port,
    "POST",
    "/api/collab/bootstrap",
    { authorization: `Bearer ${apiToken}` },
    { name: "Root", username: "root", password: "root-password-123" },
  );
  assert.equal(rootBoot.status, 201);
  const rootHeaders = {
    authorization: `Bearer ${apiToken}`,
    [participantHeader]: rootBoot.json.token,
  };

  // Root invites CoAdmin by email (`coadmin@example.test`, `admin: true`)
  const coInvite = await httpSend(port, "POST", "/api/collab/invites", rootHeaders, {
    email: "coadmin@example.test",
    admin: true,
  });
  assert.equal(coInvite.status, 201);

  // Verify secret redaction & patch blocker on `bpi_` token and `/pair#invite=` URL
  assert.equal(redact(`link=${coInvite.json.inviteUrl}`).includes(coInvite.json.inviteToken), false);
  assert.equal(secretInPatch(`+const link = "${coInvite.json.inviteToken}";\n`), true);

  const coReg = await httpSend(port, "POST", "/api/collab/auth/register", {}, {
    code: coInvite.json.inviteToken,
    email: "coadmin@example.test",
    password: "coadmin-password-123",
  });
  assert.equal(coReg.status, 201);
  assert.equal(coReg.json.admin, true);

  // CoAdmin creates an open admin invite link, and Root also creates a valid open member link + targeted Tailscale invite
  const coHeaders = {
    authorization: `Bearer ${coReg.json.deviceToken}`,
    [participantHeader]: coReg.json.token,
  };
  const rogueOpenAdminLink = await httpSend(port, "POST", "/api/collab/invites", coHeaders, {
    link: true,
    admin: true,
  });
  assert.equal(rogueOpenAdminLink.status, 201);

  const rootOpenLink = await httpSend(port, "POST", "/api/collab/invites", rootHeaders, {
    link: true,
  });
  const tsTargeted = await httpSend(port, "POST", "/api/collab/invites", rootHeaders, {
    email: "ts.member@example.test",
  });
  assert.equal(tsTargeted.status, 201);

  // Root disables CoAdmin -> CoAdmin's open admin link is IMMEDIATELY invalidated!
  const disableCo = await httpSend(
    port,
    "PATCH",
    `/api/collab/people/${coReg.json.id}`,
    rootHeaders,
    { disabled: true },
  );
  assert.equal(disableCo.status, 200);

  const rogueInfo = await httpSend(port, "POST", "/api/collab/auth/invite-info", {}, {
    code: rogueOpenAdminLink.json.inviteToken,
  });
  assert.equal(rogueInfo.json.valid, false);
  const rogueRedeem = await httpSend(port, "POST", "/api/collab/auth/register", {}, {
    code: rogueOpenAdminLink.json.inviteToken,
    email: "attacker@example.test",
    password: "attacker-password-123",
  });
  assert.equal(rogueRedeem.status, 400);
  assert.equal(rogueRedeem.json.reason, "invalidCode");

  // Disabled CoAdmin trying to bypass disablement via Tailscale + Root's open link is refused!
  const bypassAttempt = await httpSend(
    port,
    "POST",
    "/api/collab/auth/tailscale",
    {
      "tailscale-user-login": "coadmin@example.test",
      "tailscale-user-name": "CoAdmin",
    },
    { code: rootOpenLink.json.inviteToken },
  );
  assert.equal(bypassAttempt.status, 403);
  assert.equal(bypassAttempt.json.reason, "invalidCredentials");

  // Wrong Tailscale user trying to claim `ts.member@example.test`'s targeted invite is refused
  const wrongTs = await httpSend(
    port,
    "POST",
    "/api/collab/auth/tailscale",
    {
      "tailscale-user-login": "someone.else@example.test",
      "tailscale-user-name": "Someone Else",
    },
    { code: tsTargeted.json.inviteToken },
  );
  assert.equal(wrongTs.status, 403);
  assert.equal(wrongTs.json.reason, "inviteEmailMismatch");

  // Genuine `ts.member@example.test` connecting via Tailscale auto-claims their targeted email invite without typing any code!
  const autoClaim = await httpSend(
    port,
    "POST",
    "/api/collab/auth/tailscale",
    {
      "tailscale-user-login": "ts.member@example.test",
      "tailscale-user-name": "Tailscale Member",
    },
    {},
  );
  assert.equal(autoClaim.status, 201, autoClaim.body);
  assert.equal(autoClaim.json.email, "ts.member@example.test");
  assert.equal(autoClaim.json.tailscaleLogin, "ts.member@example.test");
});

test("TC5: Frontend DOM interactions — PairPage #invite prefill & /#/group redirect, InviteDialog mailto link, and AddProjectDialog import-and-add", async () => {
  const { act } = await import("react");
  const { mount } = await import("../src/mission/test-dom.js");

  // 1. Static i18n check (`assertNoHan` in English, Chinese labels in zh-TW) for InviteDialog & AddProjectDialog
  const enInviteHtml = renderEn(
    createElement(InviteDialog, {
      store: { async call<T>() { return {} as T; } },
      onClose() {},
    }),
  );
  assertNoHan(enInviteHtml);
  assert.match(enInviteHtml, /Create invite link/);
  const zhInviteHtml = renderZh(
    createElement(InviteDialog, {
      store: { async call<T>() { return {} as T; } },
      onClose() {},
    }),
  );
  assert.match(zhInviteHtml, /產生邀請連結/);

  const enAddHtml = renderEn(
    createElement(AddProjectDialog, {
      store: { async add() {} },
      addable: [{ repoId: "r1", name: "local/demo" }],
      onClose() {},
    }),
  );
  assertNoHan(enAddHtml);
  assert.match(enAddHtml, /Import &amp; add repository/);
  assert.match(
    renderZh(createElement(AddProjectDialog, { store: { async add() {} }, onClose() {} })),
    /匯入並新增專案/,
  );

  // 2. Root `/#invite=bpi_...` hash extraction
  const token = `bpi_${"B".repeat(43)}`;
  let replacedUrl: unknown;
  const rootWin = {
    location: { hash: `#invite=${token}`, search: "", pathname: "/" },
    history: {
      state: null,
      replaceState(_s: unknown, _t: string, url: unknown) {
        replacedUrl = url;
      },
    },
  };
  assert.deepEqual(
    takePairHash(rootWin as unknown as Pick<Window, "location" | "history">),
    { code: "", invite: token },
  );
  assert.equal(replacedUrl, "/");

  // 3. Interactive mount of PairPage with `initialInvite`: auto-prefills locked email & redirects to `/#/group`
  const realFetch = globalThis.fetch;
  const oldLocal = globalThis.localStorage;
  const stored = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => {
      stored.set(key, value);
    },
    removeItem: (key) => {
      stored.delete(key);
    },
    clear: () => stored.clear(),
    key: () => null,
    length: 0,
  };

  let registerPayload: Record<string, unknown> | undefined;
  globalThis.fetch = async (url, options) => {
    const pathStr = String(url);
    if (pathStr.endsWith("/api/collab/auth/invite-info")) {
      return new Response(
        JSON.stringify({
          valid: true,
          email: "invited.dev@example.test",
          expiresAt: "2026-11-19T00:00:00.000Z",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (pathStr.endsWith("/api/collab/auth/register")) {
      registerPayload = JSON.parse(String(options?.body));
      return new Response(
        JSON.stringify({
          groupId: "g-123",
          id: "m-dev1",
          name: "Invited Dev",
          email: "invited.dev@example.test",
          token: `bpa_${"C".repeat(43)}`,
          deviceId: "d-1",
          deviceToken: `bpd_${"0".repeat(64)}`,
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    }
    if (pathStr.endsWith("/api/repos")) {
      return new Response(
        JSON.stringify({ repo: { id: "repo-imported-9", name: "local/new-app" } }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    }
    throw new Error(`Unexpected fetch: ${pathStr}`);
  };

  let destination = "";
  const pairView = await mount(createElement(PairPage, { initialInvite: token }));
  Object.assign(window.location, {
    hash: "",
    pathname: "/pair",
    replace: (url: string) => {
      destination = url;
    },
  });

  try {
    await act(async () => {
      await Promise.resolve();
    });
    const emailInput = pairView.container.querySelectorAll(
      (el) => el.getAttribute("id") === "pair-email",
    )[0];
    assert.equal(emailInput.value, "invited.dev@example.test");
    const emailReactProps = Object.entries(emailInput).find(([k]) =>
      k.startsWith("__reactProps$"),
    )?.[1] as { readOnly?: boolean } | undefined;
    assert.equal(emailInput.hasAttribute("readonly") || Boolean(emailReactProps?.readOnly), true);

    // Fill password and submit registration
    const passInput = pairView.container.querySelectorAll(
      (el) => el.getAttribute("id") === "pair-password",
    )[0];
    const passProps = Object.entries(passInput).find(([k]) => k.startsWith("__reactProps$"))?.[1] as {
      onChange(e: { target: { value: string } }): void;
    };
    await act(async () => passProps.onChange({ target: { value: "super-secret-pw" } }));

    const form = pairView.container.querySelectorAll((el) => el.nodeName === "FORM")[0];
    const formProps = Object.entries(form).find(([k]) => k.startsWith("__reactProps$"))?.[1] as {
      onSubmit(e: { preventDefault(): void }): void;
    };
    await act(async () => formProps.onSubmit({ preventDefault() {} }));

    assert.deepEqual(registerPayload, {
      code: token,
      email: "invited.dev@example.test",
      password: "super-secret-pw",
    });
    assert.equal(stored.get("bellpr-participant-token"), `bpa_${"C".repeat(43)}`);
    assert.equal(stored.get("bellpr-device-token"), `bpd_${"0".repeat(64)}`);
    assert.equal(destination, "/#/group");

    // 4. Interactive mount of InviteDialog: enter email -> click Create invite link -> verify `mailto:` link
    let inviteCallBody: Record<string, unknown> | undefined;
    const inviteView = await mount(
      createElement(InviteDialog, {
        store: {
          async call<T>(_path: string, init?: RequestInit): Promise<T> {
            inviteCallBody = JSON.parse(String(init?.body));
            return {
              code: token,
              inviteToken: token,
              inviteUrl: `https://example.test/pair#invite=${token}`,
              email: "teammate@example.test",
              expiresAt: "2026-11-19T00:00:00.000Z",
            } as T;
          },
        },
        onClose() {},
      }),
    );
    try {
      const inviteEmailInput = inviteView.container.querySelectorAll(
        (el) => el.getAttribute("id") === "invite-email",
      )[0];
      const inviteEmailProps = Object.entries(inviteEmailInput).find(([k]) =>
        k.startsWith("__reactProps$"),
      )?.[1] as { onChange(e: { target: { value: string } }): void };
      await act(async () =>
        inviteEmailProps.onChange({ target: { value: "teammate@example.test" } }),
      );

      const createLinkBtn = inviteView.container.querySelectorAll(
        (el) => el.nodeName === "BUTTON" && el.textContent.includes("Create invite link"),
      )[0];
      const btnProps = Object.entries(createLinkBtn).find(([k]) =>
        k.startsWith("__reactProps$"),
      )?.[1] as { onClick(): void };
      await act(async () => btnProps.onClick());

      assert.deepEqual(inviteCallBody, { link: true, email: "teammate@example.test" });
      const mailAnchor = inviteView.container.querySelectorAll(
        (el) => el.nodeName === "A" && (el.getAttribute("href") ?? "").startsWith("mailto:"),
      )[0];
      assert.ok(mailAnchor);
      assert.match(mailAnchor.getAttribute("href") ?? "", /^mailto:teammate%40example\.test\?/);
    } finally {
      await inviteView.unmount();
    }

    // 5. Interactive mount of AddProjectDialog: non-admin member imports & adds repo in one step
    let addedRepoId = "";
    let dialogClosed = false;
    const addView = await mount(
      createElement(AddProjectDialog, {
        store: {
          async add(id: string) {
            addedRepoId = id;
          },
        },
        onClose() {
          dialogClosed = true;
        },
      }),
    );
    try {
      const sourceInput = addView.container.querySelectorAll(
        (el) => el.getAttribute("id") === "dialog-import-source",
      )[0];
      const sourceProps = Object.entries(sourceInput).find(([k]) =>
        k.startsWith("__reactProps$"),
      )?.[1] as { onChange(e: { target: { value: string } }): void };
      await act(async () =>
        sourceProps.onChange({ target: { value: "/srv/repos/new-app" } }),
      );

      const importForm = addView.container.querySelectorAll((el) => el.nodeName === "FORM")[0];
      const importFormProps = Object.entries(importForm).find(([k]) =>
        k.startsWith("__reactProps$"),
      )?.[1] as { onSubmit(e: { preventDefault(): void }): void };
      await act(async () => importFormProps.onSubmit({ preventDefault() {} }));

      assert.equal(addedRepoId, "repo-imported-9");
      assert.equal(dialogClosed, true);
    } finally {
      await addView.unmount();
    }
  } finally {
    await pairView.unmount();
    globalThis.fetch = realFetch;
    globalThis.localStorage = oldLocal;
  }
});
