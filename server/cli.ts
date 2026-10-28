/**
 * The `bell-pr` / `bellpr` command: start (the default), open, doctor,
 * version and help. bin/bellpr.mjs loads the bundle of this file
 * (build/cli.mjs) and calls `run`.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { parseArgs, type ParseArgsConfig } from "node:util";
import { readApiToken, rotateApiToken, withApiToken } from "./api-token.js";
import { buildDate, version } from "./build-info.js";
import {
  browserHost,
  ConfigError,
  dataPaths,
  envFlag,
  resolveConfig,
  resolveDataDir,
  resolvePort,
} from "./config.js";
import { runDoctorCli } from "./doctor.js";
import { sm } from "./i18n/index.js";
import {
  isEntryPoint,
  lockHolderRunning,
  probeHealth,
  readLock,
  startServer,
  StartupError,
  type LockInfo,
  type RunningServer,
  type StartServerOptions,
} from "./index.js";
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
  /** Passed to startServer by `start`. */
  startOptions?: Partial<StartServerOptions>;
  /** Called with the running server after `start`. */
  onStarted?: (server: RunningServer) => void;
}

/** A command-line mistake: the message, then exit code 2. */
class UsageError extends Error {}

/** Options every command accepts. */
const commonOptions = {
  "data-dir": { type: "string" },
  "env-file": { type: "string" },
} satisfies ParseArgsConfig["options"];

/**
 * What is wrong with `args` for a command taking `options`, in the CLI's
 * own words; undefined when the parser's message has to do.
 */
function argumentProblem(
  args: string[],
  options: NonNullable<ParseArgsConfig["options"]>,
): string | undefined {
  const m = sm().cli.arguments;
  const { tokens } = parseArgs({
    args,
    options,
    strict: false,
    allowPositionals: true,
    tokens: true,
  });
  for (const token of tokens ?? []) {
    if (token.kind === "positional")
      return m.unexpected({ value: token.value });
    if (token.kind !== "option") continue;
    const option = Object.hasOwn(options, token.name)
      ? options[token.name]
      : undefined;
    if (!option) return m.unknownOption({ option: token.rawName });
    if (option.type === "string" && token.value === undefined)
      return m.missingValue({ option: token.rawName });
    if (option.type === "boolean" && token.inlineValue)
      return m.noValue({ option: token.rawName });
  }
  return undefined;
}

function parse<T extends ParseArgsConfig["options"]>(args: string[], options: T) {
  try {
    return parseArgs({ args, options, strict: true, allowPositionals: false });
  } catch (error) {
    let reason: string | undefined;
    try {
      reason = argumentProblem(args, options ?? {});
    } catch {
      // The parser's own message below.
    }
    throw new UsageError(
      sm().cli.invalidArguments({
        reason: reason ?? (error instanceof Error ? error.message : String(error)),
      }),
    );
  }
}

/** -h or --help anywhere before a `--`: the command shows the help. */
function wantsHelp(args: string[]) {
  const end = args.indexOf("--");
  return (end < 0 ? args : args.slice(0, end)).some(
    (arg) => arg === "--help" || arg === "-h",
  );
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
      if (token.value === undefined)
        throw new UsageError(
          sm().cli.invalidArguments({
            reason: sm().cli.arguments.missingValue({ option: token.rawName }),
          }),
        );
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

/**
 * The address the running instance serves: the base URL it wrote to its lock,
 * which names BELLPR_PUBLIC_URL when there is one. A lock from an older build,
 * or one without a web address, falls back to the local address.
 */
function lockUrl(lock: LockInfo) {
  try {
    const url = new URL(lock.url ?? "");
    if (url.protocol === "http:" || url.protocol === "https:") return url.origin;
  } catch {
    // Not an address: use the local one.
  }
  return `http://${browserHost(lock.host ?? "127.0.0.1")}:${lock.port}`;
}

async function open(args: string[], ctx: Context): Promise<number> {
  const { values } = parse(args, {
    ...commonOptions,
    print: { type: "boolean" },
    "no-open": { type: "boolean" },
  });
  loadEnvFile(values["env-file"]);
  const m = sm().cli.open;
  const dataDir = resolveDataDir({ dataDir: values["data-dir"] }, ctx.env);
  const lock = readLock(dataDir);
  if (
    !lock ||
    !lockHolderRunning(dataDir, lock) ||
    !(await probeHealth(lock.host ?? "127.0.0.1", lock.port))
  ) {
    ctx.stderr.write(`${m.notRunning({ dataDir })}\n`);
    return 1;
  }
  const url = withApiToken(lockUrl(lock), readApiToken(dataPaths(dataDir).apiToken));
  ctx.stdout.write(`${url}\n`);
  if (!values.print && !values["no-open"] && canOpenBrowser(ctx.env, ctx.stdout))
    ctx.openUrl(url);
  return 0;
}

/** `bell-pr token rotate` replaces the token file. The new token is not printed. */
async function rotateToken(args: string[], ctx: Context): Promise<number> {
  const [sub, ...rest] = args;
  if (sub !== "rotate")
    throw new UsageError(sm().cli.token.usage);
  const { values } = parse(rest, commonOptions);
  loadEnvFile(values["env-file"]);
  const file = dataPaths(resolveDataDir({ dataDir: values["data-dir"] }, ctx.env)).apiToken;
  await rotateApiToken(file);
  ctx.stdout.write(`${sm().cli.token.rotated({ path: file })}\n`);
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

/**
 * The port `bell-pr doctor` reports: that of the BELL PR running on
 * `dataDir`, which may have been started with --port, else the one a start
 * would take from the environment (BELLPR_PORT, else 4311).
 */
async function doctorPort(dataDir: string, env: NodeJS.ProcessEnv) {
  const lock = readLock(dataDir);
  if (
    lock &&
    lockHolderRunning(dataDir, lock) &&
    (await probeHealth(lock.host ?? "127.0.0.1", lock.port))
  )
    return lock.port;
  try {
    return resolvePort(undefined, env);
  } catch {
    // An invalid BELLPR_PORT: the doctor reports no port.
    return undefined;
  }
}

/** doctor reads its own arguments; --data-dir is shared. */
async function doctor(args: string[], ctx: Context): Promise<number> {
  const { values, rest } = splitCommonOptions(args);
  loadEnvFile(values["env-file"]);
  const deps = {
    dataDir: resolveDataDir({ dataDir: values["data-dir"] }, ctx.env),
    stdout: ctx.stdout,
  };
  return runDoctorCli(rest, { ...deps, port: await doctorPort(deps.dataDir, ctx.env) });
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
  const help = () => {
    ctx.stdout.write(`${sm().cli.help({ version })}\n`);
    return 0;
  };
  try {
    // `bell-pr start --help` and the like show the help instead of failing.
    if (
      ["start", "open", "token", "version", "--version", "-v"].includes(first) ||
      first?.startsWith("-")
    )
      if (wantsHelp(argv)) return help();
    switch (first) {
      case undefined:
        return await start([], ctx);
      case "start":
        return await start(rest, ctx);
      case "open":
        return await open(rest, ctx);
      case "token":
        return await rotateToken(rest, ctx);
      case "doctor":
        return await doctor(rest, ctx);
      case "version":
      case "--version":
      case "-v":
        return printVersion(rest, ctx);
      case "help":
      case "--help":
      case "-h":
        return help();
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
