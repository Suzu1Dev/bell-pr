import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { DoctorCheck, DoctorReport } from "../shared/doctor.js";
import {
  claudeAuthDetail,
  cliStatus,
  defaultProviderFrom,
  formatDoctorReport,
  knownDoctorReport,
  parseGithubUser,
  runDoctor,
  runDoctorCli,
} from "./doctor.js";
import { currentLocale, withLocale } from "./i18n/index.js";
import { command } from "./process.js";
import { allowUnsandboxedAgents } from "./sandbox.js";
import { AppError } from "./types.js";

/**
 * Stand-in CLIs, the only directory on PATH, so no real git, gh, codex or
 * claude can run. Each script logs its arguments to calls.log and answers
 * by its first arguments, like the tool it stands in for.
 */
async function fakes(t: TestContext, scripts: Record<string, string>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-doctor-test-"));
  const bin = path.join(directory, "bin");
  await mkdir(bin);
  const calls = path.join(directory, "calls.log");
  for (const [name, body] of Object.entries(scripts))
    await writeFile(
      path.join(bin, name),
      `#!/bin/sh\necho "${name} $*" >> '${calls}'\n${body}\n`,
      { mode: 0o700 },
    );
  const previous = {
    path: process.env.PATH,
    allow: process.env.BELLPR_ALLOW_UNSANDBOXED_AGENTS,
  };
  process.env.PATH = bin;
  delete process.env.BELLPR_ALLOW_UNSANDBOXED_AGENTS;
  t.after(async () => {
    process.env.PATH = previous.path;
    if (previous.allow !== undefined)
      process.env.BELLPR_ALLOW_UNSANDBOXED_AGENTS = previous.allow;
    await chmod(directory, 0o700).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  });
  return {
    directory,
    calls: async () =>
      (await readFile(calls, "utf8").catch(() => "")).split("\n").filter(Boolean),
  };
}

const git = (version = "2.45.1", identity = "ok") => `for arg in "$@"; do
  case "$arg" in
    --version) echo "git version ${version}"; exit 0 ;;
    var) ${
      identity === "missing"
        ? `printf 'Author identity unknown\\n\\n*** Please tell me who you are.\\n\\nfatal: unable to auto-detect email address (got "me@host.(none)")\\n' >&2; exit 128`
        : `echo "Test User <${identity === "ok" ? "test@example.com" : "me@host.example"}> 1760000000 +0000"; exit 0`
    } ;;
    config) ${identity === "ok" ? 'echo "test@example.com"; exit 0' : "exit 1"} ;;
  esac
done
exit 1`;

const githubUser = (scopes: string | null) =>
  `printf 'HTTP/2.0 200 OK\\r\\nContent-Type: application/json\\r\\n${
    scopes === null ? "" : `X-Oauth-Scopes: ${scopes}\\r\\n`
  }\\r\\noctocat\\n583231\\n'`;

const gh = (
  auth: "ok" | "signed-out" | "offline" | "rejected" = "ok",
  /** null: a token that does not report scopes (fine-grained). */
  scopes: string | null = "repo, workflow, read:org",
) => `case "$1" in
  --version) echo "gh version 2.46.0 (2024-03-13)" ;;
  auth) ${auth === "signed-out" ? "echo 'You are not logged into any GitHub hosts. To log in, run: gh auth login' >&2; exit 1" : "echo gho_faketoken"} ;;
  api) ${
    auth === "offline"
      ? "echo 'error connecting to api.github.com' >&2; exit 1"
      : auth === "rejected"
        ? "echo 'gh: Bad credentials (HTTP 401)' >&2; exit 1"
        : githubUser(scopes)
  } ;;
  *) exit 1 ;;
esac`;

const codex = (signedIn = true) => `case "$1" in
  --version) echo "codex-cli 0.159.0" ;;
  login) ${signedIn ? 'echo "Logged in using ChatGPT"' : 'echo "Not logged in" >&2; exit 1'} ;;
  *) exit 1 ;;
esac`;

const claude = (signedIn = true) => `case "$1" in
  --version) echo "2.1.292 (Claude Code)" ;;
  auth) ${
    signedIn
      ? `echo '{"loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty", "email": "me@example.com", "subscriptionType": "pro"}'`
      : `echo '{"loggedIn": false, "authMethod": "none"}'; exit 1`
  } ;;
  *) exit 1 ;;
esac`;

const check = (report: DoctorReport, id: DoctorCheck["id"]) => {
  const found = report.checks.find((value) => value.id === id);
  assert.ok(found, id);
  return found;
};

const statuses = (report: DoctorReport) =>
  Object.fromEntries(report.checks.map((value) => [value.id, value.status]));

test("nothing installed: Git and a provider are required, with install fixes", async (t) => {
  const f = await fakes(t, {});
  const report = await withLocale("en", () =>
    runDoctor({ force: true, platform: "linux" }),
  );
  assert.equal(report.ready, false);
  assert.deepEqual(
    report.checks.map((value) => value.id),
    [
      "node", "git", "git-identity", "gh", "gh-auth", "gh-scopes", "codex", "codex-auth",
      "claude", "claude-auth", "claude-sandbox", "provider-ready", "data-dir", "app", "platform",
    ],
  );
  assert.deepEqual(statuses(report), {
    node: "ok",
    git: "fail",
    "git-identity": "skip",
    gh: "warn",
    "gh-auth": "skip",
    "gh-scopes": "skip",
    codex: "skip",
    "codex-auth": "skip",
    claude: "skip",
    "claude-auth": "skip",
    "claude-sandbox": "skip",
    "provider-ready": "fail",
    "data-dir": "skip",
    app: "ok",
    platform: "ok",
  });
  assert.equal(check(report, "git").reason, "missing");
  assert.deepEqual(check(report, "git").fixes, [
    { label: "Install Git", command: "sudo apt install git", platform: "linux" },
  ]);
  assert.deepEqual(check(report, "gh").fixes?.map((fix) => fix.command), ["sudo apt install gh"]);
  const provider = check(report, "provider-ready");
  assert.equal(provider.required, true);
  assert.equal(provider.reason, "none-ready");
  assert.deepEqual(provider.fixes?.map((fix) => fix.command), [
    "npm install -g @openai/codex",
    "codex login",
    "npm install -g @anthropic-ai/claude-code",
    "claude auth login",
  ]);
  // On macOS the same checks offer the macOS commands.
  const mac = await withLocale("en", () => runDoctor({ platform: "darwin" }));
  assert.deepEqual(check(mac, "git").fixes?.map((fix) => fix.command), ["xcode-select --install"]);
  assert.deepEqual(check(mac, "gh").fixes?.map((fix) => fix.command), ["brew install gh"]);
  const windows = await withLocale("en", () => runDoctor({ platform: "win32" }));
  assert.equal(check(windows, "platform").status, "warn");
  assert.equal(check(windows, "platform").reason, "windows");
  assert.deepEqual(check(windows, "git").fixes?.map((fix) => fix.command), ["wsl --install"]);
  assert.deepEqual(await f.calls(), []);
});

test("everything ready: versions, the GitHub account, scopes and the Claude plan", async (t) => {
  const f = await fakes(t, { git: git(), gh: gh(), codex: codex(), claude: claude() });
  const dataDir = path.join(f.directory, "data");
  const report = await withLocale("en", () =>
    runDoctor({
      force: true,
      dataDir,
      platform: "linux",
      app: { version: "9.9.9", port: 4541, maxActiveRuns: 2, maxAgentProcesses: 3 },
    }),
  );
  assert.equal(report.ready, true);
  for (const id of ["git", "git-identity", "gh", "gh-auth", "gh-scopes", "codex", "codex-auth", "claude", "claude-auth", "provider-ready", "data-dir"] as const)
    assert.equal(check(report, id).status, "ok", id);
  assert.equal(check(report, "git").version, "2.45.1");
  assert.equal(check(report, "git-identity").detail, "Test User <test@example.com>");
  assert.equal(check(report, "gh").version, "2.46.0");
  assert.equal(check(report, "gh-auth").detail, "octocat");
  assert.deepEqual(check(report, "gh-auth").params, { login: "octocat" });
  assert.equal(check(report, "gh-scopes").detail, "repo, workflow, read:org");
  assert.equal(check(report, "codex").version, "0.159.0");
  assert.equal(check(report, "codex-auth").detail, "Logged in using ChatGPT");
  assert.equal(check(report, "claude").version, "2.1.292");
  // The plan, not the account's e-mail address.
  assert.equal(check(report, "claude-auth").detail, "claude.ai · Pro");
  assert.equal(check(report, "provider-ready").detail, "Ready: Codex and Claude Code.");
  // Only the stand-ins are on PATH, so bubblewrap is missing here.
  assert.equal(check(report, "claude-sandbox").status, "warn");
  assert.equal(check(report, "claude-sandbox").reason, "missing");
  assert.ok(check(report, "claude-sandbox").fixes?.some((fix) => fix.command.includes("bubblewrap")));
  assert.equal(check(report, "data-dir").detail, "Will be created at the first start.");
  assert.equal(check(report, "data-dir").params?.path, dataDir);
  assert.equal(check(report, "app").version, "9.9.9");
  assert.equal(
    check(report, "app").detail,
    "Port 4541, 2 runs at a time, 3 agent processes.",
  );
  assert.deepEqual(check(report, "app").params, {
    port: 4541,
    maxActiveRuns: 2,
    maxAgentProcesses: 3,
  });
  // The token itself is never part of the report.
  assert.doesNotMatch(JSON.stringify(report), /gho_faketoken/);
  assert.ok((await f.calls()).includes("gh auth token"));
  assert.deepEqual(cliStatus(report), {
    codex: true,
    codexAuthenticated: true,
    claude: true,
    claudeAuthenticated: true,
    github: true,
    githubUser: "octocat",
    ready: true,
  });
  assert.equal(defaultProviderFrom(report), undefined);
});

test("signed out: each CLI says so with its sign-in command, and no provider is ready", async (t) => {
  await fakes(t, { git: git(), gh: gh("signed-out"), codex: codex(false), claude: claude(false) });
  const report = await withLocale("en", () => runDoctor({ force: true, platform: "linux" }));
  assert.equal(report.ready, false);
  for (const [id, command] of [
    ["gh-auth", "gh auth login"],
    ["codex-auth", "codex login"],
    ["claude-auth", "claude auth login"],
  ] as const) {
    assert.equal(check(report, id).status, "warn", id);
    assert.equal(check(report, id).reason, "signed-out", id);
    assert.deepEqual(check(report, id).fixes?.map((fix) => fix.command), [command]);
  }
  assert.equal(check(report, "gh-scopes").status, "skip");
  // Installed, so only the sign-in commands are offered.
  assert.deepEqual(check(report, "provider-ready").fixes?.map((fix) => fix.command), [
    "codex login",
    "claude auth login",
  ]);
  assert.deepEqual(cliStatus(report), {
    codex: true,
    codexAuthenticated: false,
    claude: true,
    claudeAuthenticated: false,
    github: false,
    ready: false,
  });
});

test("GitHub offline or rejecting the sign-in is told apart", async (t) => {
  await fakes(t, { git: git(), gh: gh("offline"), codex: codex() });
  const offline = await withLocale("en", () => runDoctor({ force: true }));
  assert.equal(check(offline, "gh-auth").status, "warn");
  assert.equal(check(offline, "gh-auth").reason, "offline");
  assert.equal(check(offline, "gh-auth").fixes, undefined);
  assert.equal(check(offline, "gh-scopes").status, "skip");
  // Offline GitHub does not stop the rest of BELL PR.
  assert.equal(offline.ready, true);
});

test("a rejected GitHub token asks to sign in again", async (t) => {
  await fakes(t, { git: git(), gh: gh("rejected"), codex: codex() });
  const report = await withLocale("en", () => runDoctor({ force: true }));
  assert.equal(check(report, "gh-auth").reason, "rejected");
  assert.deepEqual(check(report, "gh-auth").fixes?.map((fix) => fix.command), ["gh auth login"]);
});

test("a missing Git identity fails with fixes that offer the GitHub no-reply address", async (t) => {
  await fakes(t, { git: git("2.45.1", "missing"), gh: gh(), codex: codex() });
  const report = await withLocale("en", () => runDoctor({ force: true }));
  const identity = check(report, "git-identity");
  assert.equal(identity.status, "fail");
  assert.equal(identity.reason, "missing");
  assert.deepEqual(identity.fixes, [
    { label: "Set your name", command: 'git config --global user.name "Your Name"' },
    {
      label: "Use your private GitHub no-reply address",
      command: 'git config --global user.email "583231+octocat@users.noreply.github.com"',
    },
  ]);
  // The address is a param too, so clients can mask it while presenting.
  assert.deepEqual(identity.params, { noreply: "583231+octocat@users.noreply.github.com" });
  // Runs still work without it; approving and publishing check it again.
  assert.equal(report.ready, true);
});

test("an e-mail address Git only guessed is a warning with the no-reply fix", async (t) => {
  await fakes(t, { git: git("2.45.1", "autodetected"), gh: gh(), codex: codex() });
  const previous = ["GIT_AUTHOR_EMAIL", "GIT_COMMITTER_EMAIL", "EMAIL"].map(
    (name) => [name, process.env[name]] as const,
  );
  for (const [name] of previous) delete process.env[name];
  t.after(() => {
    for (const [name, value] of previous) if (value !== undefined) process.env[name] = value;
  });
  const report = await withLocale("en", () => runDoctor({ force: true }));
  const identity = check(report, "git-identity");
  assert.equal(identity.status, "warn");
  assert.equal(identity.reason, "autodetected");
  assert.match(identity.detail!, /me@host\.example/);
  assert.deepEqual(identity.fixes?.map((fix) => fix.command), [
    'git config --global user.email "583231+octocat@users.noreply.github.com"',
  ]);
  assert.deepEqual(identity.params, {
    email: "me@host.example",
    noreply: "583231+octocat@users.noreply.github.com",
  });
});

test("token scopes: workflow missing warns, repo missing fails, fine-grained is unknown", async (t) => {
  const f = await fakes(t, { git: git(), codex: codex(), gh: gh("ok", "repo, read:org") });
  const noWorkflow = await withLocale("en", () => runDoctor({ force: true }));
  const scopes = check(noWorkflow, "gh-scopes");
  assert.equal(scopes.status, "warn");
  assert.equal(scopes.reason, "missing-workflow");
  assert.deepEqual(scopes.fixes, [
    { label: "Allow pushing workflow changes", command: "gh auth refresh -h github.com -s workflow" },
  ]);
  await writeFile(path.join(f.directory, "bin", "gh"), `#!/bin/sh\n${gh("ok", "read:org")}\n`);
  const noRepo = await withLocale("en", () => runDoctor({ force: true }));
  assert.equal(check(noRepo, "gh-scopes").status, "fail");
  assert.equal(check(noRepo, "gh-scopes").reason, "missing-repo");
  assert.equal(check(noRepo, "gh-scopes").required, false);
  assert.equal(noRepo.ready, true);
  await writeFile(path.join(f.directory, "bin", "gh"), `#!/bin/sh\n${gh("ok", null)}\n`);
  const fineGrained = await withLocale("en", () => runDoctor({ force: true }));
  assert.equal(check(fineGrained, "gh-scopes").status, "skip");
  assert.equal(check(fineGrained, "gh-scopes").reason, "unknown");
  assert.equal(check(fineGrained, "gh-auth").detail, "octocat");
});

test("Git older than 2.40 works with a warning that syncing needs a newer one", async (t) => {
  await fakes(t, { git: git("2.39.5"), codex: codex() });
  const report = await withLocale("en", () => runDoctor({ force: true }));
  assert.equal(check(report, "git").status, "warn");
  assert.equal(check(report, "git").reason, "too-old");
  assert.match(check(report, "git").detail!, /2\.40/);
  assert.equal(report.ready, true);
});

test("a CLI that fails tells its error, offers a reinstall and is told apart from one that times out", async (t) => {
  const failing = `[ "$1" = --version ] && { echo 'error while loading shared libraries: libfoo.so' >&2; exit 1; }; exit 1`;
  await fakes(t, { git: git(), gh: failing, codex: failing, claude: failing });
  const report = await withLocale("en", () => runDoctor({ force: true, platform: "linux" }));
  for (const [id, install] of [
    ["gh", "sudo apt install gh"],
    ["codex", "npm install -g @openai/codex"],
    ["claude", "npm install -g @anthropic-ai/claude-code"],
  ] as const) {
    const row = check(report, id);
    assert.deepEqual({ status: row.status, reason: row.reason }, { status: "warn", reason: "broken" }, id);
    assert.equal(
      row.detail,
      `Installed, but \`${id} --version\` failed: error while loading shared libraries: libfoo.so`,
    );
    assert.deepEqual(row.fixes?.map((fix) => fix.command), [install]);
  }
  // Signing in cannot help a CLI that fails, so only reinstalling is offered.
  assert.deepEqual(check(report, "provider-ready").fixes?.map((fix) => fix.command), [
    "npm install -g @openai/codex",
    "npm install -g @anthropic-ai/claude-code",
  ]);
  const zh = await withLocale("zh-TW", () => runDoctor({ platform: "linux" }));
  assert.match(check(zh, "gh").detail!, /^已安裝，但執行 `gh --version` 失敗：/);

  // Only a probe that ran out of time says so.
  const slow = await withLocale("en", () =>
    runDoctor({
      force: true,
      platform: "linux",
      exec: async (executable, args, options) => {
        if (executable === "git" && args.includes("--version"))
          throw new AppError("git timed out", 504);
        return command(executable, args, options);
      },
    }),
  );
  assert.deepEqual(
    { status: check(slow, "git").status, reason: check(slow, "git").reason, fixes: check(slow, "git").fixes },
    { status: "fail", reason: "not-responding", fixes: undefined },
  );
  assert.equal(check(slow, "git").detail, "Installed, but it did not answer within 5 seconds.");
});

test("Claude-only setups are ready and suggest Claude Code as the default provider", async (t) => {
  const f = await fakes(t, { git: git(), claude: claude() });
  const report = await withLocale("en", () => runDoctor({ force: true }));
  assert.equal(report.ready, true);
  assert.equal(check(report, "codex").status, "skip");
  assert.equal(check(report, "codex").reason, "missing");
  assert.equal(defaultProviderFrom(report), "claude");
  // The provider the model settings chose must be ready.
  const dataDir = path.join(f.directory, "data");
  await mkdir(dataDir);
  await writeFile(path.join(dataDir, "model-settings.json"), JSON.stringify({ provider: "codex" }));
  const chosen = await withLocale("en", () => runDoctor({ force: true, dataDir }));
  assert.equal(chosen.ready, false);
  const provider = check(chosen, "provider-ready");
  assert.equal(provider.reason, "chosen-not-ready");
  assert.equal(provider.detail, "Codex is chosen in the model settings but is not ready.");
  assert.deepEqual(provider.fixes?.map((fix) => fix.command), [
    "npm install -g @openai/codex",
    "codex login",
  ]);
  assert.equal(check(chosen, "data-dir").status, "ok");
  assert.match(check(chosen, "data-dir").detail!, /^Writable, .+ free\.$/);
});

test("probes are cached for 10 seconds and shared; force probes again; the wording follows the locale", async (t) => {
  const f = await fakes(t, { git: git(), codex: codex() });
  const dataDir = path.join(f.directory, "data");
  assert.equal(await knownDoctorReport(dataDir), undefined);
  const [first, second] = await Promise.all([
    withLocale("en", () => runDoctor({ dataDir, force: true })),
    withLocale("en", () => runDoctor({ dataDir })),
  ]);
  const probes = (await f.calls()).length;
  assert.ok(probes > 0);
  assert.deepEqual(statuses(first), statuses(second));
  await delay(20);
  const chinese = await withLocale("zh-TW", () => runDoctor({ dataDir }));
  assert.equal((await f.calls()).length, probes, "cached");
  assert.deepEqual(statuses(chinese), statuses(first));
  // A report from cached results says when they were found.
  assert.equal(second.checkedAt, first.checkedAt);
  assert.equal(chinese.checkedAt, first.checkedAt);
  assert.notEqual(check(chinese, "gh").detail, check(first, "gh").detail);
  assert.ok(await knownDoctorReport(dataDir));
  await runDoctor({ dataDir, force: true });
  assert.equal((await f.calls()).length, probes * 2, "force probes again");
  // The last results as they are, without a probe.
  assert.deepEqual(statuses((await knownDoctorReport(dataDir, { stale: true }))!), statuses(first));
  assert.equal((await f.calls()).length, probes * 2);
});

test("Re-check (a forced doctor run) sees sandbox tools installed while the server runs", { skip: process.platform !== "linux" }, async (t) => {
  const f = await fakes(t, { git: git(), claude: claude(), socat: "exit 0" });
  const report = () => withLocale("en", () => runDoctor({ platform: "linux" }));
  const recheck = () => withLocale("en", () => runDoctor({ force: true, platform: "linux" }));
  assert.equal(check(await recheck(), "claude-sandbox").reason, "missing");
  // bubblewrap gets installed; the same PATH answered "missing" before.
  await writeFile(path.join(f.directory, "bin", "bwrap"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  assert.equal(check(await report(), "claude-sandbox").reason, "missing");
  assert.equal(check(await recheck(), "claude-sandbox").status, "ok");
});

test("a data directory that cannot be written fails the required check", { skip: process.getuid?.() === 0 }, async (t) => {
  const f = await fakes(t, { git: git(), codex: codex() });
  const locked = path.join(f.directory, "locked");
  await mkdir(locked);
  await chmod(locked, 0o500);
  const report = await withLocale("en", () =>
    runDoctor({ force: true, dataDir: path.join(locked, "data") }),
  ).finally(() => chmod(locked, 0o700));
  assert.equal(check(report, "data-dir").status, "fail");
  assert.equal(check(report, "data-dir").reason, "read-only");
  assert.equal(report.ready, false);
});

test("bell-pr doctor prints the checklist with fix commands and exits by readiness", async (t) => {
  const f = await fakes(t, { git: git(), gh: gh("signed-out") });
  let text = "";
  const code = await withLocale("en", () =>
    runDoctorCli([], { dataDir: path.join(f.directory, "data"), stdout: { write: (chunk: string) => (text += chunk) } }),
  );
  assert.equal(code, 1);
  assert.match(text, /^BELL PR environment check\n/);
  assert.match(text, /✗ AI provider +Install and sign in to the Codex CLI or Claude Code/);
  assert.match(text, /\n {8}npm install -g @openai\/codex\n/);
  assert.match(text, /\n {8}gh auth login\n/);
  assert.match(text, /Not ready: fix the required check marked ✗ \(AI provider\), then run the check again\./);
  let json = "";
  assert.equal(
    await runDoctorCli(["--json"], { stdout: { write: (chunk: string) => (json += chunk) } }),
    1,
  );
  const report = JSON.parse(json) as DoctorReport;
  assert.equal(report.ready, false);
  assert.ok(report.checks.some((value) => value.id === "provider-ready"));
  let usage = "";
  assert.equal(
    await withLocale("en", () =>
      runDoctorCli(["status"], { stdout: { write: (chunk: string) => (usage += chunk) } }),
    ),
    2,
  );
  assert.match(usage, /Unknown argument "status"\.\nUsage: bell-pr doctor/);
  // A ready environment exits 0, also in zh-TW.
  await writeFile(path.join(f.directory, "bin", "codex"), `#!/bin/sh\n${codex()}\n`, { mode: 0o700 });
  let zh = "";
  assert.equal(
    await withLocale("zh-TW", () =>
      runDoctorCli([], { stdout: { write: (chunk: string) => (zh += chunk) } }),
    ),
    0,
  );
  assert.match(zh, /已就緒：所有必要的檢查都通過了。/);
});

test("bell-pr doctor follows the saved language and sandbox opt-in, then leaves the defaults as they were", async (t) => {
  const f = await fakes(t, { git: git(), claude: claude() });
  const dataDir = path.join(f.directory, "data");
  await mkdir(dataDir);
  await writeFile(
    path.join(dataDir, "app-settings.json"),
    JSON.stringify({ locale: "en", allowUnsandboxedAgents: true }),
  );
  const previous = process.env.BELLPR_LOCALE;
  process.env.BELLPR_LOCALE = "zh-TW";
  t.after(() => {
    if (previous === undefined) delete process.env.BELLPR_LOCALE;
    else process.env.BELLPR_LOCALE = previous;
  });
  // No locale in effect, as on the command line: the saved one wins over
  // BELLPR_LOCALE.
  let text = "";
  const code = await runDoctorCli([], {
    dataDir,
    stdout: { write: (chunk: string) => (text += chunk) },
  });
  assert.equal(code, 0);
  assert.match(text, /^BELL PR environment check\n/);
  // Only the stand-ins are on PATH, so the sandbox is missing, but allowed.
  assert.match(text, /! Claude Code sandbox +Not available\. Claude Code agents may edit files without it because you allowed that/);
  // Afterwards the defaults are the environment's again.
  assert.equal(currentLocale(), "zh-TW");
  assert.equal(allowUnsandboxedAgents(), false);
});

test("bell-pr doctor reports the runs that may execute at once", async (t) => {
  const f = await fakes(t, { git: git(), codex: codex() });
  const dataDir = path.join(f.directory, "data");
  await mkdir(dataDir);
  await writeFile(path.join(dataDir, "app-settings.json"), JSON.stringify({ maxActiveRuns: 3 }));
  let json = "";
  await withLocale("en", () =>
    runDoctorCli(["--json"], { dataDir, stdout: { write: (chunk: string) => (json += chunk) } }),
  );
  const app = check(JSON.parse(json) as DoctorReport, "app");
  assert.equal(app.params?.maxActiveRuns, 3);
  assert.match(app.detail!, /, 3 runs at a time,/);
});

test("the GitHub user answer and the Claude auth JSON are read defensively", () => {
  assert.deepEqual(
    parseGithubUser("HTTP/2.0 200 OK\r\nX-Oauth-Scopes: repo,  gist\r\n\r\nocto-cat\n42\n"),
    { login: "octo-cat", id: "42", scopes: ["repo", "gist"] },
  );
  // Without headers (an older gh or a stand-in) only the login is read.
  assert.deepEqual(parseGithubUser("test-owner\n"), { login: "test-owner", scopes: null });
  assert.deepEqual(parseGithubUser("HTTP/2.0 200 OK\n\n<html>\n"), { scopes: null });
  assert.equal(claudeAuthDetail({ loggedIn: true, authMethod: "claude.ai", subscriptionType: "max" }), "claude.ai · Max");
  assert.equal(claudeAuthDetail({ loggedIn: true, authMethod: "api_key" }), "api_key");
  assert.equal(claudeAuthDetail("text"), undefined);
  const report: DoctorReport = {
    checks: [
      { id: "node", status: "fail", required: true, version: "v20.0.0", detail: "Too old.", fixes: [{ label: "L", command: "c" }] },
      { id: "codex", status: "skip", required: false, detail: "Not installed.", fixes: [{ label: "Install", command: "npm i" }] },
    ],
    ready: false,
    checkedAt: "2026-10-14T00:00:00.000Z",
    platform: "linux",
  };
  assert.equal(
    withLocale("en", () => formatDoctorReport(report)),
    "BELL PR environment check\n\n  ✗ Node.js    v20.0.0  Too old.\n      L:\n        c\n  - Codex CLI  Not installed.\n\nNot ready: fix the required check marked ✗ (Node.js), then run the check again.\n",
  );
  // Chinese labels take two columns per character, and the punctuation
  // comes from the dictionary.
  const zh = withLocale("zh-TW", () =>
    formatDoctorReport({
      ...report,
      checks: [report.checks[0], { id: "git-identity", status: "skip", required: false, detail: "D" }],
    }),
  );
  assert.ok(
    zh.includes("\n  ✗ Node.js   v20.0.0  Too old.\n      L：\n        c\n  - Git 身分  D\n"),
    zh,
  );
  // Ready to start, but a ✗ that is not required is named: publishing needs it.
  const identity: DoctorReport = {
    ...report,
    ready: true,
    checks: [
      { id: "node", status: "ok", required: true },
      { id: "git-identity", status: "fail", required: false, detail: "Not set." },
    ],
  };
  assert.match(
    withLocale("en", () => formatDoctorReport(identity)),
    /\nReady: every required check passed\. Some steps need the check marked ✗ fixed first \(Git identity\)\.\n$/,
  );
  assert.match(
    withLocale("zh-TW", () => formatDoctorReport(identity)),
    /\n已就緒：所有必要的檢查都通過了。有些步驟要先修正標示 ✗ 的檢查（Git 身分）才能進行。\n$/,
  );
});
