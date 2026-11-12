/**
 * Integration tests for BELL PR Team Collaboration v2:
 * - Remote VPN / Tailscale HTTP guard, team accounts (`bpa_`), loopback Tailscale identity, and Admin people API
 * - Intra-file `#Lstart-Lend` concurrent holds and diff hunk guards (1a & 1b)
 * - Static import dependency detection + manual `warn` / `block` cross-file guards (1c)
 * - Real-time member presence & live progress feed (2)
 * - Team file review sign-offs, developer rationales, handoff TODOs, preflight & Markdown export (3a, 3b, 3c)
 */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { request, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import type { DraftCheck } from "../shared/draft-checks.js";
import { collabFixture, outcome } from "../test/collab-fixture.js";
import { loadOrCreateApiToken } from "./api-token.js";
import { createApp } from "./app.js";
import { accountTokenPattern, readTailscaleIdentity } from "./collab-auth.js";
import { openCollabHost } from "./collab-host.js";
import { participantHeader } from "./coordination-routes.js";
import { changedLineRanges, changedScopes, holdGuard, runHolds } from "./hold-guard.js";
import { acquireWriterLock } from "./index.js";
import { git } from "./process.js";
import { redact } from "./secrets.js";
import { Store } from "./store.js";
import type { Run } from "./types.js";
import { Workbench } from "./workbench.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonBody = any;

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
          let json: unknown;
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

async function createGitRepo(
  baseDir: string,
  name: string,
  files: Record<string, string>,
): Promise<string> {
  const folder = path.join(baseDir, name);
  await mkdir(folder, { recursive: true });
  await git(folder, ["init", "-q", "-b", "main"]);
  await git(folder, ["config", "user.name", "Team Test"]);
  await git(folder, ["config", "user.email", "team@example.com"]);
  await git(folder, ["config", "commit.gpgsign", "false"]);
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(folder, rel)), { recursive: true });
    await writeFile(path.join(folder, rel), content, "utf8");
  }
  await git(folder, ["add", "--", "."]);
  await git(folder, ["commit", "-q", "-m", "initial"]);
  return folder;
}

test("VPN/Tailscale HTTP guard, team accounts, loopback Tailscale auth, and Admin people management", async (t: TestContext) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-collab-vpn-"));
  const tokenFile = path.join(directory, "api-token");
  const installToken = await loadOrCreateApiToken(tokenFile);
  const lock = await acquireWriterLock(directory);
  const collab = await openCollabHost({ dataDir: directory, lock });
  const store = new Store(directory);
  await store.initialize();
  const workbench = new Workbench(store);
  const app = createApp(workbench, {
    staticDirectory: path.join(directory, "missing"),
    port: 4311,
    apiTokenFile: tokenFile,
    collab,
    trustVpn: true,
    tailscaleAuth: true,
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;

  t.after(async () => {
    await collab.close();
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    await app.locals.insights.shutdown();
    await app.locals.discovery.shutdown();
    await workbench.shutdown();
    lock.release();
    await rm(directory, { recursive: true, force: true });
  });

  // 1. Tailscale identity helper strictly requires loopback TCP socket
  assert.equal(
    readTailscaleIdentity(
      {
        get: (h: string) => (h.toLowerCase() === "tailscale-user-login" ? "ada@example.com" : undefined),
        socket: { remoteAddress: "100.64.0.99" },
      },
      true,
    ),
    undefined,
  );
  assert.deepEqual(
    readTailscaleIdentity(
      {
        get: (h: string) =>
          h.toLowerCase() === "tailscale-user-login"
            ? "Ada@Example.com"
            : h.toLowerCase() === "tailscale-user-name"
              ? "Ada Lovelace"
              : undefined,
        socket: { remoteAddress: "127.0.0.1" },
      },
      true,
    ),
    { login: "ada@example.com", name: "Ada Lovelace" },
  );

  // 2. `--trust-vpn` allows Tailscale CGNAT (100.64.x.y) & RFC1918 LAN hosts, blocks public domains
  const tailnetStatus = await httpSend(port, "GET", "/api/collab/auth/status", {
    host: "100.64.0.10:4311",
    origin: "http://100.64.0.10:4311",
  });
  assert.equal(tailnetStatus.status, 200, tailnetStatus.body);
  assert.equal(tailnetStatus.json.state, "notSetUp");

  const vpnStatus = await httpSend(port, "GET", "/api/collab/auth/status", {
    host: "192.168.1.20:4311",
    origin: "http://192.168.1.20:4311",
  });
  assert.equal(vpnStatus.status, 200, vpnStatus.body);

  const blockedHost = await httpSend(port, "GET", "/api/collab/auth/status", {
    host: "evil.example.com:4311",
  });
  assert.equal(blockedHost.status, 403);

  // Unauthenticated access to protected API routes is still rejected with 401
  const protectedReply = await httpSend(port, "GET", "/api/collab", {
    host: "100.64.0.10:4311",
  });
  assert.equal(protectedReply.status, 401);

  // 3. Remote setup & first-admin bootstrap without needing localhost install token!
  const installHeaders = { authorization: `Bearer ${installToken}` };
  const pairCodeInit = await httpSend(port, "POST", "/api/pair/codes", installHeaders, {
    name: "Remote Browser",
  });
  assert.equal(pairCodeInit.status, 201);
  const remotePaired = await httpSend(
    port,
    "POST",
    "/api/pair",
    { host: "100.64.0.10:4311" },
    { code: pairCodeInit.json.code, name: "Remote Browser" },
  );
  assert.equal(remotePaired.status, 201);
  const remoteDeviceHeaders = {
    host: "100.64.0.10:4311",
    authorization: `Bearer ${remotePaired.json.token}`,
    "tailscale-user-login": "ada@example.com",
    "tailscale-user-name": "Ada",
  };

  // Before setup, remote paired device sees `canBootstrap: true` instead of being stuck at host-only
  const preSetupInfo = await httpSend(port, "GET", "/api/collab", remoteDeviceHeaders);
  assert.equal(preSetupInfo.status, 200);
  assert.equal(preSetupInfo.json.state, "notSetUp");
  assert.equal(preSetupInfo.json.host, false);
  assert.equal(preSetupInfo.json.canBootstrap, true);
  assert.equal(preSetupInfo.json.tailscaleLogin, "ada@example.com");
  assert.equal(preSetupInfo.json.tailscaleName, "Ada");

  // Remote bootstrap initializes `notSetUp -> ready`, creates first Admin, sets account & binds Tailscale
  const adaTs = await httpSend(
    port,
    "POST",
    "/api/collab/bootstrap",
    remoteDeviceHeaders,
    { name: "Ada", username: "ada_admin", password: "ada-strong-password" },
  );
  assert.equal(adaTs.status, 201, adaTs.body);
  assert.equal(adaTs.json.admin, true);
  assert.equal(adaTs.json.username, "ada_admin");
  assert.equal(adaTs.json.tailscaleLogin, "ada@example.com");
  assert.match(adaTs.json.token, accountTokenPattern);
  assert.equal(redact(`token=${adaTs.json.token}`).includes(adaTs.json.token), false);

  // Once an active admin exists, an unjoined remote device no longer gets `canBootstrap` and cannot bootstrap
  const postSetupUnjoined = await httpSend(port, "GET", "/api/collab", {
    host: "100.64.0.10:4311",
    authorization: `Bearer ${remotePaired.json.token}`,
  });
  assert.equal(postSetupUnjoined.json.canBootstrap, undefined);
  const secondBootstrap = await httpSend(
    port,
    "POST",
    "/api/collab/bootstrap",
    {
      host: "100.64.0.10:4311",
      authorization: `Bearer ${remotePaired.json.token}`,
    },
    { name: "Intruder" },
  );
  assert.equal(outcome(secondBootstrap), "403 adminOnly");

  const adaHeaders: Record<string, string> = {
    host: "100.64.0.10:4311",
    authorization: `Bearer ${remotePaired.json.token}`,
    [participantHeader]: adaTs.json.token,
  };

  // 4. Invite & register Ben over VPN without a prior device token -> mints deviceToken + account session
  const inviteBen = await httpSend(port, "POST", "/api/collab/invites", adaHeaders, {
    name: "Ben",
  });
  assert.equal(inviteBen.status, 201, inviteBen.body);

  const benReg = await httpSend(
    port,
    "POST",
    "/api/collab/auth/register",
    { host: "192.168.1.20:4311" },
    {
      code: inviteBen.json.code,
      username: "ben.dev",
      password: "correct-horse-battery",
      deviceName: "Ben Remote Browser",
    },
  );
  assert.equal(benReg.status, 201, benReg.body);
  assert.equal(benReg.json.username, "ben.dev");
  assert.match(benReg.json.token, accountTokenPattern);
  assert.match(benReg.json.deviceToken, /^bpd_/);

  // Subsequent login from another browser works with username + password
  const benLogin = await httpSend(
    port,
    "POST",
    "/api/collab/auth/login",
    { host: "100.64.0.10:4311" },
    {
      username: "BEN.DEV",
      password: "correct-horse-battery",
      deviceName: "Ben Tablet",
    },
  );
  assert.equal(benLogin.status, 200, benLogin.body);
  assert.equal(benLogin.json.id, benReg.json.id);

  const benHeaders: Record<string, string> = {
    host: "100.64.0.10:4311",
    authorization: `Bearer ${benLogin.json.deviceToken}`,
    [participantHeader]: benLogin.json.token,
  };

  // 5. Admin people & remote tool management: list, create account, pair code, edit identity, role guard (`lastAdmin`), disable & lockout
  const nonAdminPeople = await httpSend(port, "GET", "/api/collab/people", benHeaders);
  assert.equal(outcome(nonAdminPeople), "403 adminOnly");
  const nonAdminPairCode = await httpSend(port, "POST", "/api/pair/codes", benHeaders, {});
  assert.equal(nonAdminPairCode.status, 403);
  const remoteAdminPairCode = await httpSend(port, "POST", "/api/pair/codes", adaHeaders, {
    name: "Teammate Tablet",
  });
  assert.equal(remoteAdminPairCode.status, 201, remoteAdminPairCode.body);
  assert.equal(typeof remoteAdminPairCode.json.code, "string");

  const createCy = await httpSend(port, "POST", "/api/collab/people", adaHeaders, {
    name: "Cy",
    username: "cy_ops",
    password: "cy-initial-password",
    tailscaleLogin: "cy@example.com",
  });
  assert.equal(createCy.status, 201, createCy.body);
  assert.equal(createCy.json.person.username, "cy_ops");

  const renameCy = await httpSend(
    port,
    "PATCH",
    `/api/collab/people/${createCy.json.person.id}`,
    adaHeaders,
    { name: "Cy Ops" },
  );
  assert.equal(renameCy.status, 200);
  assert.equal(renameCy.json.person.name, "Cy Ops");

  const listed = await httpSend(port, "GET", "/api/collab/people", adaHeaders);
  assert.equal(listed.status, 200);
  assert.equal(listed.json.people.length, 3);

  // Sole admin cannot demote themselves (`409 lastAdmin`)
  const demoteLastAdmin = await httpSend(
    port,
    "PATCH",
    `/api/collab/people/${adaTs.json.id}`,
    adaHeaders,
    { admin: false },
  );
  assert.equal(outcome(demoteLastAdmin), "409 lastAdmin");

  // Promote Ben to admin, then demote Ben back to member
  const promoteBen = await httpSend(
    port,
    "PATCH",
    `/api/collab/people/${benReg.json.id}`,
    adaHeaders,
    { admin: true },
  );
  assert.equal(promoteBen.status, 200);
  assert.equal(promoteBen.json.person.admin, true);

  const demoteBen = await httpSend(
    port,
    "PATCH",
    `/api/collab/people/${benReg.json.id}`,
    adaHeaders,
    { admin: false },
  );
  assert.equal(demoteBen.status, 200);
  assert.equal(Boolean(demoteBen.json.person.admin), false);

  // Disable Ben -> revokes sessions and locks Ben out immediately
  const disableBen = await httpSend(
    port,
    "PATCH",
    `/api/collab/people/${benReg.json.id}`,
    adaHeaders,
    { disabled: true },
  );
  assert.equal(disableBen.status, 200);
  assert.equal(disableBen.json.person.disabled, true);

  const benAfterDisable = await httpSend(port, "GET", "/api/collab/projects", benHeaders);
  assert.equal(outcome(benAfterDisable), "403 notJoined");

  const benLoginDisabled = await httpSend(
    port,
    "POST",
    "/api/collab/auth/login",
    { host: "100.64.0.10:4311" },
    { username: "ben.dev", password: "correct-horse-battery" },
  );
  assert.equal(outcome(benLoginDisabled), "403 invalidCredentials");
});

test("Intra-file #Lstart-Lend concurrent holds and diff hunk write guards (Req 1a & 1b)", async (t: TestContext) => {
  const f = await collabFixture(t);
  const cast = await f.cast();
  const sources = await mkdtemp(path.join(os.tmpdir(), "bell-collab-lines-"));
  t.after(() => rm(sources, { recursive: true, force: true }));

  const initialLines = Array.from({ length: 50 }, (_, idx) => `export const line${idx + 1} = ${idx + 1};`).join("\n") + "\n";
  const folder = await createGitRepo(sources, "shared-repo", {
    "src/service.ts": initialLines,
  });
  const repo = await f.workbench.importRepository(folder);
  const added = await f.post("/projects", cast.who.admin, { repoId: repo.id });
  assert.equal(added.status, 201, added.body);
  const projectId = added.json.project.id as string;

  // Ada holds lines 1-15 of src/service.ts
  const adaHold = await f.post(`/projects/${projectId}/work`, cast.who.admin, {
    title: "Refactor header helpers",
    scopes: ["src/service.ts#L1-L15"],
  });
  assert.equal(adaHold.status, 201, adaHold.body);
  assert.deepEqual(adaHold.json.hold.scopes, ["src/service.ts#L1-L15"]);

  // Ben concurrently holds non-overlapping lines 30-45 of the SAME file -> 201!
  const benHold = await f.post(`/projects/${projectId}/work`, cast.who.member, {
    title: "Add footer handler",
    scopes: ["src/service.ts#L30-L45"],
  });
  assert.equal(benHold.status, 201, benHold.body);
  assert.deepEqual(benHold.json.hold.scopes, ["src/service.ts#L30-L45"]);

  // Overlapping range #L10-L35 is refused with 409 conflict naming Ada & Ben
  const overlap = await f.post(`/projects/${projectId}/work`, cast.who.member, {
    title: "Touch middle",
    scopes: ["src/service.ts#L10-L20"],
  });
  assert.equal(outcome(overlap), "409 conflict");
  assert.equal(overlap.json.conflicts[0].holder, "Ada");
  assert.equal(overlap.json.conflicts[0].scope, "src/service.ts#L1-L15");

  // Create a Run owned by Ben on a separate branch in `folder`
  const baseSha = (await git(folder, ["rev-parse", "HEAD"])).stdout.trim();
  await git(folder, ["checkout", "-q", "-b", "feat/ben-footer"]);
  const run: Run = {
    id: "run-ben-lines",
    repoId: repo.id,
    owners: [cast.ben.id],
    title: "Ben footer edits",
    prompt: "Update footer lines",
    status: "review",
    branch: "feat/ben-footer",
    baseBranch: "main",
    baseSha,
    worktreePath: folder,
    createdAt: new Date().toISOString(),
    agents: [],
    logs: [],
    draft: {
      title: "feat: footer",
      body: "Updates footer lines.",
      commitMessage: "feat: footer",
    },
    reviewedFiles: [],
    reviewedFingerprints: {},
  };
  f.store.data.runs.push(run);
  await f.store.save();

  // Case A: Ben edits line 35 (inside Ben's #L30-L45, outside Ada's #L1-L15) -> 0 conflicts!
  const safeLines = initialLines
    .split("\n")
    .map((line, idx) => (idx === 34 ? "export const line35 = 3500;" : line))
    .join("\n");
  await writeFile(path.join(folder, "src/service.ts"), safeLines, "utf8");

  const safeScopes = await changedScopes(run);
  assert.deepEqual(safeScopes, ["src/service.ts#L35-L35"]);
  const rh = runHolds(f.collab);
  assert.deepEqual(rh.conflicts(run, safeScopes), []);

  const safeFiles = await f.workbench.diff(run.id);
  const guardForBen = holdGuard(f.collab, { participant: cast.ben.token });
  assert.deepEqual(guardForBen.preflight(run, safeFiles), []);

  // Case B: Ben also edits line 8 (inside Ada's #L1-L15) -> blocked by Ada's line-range hold!
  const clashingLines = safeLines
    .split("\n")
    .map((line, idx) => (idx === 7 ? "export const line8 = 8000;" : line))
    .join("\n");
  await writeFile(path.join(folder, "src/service.ts"), clashingLines, "utf8");

  const clashingScopes = await changedScopes(run);
  assert.deepEqual(clashingScopes, ["src/service.ts#L8-L8", "src/service.ts#L35-L35"]);
  const turnConflicts = rh.conflicts(run, clashingScopes);
  assert.equal(turnConflicts.length, 1);
  assert.equal(turnConflicts[0].holder, "Ada");
  assert.equal(turnConflicts[0].scope, "src/service.ts#L1-L15");

  const clashingFiles = await f.workbench.diff(run.id);
  assert.ok(changedLineRanges(clashingFiles[0].patch).some((r) => r.start === 8 && r.end === 8));
  const preflightBlocks = guardForBen.preflight(run, clashingFiles);
  assert.equal(preflightBlocks.length, 1);
  assert.equal(preflightBlocks[0].id, "held-by-other");
});

test("Cross-file dependencies: static import scan, block guard, and warn preflight confirm (Req 1c)", async (t: TestContext) => {
  const f = await collabFixture(t);
  const cast = await f.cast();
  const sources = await mkdtemp(path.join(os.tmpdir(), "bell-collab-deps-"));
  t.after(() => rm(sources, { recursive: true, force: true }));

  const folder = await createGitRepo(sources, "deps-repo", {
    "src/schema.ts": "export interface User { id: string; }\n",
    "src/routes.ts": "import type { User } from './schema.js';\nexport const list = (): User[] => [];\n",
  });
  const repo = await f.workbench.importRepository(folder);
  const added = await f.post("/projects", cast.who.admin, { repoId: repo.id });
  assert.equal(added.status, 201, added.body);
  const projectId = added.json.project.id as string;

  // 1. Static import scan finds src/routes.ts -> src/schema.ts
  const scanned = await f.send(
    "GET",
    `/api/collab/projects/${projectId}/dependencies?scan=1`,
    cast.who.admin,
  );
  assert.equal(scanned.status, 200, scanned.body);
  assert.deepEqual(scanned.json.detectedImports, [
    { from: "src/routes.ts", to: "src/schema.ts" },
  ]);

  // 2. Ada holds src/schema.ts; Ben checking src/routes.ts with scanImports=true gets auto-detected warning
  const adaHold = await f.post(`/projects/${projectId}/work`, cast.who.admin, {
    title: "Evolve User schema",
    scopes: ["src/schema.ts"],
  });
  assert.equal(adaHold.status, 201);

  const checkAuto = await f.post(`/projects/${projectId}/check`, cast.who.member, {
    scopes: ["src/routes.ts"],
    scanImports: true,
  });
  assert.equal(checkAuto.status, 200, checkAuto.body);
  assert.equal(checkAuto.json.dependencyHits?.length, 1);
  assert.equal(checkAuto.json.dependencyHits[0].autoDetected, true);
  assert.equal(checkAuto.json.dependencyHits[0].mode, "warn");
  assert.equal(checkAuto.json.dependencyHits[0].holder, "Ada");
  assert.equal(checkAuto.json.dependencyHits[0].heldPath, "src/schema.ts");

  // 3. Ada registers an active `block` guard between src/routes.ts and src/schema.ts
  const createdDep = await f.post(`/projects/${projectId}/dependencies`, cast.who.admin, {
    from: "src/routes.ts",
    to: "src/schema.ts",
    mode: "block",
    note: " breaking User shape change ",
  });
  assert.equal(createdDep.status, 201, createdDep.body);
  const depId = createdDep.json.dependency.id as string;

  // Ben trying to take a hold on src/routes.ts is actively refused (`409 dependencyBlocked`)
  const blockedWork = await f.post(`/projects/${projectId}/work`, cast.who.member, {
    title: "Edit routes",
    scopes: ["src/routes.ts"],
  });
  assert.equal(outcome(blockedWork), "409 dependencyBlocked");
  assert.equal(blockedWork.json.dependencyHits[0].mode, "block");

  // Agent turn / publish write guard also blocks modifying src/routes.ts while Ada holds src/schema.ts
  const baseSha = (await git(folder, ["rev-parse", "HEAD"])).stdout.trim();
  await git(folder, ["checkout", "-q", "-b", "feat/routes-update"]);
  await writeFile(
    path.join(folder, "src/routes.ts"),
    "import type { User } from './schema.js';\nexport const list = (): User[] => [{ id: '1' }];\n",
    "utf8",
  );
  const run: Run = {
    id: "run-ben-deps",
    repoId: repo.id,
    owners: [cast.ben.id],
    title: "Update routes",
    prompt: "Update routes",
    status: "review",
    branch: "feat/routes-update",
    baseBranch: "main",
    baseSha,
    worktreePath: folder,
    createdAt: new Date().toISOString(),
    agents: [],
    logs: [],
    draft: {
      title: "feat: update routes",
      body: "Updates routes.",
      commitMessage: "feat: update routes",
    },
    reviewedFiles: [],
    reviewedFingerprints: {},
  };
  f.store.data.runs.push(run);
  await f.store.save();

  const rh = runHolds(f.collab);
  const depConflicts = rh.conflicts(run, ["src/routes.ts#L2-L2"]);
  assert.equal(depConflicts.length, 1);
  assert.equal(depConflicts[0].viaDependency, "src/schema.ts");
  assert.ok(rh.scope(run)?.others.includes("src/routes.ts"));

  // 4. Downgrade rule to `warn`: hold is permitted and preflight surfaces `collab-dependency-warn` confirm
  const downgraded = await f.post(`/projects/${projectId}/dependencies`, cast.who.admin, {
    from: "src/routes.ts",
    to: "src/schema.ts",
    mode: "warn",
    note: "Coordinate User fields with Ada",
  });
  assert.equal(downgraded.status, 201);
  assert.equal(downgraded.json.dependency.id, depId);

  const allowedWork = await f.post(`/projects/${projectId}/work`, cast.who.member, {
    title: "Edit routes carefully",
    scopes: ["src/routes.ts"],
  });
  assert.equal(allowedWork.status, 201, allowedWork.body);

  const preflight = await f.send("GET", `/api/runs/${run.id}/preflight`, {
    ...cast.who.member,
    "x-bell-locale": "en",
  });
  assert.equal(preflight.status, 200, preflight.body);
  const warnCheck = (preflight.json.checks as DraftCheck[]).find(
    (c) => c.id === "collab-dependency-warn",
  );
  assert.ok(warnCheck, "expected collab-dependency-warn preflight check");
  assert.equal(warnCheck.kind, "confirm");
  assert.ok(warnCheck.details?.some((d) => d.includes("src/schema.ts") && d.includes("Ada")));

  // Deleting the dependency rule clears it from the board
  const deleted = await f.send(
    "DELETE",
    `/api/collab/projects/${projectId}/dependencies/${depId}`,
    cast.who.admin,
  );
  assert.equal(deleted.status, 200);
});

test("Real-time member presence & live progress visibility (Req 2)", async (t: TestContext) => {
  const f = await collabFixture(t);
  const cast = await f.cast();
  const sources = await mkdtemp(path.join(os.tmpdir(), "bell-collab-presence-"));
  t.after(() => rm(sources, { recursive: true, force: true }));

  const folder = await createGitRepo(sources, "presence-repo", { "README.md": "Hi\n" });
  const repo = await f.workbench.importRepository(folder);
  const added = await f.post("/projects", cast.who.admin, { repoId: repo.id });
  assert.equal(added.status, 201);
  const projectId = added.json.project.id as string;

  const postActivity = await f.post("/activity", cast.who.member, {
    repoId: repo.id,
    view: "changes",
    runId: "run-42",
    runTitle: "Investigate token refresh",
    runStatus: "review",
    filePath: "src/auth/refresh.ts",
    lineStart: 18,
    lineEnd: 42,
  });
  assert.equal(postActivity.status, 200, postActivity.body);

  const live = await f.send(
    "GET",
    `/api/collab/activity?repoId=${encodeURIComponent(repo.id)}`,
    cast.who.admin,
  );
  assert.equal(live.status, 200, live.body);
  assert.equal(live.json.activities.length, 1);
  assert.deepEqual(
    {
      id: live.json.activities[0].id,
      name: live.json.activities[0].name,
      view: live.json.activities[0].view,
      runId: live.json.activities[0].runId,
      filePath: live.json.activities[0].filePath,
      lineStart: live.json.activities[0].lineStart,
      lineEnd: live.json.activities[0].lineEnd,
    },
    {
      id: cast.ben.id,
      name: "Ben",
      view: "changes",
      runId: "run-42",
      filePath: "src/auth/refresh.ts",
      lineStart: 18,
      lineEnd: 42,
    },
  );

  // Also delivered inline on the project feed response
  const feed = await f.send("GET", `/api/collab/projects/${projectId}/feed`, cast.who.admin);
  assert.equal(feed.status, 200, feed.body);
  assert.equal(feed.json.activities.length, 1);
  assert.equal(feed.json.activities[0].filePath, "src/auth/refresh.ts");
});

test("Team review sign-offs, rationales, handoff TODOs, preflight gate, and learning export (Req 3a, 3b, 3c)", async (t: TestContext) => {
  const f = await collabFixture(t);
  const cast = await f.cast();
  const sources = await mkdtemp(path.join(os.tmpdir(), "bell-collab-records-"));
  t.after(() => rm(sources, { recursive: true, force: true }));

  const folder = await createGitRepo(sources, "records-repo", {
    "src/handler.ts": "export function handle() {\n  return 'v1';\n}\n",
  });
  const repo = await f.workbench.importRepository(folder);
  const added = await f.post("/projects", cast.who.admin, { repoId: repo.id });
  assert.equal(added.status, 201);
  const projectId = added.json.project.id as string;

  const baseSha = (await git(folder, ["rev-parse", "HEAD"])).stdout.trim();
  await git(folder, ["checkout", "-q", "-b", "feat/handler-v2"]);
  await writeFile(
    path.join(folder, "src/handler.ts"),
    "export function handle() {\n  return 'v2-retry-safe';\n}\n",
    "utf8",
  );

  const run: Run = {
    id: "run-team-records",
    repoId: repo.id,
    owners: [cast.ben.id],
    title: "Make handler retry-safe",
    prompt: "Make handler retry-safe",
    status: "review",
    branch: "feat/handler-v2",
    baseBranch: "main",
    baseSha,
    worktreePath: folder,
    createdAt: new Date().toISOString(),
    agents: [],
    logs: [],
    draft: {
      title: "feat: retry-safe handler",
      body: "Ensures idempotency.",
      commitMessage: "feat: retry-safe handler",
    },
    reviewedFiles: [],
    reviewedFingerprints: {},
  };
  f.store.data.runs.push(run);
  await f.store.save();

  const files = await f.workbench.diff(run.id);
  assert.equal(files.length, 1);
  const fp = files[0].fingerprint;

  // 3(a) Ben marks the file reviewed via `/review` (populating both reviewedFiles and teamRecords),
  // and Ada adds her teammate sign-off via `/team-review`
  const benSign = await f.send("POST", `/api/runs/${run.id}/review`, cast.who.member, {
    filePath: "src/handler.ts",
    reviewed: true,
    fingerprint: fp,
  });
  assert.equal(benSign.status, 200, benSign.body);

  const adaSign = await f.send("POST", `/api/runs/${run.id}/team-review`, cast.who.admin, {
    filePath: "src/handler.ts",
    reviewed: true,
    fingerprint: fp,
  });
  assert.equal(adaSign.status, 200, adaSign.body);
  assert.deepEqual(
    adaSign.json.run.teamRecords.fileReviews["src/handler.ts"].map(
      (r: { reviewerName: string }) => r.reviewerName,
    ),
    ["Ben", "Ada"],
  );
  assert.ok(adaSign.json.run.reviewedFiles.includes("src/handler.ts"));

  // 3(b) Ben leaves a rationale note explaining why the change was made
  const noteReply = await f.send("POST", `/api/runs/${run.id}/team-rationales`, cast.who.member, {
    filePath: "src/handler.ts",
    lineStart: 1,
    lineEnd: 3,
    text: "Switched to idempotent response token so VPN retries cannot double-submit.",
  });
  assert.equal(noteReply.status, 201, noteReply.body);
  assert.equal(noteReply.json.run.teamRecords.rationales.length, 1);
  assert.equal(noteReply.json.run.teamRecords.rationales[0].authorName, "Ben");

  // 3(c) Ben leaves a handoff TODO assigned to Ada
  const todoReply = await f.send("POST", `/api/runs/${run.id}/team-todos`, cast.who.member, {
    filePath: "src/handler.ts",
    text: "Verify nginx timeout matches retry window on Ubuntu host",
    assigneeId: cast.ada.id,
    assigneeName: "Ada",
  });
  assert.equal(todoReply.status, 201, todoReply.body);
  const todoId = todoReply.json.run.teamRecords.todos[0].id as string;

  // Open TODO appears on the Group board (`openTodos`) AND in `/preflight` (`team-open-todos` confirm)
  const feedWithTodo = await f.send(
    "GET",
    `/api/collab/projects/${projectId}/feed`,
    cast.who.admin,
  );
  assert.equal(feedWithTodo.status, 200);
  assert.equal(feedWithTodo.json.board.openTodos.length, 1);
  assert.equal(feedWithTodo.json.board.openTodos[0].assigneeName, "Ada");

  const preflightOpen = await f.send("GET", `/api/runs/${run.id}/preflight`, {
    ...cast.who.member,
    "x-bell-locale": "en",
  });
  assert.equal(preflightOpen.status, 200, preflightOpen.body);
  const openTodoCheck = (preflightOpen.json.checks as DraftCheck[]).find(
    (c) => c.id === "team-open-todos",
  );
  assert.ok(openTodoCheck, "expected team-open-todos confirm check while TODO is open");
  assert.equal(openTodoCheck.kind, "confirm");

  // Markdown learning export includes reviewers, rationales, and TODOs in both en and zh-TW
  const exportEn = await f.send("GET", `/api/runs/${run.id}/export.md`, {
    ...cast.who.admin,
    "x-bell-locale": "en",
  });
  assert.equal(exportEn.status, 200);
  assert.match(exportEn.body, /Team review and coordination records/);
  assert.match(exportEn.body, /Switched to idempotent response token/);
  assert.match(exportEn.body, /Verify nginx timeout matches retry window/);

  const exportZh = await f.send("GET", `/api/runs/${run.id}/export.md`, {
    ...cast.who.admin,
    "x-bell-locale": "zh-TW",
  });
  assert.equal(exportZh.status, 200);
  assert.match(exportZh.body, /團隊審閱與協調紀錄/);

  // Ada marks the handoff TODO done -> clears from `board.openTodos` and `/preflight`
  const doneReply = await f.send(
    "PATCH",
    `/api/runs/${run.id}/team-todos/${todoId}`,
    cast.who.admin,
    { done: true },
  );
  assert.equal(doneReply.status, 200, doneReply.body);
  assert.equal(doneReply.json.run.teamRecords.todos[0].done, true);
  assert.equal(doneReply.json.run.teamRecords.todos[0].doneBy, "Ada");

  const feedAfterDone = await f.send(
    "GET",
    `/api/collab/projects/${projectId}/feed`,
    cast.who.admin,
  );
  assert.deepEqual(feedAfterDone.json.board.openTodos ?? [], []);

  const preflightDone = await f.send("GET", `/api/runs/${run.id}/preflight`, {
    ...cast.who.member,
    "x-bell-locale": "en",
  });
  assert.equal(
    (preflightDone.json.checks as DraftCheck[]).some((c) => c.id === "team-open-todos"),
    false,
  );

  // Modifying `src/handler.ts` invalidates stale fingerprint sign-offs automatically
  await writeFile(
    path.join(folder, "src/handler.ts"),
    "export function handle() {\n  return 'v3-changed-again';\n}\n",
    "utf8",
  );
  await f.workbench.diff(run.id);
  const refreshedRun = f.workbench.run(run.id);
  assert.equal(refreshedRun.teamRecords?.fileReviews?.["src/handler.ts"], undefined);
});
