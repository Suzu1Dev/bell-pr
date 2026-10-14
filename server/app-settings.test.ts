import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { appSettingsSchema } from "../shared/app-settings.js";
import { eulaVersion } from "../shared/product.js";
import {
  activateAppSettings,
  AppSettingsService,
  deactivateAppSettings,
  parseSavedAppSettings,
} from "./app-settings.js";
import { retentionDays } from "./cleanup.js";
import { alwaysDiscloseAi } from "./drafts.js";
import { currentLocale, withLocale } from "./i18n/index.js";
import { lenientRead } from "./persisted-schema.js";
import { allowUnsandboxedAgents } from "./sandbox.js";
import { AppError } from "./types.js";

async function dataDir(t: { after: (fn: () => Promise<void>) => void }) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-app-settings-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("unknown keys in the file are stripped on read and never cause an error", async (t) => {
  const directory = await dataDir(t);
  const file = path.join(directory, "app-settings.json");
  await writeFile(
    file,
    JSON.stringify({ locale: "en", maxActiveRuns: 3, theme: "dark", future: { nested: true } }),
  );
  const service = new AppSettingsService(directory, { env: {} });
  assert.deepEqual(service.get(), { locale: "en", maxActiveRuns: 3 });
  // A value this build does not accept drops only that setting.
  await writeFile(file, JSON.stringify({ maxActiveRuns: 99, retentionDays: 30, locale: "ja" }));
  assert.deepEqual(new AppSettingsService(directory, { env: {} }).get(), { retentionDays: 30 });
  // A damaged or foreign file starts from the defaults.
  for (const content of ["{ not json", "[]", "null", '"text"']) {
    await writeFile(file, content);
    assert.deepEqual(new AppSettingsService(directory, { env: {} }).get(), {});
  }
  assert.deepEqual(parseSavedAppSettings({ showSampleProject: "yes", locale: "zh-TW" }), {
    locale: "zh-TW",
  });
});

test("a file written by a newer build with alwaysDiscloseAi still loads in an older build", () => {
  // The older build's schema has no alwaysDiscloseAi; its lenient read drops it.
  const older = lenientRead(appSettingsSchema.omit({ alwaysDiscloseAi: true }));
  const written = { locale: "en", alwaysDiscloseAi: true, eulaAcceptedVersion: eulaVersion };
  assert.deepEqual(older.parse(written), { locale: "en", eulaAcceptedVersion: eulaVersion });
  assert.deepEqual(appSettingsSchema.parse(written), written);
});

test("settings are saved at 0600, round-trip, and null removes a value", async (t) => {
  const directory = await dataDir(t);
  const service = new AppSettingsService(path.join(directory, "new-data"), { env: {} });
  assert.deepEqual(service.view(), { settings: {}, lockedBy: {} });
  const view = await service.update({
    eulaAcceptedVersion: eulaVersion,
    onboardingCompletedAt: "2026-10-14T08:00:00.000Z",
    alwaysDiscloseAi: true,
    maxActiveRuns: 4,
  });
  assert.deepEqual(view.settings, {
    eulaAcceptedVersion: eulaVersion,
    onboardingCompletedAt: "2026-10-14T08:00:00.000Z",
    alwaysDiscloseAi: true,
    maxActiveRuns: 4,
  });
  const file = path.join(directory, "new-data", "app-settings.json");
  if (process.platform !== "win32") assert.equal((await stat(file)).mode & 0o777, 0o600);
  const reopened = new AppSettingsService(path.join(directory, "new-data"), { env: {} });
  assert.equal(reopened.get().eulaAcceptedVersion, eulaVersion);
  assert.equal(reopened.get().alwaysDiscloseAi, true);

  await reopened.update({ maxActiveRuns: null, alwaysDiscloseAi: false });
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), {
    eulaAcceptedVersion: eulaVersion,
    onboardingCompletedAt: "2026-10-14T08:00:00.000Z",
    alwaysDiscloseAi: false,
  });
  // Invalid values and unknown keys are refused; nothing changes.
  for (const invalid of [{ maxActiveRuns: 9 }, { theme: "dark" }, { locale: "ja" }, { retentionDays: 0 }])
    await assert.rejects(reopened.update(invalid), z.ZodError, JSON.stringify(invalid));
  assert.equal(reopened.get().alwaysDiscloseAi, false);
});

test("environment variables win, are reported in lockedBy and cannot be changed", async (t) => {
  const directory = await dataDir(t);
  await writeFile(
    path.join(directory, "app-settings.json"),
    JSON.stringify({ maxActiveRuns: 4, retentionDays: 30, allowUnsandboxedAgents: true }),
  );
  const env = {
    BELLPR_MAX_ACTIVE_RUNS: "2",
    BELLPR_ALLOW_UNSANDBOXED_AGENTS: "0",
    // Invalid or empty values lock nothing.
    BELLPR_RETENTION_DAYS: "soon",
    BELLPR_MAX_AGENT_PROCESSES: " ",
    BELLPR_AGENT_TIMEOUT_SCALE: "2.5",
    // Only a default: the language chosen in the app wins over it.
    BELLPR_LOCALE: "zh-TW",
  };
  const service = new AppSettingsService(directory, { env });
  assert.deepEqual(service.lockedBy(), {
    maxActiveRuns: "BELLPR_MAX_ACTIVE_RUNS",
    agentTimeoutScale: "BELLPR_AGENT_TIMEOUT_SCALE",
    allowUnsandboxedAgents: "BELLPR_ALLOW_UNSANDBOXED_AGENTS",
  });
  assert.deepEqual(service.get(), {
    maxActiveRuns: 2,
    retentionDays: 30,
    allowUnsandboxedAgents: false,
    agentTimeoutScale: 2.5,
  });
  await assert.rejects(
    withLocale("en", () => service.update({ maxActiveRuns: 3, locale: "en" })),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 409);
      assert.deepEqual(error.params, {
        setting: "maxActiveRuns",
        variable: "BELLPR_MAX_ACTIVE_RUNS",
      });
      assert.match(error.message, /BELLPR_MAX_ACTIVE_RUNS/);
      return true;
    },
  );
  assert.equal(service.get().locale, undefined);
  // Unlocked settings still save.
  await service.update({ locale: "en", retentionDays: 10 });
  assert.equal(service.get().retentionDays, 10);
});

test("with no request context the server language is the app setting, then BELLPR_LOCALE", async (t) => {
  const directory = await dataDir(t);
  const previous = process.env.BELLPR_LOCALE;
  process.env.BELLPR_LOCALE = "zh-TW";
  const service = new AppSettingsService(directory);
  t.after(() => {
    deactivateAppSettings(service);
    process.env.BELLPR_LOCALE = previous;
  });
  activateAppSettings(service);
  assert.equal(currentLocale(), "zh-TW");
  await service.update({ locale: "en" });
  assert.equal(currentLocale(), "en");
  // A request's own locale still comes first.
  assert.equal(withLocale("zh-TW", () => currentLocale()), "zh-TW");
  await service.update({ locale: null });
  assert.equal(currentLocale(), "zh-TW");
  await service.update({ locale: "en" });
  deactivateAppSettings(service);
  assert.equal(currentLocale(), "zh-TW");
});

test("the active settings feed the retention period, the sandbox opt-in and the AI note", async (t) => {
  const directory = await dataDir(t);
  const previous = {
    days: process.env.BELLPR_RETENTION_DAYS,
    sandbox: process.env.BELLPR_ALLOW_UNSANDBOXED_AGENTS,
  };
  delete process.env.BELLPR_RETENTION_DAYS;
  delete process.env.BELLPR_ALLOW_UNSANDBOXED_AGENTS;
  const first = new AppSettingsService(directory);
  const second = new AppSettingsService(directory);
  t.after(() => {
    deactivateAppSettings(first);
    deactivateAppSettings(second);
    for (const [name, value] of [
      ["BELLPR_RETENTION_DAYS", previous.days],
      ["BELLPR_ALLOW_UNSANDBOXED_AGENTS", previous.sandbox],
    ] as const)
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
  });
  activateAppSettings(first);
  assert.equal(retentionDays(), 14);
  assert.equal(allowUnsandboxedAgents(), false);
  assert.equal(alwaysDiscloseAi(), false);
  await first.update({ retentionDays: 45, allowUnsandboxedAgents: true, alwaysDiscloseAi: true });
  assert.equal(retentionDays(), 45);
  assert.equal(allowUnsandboxedAgents(), true);
  assert.equal(alwaysDiscloseAi(), true);
  // The environment wins over the saved value.
  process.env.BELLPR_RETENTION_DAYS = "7";
  assert.equal(retentionDays(), 7);
  delete process.env.BELLPR_RETENTION_DAYS;
  // A later service replaces the sources; deactivating the earlier one
  // leaves them alone.
  activateAppSettings(second);
  deactivateAppSettings(first);
  assert.equal(retentionDays(), 14);
  deactivateAppSettings(second);
  assert.equal(allowUnsandboxedAgents(), false);
  assert.equal(alwaysDiscloseAi(), false);
});
