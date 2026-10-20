// A Learn-by-hand run's log names the guide, never the agent team's lead
// (DESIGN v1.2 §12): each guide turn's first line, "<name> started. Model:
// …", says "The guide" there; agent runs keep "Atlas". Codex is a fake
// executable on PATH that answers one pointer.
import test, { after, before, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runAgent } from "./run-executor.js";
import { Store } from "./store.js";
import type { Run } from "./types.js";
import { withLocale, type ServerMessages } from "./i18n/index.js";
import { Workbench, type WorkbenchContext } from "./workbench.js";

const previousPath = process.env.PATH;
let fakeBin: string;

before(async () => {
  fakeBin = await mkdtemp(path.join(os.tmpdir(), "bell-by-hand-name-bin-"));
  await writeFile(
    path.join(fakeBin, "codex"),
    "#!/usr/bin/env node\nrequire('node:fs').readFileSync(0, 'utf8');\nconsole.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Look at src/retry.ts:1.' } }));\n",
    { mode: 0o755 },
  );
  for (const name of ["claude", "gh"]) await writeFile(path.join(fakeBin, name), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  process.env.PATH = `${fakeBin}${path.delimiter}${previousPath}`;
});

after(async () => {
  process.env.PATH = previousPath;
  await rm(fakeBin, { recursive: true, force: true });
});

/** The first log line of one read-only lead turn, in `locale`. */
async function startedLine(t: TestContext, learnByHand: boolean, locale: "en" | "zh-TW" = "en") {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-by-hand-name-"));
  const worktree = path.join(directory, "worktree");
  await mkdir(worktree, { recursive: true });
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const workbench = new Workbench(store);
  t.after(async () => {
    await workbench.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  const run: Run = {
    id: `name-${learnByHand ? "lbh" : "agent"}-${locale}`,
    repoId: "repo",
    title: "Retry twice",
    prompt: "Retry a GET twice after a 503.",
    status: "review",
    branch: "main",
    baseBranch: "main",
    baseSha: "a".repeat(40),
    worktreePath: worktree,
    createdAt: "2026-10-20T00:00:00.000Z",
    locale,
    ...(learnByHand ? { learnByHand: true } : {}),
    modelExecution: { provider: "codex", source: "cli-default", webAccess: false },
    agents: [{ id: "lead", name: "Atlas", role: "Team lead", status: "waiting", detail: "" }],
    logs: [],
    draft: { title: "Retry twice", body: "" },
    reviewedFiles: [],
    reviewedFingerprints: {},
  };
  store.data.runs.push(run);
  const ctx = (workbench as unknown as { context: WorkbenchContext }).context;
  await withLocale(locale, () => runAgent(ctx, run, "lead", "Where is the retry loop?", new AbortController().signal, true, { isolated: true }));
  return run.logs[0]?.message ?? "";
}

test("a Learn-by-hand guide turn starts its log as the guide, an agent run's as Atlas", async (t) => {
  assert.match(await startedLine(t, true), /^The guide started\. Model: /);
  assert.match(await startedLine(t, true, "zh-TW"), /^嚮導/);
  assert.doesNotMatch(await startedLine(t, true, "zh-TW"), /Atlas/);
  assert.match(await startedLine(t, false), /^Atlas started\. Model: /);
});

test("in zh-TW the guide's first log line has no space between 嚮導 and the verb; a Latin name keeps it", async (t) => {
  assert.match(await startedLine(t, true, "zh-TW"), /^嚮導開始工作。模型：/);
  assert.match(await startedLine(t, false, "zh-TW"), /^Atlas 開始工作。模型：/);
});

// The name is a server string of its own (en and zh-TW).
test("the guide's name in the run log is in both server dictionaries", async () => {
  const en = (await import("./i18n/en/run.js")).default as unknown as ServerMessages["run"];
  const zh = (await import("./i18n/zh-TW/run.js")).default as unknown as ServerMessages["run"];
  assert.equal((en.team as unknown as { guideName: string }).guideName, "The guide");
  assert.equal((zh.team as unknown as { guideName: string }).guideName, "嚮導");
});
