/**
 * Environment checks behind `bell-pr doctor`, GET /api/doctor and the setup
 * checklist. These are the final signatures. For now runDoctor runs the
 * probes behind GET /api/status (which agent CLIs are installed and signed
 * in, and the GitHub login) and maps them into a DoctorReport; the full
 * checks and the CLI command come later.
 */
import type {
  DoctorCheck,
  DoctorCheckStatus,
  DoctorReport,
} from "../shared/doctor.js";
import { product } from "../shared/product.js";
import { agentLoginCheck } from "./agent-cli.js";
import { agentEnvironment, command } from "./process.js";

const cacheMs = 10_000;
let cache: { time: number; report: Promise<DoctorReport> } | undefined;

/** An agent CLI is optional: a missing one is skipped, not a failure. */
function cliStatus(installed: boolean): DoctorCheckStatus {
  return installed ? "ok" : "skip";
}

/** A CLI that is installed but signed out needs action. */
function authStatus(installed: boolean, signedIn: boolean): DoctorCheckStatus {
  if (!installed) return "skip";
  return signedIn ? "ok" : "warn";
}

/** The checks Workbench.status() runs today, as a DoctorReport. */
async function probe(): Promise<DoctorReport> {
  const claudeLogin = agentLoginCheck("claude");
  const [codex, codexAuth, github, claude, claudeAuth] =
    await Promise.allSettled([
      command("codex", ["--version"], { timeoutMs: 5000 }),
      command("codex", ["login", "status"], { timeoutMs: 5000 }),
      command("gh", ["api", "user", "--jq", ".login"], { timeoutMs: 10_000 }),
      command("claude", ["--version"], { timeoutMs: 5000 }),
      command(claudeLogin.executable, claudeLogin.args, {
        timeoutMs: 10_000,
        env: agentEnvironment(),
      }),
    ]);
  const ok = (result: PromiseSettledResult<unknown>) =>
    result.status === "fulfilled";
  const providerReady =
    (ok(codex) && ok(codexAuth)) || (ok(claude) && ok(claudeAuth));
  const checks: DoctorCheck[] = [
    { id: "codex", status: cliStatus(ok(codex)), required: false },
    {
      id: "codex-auth",
      status: authStatus(ok(codex), ok(codexAuth)),
      required: false,
    },
    { id: "claude", status: cliStatus(ok(claude)), required: false },
    {
      id: "claude-auth",
      status: authStatus(ok(claude), ok(claudeAuth)),
      required: false,
    },
    // `gh api user` succeeds only when gh is installed and signed in.
    {
      id: "gh-auth",
      status: github.status === "fulfilled" ? "ok" : "warn",
      required: false,
      ...(github.status === "fulfilled" && github.value.stdout.trim()
        ? { detail: github.value.stdout.trim() }
        : {}),
    },
    {
      id: "provider-ready",
      status: providerReady ? "ok" : "fail",
      required: true,
    },
  ];
  return {
    checks,
    ready: !checks.some((check) => check.required && check.status === "fail"),
    checkedAt: new Date().toISOString(),
    platform: process.platform,
  };
}

/**
 * Checks the environment. Results are cached for 10 seconds and callers in
 * that window share one probe; `force` probes again.
 */
export async function runDoctor(
  opts: { force?: boolean } = {},
): Promise<DoctorReport> {
  if (!opts.force && cache && Date.now() - cache.time < cacheMs)
    return cache.report;
  cache = { time: Date.now(), report: probe() };
  return cache.report;
}

/** What the command line passes to `bell-pr doctor`. */
export interface DoctorCliDeps {
  /** The resolved data directory, for the data-dir check. */
  dataDir?: string;
  /** Where output goes; process.stdout by default. */
  stdout?: { write(text: string): unknown };
}

/**
 * `bell-pr doctor [--json]`. Not implemented yet: it says so and returns
 * the exit code 0.
 */
export async function runDoctorCli(
  _argv: string[],
  deps: DoctorCliDeps = {},
): Promise<number> {
  (deps.stdout ?? process.stdout).write(
    `${product.binNames[0]} doctor: not implemented yet.\n`,
  );
  return 0;
}
