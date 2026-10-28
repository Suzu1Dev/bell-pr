// The shared credential deny list: ~/.git-credentials, a fixture Git
// config's `credential.helper store --file` paths, and the same paths in
// both agents' sandbox settings.
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sharedCredentialDenials } from "../shared/credential-denials.js";
import { agentCommand } from "./agent-cli.js";
import { command } from "./process.js";
import { runAgent } from "./run-executor.js";
import { setAllowUnsandboxedAgentsSource } from "./sandbox.js";
import { Store } from "./store.js";
import type { Run } from "./types.js";
import { withLocale } from "./i18n/index.js";
import { Workbench, type WorkbenchContext } from "./workbench.js";

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "credential-store.gitconfig",
);

test("a fixture git config's store --file paths are denied, and a missing config is not fatal", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bell-credential-deny-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const xdg = path.join(root, "xdg");
  await mkdir(path.join(xdg, "git"), { recursive: true });
  await mkdir(home, { recursive: true });
  const system = path.join(root, "system.gitconfig");
  await writeFile(
    path.join(xdg, "git", "config"),
    "[credential]\n\thelper = store --file ~/bell-pr-xdg-credentials\n",
  );
  await writeFile(
    system,
    "[credential]\n\thelper = store --file /tmp/bell-pr-system-credentials\n\thelper = osxkeychain\n",
  );
  const fixture = await readFile(fixturePath, "utf8");
  assert.match(fixture, /store --file ~\/\.bell-pr-custom-credentials/);
  assert.match(fixture, /store --file=\/tmp\/bell-pr-store-credentials/);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: xdg,
    GIT_CONFIG_GLOBAL: fixturePath,
    GIT_CONFIG_SYSTEM: system,
  };
  delete env.GIT_CONFIG_NOSYSTEM;
  delete env.GH_CONFIG_DIR;
  delete env.CLAUDE_CONFIG_DIR;
  delete env.CODEX_HOME;
  const denials = sharedCredentialDenials({ env, home });
  for (const entry of [
    "~/.config/gh/**",
    "~/.git-credentials",
    "~/.netrc",
    "~/.ssh/",
    "~/.ssh/**",
    "~/.aws/**",
    "~/.npmrc",
  ])
    assert.ok(denials.includes(entry), entry);
  assert.ok(denials.includes(path.join(home, ".bell-pr-custom-credentials")));
  assert.ok(denials.includes(path.join(home, "bell-pr-xdg-credentials")));
  assert.ok(denials.includes("/tmp/bell-pr-store-credentials"));
  assert.ok(denials.includes("/tmp/bell-pr-system-credentials"));
  // Plain `store`, cache, osxkeychain and a shell helper add no extra file.
  assert.equal(
    denials.filter((entry) => entry.includes("cache") || entry.includes("osxkeychain")).length,
    0,
  );

  const gh = path.join(root, "gh-config");
  await mkdir(gh);
  const moved = sharedCredentialDenials({
    env: { ...env, GH_CONFIG_DIR: gh, XDG_CONFIG_HOME: xdg },
    home,
  });
  assert.ok(moved.includes(`${gh}/**`), "GH_CONFIG_DIR");
  assert.ok(moved.includes(`${path.join(xdg, "gh")}/**`), "XDG_CONFIG_HOME/gh");

  const missing = sharedCredentialDenials({
    env: {
      ...env,
      GIT_CONFIG_GLOBAL: path.join(root, "missing.gitconfig"),
      GIT_CONFIG_SYSTEM: path.join(root, "also-missing.gitconfig"),
      XDG_CONFIG_HOME: path.join(root, "empty-xdg"),
    },
    home,
  });
  assert.ok(missing.includes("~/.git-credentials"));
  assert.ok(!missing.some((entry) => entry.includes("bell-pr-custom")));

  // A directory is not a config file. Git fails; the static list remains.
  const unreadable = sharedCredentialDenials({
    env: {
      ...env,
      GIT_CONFIG_GLOBAL: root,
      GIT_CONFIG_NOSYSTEM: "1",
      XDG_CONFIG_HOME: path.join(root, "empty-xdg"),
    },
    home,
  });
  assert.ok(unreadable.includes("~/.git-credentials"));
  assert.ok(unreadable.includes("~/.netrc"));
});

test("Claude and Codex are given the same shared credential denials", async (t) => {
  const previous = {
    GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
    GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
    GH_CONFIG_DIR: process.env.GH_CONFIG_DIR,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  };
  process.env.GIT_CONFIG_GLOBAL = fixturePath;
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  delete process.env.GH_CONFIG_DIR;
  const xdg = await mkdtemp(path.join(os.tmpdir(), "bell-credential-xdg-"));
  process.env.XDG_CONFIG_HOME = xdg;
  t.after(() => {
    rm(xdg, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const denials = sharedCredentialDenials();
  assert.ok(denials.includes(path.join(os.homedir(), ".bell-pr-custom-credentials")));
  const cwd = os.tmpdir();
  const claude = await agentCommand(
    { provider: "claude", source: "cli-default" },
    { cwd, access: "none" },
  );
  const settings = JSON.parse(
    claude.args[claude.args.indexOf("--settings") + 1],
  ) as { permissions: { deny: string[] } };
  const codex = await agentCommand({ source: "cli-default" }, { cwd, access: "write" });
  const table = codex.args.find((arg) => arg.startsWith("permissions={bell-pr="));
  assert.ok(table);
  for (const entry of [
    "~/.config/gh/**",
    "~/.git-credentials",
    "~/.netrc",
    "~/.ssh/",
    "~/.ssh/**",
    "~/.aws/**",
    "~/.npmrc",
  ]) {
    assert.ok(settings.permissions.deny.includes(`Read(${entry})`), entry);
    assert.ok(table!.includes(`"${entry}"="deny"`), entry);
  }
  const custom = path.join(os.homedir(), ".bell-pr-custom-credentials");
  assert.ok(settings.permissions.deny.some((rule) => rule.includes(custom)));
  assert.ok(table!.includes(`"${custom}"="deny"`));
  assert.ok(!codex.args.includes("--sandbox"));
  assert.equal(codex.args[codex.args.indexOf("default_permissions=\"bell-pr\"") - 1], "-c");
});

/** Sets environment variables for one test and restores them afterwards. */
function withEnv(t: TestContext, values: Record<string, string | undefined>) {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

async function envProbe(t: TestContext, name: string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-agent-env-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, name);
  await writeFile(
    file,
    `#!${process.execPath}
process.stdout.write(JSON.stringify({
  GH_TOKEN: process.env.GH_TOKEN ?? null,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN ?? null,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? null,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? null,
  BELL_MARKER: process.env.BELL_MARKER ?? null,
}));
`,
    { mode: 0o755 },
  );
  return async (env?: NodeJS.ProcessEnv) =>
    JSON.parse((await command(file, [], env ? { env } : {})).stdout) as {
      GH_TOKEN: string | null;
      GITHUB_TOKEN: string | null;
      ANTHROPIC_API_KEY: string | null;
      OPENAI_API_KEY: string | null;
      BELL_MARKER: string | null;
    };
}

test("an agent spawn does not inherit GH_TOKEN or GITHUB_TOKEN from process.env", async (t) => {
  withEnv(t, {
    GH_TOKEN: "from-parent",
    GITHUB_TOKEN: "from-parent-gh",
    ANTHROPIC_API_KEY: "sk-ant-test",
    OPENAI_API_KEY: "sk-openai-test",
    BELL_MARKER: "kept",
  });
  const claude = await envProbe(t, "claude");
  const codex = await envProbe(t, "codex");
  const git = await envProbe(t, "git");
  // No env argument: agents get the allowlist, not process.env. git still inherits.
  const claudeDefault = await claude();
  assert.equal(claudeDefault.GH_TOKEN, null);
  assert.equal(claudeDefault.GITHUB_TOKEN, null);
  assert.equal(claudeDefault.ANTHROPIC_API_KEY, "sk-ant-test");
  assert.equal(claudeDefault.OPENAI_API_KEY, null);
  assert.equal(claudeDefault.BELL_MARKER, null);
  const codexDefault = await codex();
  assert.equal(codexDefault.GH_TOKEN, null);
  assert.equal(codexDefault.GITHUB_TOKEN, null);
  assert.equal(codexDefault.OPENAI_API_KEY, "sk-openai-test");
  assert.equal(codexDefault.ANTHROPIC_API_KEY, null);
  const inherited = await git();
  assert.equal(inherited.GH_TOKEN, "from-parent");
  assert.equal(inherited.GITHUB_TOKEN, "from-parent-gh");
  assert.equal(inherited.BELL_MARKER, "kept");
  // An explicit copy of process.env still loses only the two token variables.
  const passed = await claude({ ...process.env });
  assert.equal(passed.GH_TOKEN, null);
  assert.equal(passed.GITHUB_TOKEN, null);
  assert.equal(passed.ANTHROPIC_API_KEY, "sk-ant-test");
  assert.equal(passed.OPENAI_API_KEY, "sk-openai-test");
  assert.equal(passed.BELL_MARKER, "kept");
  const passedCodex = await codex({ ...process.env });
  assert.equal(passedCodex.GH_TOKEN, null);
  assert.equal(passedCodex.GITHUB_TOKEN, null);
  assert.equal(passedCodex.OPENAI_API_KEY, "sk-openai-test");
});

test("with the sandbox off, spawned Claude and Codex processes have no GH_TOKEN or GITHUB_TOKEN", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-unsandboxed-env-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bin = path.join(directory, "bin");
  await mkdir(bin);
  const records = {
    claude: path.join(directory, "claude.json"),
    codex: path.join(directory, "codex.json"),
  };
  const script = (name: "claude" | "codex", event: string) =>
    `#!${process.execPath}
require('node:fs').writeFileSync(${JSON.stringify(records[name])}, JSON.stringify({
  argv: process.argv,
  GH_TOKEN: process.env.GH_TOKEN ?? null,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN ?? null,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? null,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? null,
}));
require('node:fs').readFileSync(0);
console.log(${JSON.stringify(event)});
`;
  await writeFile(
    path.join(bin, "claude"),
    script(
      "claude",
      JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Edited." }),
    ),
    { mode: 0o755 },
  );
  await writeFile(
    path.join(bin, "codex"),
    script(
      "codex",
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "Edited." },
      }),
    ),
    { mode: 0o755 },
  );
  withEnv(t, {
    PATH: bin,
    GH_TOKEN: "from-parent",
    GITHUB_TOKEN: "from-parent-gh",
    ANTHROPIC_API_KEY: "sk-ant-test",
    OPENAI_API_KEY: "sk-openai-test",
    BELLPR_ALLOW_UNSANDBOXED_AGENTS: "1",
  });
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const workbench = new Workbench(store);
  // The Settings → Agent safety toggle. The env var above is the other switch.
  setAllowUnsandboxedAgentsSource(() => true);
  t.after(() => setAllowUnsandboxedAgentsSource());
  try {
    const ctx = (workbench as unknown as { context: WorkbenchContext }).context;
    const start = async (provider: "claude" | "codex") => {
      const worktreePath = path.join(store.directory, "worktrees", provider);
      await mkdir(worktreePath, { recursive: true });
      const run: Run = {
        id: provider,
        repoId: "repo",
        title: "Edit",
        prompt: "Edit",
        status: "running",
        branch: "fix/unsandbo",
        baseBranch: "main",
        baseSha: "0".repeat(40),
        worktreePath,
        createdAt: new Date().toISOString(),
        agents: [],
        logs: [],
        draft: { title: "", body: "" },
        reviewedFiles: [],
        reviewedFingerprints: {},
        modelExecution: { source: "cli-default", provider },
        locale: "en",
      };
      store.data.runs.push(run);
      assert.equal(
        await withLocale("en", () =>
          runAgent(ctx, run, "member", "Edit the file.", new AbortController().signal, false),
        ),
        "Edited.",
      );
      return run;
    };
    const claudeRun = await start("claude");
    assert.equal(claudeRun.unsandboxed, true);
    const claudeSeen = JSON.parse(await readFile(records.claude, "utf8")) as {
      argv: string[];
      GH_TOKEN: string | null;
      GITHUB_TOKEN: string | null;
      ANTHROPIC_API_KEY: string | null;
      OPENAI_API_KEY: string | null;
    };
    const settings = JSON.parse(
      claudeSeen.argv[claudeSeen.argv.indexOf("--settings") + 1],
    ) as { sandbox?: unknown };
    assert.equal(settings.sandbox, undefined);
    assert.equal(claudeSeen.GH_TOKEN, null);
    assert.equal(claudeSeen.GITHUB_TOKEN, null);
    assert.equal(claudeSeen.ANTHROPIC_API_KEY, "sk-ant-test");
    assert.equal(claudeSeen.OPENAI_API_KEY, null);

    await start("codex");
    const codexSeen = JSON.parse(await readFile(records.codex, "utf8")) as {
      GH_TOKEN: string | null;
      GITHUB_TOKEN: string | null;
      ANTHROPIC_API_KEY: string | null;
      OPENAI_API_KEY: string | null;
    };
    assert.equal(codexSeen.GH_TOKEN, null);
    assert.equal(codexSeen.GITHUB_TOKEN, null);
    assert.equal(codexSeen.OPENAI_API_KEY, "sk-openai-test");
    assert.equal(codexSeen.ANTHROPIC_API_KEY, null);
  } finally {
    await workbench.shutdown();
  }
});
