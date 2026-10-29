/**
 * Environment checks behind `bell-pr doctor`, GET /api/doctor, GET
 * /api/status and the setup checklist: Node.js, Git and the identity
 * commits need, the GitHub CLI with its sign-in and permissions, the Codex
 * and Claude Code CLIs with their sign-ins, Claude Code's sandbox, the data
 * directory, the app and the platform.
 *
 * The probes run in parallel, each with a 5-second limit. What they find is
 * kept for 10 seconds per data directory and PATH, and callers in that
 * window share one probe; `force` probes again. The report itself (its
 * details and fix labels) is worded in the locale in effect for each call.
 */
import { constants } from "node:fs";
import { access, readFile, statfs } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { doctorCheckIds, type DoctorCheck, type DoctorReport } from "../shared/doctor.js";
import type { Fix } from "../shared/errors.js";
import { codexEnabled } from "../shared/codex-switch.js";
import {
  agentProviders,
  providerLabels,
  type AgentProvider,
} from "../shared/models.js";
import { product } from "../shared/product.js";
import { agentLoginCheck } from "./agent-cli.js";
import { defaultActiveRunLimit, defaultAgentProcessLimit } from "./agent-slots.js";
import { AppSettingsService, withAppSettings } from "./app-settings.js";
import { version as appVersion } from "./build-info.js";
import {
  fixesFor,
  identityFixes,
  installFixes,
  noreplyAddress,
  setupError,
  signInFixes,
} from "./cli-errors.js";
import { resolvePort } from "./config.js";
import { sm } from "./i18n/index.js";
import { agentEnvironment, command, git, gitInvocationPrefix, redact } from "./process.js";
import {
  allowUnsandboxedAgents,
  detectClaudeSandbox,
  forgetClaudeSandboxDetection,
  type SandboxDetection,
} from "./sandbox.js";
import { AppError } from "./types.js";

/** Runs one command; `command` from process.ts unless a test replaces it. */
export type DoctorExec = typeof command;

/** Each probe gives up after this long. */
const probeTimeoutMs = 5000;
/** How long probe results are reused. */
const cacheMs = 10_000;
/** Below this much free space the data directory check warns. */
const lowSpaceBytes = 1024 ** 3;
/** Syncing a run onto the latest target branch needs `git merge-tree --write-tree --merge-base`. */
const syncGitVersion = [2, 40] as const;

/** broken: `--version` failed. timeout: it did not answer in time. */
type ToolState = "ok" | "missing" | "broken" | "timeout";

interface ToolFacts {
  state: ToolState;
  version?: string;
  /** The first line the failed `--version` printed (redacted). */
  error?: string;
}

/** What `git var` reports about the identity commits get. */
export interface GitIdentityFacts {
  /**
   * ok: set. autodetected: Git guessed the e-mail address from the user
   * and host names because none is configured. missing: Git refuses to
   * commit. unknown: Git failed for another reason.
   */
  state: "ok" | "autodetected" | "missing" | "unknown";
  /** "Name <email>" */
  ident?: string;
  email?: string;
}

interface GithubFacts {
  /** signed-out: no token. rejected: GitHub refused it. offline: GitHub did not answer. */
  state: "ok" | "signed-out" | "rejected" | "offline";
  login?: string;
  id?: string;
  /** The classic token's scopes; null when the token does not report them. */
  scopes?: string[] | null;
}

interface AgentAuthFacts {
  signedIn: boolean;
  detail?: string;
}

/** Everything the probes found; the report is built from it per locale. */
interface Facts {
  /** When the probes answered (ISO time). */
  checkedAt: string;
  git: ToolFacts;
  identity?: GitIdentityFacts;
  gh: ToolFacts;
  github?: GithubFacts;
  codex: ToolFacts;
  codexAuth?: AgentAuthFacts;
  claude: ToolFacts;
  claudeAuth?: AgentAuthFacts;
  sandbox?: SandboxDetection;
  dataDir?: {
    path: string;
    exists: boolean;
    writable: boolean;
    freeBytes?: number;
  };
}

/** What the app check reports; the CLI fills in what it knows. */
export interface DoctorAppInfo {
  version?: string;
  port?: number;
  /** Runs that may execute at once. */
  maxActiveRuns?: number;
  maxAgentProcesses?: number;
}

export interface DoctorOptions {
  /** Probe again instead of reusing results up to 10 seconds old. */
  force?: boolean;
  /** Runs the probes' commands; tests may replace it. */
  exec?: DoctorExec;
  /** The data directory to check; its model settings name the chosen provider. */
  dataDir?: string;
  /** The provider the model settings chose; read from `dataDir` when absent. */
  provider?: AgentProvider;
  app?: DoctorAppInfo;
  /** The platform the fixes are for; this one by default. */
  platform?: NodeJS.Platform;
}

const execOptions = { timeoutMs: probeTimeoutMs, maxBytes: 64_000 };

function missing(error: unknown) {
  if (error instanceof AppError && error.code?.endsWith("_missing")) return true;
  const cause = (error as { cause?: NodeJS.ErrnoException } | undefined)?.cause;
  return cause?.code === "ENOENT";
}

function firstLine(text: string) {
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

/** The first version number in a `--version` answer, such as 2.53.0. */
export function parseToolVersion(output: string): string | undefined {
  return /\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?/.exec(firstLine(output))?.[0];
}

async function probeTool(
  exec: DoctorExec,
  executable: string,
  env?: NodeJS.ProcessEnv,
): Promise<ToolFacts> {
  try {
    const { stdout, stderr } = await exec(executable, ["--version"], {
      ...execOptions,
      ...(env ? { env } : {}),
    });
    const version = parseToolVersion(stdout) ?? parseToolVersion(stderr);
    return { state: "ok", ...(version ? { version } : {}) };
  } catch (error) {
    if (missing(error)) return { state: "missing" };
    // command() rejects with 504 when the probe ran out of time.
    if (error instanceof AppError && error.statusCode === 504)
      return { state: "timeout" };
    // command() keeps the redacted stderr tail of a non-zero exit.
    const output =
      error instanceof AppError && typeof error.details?.stderr === "string"
        ? firstLine(error.details.stderr).slice(0, 200)
        : "";
    return { state: "broken", ...(output ? { error: output } : {}) };
  }
}

/** Git's own words when it has no identity, read with LC_ALL=C. */
const identityRefusal =
  /identity unknown|Please tell me who you are|unable to auto-detect email|empty ident name/i;

/**
 * Asks Git for the author and committer identity a commit made by `run`
 * would get, the way Git checks it when committing (strictly), and whether
 * the e-mail address is configured or only guessed.
 */
export async function probeGitIdentity(
  run: (
    args: string[],
    options: Parameters<DoctorExec>[2],
  ) => ReturnType<DoctorExec>,
): Promise<GitIdentityFacts> {
  // Git's messages in English, so a refusal is recognized in any locale.
  const options = {
    ...execOptions,
    env: { ...process.env, LC_ALL: "C", LANGUAGE: "", GIT_TERMINAL_PROMPT: "0" },
  };
  const [author, committer, configured] = await Promise.allSettled([
    run(["var", "GIT_AUTHOR_IDENT"], options),
    run(["var", "GIT_COMMITTER_IDENT"], options),
    run(["config", "--get", "user.email"], { ...options, allowedCodes: [0, 1] }),
  ]);
  for (const result of [author, committer])
    if (result.status === "rejected") {
      const stderr =
        result.reason instanceof AppError &&
        typeof result.reason.details?.stderr === "string"
          ? result.reason.details.stderr
          : "";
      return {
        state:
          identityRefusal.test(stderr) ||
          (result.reason instanceof AppError &&
            result.reason.code === "git_identity_missing")
            ? "missing"
            : "unknown",
      };
    }
  const ident = /^(.*<[^<>]*>)/.exec(
    (author as PromiseFulfilledResult<{ stdout: string }>).value.stdout.trim(),
  )?.[1];
  const email = ident && /<([^<>]*)>/.exec(ident)?.[1];
  const fromConfig =
    configured.status === "fulfilled" && configured.value.stdout.trim() !== "";
  const fromEnvironment = ["GIT_AUTHOR_EMAIL", "GIT_COMMITTER_EMAIL", "EMAIL"].some(
    (name) => process.env[name]?.trim(),
  );
  return {
    state: fromConfig || fromEnvironment ? "ok" : "autodetected",
    ...(ident ? { ident } : {}),
    ...(email ? { email } : {}),
  };
}

/**
 * Throws 409 `git_identity_missing` when Git would refuse to commit in
 * `cwd` (so repository-local settings count). Any other failure is left to
 * the commit itself to report.
 */
export async function assertGitIdentity(cwd: string): Promise<void> {
  const identity = await probeGitIdentity((args, options) =>
    git(cwd, args, options),
  );
  if (identity.state === "missing")
    throw setupError("git_identity_missing", 409);
}

/** Reads `gh api --include user --jq '.login,.id'`: headers, then two lines. */
export function parseGithubUser(output: string): Omit<GithubFacts, "state"> {
  const text = output.replace(/\r\n/g, "\n");
  let body = text;
  let scopes: string[] | null = null;
  if (/^HTTP\/[\d.]+ \d{3}/.test(text)) {
    const end = text.indexOf("\n\n");
    const head = end < 0 ? text : text.slice(0, end);
    body = end < 0 ? "" : text.slice(end + 2);
    const header = head
      .split("\n")
      .slice(1)
      .map((line) => /^([^:]+):\s*(.*)$/.exec(line))
      .find((match) => match?.[1].trim().toLowerCase() === "x-oauth-scopes");
    if (header)
      scopes = header[2]
        .split(",")
        .map((scope) => scope.trim())
        .filter(Boolean);
  }
  const [login, id] = body.trim().split(/\s+/);
  return {
    ...(login && /^[A-Za-z0-9-]{1,39}$/.test(login) ? { login } : {}),
    ...(id && /^\d+$/.test(id) ? { id } : {}),
    scopes,
  };
}

/**
 * The GitHub sign-in: `gh auth token` says whether there is one without the
 * network (the token itself is never kept), then `gh api --include user`
 * names the account and, for classic tokens, its scopes.
 */
async function probeGithub(exec: DoctorExec): Promise<GithubFacts> {
  try {
    await exec("gh", ["auth", "token"], execOptions);
  } catch {
    return { state: "signed-out" };
  }
  try {
    const { stdout } = await exec(
      "gh",
      ["api", "--include", "user", "--jq", ".login,.id"],
      execOptions,
    );
    return { state: "ok", ...parseGithubUser(stdout) };
  } catch (error) {
    const stderr =
      error instanceof AppError && typeof error.details?.stderr === "string"
        ? error.details.stderr
        : "";
    return {
      state:
        /HTTP 401|Bad credentials/i.test(stderr) ||
        (error instanceof AppError && error.code === "gh_unauthenticated")
          ? "rejected"
          : "offline",
    };
  }
}

/**
 * The scopes of the GitHub CLI's token, read now; undefined when there is
 * no answer or the token does not report them (fine-grained tokens), in
 * which case nothing should be refused because of them.
 */
export async function githubTokenScopes(
  exec: DoctorExec = command,
): Promise<string[] | undefined> {
  const github = await probeGithub(exec);
  return github.state === "ok" && github.scopes ? github.scopes : undefined;
}

async function probeCodexAuth(exec: DoctorExec): Promise<AgentAuthFacts> {
  const login = agentLoginCheck("codex");
  try {
    const { stdout, stderr } = await exec(login.executable, login.args, {
      ...execOptions,
      env: agentEnvironment("codex"),
    });
    const detail = redact(firstLine(stdout) || firstLine(stderr)).slice(0, 200);
    return { signedIn: true, ...(detail ? { detail } : {}) };
  } catch {
    return { signedIn: false };
  }
}

/** "claude.ai · Pro" from `claude auth status` JSON. */
export function claudeAuthDetail(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { authMethod, subscriptionType } = value as Record<string, unknown>;
  const parts = [
    typeof authMethod === "string" ? authMethod.trim().slice(0, 60) : "",
    typeof subscriptionType === "string" && subscriptionType.trim()
      ? subscriptionType.trim().charAt(0).toUpperCase() +
        subscriptionType.trim().slice(1, 40)
      : "",
  ].filter(Boolean);
  return parts.length ? redact(parts.join(" · ")) : undefined;
}

async function probeClaudeAuth(exec: DoctorExec): Promise<AgentAuthFacts> {
  const login = agentLoginCheck("claude");
  try {
    const { stdout, code } = await exec(login.executable, login.args, {
      ...execOptions,
      env: agentEnvironment("claude"),
      allowedCodes: [0, 1],
    });
    let status: unknown;
    try {
      status = JSON.parse(stdout.trim());
    } catch {
      // An older Claude Code prints text: its exit code says enough.
    }
    const loggedIn =
      typeof status === "object" &&
      status !== null &&
      typeof (status as { loggedIn?: unknown }).loggedIn === "boolean"
        ? (status as { loggedIn: boolean }).loggedIn
        : code === 0;
    const detail = loggedIn ? claudeAuthDetail(status) : undefined;
    return { signedIn: loggedIn, ...(detail ? { detail } : {}) };
  } catch {
    return { signedIn: false };
  }
}

async function probeDataDir(directory: string): Promise<Facts["dataDir"]> {
  const resolved = path.resolve(directory);
  // A data directory that does not exist yet is created in its parent.
  let target = resolved;
  let exists = true;
  for (;;) {
    try {
      await access(target);
      break;
    } catch {
      exists = false;
      const parent = path.dirname(target);
      if (parent === target) break;
      target = parent;
    }
  }
  const writable = await access(target, constants.W_OK).then(
    () => true,
    () => false,
  );
  const freeBytes = await statfs(target).then(
    (stats) => Number(stats.bavail) * Number(stats.bsize),
    () => undefined,
  );
  return {
    path: resolved,
    exists,
    writable,
    ...(freeBytes !== undefined && Number.isFinite(freeBytes) ? { freeBytes } : {}),
  };
}

/** Whether a Codex binary is on PATH. Does not run it. */
async function codexOnPath(): Promise<ToolFacts> {
  const name = process.platform === "win32" ? "codex.exe" : "codex";
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    try {
      await access(path.join(dir, name), constants.X_OK);
      return { state: "ok" };
    } catch {
      // The next directory.
    }
  }
  return { state: "missing" };
}

async function probe(exec: DoctorExec, dataDir?: string): Promise<Facts> {
  const run = async (
    executable: string,
    args: string[],
    options?: Parameters<DoctorExec>[2],
  ) =>
    exec(
      executable,
      executable === "git"
        ? [
            ...(await gitInvocationPrefix(options?.cwd ?? os.tmpdir(), args)),
            ...args,
          ]
        : args,
      options,
    );
  const [git, gh, codex, claude, dataDirFacts] = await Promise.all([
    probeTool(run, "git"),
    probeTool(exec, "gh"),
    // The switch off must not start Codex. Presence is a PATH check only.
    codexEnabled
      ? probeTool(exec, "codex", agentEnvironment("codex"))
      : codexOnPath(),
    probeTool(exec, "claude", agentEnvironment("claude")),
    dataDir ? probeDataDir(dataDir).catch(() => undefined) : undefined,
  ]);
  const [identity, github, codexAuth, claudeAuth, sandbox] = await Promise.all([
    git.state === "ok"
      ? probeGitIdentity((args, options) =>
          run("git", args, { ...options, cwd: os.tmpdir() }),
        )
      : undefined,
    gh.state === "ok" ? probeGithub(exec) : undefined,
    codexEnabled && codex.state === "ok" ? probeCodexAuth(exec) : undefined,
    claude.state === "ok" ? probeClaudeAuth(exec) : undefined,
    claude.state === "ok"
      ? detectClaudeSandbox().catch(() => undefined)
      : undefined,
  ]);
  return {
    checkedAt: new Date().toISOString(),
    git,
    gh,
    codex,
    claude,
    ...(identity ? { identity } : {}),
    ...(github ? { github } : {}),
    ...(codexAuth ? { codexAuth } : {}),
    ...(claudeAuth ? { claudeAuth } : {}),
    ...(sandbox ? { sandbox } : {}),
    ...(dataDirFacts ? { dataDir: dataDirFacts } : {}),
  };
}

/** The provider the model settings in `dataDir` chose, if any. */
async function savedProvider(dataDir: string): Promise<AgentProvider | undefined> {
  try {
    const value = JSON.parse(
      await readFile(path.join(dataDir, "model-settings.json"), "utf8"),
    ) as { provider?: unknown };
    return (agentProviders as readonly unknown[]).includes(value?.provider)
      ? (value.provider as AgentProvider)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Whether Git is at least `syncGitVersion`; unknown versions count as new enough. */
function gitSupportsSync(version?: string) {
  const match = version && /^(\d+)\.(\d+)/.exec(version);
  if (!match) return true;
  const [major, minor] = [Number(match[1]), Number(match[2])];
  return (
    major > syncGitVersion[0] ||
    (major === syncGitVersion[0] && minor >= syncGitVersion[1])
  );
}

/** The providers that are installed and signed in, Codex first. */
function readyProviders(facts: Facts): AgentProvider[] {
  return agentProviders.filter((provider) =>
    provider === "codex"
      ? codexEnabled &&
        facts.codex.state === "ok" &&
        facts.codexAuth?.signedIn === true
      : facts.claude.state === "ok" && facts.claudeAuth?.signedIn === true,
  );
}

function providerFixes(provider: AgentProvider, facts: Facts): Fix[] {
  const state = facts[provider].state;
  // Signing in cannot help while the CLI itself fails: install it again.
  if (state === "broken") return installFixes(provider);
  return [
    ...(state === "missing" ? installFixes(provider) : []),
    ...signInFixes(provider),
  ];
}

function sandboxFixes(detection: SandboxDetection): Fix[] {
  const messages = sm().security.sandbox;
  const allow = {
    label: messages.allowFix,
    command: `BELLPR_ALLOW_UNSANDBOXED_AGENTS=1 ${product.binNames[0]}`,
  };
  if (detection.reason === "unusable:bwrap")
    return [
      {
        label: messages.dockerFix,
        command:
          "--security-opt seccomp=unconfined --security-opt apparmor=unconfined --security-opt systempaths=unconfined",
        platform: "linux",
      },
      allow,
    ];
  return [
    {
      label: messages.installFix,
      command: "sudo apt-get install bubblewrap socat",
      platform: "linux",
    },
    { label: messages.codexFix, command: "codex login" },
    allow,
  ];
}

/** Builds the report in the locale in effect. */
function buildReport(
  facts: Facts,
  options: DoctorOptions & { platform: NodeJS.Platform; provider?: AgentProvider },
): DoctorReport {
  const m = sm().setup.doctor;
  const platform = options.platform;
  const fixes = (list: Fix[]) => {
    const kept = fixesFor(list, platform);
    return kept.length ? { fixes: kept } : {};
  };
  const checks: DoctorCheck[] = [];
  const add = (check: DoctorCheck) => checks.push(check);
  /** A tool that is installed but failed its `--version` probe. */
  const notWorking = (tool: "git" | "gh" | AgentProvider, probed: ToolFacts) =>
    probed.state === "timeout"
      ? { reason: "not-responding", detail: m.notResponding }
      : {
          reason: "broken",
          detail: probed.error
            ? m.versionFailedWith({ command: `${tool} --version`, output: probed.error })
            : m.versionFailed({ command: `${tool} --version` }),
          ...fixes(installFixes(tool)),
        };

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  add({
    id: "node",
    required: true,
    version: process.version,
    ...(nodeMajor >= 22
      ? { status: "ok" }
      : {
          status: "fail",
          reason: "too-old",
          detail: m.nodeTooOld({ version: process.version }),
          fixes: [{ label: sm().setup.fixes.installNode, command: "nvm install 22" }],
        }),
  });

  const { git } = facts;
  add({
    id: "git",
    required: true,
    ...(git.version ? { version: git.version } : {}),
    ...(git.state === "missing"
      ? { status: "fail", reason: "missing", detail: m.notInstalled, ...fixes(installFixes("git")) }
      : git.state !== "ok"
        ? { status: "fail", ...notWorking("git", git) }
        : gitSupportsSync(git.version)
          ? { status: "ok" }
          : {
              status: "warn",
              reason: "too-old",
              detail: m.gitTooOld({ version: git.version ?? "" }),
              ...fixes(installFixes("git")),
            }),
  });

  const identity = facts.identity;
  const account = facts.github?.state === "ok" ? facts.github : undefined;
  // The address the fixes offer: clients mask it while presenting.
  const noreply = noreplyAddress(account);
  add({
    id: "git-identity",
    required: false,
    ...(!identity
      ? { status: "skip" }
      : identity.state === "ok"
        ? { status: "ok", ...(identity.ident ? { detail: identity.ident } : {}) }
        : identity.state === "autodetected"
          ? {
              status: "warn",
              reason: "autodetected",
              detail: m.identityAutodetected({ email: identity.email ?? "" }),
              ...(identity.email || noreply
                ? {
                    params: {
                      ...(identity.email ? { email: identity.email } : {}),
                      ...(noreply ? { noreply } : {}),
                    },
                  }
                : {}),
              ...fixes(identityFixes(account, { name: false })),
            }
          : identity.state === "missing"
            ? {
                status: "fail",
                reason: "missing",
                detail: m.identityMissing,
                ...(noreply ? { params: { noreply } } : {}),
                ...fixes(identityFixes(account)),
              }
            : { status: "warn", reason: "unknown", detail: m.identityUnknown }),
  });

  const { gh, github } = facts;
  add({
    id: "gh",
    required: false,
    ...(gh.version ? { version: gh.version } : {}),
    ...(gh.state === "ok"
      ? { status: "ok" }
      : gh.state === "missing"
        ? { status: "warn", reason: "missing", detail: m.notInstalled, ...fixes(installFixes("gh")) }
        : { status: "warn", ...notWorking("gh", gh) }),
  });
  add({
    id: "gh-auth",
    required: false,
    ...(!github
      ? { status: "skip" }
      : github.state === "ok"
        ? {
            status: "ok",
            ...(github.login
              ? { detail: github.login, params: { login: github.login } }
              : {}),
          }
        : github.state === "offline"
          ? { status: "warn", reason: "offline", detail: m.githubOffline }
          : {
              status: "warn",
              reason: github.state,
              detail: github.state === "rejected" ? m.githubRejected : m.signedOut,
              ...fixes(signInFixes("gh")),
            }),
  });
  const scopes = github?.state === "ok" ? github.scopes : undefined;
  add({
    id: "gh-scopes",
    required: false,
    ...(github?.state !== "ok"
      ? { status: "skip" }
      : !scopes
        ? { status: "skip", reason: "unknown", detail: m.scopesUnknown }
        : !scopes.includes("repo") && !scopes.includes("public_repo")
          ? {
              status: "fail",
              reason: "missing-repo",
              detail: m.scopesMissingRepo,
              ...fixes([
                {
                  label: sm().setup.fixes.addRepoScope,
                  command: "gh auth refresh -h github.com -s repo",
                },
              ]),
            }
          : !scopes.includes("workflow")
            ? {
                status: "warn",
                reason: "missing-workflow",
                detail: m.scopesMissingWorkflow,
                ...fixes([
                  {
                    label: sm().setup.fixes.addWorkflowScope,
                    command: "gh auth refresh -h github.com -s workflow",
                  },
                ]),
              }
            : { status: "ok", detail: scopes.join(", ") }),
  });

  for (const provider of agentProviders) {
    if (provider === "codex" && !codexEnabled) {
      // Not a required failure: a start gate that looks at `ready` stays open
      // when Claude Code is ready. The saved provider falls back below.
      add({
        id: "codex",
        required: false,
        status: "skip",
        reason: "disabled",
        detail: m.codexDisabled,
      });
      add({
        id: "codex-auth",
        required: false,
        status: "skip",
        reason: "disabled",
      });
      continue;
    }
    const tool = facts[provider];
    const auth = provider === "codex" ? facts.codexAuth : facts.claudeAuth;
    add({
      id: provider,
      required: false,
      ...(tool.version ? { version: tool.version } : {}),
      ...(tool.state === "ok"
        ? { status: "ok" }
        : tool.state === "missing"
          ? {
              status: "skip",
              reason: "missing",
              detail: m.notInstalled,
              ...fixes(installFixes(provider)),
            }
          : { status: "warn", ...notWorking(provider, tool) }),
    });
    add({
      id: provider === "codex" ? "codex-auth" : "claude-auth",
      required: false,
      ...(!auth
        ? { status: "skip" }
        : auth.signedIn
          ? { status: "ok", ...(auth.detail ? { detail: auth.detail } : {}) }
          : {
              status: "warn",
              reason: "signed-out",
              detail: m.signedOut,
              ...fixes(signInFixes(provider)),
            }),
    });
    if (provider === "claude") {
      const sandbox = facts.sandbox;
      // Read for each report, so a changed opt-in shows before the next probe.
      const allowed = allowUnsandboxedAgents();
      add({
        id: "claude-sandbox",
        required: false,
        ...(!sandbox
          ? { status: "skip" }
          : sandbox.available
            ? { status: "ok", detail: m.sandboxReady }
            : allowed
              ? { status: "warn", reason: "allowed", detail: m.sandboxAllowed }
              : {
                  status: "warn",
                  reason: sandbox.reason?.split(":")[0] ?? "unavailable",
                  detail: sandbox.reason?.startsWith("unusable:")
                    ? m.sandboxBlocked
                    : sandbox.reason?.startsWith("platform:")
                      ? m.sandboxUnsupported
                      : m.sandboxMissing,
                  ...fixes(sandboxFixes(sandbox)),
                }),
      });
    }
  }

  const ready = readyProviders(facts);
  // A saved Codex choice falls back to Claude Code while the switch is off,
  // so this required check does not fail only because Codex was saved.
  const chosen =
    !codexEnabled && options.provider === "codex" ? "claude" : options.provider;
  const claudeOnly =
    !codexEnabled &&
    facts.claude.state === "missing" &&
    facts.codex.state !== "missing";
  add({
    id: "provider-ready",
    required: true,
    ...(!ready.length
      ? claudeOnly
        ? {
            status: "fail" as const,
            reason: "claude-only",
            detail: `${m.claudeOnlyRelease}\n${m.installClaudeCode}`,
          }
        : {
          status: "fail",
          reason: "none-ready",
          detail: m.noProvider,
          ...fixes(
            agentProviders.flatMap((provider) => providerFixes(provider, facts)),
          ),
        }
      : chosen && !ready.includes(chosen)
        ? {
            status: "fail",
            reason: "chosen-not-ready",
            detail: m.savedProviderNotReady({ provider: providerLabels[chosen] }),
            params: { provider: chosen },
            ...fixes(providerFixes(chosen, facts)),
          }
        : {
            status: "ok",
            detail: m.providersReady({
              providers: ready.map((provider) => providerLabels[provider]),
            }),
            params: { providers: ready.join(",") },
          }),
  });

  const dataDir = facts.dataDir;
  const dataDirFix = () =>
    fixes([
      {
        label: sm().setup.fixes.dataDir,
        command: `${product.binNames[0]} --data-dir ${sm().setup.placeholders.directory}`,
      },
    ]);
  add({
    id: "data-dir",
    required: true,
    ...(!dataDir
      ? { status: "skip" }
      : {
          params: {
            path: dataDir.path,
            ...(dataDir.freeBytes !== undefined ? { freeBytes: dataDir.freeBytes } : {}),
          },
          ...(!dataDir.writable
            ? { status: "fail", reason: "read-only", detail: m.dataDirReadOnly, ...dataDirFix() }
            : dataDir.freeBytes !== undefined && dataDir.freeBytes < lowSpaceBytes
              ? {
                  status: "warn",
                  reason: "low-space",
                  detail: m.dataDirLowSpace({ free: dataDir.freeBytes }),
                }
              : {
                  status: "ok",
                  detail: !dataDir.exists
                    ? m.dataDirNew
                    : dataDir.freeBytes !== undefined
                      ? m.dataDirReady({ free: dataDir.freeBytes })
                      : m.dataDirWritable,
                }),
        }),
  });

  const app = options.app ?? {};
  const appDetail = m.app({
    port: app.port,
    runs: app.maxActiveRuns,
    processes: app.maxAgentProcesses,
  });
  add({
    id: "app",
    required: false,
    status: "ok",
    version: app.version ?? appVersion,
    ...(appDetail ? { detail: appDetail } : {}),
    params: Object.fromEntries(
      Object.entries({
        port: app.port,
        maxActiveRuns: app.maxActiveRuns,
        maxAgentProcesses: app.maxAgentProcesses,
      }).filter(([, value]) => value !== undefined),
    ) as Record<string, string | number>,
  });

  add({
    id: "platform",
    required: false,
    ...(platform === "win32"
      ? {
          status: "warn",
          reason: "windows",
          detail: m.windows,
          fixes: [{ label: sm().setup.fixes.useWsl, command: "wsl --install" }],
        }
      : { status: "ok", detail: `${platform} ${os.arch()}` }),
  });

  checks.sort((a, b) => doctorCheckIds.indexOf(a.id) - doctorCheckIds.indexOf(b.id));
  return {
    checks,
    ready: !checks.some((check) => check.required && check.status === "fail"),
    // The probe's time: a report built from results up to 10 seconds old
    // (or older, see knownDoctorReport) says when they were found.
    checkedAt: facts.checkedAt,
    platform,
  };
}

interface CacheEntry {
  time: number;
  facts: Promise<Facts>;
}
/** Probe results per command runner, then per data directory and PATH. */
const caches = new WeakMap<DoctorExec, Map<string, CacheEntry>>();

function cacheFor(exec: DoctorExec) {
  let cache = caches.get(exec);
  if (!cache) caches.set(exec, (cache = new Map()));
  return cache;
}

const cacheKey = (dataDir?: string) =>
  `${dataDir ? path.resolve(dataDir) : ""}\0${process.env.PATH ?? ""}`;

/**
 * Checks the environment. Probe results are kept for 10 seconds per data
 * directory and PATH, and callers in that window share one probe; `force`
 * probes again. The report is worded in the locale in effect.
 */
export async function runDoctor(opts: DoctorOptions = {}): Promise<DoctorReport> {
  const exec = opts.exec ?? command;
  const cache = cacheFor(exec);
  const key = cacheKey(opts.dataDir);
  let entry = cache.get(key);
  if (opts.force || !entry || Date.now() - entry.time >= cacheMs) {
    // A forced check also looks for the sandbox tools again (sandbox.ts
    // keeps that answer for the process otherwise).
    if (opts.force) forgetClaudeSandboxDetection();
    entry = { time: Date.now(), facts: probe(exec, opts.dataDir) };
    cache.set(key, entry);
  }
  return reportFrom(await entry.facts, opts);
}

async function reportFrom(facts: Facts, opts: DoctorOptions) {
  const provider =
    opts.provider ?? (opts.dataDir ? await savedProvider(opts.dataDir) : undefined);
  return buildReport(facts, {
    ...opts,
    platform: opts.platform ?? process.platform,
    ...(provider ? { provider } : {}),
  });
}

/**
 * The doctor's report for `dataDir`, but only when the doctor already ran
 * for it in this process (the UI asks for the status as it loads).
 * Undefined otherwise, so services can refuse work early without starting
 * CLI probes of their own. Results older than 10 seconds are probed again,
 * unless `stale` accepts the last ones as they are.
 */
export async function knownDoctorReport(
  dataDir?: string,
  options: { stale?: boolean } = {},
): Promise<DoctorReport | undefined> {
  const entry = cacheFor(command).get(cacheKey(dataDir));
  if (!entry) return undefined;
  return options.stale ? reportFrom(await entry.facts, { dataDir }) : runDoctor({ dataDir });
}

/** The default provider the report suggests: Claude Code when it is the only one ready. */
export function defaultProviderFrom(
  report: DoctorReport | undefined,
): AgentProvider | undefined {
  const providers = report?.checks.find((check) => check.id === "provider-ready")
    ?.params?.providers;
  return providers === "claude" ? "claude" : undefined;
}

/** The legacy shape of GET /api/status and Workbench.status(). */
export interface CliStatus {
  codex: boolean;
  codexAuthenticated: boolean;
  claude: boolean;
  claudeAuthenticated: boolean;
  /** gh is installed and signed in, and GitHub answered. */
  github: boolean;
  githubUser?: string;
  /** No required check failed. */
  ready?: boolean;
}

/** GET /api/status's view of a report, as it was before the doctor. */
export function cliStatus(report: DoctorReport): CliStatus {
  const check = (id: DoctorCheck["id"]) =>
    report.checks.find((value) => value.id === id);
  const ok = (id: DoctorCheck["id"]) => check(id)?.status === "ok";
  const login = check("gh-auth")?.params?.login;
  return {
    codex: ok("codex"),
    codexAuthenticated: ok("codex-auth"),
    claude: ok("claude"),
    claudeAuthenticated: ok("claude-auth"),
    github: ok("gh-auth"),
    ...(typeof login === "string" ? { githubUser: login } : {}),
    ready: report.ready,
  };
}

/** What the command line passes to `bell-pr doctor`. */
export interface DoctorCliDeps {
  /** The resolved data directory, for the data-dir check. */
  dataDir?: string;
  /**
   * The port to report, as `bell-pr doctor` found it: that of the BELL PR
   * running on the data directory, else the one a start would take
   * (undefined: none valid). Left out, the port a start would take from
   * this process's environment (BELLPR_PORT, else 4311).
   */
  port?: number;
  /** Where output goes; process.stdout by default. */
  stdout?: { write(text: string): unknown };
  /** Runs the probes' commands; tests may replace it. */
  exec?: DoctorExec;
}

const symbols: Record<DoctorCheck["status"], string> = {
  ok: "✓",
  warn: "!",
  fail: "✗",
  skip: "-",
};

/** Wide characters (CJK and fullwidth forms) take two terminal columns. */
const wideCharacter =
  /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/u;

/** How many terminal columns `text` takes. */
function columns(text: string) {
  let count = 0;
  for (const character of text) count += wideCharacter.test(character) ? 2 : 1;
  return count;
}

/** The checklist `bell-pr doctor` prints. */
export function formatDoctorReport(report: DoctorReport, dataDir?: string): string {
  const m = sm().setup;
  const labels = m.doctor.labels;
  const width = Math.max(...report.checks.map((check) => columns(labels[check.id])));
  const lines = [m.cli.title, ""];
  for (const check of report.checks) {
    const [first, ...rest] = (check.detail ?? "").split("\n");
    const text = [check.version, first].filter(Boolean).join("  ");
    const label = labels[check.id];
    lines.push(
      `  ${symbols[check.status]} ${label}${" ".repeat(width - columns(label))}  ${text}`.trimEnd(),
    );
    for (const line of rest) lines.push(`    ${line}`);
    // Fixes for what needs attention; a tool that is not used needs none.
    if (check.status === "fail" || check.status === "warn")
      for (const fix of check.fixes ?? [])
        lines.push(`      ${m.cli.fix({ label: fix.label })}`, `        ${fix.command}`);
  }
  lines.push("");
  if (dataDir) lines.push(m.cli.dataDir({ path: dataDir }));
  // Name the ✗ rows, since a failed check that is not required does not
  // stop the start but does stop a step (such as publishing).
  const failed = (required: boolean) =>
    report.checks
      .filter((check) => check.status === "fail" && check.required === required)
      .map((check) => labels[check.id]);
  const blocked = failed(false);
  lines.push(
    !report.ready
      ? m.cli.notReady({ checks: failed(true) })
      : blocked.length
        ? m.cli.readyExcept({ checks: blocked })
        : m.cli.ready,
  );
  return `${lines.join("\n")}\n`;
}

/**
 * `bell-pr doctor [--json]`: checks the environment and prints a checklist
 * with the commands that fix each problem, or the DoctorReport as JSON.
 * Exits 1 when a required check fails, 2 on an unknown argument.
 */
export async function runDoctorCli(
  argv: string[],
  deps: DoctorCliDeps = {},
): Promise<number> {
  // The saved settings apply as in the server: the language chosen in the
  // app (after a locale in effect, before BELLPR_LOCALE) and the
  // unsandboxed-agents opt-in the sandbox check reports.
  const saved = deps.dataDir ? new AppSettingsService(deps.dataDir) : undefined;
  return saved
    ? withAppSettings(saved, () => doctorCli(argv, deps, saved))
    : doctorCli(argv, deps);
}

/** The port a start would take from the environment; undefined when it is invalid. */
function configuredPort(): number | undefined {
  try {
    return resolvePort(undefined);
  } catch {
    return undefined;
  }
}

async function doctorCli(
  argv: string[],
  deps: DoctorCliDeps,
  saved?: AppSettingsService,
): Promise<number> {
  const out = deps.stdout ?? process.stdout;
  const m = sm().setup.cli;
  let json = false;
  for (const argument of argv) {
    if (argument === "--json") json = true;
    else if (argument === "--help" || argument === "-h") {
      out.write(`${m.usage}\n`);
      return 0;
    } else {
      out.write(`${m.unknownArgument({ argument })}\n${m.usage}\n`);
      return 2;
    }
  }
  // The limits the server would start with: the environment, the saved
  // settings, then the defaults.
  const settings = saved?.get() ?? {};
  const port = "port" in deps ? deps.port : configuredPort();
  const maxActiveRuns = settings.maxActiveRuns ?? defaultActiveRunLimit;
  const report = await runDoctor({
    force: true,
    ...(deps.exec ? { exec: deps.exec } : {}),
    ...(deps.dataDir ? { dataDir: deps.dataDir } : {}),
    app: {
      version: appVersion,
      ...(port !== undefined ? { port } : {}),
      maxActiveRuns,
      maxAgentProcesses: settings.maxAgentProcesses ?? defaultAgentProcessLimit,
    },
  });
  out.write(
    json ? `${JSON.stringify(report, null, 2)}\n` : formatDoctorReport(report, deps.dataDir),
  );
  return report.ready ? 0 : 1;
}
