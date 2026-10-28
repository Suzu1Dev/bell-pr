/**
 * Paths both agent CLIs are told not to read. Claude maps each entry to a
 * Read deny rule; Codex maps the same entries into its permission profile.
 * One function, so the two lists cannot drift.
 *
 * The operating-system sandbox is what applies this list to shell commands.
 * The person can turn that sandbox off.
 */
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Home paths denied for both agents, plus the files that were already denied. */
const staticPaths = [
  "~/.config/gh/**",
  "~/.git-credentials",
  "~/.netrc",
  "~/.ssh/",
  "~/.ssh/**",
  "~/.aws/**",
  "~/.npmrc",
  "~/.claude/.credentials.json",
  "~/.codex/auth.json",
];

function resolved(value: string) {
  try {
    return realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}

/** Split a credential.helper value into words, keeping quoted paths intact. */
function tokenize(value: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (quote) {
      if (char === quote) quote = undefined;
      else if (char === "\\" && quote === '"') current += value[++index] ?? "";
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "\\" && value[index + 1]) {
      current += value[++index];
      continue;
    }
    if (/\s/.test(char)) {
      if (current) out.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) out.push(current);
  return out;
}

function expandHome(file: string, home: string) {
  if (file === "~") return home;
  if (file.startsWith("~/") || file.startsWith("~\\"))
    return path.join(home, file.slice(2));
  return file;
}

/**
 * Files named by `credential.helper` values of the form `store --file=<path>`
 * (also `store --file <path>`). Plain `store` uses `~/.git-credentials`,
 * which is already on the static list. Other helpers are ignored.
 *
 * ponytail: a relative `--file` is resolved from the home directory. Git
 * uses the process's working directory; switch to that cwd if a helper
 * relies on it.
 */
export function credentialStoreFiles(
  helpers: readonly string[],
  home: string,
): string[] {
  const files: string[] = [];
  for (const helper of helpers) {
    const parts = tokenize(helper.trim());
    if (parts[0] !== "store") continue;
    for (let index = 1; index < parts.length; index++) {
      const part = parts[index];
      let file: string | undefined;
      if (part === "--file") {
        const next = parts[index + 1];
        if (next && !next.startsWith("-")) {
          file = next;
          index++;
        }
      } else if (part.startsWith("--file=")) {
        file = part.slice("--file=".length);
      }
      if (!file) continue;
      const expanded = expandHome(file, home);
      files.push(
        path.isAbsolute(expanded) ? resolved(expanded) : resolved(path.join(home, expanded)),
      );
    }
  }
  return files;
}

function gitHelpers(args: string[], env: NodeJS.ProcessEnv): string[] {
  try {
    const gitEnv: NodeJS.ProcessEnv = { ...env, GIT_TERMINAL_PROMPT: "0" };
    delete gitEnv.GIT_DIR;
    delete gitEnv.GIT_WORK_TREE;
    const result = spawnSync(
      "git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "core.fsmonitor=false",
        ...args,
      ],
      {
      encoding: "utf8",
      env: gitEnv,
      cwd: os.tmpdir(),
      timeout: 5_000,
      shell: false,
    });
    if (result.error || result.status !== 0 || !result.stdout) return [];
    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** `credential.helper` from the global file, the XDG file, and the system file. */
function configuredHelpers(env: NodeJS.ProcessEnv, home: string): string[] {
  const xdg = path.join(
    env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.length > 0
      ? env.XDG_CONFIG_HOME
      : path.join(home, ".config"),
    "git",
    "config",
  );
  const globalFile = env.GIT_CONFIG_GLOBAL || path.join(home, ".gitconfig");
  const values = [
    ...gitHelpers(
      ["config", "--file", globalFile, "--get-all", "credential.helper"],
      env,
    ),
  ];
  if (path.resolve(xdg) !== path.resolve(globalFile))
    values.push(
      ...gitHelpers(
        ["config", "--file", xdg, "--get-all", "credential.helper"],
        env,
      ),
    );
  if (env.GIT_CONFIG_NOSYSTEM === "1" || env.GIT_CONFIG_NOSYSTEM === "true")
    return values;
  if (env.GIT_CONFIG_SYSTEM)
    values.push(
      ...gitHelpers(
        ["config", "--file", env.GIT_CONFIG_SYSTEM, "--get-all", "credential.helper"],
        env,
      ),
    );
  else
    values.push(
      ...gitHelpers(["config", "--system", "--get-all", "credential.helper"], env),
    );
  return values;
}

function moved(env: NodeJS.ProcessEnv): string[] {
  const out: string[] = [];
  const directory = (value: string | undefined) =>
    value && path.isAbsolute(value) ? resolved(value) : undefined;
  const gh = directory(env.GH_CONFIG_DIR);
  if (gh) out.push(`${gh}/**`);
  const xdg = directory(env.XDG_CONFIG_HOME);
  if (xdg) out.push(`${resolved(path.join(xdg, "gh"))}/**`);
  const claude = directory(env.CLAUDE_CONFIG_DIR);
  if (claude) out.push(path.join(claude, ".credentials.json"));
  const codex = directory(env.CODEX_HOME);
  if (codex) out.push(path.join(codex, "auth.json"));
  return out;
}

export interface CredentialDenialOptions {
  /** Defaults to the current process environment. */
  env?: NodeJS.ProcessEnv;
  /** Defaults to `env.HOME`, then the process home directory. */
  home?: string;
}

/**
 * Every path both agents are told not to read: the static credential files,
 * the same files where an environment variable moved them, `~/.git-credentials`,
 * and each `credential.helper store --file` path from the global, XDG and
 * system Git config. A missing or unreadable config adds no store path and
 * does not drop the rest of the list.
 */
export function sharedCredentialDenials(
  options: CredentialDenialOptions = {},
): string[] {
  const env = options.env ?? process.env;
  const home = options.home || env.HOME || os.homedir();
  let store: string[] = [];
  try {
    store = credentialStoreFiles(configuredHelpers(env, home), home);
  } catch {
    store = [];
  }
  return [...new Set([...staticPaths, ...moved(env), ...store])].filter(
    (entry) => entry.length > 0 && !/[\n\r\0]/.test(entry),
  );
}
