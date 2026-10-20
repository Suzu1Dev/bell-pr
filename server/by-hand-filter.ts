/**
 * The code filter's file access (DESIGN v1.2 F7; the rules are in
 * shared/by-hand-filter.ts). A reader serves one turn: it reads a file at
 * the run's base commit through `git cat-file blob <baseSha>:<path>` and in
 * the person's worktree (only a file Git tracks or would track, never an
 * ignored one such as .env or node_modules), at most 10 files per answer,
 * each once per `(sha, path)` for the turn. Paths come from agent output, so only a
 * normalised repository path is read (never absolute, with "." or ".."
 * parts, a backslash or a control character); a folder, a missing path
 * (`git show` would read one with *, ? or [ as a pattern and print
 * nothing), a binary file or a link out of the worktree has no lines.
 */
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  filterAgentText,
  filterCodeField,
  filterGuideOutput,
  type FilterSources,
  type GuideOutput,
} from "../shared/by-hand-filter.js";
import { sm } from "./i18n/index.js";
import { git } from "./process.js";
import { AppError, type Run } from "./types.js";

/** Files read for one answer. */
const maxFiles = 10;
/** A larger file is not read: no quote is cut from it. */
const maxFileBytes = 1_000_000;

/** A normalised repository-relative path BELL may read: no absolute path, ".", "..", option-like start, backslash or control character. */
function safePath(file: string) {
  if (!file || /[\p{Cc}\\]/u.test(file) || path.isAbsolute(file) || file.startsWith("-")) return false;
  return path.posix.normalize(file) === file && !file.split("/").some((part) => part === ".." || part === "." || part === "");
}

/** A text file's lines; a binary file (a NUL byte) has none. */
const lines = (text: string) => (text.includes("\0") ? undefined : text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n"));

/** Reads the files of one turn, each once. */
export function turnFiles(run: Pick<Run, "baseSha" | "worktreePath">) {
  const cache = new Map<string, Promise<string[] | undefined>>();
  const once = (key: string, read: () => Promise<string[] | undefined>) => {
    let value = cache.get(key);
    if (!value) {
      value = read().catch(() => undefined);
      cache.set(key, value);
    }
    return value;
  };
  const base = (file: string) =>
    once(`${run.baseSha}\0${file}`, async () => {
      // A blob only: no pathspec, no folder listing, and a missing path fails.
      const { stdout } = await git(run.worktreePath, ["cat-file", "blob", `${run.baseSha}:${file}`], { maxBytes: maxFileBytes });
      return lines(stdout);
    });
  const worktree = (file: string) =>
    once(`worktree\0${file}`, async () => {
      // Only a file Git tracks or would track (untracked, not ignored): never .env, node_modules or build output.
      const listed = await git(run.worktreePath, ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", file]);
      if (!listed.stdout.split("\0").includes(file)) return undefined;
      const root = await realpath(run.worktreePath);
      const full = await realpath(path.join(root, file));
      if (full !== root && !full.startsWith(`${root}${path.sep}`)) return undefined;
      const info = await stat(full);
      if (!info.isFile() || info.size > maxFileBytes) return undefined;
      return lines(await readFile(full, "utf8"));
    });
  return {
    /**
     * The sources for one answer: the cited files first, then the changed
     * ones, at most 10, at base and in the worktree.
     */
    async sources(
      files: readonly string[],
      extra: { diff?: string; protectedFiles?: readonly string[] } = {},
    ): Promise<FilterSources> {
      const chosen = [...new Set(files)].filter(safePath).slice(0, maxFiles);
      const read = await Promise.all(
        chosen.map(async (file) => [file, await base(file), await worktree(file)] as const),
      );
      return {
        base: Object.fromEntries(read.map(([file, lines]) => [file, lines])),
        worktree: Object.fromEntries(read.map(([file, , lines]) => [file, lines])),
        ...(extra.diff ? { diff: extra.diff } : {}),
        ...(extra.protectedFiles ? { protectedFiles: extra.protectedFiles } : {}),
      };
    },
  };
}

/** What a filter call knows of the change: its files, the step's files and the diff. */
export interface FilterChange {
  changed: readonly string[];
  stepFiles?: readonly string[];
  diff?: string;
}

/** Filters one guide answer for storing, reading its cited files and the changed ones. */
export async function filterGuideAnswer(
  files: ReturnType<typeof turnFiles>,
  output: GuideOutput,
  change: FilterChange,
) {
  const cited = [...output.refs.map((ref) => ref.path), ...output.quotes.map((quote) => quote.path)];
  const sources = await files.sources([...cited, ...change.changed], {
    diff: change.diff,
    protectedFiles: [...change.changed, ...(change.stepFiles ?? [])],
  });
  return filterGuideOutput(output, sources);
}

/** Filters agent text for storing (a report, a chat answer, premise evidence) against the changed files. */
export async function filterStoredText(
  files: ReturnType<typeof turnFiles>,
  text: string,
  change: FilterChange & { cited?: readonly string[] },
) {
  const sources = await files.sources([...(change.cited ?? []), ...change.changed], {
    diff: change.diff,
    protectedFiles: [...change.changed, ...(change.stepFiles ?? [])],
  });
  return filterAgentText(text, sources);
}

/** Keeps a code field (an explanation's example.before/after) only when verbatim in base or worktree. */
export async function filterStoredCode(
  files: ReturnType<typeof turnFiles>,
  value: string | undefined,
  change: FilterChange & { cited?: readonly string[] },
) {
  const sources = await files.sources([...(change.cited ?? []), ...change.changed]);
  return filterCodeField(value, sources);
}

/** No file: agent text checked on its own, so every invented name and code shape goes. */
const noFiles: FilterSources = { base: {}, worktree: {} };

/** A Learn-by-hand agent's text for the run log, the agent card or an error (DESIGN v1.2 F7): filtered against no file. */
export const byHandLogText = (text: string) => filterAgentText(text, noFiles).value;

/**
 * A Learn-by-hand agent turn's error for the person (F7), the one helper
 * the flow (server/by-hand.ts and its callers) and the guide
 * (server/by-hand-guide.ts) use: a CLI's failure can quote the agent, so
 * its message is filtered against no file. BELL's timeout (504) and setup
 * messages (with an error code) stay whole.
 */
export function filteredError(error: unknown): Error {
  if (error instanceof AppError && (error.statusCode === 504 || error.code)) return error;
  const message = error instanceof Error ? error.message : String(error);
  const { value, removed } = filterAgentText(message, noFiles);
  if (!removed) return error instanceof Error ? error : new Error(message);
  return error instanceof AppError ? new AppError(value, error.statusCode, { params: error.params, fixes: error.fixes }) : new Error(value);
}

/** Read tools whose plain arguments the run log may show as the agent ran them. */
const readTool = /^(?:rg|grep|ls|cat|head|tail|wc|nl|find|tree|stat|file|sed -n|git (?:grep|log|show|diff|status|blame|ls-files))(?= |$)/;
/** A flag, a word, a number or a path: never a quote, an operator, a glob or an escape. */
const plainArgument = /^(?:-{1,2}[A-Za-z][\w-]*(?:=[\w./:,@-]+)?|[\w./:,@-]+)$/;

/**
 * A command a Learn-by-hand agent ran, as the run log shows it: as written
 * when it is a known read tool with plain arguments the filter leaves
 * alone, else undefined and the log only says that the guide ran a
 * read-only command (a search pattern can spell the fix).
 */
export function byHandCommandLine(command: string | undefined) {
  if (!command || !readTool.test(command) || !command.split(/\s+/).every((part) => plainArgument.test(part))) return undefined;
  return filterAgentText(command, noFiles).removed ? undefined : command;
}

/**
 * A Learn-by-hand agent turn's error (DESIGN v1.2 F7): a CLI that exited
 * with an error is reported with the end of its stderr, filtered, never
 * with its stdout, which holds the agent's own text; the stderr in any
 * error's details is filtered. BELL's own messages (a timeout, a setup
 * problem, a cancellation) stay whole; the error itself when it has no
 * stderr.
 */
export function byHandAgentError(error: unknown, executable?: string): unknown {
  const details = error instanceof AppError ? error.details : undefined;
  if (!(error instanceof AppError) || typeof details?.stderr !== "string") return error;
  const stderr = details.stderr;
  const exited = !!executable && error.statusCode === 422 && !error.code;
  const output = byHandLogText((stderr || `exit ${String(details.exitCode ?? "?")}`).slice(-1800));
  const message = exited ? sm().run.command.failed({ executable: executable!, output }) : error.message;
  return new AppError(message, error.statusCode, { code: error.code, params: error.params, fixes: error.fixes, details: { ...details, stderr: byHandLogText(stderr) } });
}
