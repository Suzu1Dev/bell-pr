/**
 * Learn by hand: the test command BELL suggests for a project, the
 * environment BELL runs the person's confirmed command with, and the
 * masking of credentials in its output (DESIGN v1.2 F9). All are
 * deterministic: the suggestion comes from the project's own files, never
 * from model output, and it is only a suggestion; nothing runs until the
 * person confirms a command in a request of its own
 * (server/by-hand-tests.ts).
 */
import { constants } from "node:fs";
import { access, lstat, readFile, stat } from "node:fs/promises";
import path from "node:path";

/** Larger manifests are not read; the suggestion is only a convenience. */
const manifestBytes = 1_000_000;

/** The text of a regular file of the worktree, or undefined (missing, a link, a folder or too large). */
async function readManifest(worktree: string, name: string) {
  try {
    const file = path.join(worktree, name);
    const metadata = await lstat(file);
    if (!metadata.isFile() || metadata.size > manifestBytes) return undefined;
    return await readFile(file, "utf8");
  } catch {
    return undefined;
  }
}

async function hasFile(worktree: string, name: string) {
  try {
    return (await lstat(path.join(worktree, name))).isFile();
  } catch {
    return false;
  }
}

/** `scripts.test` of a package.json, unless it is missing or npm's "no test specified" placeholder. */
function packageTestScript(text: string | undefined) {
  if (text === undefined) return undefined;
  let manifest: unknown;
  try {
    manifest = JSON.parse(text);
  } catch {
    return undefined;
  }
  const scripts = (manifest as { scripts?: unknown } | null)?.scripts;
  const script = (scripts as { test?: unknown } | null | undefined)?.test;
  if (typeof script !== "string" || !script.trim()) return undefined;
  return /no test specified/i.test(script) ? undefined : script;
}

/**
 * Whether a Makefile has a `test` target: a rule line (not indented, not a
 * comment, not a variable assignment such as `test := …` or `test ::= …`)
 * that lists `test` among its targets.
 */
function makeTestTarget(text: string | undefined) {
  if (text === undefined) return false;
  return text.split(/\r?\n/).some((line) => {
    const rule = /^([^\s:=#][^:=#]*?):(?!:?=)/.exec(line);
    return !!rule && rule[1].trim().split(/\s+/).includes("test");
  });
}

/**
 * Whether an executable file `name` is in one of PATH's absolute folders.
 * Only looked up, never run; relative folders are skipped, since they
 * would name folders of the run's worktree.
 */
async function onPath(name: string, env: NodeJS.ProcessEnv) {
  for (const folder of (env.PATH ?? "").split(path.delimiter)) {
    if (!path.isAbsolute(folder)) continue;
    const file = path.join(folder, name);
    try {
      if (!(await stat(file)).isFile()) continue;
      await access(file, constants.X_OK);
      return true;
    } catch {
      // Not there, or not executable.
    }
  }
  return false;
}

/**
 * BELL's suggestion of a test command for the project in `worktree`, in
 * DESIGN F9's order: `scripts.test` in package.json gives `npm test`
 * (`pnpm test` with pnpm-lock.yaml, `yarn test` with yarn.lock);
 * pyproject.toml, pytest.ini or tox.ini give `python -m pytest`, or
 * `python3 -m pytest` when `env`'s PATH (pass the tests' environment,
 * testEnvironment) has python3 and no python; Cargo.toml gives `cargo test`; go.mod gives
 * `go test ./...`; a `test` target in the Makefile gives `make test`.
 * Empty when nothing fits.
 */
export async function suggestTestCommand(
  worktree: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  if (packageTestScript(await readManifest(worktree, "package.json"))) {
    if (await hasFile(worktree, "pnpm-lock.yaml")) return "pnpm test";
    if (await hasFile(worktree, "yarn.lock")) return "yarn test";
    return "npm test";
  }
  for (const name of ["pyproject.toml", "pytest.ini", "tox.ini"])
    if (await hasFile(worktree, name))
      return !(await onPath("python", env)) && (await onPath("python3", env))
        ? "python3 -m pytest"
        : "python -m pytest";
  if (await hasFile(worktree, "Cargo.toml")) return "cargo test";
  if (await hasFile(worktree, "go.mod")) return "go test ./...";
  // The file names GNU make reads, in its order.
  for (const name of ["GNUmakefile", "makefile", "Makefile"])
    if (makeTestTarget(await readManifest(worktree, name))) return "make test";
  return "";
}

/** Names that hold a secret by their ending (case-insensitive). */
const secretEnding = /(?:TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIALS)$/i;
/**
 * Names with TOKEN, SECRET or PASSWORD as a word of their own anywhere
 * (case-insensitive): AWS_BEARER_TOKEN_BEDROCK, which Claude Code reads,
 * and SECRET_KEY, DJANGO_SECRET_KEY, SECRET_KEY_BASE.
 */
const secretWord = /(?:^|_)(?:TOKEN|SECRET|PASSWORD)(?:_|$)/i;
/** BELL's own settings and the variables of GitHub, the GitHub CLI and the AI CLIs (case-insensitive). */
const ownedPrefix = /^(?:BELLPR_|GH_|GITHUB_|ANTHROPIC_|OPENAI_|CODEX_|CLAUDE_)/i;

/**
 * What npm (and npx, which `npx bell-pr` runs) sets for a program it
 * starts, and a terminal does not have: the lowercase npm_… names
 * (npm_config_… carries the flags given to npx, such as --yes or
 * --offline, into every npm the tests run), INIT_CWD and COLOR.
 */
const npmName = /^(?:npm_|INIT_CWD$|COLOR$)/;
const npmBin = /[\\/]node_modules[\\/]\.bin$/;

/**
 * PATH without the folders npm put in front of it for the program it
 * started (@npmcli/run-script's set-path): npx's package folder, then the
 * `node_modules/.bin` folder of the folder npm ran in and of each of its
 * parents up to the root's, then npm's `node-gyp-bin`; every layer of an
 * npm run inside another. A PATH that does not begin that way is kept.
 */
function withoutNpmFolders(value: string) {
  let folders = value.split(path.delimiter);
  for (;;) {
    const gyp = folders.findIndex((folder) => /[\\/]node-gyp-bin$/.test(folder));
    const added = folders.slice(0, Math.max(gyp, 0));
    const last = added.at(-1);
    if (
      !last ||
      !added.every((folder) => path.isAbsolute(folder) && npmBin.test(folder)) ||
      path.dirname(path.dirname(last)) !== path.parse(last).root
    )
      return folders.join(path.delimiter);
    folders = folders.slice(gyp + 1);
  }
}

/**
 * The environment BELL runs the person's tests with: BELL's own
 * environment minus every variable whose name ends in TOKEN, SECRET,
 * PASSWORD, API_KEY, ACCESS_KEY, PRIVATE_KEY or CREDENTIALS, holds TOKEN,
 * SECRET or PASSWORD as a word between underscores, or starts with
 * BELLPR_, GH_, GITHUB_, ANTHROPIC_, OPENAI_, CODEX_ or CLAUDE_, ignoring
 * case; everything else stays (PATH, HOME, JAVA_HOME, VIRTUAL_ENV,
 * GOPATH…), as in the person's terminal; plus CI=1 and NO_COLOR=1.
 *
 * When npm started BELL (`npx bell-pr`, `npm start`: npm_lifecycle_event
 * is set), what npm added for BELL goes too, so an `npm test` behaves as
 * in the person's terminal: the names starting with npm_ (lowercase),
 * INIT_CWD, COLOR, NODE when it names the Node.js npm ran on, and the
 * folders npm put in front of PATH. The person's own NPM_CONFIG_…
 * (uppercase) stay.
 *
 * The variables are removed by name only: files in the home folder, such
 * as the CLIs' sign-in files, stay readable to the tests.
 */
export function testEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const byNpm = env.npm_lifecycle_event !== undefined;
  const result: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || secretEnding.test(name) || secretWord.test(name) || ownedPrefix.test(name))
      continue;
    if (byNpm && (npmName.test(name) || (name === "NODE" && value === env.npm_node_execpath))) continue;
    result[name] = byNpm && name === "PATH" ? withoutNpmFolders(value) : value;
  }
  return { ...result, CI: "1", NO_COLOR: "1" };
}
