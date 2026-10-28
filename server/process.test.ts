import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  agentEnvironment,
  assertGitConfigSafe,
  command,
  git,
  gitChildEnv,
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
    assert.equal(env.NPM_TOKEN, undefined);
    assert.equal(env.NO_COLOR, "1");
    assert.equal(env.GIT_TERMINAL_PROMPT, "0");
    assert.equal(env.PATH, process.env.PATH);
  }
});

test("usage-data opt-outs the person set reach the agents, and BELL PR never sets one", (t) => {
  const claudeOptOuts = {
    DISABLE_TELEMETRY: "1",
    DISABLE_ERROR_REPORTING: "1",
    DISABLE_BUG_COMMAND: "1",
    CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "true",
  };
  withEnv(t, { ...claudeOptOuts, DO_NOT_TRACK: "1" });
  const claude = agentEnvironment("claude");
  for (const [key, value] of Object.entries({ ...claudeOptOuts, DO_NOT_TRACK: "1" }))
    assert.equal(claude[key], value, key);
  // Codex gets the cross-tool convention only, not Claude Code's variables.
  const codex = agentEnvironment("codex");
  assert.equal(codex.DO_NOT_TRACK, "1");
  for (const key of Object.keys(claudeOptOuts)) assert.equal(key in codex, false, key);
  const both = agentEnvironment();
  for (const [key, value] of Object.entries({ ...claudeOptOuts, DO_NOT_TRACK: "1" }))
    assert.equal(both[key], value, key);

  // Unset, nothing is added on the person's behalf.
  for (const key of ["DO_NOT_TRACK", ...Object.keys(claudeOptOuts)]) delete process.env[key];
  for (const env of [agentEnvironment("claude"), agentEnvironment("codex"), agentEnvironment()])
    for (const key of ["DO_NOT_TRACK", ...Object.keys(claudeOptOuts)])
      assert.equal(key in env, false, key);
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

test("every Git command overrides hooks, monitors, pagers, editors, prompts, SSH and log signature checks from the repository", async (t) => {
  const calls = await recordingGit(t);
  await git(os.tmpdir(), ["status"]);
  const call = (await calls()).find((item) => item.args.at(-1) === "status");
  assert.ok(call);
  assert.deepEqual(configOf(call.args), [
    "core.hooksPath=/dev/null",
    "core.fsmonitor=false",
    "core.quotePath=false",
    "core.attributesFile=/dev/null",
    "core.sshCommand=ssh",
    "core.pager=cat",
    "core.editor=true",
    "core.askPass=",
    "log.showSignature=false",
    "credential.helper=",
    "diff.external=",
    "uploadpack.packObjectsHook=",
    "protocol.ext.allow=never",
  ]);
  assert.equal(call.args.at(-1), "status");
  assert.ok(call.args.includes("--no-pager"));
});

test("network Git commands use gh credentials, HTTPS or SSH only, and never prompt", async (t) => {
  const calls = await recordingGit(t);
  await gitNetwork(os.tmpdir(), ["ls-remote", "--", "https://github.com/o/r.git"], {
    // A caller's own environment cannot turn prompting back on.
    env: { ...process.env, GIT_TERMINAL_PROMPT: "1" },
  });
  const call = (await calls()).find((item) => item.args.includes("ls-remote"));
  assert.ok(call);
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

test("git children do not see GH_TOKEN; gitNetwork and gh do", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-git-env-"));
  const record = path.join(directory, "seen.jsonl");
  const script = `#!${process.execPath}
require('node:fs').appendFileSync(${JSON.stringify(record)}, JSON.stringify({
  args: process.argv.slice(2),
  GH_TOKEN: process.env.GH_TOKEN ?? null,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN ?? null,
  BELL_MARKER: process.env.BELL_MARKER ?? null,
}) + '\\n');
if (process.argv.includes('config')) process.exit(0);
`;
  await writeFile(path.join(directory, "git"), script, { mode: 0o755 });
  await writeFile(path.join(directory, "gh"), script, { mode: 0o755 });
  withEnv(t, {
    PATH: `${directory}${path.delimiter}${process.env.PATH}`,
    GH_TOKEN: "from-parent",
    GITHUB_TOKEN: "from-parent-gh",
    BELL_MARKER: "secret",
  });
  t.after(() => rm(directory, { recursive: true, force: true }));
  await git(os.tmpdir(), ["status"]);
  await git(os.tmpdir(), ["status"], {
    env: { ...process.env, GH_TOKEN: "explicit", GITHUB_TOKEN: "explicit-gh" },
  });
  await command("git", ["--version"], { env: { ...process.env } });
  await gitNetwork(os.tmpdir(), ["ls-remote", "https://example.invalid/r.git"]);
  await command("gh", ["api", "user"]);
  const seen = (await readFile(record, "utf8"))
    .trim()
    .split("\n")
    .map(
      (line) =>
        JSON.parse(line) as {
          args: string[];
          GH_TOKEN: string | null;
          GITHUB_TOKEN: string | null;
          BELL_MARKER: string | null;
        },
    );
  const local = seen.filter(
    (call) => !call.args.includes("ls-remote") && !call.args.includes("api"),
  );
  assert.ok(local.length >= 3);
  for (const call of local) {
    assert.equal(call.GH_TOKEN, null);
    assert.equal(call.GITHUB_TOKEN, null);
    assert.equal(call.BELL_MARKER, null);
  }
  const remote = seen.find((call) => call.args.includes("ls-remote"));
  assert.ok(remote);
  assert.equal(remote.GH_TOKEN, "from-parent");
  assert.equal(remote.GITHUB_TOKEN, "from-parent-gh");
  assert.equal(remote.BELL_MARKER, null);
  const gh = seen.find((call) => call.args.includes("api"));
  assert.ok(gh);
  assert.equal(gh.GH_TOKEN, "from-parent");
  assert.equal(gh.GITHUB_TOKEN, "from-parent-gh");
  assert.equal(gh.BELL_MARKER, null);
});

async function repository(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-process-repo-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await git(directory, ["init", "-q", "-b", "main"]);
  return directory;
}

test("a repository whose own Git configuration could run commands is refused", async (t) => {
  const directory = await repository(t);
  // Ordinary settings, including harmless diff and merge preferences, pass,
  // and so do the programs every git() call overrides with -c (a husky
  // checkout sets core.hooksPath).
  for (const [key, value] of [
    ["user.name", "Someone"],
    ["diff.renames", "true"],
    ["diff.algorithm", "histogram"],
    ["merge.conflictStyle", "diff3"],
    ["diff.custom.xfuncname", "^def"],
    ["merge.custom.name", "A custom driver"],
    ["gpg.format", "ssh"],
    ["gpg.ssh.allowedSignersFile", ".allowed_signers"],
    ["core.hooksPath", ".husky/_"],
    ["core.fsmonitor", "touch pwned"],
    ["core.sshCommand", "touch pwned"],
    ["core.pager", "touch pwned"],
    ["core.editor", "touch pwned"],
    ["core.askPass", "touch pwned"],
  ])
    await git(directory, ["config", key, value]);
  await assertGitConfigSafe(directory);
  for (const key of [
    "core.hooksPath",
    "core.fsmonitor",
    "core.sshCommand",
    "core.pager",
    "core.editor",
    "core.askPass",
  ])
    await git(directory, ["config", "--unset-all", key]);

  for (const [key, value] of [
    ["filter.lfs.clean", "touch pwned"],
    ["filter.x.process", "touch pwned"],
    ["diff.external", "touch pwned"],
    ["diff.x.textconv", "touch pwned"],
    ["diff.x.command", "touch pwned"],
    ["merge.x.driver", "touch pwned"],
    ["credential.helper", "store"],
    ["credential.https://github.com.username", "x"],
    ["protocol.ext.allow", "always"],
    ["include.path", "/tmp/other.config"],
    ["includeIf.gitdir:/tmp/.path", "/tmp/other.config"],
    ["core.alternateRefsCommand", "touch pwned"],
    ["url.https://evil.example/.insteadOf", "https://github.com/"],
    ["gpg.program", "touch pwned"],
    ["gpg.openpgp.program", "touch pwned"],
    ["gpg.x509.program", "touch pwned"],
    ["gpg.ssh.program", "touch pwned"],
    ["gpg.ssh.defaultKeyCommand", "touch pwned"],
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

test("a checkout's own hooks path and file monitor never run through git()", async (t) => {
  const directory = await repository(t);
  await git(directory, ["config", "user.name", "Someone"]);
  await git(directory, ["config", "user.email", "someone@example.invalid"]);
  const marker = path.join(directory, "ran");
  const hooks = path.join(directory, ".husky", "_");
  await mkdir(hooks, { recursive: true });
  const script = `#!/bin/sh\necho "$0" >> ${JSON.stringify(marker)}\n`;
  for (const name of ["pre-commit", "post-commit", "monitor"])
    await writeFile(path.join(hooks, name), script, { mode: 0o755 });
  await git(directory, ["config", "core.hooksPath", ".husky/_"]);
  await git(directory, ["config", "core.fsmonitor", path.join(hooks, "monitor")]);
  await assertGitConfigSafe(directory);
  await writeFile(path.join(directory, "file.txt"), "content\n");
  await git(directory, ["add", "file.txt"]);
  await git(directory, ["commit", "-q", "-m", "Add a file"]);
  await git(directory, ["status", "--porcelain"]);
  assert.equal(await readFile(marker, "utf8").catch(() => ""), "");
});

test("a checkout's own signing program never verifies a signed commit in git log", async (t) => {
  const directory = await repository(t);
  const marker = path.join(directory, "ran");
  const program = path.join(directory, "verify.sh");
  await writeFile(program, `#!/bin/sh\necho "$0" >> ${JSON.stringify(marker)}\n`, {
    mode: 0o755,
  });
  await git(directory, ["config", "log.showSignature", "true"]);
  await git(directory, ["config", "gpg.program", program]);
  // A commit carrying a signature, as GitHub's web-flow commits do.
  const tree = (await git(directory, ["mktree"])).stdout.trim();
  const commit = (
    await git(directory, ["hash-object", "-t", "commit", "-w", "--stdin"], {
      input: [
        `tree ${tree}`,
        "author Someone <someone@example.invalid> 1700000000 +0000",
        "committer Someone <someone@example.invalid> 1700000000 +0000",
        "gpgsig -----BEGIN PGP SIGNATURE-----",
        " ",
        " AAAA",
        " -----END PGP SIGNATURE-----",
        "",
        "Signed on the web",
        "",
      ].join("\n"),
    })
  ).stdout.trim();
  await git(directory, ["update-ref", "refs/heads/main", commit]);
  await git(directory, ["log", "--no-color", "--format=%H%x00%s"]);
  await git(directory, ["show", "--no-color", "--format=%B", "--no-patch", commit]);
  assert.equal(await readFile(marker, "utf8").catch(() => ""), "");
});

test("a run checkout whose .git file was replaced does not run its filter or credential helper", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bell-process-forged-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo");
  const checkout = path.join(root, "worktrees", "run-1");
  const attack = path.join(root, "attack");
  const filterMarker = path.join(root, "filter-ran");
  const credentialMarker = path.join(root, "credential-ran");
  await mkdir(repo, { recursive: true });
  await mkdir(attack, { recursive: true });
  await git(repo, ["init", "-q", "-b", "main"]);
  await git(repo, ["config", "user.name", "Someone"]);
  await git(repo, ["config", "user.email", "someone@example.invalid"]);
  await writeFile(path.join(repo, "file.txt"), "v1\n");
  await git(repo, ["add", "file.txt"]);
  await git(repo, ["commit", "-q", "-m", "initial"]);
  await git(repo, ["worktree", "add", "-q", "--detach", checkout]);
  const gitDir = (await git(checkout, ["rev-parse", "--absolute-git-dir"])).stdout.trim();
  await git(checkout, ["status", "--porcelain"]);

  await git(attack, ["init", "-q", "-b", "main"]);
  await git(attack, ["config", "filter.pwn.clean", `touch ${filterMarker}`]);
  await git(attack, ["config", "filter.pwn.required", "true"]);
  await git(attack, ["config", "credential.helper", `!touch ${credentialMarker}`]);
  await rm(path.join(checkout, ".git"));
  await rename(path.join(attack, ".git"), path.join(checkout, ".git"));
  await writeFile(path.join(checkout, ".gitattributes"), "* filter=pwn\n");
  await writeFile(path.join(checkout, "file.txt"), "v2\n");

  assert.equal(
    (await git(checkout, ["rev-parse", "--absolute-git-dir"])).stdout.trim(),
    gitDir,
  );
  await git(checkout, ["status", "--porcelain"]);
  await git(checkout, ["add", "file.txt"]);
  await gitNetwork(checkout, ["push", "origin", "HEAD"]).catch(() => undefined);
  await assert.rejects(readFile(filterMarker, "utf8"));
  await assert.rejects(readFile(credentialMarker, "utf8"));
});

test("server git runs neither hooks, fsmonitor, filters, nor credential or ssh commands planted in the clone", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bell-process-planted-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo");
  const checkout = path.join(root, "worktrees", "run-1");
  const marker = path.join(root, "ran");
  await mkdir(repo, { recursive: true });
  await git(repo, ["init", "-q", "-b", "main"]);
  await git(repo, ["config", "user.name", "Someone"]);
  await git(repo, ["config", "user.email", "someone@example.invalid"]);
  await writeFile(path.join(repo, "file.txt"), "v1\n");
  await git(repo, ["add", "file.txt"]);
  await git(repo, ["commit", "-q", "-m", "initial"]);
  await git(repo, ["worktree", "add", "-q", "--detach", checkout]);
  const script = `#!/bin/sh\necho "$0" >> ${JSON.stringify(marker)}\n`;
  const hooks = path.join(repo, ".git", "hooks");
  await mkdir(hooks, { recursive: true });
  for (const name of ["pre-commit", "post-commit"])
    await writeFile(path.join(hooks, name), script, { mode: 0o755 });
  const monitor = path.join(root, "monitor");
  const ssh = path.join(root, "ssh-command");
  await writeFile(monitor, script, { mode: 0o755 });
  await writeFile(ssh, script, { mode: 0o755 });
  await git(repo, ["config", "core.fsmonitor", monitor]);
  await git(repo, ["config", "filter.pwn.clean", monitor]);
  await git(repo, ["config", "filter.pwn.required", "true"]);
  await git(repo, ["config", "credential.helper", `!${monitor}`]);
  await git(repo, ["config", "core.sshCommand", ssh]);
  await writeFile(path.join(checkout, ".gitattributes"), "* filter=pwn\n");
  await writeFile(path.join(checkout, "file.txt"), "v2\n");
  await git(checkout, ["status", "--porcelain"]);
  await git(checkout, ["add", "file.txt"]);
  await git(checkout, ["commit", "-q", "-m", "edit"]);
  await gitNetwork(checkout, ["fetch", "origin"], { timeoutMs: 5_000 }).catch(() => undefined);
  await gitNetwork(checkout, ["ls-remote", "git@127.0.0.1:none.git"], {
    timeoutMs: 5_000,
  }).catch(() => undefined);
  assert.equal(await readFile(marker, "utf8").catch(() => ""), "");
});

test("server git does not pass askpass variables", (t) => {
  withEnv(t, {
    GIT_ASKPASS: "/tmp/bell-askpass",
    SSH_ASKPASS: "/tmp/bell-ssh-askpass",
    GIT_PAGER: "/tmp/bell-pager",
    GH_TOKEN: "from-parent",
  });
  const env = gitChildEnv({ ...process.env }, false);
  assert.equal(env.GIT_ASKPASS, undefined);
  assert.equal(env.SSH_ASKPASS, undefined);
  assert.equal(env.GIT_PAGER, "cat");
  assert.equal(env.GH_TOKEN, undefined);
});

test("a checkout .gitattributes driver from local config, include.path, or includeIf does not run", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bell-process-attrs-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo");
  const checkout = path.join(root, "worktrees", "run-1");
  const bare = path.join(root, "bare.git");
  const marker = path.join(root, "ran");
  const script = path.join(root, "mark");
  await mkdir(repo, { recursive: true });
  await writeFile(
    script,
    `#!/bin/sh\necho "$0" >> ${JSON.stringify(marker)}\ncat\n`,
    { mode: 0o755 },
  );
  await git(repo, ["init", "-q", "-b", "main"]);
  await git(repo, ["config", "user.name", "Someone"]);
  await git(repo, ["config", "user.email", "someone@example.invalid"]);
  await writeFile(path.join(repo, "file.txt"), "v1\n");
  await git(repo, ["add", "file.txt"]);
  await git(repo, ["commit", "-q", "-m", "initial"]);
  await git(repo, ["worktree", "add", "-q", "--detach", checkout]);
  const gitDir = (await git(checkout, ["rev-parse", "--absolute-git-dir"])).stdout.trim();
  const included = path.join(root, "included.gitconfig");
  const conditional = path.join(root, "conditional.gitconfig");
  await writeFile(
    included,
    `[filter "inc"]\n\tclean = ${script}\n\trequired = true\n[diff "inc"]\n\tcommand = ${script}\n\ttextconv = ${script}\n`,
  );
  await writeFile(
    conditional,
    `[filter "ifi"]\n\tclean = ${script}\n\trequired = true\n[diff "ifi"]\n\tcommand = ${script}\n\ttextconv = ${script}\n`,
  );
  await git(checkout, ["config", "filter.direct.clean", script]);
  await git(checkout, ["config", "filter.direct.required", "true"]);
  await git(checkout, ["config", "diff.direct.command", script]);
  await git(checkout, ["config", "diff.direct.textconv", script]);
  await git(checkout, ["config", "include.path", included]);
  await git(checkout, ["config", `includeIf.gitdir:${gitDir}.path`, conditional]);
  await git(checkout, ["config", "core.pager", script]);
  await git(checkout, ["config", "core.askPass", script]);
  await writeFile(
    path.join(checkout, ".gitattributes"),
    "a.txt filter=direct diff=direct\nb.txt filter=inc diff=inc\nc.txt filter=ifi diff=ifi\n",
  );
  for (const key of ["filter.direct.clean", "filter.inc.clean", "filter.ifi.clean"]) {
    const seen = spawnSync(
      "git",
      ["--git-dir", gitDir, "--work-tree", checkout, "config", "--get", key],
      { encoding: "utf8" },
    );
    assert.equal(seen.status, 0, key);
    assert.equal(seen.stdout.trim(), script, key);
  }
  await writeFile(path.join(checkout, "a.txt"), "a\n");
  await writeFile(path.join(checkout, "b.txt"), "b\n");
  await writeFile(path.join(checkout, "c.txt"), "c\n");
  withEnv(t, { GIT_ASKPASS: script, SSH_ASKPASS: script, GIT_PAGER: script });
  await git(checkout, ["status", "--porcelain"]);
  await git(checkout, ["add", "a.txt", "b.txt", "c.txt"]);
  await git(checkout, ["diff", "--cached"]);
  await git(checkout, ["commit", "-q", "-m", "edit"]);
  await writeFile(path.join(checkout, "a.txt"), "a2\n");
  await git(checkout, ["diff"]);
  await mkdir(bare, { recursive: true });
  await git(bare, ["init", "--bare", "-q"]);
  await git(checkout, ["remote", "add", "origin", bare]);
  await git(checkout, ["push", "origin", "HEAD:refs/heads/main"]);
  await assert.rejects(readFile(marker));
});
