import { spawn, type ChildProcess } from "node:child_process";
import { log } from "./log.js";
import { redact } from "./secrets.js";
import { AppError } from "./types.js";
import { cancelled, currentLocale, withLocale } from "./i18n/index.js";

export { redact };

/**
 * Told about every child process BELL PR starts, for example to record
 * agent process groups and reap leftovers after a crash.
 */
export interface SpawnObserver {
  onSpawn(pid: number, executable: string): void;
  onExit(pid: number): void;
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
  const observer = spawnObserver;
  const pid = child.pid;
  if (!observer || pid === undefined) return;
  const notify = (event: string, call: () => void) => {
    try {
      call();
    } catch (error) {
      log.warn("Spawn observer failed", { event, executable, pid, error });
    }
  };
  notify("spawn", () => observer.onSpawn(pid, executable));
  child.once("close", () => notify("exit", () => observer.onExit(pid)));
}

/** ANTHROPIC_API_KEY is deliberately excluded so Claude Code uses the signed-in subscription, not API billing. */
export function agentEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "CODEX_HOME",
    "OPENAI_API_KEY",
    "CODEX_API_KEY",
    "CLAUDE_CONFIG_DIR",
    "CLAUDE_CODE_OAUTH_TOKEN",
  ]) {
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
}

/** Arguments are always passed directly to the executable; a shell is never used. */
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
      observeChild(child, executable);
      let stdout = "";
      let stderr = "";
      let byteCount = 0;
      let failure: Error | undefined;
      let killTimer: NodeJS.Timeout | undefined;
      const pending = { stdout: "", stderr: "" };
      const stop = (error: Error) => {
        if (failure) return;
        failure = error;
        const kill = (signal: NodeJS.Signals) => {
          try {
            if (child.pid && process.platform !== "win32")
              process.kill(-child.pid, signal);
            else child.kill(signal);
          } catch {
            /* Already exited. */
          }
        };
        kill("SIGTERM");
        killTimer = setTimeout(() => kill("SIGKILL"), 1500);
        killTimer.unref();
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
        if (stream === "stdout") stdout += text;
        else stderr += text;
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
        failure = new AppError(
          (m) =>
            m.run.command.spawnFailed({
              executable,
              reason: redact(error.message),
            }),
          503,
          { cause: error },
        );
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        options.signal?.removeEventListener("abort", abort);
        for (const stream of ["stdout", "stderr"] as const) {
          if (pending[stream]) options.onLine?.(pending[stream], stream);
        }
        if (failure) reject(failure);
        else if (!(options.allowedCodes ?? [0]).includes(code ?? -1)) {
          reject(
            new AppError(
              (m) =>
                m.run.command.failed({
                  executable,
                  output: redact(
                    (stderr || stdout || `exit ${code}`).trim(),
                  ).slice(-1800),
                }),
              422,
            ),
          );
        } else resolve({ stdout, stderr, code: code ?? -1 });
      });
      child.stdin.end(options.input ?? "");
    },
  );
}

export async function git(
  cwd: string,
  args: string[],
  options: Omit<CommandOptions, "cwd"> = {},
) {
  return command(
    "git",
    [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.quotePath=false",
      ...args,
    ],
    { ...options, cwd },
  );
}
