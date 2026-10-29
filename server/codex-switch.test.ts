import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { z } from "zod";
import { appSettingsSchema } from "../shared/app-settings.js";
import { agentCommand } from "./agent-cli.js";
import { main } from "./cli.js";
import { ProjectInsightsService } from "./insights.js";
import { withLocale } from "./i18n/index.js";
import { modelSettingsSchema } from "./models.js";
import { Store } from "./store.js";
import { AppError } from "./types.js";
import {
  activeProvider,
  codexEnabled,
  codexSelectionBlocked,
  presentedModelSettings,
  setCodexEnabledForTests,
} from "../shared/codex-switch.js";

test("the release constant is the only Codex switch, and one line turns the fallback on", async () => {
  const source = await readFile(new URL("../shared/codex-switch.ts", import.meta.url), "utf8");
  assert.match(source, /export let codexEnabled = true/);
  assert.doesNotMatch(source, /process\.env|BELLPR_/);
  setCodexEnabledForTests(true);
  assert.equal(activeProvider(undefined), "codex");
  assert.equal(activeProvider("codex"), "codex");
  assert.equal(activeProvider("claude"), "claude");
  assert.equal(codexSelectionBlocked("codex"), false);
  assert.deepEqual(
    presentedModelSettings({ provider: "codex", model: "gpt-test", reasoningEffort: "high" }),
    { provider: "codex", model: "gpt-test", reasoningEffort: "high" },
  );

  setCodexEnabledForTests(false);
  try {
    assert.equal(activeProvider(undefined), "claude");
    assert.equal(activeProvider("codex"), "claude");
    assert.equal(activeProvider("claude"), "claude");
    assert.equal(codexSelectionBlocked("codex"), true);
    assert.equal(codexSelectionBlocked("claude"), false);
    assert.deepEqual(
      presentedModelSettings({ provider: "codex", model: "gpt-test", reasoningEffort: "high" }),
      { provider: "claude", model: "", reasoningEffort: "" },
    );
    assert.deepEqual(presentedModelSettings({ provider: "claude", model: "haiku" }), {
      provider: "claude",
      model: "haiku",
    });
  } finally {
    setCodexEnabledForTests(true);
  }
  assert.equal(codexEnabled, true);
});

test("the API refuses a Codex selection while the switch is off and still reads the saved file", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-codex-switch-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new Store(directory);
  await store.initialize();
  const insights = new ProjectInsightsService(store, {
    getModelCatalog: async (provider = "codex") => ({ models: [], source: provider }),
    command: async () => {
      throw new Error("settings must not start an agent");
    },
  });
  t.after(() => insights.shutdown());
  const file = path.join(directory, "model-settings.json");
  const saved = { provider: "codex", model: "gpt-test", reasoningEffort: "high" };
  await writeFile(file, JSON.stringify(saved));

  setCodexEnabledForTests(false);
  t.after(() => setCodexEnabledForTests(true));
  const shown = await insights.getModelSettings();
  assert.equal(shown.provider, "claude");
  assert.equal(shown.model, "");
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), saved);
  await assert.rejects(
    withLocale("en", () =>
      insights.setModelSettings({ provider: "codex", model: "", reasoningEffort: "" }),
    ),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 422 &&
      /Disabled\. Codex is turned off/.test(error.message) &&
      !/gpt-test|gho_|ghp_/.test(error.message),
  );
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), saved);
  await withLocale("zh-TW", async () => {
    await assert.rejects(insights.setModelSettings({ provider: "codex" }), /已停用/);
  });

  setCodexEnabledForTests(true);
  const accepted = await insights.setModelSettings({
    provider: "codex",
    model: "",
    reasoningEffort: "",
  });
  assert.equal(accepted.provider, "codex");
});

test("an agent command cannot start Codex while the switch is off", async (t) => {
  setCodexEnabledForTests(false);
  t.after(() => setCodexEnabledForTests(true));
  await assert.rejects(
    withLocale("en", () =>
      agentCommand({ source: "cli-default" }, { cwd: os.tmpdir(), access: "none" }),
    ),
    (error: unknown) =>
      error instanceof AppError && error.statusCode === 422 && /Disabled/.test(error.message),
  );
  await assert.rejects(
    agentCommand(
      { provider: "codex", source: "selected" },
      { cwd: os.tmpdir(), access: "write" },
    ),
    (error: unknown) => error instanceof AppError && error.statusCode === 422,
  );
  const claude = await agentCommand(
    { provider: "claude", source: "cli-default" },
    { cwd: os.tmpdir(), access: "none" },
  );
  assert.equal(claude.executable, "claude");
});

test("settings, the CLI, and the environment cannot turn Codex on", async () => {
  setCodexEnabledForTests(false);
  const previous = {
    BELLPR_CODEX_ENABLED: process.env.BELLPR_CODEX_ENABLED,
    CODEX_ENABLED: process.env.CODEX_ENABLED,
  };
  process.env.BELLPR_CODEX_ENABLED = "1";
  process.env.CODEX_ENABLED = "true";
  try {
    assert.equal(codexEnabled, false);
    assert.equal(activeProvider("codex"), "claude");
    const settings = z.object(modelSettingsSchema).strict();
    assert.throws(() => settings.parse({ provider: "claude", codexEnabled: true }));
    assert.equal("codexEnabled" in appSettingsSchema.parse({ codexEnabled: true }), false);
    assert.equal(codexEnabled, false);
    let stderr = "";
    const code = await withLocale("en", () =>
      main(["start", "--codex-enabled"], {
        env: { BELLPR_NO_OPEN: "1", BELLPR_CODEX_ENABLED: "1" },
        stderr: { write: (text: string) => (stderr += text) },
      }),
    );
    assert.equal(code, 2);
    assert.match(stderr, /Unknown option --codex-enabled/);
    assert.equal(codexEnabled, false);
  } finally {
    setCodexEnabledForTests(true);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
