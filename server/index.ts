/**
 * The BELL PR server process: `startServer` binds the port, takes the data
 * directory lock, stops agents a crash left behind, loads the store and
 * serves the app.
 *
 * Run directly (`tsx server/index.ts`, as `npm run dev:server` does), this
 * module behaves like `bell-pr start` with the given flags.
 */
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  ftruncateSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
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
import { openCollabHost, type CollabHost } from "./collab-host.js";
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
import { issueWriterLock, type WriterLock } from "./writer-lock.js";

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
  /**
   * The holder hosts coordination (acquireWriterLock): no start replaces
   * the lock unless its holder is shown to have stopped, however long ago
   * it was renewed.
   */
  strict?: boolean;
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
  return parseLock(readLockText(file));
}

/**
 * The text of the lock file at `file`: undefined when there is no file,
 * the error when one is there that cannot be read.
 */
function readLockText(file: string): string | Error | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? undefined : (error as Error);
  }
}

function parseLock(text: string | Error | undefined): LockInfo | undefined {
  try {
    const value = JSON.parse(typeof text === "string" ? text : "");
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
 * Whether the lock's process can still be a running BELL PR. Under the
 * strict rule, the contender's (`strict`) or the lock's own, a lock not
 * written in this PID namespace (another container, another machine, or a
 * build that does not record where) is alive: nothing here can show that
 * its holder stopped. Otherwise such a lock is alive while its holder
 * renews it. A lock written here is stale when its process is gone, when
 * it carries this process's pid without being held here (a container
 * restart reuses pids), when it was written before the machine booted, or
 * when its pid now runs something other than Node.js.
 */
function lockHolderAlive(lock: LockInfo, file: string, strict = false): boolean {
  if (strict || lock.strict === true) {
    if (lock.pidNamespace !== currentPidNamespace()) return true;
  } else if (writtenElsewhere(lock)) return renewedWithinLease(file);
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

/** This process's lock record, with the address it serves on. */
function lockInfo(port: number, host?: string, url?: string): LockInfo {
  return {
    pid: process.pid,
    port,
    version,
    host,
    url,
    startedAt: new Date().toISOString(),
    pidNamespace: currentPidNamespace(),
    bootId: currentBootId(),
    uptime: os.uptime(),
  };
}

/** A lock this process took: whether its file is still this one's, and its release. */
interface HeldLock {
  holds(): boolean;
  release(): void;
}

/**
 * Takes the data directory's lock for a process that hosts coordination,
 * under the strict rule: neither it nor any start of this version replaces
 * a lock whose holder is not shown to have stopped (lockHolderAlive). With
 * `address` (a start with group work) the lock names where the instance
 * serves, as an ordinary one does; without it, port 0: no address for
 * `bell-pr open`.
 */
export async function acquireWriterLock(
  dataDir: string,
  address?: { port: number; host?: string; url?: string },
): Promise<WriterLock> {
  const resolved = path.resolve(dataDir);
  const held = await acquireLock(
    dataPaths(resolved).lock,
    { ...lockInfo(address?.port ?? 0, address?.host, address?.url), strict: true },
    resolved,
  );
  return issueWriterLock({ dataDir: resolved, holds: held.holds, release: held.release });
}

/**
 * Creates `file` with `text` unless it exists, whole or not at all: the
 * text is written aside and linked into place, so no start ever reads a
 * lock half written. Without hard links only a start that is not strict
 * goes on, writing the file in place as before. There the file lies empty
 * until its text is written, and another start may claim and remove an
 * empty file: false also when such a claim stays, and when the path does
 * not read `text` after the write.
 */
function createExclusive(file: string, text: string, strict: boolean): boolean {
  const temp = `${file}.new-${process.pid}-${randomBytes(4).toString("hex")}`;
  try {
    writeFileSync(temp, text, { flag: "wx", mode: 0o600 });
    linkSync(temp, file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    if (strict) throw error;
  } finally {
    rmSync(temp, { force: true });
  }
  try {
    const fd = openSync(file, "wx", 0o600);
    try {
      writeSync(fd, text);
      // A start that found the file empty and claimed it may be about to
      // remove it, and would remove whatever lies at the path by then, be
      // it the lock of a later start. While that claim stays (one that
      // cannot be read does), the file is left to it empty, as it claimed
      // it: nothing takes the path before that start has removed it.
      const claim = claimFile(file, "");
      const claimed = readLockText(claim);
      const stays =
        typeof claimed === "string" ? claimHeld(claimed, claim, false) : claimed !== undefined;
      if (stays) {
        ftruncateSync(fd, 0);
        return false;
      }
    } finally {
      closeSync(fd);
    }
    // Removed while it was still empty, the file took the text where no
    // path leads: what the path reads now shows whether this start has it.
    return readLockText(file) === text;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

/** The claim a start takes on `file`, which reads `text`, before it removes it. */
function claimFile(file: string, text: string) {
  const digest = createHash("sha256").update(text).digest("hex").slice(0, 16);
  return `${file}.takeover-${digest}`;
}

/**
 * Whether the takeover claim at `claim`, which reads `text`, still keeps
 * other starts from its stale lock. One that names its start stays until
 * that start is shown to have stopped, however old it is: a claimer
 * suspended between its last check and its removal would remove the lock a
 * later start took, a strict one too. One that names no start (empty, or
 * not a claim) shows no start to wait for, and a takeover lasts
 * milliseconds: outside the strict rule, the contender's or the stale
 * lock's (`strict`), it is abandoned once it was last modified longer ago
 * than the lease. Its writer may still run, held up between creating the
 * claim in place and writing it: it made no check yet, and after its write
 * it finds that the claim is being removed, or is no longer its own
 * (createExclusive). A date in the future, as after the clock was stepped
 * back, shows no age: that claim counts as new.
 */
function claimHeld(text: string, claim: string, strict: boolean) {
  const claimer = parseLock(text);
  return claimer ? lockHolderAlive(claimer, claim, strict) : strict || renewedWithinLease(claim);
}

/**
 * Removes the lock at `file` if it still reads `text` and is still stale.
 * It first claims that very text, exclusively: a start that found the same
 * stale lock finds the claim or the lock written in its place, so none
 * removes a lock that has just replaced it. A claim that is no longer held
 * (claimHeld) is removed the same way, two levels deep at most. Returns
 * the refusal to give while another start's claim stays, which names that
 * claim: the stale lock's pid is gone.
 */
function removeStale(
  file: string,
  text: string,
  strict: boolean,
  depth = 0,
): StartupError | undefined {
  const claim = claimFile(file, text);
  if (!createExclusive(claim, `${JSON.stringify({ ...lockInfo(0), strict })}\n`, strict)) {
    const held = readLockText(claim);
    if (held === undefined) return undefined;
    // A claim that cannot be read stays, as a lock does.
    if (depth >= 2 || typeof held !== "string" || claimHeld(held, claim, strict))
      return new StartupError(
        strict || parseLock(held)?.strict === true
          ? sm().cli.start.takeoverClaimUnconfirmed({ file: claim })
          : sm().cli.start.takeoverClaimed({ file: claim }),
      );
    return removeStale(claim, held, strict, depth + 1);
  }
  try {
    const current = readLockText(file);
    const lock = parseLock(current);
    // Below the lock itself, `file` is a claim and is judged as one.
    const held = () => {
      if (depth > 0) return claimHeld(text, file, strict);
      return lock ? lockHolderAlive(lock, file, strict) : strict;
    };
    if (current === text && !held()) {
      rmSync(file, { force: true });
      log.info("Removed a stale lock", { pid: lock?.pid });
    }
  } finally {
    rmSync(claim, { force: true });
  }
  return undefined;
}

/**
 * Holds the lock just written at `file` with `text`, renewing it while it
 * is held. A lock that another start wrote in its place is never renewed,
 * so it lapses as its own holder's would.
 */
function holdLock(file: string, text: string): HeldLock {
  heldLocks.add(file);
  const holds = () => heldLocks.has(file) && readLockText(file) === text;
  const renewal = setInterval(() => {
    if (!holds()) return;
    const now = new Date();
    try {
      utimesSync(file, now, now);
    } catch {
      // Removed or unreachable for now: the next renewal tries again.
    }
  }, lockRenewMs);
  renewal.unref();
  return {
    holds,
    release: () => {
      clearInterval(renewal);
      // Only remove the lock while it is still ours.
      if (holds()) rmSync(file, { force: true });
      heldLocks.delete(file);
    },
  };
}

/** The refusal for a lock that stays, saying when only a person can tell it is stale. */
function lockInUse(file: string, dataDir: string, holder: LockInfo | undefined, strict: boolean) {
  const unconfirmed =
    (strict || holder?.strict === true) &&
    (!holder || holder.pidNamespace !== currentPidNamespace());
  const messages = sm().cli.start;
  return new StartupError(
    unconfirmed
      ? messages.dataDirHolderUnconfirmed({ dataDir, file })
      : holder
        ? messages.dataDirInUse({ dataDir, pid: holder.pid })
        : messages.dataDirLockUnsettled({ dataDir, file }),
  );
}

/**
 * Writes the lock exclusively, replacing a stale one, and renews it while
 * it is held. A strict lock (`info.strict`), or a strict holder, puts the
 * start under the strict rule: it does not wait for a lease. No start
 * replaces a lock it cannot read: nothing shows that it is not a strict
 * one, or that its holder has stopped. A read can fail in passing, as on a
 * network file system, so a start that is not strict reads it again on
 * its next attempts before it gives up.
 */
async function acquireLock(
  file: string,
  info: LockInfo,
  dataDir: string,
): Promise<HeldLock> {
  const strict = info.strict === true;
  const text = `${JSON.stringify(info)}\n`;
  // A lock from elsewhere lapses at most a lease after its last renewal.
  const deadline = Date.now() + lockLeaseMs + 1000;
  // What the last attempt has to say when a takeover claim, or a lock it
  // could not read, stopped it.
  let refused: StartupError | undefined;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (createExclusive(file, text, strict)) return holdLock(file, text);
    refused = undefined;
    let current = readLockText(file);
    let holder = parseLock(current);
    // Its holder may have just stopped: wait for the lease to run out.
    while (
      holder &&
      !strict &&
      holder.strict !== true &&
      writtenElsewhere(holder) &&
      lockHolderAlive(holder, file) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      current = readLockText(file);
      holder = parseLock(current);
    }
    // Gone since the attempt to create it: another start removed it.
    if (current === undefined) continue;
    if (holder ? lockHolderAlive(holder, file, strict) : strict)
      throw lockInUse(file, dataDir, holder, strict);
    refused =
      typeof current === "string"
        ? removeStale(file, current, strict || holder?.strict === true)
        : new StartupError(sm().cli.start.lockUnreadable({ file, reason: current.message }));
    if (refused) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (refused) throw refused;
  const holder = readLockFile(file);
  // A stale lock is still there, as when its claim path holds nothing a
  // start can read: its process is gone and must not be named as running.
  if (holder && !lockHolderAlive(holder, file, strict))
    throw new StartupError(sm().cli.start.dataDirLockUnsettled({ dataDir, file }));
  throw lockInUse(file, dataDir, holder, strict);
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

/** Waits for `work`, but no longer than `ms`. */
async function within(ms: number, work: Promise<unknown>) {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    work,
    new Promise((resolve) => {
      timer = setTimeout(resolve, ms);
    }),
  ]);
  clearTimeout(timer);
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
  let collab: CollabHost | undefined;
  let stopping: Promise<void> | undefined;
  const shutdown = () =>
    (stopping ??= (async () => {
      handler = (_req, res) => {
        res.statusCode = 503;
        res.setHeader("Connection", "close");
        res.end();
      };
      // Group work in flight lands before the server closes and the lock goes.
      if (collab) await within(4000, collab.close());
      server.close();
      server.closeIdleConnections();
      try {
        if (workbench && app) {
          await within(
            4000,
            Promise.allSettled([
              workbench.shutdown(),
              app.locals.insights.shutdown(),
              app.locals.discovery.shutdown(),
            ]),
          );
        }
      } finally {
        cleanUp();
      }
    })());

  try {
    mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
    await loadOrCreateApiToken(paths.apiToken);
    // Group work needs the strict lock; it still names this address.
    const writerLock = config.collab
      ? await acquireWriterLock(config.dataDir, { port: config.port, host: config.host, url })
      : undefined;
    const { release: releaseLock } = writerLock ?? await acquireLock(
      paths.lock,
      lockInfo(config.port, config.host, url),
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
        // Group work waits up to 4 seconds first; the workbench still gets its own 4.
        setTimeout(() => process.exit(code), collab ? 9000 : 5000).unref();
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
    if (writerLock)
      collab = await openCollabHost({ dataDir: config.dataDir, lock: writerLock });
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
      ...(collab ? { collab } : {}),
      suiteLinks: config.suiteLinks,
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
