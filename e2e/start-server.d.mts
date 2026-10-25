// Types for start-server.mjs, which the specs import.

export interface LaunchServerOptions {
  /** Default: a free port from the operating system on 127.0.0.1. */
  port?: number;
  /**
   * Extra environment variables for the server; undefined removes one. A
   * PATH here replaces the default, which puts fake codex, claude and gh
   * first.
   */
  env?: Record<string, string | undefined>;
  /** Use this data dir instead of a temporary one; stop() leaves it. */
  dataDir?: string;
  /** Writes files (state.json, app-settings.json, …) into the data dir before the start. */
  seed?: (dataDir: string) => void | Promise<void>;
  /**
   * false skips marking onboarding done (PUT /api/app-settings), to see a
   * first start. Default true.
   */
  settingsPut?: boolean;
}

export interface LaunchedServer {
  /** For example http://127.0.0.1:41234 */
  baseURL: string;
  dataDir: string;
  /** Ends the server and removes its temporary directories. */
  stop(): Promise<void>;
}

/** A free port on 127.0.0.1, from the operating system. */
export function freePort(): Promise<number>;

/** Starts `bell-pr start` with temporary HOME and data dir. */
export function launchServer(
  options?: LaunchServerOptions,
): Promise<LaunchedServer>;

/** Playwright globalSetup; resolves with the global teardown. */
export default function globalSetup(): Promise<() => Promise<void>>;
