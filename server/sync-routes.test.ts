import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { request } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { createApp } from "./app.js";
import { Store } from "./store.js";
import { Workbench } from "./workbench.js";
import type { Repository, Run } from "./types.js";

/** One request to the local app with the host header the guard trusts. */
function call(
  port: number,
  method: string,
  pathname: string,
  body?: unknown,
  contentType = "application/json",
) {
  return new Promise<{ status: number; json: Record<string, unknown> }>(
    (resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = request(
        {
          host: "127.0.0.1",
          port,
          method,
          path: pathname,
          headers: {
            host: "127.0.0.1:4311",
            ...(payload !== undefined ? { "content-type": contentType } : {}),
          },
        },
        (response) => {
          let text = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => (text += chunk));
          response.on("end", () =>
            resolve({ status: response.statusCode ?? 0, json: JSON.parse(text) }),
          );
        },
      );
      req.on("error", reject);
      req.end(payload);
    },
  );
}

const repository: Repository = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "example",
  owner: "test-owner",
  fullName: "test-owner/example",
  // The person's own checkout: BELL never updates it.
  path: "/tmp/bell-routes-test/example",
  defaultBranch: "main",
  url: "https://github.com/test-owner/example",
};

const run = (id: string, status: Run["status"]): Run => ({
  id,
  repoId: repository.id,
  title: "Update hello",
  prompt: "Update hello",
  status,
  branch: `fix/${id}`,
  baseBranch: "main",
  baseSha: "a".repeat(40),
  worktreePath: `/tmp/bell-routes-test/worktrees/${id}`,
  createdAt: "2026-10-13T00:00:00.000Z",
  agents: [],
  logs: [],
  draft: { title: "fix: update hello", body: "Changes hello." },
  reviewedFiles: [],
  reviewedFingerprints: {},
});

test("sync, follow-up and clone update routes validate input and answer refusals as JSON errors", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-sync-routes-"));
  const store = new Store(directory);
  await store.initialize();
  store.data.repos.push({ ...repository });
  store.data.runs.push(run("review", "review"), run("running", "running"));
  const workbench = new Workbench(store);
  const server = createApp(workbench, {
    staticDirectory: path.join(directory, "missing"),
  }).listen(0, "127.0.0.1");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await workbench.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;

  // A local import is listed as not updatable, and an update is refused.
  const list = await call(port, "GET", "/api/repos");
  assert.equal(list.status, 200);
  assert.deepEqual(
    (list.json.repos as { updatable: boolean }[]).map((repo) => repo.updatable),
    [false],
  );
  const update = await call(port, "POST", `/api/repos/${repository.id}/update`, {});
  assert.equal(update.status, 409);
  assert.match(String(update.json.error), /git pull/);

  const missing = await call(port, "POST", "/api/runs/nope/sync", {});
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error, "找不到工作。");
  const running = await call(port, "POST", "/api/runs/running/sync", {});
  assert.equal(running.status, 409);
  assert.match(String(running.json.error), /只有審閱中/);
  const undo = await call(port, "POST", "/api/runs/review/sync/undo", {});
  assert.equal(undo.status, 409);
  assert.match(String(undo.json.error), /沒有可以復原的同步/);
  const resolve = await call(port, "POST", "/api/runs/review/sync/resolve", {});
  assert.equal(resolve.status, 409);
  assert.match(String(resolve.json.error), /沒有需要解決的同步衝突/);

  // Follow-up input is validated before the run is looked at.
  const url = "https://github.com/test-owner/example/pull/1#discussion_r";
  for (const body of [
    { feedbackUrls: Array.from({ length: 21 }, (_, index) => `${url}${index}`) },
    { feedbackUrls: ["not a url"] },
    { feedbackUrls: [], note: "x".repeat(2_001) },
    { feedbackUrls: [], note: "Rename it.", extra: true },
  ]) {
    const invalid = await call(port, "POST", "/api/runs/review/follow-ups", body);
    assert.equal(invalid.status, 400, JSON.stringify(body).slice(0, 80));
    assert.equal(typeof invalid.json.error, "string");
  }
  const unpublished = await call(port, "POST", "/api/runs/review/follow-ups", {
    feedbackUrls: [],
    note: "Rename it.",
  });
  assert.equal(unpublished.status, 409);
  assert.match(String(unpublished.json.error), /只有已送出 PR 的工作/);
  const discard = await call(port, "POST", "/api/runs/review/follow-ups/discard", {});
  assert.equal(discard.status, 409);
  assert.match(String(discard.json.error), /沒有可以放棄的修正/);
  // Mutations go through the same guard as every other route.
  const plain = await call(port, "POST", "/api/runs/review/sync", {}, "text/plain");
  assert.equal(plain.status, 415);
  assert.deepEqual(store.data.runs.map((entry) => entry.status), ["review", "running"]);
});
