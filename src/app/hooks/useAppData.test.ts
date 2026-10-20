import assert from "node:assert/strict";
import test from "node:test";
import type { AppSettingsView } from "../../../shared/app-settings";
import type { Repo, RunSummary } from "../../types";
import { loadAppData, type AppDataSink, type Status } from "./useAppData";

const repo = { id: "repo-1", fullName: "octo/widgets" } as Repo;
const run = { id: "run-1", repoId: "repo-1", title: "Retry" } as RunSummary;

/** A request function whose answers the test releases one by one. */
function controlled() {
  const calls = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  const request = <T,>(path: string) =>
    new Promise<T>((resolve, reject) => {
      calls.set(path, { resolve: resolve as (value: unknown) => void, reject });
    });
  return { request, calls };
}

/** Records every sink call in order. */
function recorder() {
  const events: string[] = [];
  const sink: AppDataSink = {
    status: (value) => events.push(`status:${value.githubUser ?? ""}`),
    repos: (value) => events.push(`repos:${value.map((item) => item.id).join(",")}`),
    runs: (value) => events.push(`runs:${value.map((item) => item.id).join(",")}`),
    appSettings: (value) => events.push(`settings:${value.settings.onboardingCompletedAt ?? ""}`),
    failed: (source, error) => events.push(`failed:${source}:${error.message}`),
  };
  return { events, sink };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("the first load sends four independent requests at once", () => {
  const { request, calls } = controlled();
  loadAppData(request, recorder().sink);
  assert.deepEqual([...calls.keys()].sort(), [
    "/app-settings",
    "/repos",
    "/runs",
    "/status",
  ]);
});

test("the lists and the settings arrive while the status is still checking", async () => {
  const { request, calls } = controlled();
  const { events, sink } = recorder();
  loadAppData(request, sink);
  calls.get("/repos")!.resolve({ repos: [repo] });
  calls.get("/runs")!.resolve({ runs: [run] });
  calls
    .get("/app-settings")!
    .resolve({ settings: { onboardingCompletedAt: "2026-10-14T09:00:00Z" }, lockedBy: {} } satisfies AppSettingsView);
  await tick();
  assert.deepEqual(events, ["repos:repo-1", "runs:run-1", "settings:2026-10-14T09:00:00Z"]);
  calls.get("/status")!.resolve({ codex: true, github: true, githubUser: "octo" } satisfies Status);
  await tick();
  assert.deepEqual(events.at(-1), "status:octo");
});

test("a failed request is reported on its own and the others still arrive", async () => {
  const { request, calls } = controlled();
  const { events, sink } = recorder();
  loadAppData(request, sink);
  calls.get("/status")!.reject(new Error("offline"));
  calls.get("/app-settings")!.reject(new Error("no settings"));
  calls.get("/runs")!.resolve({ runs: [] });
  calls.get("/repos")!.resolve({ repos: [repo] });
  await tick();
  assert.deepEqual(events, [
    "failed:status:offline",
    "failed:appSettings:no settings",
    "runs:",
    "repos:repo-1",
  ]);
});

test("a rejection that is not an Error still reports a message", async () => {
  const { events, sink } = recorder();
  loadAppData(
    <T,>(path: string) =>
      (path === "/runs" ? Promise.reject("down") : new Promise<T>(() => {})) as Promise<T>,
    sink,
  );
  await tick();
  assert.deepEqual(events, ["failed:runs:down"]);
});
