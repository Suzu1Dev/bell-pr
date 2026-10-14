import assert from "node:assert/strict";
import test from "node:test";
import type { DoctorReport } from "../../shared/doctor";
import { formatters } from "../../shared/i18n/locale";
import { runsWithFiles, type StorageRun } from "./DataSection";
import { githubState } from "./EnvironmentSection";
import { formatSize } from "./format";
import { currentLimits, limitFields, parseLimit } from "./PerformanceSection";
import { providerState } from "./ProviderSection";
import { clearSampleProgress } from "./sampleProject";
import { parseSection } from "./sections";
import { changedSettings } from "./useAppSettings";

test("an address names a section; none or an unknown one is General", () => {
  assert.equal(parseSection("data"), "data");
  assert.equal(parseSection(undefined), "general");
  assert.equal(parseSection("nope"), "general");
  assert.equal(parseSection("__proto__"), "general");
});

test("only changed settings are sent, never a locked one", () => {
  const current = { maxActiveRuns: 2, maxAgentProcesses: 3, agentTimeoutScale: 1 };
  assert.deepEqual(changedSettings(current, { maxActiveRuns: 2, maxAgentProcesses: 4 }), {
    maxAgentProcesses: 4,
  });
  assert.deepEqual(
    changedSettings(current, { maxActiveRuns: 5, agentTimeoutScale: 2 }, {
      maxActiveRuns: "BELLPR_MAX_ACTIVE_RUNS",
    }),
    { agentTimeoutScale: 2 },
  );
  // null removes a saved value, and only when there is one.
  assert.deepEqual(changedSettings({ retentionDays: 30 }, { retentionDays: null }), {
    retentionDays: null,
  });
  assert.deepEqual(changedSettings({}, { retentionDays: null, showSampleProject: undefined }), {});
});

test("a limit is a number within its range, whole where it must be", () => {
  const [runs, processes, scale] = limitFields;
  assert.equal(parseLimit("3", runs), 3);
  assert.equal(parseLimit(" 8 ", runs), 8);
  for (const text of ["", "0", "9", "2.5", "abc", "1e9"])
    assert.equal(parseLimit(text, runs), undefined, text);
  assert.equal(parseLimit("32", processes), 32);
  assert.equal(parseLimit("33", processes), undefined);
  assert.equal(parseLimit("0.5", scale), 0.5);
  assert.equal(parseLimit("2.25", scale), 2.25);
  assert.equal(parseLimit("0.4", scale), undefined);
  assert.equal(parseLimit("10.5", scale), undefined);
});

test("the limits in effect come from the settings, else from what the server runs with", () => {
  const limits = { maxActiveRuns: 2, maxAgentProcesses: 3, maxQueued: 8 };
  assert.deepEqual(currentLimits({}, limits), {
    maxActiveRuns: 2,
    maxAgentProcesses: 3,
    agentTimeoutScale: 1,
  });
  assert.deepEqual(currentLimits({ maxActiveRuns: 5, agentTimeoutScale: 2.5 }, limits), {
    maxActiveRuns: 5,
    maxAgentProcesses: 3,
    agentTimeoutScale: 2.5,
  });
});

test("resetting the sample project clears every locale's progress and nothing else", () => {
  const items = new Map([
    ["bellpr-demo-run:en", "{}"],
    ["bellpr-demo-run:zh-TW", "{}"],
    ["bellpr-demo-settings:en", "{}"],
    ["bellpr-locale", "en"],
    ["bellpr-sidebar-collapsed", "true"],
  ]);
  const storage = {
    get length() {
      return items.size;
    },
    key: (index: number) => [...items.keys()][index] ?? null,
    removeItem: (key: string) => void items.delete(key),
  };
  assert.equal(clearSampleProgress(storage), true);
  assert.deepEqual([...items.keys()], ["bellpr-locale", "bellpr-sidebar-collapsed"]);
  // Blocked storage is reported, not thrown.
  const blocked = {
    get length(): number {
      throw new DOMException("blocked", "SecurityError");
    },
    key: () => null,
    removeItem() {},
  };
  assert.equal(clearSampleProgress(blocked), false);
  // Without a storage at all (node has none), nothing happens.
  assert.equal(clearSampleProgress(), typeof localStorage !== "undefined");
});

test("sizes read in 1024-based units in the UI language", () => {
  const en = formatters("en");
  assert.equal(formatSize(0, en), "0 kB");
  assert.equal(formatSize(512, en), "0.5 kB");
  assert.equal(formatSize(5 * 1024 ** 2, en), "5 MB");
  assert.equal(formatSize(1.25 * 1024 ** 3, en), "1.3 GB");
  assert.match(formatSize(5 * 1024 ** 2, formatters("zh-TW")), /^5\s?MB$/);
});

test("runs with files on disk are listed biggest first, published ones apart", () => {
  const run = (id: string, value: Partial<StorageRun>): StorageRun => ({
    id,
    repoId: "repo",
    title: id,
    status: "review",
    createdAt: "2026-10-01T00:00:00.000Z",
    bytes: 0,
    removable: true,
    ...value,
  });
  const { published, others } = runsWithFiles([
    run("small", { bytes: 10 }),
    run("freed", { bytes: 0, workspaceRemovedAt: "2026-10-02T00:00:00.000Z" }),
    run("outside", { bytes: null, removable: false }),
    run("big", { bytes: 1000 }),
    run("empty", { bytes: 0 }),
    run("shipped", { bytes: 500, status: "published" }),
  ]);
  assert.deepEqual(
    published.map((value) => value.id),
    ["shipped"],
  );
  assert.deepEqual(
    others.map((value) => value.id),
    ["big", "small", "outside"],
  );
});

test("a CLI's state follows its install and sign-in checks", () => {
  const report = (checks: DoctorReport["checks"]): DoctorReport => ({
    checks,
    ready: true,
    checkedAt: "2026-10-14T00:00:00.000Z",
    platform: "linux",
  });
  assert.equal(providerState(null, "codex").state, "checking");
  assert.equal(providerState(report([]), "codex").state, "missing");
  assert.equal(
    providerState(report([{ id: "codex", status: "warn", required: false }]), "codex").state,
    "notWorking",
  );
  assert.equal(
    providerState(
      report([
        { id: "claude", status: "ok", required: false },
        { id: "claude-auth", status: "warn", required: false },
      ]),
      "claude",
    ).state,
    "signedOut",
  );
  assert.equal(
    providerState(
      report([
        { id: "claude", status: "ok", required: false },
        { id: "claude-auth", status: "ok", required: false },
      ]),
      "claude",
    ).state,
    "ready",
  );
  assert.deepEqual(githubState(null), { state: "checking" });
  assert.deepEqual(githubState(report([{ id: "gh", status: "skip", required: false }])), {
    state: "missing",
  });
  assert.deepEqual(
    githubState(
      report([
        { id: "gh", status: "ok", required: false },
        { id: "gh-auth", status: "ok", required: false, params: { login: "octo" } },
      ]),
    ),
    { state: "connected", login: "octo" },
  );
});
