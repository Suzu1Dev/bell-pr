import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cloneGitHubRepository } from "./repositories.js";
import { withLocale } from "./i18n/index.js";
import { Store } from "./store.js";
import { AppError } from "./types.js";
import { Workbench } from "./workbench.js";

/**
 * Runs `fn` at the end of the test, before what was deferred earlier (the
 * temporary directory goes last).
 */
function deferrer(t: TestContext) {
  const deferred: (() => unknown)[] = [];
  t.after(async () => {
    for (const fn of deferred.reverse()) await fn();
  });
  return (fn: () => unknown) => deferred.push(fn);
}

/** A temporary directory removed after the test. */
async function temporary(t: TestContext) {
  const defer = deferrer(t);
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-preflight-test-"));
  defer(() => rm(directory, { recursive: true, force: true }));
  return { directory, defer };
}

/**
 * Puts stand-in CLIs first on PATH for the test. Each logs its arguments
 * to calls.log; no real git, gh, codex or claude is reached for what the
 * stand-ins answer.
 */
async function standIns(
  { directory, defer }: Awaited<ReturnType<typeof temporary>>,
  scripts: Record<string, string>,
) {
  const bin = path.join(directory, "bin");
  await mkdir(bin, { recursive: true });
  const calls = path.join(directory, "calls.log");
  for (const [name, body] of Object.entries(scripts))
    await writeFile(
      path.join(bin, name),
      `#!/bin/sh\necho "${name} $*" >> '${calls}'\n${body}\n`,
      { mode: 0o700 },
    );
  const previous = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previous}`;
  defer(() => {
    process.env.PATH = previous;
  });
  return async () =>
    (await readFile(calls, "utf8").catch(() => "")).split("\n").filter(Boolean);
}

test("an import accepts owner/repo and clones GitHub without past file contents", async (t) => {
  const f = await temporary(t);
  const calls = await standIns(f, {
    // No network: every clone fails after it is recorded.
    git: "echo 'fatal: unable to access' >&2; exit 128",
    gh: "exit 1",
  });
  const store = new Store(path.join(f.directory, "data"));
  await store.initialize();
  const workbench = new Workbench(store);
  f.defer(() => workbench.shutdown());
  await assert.rejects(workbench.importRepository("  octo-org/hello  "), AppError);
  await assert.rejects(
    workbench.importRepository("github.com/octo-org/hello/tree/main/docs"),
    AppError,
  );
  const clones = (await calls()).filter((line) => line.includes(" clone "));
  assert.equal(clones.length, 2);
  for (const line of clones) {
    assert.match(
      line,
      / clone --filter=blob:none --no-recurse-submodules -- https:\/\/github\.com\/octo-org\/hello\.git \S+\/repositories\/octo-org-hello-[0-9a-f]{8}$/,
    );
    // Credentials come from gh alone.
    assert.match(line, /credential\.helper=!gh auth git-credential/);
  }
  assert.equal(store.data.repos.length, 0);
});

test("a clone that takes too long stops with clone_timeout, its advice and no leftovers", async (t) => {
  const f = await temporary(t);
  const destination = path.join(f.directory, "repositories", "octo-org-hello-0000");
  await mkdir(path.dirname(destination), { recursive: true });
  await standIns(f, {
    git: `mkdir -p '${destination}'\nexec sleep 30`,
  });
  const started = Date.now();
  await assert.rejects(
    withLocale("en", () =>
      cloneGitHubRepository(
        path.dirname(destination),
        "https://github.com/octo-org/hello",
        destination,
        300,
      ),
    ),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "clone_timeout");
      assert.equal(error.statusCode, 504);
      assert.match(error.message, /Clone the repository yourself, then import the path/);
      assert.deepEqual(error.fixes, [
        { label: "Clone it yourself", command: "git clone https://github.com/octo-org/hello.git" },
      ]);
      return true;
    },
  );
  assert.ok(Date.now() - started < 10_000);
  assert.equal(existsSync(destination), false);
});
