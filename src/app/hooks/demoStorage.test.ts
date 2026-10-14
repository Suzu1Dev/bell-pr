import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { defaultContributionSettings } from "../../../shared/insights";
import { getDemo } from "../../demo";
import {
  demoRunInLocale,
  demoRunKey,
  demoSettingsKey,
  loadDemo,
  loadDemoSettings,
  saveDemo,
  saveDemoSettings,
} from "./demoStorage";

const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

function installStorage(value: unknown) {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get: () => value,
  });
}

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

afterEach(() => {
  if (original) Object.defineProperty(globalThis, "localStorage", original);
  else delete (globalThis as Record<string, unknown>).localStorage;
});

test("the demo keeps its progress per locale", () => {
  const storage = memoryStorage();
  installStorage(storage);
  const zh = loadDemo("zh-TW");
  assert.equal(zh.id, getDemo("zh-TW").run.id);
  assert.deepEqual(zh.reviewedFiles, []);
  assert.ok(zh.team, "the demo run carries its team");

  const path = getDemo("zh-TW").files[0].path;
  saveDemo("zh-TW", { ...zh, reviewedFiles: [path], status: "approved" });
  assert.deepEqual([...storage.items.keys()], [demoRunKey("zh-TW")]);
  assert.equal(demoRunKey("zh-TW"), "bellpr-demo-run:zh-TW");
  const kept = loadDemo("zh-TW");
  assert.deepEqual(kept.reviewedFiles, [path]);
  assert.equal(kept.status, "approved");
  // The other locale starts fresh from its own fixtures.
  const en = loadDemo("en");
  assert.deepEqual(en.reviewedFiles, []);
  assert.equal(en.status, "review");
  assert.equal(en.title, getDemo("en").run.title);
});

test("the demo direction settings are kept per locale over the defaults", () => {
  const storage = memoryStorage();
  installStorage(storage);
  assert.deepEqual(loadDemoSettings("en"), defaultContributionSettings);
  saveDemoSettings("en", { ...defaultContributionSettings, maxTeammates: 4 });
  assert.equal(demoSettingsKey("en"), "bellpr-demo-settings:en");
  assert.ok(storage.items.has("bellpr-demo-settings:en"));
  assert.equal(loadDemoSettings("en").maxTeammates, 4);
  assert.deepEqual(loadDemoSettings("zh-TW"), defaultContributionSettings);
  // Garbage in storage falls back to the defaults.
  storage.items.set(demoSettingsKey("zh-TW"), "[1,2]");
  assert.deepEqual(loadDemoSettings("zh-TW"), defaultContributionSettings);
  storage.items.set(demoRunKey("zh-TW"), "{not json");
  assert.deepEqual(loadDemo("zh-TW").reviewedFiles, []);
});

test("blocked or missing storage never breaks the demo", () => {
  const blocked = () => {
    throw new Error("SecurityError: storage is disabled");
  };
  for (const storage of [
    undefined,
    { getItem: blocked, setItem: blocked },
  ]) {
    installStorage(storage);
    assert.equal(loadDemo("en").id, getDemo("en").run.id);
    assert.deepEqual(loadDemoSettings("en"), defaultContributionSettings);
    assert.doesNotThrow(() => saveDemo("en", loadDemo("en")));
    assert.doesNotThrow(() =>
      saveDemoSettings("en", defaultContributionSettings),
    );
  }
  // Reading the localStorage property itself throws in some browsers.
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get: blocked,
  });
  assert.equal(loadDemo("zh-TW").id, getDemo("zh-TW").run.id);
  assert.doesNotThrow(() => saveDemoSettings("zh-TW", defaultContributionSettings));
});

test("a language switch shows the demo in the new locale and keeps the reader's progress", () => {
  const zh = getDemo("zh-TW");
  const path = zh.files[0].path;
  const before = {
    ...zh.run,
    team: structuredClone(zh.team),
    reviewedFiles: [path],
    status: "approved" as const,
    draft: { title: "My title", body: "My body" },
    notes: {
      [path]: { text: "a note", fingerprint: "f", updatedAt: "2026-10-14T00:00:00Z" },
    },
  };
  const after = demoRunInLocale(before, "en");
  const en = getDemo("en");
  assert.equal(after.title, en.run.title);
  assert.deepEqual(after.team, en.team);
  assert.notEqual(after.team, en.team, "the fixture team is copied");
  assert.deepEqual(after.reviewedFiles, [path]);
  assert.equal(after.status, "approved");
  assert.deepEqual(after.draft, before.draft);
  assert.deepEqual(after.notes, before.notes);
  // Guidance appears only once the reader prepared it, then in the new locale.
  assert.equal(after.draftPreparation, undefined);
  const prepared = demoRunInLocale(
    { ...before, draftPreparation: structuredClone(zh.draftPreparation) },
    "en",
  );
  assert.deepEqual(prepared.draftPreparation, en.draftPreparation);
  assert.notEqual(prepared.draftPreparation, en.draftPreparation);
  // Any other run is left as it is.
  const other = { ...before, id: "run-1" };
  assert.equal(demoRunInLocale(other, "en"), other);
});

test("an opened sample PR stays open after a reload and a language switch", () => {
  const storage = memoryStorage();
  installStorage(storage);
  const en = loadDemo("en");
  saveDemo("en", {
    ...en,
    status: "published",
    prUrl: "#demo-pr",
    draft: { ...en.draft, publishBranch: "retry-backoff" },
  });
  const kept = loadDemo("en");
  assert.equal(kept.status, "published");
  assert.equal(kept.prUrl, "#demo-pr");
  assert.equal(kept.publishedBranch, "retry-backoff");

  // Switching languages keeps the PR and shows the feedback read in the new one.
  const zh = demoRunInLocale(
    { ...kept, prFeedback: getDemo("en").prFeedback },
    "zh-TW",
  );
  assert.equal(zh.status, "published");
  assert.equal(zh.prUrl, "#demo-pr");
  assert.equal(zh.prFeedback?.warnings?.[0], getDemo("zh-TW").prFeedback?.warnings?.[0]);
  assert.equal(zh.title, getDemo("zh-TW").run.title);
  // A sample PR still on its way is shown opened: no playback finishes it now.
  const pushing = demoRunInLocale({ ...en, status: "approved", publishing: true }, "zh-TW");
  assert.equal(pushing.status, "published");
  assert.equal(pushing.prUrl, "#demo-pr");
  assert.equal(pushing.publishing, undefined);
  // Without a PR, nothing is invented.
  const reviewing = demoRunInLocale({ ...en, status: "review" }, "zh-TW");
  assert.equal(reviewing.prUrl, undefined);
  assert.equal(reviewing.prFeedback, undefined);
});
