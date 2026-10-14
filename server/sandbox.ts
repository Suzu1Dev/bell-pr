/**
 * The OS sandbox for Claude Code agents that edit files and run commands.
 *
 * Claude Code's own sandbox runs every Bash command inside bubblewrap on
 * Linux (with socat for its network proxy) or sandbox-exec on macOS. A
 * write-role Claude agent runs only inside it, unless the person allowed
 * unsandboxed agents; such a run is marked `run.unsandboxed`. Read-only
 * roles have no Bash, and Codex brings its own sandbox, so neither needs it.
 */
import { execFile } from "node:child_process";
import { constants, readdirSync, readFileSync, realpathSync } from "node:fs";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentProvider } from "../shared/models.js";
import { product } from "../shared/product.js";
import { AppError } from "./types.js";
import { sm } from "./i18n/index.js";
import type { AgentAccess } from "./agent-cli.js";

export interface SandboxDetection {
  available: boolean;
  /**
   * Why the sandbox is unavailable, as a stable id rather than prose:
   * `missing:bwrap`, `missing:socat`, `missing:bwrap,socat`,
   * `missing:sandbox-exec`, `unusable:bwrap` (installed, but it cannot
   * create namespaces here, as in a Docker container with default security
   * options) or `platform:<name>`. Absent when available.
   */
  reason?: string;
}

/** Executables Claude Code's sandbox needs on each platform. */
function sandboxExecutables(platform: NodeJS.Platform): string[] | undefined {
  if (platform === "linux") return ["bwrap", "socat"];
  if (platform === "darwin") return ["sandbox-exec"];
  return undefined;
}

async function onPath(executable: string, searchPath: string) {
  for (const directory of searchPath.split(path.delimiter)) {
    if (!directory) continue;
    try {
      await access(path.join(directory, executable), constants.X_OK);
      return true;
    } catch {
      /* Not in this directory. */
    }
  }
  return false;
}

/**
 * Whether bubblewrap can start a sandbox like the one Claude Code asks
 * for (new namespaces, its own /proc and /dev). Docker's default seccomp
 * and AppArmor profiles and masked /proc paths stop it even when the
 * executables are installed (docs/docker.md).
 */
function bwrapWorks(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      "bwrap",
      [
        "--ro-bind", "/", "/",
        "--dev", "/dev",
        "--proc", "/proc",
        "--unshare-all",
        "--die-with-parent",
        "true",
      ],
      { timeout: 10_000, windowsHide: true },
      (error) => resolve(!error),
    );
  });
}

/** Keyed by platform and PATH, so a changed PATH is looked at again. */
const detections = new Map<string, Promise<SandboxDetection>>();

/**
 * Whether Claude Code's sandbox can start here: on Linux bwrap and socat
 * on PATH, and bwrap able to create a sandbox; sandbox-exec on macOS;
 * other platforms have none. The answer is cached for the PATH it was
 * computed with.
 */
export function detectClaudeSandbox(): Promise<SandboxDetection> {
  const platform = process.platform;
  const searchPath = process.env.PATH ?? "";
  const key = `${platform}\0${searchPath}`;
  let detection = detections.get(key);
  if (!detection) {
    detection = (async (): Promise<SandboxDetection> => {
      const needed = sandboxExecutables(platform);
      if (!needed) return { available: false, reason: `platform:${platform}` };
      const missing: string[] = [];
      for (const executable of needed)
        if (!(await onPath(executable, searchPath))) missing.push(executable);
      if (missing.length)
        return { available: false, reason: `missing:${missing.join(",")}` };
      if (platform === "linux" && !(await bwrapWorks()))
        return { available: false, reason: "unusable:bwrap" };
      return { available: true };
    })();
    detections.set(key, detection);
  }
  return detection;
}

let allowUnsandboxedSource: (() => boolean | undefined) | undefined;

/**
 * Sets where the "allow unsandboxed Claude agents" choice comes from, such
 * as the app settings. A source that returns undefined or throws falls back
 * to BELLPR_ALLOW_UNSANDBOXED_AGENTS. Call it without an argument to remove
 * the source.
 */
export function setAllowUnsandboxedAgentsSource(
  fn?: () => boolean | undefined,
): void {
  allowUnsandboxedSource = fn;
}

/**
 * True when the person allowed Claude Code write agents to run without the
 * OS sandbox: from the source above, else BELLPR_ALLOW_UNSANDBOXED_AGENTS=1.
 */
export function allowUnsandboxedAgents(): boolean {
  try {
    const value = allowUnsandboxedSource?.();
    if (typeof value === "boolean") return value;
  } catch {
    /* An unreadable setting falls back to the environment. */
  }
  return process.env.BELLPR_ALLOW_UNSANDBOXED_AGENTS === "1";
}

/**
 * Decides how one agent turn runs. A write-role Claude agent gets the
 * sandbox when it is available; without it the turn runs unsandboxed only
 * when the person allowed that, and is refused otherwise with 503
 * `claude_sandbox_unavailable` and the ways to fix it. Every other turn is
 * unaffected.
 */
export async function enforceAgentSandbox(
  provider: AgentProvider | undefined,
  access: AgentAccess,
): Promise<{ sandbox: boolean; unsandboxed: boolean }> {
  if (provider !== "claude" || access !== "write")
    return { sandbox: false, unsandboxed: false };
  const detection = await detectClaudeSandbox();
  if (detection.available) return { sandbox: true, unsandboxed: false };
  if (allowUnsandboxedAgents()) return { sandbox: false, unsandboxed: true };
  const messages = sm().security.sandbox;
  const allowFix = {
    label: messages.allowFix,
    command: `BELLPR_ALLOW_UNSANDBOXED_AGENTS=1 ${product.binNames[0]}`,
  };
  // Installed but blocked, as in a container: installing it again or
  // switching to Codex, whose sandbox is blocked the same way, cannot help.
  if (detection.reason === "unusable:bwrap")
    throw new AppError(messages.blocked, 503, {
      code: "claude_sandbox_unavailable",
      fixes: [
        {
          label: messages.dockerFix,
          command:
            "docker run --security-opt seccomp=unconfined --security-opt apparmor=unconfined --security-opt systempaths=unconfined …",
          platform: "linux",
        },
        allowFix,
      ],
    });
  throw new AppError(messages.unavailable, 503, {
    code: "claude_sandbox_unavailable",
    fixes: [
      {
        label: messages.installFix,
        command: "sudo apt-get install bubblewrap socat",
        platform: "linux",
      },
      { label: messages.codexFix, command: "codex login" },
      allowFix,
    ],
  });
}

// ---------------------------------------------------------------------------
// Read denials: what no agent may read, sandboxed or not.

let agentDataDirectory: string | undefined;

/**
 * Tells the agent settings where BELL keeps its data (state, license, the
 * one-time sign-in links in `run/`, other runs' checkouts), so agents are
 * denied reading it outside their own checkout. The server sets it when the
 * app is created.
 */
export function setAgentDataDirectory(directory?: string) {
  agentDataDirectory = directory ? path.resolve(directory) : undefined;
}

/** The path with symlinks resolved when it exists, else as given. */
function resolved(value: string) {
  try {
    return realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}

function inside(child: string, parent: string) {
  const relative = path.relative(parent, child);
  return (
    !!relative && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

/**
 * The data directory a checkout belongs to, from BELL's layout:
 * `<data>/worktrees/<run>` and `<data>/team-worktrees/<run>/<task>`.
 */
function dataDirectoryOf(cwd: string) {
  const parts = cwd.split(path.sep);
  const at = parts.lastIndexOf("worktrees");
  if (at > 0 && at === parts.length - 2) return parts.slice(0, at).join(path.sep);
  const team = parts.lastIndexOf("team-worktrees");
  if (team > 0 && team === parts.length - 3)
    return parts.slice(0, team).join(path.sep);
  return undefined;
}

/**
 * A Read rule for an absolute path, in permission-rule syntax (`//` starts
 * an absolute path), followed by an optional glob such as `/**`. Glob
 * characters in the path itself are escaped; a path Claude Code could not
 * parse inside a rule is left out rather than risk the whole settings value
 * being rejected.
 */
function absoluteRule(directory: string, glob = ""): string | undefined {
  if (/[()\\\n\r\0]/.test(directory)) return undefined;
  return `Read(/${directory.replace(/[*?[\]!#]/g, (char) => `\\${char}`)}${glob})`;
}

function entries(directory: string) {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
}

/** The repository a checkout's `.git` file points into, when it is one. */
function owningClone(cwd: string) {
  try {
    const pointer = /^gitdir: (.+)$/m.exec(
      readFileSync(path.join(cwd, ".git"), "utf8"),
    )?.[1];
    if (!pointer) return undefined;
    const gitDirectory = path.resolve(cwd, pointer.trim());
    const marker = `${path.sep}.git${path.sep}worktrees${path.sep}`;
    const at = gitDirectory.lastIndexOf(marker);
    return at > 0 ? resolved(gitDirectory.slice(0, at)) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read denials for one data directory. A checkout outside it is denied all
 * of it. A checkout inside it may read its own path only: every other entry
 * on the way down is denied, except the repository its Git metadata lives
 * in (Git inside the sandbox reads it). Files that may appear later, such
 * as the sign-in link in `run/`, are denied whether they exist yet or not.
 */
function dataDirectoryRules(dataDirectory: string, cwd: string): string[] {
  const root = resolved(dataDirectory);
  const rules: (string | undefined)[] = [];
  const deny = (target: string) =>
    rules.push(absoluteRule(target), absoluteRule(target, "/**"));
  if (root === cwd || !inside(cwd, root)) {
    rules.push(absoluteRule(root, "/**"));
    return rules.filter((rule): rule is string => !!rule);
  }
  for (const pattern of ["run/**", "insights/**", "*.json", "*.lock", "*-index-*"])
    rules.push(absoluteRule(root, `/${pattern}`));
  const clone = owningClone(cwd);
  let directory = root;
  for (const part of path.relative(root, cwd).split(path.sep)) {
    for (const entry of entries(directory)) {
      if (entry === part) continue;
      const target = path.join(directory, entry);
      // Without a worktree pointer there is no clone to keep readable.
      if (directory === root && entry === "repositories" && clone) {
        for (const repository of entries(target)) {
          const candidate = path.join(target, repository);
          if (resolved(candidate) !== clone) deny(candidate);
        }
        continue;
      }
      deny(target);
    }
    directory = path.join(directory, part);
  }
  return [...new Set(rules.filter((rule): rule is string => !!rule))];
}

/**
 * Files that hold credentials, by home-relative rule: SSH keys, the GitHub
 * CLI login, cloud credentials, npm and netrc tokens, and the Claude Code
 * and Codex logins.
 */
const credentialRules = [
  "Read(~/.ssh/**)",
  "Read(~/.config/gh/**)",
  "Read(~/.aws/**)",
  "Read(~/.npmrc)",
  "Read(~/.netrc)",
  "Read(~/.claude/.credentials.json)",
  "Read(~/.codex/auth.json)",
];

/**
 * Every Read denial for an agent working in `cwd`: the credential files
 * above, the same files where an environment variable moved them, and
 * BELL's data directory outside the agent's own checkout. Deny rules also
 * cover Grep and Glob, and Claude Code applies them to sandboxed commands.
 */
export function agentReadDenials(cwd: string): string[] {
  const here = resolved(cwd);
  const rules = [...credentialRules];
  const moved: [string | undefined, string][] = [
    [process.env.CLAUDE_CONFIG_DIR, ".credentials.json"],
    [process.env.CODEX_HOME, "auth.json"],
    [process.env.GH_CONFIG_DIR, "**"],
    [
      process.env.XDG_CONFIG_HOME &&
        path.join(process.env.XDG_CONFIG_HOME, "gh"),
      "**",
    ],
  ];
  for (const [directory, file] of moved)
    if (directory && path.isAbsolute(directory)) {
      const rule = absoluteRule(resolved(directory), `/${file}`);
      if (rule) rules.push(rule);
    }
  const dataDirectories = new Set(
    [
      agentDataDirectory,
      dataDirectoryOf(here),
      process.env.BELLPR_DATA_DIR,
      path.join(os.homedir(), ".bellpr"),
    ]
      .filter((value): value is string => !!value)
      .map((value) => resolved(value)),
  );
  for (const directory of dataDirectories)
    rules.push(...dataDirectoryRules(directory, here));
  return [...new Set(rules)];
}
