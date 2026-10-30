/**
 * The BELL PR server process: `startServer` binds the port, takes the data
 * directory lock, stops agents a crash left behind, loads the store and
 * serves the app.
 *
 * Run directly (`tsx server/index.ts`, as `npm run dev:server` does), this
 * module behaves like `bell-pr start` with the given flags.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeSync,
} from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Express } from "express";
import { product } from "../shared/product.js";
import { AgentRegistry, reapOrphanedAgents } from "./agent-registry.js";
import { AgentSlots } from "./agent-slots.js";
import { createApp } from "./app.js";
import {
  activateAppSettings,
  AppSettingsService,
  deactivateAppSettings,
} from "./app-settings.js";
import { bundled, version } from "./build-info.js";
import { run } from "./cli.js";
import { loadOrCreateApiToken, readApiToken, withApiToken } from "./api-token.js";
import {
  baseUrl,
  browserHost,
  dataPaths,
  isLoopbackHost,
  isWildcardHost,
  resolveConfig,
  type Config,
  type StartFlags,
} from "./config.js";
import { sm } from "./i18n/index.js";
import { log } from "./log.js";
import { redact } from "./process.js";
import { Store } from "./store.js";
import { Workbench } from "./workbench.js";

export { createApp, type AppOptions } from "./app.js";

/** A start that cannot go on; the message is for the person, translated. */
export class StartupError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
  }
}

export interface StartServerOptions {
  /** The resolved configuration; otherwise resolved from `flags` and `env`. */
  config?: Config;
  flags?: StartFlags;
  env?: NodeJS.ProcessEnv;
  /** Where the startup line and hints go; console.log by default. */
  print?: (line: string) => void;
  /** One-line startup warnings (stderr); console.error by default. */
  warn?: (line: string) => void;
  /** Opens the app's URL when the configuration says to open a browser. */
  openBrowser?: (url: string) => unknown;
  /**
   * Shut down and exit the process on SIGINT, SIGTERM, SIGHUP and fatal
   * errors (true by default). In-process callers such as tests pass false
   * and call `shutdown()` themselves.
   */
  handleExit?: boolean;
}

export interface RunningServer {
  server: http.Server;
  app: Express;
  /** The base URL: BELLPR_PUBLIC_URL, or the local address. */
  url: string;
  /** Stops the server and its work and releases the lock; never exits. */
  shutdown: () => Promise<void>;
}

/** `<dataDir>/bellpr.lock` while an instance runs. */
export interface LockInfo {
  pid: number;
  port: number;
  version: string;
  /** The address it listens on, so `bell-pr open` can reach it. */
  host?: string;
  /** The base URL browsers use: BELLPR_PUBLIC_URL, or the local address. */
  url?: string;
  startedAt?: string;
  /**
   * Linux: the host name and PID namespace of the process. A start in
   * another container or on another machine cannot see that pid, so it
   * judges the lock by its age instead: the holder renews it.
   */
  pidNamespace?: string;
  /**
   * Linux: the kernel's boot id. With `uptime`, it tells a lock written
   * before the machine restarted without trusting the clock, which may
   * have been stepped since.
   */
  bootId?: string;
  /** Seconds the machine had been up when the lock was written. */
  uptime?: number;
}

/**
 * True when `moduleUrl` is the script Node.js was started with, also when
 * it was started through a symlink such as an npm bin link.
 */
export function isEntryPoint(moduleUrl: string, script = process.argv[1]) {
  if (!script) return false;
  try {
    return realpathSync(script) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

/** The lock of the instance running on `dataDir`, if any (maybe stale). */
export function readLock(dataDir: string): LockInfo | undefined {
  return readLockFile(dataPaths(dataDir).lock);
}

function readLockFile(file: string): LockInfo | undefined {
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    if (
      !Number.isInteger(value?.pid) ||
      value.pid < 1 ||
      !Number.isInteger(value.port)
    )
      return undefined;
    return value as LockInfo;
  } catch {
    return undefined;
  }
}

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The command line of a process (`ps` outside Linux); undefined where unknown. */
function commandLine(pid: number): string[] | undefined {
  if (process.platform === "win32") return undefined;
  if (process.platform !== "linux") {
    const ps = spawnSync("ps", ["-o", "command=", "-p", String(pid)], {
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C" },
    });
    const line = ps.status === 0 ? ps.stdout.trim() : "";
    return line ? line.split(/\s+/) : undefined;
  }
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean);
  } catch {
    return undefined;
  }
}

/** Lock files this process holds, so a pid match is told apart from reuse. */
const heldLocks = new Set<string>();

/** How often the holder renews its lock, and how long a renewal counts. */
const lockRenewMs = 10_000;
const lockLeaseMs = 30_000;

/** Linux: where this process's pid is valid; undefined elsewhere. */
function currentPidNamespace(): string | undefined {
  if (process.platform !== "linux") return undefined;
  try {
    return `${os.hostname()} ${readlinkSync("/proc/self/ns/pid")}`;
  } catch {
    return undefined;
  }
}

/** Linux: an id that changes with every boot of the machine; undefined elsewhere. */
function currentBootId(): string | undefined {
  if (process.platform !== "linux") return undefined;
  try {
    return readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether the lock was written before the machine last started: by its
 * boot id, else by an uptime more than a second above the current one
 * (os.uptime() counts whole seconds on some systems). Only a lock from an
 * older build, which has neither, is compared with the clock.
 */
function writtenBeforeBoot(lock: LockInfo) {
  const bootId = currentBootId();
  if (lock.bootId !== undefined && bootId !== undefined) return lock.bootId !== bootId;
  if (typeof lock.uptime === "number") return os.uptime() + 1 < lock.uptime;
  const startedAt = Date.parse(lock.startedAt ?? "");
  return Number.isFinite(startedAt) && startedAt < Date.now() - os.uptime() * 1000 - 120_000;
}

/** Whether the lock was written in another container or on another machine. */
function writtenElsewhere(lock: LockInfo) {
  return lock.pidNamespace !== undefined && lock.pidNamespace !== currentPidNamespace();
}

/** Whether the lock file at `file` was renewed within the lease. */
function renewedWithinLease(file: string) {
  try {
    return Date.now() - statSync(file).mtimeMs < lockLeaseMs;
  } catch {
    return false;
  }
}

/**
 * Whether the lock's process can still be a running BELL PR. A lock written
 * in another container or on another machine is alive while its holder
 * renews it. Otherwise a lock is stale when its process is gone, when it
 * carries this process's pid without being held here (a container restart
 * reuses pids), when it was written before the machine booted, or when its
 * pid now runs something other than Node.js. `copy` is where the lock lies
 * when it was moved aside.
 */
function lockHolderAlive(lock: LockInfo, file: string, copy = file): boolean {
  if (writtenElsewhere(lock)) return renewedWithinLease(copy);
  if (lock.pid === process.pid) return heldLocks.has(file);
  if (!processAlive(lock.pid)) return false;
  if (writtenBeforeBoot(lock)) return false;
  const argv = commandLine(lock.pid);
  return !argv?.length || /node/i.test(path.basename(argv[0]));
}

/**
 * Whether the BELL PR that wrote `lock` in `dataDir` may still be running,
 * by the checks a start makes before it replaces the lock. `bell-pr open`
 * reports the address of such a process only.
 */
export function lockHolderRunning(dataDir: string, lock: LockInfo): boolean {
  return lockHolderAlive(lock, dataPaths(dataDir).lock);
}

/**
 * Writes the lock exclusively, replacing a stale one, and renews it while
 * it is held. Returns its release.
 */
async function acquireLock(
  file: string,
  info: LockInfo,
  dataDir: string,
): Promise<() => void> {
  // A lock from elsewhere lapses at most a lease after its last renewal.
  const deadline = Date.now() + lockLeaseMs + 1000;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const fd = openSync(file, "wx", 0o600);
      try {
        writeSync(fd, `${JSON.stringify(info)}\n`);
      } finally {
        closeSync(fd);
      }
      heldLocks.add(file);
      const renewal = setInterval(() => {
        const now = new Date();
        try {
          utimesSync(file, now, now);
        } catch {
          // Removed or unreachable for now: the next renewal tries again.
        }
      }, lockRenewMs);
      renewal.unref();
      return () => {
        clearInterval(renewal);
        heldLocks.delete(file);
        // Only remove the lock while it is still ours.
        const lock = readLockFile(file);
        if (lock?.pid === process.pid && lock.pidNamespace === info.pidNamespace)
          rmSync(file, { force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    let holder = readLockFile(file);
    // Its holder may have just stopped: wait for the lease to run out.
    while (
      holder &&
      writtenElsewhere(holder) &&
      lockHolderAlive(holder, file) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      holder = readLockFile(file);
    }
    if (holder && lockHolderAlive(holder, file))
      throw new StartupError(
        sm().cli.start.dataDirInUse({ dataDir, pid: holder.pid }),
      );
    // Move the stale lock aside before removing it, so two starts cannot
    // both remove a fresh one: if what was moved belongs to a live start
    // after all, it goes back.
    const aside = `${file}.stale-${process.pid}-${randomBytes(4).toString("hex")}`;
    try {
      renameSync(file, aside);
    } catch {
      continue;
    }
    const moved = readLockFile(aside);
    if (moved && lockHolderAlive(moved, file, aside)) {
      try {
        linkSync(aside, file);
      } catch {
        // Yet another start holds the lock now; the next attempt reports it.
      }
    } else log.info("Removed a stale lock", { pid: moved?.pid });
    rmSync(aside, { force: true });
  }
  const holder = readLockFile(file);
  throw new StartupError(
    sm().cli.start.dataDirInUse({ dataDir, pid: holder?.pid ?? 0 }),
  );
}

/** GET /api/health on `host:port`: whether BELL PR answers there. */
export function probeHealth(host: string, port: number, timeoutMs = 2000) {
  const address = browserHost(host);
  return new Promise<{ name?: string; version?: string } | undefined>(
    (resolve) => {
      const request = http.get(
        `http://${address}:${port}/api/health`,
        // The guard trusts the local Host header, whatever the bind address.
        { headers: { host: `127.0.0.1:${port}` }, timeout: timeoutMs },
        (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk: string) => {
            if (body.length < 10_000) body += chunk;
          });
          response.on("end", () => {
            try {
              const value = JSON.parse(body);
              resolve(
                response.statusCode === 200 && value?.name === product.npmPackage
                  ? value
                  : undefined,
              );
            } catch {
              resolve(undefined);
            }
          });
        },
      );
      request.on("timeout", () => request.destroy());
      request.on("error", () => resolve(undefined));
    },
  );
}

function listen(server: http.Server, port: number, host: string) {
  return new Promise<void>((resolve, reject) => {
    const failed = (error: Error) => {
      server.off("listening", listening);
      reject(error);
    };
    const listening = () => {
      server.off("error", failed);
      resolve();
    };
    server.once("error", failed);
    server.once("listening", listening);
    server.listen(port, host);
  });
}

/**
 * Starts BELL PR and resolves once it serves requests. Rejects with a
 * StartupError (or a ConfigError from resolving the configuration) when it
 * cannot, after undoing what it did; the data directory is only touched
 * once the port is bound.
 */
export async function startServer(
  options: StartServerOptions = {},
): Promise<RunningServer> {
  const config =
    options.config ?? resolveConfig(options.flags ?? {}, options.env ?? process.env);
  const print = options.print ?? ((line: string) => console.log(line));
  const warn = options.warn ?? ((line: string) => console.error(line));
  const messages = sm().cli.start;
  const paths = dataPaths(config.dataDir);
  const url = baseUrl(config);
  // Everything BELL PR creates is private to the user: 0600 files, 0700 dirs.
  const previousUmask = process.umask(0o077);
  const cleanups: Array<() => void> = [() => process.umask(previousUmask)];
  const cleanUp = () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      try {
        cleanup();
      } catch (error) {
        log.warn("Cleanup after BELL PR failed", { error });
      }
    }
  };

  let app: Express | undefined;

  // Until the app is ready, answer the health check and ask others to wait.
  let handler: http.RequestListener = (req, res) => {
    if (req.url === "/api/health") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ name: product.npmPackage, version }));
      return;
    }
    res.statusCode = 503;
    res.setHeader("Retry-After", "1");
    res.end();
  };
  const server = http.createServer((req, res) => handler(req, res));
  try {
    await listen(server, config.port, config.host);
  } catch (error) {
    cleanUp();
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EADDRINUSE") {
      const running = await probeHealth(config.host, config.port);
      throw new StartupError(
        running
          ? messages.alreadyRunning({ url })
          : messages.portInUse({ port: config.port }),
      );
    }
    throw new StartupError(
      messages.listenFailed({
        address: `${config.host}:${config.port}`,
        reason: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  cleanups.push(() => {
    server.close();
    server.closeAllConnections();
  });

  let workbench: Workbench | undefined;
  let stopping: Promise<void> | undefined;
  const shutdown = () =>
    (stopping ??= (async () => {
      handler = (_req, res) => {
        res.statusCode = 503;
        res.setHeader("Connection", "close");
        res.end();
      };
      server.close();
      server.closeIdleConnections();
      try {
        if (workbench && app) {
          const work = Promise.allSettled([
            workbench.shutdown(),
            app.locals.insights.shutdown(),
            app.locals.discovery.shutdown(),
          ]);
          let timer: NodeJS.Timeout | undefined;
          await Promise.race([
            work,
            new Promise((resolve) => {
              timer = setTimeout(resolve, 4000);
            }),
          ]);
          clearTimeout(timer);
        }
      } finally {
        cleanUp();
      }
    })());

  try {
    mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
    await loadOrCreateApiToken(paths.apiToken);
    const releaseLock = await acquireLock(
      paths.lock,
      {
        pid: process.pid,
        port: config.port,
        version,
        host: config.host,
        url,
        startedAt: new Date().toISOString(),
        pidNamespace: currentPidNamespace(),
        bootId: currentBootId(),
        uptime: os.uptime(),
      },
      config.dataDir,
    );
    cleanups.push(releaseLock);
    // A process.exit() that skips shutdown still frees the data directory.
    process.on("exit", releaseLock);
    cleanups.push(() => process.off("exit", releaseLock));

    if (options.handleExit !== false) {
      const exit = (code: number) => {
        // A second signal while stopping exits at once.
        if (stopping) process.exit(code);
        setTimeout(() => process.exit(code), 5000).unref();
        void shutdown().finally(() => process.exit(code));
      };
      const onSignal = () => exit(0);
      const onFatal = (error: unknown) => {
        log.error("BELL PR stopped after an unexpected error", {
          error: redact(
            error instanceof Error ? (error.stack ?? error.message) : String(error),
          ),
        });
        exit(1);
      };
      const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
      for (const signal of signals) process.on(signal, onSignal);
      process.on("unhandledRejection", onFatal);
      process.on("uncaughtException", onFatal);
      cleanups.push(() => {
        for (const signal of signals) process.off(signal, onSignal);
        process.off("unhandledRejection", onFatal);
        process.off("uncaughtException", onFatal);
      });
    }

    if (config.legacyDataDir)
      print(messages.legacyDataDir({ dataDir: config.dataDir }));
    if (!existsSync(path.join(config.staticDir, "index.html")))
      log.warn(messages.uiMissing({ path: config.staticDir }));

    // Before the store marks interrupted runs failed, stop their agents.
    await reapOrphanedAgents(paths.children);
    const registry = new AgentRegistry(paths.children);
    registry.start();
    cleanups.push(() => registry.stop());

    // The saved settings apply before the store loads: the notes that
    // recovery writes on interrupted runs follow the language chosen in the
    // app, not BELLPR_LOCALE.
    const appSettings = new AppSettingsService(config.dataDir);
    activateAppSettings(appSettings);
    cleanups.push(() => deactivateAppSettings(appSettings));
    const store = new Store(config.dataDir);
    await store.initialize();
    const agentSlots = new AgentSlots(config.limits.maxAgentProcesses);
    workbench = new Workbench(store, undefined, {
      appSettings,
      agentSlots,
      maxActiveRuns: config.limits.maxActiveRuns,
      agentTimeoutScale: config.limits.agentTimeoutScale,
    });
    app = createApp(workbench, {
      port: config.port,
      ...(config.frontendPort ? { frontendPort: config.frontendPort } : {}),
      dev: config.dev,
      allowedOrigins: config.allowedOrigins,
      ...(config.publicUrl ? { publicUrl: config.publicUrl } : {}),
      staticDirectory: config.staticDir,
      version,
      agentSlots,
      readApiToken: () => readApiToken(paths.apiToken),
      apiTokenFile: paths.apiToken,
    });
    handler = app;

    print(messages.startup({ version, url }));
    // Wildcard bind without PUBLIC_URL: remote Host headers are not allowed, so
    // every non-local request is 403. Say so once on stderr; keep the generic
    // exposed-host line for other non-loopback binds (those already require PUBLIC_URL).
    if (isWildcardHost(config.host) && !config.publicUrl) {
      const warning = messages.wildcardHostNeedsPublicUrl({ host: config.host });
      warn(warning);
      log.warn(warning);
    } else if (!isLoopbackHost(config.host)) {
      const warning = messages.exposedHost({ host: config.host });
      print(warning);
      log.warn(warning);
    }
    if (config.open && options.openBrowser)
      await options.openBrowser(withApiToken(url, readApiToken(paths.apiToken)));
    return { server, app, url, shutdown };
  } catch (error) {
    if (workbench) await shutdown();
    else cleanUp();
    throw error;
  }
}

// Run from source, this file starts BELL PR like `bell-pr start`. The
// bundle starts from cli.ts instead, whose URL this module shares there.
if (!bundled && isEntryPoint(import.meta.url))
  run(["start", ...process.argv.slice(2)]);
