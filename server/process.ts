import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
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
  return { ...env, NO_COLOR: "1", GIT_TERMINAL_PROMPT: "0" };
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
        env: options.env ?? {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GH_PROMPT_DISABLED: "1",
          NO_COLOR: "1",
        },
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
          let end: number;
          while ((end = pending[stream].indexOf("\n")) >= 0) {
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
 * Settings every Git command runs with, ahead of the repository's own
 * configuration: no hooks, no file monitor, no global attributes file, and
 * no pager, editor, password prompt or SSH command taken from the
 * repository. Filters, diff and merge drivers can only come from
 * configuration, and assertGitConfigSafe refuses a repository that sets
 * them.
 */
const hardenedGitConfig = [
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
];

export async function git(
  cwd: string,
  args: string[],
  options: Omit<CommandOptions, "cwd"> = {},
) {
  return command("git", [...hardenedGitConfig, ...args], { ...options, cwd });
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
 * password, whatever the caller passes.
 */
export async function gitNetwork(
  cwd: string,
  args: string[],
  options: Omit<CommandOptions, "cwd"> = {},
) {
  return git(cwd, [...gitNetworkConfig, ...args], {
    ...options,
    env: {
      ...(options.env ?? process.env),
      GIT_TERMINAL_PROMPT: "0",
      GCM_INTERACTIVE: "never",
      GH_PROMPT_DISABLED: "1",
      NO_COLOR: "1",
    },
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
  "^(filter|diff|merge)\\.|^core\\.alternaterefscommand|^credential\\.|^protocol\\.|^include(if)?\\.|^url\\.";

/**
 * Of the keys the pattern lists, the ones that really name a program or
 * redirect configuration. Plain diff and merge preferences such as
 * `diff.renames` or `merge.conflictStyle` cannot run anything.
 */
function unsafeConfigKey(key: string) {
  if (/^(?:filter|credential|protocol|include|includeif|url)\./.test(key))
    return true;
  if (key === "core.alternaterefscommand") return true;
  if (key === "diff.external") return true;
  if (/^diff\..+\.(?:command|textconv)$/.test(key)) return true;
  return /^merge\..+\.driver$/.test(key);
}

/**
 * Refuses a repository whose own configuration (`.git/config`, and the
 * worktree's `config.worktree` when enabled) defines filters, diff or merge
 * drivers, an alternate-refs command, credential helpers, protocol rules,
 * URL rewrites or includes. BELL's own clones never have them, so finding
 * one means the repository was changed by hand or by an agent; nothing
 * more runs in it. The person's global and system configuration are theirs
 * and are not checked.
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
