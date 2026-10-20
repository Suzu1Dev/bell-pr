// The Learn-by-hand routes over HTTP (server/routes/by-hand.ts): strict
// request schemas, a 409 for a run that is not Learn by hand, and open on
// the Free plan (W2 fills their work; no route answers 501 any more).
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { createApp } from "./index.js";
import { fixedLicense } from "./license.js";
import { Store } from "./store.js";
import type { Run } from "./types.js";
import { Workbench } from "./workbench.js";

const repoId = "5b5b5b5b-5b5b-45b5-85b5-5b5b5b5b5b5b";

function run(id: string, learnByHand: boolean): Run {
  return {
    id,
    repoId,
    title: "Retry GET requests",
    prompt: "Retry GET requests after a 503.",
    status: "review",
    branch: `fix/${id}`,
    baseBranch: "main",
    baseSha: "a".repeat(40),
    worktreePath: "/nonexistent/worktree",
    createdAt: "2026-10-20T00:00:00.000Z",
    locale: "en",
    agents: [],
    logs: [],
    draft: { title: "Retry GET requests", body: "" },
    reviewedFiles: [],
    reviewedFingerprints: {},
    ...(learnByHand ? { learnByHand: true as const } : {}),
  };
}

async function serve(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-by-hand-routes-"));
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  store.data.repos.push({
    id: repoId,
    name: "widgets",
    owner: "local",
    fullName: "local/widgets",
    path: path.join(directory, "repo"),
    defaultBranch: "main",
    url: "",
  });
  store.data.runs.push(run("lbh-run", true), run("agent-run", false));
  const workbench = new Workbench(store);
  const app = createApp(workbench, {
    staticDirectory: path.join(directory, "missing"),
    license: fixedLicense("free"),
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.locals.insights.shutdown();
    await app.locals.discovery.shutdown();
    await workbench.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  return (method: string, endpoint: string, body?: unknown) =>
    new Promise<{ status: number; body: Record<string, ReturnType<typeof JSON.parse>> }>((resolve, reject) => {
      const text = body === undefined ? undefined : JSON.stringify(body);
      const req = request(
        `http://127.0.0.1:${port}/api${endpoint}`,
        {
          method,
          headers: {
            "Content-Type": "application/json",
            Host: "127.0.0.1:4311",
            "X-Bell-Locale": "en",
            ...(text === undefined ? {} : { "Content-Length": Buffer.byteLength(text) }),
          },
        },
        (response) => {
          let received = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => (received += chunk));
          response.on("end", () =>
            resolve({ status: response.statusCode!, body: received ? JSON.parse(received) : {} }),
          );
        },
      );
      req.on("error", reject);
      req.end(text);
    });
}

/** Every run route of DESIGN v1.2 §8, with a valid body. */
const runRoutes: { method: string; path: string; body?: Record<string, unknown> }[] = [
  { method: "PUT", path: "by-hand/plan", body: { steps: [{ title: "Read the retry loop" }], tests: "A fake 503." } },
  { method: "POST", path: "by-hand/plan/reveal", body: { mode: "names" } },
  { method: "POST", path: "by-hand/plan/questions", body: {} },
  { method: "PATCH", path: "by-hand/steps/s1", body: { done: true, why: "Only GET is idempotent here." } },
  { method: "POST", path: "by-hand/guide", body: { kind: "hint", stepId: "s1", rung: 1, tried: "I read the loop" } },
  { method: "POST", path: "by-hand/check-ins", body: { stepId: "s1", signal: "button", choice: "talk" } },
  { method: "GET", path: "by-hand/test-command" },
  { method: "POST", path: "by-hand/tests", body: { prediction: "fail", expect: "retries a 503" } },
  { method: "GET", path: "by-hand/tests/live" },
  { method: "POST", path: "by-hand/tests/stop", body: {} },
  { method: "POST", path: "by-hand/tests/report", body: { outcome: "passed", output: "ok 3" } },
  { method: "POST", path: "by-hand/ready", body: { changeFingerprint: "0123456789abcdef", review: true } },
  { method: "POST", path: "by-hand/leave", body: {} },
  { method: "GET", path: "by-hand/template" },
];

test("every Learn-by-hand request schema is strict: an extra field is a 400", async (t) => {
  const call = await serve(t);
  for (const route of runRoutes.filter((entry) => entry.body)) {
    for (const id of ["lbh-run", "agent-run"]) {
      const response = await call(route.method, `/runs/${id}/${route.path}`, { ...route.body, learnByHand: true });
      assert.equal(response.status, 400, `${route.method} ${route.path} on ${id}`);
    }
  }
  assert.equal((await call("PUT", `/repos/${repoId}/test-command`, { command: "npm test", helpLock: {} })).status, 400);
  // Wrong shapes are refused the same way.
  assert.equal((await call("PUT", "/runs/lbh-run/by-hand/plan", { steps: [] })).status, 400);
  assert.equal((await call("POST", "/runs/lbh-run/by-hand/guide", { kind: "hint", rung: 5 })).status, 400);
  assert.equal((await call("POST", "/runs/lbh-run/by-hand/ready", { changeFingerprint: "nope", review: true })).status, 400);
  assert.equal((await call("PUT", `/repos/${repoId}/test-command`, { command: "x".repeat(301) })).status, 400);
});

test("every Learn-by-hand run route refuses an agent run with 409, and works on the Free plan", async (t) => {
  const call = await serve(t);
  for (const route of runRoutes) {
    const refused = await call(route.method, `/runs/agent-run/${route.path}`, route.body);
    assert.equal(refused.status, 409, `${route.method} ${route.path}`);
    assert.equal(refused.body.error, "This is only for Learn-by-hand runs.");
    // On a Learn-by-hand run every route is filled (W2A, W2B, W2C): never 402 or pro_required.
    const answered = await call(route.method, `/runs/lbh-run/${route.path}`, route.body);
    const seen = `${route.method} ${route.path}: ${answered.status} ${answered.body.error ?? ""}`;
    assert.notEqual(answered.status, 402, seen);
    assert.notEqual(answered.body.code, "pro_required", seen);
    assert.notEqual(answered.status, 501, seen);
  }
  // The guide's own refusals for the seeded run (in review, with no plan of its own).
  const questions = await call("POST", "/runs/lbh-run/by-hand/plan/questions", {});
  assert.deepEqual([questions.status, questions.body.error], [409, "The guide asks about your plan before you confirm it."]);
  const hint = await call("POST", "/runs/lbh-run/by-hand/guide", { kind: "hint", stepId: "s1", rung: 1, tried: "I read the loop" });
  assert.deepEqual([hint.status, hint.body.error], [409, "Choose a step of your plan for this hint."]);
  const confirmed = await call("PUT", `/repos/${repoId}/test-command`, { command: "npm test" });
  assert.notEqual(confirmed.status, 402);
  assert.notEqual(confirmed.body.code, "pro_required");
  assert.notEqual(confirmed.status, 501);
  assert.equal((await call("PUT", "/repos/missing/test-command", { command: "npm test" })).status, 404);
  assert.equal((await call("GET", "/runs/missing/by-hand/template")).status, 404);
});

test("no Learn-by-hand route is gated by plan", async () => {
  const source = await readFile(path.join(import.meta.dirname, "routes", "by-hand.ts"), "utf8");
  assert.doesNotMatch(source, /requirePro|assertModelEntitlement/);
});
