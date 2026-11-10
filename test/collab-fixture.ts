/**
 * BELL PR with group work on a temporary data directory, for the tests of
 * the group routes (server/collab-routes.test.ts and
 * server/collab-board-routes.test.ts): real requests through the request
 * guard, synthetic tokens only, and a spy on the log that remembers every
 * line next to every code and token the server handed out.
 */
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { request, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { inspect } from "node:util";
import type { CollabJoinResponse } from "../shared/collab.js";
import { loadOrCreateApiToken } from "../server/api-token.js";
import { createApp } from "../server/app.js";
import { openCollabHost, type CollabHost } from "../server/collab-host.js";
import { dataPaths } from "../server/config.js";
import { participantHeader } from "../server/coordination-routes.js";
import type { CoordinatorOptions } from "../server/coordination.js";
import { acquireWriterLock } from "../server/index.js";
import { log } from "../server/log.js";
import { normalizePairCode } from "../server/pairing.js";
import { Store } from "../server/store.js";
import { Workbench } from "../server/workbench.js";

export type Headers = Record<string, string>;
/** A response; `json` is loose so each test reads the fields it checks. */
export interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
}
/** "403 notJoined", or "201" when the answer names no reason. */
export const outcome = (reply: Reply) =>
  [reply.status, reply.json?.reason].filter(Boolean).join(" ");

/** `limits` lowers the coordinator's limits, for tests that fill it up. */
export async function collabFixture(
  t: TestContext,
  { limits }: Pick<CoordinatorOptions, "limits"> = {},
) {
  const directory = await mkdtemp(path.join(tmpdir(), "bell-collab-routes-"));
  const file = path.join(directory, "api-token");
  const install: Headers = { authorization: `Bearer ${await loadOrCreateApiToken(file)}` };
  const paths = dataPaths(directory);
  /** Every line the server logged, and every code and token it handed out. */
  const logged: string[] = [];
  const secrets: string[] = [];
  for (const level of ["debug", "info", "warn", "error"] as const)
    t.mock.method(log, level, (...line: unknown[]) => {
      logged.push(inspect(line, { depth: 8 }));
    });

  let port = 0;
  let stop = async () => {};
  /** What the server now running was built from. */
  let live: { collab: CollabHost; store: Store };
  /** BELL PR with group work on this directory; called again, a restart (after `change`). */
  const start = async (change?: () => Promise<unknown>) => {
    await stop();
    await change?.();
    const lock = await acquireWriterLock(directory);
    const collab = await openCollabHost({ dataDir: directory, lock, ...(limits ? { limits } : {}) });
    const store = new Store(directory);
    await store.initialize();
    live = { collab, store };
    const workbench = new Workbench(store);
    const app = createApp(workbench, {
      staticDirectory: path.join(directory, "missing"),
      port: 4311,
      publicUrl: "https://bell.example.internal",
      apiTokenFile: file,
      collab,
    });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    port = (server.address() as AddressInfo).port;
    stop = async () => {
      stop = async () => {};
      await collab.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await app.locals.insights.shutdown();
      await app.locals.discovery.shutdown();
      await workbench.shutdown();
      lock.release();
    };
  };
  await start();
  t.after(async () => {
    await stop();
    await rm(directory, { recursive: true, force: true });
  });

  /** `signal` ends the request from the client's side: the promise then rejects. */
  const send = (
    method: string,
    urlPath: string,
    headers: Headers = {},
    body?: unknown,
    signal?: AbortSignal,
  ) =>
    new Promise<Reply>((resolve, reject) => {
      const text = body === undefined ? "" : JSON.stringify(body);
      const req = request(
        {
          host: "127.0.0.1",
          port,
          path: urlPath,
          method,
          signal,
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
            let json: Reply["json"];
            try {
              json = JSON.parse(data);
            } catch {
              json = undefined;
            }
            if (urlPath.startsWith("/api/collab"))
              for (const secret of [json?.code, json?.token])
                if (typeof secret === "string") secrets.push(secret);
            resolve({ status: res.statusCode!, headers: res.headers, body: data, json });
          });
        },
      );
      req.on("error", reject);
      req.end(text);
    });
  const post = (urlPath: string, who: Headers, body: unknown = {}) =>
    send("POST", `/api/collab${urlPath}`, who, body);
  const info = (who: Headers) => send("GET", "/api/collab", who);
  /** The headers of a newly paired device. */
  const device = async (name: string): Promise<Headers> => {
    const code = await send("POST", "/api/pair/codes", install, {});
    const paired = await send("POST", "/api/pair", {}, { code: code.json.code, name });
    assert.equal(paired.status, 201, paired.body);
    return { authorization: `Bearer ${paired.json.token}` };
  };
  const invite = async (who: Headers, body: unknown) => {
    const made = await post("/invites", who, body);
    assert.equal(made.status, 201, made.body);
    return made.json.code as string;
  };
  const join = async (who: Headers, code: string) => {
    const joined = await post("/join", who, { code });
    assert.equal(joined.status, 201, joined.body);
    return joined.json as CollabJoinResponse;
  };
  const withToken = (who: Headers, token: string): Headers => ({ ...who, [participantHeader]: token });
  const files = () =>
    Promise.all([paths.collab, paths.coordination].map((each) => readFile(each, "utf8")));

  /** The group set up, with an admin, a member and a removed person, each on a paired device. */
  const cast = async () => {
    const setup = await post("/setup", install);
    assert.equal(setup.status, 201, setup.body);
    const devices = {
      ada: await device("Phone A"),
      ben: await device("Laptop B"),
      cy: await device("Tablet C"),
      none: await device("Not joined"),
    };
    const ada = await join(devices.ada, await invite(install, { name: "Ada", admin: true }));
    const admin = withToken(devices.ada, ada.token);
    const ben = await join(devices.ben, await invite(admin, { name: "Ben" }));
    const cy = await join(devices.cy, await invite(admin, { name: "Cy" }));
    const removed = await post(`/people/${cy.id}/remove`, admin);
    assert.deepEqual([removed.status, removed.json], [200, { revoked: 0, unpaired: false }]);
    return {
      groupId: setup.json.groupId as string,
      ada,
      ben,
      cy,
      devices,
      who: {
        install,
        device: devices.none,
        member: withToken(devices.ben, ben.token),
        admin,
        removed: withToken(devices.cy, cy.token),
        stranger: withToken(devices.none, `bpc_${"s".repeat(43)}`),
      },
    };
  };

  /** No log line and neither file holds a code (as shown or as typed) or a participant token. */
  const nothingLeaked = async () => {
    assert.ok(secrets.length > 0);
    const kept = [...logged, ...(await files())].join("\n");
    assert.equal(/bpc_/.test(kept), false);
    for (const secret of secrets)
      for (const form of [secret, normalizePairCode(secret) ?? secret])
        assert.equal(kept.includes(form), false);
  };

  return {
    directory,
    paths,
    install,
    logged,
    /** The group's host and BELL PR's store, of the server now running. */
    get collab() {
      return live.collab;
    },
    get store() {
      return live.store;
    },
    start,
    send,
    post,
    info,
    device,
    invite,
    join,
    files,
    cast,
    nothingLeaked,
  };
}
