import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  agentEnvironment,
  assertGitConfigSafe,
  git,
  gitNetwork,
  gitNetworkConfig,
} from "./process.js";
import { AppError } from "./types.js";
import { withLocale } from "./i18n/index.js";

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

const claudeAuth = {
  ANTHROPIC_API_KEY: "sk-ant-test-key",
  ANTHROPIC_AUTH_TOKEN: "auth-token",
  ANTHROPIC_BASE_URL: "https://gateway.example.invalid",
  CLAUDE_CODE_USE_BEDROCK: "1",
  CLAUDE_CODE_USE_VERTEX: "1",
  CLAUDE_CODE_USE_FOUNDRY: "1",
  AWS_ACCESS_KEY_ID: "AKIA-test",
  AWS_SECRET_ACCESS_KEY: "aws-secret",
  AWS_SESSION_TOKEN: "aws-session",
  AWS_REGION: "us-east-1",
  GOOGLE_APPLICATION_CREDENTIALS: "/creds/google.json",
  ANTHROPIC_VERTEX_PROJECT_ID: "vertex-project",
  CLOUD_ML_REGION: "us-east5",
  CLAUDE_CONFIG_DIR: "/config/claude",
  CLAUDE_CODE_OAUTH_TOKEN: "oauth-token",
};
const codexAuth = {
  CODEX_HOME: "/config/codex",
  OPENAI_API_KEY: "sk-openai-test",
  CODEX_API_KEY: "codex-key",
};

test("each agent CLI gets its own sign-in variables and never the other's", (t) => {
  withEnv(t, {
    ...claudeAuth,
    ...codexAuth,
    // Never forwarded to any agent.
    GITHUB_TOKEN: "ghp_never",
    GH_TOKEN: "ghp_never",
    BELLPR_LICENSE_KEY: "BELLPR1.never",
    NPM_TOKEN: "npm-never",
  });
  const claude = agentEnvironment("claude");
  for (const [key, value] of Object.entries(claudeAuth))
    assert.equal(claude[key], value, key);
  assert.equal(claude.ANTHROPIC_API_KEY, "sk-ant-test-key");
  assert.equal(claude.CLAUDE_CODE_USE_BEDROCK, "1");
  for (const key of Object.keys(codexAuth)) assert.equal(claude[key], undefined, key);
  assert.equal(claude.OPENAI_API_KEY, undefined);

  const codex = agentEnvironment("codex");
  for (const [key, value] of Object.entries(codexAuth))
    assert.equal(codex[key], value, key);
  for (const key of Object.keys(codex)) {
    assert.doesNotMatch(key, /^ANTHROPIC_/, key);
    assert.doesNotMatch(key, /^(?:CLAUDE_|AWS_|GOOGLE_|CLOUD_ML_)/, key);
  }

  // Without a provider: both sets, a superset of what earlier builds passed.
  const both = agentEnvironment();
  for (const [key, value] of Object.entries({ ...claudeAuth, ...codexAuth }))
    assert.equal(both[key], value, key);

  for (const env of [claude, codex, both]) {
    assert.equal(env.GITHUB_TOKEN, undefined);
    assert.equal(env.GH_TOKEN, undefined);
    assert.equal(env.BELLPR_LICENSE_KEY, undefined);
    assert.equal(env.NPM_TOKEN, undefined);
    assert.equal(env.NO_COLOR, "1");
    assert.equal(env.GIT_TERMINAL_PROMPT, "0");
    assert.equal(env.PATH, process.env.PATH);
  }
});

test("empty variables are left out", (t) => {
  withEnv(t, { ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "" });
  assert.equal("ANTHROPIC_API_KEY" in agentEnvironment("claude"), false);
  assert.equal("OPENAI_API_KEY" in agentEnvironment("codex"), false);
});

/** A git stand-in first on PATH that records its arguments and environment. */
async function recordingGit(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-process-git-"));
  const record = path.join(directory, "calls.jsonl");
  await writeFile(
    path.join(directory, "git"),
    `#!${process.execPath}
require('node:fs').appendFileSync(${JSON.stringify(record)}, JSON.stringify({
  args: process.argv.slice(2),
  prompt: process.env.GIT_TERMINAL_PROMPT,
}) + '\\n');
`,
    { mode: 0o755 },
  );
  withEnv(t, { PATH: `${directory}${path.delimiter}${process.env.PATH}` });
  t.after(() => rm(directory, { recursive: true, force: true }));
  return async () =>
    (await readFile(record, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { args: string[]; prompt?: string });
}

/** The value of each `-c key=value` pair in an argument list. */
const configOf = (args: string[]) =>
  args.flatMap((arg, index) => (args[index - 1] === "-c" ? [arg] : []));

test("every Git command overrides hooks, monitors, pagers, editors, prompts and SSH from the repository", async (t) => {
  const calls = await recordingGit(t);
  await git(os.tmpdir(), ["status"]);
  const [call] = await calls();
  assert.deepEqual(configOf(call.args), [
    "core.hooksPath=/dev/null",
    "core.fsmonitor=false",
    "core.quotePath=false",
    "core.attributesFile=/dev/null",
    "core.sshCommand=ssh",
    "core.pager=cat",
    "core.editor=true",
    "core.askPass=",
  ]);
  assert.equal(call.args.at(-1), "status");
});

test("network Git commands use gh credentials, HTTPS or SSH only, and never prompt", async (t) => {
  const calls = await recordingGit(t);
  await gitNetwork(os.tmpdir(), ["ls-remote", "--", "https://github.com/o/r.git"], {
    // A caller's own environment cannot turn prompting back on.
    env: { ...process.env, GIT_TERMINAL_PROMPT: "1" },
  });
  const [call] = await calls();
  const config = configOf(call.args);
  for (const value of configOf(gitNetworkConfig)) assert.ok(config.includes(value), value);
  assert.ok(config.includes("protocol.allow=never"));
  assert.ok(config.includes("protocol.ext.allow=never"));
  assert.ok(config.includes("protocol.file.allow=never"));
  assert.ok(config.includes("credential.helper=!gh auth git-credential"));
  // The empty helper comes first, so no configured helper is asked.
  assert.ok(config.indexOf("credential.helper=") < config.indexOf("credential.helper=!gh auth git-credential"));
  assert.ok(config.includes("core.hooksPath=/dev/null"));
  assert.equal(call.prompt, "0");
});

async function repository(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-process-repo-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await git(directory, ["init", "-q", "-b", "main"]);
  return directory;
}

test("a repository whose own Git configuration could run commands is refused", async (t) => {
  const directory = await repository(t);
  // Ordinary settings, including harmless diff and merge preferences, pass.
  for (const [key, value] of [
    ["user.name", "Someone"],
    ["diff.renames", "true"],
    ["diff.algorithm", "histogram"],
    ["merge.conflictStyle", "diff3"],
    ["diff.custom.xfuncname", "^def"],
    ["merge.custom.name", "A custom driver"],
  ])
    await git(directory, ["config", key, value]);
  await assertGitConfigSafe(directory);

  for (const [key, value] of [
    ["filter.lfs.clean", "touch pwned"],
    ["filter.x.process", "touch pwned"],
    ["diff.external", "touch pwned"],
    ["diff.x.textconv", "touch pwned"],
    ["diff.x.command", "touch pwned"],
    ["merge.x.driver", "touch pwned"],
    ["core.sshCommand", "touch pwned"],
    ["core.pager", "touch pwned"],
    ["core.editor", "touch pwned"],
    ["core.askPass", "touch pwned"],
    ["core.fsmonitor", "touch pwned"],
    ["core.hooksPath", "/tmp"],
    ["credential.helper", "store"],
    ["credential.https://github.com.username", "x"],
    ["protocol.ext.allow", "always"],
    ["include.path", "/tmp/other.config"],
    ["includeIf.gitdir:/tmp/.path", "/tmp/other.config"],
    ["core.alternateRefsCommand", "touch pwned"],
    ["url.https://evil.example/.insteadOf", "https://github.com/"],
  ]) {
    await git(directory, ["config", key, value]);
    await assert.rejects(
      withLocale("en", () => assertGitConfigSafe(directory)),
      (error: unknown) =>
        error instanceof AppError &&
        error.statusCode === 409 &&
        error.code === "git_config_unsafe" &&
        error.message.includes(key.toLowerCase().split(".")[0]),
      key,
    );
    await git(directory, ["config", "--unset-all", key]);
  }
  await assertGitConfigSafe(directory);

  // The worktree's own configuration counts as the repository's.
  await git(directory, ["config", "extensions.worktreeConfig", "true"]);
  await assertGitConfigSafe(directory);
  await git(directory, ["config", "--worktree", "filter.w.clean", "touch pwned"]);
  await assert.rejects(assertGitConfigSafe(directory), (error: unknown) =>
    error instanceof AppError && error.code === "git_config_unsafe",
  );
  await git(directory, ["config", "--worktree", "--unset", "filter.w.clean"]);

  // The person's global configuration is theirs: Git LFS filters and URL
  // rewrites there are not the repository's doing.
  const global = path.join(directory, "global.gitconfig");
  await writeFile(
    global,
    '[filter "lfs"]\n\tclean = git-lfs clean -- %f\n[url "git@github.com:"]\n\tinsteadOf = https://github.com/\n',
  );
  withEnv(t, { GIT_CONFIG_GLOBAL: global });
  await assertGitConfigSafe(directory);
});
