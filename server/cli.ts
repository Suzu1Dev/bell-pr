/**
 * The `bell-pr` / `bellpr` command: start (the default), open, doctor,
 * license, version and help. bin/bellpr.mjs loads the bundle of this file
 * (build/cli.mjs) and calls `run`.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs, type ParseArgsConfig } from "node:util";
import { buildDate, version } from "./build-info.js";
import {
  ConfigError,
  dataPaths,
  envFlag,
  resolveConfig,
  resolveDataDir,
} from "./config.js";
import { runDoctorCli } from "./doctor.js";
import { sm } from "./i18n/index.js";
import {
  isEntryPoint,
  probeHealth,
  processAlive,
  readLock,
  startServer,
  StartupError,
  type RunningServer,
  type StartServerOptions,
} from "./index.js";
import { runLicenseCli } from "./license.js";
import { redact } from "./process.js";

interface Output {
  write(text: string): unknown;
  isTTY?: boolean;
}

/** What the commands use from the outside world; tests replace parts. */
export interface CliDeps {
  env?: NodeJS.ProcessEnv;
  stdout?: Output;
  stderr?: Output;
  platform?: NodeJS.Platform;
  /** Opens a URL in the default browser. */
  openUrl?: (url: string) => void;
  /** Sends a signal to a process (`process.kill`). */
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  /** Passed to startServer by `start`. */
  startOptions?: Partial<StartServerOptions>;
  /** Called with the running server after `start`. */
  onStarted?: (server: RunningServer) => void;
  /** How long `open` waits for the link (5 s). */
  openTimeoutMs?: number;
}

/** A command-line mistake: the message, then exit code 2. */
class UsageError extends Error {}

/** Options every command accepts. */
const commonOptions = {
  "data-dir": { type: "string" },
  "env-file": { type: "string" },
} satisfies ParseArgsConfig["options"];

function parse<T extends ParseArgsConfig["options"]>(args: string[], options: T) {
  try {
    return parseArgs({ args, options, strict: true, allowPositionals: false });
  } catch (error) {
    throw new UsageError(
      sm().cli.invalidArguments({
        reason: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

/** Splits the common options off arguments that another parser reads. */
function splitCommonOptions(args: string[]) {
  const { values, tokens } = parseArgs({
    args,
    options: commonOptions,
    strict: false,
    allowPositionals: true,
    tokens: true,
  });
  const used = new Set<number>();
  for (const token of tokens ?? [])
    if (token.kind === "option" && token.name in commonOptions) {
      used.add(token.index);
      if (token.inlineValue === false) used.add(token.index + 1);
    }
  return {
    values: values as { "data-dir"?: string; "env-file"?: string },
    rest: args.filter((_arg, index) => !used.has(index)),
  };
}

function loadEnvFile(file: string | undefined) {
  if (!file) return;
  try {
    process.loadEnvFile(file);
  } catch (error) {
    throw new UsageError(
      sm().cli.envFileFailed({
        path: file,
        reason: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

/**
 * Whether opening a browser makes sense here: not when BELLPR_NO_OPEN or CI
 * is set, output is not a terminal, or in a container.
 */
export function canOpenBrowser(env: NodeJS.ProcessEnv, stdout: Output) {
  return (
    !envFlag(env.BELLPR_NO_OPEN) &&
    !envFlag(env.CI) &&
    Boolean(stdout.isTTY) &&
    !existsSync("/.dockerenv") &&
    !existsSync("/run/.containerenv")
  );
}

/** Opens `url` with open, xdg-open or `cmd /c start`; never throws. */
export function openInBrowser(url: string, platform = process.platform) {
  const [command, args] =
    platform === "darwin"
      ? ["open", [url]]
      : platform === "win32"
        ? ["cmd", ["/c", "start", '""', url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    // ENOENT: no opener installed. The link is printed anyway.
    child.on("error", () => {});
    child.unref();
  } catch {
    // Same: the person can open the printed link.
  }
}

interface Context {
  env: NodeJS.ProcessEnv;
  stdout: Output;
  stderr: Output;
  platform: NodeJS.Platform;
  openUrl: (url: string) => void;
  deps: CliDeps;
}

async function start(args: string[], ctx: Context): Promise<number | undefined> {
  const { values } = parse(args, {
    ...commonOptions,
    port: { type: "string" },
    host: { type: "string" },
    "no-open": { type: "boolean" },
    dev: { type: "boolean" },
  });
  loadEnvFile(values["env-file"]);
  const config = resolveConfig(
    {
      port: values.port,
      host: values.host,
      dataDir: values["data-dir"],
      dev: values.dev,
      open: values["no-open"] ? false : undefined,
    },
    ctx.env,
  );
  const running = await startServer({
    config,
    print: (line) => ctx.stdout.write(`${line}\n`),
    ...(canOpenBrowser(ctx.env, ctx.stdout) ? { openBrowser: ctx.openUrl } : {}),
    ...ctx.deps.startOptions,
  });
  ctx.deps.onStarted?.(running);
  // The server keeps the process alive; there is no exit code yet.
  return undefined;
}

type OpenLink = { url: string; expiresAt?: string } | { error: string };

/** Reads and deletes the link file once it appears; undefined on timeout. */
async function takeOpenLink(file: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const link = JSON.parse(readFileSync(file, "utf8")) as OpenLink;
      // The link signs a browser in: it does not stay on disk.
      rmSync(file, { force: true });
      return link;
    } catch {
      // Not written yet.
    }
    if (Date.now() >= deadline) return undefined;
    await sleep(50);
  }
}

async function open(args: string[], ctx: Context): Promise<number> {
  const { values } = parse(args, {
    ...commonOptions,
    print: { type: "boolean" },
    "no-open": { type: "boolean" },
  });
  loadEnvFile(values["env-file"]);
  const m = sm().cli.open;
  if (ctx.platform === "win32") {
    ctx.stderr.write(`${m.windows}\n`);
    return 1;
  }
  const dataDir = resolveDataDir({ dataDir: values["data-dir"] }, ctx.env);
  const lock = readLock(dataDir);
  // Only a live BELL PR gets the signal: SIGUSR2 ends other programs.
  if (
    !lock ||
    !processAlive(lock.pid) ||
    !(await probeHealth(lock.host ?? "127.0.0.1", lock.port))
  ) {
    ctx.stderr.write(`${m.notRunning}\n`);
    return 1;
  }
  const { openLink } = dataPaths(dataDir);
  rmSync(openLink, { force: true });
  try {
    (ctx.deps.kill ?? process.kill)(lock.pid, "SIGUSR2");
  } catch (error) {
    ctx.stderr.write(
      `${m.signalFailed({ reason: error instanceof Error ? error.message : String(error) })}\n`,
    );
    return 1;
  }
  const link = await takeOpenLink(openLink, ctx.deps.openTimeoutMs ?? 5000);
  if (!link) {
    ctx.stderr.write(`${m.noAnswer}\n`);
    return 1;
  }
  if (!("url" in link) || typeof link.url !== "string") {
    ctx.stderr.write(`${m.unavailable}\n`);
    return 1;
  }
  ctx.stdout.write(`${link.url}\n`);
  if (link.expiresAt) ctx.stderr.write(`${m.linkHint}\n`);
  if (!values.print && !values["no-open"] && canOpenBrowser(ctx.env, ctx.stdout))
    ctx.openUrl(link.url);
  return 0;
}

function printVersion(args: string[], ctx: Context): number {
  const { values } = parse(args, commonOptions);
  loadEnvFile(values["env-file"]);
  const m = sm().cli.version;
  ctx.stdout.write(
    [
      m.app({ version, buildDate }),
      m.runtime({
        node: process.version,
        platform: process.platform,
        arch: process.arch,
      }),
      m.dataDir({
        path: resolveDataDir({ dataDir: values["data-dir"] }, ctx.env),
      }),
    ].join("\n") + "\n",
  );
  return 0;
}

/** doctor and license read their own arguments; --data-dir is shared. */
async function delegate(
  command: "doctor" | "license",
  args: string[],
  ctx: Context,
): Promise<number> {
  const { values, rest } = splitCommonOptions(args);
  loadEnvFile(values["env-file"]);
  const deps = {
    dataDir: resolveDataDir({ dataDir: values["data-dir"] }, ctx.env),
    stdout: ctx.stdout,
  };
  return command === "doctor"
    ? runDoctorCli(rest, deps)
    : runLicenseCli(rest, deps);
}

/**
 * Runs one command. Resolves with the exit code, or with undefined once
 * `start` serves requests (the process then runs until it is stopped).
 */
export async function main(
  argv: string[],
  deps: CliDeps = {},
): Promise<number | undefined> {
  const ctx: Context = {
    env: deps.env ?? process.env,
    stdout: deps.stdout ?? process.stdout,
    stderr: deps.stderr ?? process.stderr,
    platform: deps.platform ?? process.platform,
    openUrl: deps.openUrl ?? ((url) => openInBrowser(url)),
    deps,
  };
  const [first, ...rest] = argv;
  try {
    switch (first) {
      case undefined:
        return await start([], ctx);
      case "start":
        return await start(rest, ctx);
      case "open":
        return await open(rest, ctx);
      case "doctor":
      case "license":
        return await delegate(first, rest, ctx);
      case "version":
      case "--version":
      case "-v":
        return printVersion(rest, ctx);
      case "help":
      case "--help":
      case "-h":
        ctx.stdout.write(`${sm().cli.help({ version })}\n`);
        return 0;
      default:
        // `bell-pr --port 4400` starts with options.
        if (first.startsWith("-")) return await start(argv, ctx);
        ctx.stderr.write(`${sm().cli.unknownCommand({ command: first })}\n`);
        return 2;
    }
  } catch (error) {
    if (error instanceof UsageError) {
      ctx.stderr.write(`${error.message}\n`);
      return 2;
    }
    if (error instanceof ConfigError || error instanceof StartupError) {
      ctx.stderr.write(`${error.message}\n`);
      return error instanceof StartupError ? error.exitCode : 1;
    }
    // A system error (EACCES, ENOSPC...) says enough; anything else is a
    // bug, and the stack helps to report it.
    const systemError =
      error instanceof Error && typeof (error as NodeJS.ErrnoException).code === "string";
    ctx.stderr.write(
      `${sm().cli.start.failed({
        reason: redact(
          error instanceof Error
            ? systemError
              ? error.message
              : (error.stack ?? error.message)
            : String(error),
        ),
      })}\n`,
    );
    return 1;
  }
}

/** Runs `main` for this process and sets its exit code. */
export function run(argv = process.argv.slice(2)): void {
  void main(argv).then((code) => {
    if (code === undefined) return;
    process.exitCode = code;
    // Let output drain, but never hang on a handle left open.
    setTimeout(() => process.exit(code), 1000).unref();
  });
}

if (isEntryPoint(import.meta.url)) run();
