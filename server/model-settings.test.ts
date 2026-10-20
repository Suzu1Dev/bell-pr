import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { defaultContributionSettings } from "../shared/insights.js";
import type { ModelCatalog } from "../shared/models.js";
import { createApp } from "./index.js";
import { Store } from "./store.js";
import { Workbench } from "./workbench.js";

test("settings API shares one model and effort across repositories without starting runs and rejects unsupported pairs", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-model-settings-test-"));
  const cleanup: (() => Promise<void>)[] = [];
  t.after(async () => {
    for (const close of cleanup.reverse()) await close();
    await rm(directory, { recursive: true, force: true });
  });
  const catalog: ModelCatalog = {
    source: "codex",
    models: [
      { id: "test-balanced", name: "Balanced", description: "Test only", isDefault: true, reasoningEfforts: ["medium", "high"], defaultReasoningEffort: "medium" },
      { id: "test-fast", name: "Fast", description: "Test only", isDefault: false, reasoningEfforts: ["low"], defaultReasoningEffort: "low" },
    ],
  };
  let createRunCalls = 0;
  let catalogCalls = 0;
  async function start(store: Store) {
    const workbench = new Workbench(store);
    workbench.models = async () => { catalogCalls++; return catalog; };
    workbench.createRun = async () => { createRunCalls++; throw new Error("Settings must never start a run"); };
    const app = createApp(workbench, { staticDirectory: path.join(directory, "missing") });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    cleanup.push(async () => {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await app.locals.insights.shutdown();
      await app.locals.discovery.shutdown();
      await workbench.shutdown();
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    return (endpoint: string, body?: unknown) => new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = request(`http://127.0.0.1:${address.port}/api${endpoint}`, {
        method: body === undefined ? "GET" : "PUT",
        headers: { "Content-Type": "application/json", Host: "127.0.0.1:4311" },
      }, (res) => {
        let value = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { value += chunk; });
        res.on("end", () => resolve({ status: res.statusCode!, body: JSON.parse(value) }));
      });
      req.on("error", reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }

  const store = new Store(directory);
  await store.initialize();
  store.data.repos = ["first", "second"].map((name) => ({ id: randomUUID(), name, owner: "test", fullName: `test/${name}`, path: path.join(directory, name), defaultBranch: "main", url: "" }));
  await store.save();
  const [first, second] = store.data.repos;
  const api = await start(store);
  const firstSettings = { ...defaultContributionSettings, direction: "docs", outcome: "保留這個專案的貢獻目標", model: "test-balanced", reasoningEffort: "high" };
  const secondSettings = { ...defaultContributionSettings, model: "test-fast", reasoningEffort: "low" };
  const sharedModel = { model: "test-fast", reasoningEffort: "low" };
  assert.deepEqual(await api("/model-settings"), { status: 200, body: { settings: { model: "", reasoningEffort: "" } } });
  assert.deepEqual(await api(`/repos/${first.id}/settings`, firstSettings), { status: 200, body: { settings: firstSettings } });
  assert.deepEqual(await api(`/repos/${second.id}/settings`, secondSettings), { status: 200, body: { settings: secondSettings } });
  // The latest saved model applies to every project; project preferences stay separate.
  assert.deepEqual((await api(`/repos/${first.id}/settings`)).body.settings, { ...firstSettings, ...sharedModel });
  assert.deepEqual(await api("/model-settings"), { status: 200, body: { settings: sharedModel } });

  const restartedStore = new Store(directory);
  await restartedStore.initialize();
  const reloadedApi = await start(restartedStore);
  const balanced = { model: "test-balanced", reasoningEffort: "high" };
  assert.deepEqual(await reloadedApi("/model-settings", balanced), { status: 200, body: { settings: balanced } });
  assert.deepEqual(await reloadedApi(`/repos/${first.id}/settings`), { status: 200, body: { settings: { ...firstSettings, ...balanced } } });
  assert.deepEqual(await reloadedApi(`/repos/${second.id}/settings`), { status: 200, body: { settings: { ...secondSettings, ...balanced } } });
  for (const invalid of [
    { model: "test-fast", reasoningEffort: "high" },
    { model: "missing-model" },
  ]) {
    assert.equal((await reloadedApi("/model-settings", invalid)).status, 400);
    assert.equal((await reloadedApi(`/repos/${first.id}/settings`, { ...firstSettings, ...invalid })).status, 400);
    assert.deepEqual((await reloadedApi("/model-settings")).body.settings, balanced);
  }
  assert.equal((await reloadedApi("/model-settings", { ...balanced, direction: "docs" })).status, 400);
  assert.deepEqual((await reloadedApi(`/repos/${first.id}/settings`)).body.settings, { ...firstSettings, ...balanced });
  // Web access is part of the shared model settings: saved through either path, kept on reload, and legacy files without it still parse.
  const web = { ...balanced, webAccess: true };
  assert.deepEqual(await reloadedApi("/model-settings", web), { status: 200, body: { settings: web } });
  assert.deepEqual((await reloadedApi(`/repos/${second.id}/settings`)).body.settings, { ...secondSettings, ...web });
  assert.deepEqual((await reloadedApi(`/repos/${first.id}/settings`, { ...firstSettings, ...balanced, webAccess: false })).body.settings, { ...firstSettings, ...balanced, webAccess: false });
  assert.deepEqual((await reloadedApi("/model-settings")).body.settings, { ...balanced, webAccess: false });
  assert.equal((await reloadedApi("/model-settings", { ...balanced, webAccess: "yes" })).status, 400);
  await writeFile(path.join(directory, "model-settings.json"), JSON.stringify(balanced));
  assert.deepEqual((await reloadedApi("/model-settings")).body.settings, balanced);
  assert.deepEqual((await reloadedApi(`/repos/${first.id}/settings`)).body.settings, { ...firstSettings, ...balanced });
  assert.deepEqual(await reloadedApi("/runs"), { status: 200, body: { runs: [] } });
  assert.deepEqual(store.data.runs, []);
  assert.equal(createRunCalls, 0);
  assert.ok(catalogCalls >= 4);
});
