import test from "node:test";
import assert from "node:assert/strict";
import { appSettingsSchema, type AppSettings } from "./app-settings.js";

const full: AppSettings = {
  locale: "zh-TW",
  maxActiveRuns: 2,
  maxAgentProcesses: 8,
  agentTimeoutScale: 1.5,
  onboardingCompletedAt: "2026-10-13T08:00:00.000Z",
  eulaAcceptedVersion: "draft-1",
  showSampleProject: false,
  allowUnsandboxedAgents: false,
  retentionDays: 30,
};

test("every app setting is optional and a full file round-trips", () => {
  assert.deepEqual(appSettingsSchema.parse({}), {});
  assert.deepEqual(appSettingsSchema.parse(full), full);
  assert.deepEqual(
    appSettingsSchema.parse({ onboardingCompletedAt: "2026-10-13T16:00:00+08:00" }),
    { onboardingCompletedAt: "2026-10-13T16:00:00+08:00" },
  );
});

test("unknown keys from a newer build are stripped, not rejected", () => {
  assert.deepEqual(
    appSettingsSchema.parse({ ...full, futureSetting: true, theme: "dark" }),
    full,
  );
});

test("boundary values are accepted", () => {
  for (const valid of [
    { maxActiveRuns: 1 },
    { maxActiveRuns: 8 },
    { maxAgentProcesses: 1 },
    { maxAgentProcesses: 32 },
    { agentTimeoutScale: 0.5 },
    { agentTimeoutScale: 10 },
    { retentionDays: 1 },
    { retentionDays: 365 },
    { eulaAcceptedVersion: "v".repeat(64) },
    { locale: "en" },
  ])
    assert.deepEqual(appSettingsSchema.parse(valid), valid);
});

test("out-of-range and mistyped values are rejected", () => {
  for (const invalid of [
    { maxActiveRuns: 0 },
    { maxActiveRuns: 9 },
    { maxActiveRuns: 1.5 },
    { maxAgentProcesses: 0 },
    { maxAgentProcesses: 33 },
    { agentTimeoutScale: 0.4 },
    { agentTimeoutScale: 10.5 },
    { retentionDays: 0 },
    { retentionDays: 366 },
    { eulaAcceptedVersion: "v".repeat(65) },
    { locale: "ja" },
    { locale: "zh-CN" },
    { onboardingCompletedAt: "yesterday" },
    { showSampleProject: "yes" },
    { allowUnsandboxedAgents: 1 },
    { maxActiveRuns: "2" },
  ])
    assert.equal(
      appSettingsSchema.safeParse(invalid).success,
      false,
      JSON.stringify(invalid),
    );
});
