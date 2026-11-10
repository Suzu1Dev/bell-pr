/**
 * The group's write guard, third slice (docs/design/collab-write-guard.md
 * S3): a write turn's sandbox makes the paths other people hold read-only,
 * so the agent's write fails on the spot. The check after the turn (S2)
 * stays the one that counts; these tests cover what the sandbox is given.
 */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { claudeSettings, codexSandboxConfig } from "./agent-cli.js";
import type { RunHolds } from "./hold-guard.js";
import { git, type command } from "./process.js";
import { runAgent } from "./run-executor.js";
import { heldEditDenials, heldWriteTargets, maxHeldWriteTargets } from "./sandbox.js";
import { Store } from "./store.js";
import type { Run } from "./types.js";
import { Workbench, type WorkbenchContext } from "./workbench.js";
import { withLocale } from "./i18n/index.js";

async function checkout(t: TestContext, files: Record<string, string>) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "bell-held-sandbox-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), text);
  }
  return root;
}

/** The `"path"="read"` entries of a Codex permission profile. */
const readEntries = (args: readonly string[]) =>
  [...(args.find((arg) => arg.startsWith("permissions={bell-pr=")) ?? "").matchAll(/"([^"]+)"="read"/g)].map(
    (match) => match[1],
  );

test("held paths resolve to every spelling the checkout has, and missing files in existing folders", async (t) => {
  const root = await checkout(t, {
    "Src/API/Users.ts": "a\n",
    "lib/x.ts": "b\n",
    "docs/guide.md": "c\n",
  });
  assert.deepEqual(heldWriteTargets(root, ["src/api/users.ts", "LIB", "docs/new.md"]), [
    path.join(root, "Src/API/Users.ts"),
    path.join(root, "docs/new.md"),
    path.join(root, "lib"),
  ]);
});

test("on a case-sensitive file system, each spelling of a held path is read-only", { skip: process.platform !== "linux" }, async (t) => {
  const root = await checkout(t, { "src/api/users.ts": "a\n", "src/api/Users.ts": "b\n", "SRC/api/users.ts": "c\n" });
  assert.deepEqual(heldWriteTargets(root, ["src/api/users.ts"]), [
    path.join(root, "SRC/api/users.ts"),
    path.join(root, "src/api/Users.ts"),
    path.join(root, "src/api/users.ts"),
  ]);
});

test("held paths the sandbox cannot take are left to the check after the turn", async (t) => {
  const root = await checkout(t, { "src/api/users.ts": "a\n", "src/lib/x.ts": "b\n" });
  await symlink("src/api", path.join(root, "alias"));
  await symlink("users.ts", path.join(root, "src/api/link.ts"));
  assert.deepEqual(
    heldWriteTargets(root, [
      // A missing folder: Codex would make all of it read-only.
      "missing/a.ts",
      // Through a symbolic link, or at one: bubblewrap would not start.
      "alias/users.ts",
      "alias",
      "src/api/link.ts",
      // Already read-only, and outside the checkout.
      ".git/config",
      ".GIT",
      "../outside.ts",
      "",
    ]),
    [],
  );
  // Below another held path: the folder covers it.
  assert.deepEqual(heldWriteTargets(root, ["src/api/users.ts", "src/api", "src/lib/x.ts"]), [
    path.join(root, "src/api"),
    path.join(root, "src/lib/x.ts"),
  ]);
  const many = Array.from({ length: maxHeldWriteTargets + 50 }, (_, index) => `src/lib/new-${index}.ts`);
  assert.equal(heldWriteTargets(root, many).length, maxHeldWriteTargets);
});

test("Codex makes held paths read-only in write turns only", async (t) => {
  const root = await checkout(t, { "src/api/users.ts": "a\n" });
  const held = [path.join(root, "src/api/users.ts"), path.join(root, 'src/"quoted".ts')];
  const write = readEntries(codexSandboxConfig("write", root, held));
  assert.ok(write.includes(path.join(root, "src/api/users.ts")));
  // A path the profile cannot hold as a TOML key is left out, not mangled.
  assert.ok(!write.some((entry) => entry.includes("quoted")));
  assert.deepEqual(readEntries(codexSandboxConfig("read", root, held)), [
    path.join(root, ".git"),
    `${path.join(root, ".git")}/**`,
  ]);
});

test("Claude Code denies held paths to its edit tools, and existing ones to sandboxed Bash", async (t) => {
  const root = await checkout(t, { "src/api/users.ts": "a\n", "src/lib/x.ts": "b\n" });
  const held = heldWriteTargets(root, ["src/api/users.ts", "src/lib", "src/new.ts"]);
  const settings = claudeSettings({ cwd: root, access: "write", sandbox: true, held });
  const edits = settings.permissions.deny.filter((rule) => rule.startsWith("Edit("));
  assert.deepEqual(edits, heldEditDenials(held));
  for (const file of ["src/api/users.ts", "src/lib", "src/new.ts"]) {
    assert.ok(edits.includes(`Edit(/${path.join(root, file)})`), file);
    assert.ok(edits.includes(`Edit(/${path.join(root, file)}/**)`), file);
  }
  const denyWrite = settings.sandbox?.filesystem?.denyWrite ?? [];
  assert.ok(denyWrite.includes(path.join(root, "src/api/users.ts")));
  assert.ok(denyWrite.includes(path.join(root, "src/lib")));
  // Not verified with Claude Code's bubblewrap yet: the edit rules and the check after the turn cover it.
  assert.ok(!denyWrite.includes(path.join(root, "src/new.ts")));
  // Without the sandbox (allowed by the person), the edit rules still apply.
  const unsandboxed = claudeSettings({ cwd: root, access: "write", sandbox: false, held });
  assert.deepEqual(unsandboxed.permissions.deny.filter((rule) => rule.startsWith("Edit(")), edits);
  // A read turn writes nothing, so it gets none.
  const read = claudeSettings({ cwd: root, access: "read", sandbox: true, held });
  assert.ok(!read.permissions.deny.some((rule) => rule.startsWith("Edit(")));
  assert.deepEqual(heldEditDenials([path.join(root, "src/(x).ts")]), []);
});

test("a write turn's sandbox gets the paths other people hold, read again per turn, and not the run's own", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-held-sandbox-run-"));
  const calls: string[][] = [];
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  // The agent CLI: JSONL events as Codex prints them; the arguments are kept.
  const fake: typeof command = async (_executable, args, options = {}) => {
    calls.push([...args]);
    options.onLine?.(
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Edited." } }),
      "stdout",
    );
    return { stdout: "", stderr: "", code: 0 };
  };
  const workbench = new Workbench(store, undefined, { command: fake });
  // After hooks run in order: the store is saved before its folder goes.
  t.after(() => workbench.shutdown());
  t.after(() => rm(directory, { recursive: true, force: true }));
  const worktreePath = await realpath(await mkdtemp(path.join(directory, "checkout-")));
  for (const [file, text] of Object.entries({
    "src/api/users.ts": "a\n",
    "src/lib/x.ts": "b\n",
    "docs/guide.md": "c\n",
  })) {
    await mkdir(path.dirname(path.join(worktreePath, file)), { recursive: true });
    await writeFile(path.join(worktreePath, file), text);
  }
  await git(worktreePath, ["init", "-q", "-b", "main"]);
  await git(worktreePath, ["add", "-A"]);
  await git(worktreePath, ["-c", "user.name=BELL Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "init"]);
  const baseSha = (await git(worktreePath, ["rev-parse", "HEAD"])).stdout.trim();
  const run: Run = {
    id: "held-sandbox",
    repoId: "repo",
    title: "Edit",
    prompt: "Edit",
    status: "running",
    branch: "fix/held",
    baseBranch: "main",
    baseSha,
    worktreePath,
    createdAt: new Date().toISOString(),
    agents: [],
    logs: [],
    draft: { title: "", body: "" },
    reviewedFiles: [],
    reviewedFingerprints: {},
    modelExecution: { source: "cli-default" },
    locale: "en",
  };
  store.data.runs.push(run);
  let others = ["src/api/users.ts"];
  const holds: RunHolds = {
    scope: () => ({ others, yours: ["docs"] }),
    conflicts: () => [],
  };
  const ctx = (workbench as unknown as { context: WorkbenchContext }).context;
  ctx.holds = holds;
  const turn = (readonly: boolean) =>
    withLocale("en", () => runAgent(ctx, run, "member", "Edit the file.", new AbortController().signal, readonly));

  assert.equal(await turn(false), "Edited.");
  let entries = readEntries(calls.at(-1)!);
  assert.ok(entries.includes(path.join(worktreePath, "src/api/users.ts")));
  assert.ok(!entries.some((entry) => entry.startsWith(path.join(worktreePath, "docs"))));
  assert.ok(!entries.includes(path.join(worktreePath, "src/lib")));

  // A hold taken mid-run reaches the next turn.
  others = ["src/api/users.ts", "src/lib"];
  await turn(false);
  entries = readEntries(calls.at(-1)!);
  assert.ok(entries.includes(path.join(worktreePath, "src/lib")));

  // A read turn is not given them; it cannot write anyway.
  await turn(true);
  assert.ok(!readEntries(calls.at(-1)!).includes(path.join(worktreePath, "src/lib")));
});
