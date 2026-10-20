import assert from "node:assert/strict";
import test from "node:test";
import { startView, type StartInput } from "./startView";

const done = { appSettings: "done", repos: "done", runs: "done" } as const;
const input = (value: Partial<StartInput> = {}): StartInput => ({
  appSettings: {},
  loaded: done,
  repos: [],
  runs: [],
  ...value,
});

test("a fresh data directory starts with the welcome flow", () => {
  assert.equal(startView(input()), "welcome");
});

test("finished onboarding, or any repository or run, starts the app", () => {
  assert.equal(
    startView(input({ appSettings: { onboardingCompletedAt: "2026-10-14T09:00:00Z" } })),
    "shell",
  );
  assert.equal(startView(input({ repos: [{}] })), "shell");
  assert.equal(startView(input({ runs: [{}] })), "shell");
});

test("the start waits for the settings, and for the lists only when they decide", () => {
  assert.equal(
    startView(input({ loaded: { ...done, appSettings: "pending" } })),
    "pending",
  );
  assert.equal(startView(input({ loaded: { ...done, repos: "pending" } })), "pending");
  assert.equal(startView(input({ loaded: { ...done, runs: "pending" } })), "pending");
  // Finished onboarding does not wait for the lists.
  assert.equal(
    startView(
      input({
        appSettings: { onboardingCompletedAt: "2026-10-14T09:00:00Z" },
        loaded: { appSettings: "done", repos: "pending", runs: "pending" },
      }),
    ),
    "shell",
  );
});

test("a failed request shows the app, which reports it", () => {
  assert.equal(
    startView(input({ appSettings: null, loaded: { ...done, appSettings: "failed" } })),
    "shell",
  );
  assert.equal(startView(input({ loaded: { ...done, runs: "failed" } })), "shell");
});
