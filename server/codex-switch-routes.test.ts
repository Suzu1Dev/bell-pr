// Switch off: every route that would start Codex answers 4xx and spawn is
// never given the Codex executable. There is no WebSocket API.
import test, { after, mock } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { defaultContributionSettings } from "../shared/insights.js";
import { setCodexEnabledForTests } from "../shared/codex-switch.js";
import { processSpawn } from "./process.js";

const spawned: string[] = [];

mock.method(processSpawn, "spawn", (executable: string) => {
  spawned.push(executable);
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: () => boolean; end: () => void; on: () => unknown };
    pid: number;
    kill: () => boolean;
    unref: () => void;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    write: () => true,
    end() {},
    on() {
      return this;
    },
  };
  child.pid = undefined as unknown as number;
  child.kill = () => true;
  child.unref = () => undefined;
  queueMicrotask(() => child.emit("close", 1, null));
  return child;
});

after(() => {
  setCodexEnabledForTests(true);
  mock.restoreAll();
});

test("with the switch off, Codex routes return 4xx and spawn no Codex process", async () => {
  setCodexEnabledForTests(false);
  spawned.length = 0;
  const { createApp } = await import("./index.js");
  const { Store } = await import("./store.js");
  const { Workbench } = await import("./workbench.js");
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-codex-off-"));
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const repoId = "11111111-1111-4111-8111-111111111111";
  const runId = "22222222-2222-4222-8222-222222222222";
  store.data.repos.push({
    id: repoId,
    name: "widgets",
    owner: "acme",
    fullName: "acme/widgets",
    path: path.join(directory, "repo"),
    defaultBranch: "main",
    url: "https://github.com/acme/widgets",
  });
  store.data.runs.push({
    id: runId,
    repoId,
    title: "Saved Codex run",
    prompt: "Start Codex from a saved run.",
    status: "review",
    branch: "fix/codex",
    baseBranch: "main",
    baseSha: "a".repeat(40),
    worktreePath: path.join(directory, "work"),
    createdAt: "2026-10-10T00:00:00.000Z",
    locale: "en",
    agents: [],
    logs: [],
    draft: { title: "Saved Codex run", body: "Body." },
    reviewedFiles: [],
    reviewedFingerprints: {},
    reports: {},
    modelExecution: { source: "cli-default" },
    team: {
      config: {
        maxTeammates: 3,
        requirePlanApproval: true,
        provider: "codex",
        protocol: "bell-shared-tasks",
        messageDelivery: "between-turns",
      },
      phase: "developing",
      planSummary: "",
      tasks: [],
      messages: [],
    },
  });
  await writeFile(
    path.join(store.directory, "model-settings.json"),
    JSON.stringify({ provider: "codex", model: "", reasoningEffort: "" }),
  );
  const workbench = new Workbench(store);
  const app = createApp(workbench, { staticDirectory: path.join(directory, "missing") });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const call = (method: string, endpoint: string, body?: unknown) =>
    new Promise<{ status: number }>((resolve, reject) => {
      const text = body === undefined ? undefined : JSON.stringify(body);
      const req = request(
        `http://127.0.0.1:${port}${endpoint}`,
        {
          method,
          headers: {
            host: "127.0.0.1:4311",
            "x-bell-locale": "en",
            ...(text
              ? { "content-type": "application/json", "content-length": Buffer.byteLength(text) }
              : {}),
          },
        },
        (response) => {
          response.resume();
          response.on("end", () => resolve({ status: response.statusCode ?? 0 }));
        },
      );
      req.on("error", reject);
      req.end(text);
    });
  const settings = { ...defaultContributionSettings, provider: "codex" as const };
  const routes: Array<[string, string, unknown?]> = [
    ["PUT", "/api/model-settings", { provider: "codex", model: "", reasoningEffort: "" }],
    ["PUT", `/api/repos/${repoId}/settings`, settings],
    ["POST", "/api/runs", { repoId, prompt: "Please start a Codex run.", settings }],
    ["POST", "/api/runs", { repoId, prompt: "Please start from saved settings." }],
    ["GET", "/api/models"],
    ["GET", "/api/models?provider=codex"],
    ["POST", `/api/repos/${repoId}/insights`],
    ["POST", `/api/repos/${repoId}/insights/recommendations`, {}],
    ["POST", "/api/discovery", { provider: "codex" }],
    ["POST", "/api/discovery", {}],
    ["POST", `/api/runs/${runId}/team/retry`, {}],
    ["POST", `/api/runs/${runId}/follow-ups`, { feedbackUrls: [], note: "Again." }],
    ["POST", `/api/runs/${runId}/review/rerun`],
    ["POST", `/api/runs/${runId}/explanations`, {}],
    ["POST", `/api/runs/${runId}/chat`, { filePath: "src/a.ts", question: "Why?" }],
    ["POST", `/api/runs/${runId}/walkthroughs`, { filePath: "src/a.ts" }],
    ["POST", `/api/runs/${runId}/premise`],
    ["POST", `/api/runs/${runId}/sync/resolve`],
    ["POST", `/api/runs/${runId}/draft/prepare`, {}],
    ["POST", `/api/runs/${runId}/by-hand/guide`, { kind: "ask", question: "Why?" }],
    ["POST", "/api/learning/debrief", { repoId }],
    ["GET", "/api/doctor"],
    ["GET", "/api/status"],
  ];
  try {
    for (const [method, endpoint, body] of routes) {
      const before = spawned.length;
      const result = await call(method, endpoint, body);
      const codexSpawn = spawned.slice(before).some((executable) =>
        /(?:^|[\\/])codex(?:\.exe)?$/.test(executable),
      );
      if (endpoint === "/api/doctor" || endpoint === "/api/status") {
        assert.equal(result.status, 200, endpoint);
        assert.equal(codexSpawn, false, endpoint);
      } else {
        assert.ok(result.status >= 400 && result.status < 500, `${method} ${endpoint} -> ${result.status}`);
        assert.equal(codexSpawn, false, `${method} ${endpoint} spawned Codex`);
      }
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.locals.insights.shutdown();
    await app.locals.discovery.shutdown();
    await workbench.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});
