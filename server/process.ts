import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { AgentProvider } from "../shared/models.js";
import { log } from "./log.js";
import { redact } from "./secrets.js";
import { AppError } from "./types.js";
import { cancelled, currentLocale, withLocale } from "./i18n/index.js";
import { withCliSetupHint } from "./cli-errors.js";

export { redact };

/**
 * Told about every child process BELL PR starts, for example to record
 * agent process groups and reap leftovers after a crash.
 */
export interface SpawnObserver {
  onSpawn(pid: number, executable: string, details?: SpawnDetails): void;
  onExit(pid: number): void;
}

/**
 * What command() adds for a command started with `endGroup`: record its
 * process group whatever the executable. onExit then comes only once the
 * whole group is gone.
 */
export interface SpawnDetails {
  recordGroup: true;
}

let spawnObserver: SpawnObserver | undefined;

/** Observes child processes started from now on; no argument removes it. */
export function setSpawnObserver(observer?: SpawnObserver): void {
  spawnObserver = observer;
}

/**
 * Reports `child` to the spawn observer: onSpawn now if it has a pid, and
 * onExit to the same observer when it closes. A child that failed to start
 * has no pid and is not reported. Observer errors are logged, never thrown,
 * so they cannot break the command.
 */
export function observeChild(child: ChildProcess, executable: string): void {
  const exited = reportSpawn(child, executable);
  if (exited) child.once("close", exited);
}

/**
 * Reports `child` to the spawn observer now (with `details` when given),
 * and returns the call that reports its exit, or nothing when there is no
 * observer or no pid.
 */
function reportSpawn(
  child: ChildProcess,
  executable: string,
  details?: SpawnDetails,
): (() => void) | undefined {
  const observer = spawnObserver;
  const pid = child.pid;
  if (!observer || pid === undefined) return undefined;
  const notify = (event: string, call: () => void) => {
    try {
      call();
    } catch (error) {
      log.warn("Spawn observer failed", { event, executable, pid, error });
    }
  };
  notify("spawn", () =>
    details
      ? observer.onSpawn(pid, executable, details)
      : observer.onSpawn(pid, executable),
  );
  return () => notify("exit", () => observer.onExit(pid));
}

/** Whether any process of the group is still there (a zombie counts until it is reaped). */
function groupAlive(pgid: number) {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** What every agent CLI needs to run: the shell basics and the locale. */
const baseEnvironment = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "LANG",
  "LC_ALL",
];

/** The Codex CLI's home and the OpenAI keys it accepts. */
const codexEnvironment = ["CODEX_HOME", "OPENAI_API_KEY", "CODEX_API_KEY"];

/**
 * Every way Claude Code signs in: an Anthropic API key or auth token (also
 * through a gateway), Amazon Bedrock, Google Vertex AI, Microsoft Foundry,
 * and the claude.ai login kept in its config directory or passed as a
 * long-lived OAuth token.
 */
const claudeEnvironment = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_SKIP_BEDROCK_AUTH",
  "CLAUDE_CODE_SKIP_VERTEX_AUTH",
  "CLAUDE_CODE_SKIP_FOUNDRY_AUTH",
  "ANTHROPIC_BEDROCK_BASE_URL",
  "ANTHROPIC_VERTEX_BASE_URL",
  "ANTHROPIC_FOUNDRY_BASE_URL",
  "ANTHROPIC_FOUNDRY_RESOURCE",
  "ANTHROPIC_FOUNDRY_API_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_BEARER_TOKEN_BEDROCK",
  "AWS_PROFILE",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "AWS_CONFIG_FILE",
  "AWS_SHARED_CREDENTIALS_FILE",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "ANTHROPIC_VERTEX_PROJECT_ID",
  "CLOUD_ML_REGION",
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_CODE_OAUTH_TOKEN",
];

/**
 * Usage-data opt-outs the person set, passed through unchanged so their
 * choice reaches the agents: the cross-tool DO_NOT_TRACK for both CLIs, and
 * the variables Claude Code documents for its telemetry, error reports, bug
 * reports, feedback surveys and all non-essential traffic. BELL PR never
 * sets them itself.
 */
const optOutEnvironment = ["DO_NOT_TRACK"];
const claudeOptOutEnvironment = [
  "DISABLE_TELEMETRY",
  "DISABLE_ERROR_REPORTING",
  "DISABLE_BUG_COMMAND",
  "CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY",
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
];

/**
 * The environment an agent CLI runs with: nothing from the server's own
 * environment except what that CLI needs and the usage-data opt-outs the
 * person set. Claude Code receives every authentication method it supports;
 * BELL never restricts or reads them. Codex gets only its own keys and
 * Claude Code only its own. Without a provider the result holds both sets,
 * for callers that have not said which CLI they start.
 */
export function agentEnvironment(provider?: AgentProvider): NodeJS.ProcessEnv {
  const keys = [
    ...baseEnvironment,
    ...optOutEnvironment,
    ...(provider === "claude" ? [] : codexEnvironment),
    ...(provider === "codex" ? [] : [...claudeEnvironment, ...claudeOptOutEnvironment]),
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const key of keys) {
    if (process.env[key]) env[key] = process.env[key];
  }
  // Removed here as well as at spawn. A later edit that adds either name to
  // the allowlist above still must not hand it to an agent.
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  return { ...env, NO_COLOR: "1", GIT_TERMINAL_PROMPT: "0" };
}

/**
 * Environment for one Claude Code or Codex child. With no explicit env,
 * this is agentEnvironment. With an explicit env, every variable is kept
 * except `GH_TOKEN` and `GITHUB_TOKEN`, which are removed here, at spawn,
 * whether or not the sandbox is on. Does not mutate `explicit`.
 */
export function agentChildEnvironment(
  provider?: AgentProvider,
  explicit?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  if (!explicit) return agentEnvironment(provider);
  const child = { ...explicit };
  delete child.GH_TOKEN;
  delete child.GITHUB_TOKEN;
  return child;
}

/** `claude` or `codex`, including a path and a Windows `.exe` / `.cmd` name. */
export function agentProviderOf(executable: string): AgentProvider | undefined {
  const base = executable.split(/[/\\]/).pop()?.toLowerCase().replace(/\.(?:exe|cmd)$/i, "");
  if (base === "claude") return "claude";
  if (base === "codex") return "codex";
  return undefined;
}

interface CommandOptions {
  cwd?: string;
  input?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
  env?: NodeJS.ProcessEnv;
  onLine?: (line: string, stream: "stdout" | "stderr") => void;
  allowedCodes?: number[];
  /**
   * For `git` only. `gitNetwork` sets this so the child receives
   * `GH_TOKEN` and `GITHUB_TOKEN`. Every other git child does not.
   */
  network?: boolean;
  /**
   * Off by default; for the person's test command (server/by-hand-tests.ts),
   * whose processes may outlive it. POSIX only. The command settles when
   * its own process exits, at most `settleAfterExitMs` later for the
   * output still in its pipes (a process it left behind may hold them
   * open; nothing more is read after that), with that process's exit code.
   * After its exit no timeout applies, and a stop only cuts that wait.
   * However it settles, what is left of its process group is ended before
   * the command resolves or rejects: SIGTERM, and SIGKILL 1.5 s after the
   * first SIGTERM, also when every pipe has closed. The spawn observer
   * records the group (`recordGroup`) and hears of its exit only then.
   * Processes that left the group (their own session or group) are not
   * reached. When a signal command() did not send ends its own process,
   * the error's details name it (`details.signal`).
   */
  endGroup?: { settleAfterExitMs: number };
  /** Off by default: the output reaches only `onLine`; the result's stdout and stderr stay empty. */
  discardOutput?: boolean;
}

/** How much of a failed command's stderr its error keeps in `details.stderr`. */
const stderrTailLength = 4000;

/**
 * Arguments are always passed directly to the executable; a shell is never
 * used. A failure rejects with an AppError: a process that could not start
 * keeps the spawn error as `cause`, and one that exited with a code outside
 * `allowedCodes` carries `details.stderr` (the redacted end of its raw
 * stderr) and `details.exitCode`. Known failures of git, gh, codex and
 * claude get a setup code and fixes (cli-errors.ts).
 *
 * Claude and Codex get agentChildEnvironment, so `GH_TOKEN` and
 * `GITHUB_TOKEN` are removed before the process is spawned. `git` gets
 * gitChildEnv (those tokens only when `network` is set, which only
 * gitNetwork does). `gh` gets ghEnvironment, including the tokens. Any
 * other tool keeps this process's environment when no env is passed.
 */
export async function command(
  executable: string,
  args: string[],
  options: CommandOptions = {},
) {
  if (options.signal?.aborted) throw new AppError(cancelled(), 409);
  return await new Promise<{ stdout: string; stderr: string; code: number }>(
    (resolve, reject) => {
      const child = spawn(executable, args, {
        cwd: options.cwd,
        env: childEnvironment(executable, options),
        shell: false,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
      });
      // endGroup needs process groups, which Windows does not have.
      const group =
        process.platform === "win32" ? undefined : options.endGroup;
      const groupGone = group
        ? reportSpawn(child, executable, { recordGroup: true })
        : undefined;
      if (!group) observeChild(child, executable);
      let stdout = "";
      let stderr = "";
      let byteCount = 0;
      let failure: Error | undefined;
      let killTimer: NodeJS.Timeout | undefined;
      // endGroup only: when SIGTERM went to the group, the command's own
      // exit, the wait for the rest of its output, and whether it settled.
      let terminatedAt: number | undefined;
      let exited:
        | { code: number | null; signal: NodeJS.Signals | null }
        | undefined;
      let settleTimer: NodeJS.Timeout | undefined;
      let settled = false;
      const pending = { stdout: "", stderr: "" };
      const kill = (signal: NodeJS.Signals) => {
        try {
          if (child.pid && process.platform !== "win32")
            process.kill(-child.pid, signal);
          else child.kill(signal);
        } catch {
          /* Already exited. */
        }
      };
      const stop = (error: Error) => {
        if (failure) return;
        if (exited) {
          // endGroup: the command's own process has exited, so a stop only
          // cuts the wait for the rest of its output.
          settle(exited.code, exited.signal);
          return;
        }
        failure = error;
        kill("SIGTERM");
        terminatedAt = Date.now();
        killTimer = setTimeout(() => kill("SIGKILL"), 1500);
        killTimer.unref();
      };
      /**
       * endGroup: ends what is left of the group. SIGTERM unless a stop sent
       * it already, SIGKILL 1.5 s after it to what is still there, and a
       * moment for the killed processes to be reaped.
       */
      const endGroup = async () => {
        if (killTimer) clearTimeout(killTimer);
        const pgid = child.pid;
        if (!pgid || !groupAlive(pgid)) return;
        if (terminatedAt === undefined) {
          kill("SIGTERM");
          terminatedAt = Date.now();
        }
        while (groupAlive(pgid) && Date.now() < terminatedAt + 1500)
          await sleep(50);
        if (!groupAlive(pgid)) return;
        kill("SIGKILL");
        const reaped = Date.now() + 1000;
        while (groupAlive(pgid) && Date.now() < reaped) await sleep(20);
      };
      // An abort listener runs in the scope of whoever aborted, so the
      // cancellation is worded in the locale of the work that ran this.
      const locale = currentLocale();
      const abort = () =>
        stop(new AppError(withLocale(locale, cancelled), 409));
      options.signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(
        () =>
          stop(
            new AppError((m) => m.run.command.timedOut({ executable }), 504),
          ),
        options.timeoutMs ?? 60_000,
      );
      const consume = (stream: "stdout" | "stderr", buffer: Buffer) => {
        byteCount += buffer.byteLength;
        if (byteCount > (options.maxBytes ?? 2_000_000)) {
          stop(
            new AppError(
              (m) => m.run.command.outputTooLarge({ executable }),
              422,
            ),
          );
          return;
        }
        const text = buffer.toString("utf8");
        if (!options.discardOutput) {
          if (stream === "stdout") stdout += text;
          else stderr += text;
        }
        if (options.onLine) {
          pending[stream] += text;
          // What is pending holds no newline, so only a chunk with one ends
          // a line; searching a long unfinished line again for every chunk
          // took time quadratic in its length.
          let end: number;
          while (
            text.includes("\n") &&
            (end = pending[stream].indexOf("\n")) >= 0
          ) {
            options.onLine(pending[stream].slice(0, end), stream);
            pending[stream] = pending[stream].slice(end + 1);
          }
        }
      };
      child.stdout.on("data", (buffer: Buffer) => consume("stdout", buffer));
      child.stderr.on("data", (buffer: Buffer) => consume("stderr", buffer));
      child.stdin.on("error", () => {
        /* Process may exit before consuming input. */
      });
      child.on("error", (error) => {
        // One whole sentence; callers that need the reason read cause.code.
        const spawnFailure = new AppError(
          (m) =>
            m.run.command.spawnFailed({
              executable,
              reason: redact(error.message),
            }),
          503,
          { cause: error },
        );
        // A working directory that is gone fails the spawn with ENOENT as
        // well; only an executable that cannot be found is a setup problem.
        failure =
          options.cwd && !existsSync(options.cwd)
            ? spawnFailure
            : (withCliSetupHint(spawnFailure, executable) as Error);
      });
      if (group)
        child.on("exit", (code, signal) => {
          exited = { code, signal };
          clearTimeout(timer);
          settleTimer = setTimeout(
            () => settle(code, signal),
            group.settleAfterExitMs,
          );
        });
      child.on("close", (code, signal) => {
        if (group) {
          settle(exited ? exited.code : code, exited ? exited.signal : signal);
          return;
        }
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        options.signal?.removeEventListener("abort", abort);
        for (const stream of ["stdout", "stderr"] as const) {
          if (pending[stream]) options.onLine?.(pending[stream], stream);
        }
        finish(code);
      });
      /** endGroup: stops reading, ends what is left of the group, then settles. */
      function settle(code: number | null, signal: NodeJS.Signals | null) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(settleTimer);
        options.signal?.removeEventListener("abort", abort);
        for (const stream of ["stdout", "stderr"] as const) {
          if (pending[stream]) options.onLine?.(pending[stream], stream);
          pending[stream] = "";
        }
        // A process left behind may still hold the pipes.
        child.stdout.destroy();
        child.stderr.destroy();
        void endGroup().then(() => {
          groupGone?.();
          finish(code, signal);
        });
      }
      /**
       * `signal` comes only with endGroup: the signal that ended the
       * command's own process, which its error then names in
       * `details.signal` when no stop of command() came first.
       */
      function finish(code: number | null, signal?: NodeJS.Signals | null) {
        if (failure) reject(failure);
        else if (!(options.allowedCodes ?? [0]).includes(code ?? -1)) {
          reject(
            withCliSetupHint(
              new AppError(
                (m) =>
                  m.run.command.failed({
                    executable,
                    output: redact(
                      (stderr || stdout || `exit ${code}`).trim(),
                    ).slice(-1800),
                  }),
                422,
                {
                  details: {
                    stderr: redact(stderr.trim()).slice(-stderrTailLength),
                    ...(code === null ? {} : { exitCode: code }),
                    ...(code === null && signal ? { signal } : {}),
                  },
                },
              ),
              executable,
            ),
          );
        } else resolve({ stdout, stderr, code: code ?? -1 });
      }
      child.stdin.end(options.input ?? "");
    },
  );
}

/**
 * `-c` overrides on every server Git command. Command-line config wins over
 * the repository, the worktree, and includes. `credential.helper=` clears
 * helpers; `gitNetwork` then installs only `gh auth git-credential`.
 * `core.attributesFile` and `GIT_ATTR_NOSYSTEM` turn off the global and
 * system attribute files. In-repo `.gitattributes` still name drivers;
 * `repoDriverOverrides` blanks those drivers' commands.
 */
export const gitSafetyArgs = [
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.quotePath=false",
  "-c",
  "core.attributesFile=/dev/null",
  "-c",
  "core.sshCommand=ssh",
  "-c",
  "core.pager=cat",
  "-c",
  "core.editor=true",
  "-c",
  "core.askPass=",
  "-c",
  "log.showSignature=false",
  "-c",
  "credential.helper=",
  "-c",
  "diff.external=",
  "-c",
  "uploadpack.packObjectsHook=",
  "-c",
  "protocol.ext.allow=never",
];

const hardenedGitConfig = gitSafetyArgs;

/** Commands named by repository config. `git config` does not run them. */
const driverKey =
  /^(?:filter\.[^.]+\.(?:clean|smudge|process)|diff\.(?:external|.+\.(?:textconv|command))|merge\.[^.]+\.driver|alias\.[^.]+|gpg\.(?:.+\.)?program)$/i;

/**
 * `-c` blanks for drivers this repository defines, so a `filter` named by
 * `.gitattributes` has no command left to run. Shell aliases are blanked
 * only when the value starts with `!`.
 */
function repoDriverOverrides(cwd: string, gitDir?: string): string[] {
  if (!existsSync(cwd)) return [];
  let stdout = "";
  try {
    const result = spawnSync(
      "git",
      [
        ...(gitDir ? ["--git-dir", gitDir, "--work-tree", cwd] : []),
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "alias.config=",
        "config",
        "--show-scope",
        "--null",
        "--get-regexp",
        "^(filter|diff|merge|alias|gpg)\\.",
      ],
      {
        cwd,
        encoding: "utf8",
        timeout: 5_000,
        shell: false,
        env: gitChildEnv(undefined, false),
      },
    );
    if (result.status !== 0 || !result.stdout) return [];
    stdout = result.stdout;
  } catch {
    return [];
  }
  const filters = new Set<string>();
  const args: string[] = [];
  const fields = stdout.split("\0");
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const scope = fields[index];
    if (scope !== "local" && scope !== "worktree") continue;
    const field = fields[index + 1];
    const split = field.indexOf("\n");
    if (split <= 0) continue;
    const key = field.slice(0, split);
    const value = field.slice(split + 1);
    if (!driverKey.test(key)) continue;
    if (/^alias\./i.test(key) && !value.startsWith("!")) continue;
    args.push("-c", `${key}=`);
    const filter = /^filter\.([^.]+)\./i.exec(key);
    if (filter) filters.add(filter[1]);
  }
  for (const name of filters) args.push("-c", `filter.${name}.required=false`);
  return args;
}

/**
 * A run or teammate checkout (`<data>/worktrees/<run>` or
 * `<data>/team-worktrees/<run>/<task>`). Its `.git` is a file. The clone's
 * `.git` directory is not one of these paths.
 */
function runCheckout(cwd: string) {
  const parts = path.resolve(cwd).split(path.sep);
  const at = parts.lastIndexOf("worktrees");
  if (at > 0 && at === parts.length - 2) return true;
  const team = parts.lastIndexOf("team-worktrees");
  return team > 0 && team === parts.length - 3;
}

/** Git directory recorded for a checkout path. The checkout's `.git` file is not read. */
const checkoutGitDirs = new Map<string, string>();

export function rememberCheckout(worktreePath: string, gitDir: string) {
  checkoutGitDirs.set(path.resolve(worktreePath), path.resolve(gitDir));
}

export function recordedGitDir(worktreePath: string): string | undefined {
  return checkoutGitDirs.get(path.resolve(worktreePath));
}

/**
 * Admin directory of a linked worktree, found from the clone's git directory
 * by the worktree path. Does not read the checkout's `.git` file.
 */
export async function locateWorktreeGitDir(
  commonGit: string,
  worktreePath: string,
): Promise<string | undefined> {
  const root = path.join(commonGit, "worktrees");
  const names = await readdir(root).catch(() => [] as string[]);
  const want = path.resolve(worktreePath);
  const wantGit = path.join(want, ".git");
  for (const name of names) {
    const admin = path.join(root, name);
    const text = (await readFile(path.join(admin, "gitdir"), "utf8").catch(() => "")).trim();
    if (!text) continue;
    const linked = path.resolve(admin, text);
    if (linked === wantGit || path.dirname(linked) === want)
      return realpath(admin).catch(() => admin);
  }
  return undefined;
}

/**
 * Loads git directories BELL stored on runs and teammate tasks. A run saved
 * before that field existed is filled from its repository's git directory.
 */
export async function bindStoredGitDirs(
  repos: readonly { id: string; path: string }[],
  runs: readonly {
    repoId: string;
    worktreePath?: string;
    gitDir?: string;
    team?: {
      tasks: {
        worktreePath?: string;
        worktreeRemoved?: boolean;
        gitDir?: string;
      }[];
    };
  }[],
) {
  const bind = async (
    repoPath: string | undefined,
    worktreePath: string | undefined,
    gitDir: string | undefined,
    save: (gitDir: string) => void,
  ) => {
    if (!worktreePath) return;
    if (gitDir) {
      rememberCheckout(worktreePath, gitDir);
      return;
    }
    if (!repoPath) return;
    const dot = path.join(repoPath, ".git");
    const metadata = await lstat(dot).catch(() => undefined);
    if (!metadata?.isDirectory()) return;
    const found = await locateWorktreeGitDir(dot, worktreePath);
    if (!found) return;
    save(found);
    rememberCheckout(worktreePath, found);
  };
  for (const run of runs) {
    const repoPath = repos.find((repo) => repo.id === run.repoId)?.path;
    await bind(repoPath, run.worktreePath, run.gitDir, (gitDir) => {
      run.gitDir = gitDir;
    });
    for (const task of run.team?.tasks ?? []) {
      if (task.worktreeRemoved) continue;
      await bind(repoPath, task.worktreePath, task.gitDir, (gitDir) => {
        task.gitDir = gitDir;
      });
    }
  }
}

/** Path argument of `worktree add`, when this command is one. */
function worktreeAddPath(args: string[]): string | undefined {
  const at = args.indexOf("worktree");
  if (at < 0 || args[at + 1] !== "add") return undefined;
  const valued = new Set(["-b", "-B", "--reason"]);
  for (let index = at + 2; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--") return args[index + 1];
    if (valued.has(arg)) {
      index++;
      continue;
    }
    if (arg.startsWith("-")) continue;
    return arg;
  }
  return undefined;
}

/** Common git directory of the repository `git()` just used. */
async function commonGitDirectory(cwd: string, gitDir?: string): Promise<string | undefined> {
  if (gitDir) {
    const relative = (await readFile(path.join(gitDir, "commondir"), "utf8").catch(() => "")).trim();
    if (relative) return path.resolve(gitDir, relative);
    return undefined;
  }
  const dot = path.join(cwd, ".git");
  const metadata = await lstat(dot).catch(() => undefined);
  if (metadata?.isDirectory()) return dot;
  return undefined;
}

async function rememberNewWorktree(cwd: string, gitDir: string | undefined, args: string[]) {
  const added = worktreeAddPath(args);
  if (!added) return;
  const common = await commonGitDirectory(cwd, gitDir);
  if (!common) return;
  const admin = await locateWorktreeGitDir(common, path.resolve(cwd, added));
  if (admin) rememberCheckout(path.resolve(cwd, added), admin);
}

/**
 * Recorded git directory of a run checkout (`<data>/worktrees/<run>` or
 * `<data>/team-worktrees/<run>/<task>`). A checkout of that shape with no
 * record is refused. Anything else is left for Git to find. The checkout's
 * `.git` file is not read.
 */
export async function runCheckoutGitDir(cwd: string): Promise<string | undefined> {
  const recorded = recordedGitDir(cwd);
  if (recorded) return recorded;
  if (!runCheckout(cwd)) return undefined;
  throw new AppError((m) => m.security.worktreeForged, 409);
}

const gitEnvKeys = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "SSH_AUTH_SOCK",
  "GIT_EXEC_PATH",
  "GIT_CONFIG_GLOBAL",
  "GIT_TEMPLATE_DIR",
  "GNUPGHOME",
  "XDG_CONFIG_HOME",
  "XDG_RUNTIME_DIR",
];

const gitIdentityKeys = [
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_AUTHOR_DATE",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
  "GIT_COMMITTER_DATE",
  "EMAIL",
];

/** Proxy and CA settings a fetch or push needs. Not copied for local git. */
const gitNetworkEnvKeys = [
  "http_proxy",
  "https_proxy",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "all_proxy",
  "NO_PROXY",
  "no_proxy",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "GIT_SSL_CAINFO",
  "GIT_SSL_CAPATH",
  "CURL_CA_BUNDLE",
  "GH_CONFIG_DIR",
  "GH_HOST",
  "GH_ENTERPRISE_TOKEN",
];

/**
 * Environment for a server Git process. Not the server's full environment.
 * `GH_TOKEN` and `GITHUB_TOKEN` are included only for `gitNetwork`, whose
 * credential helper is `gh auth git-credential`. `GIT_ASKPASS` and
 * `SSH_ASKPASS` are not passed: `core.askPass` is cleared and prompts are off.
 */
export function gitChildEnv(
  explicit: NodeJS.ProcessEnv | undefined,
  network: boolean,
): NodeJS.ProcessEnv {
  const source = explicit ?? process.env;
  const env: NodeJS.ProcessEnv = {
    GIT_ATTR_NOSYSTEM: "1",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_PAGER: "cat",
    GH_PROMPT_DISABLED: "1",
    NO_COLOR: "1",
  };
  for (const key of [...gitEnvKeys, ...gitIdentityKeys]) {
    const value = source[key] ?? process.env[key];
    if (value) env[key] = value;
  }
  if (source.GIT_INDEX_FILE) env.GIT_INDEX_FILE = source.GIT_INDEX_FILE;
  if (network) {
    env.GCM_INTERACTIVE = "never";
    for (const key of gitNetworkEnvKeys) {
      const value = source[key] ?? process.env[key];
      if (value) env[key] = value;
    }
    // The gh credential helper is a child of this git process, so it sees
    // this environment. Tokens come from the server, not from `explicit`.
    if (process.env.GH_TOKEN) env.GH_TOKEN = process.env.GH_TOKEN;
    if (process.env.GITHUB_TOKEN) env.GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  }
  return env;
}

/** Environment for a server `gh` process, including the GitHub tokens. */
export function ghEnvironment(explicit?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return gitChildEnv(explicit, true);
}

/** Basename of an executable, without a Windows extension. */
function toolBase(executable: string) {
  return executable.split(/[/\\]/).pop()?.toLowerCase().replace(/\.(?:exe|cmd)$/i, "");
}

/**
 * Environment of one child. Agents lose the GitHub tokens. git and gh get
 * an allowlist. Anything else keeps an explicit env, or this process's
 * environment when the caller passed none.
 */
function childEnvironment(executable: string, options: CommandOptions): NodeJS.ProcessEnv {
  const provider = agentProviderOf(executable);
  if (provider) return agentChildEnvironment(provider, options.env);
  const base = toolBase(executable);
  if (base === "git") return gitChildEnv(options.env, options.network === true);
  if (base === "gh") return ghEnvironment(options.env);
  return (
    options.env ?? {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GH_PROMPT_DISABLED: "1",
      NO_COLOR: "1",
    }
  );
}

/** First non-option word, skipping values that belong to `-c`. */
function commandName(args: string[]): string | undefined {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "-c" || arg === "--config-env") {
      index++;
      continue;
    }
    if (arg === "--") return args[index + 1];
    if (arg.startsWith("-")) continue;
    return arg;
  }
  return undefined;
}

/** External diff drivers and textconv do not run for diff, show, and log. */
function withDiffSafety(args: string[]): string[] {
  const name = commandName(args);
  if (!name || !["diff", "show", "log"].includes(name)) return args;
  const at = args.indexOf(name);
  return [...args.slice(0, at + 1), "--no-textconv", "--no-ext-diff", ...args.slice(at + 1)];
}

/** Argv for one server git command: pinned git dir, static `-c`, local driver blanks. */
export async function serverGitArgs(cwd: string, args: string[]): Promise<string[]> {
  const gitDir = await runCheckoutGitDir(cwd);
  return [
    ...(gitDir ? ["--git-dir", gitDir, "--work-tree", cwd] : []),
    "--no-pager",
    ...hardenedGitConfig,
    ...repoDriverOverrides(cwd, gitDir),
    ...withDiffSafety(args),
  ];
}

export async function git(
  cwd: string,
  args: string[],
  options: Omit<CommandOptions, "cwd"> = {},
) {
  const gitDir = recordedGitDir(cwd);
  const result = await command("git", await serverGitArgs(cwd, args), {
    ...options,
    cwd,
    network: options.network === true,
  });
  await rememberNewWorktree(cwd, gitDir, args);
  return result;
}

/**
 * Options for every fetch, ls-remote, clone and push to GitHub: credentials
 * come from gh alone, only HTTPS and SSH transports are allowed (SSH for a
 * person whose Git rewrites GitHub URLs to it), and submodules are never
 * followed.
 */
export const gitNetworkConfig = [
  "-c",
  "credential.helper=",
  "-c",
  "credential.helper=!gh auth git-credential",
  "-c",
  "protocol.allow=never",
  "-c",
  "protocol.https.allow=always",
  "-c",
  "protocol.ssh.allow=always",
  "-c",
  "protocol.file.allow=never",
  "-c",
  "protocol.ext.allow=never",
  "-c",
  "submodule.recurse=false",
];

/**
 * A Git command that talks to GitHub: the hardened settings of git(), the
 * network options above, and an environment that never prompts for a
 * password. This is the only git path that receives `GH_TOKEN` and
 * `GITHUB_TOKEN`, because its credential helper is `gh auth git-credential`.
 */
export async function gitNetwork(
  cwd: string,
  args: string[],
  options: Omit<CommandOptions, "cwd"> = {},
) {
  return git(cwd, [...gitNetworkConfig, ...args], {
    ...options,
    network: true,
  });
}

/**
 * Repository settings that can make Git run a command or send credentials
 * or pushes somewhere else (`url.<base>.insteadOf` rewrites GitHub URLs),
 * and that git() does not already override: its `-c` settings win over the
 * repository's own hooks path, file monitor, pager, editor, password
 * prompt and SSH command, so a checkout may set those (husky writes
 * `core.hooksPath`). `git config --get-regexp` matches lower-cased section
 * and key names, so the pattern is lower case; subsection names keep their
 * case.
 */
const unsafeConfigPattern =
  "^(filter|diff|merge)\\.|^core\\.alternaterefscommand|^credential\\.|^protocol\\.|^include(if)?\\.|^url\\.|^gpg\\.";

/**
 * Of the keys the pattern lists, the ones that really name a program or
 * redirect configuration. Plain diff, merge and signing preferences such as
 * `diff.renames`, `merge.conflictStyle` or `gpg.format` cannot run anything.
 */
function unsafeConfigKey(key: string) {
  if (/^(?:filter|credential|protocol|include|includeif|url)\./.test(key))
    return true;
  if (key === "core.alternaterefscommand") return true;
  if (/^gpg\.(?:.+\.)?program$/.test(key)) return true;
  if (key === "gpg.ssh.defaultkeycommand") return true;
  if (key === "diff.external") return true;
  if (/^diff\..+\.(?:command|textconv)$/.test(key)) return true;
  return /^merge\..+\.driver$/.test(key);
}

/**
 * Refuses a repository whose own configuration (`.git/config`, and the
 * worktree's `config.worktree` when enabled) defines filters, diff or merge
 * drivers, an alternate-refs command, signing programs, credential
 * helpers, protocol rules, URL rewrites or includes. BELL's own clones
 * never have them, so finding one means the repository was changed by
 * hand or by an agent; nothing more runs in it. The person's global and
 * system configuration are theirs and are not checked.
 */
export async function assertGitConfigSafe(directory: string) {
  const { stdout, code } = await git(
    directory,
    ["config", "--show-scope", "--null", "--get-regexp", unsafeConfigPattern],
    { allowedCodes: [0, 1] },
  );
  if (code !== 0) return;
  // Each entry is "<scope>\0<key>\n<value>\0".
  const fields = stdout.split("\0");
  const found = new Set<string>();
  for (let at = 0; at + 1 < fields.length; at += 2) {
    const key = fields[at + 1].split("\n", 1)[0];
    if (["local", "worktree"].includes(fields[at]) && unsafeConfigKey(key))
      found.add(key);
  }
  const keys = [...found];
  if (!keys.length) return;
  throw new AppError(
    (m) => m.security.gitConfigUnsafe({ keys: keys.slice(0, 5) }),
    409,
    { code: "git_config_unsafe", params: { keys: keys.slice(0, 5).join(", ") } },
  );
}
