/**
 * Runtime configuration for `bell-pr start`. Each value comes from the
 * command-line flag first, then its BELLPR_* environment variable, then the
 * default. Resolving it only reads: nothing is created or changed, so a bad
 * setting stops the start before any data is touched.
 */
import { existsSync } from "node:fs";
import { isIP } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseActiveRunLimit, parseAgentProcessLimit } from "./agent-slots.js";
import { parseAgentTimeoutScale } from "./agent-timeouts.js";
import { parseAllowedOrigins } from "./http-guard.js";
import { sm } from "./i18n/index.js";

/** Command-line flags of `bell-pr start`; every field is optional. */
export interface StartFlags {
  /** --port, as typed. */
  port?: string | number;
  /** --host */
  host?: string;
  /** --data-dir */
  dataDir?: string;
  /** --dev: development mode, with the Vite dev server in front. */
  dev?: boolean;
  /** false for --no-open. */
  open?: boolean;
}

/** How much agent work runs at once and how long turns may take. */
export interface Limits {
  /** BELLPR_MAX_AGENT_PROCESSES, 1-32. */
  maxAgentProcesses: number;
  /** BELLPR_MAX_ACTIVE_RUNS, 1-8. */
  maxActiveRuns: number;
  /** BELLPR_AGENT_TIMEOUT_SCALE, 0.5-10. */
  agentTimeoutScale: number;
}

export interface Config {
  /** --port | BELLPR_PORT, 4311 by default. */
  port: number;
  /** --host | BELLPR_HOST, 127.0.0.1 by default. */
  host: string;
  /** BELLPR_PUBLIC_URL as an origin (no trailing slash), when set. */
  publicUrl?: string;
  /** --data-dir | BELLPR_DATA_DIR | ~/.bellpr, absolute. */
  dataDir: string;
  /** BELLPR_STATIC_DIR, or the dist/ folder next to the server code. */
  staticDir: string;
  /** BELLPR_ALLOWED_ORIGINS plus the BELLPR_PUBLIC_URL origin. */
  allowedOrigins: string[];
  /** --dev or BELLPR_DEV=1: no sign-in, and the dev server port is trusted. */
  dev: boolean;
  /** The Vite dev server port (BELLPR_FRONTEND_PORT, 4310); only in dev. */
  frontendPort?: number;
  /** Open the sign-in link in a browser: not --no-open, BELLPR_NO_OPEN, CI or dev. */
  open: boolean;
  limits: Limits;
  /**
   * ./.bellpr in the working directory when it holds data from an older
   * version and is not the data directory in use. Only a hint is printed.
   */
  legacyDataDir?: string;
}

/** A setting that cannot work; the message says which and why. */
export class ConfigError extends Error {}

export const defaultPort = 4311;
export const defaultHost = "127.0.0.1";
export const defaultFrontendPort = 4310;

/** Whether an environment flag such as BELLPR_NO_OPEN or CI is on. */
export function envFlag(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return Boolean(normalized) && normalized !== "0" && normalized !== "false";
}

function setting(value: string | undefined): string | undefined {
  return value?.trim() ? value.trim() : undefined;
}

/** The dist/ folder next to server/ (tsx) or build/ (the package). */
export function defaultStaticDir(): string {
  return fileURLToPath(new URL("../dist/", import.meta.url));
}

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

/** --data-dir, then BELLPR_DATA_DIR, then ~/.bellpr; always absolute. */
export function resolveDataDir(
  flags: Pick<StartFlags, "dataDir"> = {},
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): string {
  const value =
    setting(flags.dataDir) ??
    setting(env.BELLPR_DATA_DIR) ??
    path.join(os.homedir(), ".bellpr");
  return path.resolve(cwd, expandHome(value));
}

/** Files BELL PR keeps in the data directory next to state.json. */
export function dataPaths(dataDir: string) {
  const run = path.join(dataDir, "run");
  return {
    /** `{pid, port, version, host, startedAt}` of the running instance. */
    lock: path.join(dataDir, "bellpr.lock"),
    /** The agent CLI process groups that are running. */
    children: path.join(dataDir, "children.json"),
    /** Transient files for the running instance (0700). */
    run,
    /** A one-time sign-in link for `bell-pr open`, deleted once read. */
    openLink: path.join(run, "open-link.json"),
  };
}

function parsePort(name: string, value: string | number): number {
  const text = String(value).trim();
  const port = Number(text);
  if (!/^\d+$/.test(text) || port < 1024 || port > 65535)
    throw new ConfigError(sm().cli.config.portRange({ name, value: text }));
  return port;
}

/**
 * An IPv6 address may be written in brackets; listen() takes it without.
 * Host names are compared in lower case, as browsers send them.
 */
function parseHost(value: string): string {
  const host = value.trim().replace(/^\[(.*)\]$/, "$1").toLowerCase();
  if (
    !(isIP(host) || /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(host))
  )
    throw new ConfigError(sm().cli.config.hostInvalid({ value }));
  return host;
}

/** 0.0.0.0 and :: listen on every address of the machine. */
export function isWildcardHost(host: string): boolean {
  return host === "0.0.0.0" || host === "::";
}

/** localhost, 127.0.0.0/8 and ::1 are reachable from this computer only. */
export function isLoopbackHost(host: string): boolean {
  const name = host.toLowerCase();
  return (
    name === "localhost" ||
    name === "::1" ||
    (isIP(name) === 4 && name.startsWith("127."))
  );
}

/**
 * The address a browser on this computer uses for a server on `host`:
 * 127.0.0.1 for the wildcard hosts, and otherwise the host itself (IPv6 in
 * brackets), since a server on ::1 or localhost may not listen on 127.0.0.1.
 */
export function browserHost(host: string): string {
  if (isWildcardHost(host)) return "127.0.0.1";
  return isIP(host) === 6 ? `[${host}]` : host;
}

/**
 * The origin of a loopback address the request guard does not know by
 * name (it trusts localhost, 127.0.0.1 and [::1]), such as 127.0.0.2.
 */
function otherLoopbackOrigin(host: string, port: number): string | undefined {
  return isLoopbackHost(host) && !["localhost", "127.0.0.1", "::1"].includes(host)
    ? `http://${host}:${port}`
    : undefined;
}

/** The base URL BELL PR prints: BELLPR_PUBLIC_URL, or the local address. */
export function baseUrl(config: Pick<Config, "publicUrl" | "host" | "port">) {
  return config.publicUrl ?? `http://${browserHost(config.host)}:${config.port}`;
}

function parsePublicUrl(value: string): string {
  const invalid = () =>
    new ConfigError(sm().cli.config.publicUrlInvalid({ value }));
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid();
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    // Sign-in links and the session cookie must not cross a network in
    // the clear: plain http only for this computer.
    (url.protocol === "http:" &&
      !isLoopbackHost(url.hostname.replace(/^\[(.*)\]$/, "$1")))
  )
    throw invalid();
  // The guard checks the origin the same way as BELLPR_ALLOWED_ORIGINS.
  try {
    parseAllowedOrigins(url.origin);
  } catch {
    throw invalid();
  }
  return url.origin;
}

/** Wraps the existing BELLPR_* parsers, which throw plain errors. */
function parsed<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    throw new ConfigError(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Resolves the configuration of `bell-pr start` from its flags and the
 * environment. Throws a ConfigError with a translated message when a value
 * cannot work. Reads the file system only to find old data in ./.bellpr.
 */
export function resolveConfig(
  flags: StartFlags = {},
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): Config {
  const portFlag = flags.port === undefined ? undefined : String(flags.port);
  const port =
    portFlag !== undefined
      ? parsePort("--port", portFlag)
      : setting(env.BELLPR_PORT) !== undefined
        ? parsePort("BELLPR_PORT", env.BELLPR_PORT!)
        : defaultPort;
  const host = parseHost(setting(flags.host) ?? setting(env.BELLPR_HOST) ?? defaultHost);
  const dev = flags.dev === true || envFlag(env.BELLPR_DEV);
  // Without a session there is no sign-in, so dev mode stays on this computer.
  if (dev && !isLoopbackHost(host))
    throw new ConfigError(sm().cli.config.devNeedsLoopback({ host }));
  const frontendPort = dev
    ? setting(env.BELLPR_FRONTEND_PORT) !== undefined
      ? parsePort("BELLPR_FRONTEND_PORT", env.BELLPR_FRONTEND_PORT!)
      : defaultFrontendPort
    : undefined;
  const publicUrl = setting(env.BELLPR_PUBLIC_URL)
    ? parsePublicUrl(setting(env.BELLPR_PUBLIC_URL)!)
    : undefined;
  // The request guard accepts this computer's addresses and the public URL
  // only: on another address without one, every request would be refused,
  // the printed sign-in link included.
  if (!publicUrl && !isLoopbackHost(host) && !isWildcardHost(host))
    throw new ConfigError(sm().cli.config.publicUrlRequired({ host }));
  const configured = parsed(() => parseAllowedOrigins(env.BELLPR_ALLOWED_ORIGINS ?? ""));
  // Only append an origin that is set: an empty entry throws.
  const allowedOrigins = [
    ...new Set(
      [...configured, publicUrl, otherLoopbackOrigin(host, port)].filter(
        (origin): origin is string => Boolean(origin),
      ),
    ),
  ];
  const limits: Limits = {
    maxAgentProcesses: parsed(() =>
      parseAgentProcessLimit(env.BELLPR_MAX_AGENT_PROCESSES),
    ),
    maxActiveRuns: parsed(() => parseActiveRunLimit(env.BELLPR_MAX_ACTIVE_RUNS)),
    agentTimeoutScale: parsed(() =>
      parseAgentTimeoutScale(env.BELLPR_AGENT_TIMEOUT_SCALE),
    ),
  };
  const dataDir = resolveDataDir(flags, env, cwd);
  const staticDir = setting(env.BELLPR_STATIC_DIR)
    ? path.resolve(cwd, expandHome(setting(env.BELLPR_STATIC_DIR)!))
    : defaultStaticDir();
  // Before 1.0 the data lived in ./.bellpr; point at it, never move it.
  const legacy = path.resolve(cwd, ".bellpr");
  const legacyDataDir =
    legacy !== dataDir && existsSync(path.join(legacy, "state.json"))
      ? legacy
      : undefined;
  return {
    port,
    host,
    ...(publicUrl ? { publicUrl } : {}),
    dataDir,
    staticDir,
    allowedOrigins,
    dev,
    ...(frontendPort !== undefined ? { frontendPort } : {}),
    open:
      flags.open !== false &&
      !dev &&
      !envFlag(env.BELLPR_NO_OPEN) &&
      !envFlag(env.CI),
    limits,
    ...(legacyDataDir ? { legacyDataDir } : {}),
  };
}
