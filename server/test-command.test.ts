// The test command BELL suggests (from the project's files only) and the
// environment it runs the confirmed command with (DESIGN v1.2 F9).
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { suggestTestCommand, testEnvironment } from "./test-command.js";

/** A temporary project folder with these files; removed after the test. */
async function project(t: TestContext, files: Record<string, string>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-test-command-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(directory, name), content);
  return directory;
}

const npmProject = JSON.stringify({ name: "widgets", scripts: { test: "node --test" } });

test("package.json with a test script suggests npm test, or pnpm or yarn by lockfile", async (t) => {
  assert.equal(await suggestTestCommand(await project(t, { "package.json": npmProject })), "npm test");
  assert.equal(
    await suggestTestCommand(await project(t, { "package.json": npmProject, "pnpm-lock.yaml": "lockfileVersion: 9\n" })),
    "pnpm test",
  );
  assert.equal(
    await suggestTestCommand(await project(t, { "package.json": npmProject, "yarn.lock": "# yarn lockfile v1\n" })),
    "yarn test",
  );
  // pnpm's lockfile first when both are there, as DESIGN F9 lists them.
  assert.equal(
    await suggestTestCommand(
      await project(t, { "package.json": npmProject, "pnpm-lock.yaml": "", "yarn.lock": "" }),
    ),
    "pnpm test",
  );
  // A lockfile alone suggests nothing.
  assert.equal(await suggestTestCommand(await project(t, { "yarn.lock": "" })), "");
});

test("a package.json without a usable test script falls through to the next rule", async (t) => {
  const placeholder = JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } });
  for (const manifest of [
    JSON.stringify({ name: "widgets" }),
    JSON.stringify({ scripts: { build: "tsc" } }),
    JSON.stringify({ scripts: { test: "   " } }),
    JSON.stringify({ scripts: { test: 42 } }),
    JSON.stringify(null),
    placeholder,
    "{ not json",
  ]) {
    assert.equal(await suggestTestCommand(await project(t, { "package.json": manifest })), "", manifest);
    assert.equal(
      await suggestTestCommand(await project(t, { "package.json": manifest, "go.mod": "module example.com/w\n" })),
      "go test ./...",
      manifest,
    );
  }
});

test("Python, Rust, Go and Make projects get their own test command", async (t) => {
  for (const name of ["pyproject.toml", "pytest.ini", "tox.ini"])
    assert.equal(await suggestTestCommand(await project(t, { [name]: "[tool]\n" })), "python -m pytest", name);
  assert.equal(await suggestTestCommand(await project(t, { "Cargo.toml": "[package]\n" })), "cargo test");
  assert.equal(await suggestTestCommand(await project(t, { "go.mod": "module example.com/w\n" })), "go test ./...");
  assert.equal(await suggestTestCommand(await project(t, { Makefile: "build:\n\tcc -o w w.c\ntest: build\n\t./w --self-test\n" })), "make test");
  assert.equal(await suggestTestCommand(await project(t, { makefile: "lint test:\n\ttrue\n" })), "make test");
  assert.equal(await suggestTestCommand(await project(t, { GNUmakefile: "test::\n\ttrue\n" })), "make test");
  assert.equal(await suggestTestCommand(await project(t, {})), "");
});

test("a Makefile without a test target suggests nothing", async (t) => {
  for (const makefile of [
    "build:\n\tcc -o w w.c\n",
    "test := unit\nbuild:\n\ttrue\n",
    "test ::= unit\n",
    "test ?= unit\n",
    ".PHONY: test\nbuild:\n\ttrue\n",
    "# test: not a rule\nbuild:\n\ttrue\n",
    "build:\n\ttest: indented recipe text\n",
    "testing:\n\ttrue\n",
  ])
    assert.equal(await suggestTestCommand(await project(t, { Makefile: makefile })), "", makefile);
});

test("the rules apply in DESIGN F9's order", async (t) => {
  const all = {
    "package.json": npmProject,
    "pyproject.toml": "",
    "Cargo.toml": "",
    "go.mod": "",
    Makefile: "test:\n\ttrue\n",
  };
  const order = ["npm test", "python -m pytest", "cargo test", "go test ./...", "make test"];
  const names = Object.keys(all);
  for (const [index, expected] of order.entries()) {
    const files = Object.fromEntries(names.slice(index).map((name) => [name, all[name as keyof typeof all]]));
    assert.equal(await suggestTestCommand(await project(t, files)), expected);
  }
});

test("only regular files count: a folder or a link named like a manifest is ignored", async (t) => {
  const directory = await project(t, {});
  await mkdir(path.join(directory, "package.json"));
  await mkdir(path.join(directory, "Cargo.toml"));
  assert.equal(await suggestTestCommand(directory), "");
  const outside = await project(t, { "package.json": npmProject, "go.mod": "" });
  const linked = await project(t, {});
  await symlink(path.join(outside, "package.json"), path.join(linked, "package.json"));
  await symlink(path.join(outside, "go.mod"), path.join(linked, "go.mod"));
  assert.equal(await suggestTestCommand(linked), "");
  // A folder that is gone suggests nothing rather than failing.
  assert.equal(await suggestTestCommand(path.join(directory, "missing")), "");
});

test("the test environment drops secrets and BELL's and the CLIs' variables by name, and keeps the rest", () => {
  const source: NodeJS.ProcessEnv = {
    PATH: "/usr/bin:/bin",
    HOME: "/home/person",
    JAVA_HOME: "/opt/jdk",
    VIRTUAL_ENV: "/home/person/.venv",
    GOPATH: "/home/person/go",
    AWS_REGION: "eu-west-1",
    LANG: "en_US.UTF-8",
    CI: "false",
    // Dropped by ending, in any case.
    GH_TOKEN: "x",
    NPM_TOKEN: "x",
    my_secret: "x",
    MY_SECRET: "x",
    DB_PASSWORD: "x",
    OPENAI_API_KEY: "x",
    AWS_SECRET_ACCESS_KEY: "x",
    SSH_PRIVATE_KEY: "x",
    GOOGLE_APPLICATION_CREDENTIALS: "x",
    // Dropped by prefix, in any case.
    BELLPR_X: "x",
    BELLPR_SESSION_TOKEN: "x",
    GH_HOST: "x",
    github_actions: "x",
    ANTHROPIC_BASE_URL: "x",
    OPENAI_BASE_URL: "x",
    CODEX_HOME: "x",
    CLAUDE_CONFIG_DIR: "x",
    UNSET: undefined,
  };
  const before = { ...source };
  const env = testEnvironment(source);
  assert.deepEqual(env, {
    PATH: "/usr/bin:/bin",
    HOME: "/home/person",
    JAVA_HOME: "/opt/jdk",
    VIRTUAL_ENV: "/home/person/.venv",
    GOPATH: "/home/person/go",
    AWS_REGION: "eu-west-1",
    LANG: "en_US.UTF-8",
    CI: "1",
    NO_COLOR: "1",
  });
  // The caller's environment is left as it was.
  assert.deepEqual(source, before);
});
