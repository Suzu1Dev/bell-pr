/**
 * The OS sandbox for Claude Code and Antigravity agents that edit files and
 * run commands.
 *
 * Claude Code's own sandbox runs every Bash command inside bubblewrap on
 * Linux (with socat for its network proxy) or sandbox-exec on macOS; the
 * Antigravity CLI's terminal sandbox uses user namespaces on Linux and
 * sandbox-exec on macOS. A write-role agent of either runs only inside it,
 * unless the person allowed unsandboxed agents; such a run is marked
 * `run.unsandboxed`. Read-only roles run no commands, and Codex brings its
 * own sandbox, so neither needs it.
 */
import { execFile } from "node:child_process";
import { constants, existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expandHome, sharedCredentialDenials } from "../shared/credential-denials.js";
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
 * computed with, until forgetClaudeSandboxDetection().
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

/**
 * Forgets every cached answer of detectClaudeSandbox, so the next call
 * looks again: the doctor's "Re-check" sees a bubblewrap or socat installed
 * while the server runs.
 */
export function forgetClaudeSandboxDetection(): void {
  detections.clear();
}

let kernelSettingsRoot = "/proc/sys";

/** Tests read the kernel settings from another folder; no argument restores /proc/sys. */
export function setKernelSettingsRootForTests(directory?: string): void {
  kernelSettingsRoot = directory ?? "/proc/sys";
}

/** A kernel setting under /proc/sys, trimmed; undefined when it cannot be read. */
async function kernelSetting(name: string) {
  try {
    return (await readFile(path.join(kernelSettingsRoot, name), "utf8")).trim();
  } catch {
    return undefined;
  }
}

/**
 * Whether the Antigravity CLI's terminal sandbox can start here, judged the
 * way agy 1.5.0 judges it: on Linux it needs unprivileged user namespaces,
 * which `kernel.apparmor_restrict_unprivileged_userns = 1` (the Ubuntu
 * default since 24.04) withholds from it ("Terminal sandbox unavailable:
 * AppArmor restricts unprivileged user namespaces" in its log), as do
 * `kernel.unprivileged_userns_clone = 0` and `user.max_user_namespaces = 0`;
 * on macOS it needs sandbox-exec. agy does not refuse a turn without its
 * sandbox: `--sandbox` then does nothing and commands wait for an approval
 * that print mode cannot give. Reasons: `restricted:apparmor`,
 * `restricted:userns`, `missing:sandbox-exec` or `platform:<name>`.
 */
export async function detectAntigravitySandbox(): Promise<SandboxDetection> {
  const platform = process.platform;
  if (platform === "darwin")
    return (await onPath("sandbox-exec", process.env.PATH ?? ""))
      ? { available: true }
      : { available: false, reason: "missing:sandbox-exec" };
  if (platform !== "linux") return { available: false, reason: `platform:${platform}` };
  if ((await kernelSetting("kernel/apparmor_restrict_unprivileged_userns")) === "1")
    return { available: false, reason: "restricted:apparmor" };
  if (
    (await kernelSetting("kernel/unprivileged_userns_clone")) === "0" ||
    (await kernelSetting("user/max_user_namespaces")) === "0"
  )
    return { available: false, reason: "restricted:userns" };
  return { available: true };
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
 * True when the person allowed Claude Code and Antigravity write agents to
 * run without the OS sandbox: from the source above, else
 * BELLPR_ALLOW_UNSANDBOXED_AGENTS=1.
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
 * Decides how one agent turn runs. A write-role Claude or Antigravity agent
 * gets its sandbox when it is available; without it the turn runs
 * unsandboxed only when the person allowed that, and is refused otherwise
 * with 503 `claude_sandbox_unavailable` or `antigravity_sandbox_unavailable`
 * and the ways to fix it. Every other turn is unaffected.
 */
export async function enforceAgentSandbox(
  provider: AgentProvider | undefined,
  access: AgentAccess,
): Promise<{ sandbox: boolean; unsandboxed: boolean }> {
  if ((provider !== "claude" && provider !== "antigravity") || access !== "write")
    return { sandbox: false, unsandboxed: false };
  const detection =
    provider === "claude" ? await detectClaudeSandbox() : await detectAntigravitySandbox();
  if (detection.available) return { sandbox: true, unsandboxed: false };
  if (allowUnsandboxedAgents()) return { sandbox: false, unsandboxed: true };
  const messages = sm().security.sandbox;
  const allowFix = {
    label: messages.allowFix,
    command: `BELLPR_ALLOW_UNSANDBOXED_AGENTS=1 ${product.binNames[0]}`,
  };
  if (provider === "antigravity")
    throw new AppError(
      detection.reason?.startsWith("restricted:")
        ? messages.antigravityRestricted
        : messages.antigravityUnavailable,
      503,
      {
        code: "antigravity_sandbox_unavailable",
        fixes: [{ label: messages.claudeFix, command: "claude auth login" }, allowFix],
      },
    );
  // Installed but blocked, as in a container: installing it again or
  // switching to Codex, whose sandbox is blocked the same way, cannot help.
  if (detection.reason === "unusable:bwrap")
    throw new AppError(messages.blocked, 503, {
      code: "claude_sandbox_unavailable",
      fixes: [
        {
          label: messages.dockerFix,
          command:
            "--security-opt seccomp=unconfined --security-opt apparmor=unconfined --security-opt systempaths=unconfined",
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
 * Tells the agent settings where BELL keeps its data (state, other runs'
 * checkouts), so agents are denied reading it outside their own checkout.
 * The server sets it when the app is created.
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

/** True when `child` lies strictly inside `parent`. */
export function inside(child: string, parent: string) {
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
 * A Read rule (or another tool's) for an absolute path, in permission-rule
 * syntax (`//` starts an absolute path), followed by an optional glob such
 * as `/**`. Glob
 * characters in the path itself are escaped; a path Claude Code could not
 * parse inside a rule is left out rather than risk the whole settings value
 * being rejected.
 */
function absoluteRule(directory: string, glob = "", tool = "Read"): string | undefined {
  if (/[()\\\n\r\0]/.test(directory)) return undefined;
  return `${tool}(/${directory.replace(/[*?[\]!#]/g, (char) => `\\${char}`)}${glob})`;
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
 * What one data directory denies an agent working in `cwd`. A checkout
 * outside it is denied all of it (`whole`). A checkout inside it may read
 * its own path only: every other entry on the way down is denied
 * (`targets`), except the repository its Git metadata lives in (Git inside
 * the sandbox reads it).
 */
function dataDirectoryDenials(dataDirectory: string, cwd: string) {
  const root = resolved(dataDirectory);
  if (root === cwd || !inside(cwd, root)) return { root, whole: true, targets: [] };
  const targets: string[] = [];
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
          if (resolved(candidate) !== clone) targets.push(candidate);
        }
        continue;
      }
      targets.push(target);
    }
    directory = path.join(directory, part);
  }
  return { root, whole: false, targets };
}

/**
 * Read denials for one data directory (see dataDirectoryDenials). Files
 * that may appear later, such as the insights cache, are denied whether
 * they exist yet or not.
 */
function dataDirectoryRules(dataDirectory: string, cwd: string): string[] {
  const { root, whole, targets } = dataDirectoryDenials(dataDirectory, cwd);
  if (whole) return [absoluteRule(root, "/**")].filter((rule): rule is string => !!rule);
  const rules: (string | undefined)[] = [];
  for (const pattern of ["insights/**", "*.json", "*.lock", "*-index-*"])
    rules.push(absoluteRule(root, `/${pattern}`));
  for (const target of targets)
    rules.push(absoluteRule(target), absoluteRule(target, "/**"));
  return [...new Set(rules.filter((rule): rule is string => !!rule))];
}

/**
 * A Claude Code Read rule for one shared denial. Home-relative entries stay
 * in `~` form. Absolute paths use `//`, and a path the rule syntax cannot
 * carry is left out rather than risk the whole settings value being rejected.
 */
function claudeCredentialRule(entry: string): string | undefined {
  if (/[()\\\n\r\0"]/.test(entry)) return undefined;
  if (entry.startsWith("~")) return `Read(${entry})`;
  if (entry.endsWith("/**")) return absoluteRule(entry.slice(0, -3), "/**");
  return absoluteRule(entry);
}

/**
 * Every Read denial for an agent working in `cwd`: the shared credential
 * list (GitHub CLI config, git credential files, netrc, SSH, and the files
 * where an environment variable moved them) and BELL's data directory
 * outside the agent's own checkout. Deny rules also cover Grep and Glob,
 * and Claude Code applies them to sandboxed commands. The person can turn
 * that sandbox off; these rules are still sent, and a shell then runs
 * with the person's own account.
 */
export function agentReadDenials(cwd: string): string[] {
  const here = resolved(cwd);
  const rules = sharedCredentialDenials().flatMap((entry) => {
    const rule = claudeCredentialRule(entry);
    return rule ? [rule] : [];
  });
  for (const directory of dataDirectoriesFor(here))
    rules.push(...dataDirectoryRules(directory, here));
  return [...new Set(rules)];
}

/** Every data directory of BELL an agent working in `here` must not read. */
function dataDirectoriesFor(here: string) {
  return new Set(
    [
      agentDataDirectory,
      dataDirectoryOf(here),
      process.env.BELLPR_DATA_DIR,
      path.join(os.homedir(), ".bellpr"),
    ]
      .filter((value): value is string => !!value)
      .map((value) => resolved(value)),
  );
}

/**
 * The `sandbox.filesystem` read paths for a sandboxed agent working in
 * `cwd` (`//` starts an absolute path). The Read rules above can only list
 * what exists when the turn starts, so a checkout or clone created during
 * a long turn would stay readable. Here each data directory is denied
 * whole, and a checkout inside one gets its own path and the Git directory
 * of its clone opened again (allowRead wins over denyRead). Claude Code
 * reads a path with glob characters as a pattern, so such a data directory
 * is left to the Read rules.
 */
export function agentSandboxReadPaths(cwd: string) {
  const here = resolved(cwd);
  const denyRead: string[] = [];
  const allowRead: string[] = [];
  const literal = (value: string) => !/[*?[\]]/.test(value);
  for (const root of dataDirectoriesFor(here)) {
    const open: string[] = [];
    if (root !== here && inside(here, root)) {
      open.push(here);
      const clone = owningClone(here);
      const git = clone && path.join(clone, ".git");
      if (git && inside(git, root)) open.push(git);
    }
    if (![root, ...open].every(literal)) continue;
    denyRead.push(`/${root}`);
    allowRead.push(...open.map((value) => `/${value}`));
  }
  return { denyRead: [...new Set(denyRead)], allowRead: [...new Set(allowRead)] };
}

/** An Antigravity permission rule such as `read_file(/home/me/.ssh)`; undefined for a target it cannot carry. */
function antigravityRule(action: string, target: string): string | undefined {
  return /[()\n\r\0]/.test(target) ? undefined : `${action}(${target})`;
}

/**
 * The Antigravity CLI's and Google Cloud's own files that no Antigravity
 * turn may read or write: your customizations (hooks, MCP servers,
 * plugins), its settings and saved conversations, the Gemini CLI's sign-in
 * next to them, plugin secrets, and the gcloud configuration and
 * Application Default Credentials that BELL passes on for signing in. Its
 * `brain` folder, where the agent keeps the artifacts of a conversation,
 * stays open.
 */
function antigravityPrivatePaths(home: string): string[] {
  const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  return [
    path.join(home, ".gemini", "config"),
    path.join(home, ".gemini", "settings.json"),
    path.join(home, ".gemini", "oauth_creds.json"),
    path.join(home, ".gemini", "antigravity-cli", "settings.json"),
    path.join(home, ".gemini", "antigravity-cli", "conversations"),
    path.join(home, ".config", "antigravity"),
    process.env.CLOUDSDK_CONFIG || path.join(home, ".config", "gcloud"),
    ...(credentials ? [credentials] : []),
  ].map((target) => path.resolve(target));
}

/**
 * Every entry of the home directory, and of each folder below it on the way
 * to `cwd`, that is not on that way; every entry of it when `cwd` lies
 * outside it. A read-only Antigravity turn gets these, since agy lets its
 * read tool open files outside the workspace (1.5.0 read one in another
 * project under a folder it trusted).
 */
function homeDenials(home: string, cwd: string): string[] {
  const root = resolved(home);
  if (root === cwd) return [];
  if (!inside(cwd, root)) return entries(root).map((entry) => path.join(root, entry));
  const targets: string[] = [];
  let directory = root;
  for (const part of path.relative(root, cwd).split(path.sep)) {
    for (const entry of entries(directory))
      if (entry !== part) targets.push(path.join(directory, entry));
    directory = path.join(directory, part);
  }
  return targets;
}

/**
 * The read denials of agentReadDenials as Antigravity `read_file` rules,
 * which deny a path and everything under it (agy 1.5.0 refused a file in a
 * denied directory, also through a symbolic link in the checkout) and also
 * deny writing it, plus the Antigravity CLI's own files
 * (antigravityPrivatePaths). Globs are not part of the rule syntax, so `~`
 * entries are expanded, `X/**` becomes the directory X, and the data
 * directory's files that may appear later are denied by name: its insights
 * cache directory. A file that appears at its top level during a turn is not
 * covered, as it is for Claude Code. `outsideCheckout` also denies the home
 * directory off the way to the checkout (homeDenials).
 */
export function antigravityReadDenials(
  cwd: string,
  options: { outsideCheckout?: boolean } = {},
): string[] {
  const here = resolved(cwd);
  const home = process.env.HOME || os.homedir();
  const targets = sharedCredentialDenials().map((entry) =>
    path.resolve(expandHome(entry.replace(/\/(?:\*\*)?$/, ""), home)),
  );
  targets.push(...antigravityPrivatePaths(home));
  for (const directory of dataDirectoriesFor(here)) {
    const { root, whole, targets: denied } = dataDirectoryDenials(directory, here);
    targets.push(...(whole ? [root] : [path.join(root, "insights"), ...denied]));
  }
  if (options.outsideCheckout) targets.push(...homeDenials(home, here));
  return [...new Set(targets)].flatMap((target) => antigravityRule("read_file", target) ?? []);
}

/**
 * The Git paths of agentGitWriteDenials as Antigravity `write_file` rules,
 * which cover a path and everything under it, so the `/**` forms are left
 * out.
 */
export function antigravityGitWriteDenials(cwd: string): string[] {
  return agentGitWriteDenials(cwd)
    .filter((target) => !target.endsWith("/**"))
    .flatMap((target) => antigravityRule("write_file", target) ?? []);
}

/**
 * The `read_file` allow rule for the Git directory of the clone a worktree
 * checkout belongs to: agy's sandbox mounts nothing outside the workspace
 * that no rule allows, and Git inside it needs that directory. Undefined
 * for a checkout with its own `.git` directory.
 */
export function antigravityCloneGitRead(cwd: string): string | undefined {
  const clone = owningClone(cwd);
  return clone && antigravityRule("read_file", path.join(clone, ".git"));
}

/**
 * The customization folders the Antigravity CLI looks for in a workspace,
 * and what it loads from them that runs or instructs outside BELL's
 * control: hooks (shell commands it runs outside any sandbox), MCP servers
 * it starts, plugins bundling both, custom agents with their own MCP
 * servers, and skills. agy 1.5.0 has no setting that skips them and loads
 * them in print mode in a folder it was never asked to trust (BELL's own
 * check with a SessionStart hook).
 */
const antigravityCustomizationRoots = [".agents", ".agent", "_agents", "_agent"];
const antigravityCustomizations = [
  "hooks.json",
  "mcp_config.json",
  "plugins",
  "plugins.json",
  "agents",
  "skills",
  "skills.json",
];

/**
 * The customizations agy would load from `cwd`: it walks from the working
 * directory up to the repository root (the folder holding `.git`), so each
 * folder on that way is checked, and only `cwd` itself when no folder above
 * it is a repository. Paths are relative to `cwd`.
 */
export function antigravityWorkspaceConfig(cwd: string): string[] {
  const start = path.resolve(cwd);
  const folders: string[] = [];
  for (let directory = start; ; ) {
    folders.push(directory);
    if (existsSync(path.join(directory, ".git"))) break;
    const parent = path.dirname(directory);
    if (parent === directory) {
      folders.splice(1);
      break;
    }
    directory = parent;
  }
  return folders.flatMap((folder) =>
    antigravityCustomizationRoots.flatMap((root) =>
      antigravityCustomizations
        .map((item) => path.join(folder, root, item))
        .filter((target) => existsSync(target))
        .map((target) => path.relative(start, target)),
    ),
  );
}

/** 422 `antigravity_workspace_config` before an Antigravity turn in a folder that would load customizations. */
export function assertNoAntigravityWorkspaceConfig(cwd: string): void {
  const found = antigravityWorkspaceConfig(cwd);
  if (found.length)
    throw new AppError(
      (m) => m.security.sandbox.antigravityWorkspaceConfig({ paths: found.slice(0, 5) }),
      422,
      { code: "antigravity_workspace_config", params: { paths: found.slice(0, 5).join(", ") } },
    );
}

/**
 * Paths a sandboxed agent must not write. Claude Code's
 * `sandbox.filesystem.denyWrite` takes absolute paths and does not block
 * reads. The checkout's `.git` pointer is inside the working directory, so
 * the default write allow would otherwise cover it. Hooks and config live
 * in the clone's git directory, which these paths name explicitly.
 */
export function agentGitWriteDenials(cwd: string): string[] {
  const dotGit = path.join(cwd, ".git");
  let metadata;
  try {
    metadata = lstatSync(dotGit);
  } catch {
    metadata = undefined;
  }
  // The path itself and everything under it: editing the file, or replacing
  // it with a directory and writing inside that directory.
  const rules: string[] = [dotGit, `${dotGit}/**`];
  const deny = (target: string) => {
    rules.push(target);
    if (!target.endsWith("/**")) rules.push(`${target}/**`);
  };
  if (!metadata) return [...new Set(rules)];
  if (metadata.isFile()) {
    const pointer = /^gitdir: ([^\r\n]+)/.exec(readFileSync(dotGit, "utf8"))?.[1];
    if (!pointer) return [...new Set(rules)];
    const gitDir = path.resolve(cwd, pointer.trim());
    const common = path.resolve(gitDir, "..", "..");
    deny(path.join(common, "hooks"));
    rules.push(path.join(common, "config"));
    rules.push(path.join(gitDir, "config.worktree"));
    return [...new Set(rules)];
  }
  if (!metadata.isDirectory()) return [];
  deny(path.join(dotGit, "hooks"));
  rules.push(path.join(dotGit, "config"));
  try {
    for (const name of readdirSync(path.join(dotGit, "worktrees")))
      rules.push(path.join(dotGit, "worktrees", name, "config.worktree"));
  } catch {
    /* No worktrees recorded. */
  }
  return [...new Set(rules)];
}

/** The most held paths one turn's sandbox is given; the rest wait for the check after the turn. */
export const maxHeldWriteTargets = 200;

/**
 * Where in the checkout `cwd` an agent write turn must not write because
 * other people in the group hold it (docs/design/collab-write-guard.md,
 * S3): absolute paths, as the checkout spells them, for the sandbox to make
 * read-only. Holds fold ASCII case and the file system on Linux does not,
 * so each held path is looked up one folder at a time and every spelling
 * found there counts. A held file that does not exist yet is named too,
 * when its folder exists: the sandbox then refuses to create it. Left out,
 * so that the turn still starts and only the check after it applies:
 *
 * - a held path whose folder does not exist (Codex 0.167 would make the
 *   first missing folder read-only, other people's files in it included);
 * - a path with a symbolic link on the way or at its end (bubblewrap
 *   refuses to start: "cannot enforce sandbox read-only path … because it
 *   crosses writable symlink");
 * - anything in `.git`, which is already read-only, and paths with `..`;
 * - a path below another one in the list, and paths past
 *   maxHeldWriteTargets.
 *
 * Each sandbox may leave out more (codexSandboxConfig: glob characters;
 * heldSandboxWriteDenials: paths that do not exist).
 *
 * Verified with codex-cli 0.167.0 (`codex sandbox`) on Linux with
 * bubblewrap 0.11.1: a read-only file cannot be written, deleted or
 * renamed over, a read-only folder takes no new file, and its neighbours
 * stay writable.
 */
export function heldWriteTargets(cwd: string, scopes: readonly string[]): string[] {
  const fold = (value: string) => value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  const found = new Set<string>();
  for (const scope of scopes) {
    const parts = scope.split("/").filter((part) => part && part !== ".");
    if (!parts.length || parts.includes("..") || fold(parts[0]) === ".git") continue;
    let folders = [cwd];
    parts.forEach((part, index) => {
      const last = index === parts.length - 1;
      const next: string[] = [];
      for (const folder of folders) {
        let names;
        try {
          names = readdirSync(folder, { withFileTypes: true });
        } catch {
          continue;
        }
        const matches = names.filter((entry) => fold(entry.name) === fold(part));
        if (!matches.length && last) found.add(path.join(folder, part));
        for (const entry of matches) {
          if (entry.isSymbolicLink()) continue;
          const target = path.join(folder, entry.name);
          if (last) found.add(target);
          else if (entry.isDirectory()) next.push(target);
        }
      }
      folders = next;
    });
  }
  const sorted = [...found].sort();
  return sorted
    .filter((target) => !sorted.some((other) => inside(target, other)))
    .slice(0, maxHeldWriteTargets);
}

/**
 * The Claude Code Edit rules for heldWriteTargets: each path and everything
 * under it. Edit rules cover every tool that edits files (Edit, Write,
 * NotebookEdit); the sandbox's denyWrite covers Bash. They apply with or
 * without the sandbox.
 */
export function heldEditDenials(targets: readonly string[]): string[] {
  return targets.flatMap((target) =>
    [absoluteRule(target, "", "Edit"), absoluteRule(target, "/**", "Edit")].filter(
      (rule): rule is string => !!rule,
    ),
  );
}

/**
 * heldWriteTargets as Claude Code's sandbox takes them for Bash. A path with
 * glob characters would be read as a pattern, and a path that does not
 * exist yet was not verified with its bubblewrap (on the Linux host where
 * this was written, Claude Code 2.1.321 could not start its sandbox at all,
 * with or without these paths), so both are left out: the Edit rules and
 * the check after the turn still cover them.
 */
export function heldSandboxWriteDenials(targets: readonly string[]): string[] {
  return targets.filter((target) => !/[*?[\]{}]/.test(target) && existsSync(target));
}
