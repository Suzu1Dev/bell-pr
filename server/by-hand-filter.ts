/**
 * The code filter's file access (DESIGN v1.2 F7; the rules are in
 * shared/by-hand-filter.ts). A reader serves one turn: it reads a file at
 * the run's base commit through `git show <baseSha>:<path>` and in the
 * person's worktree, at most 10 files per answer, each once per
 * `(sha, path)` for the turn. Paths come from agent output, so a path that
 * is absolute, climbs out with "..", or leads outside the worktree through
 * a link is never read.
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
import { git } from "./process.js";
import type { Run } from "./types.js";

/** Files read for one answer. */
const maxFiles = 10;
/** A larger file is not read: no quote is cut from it. */
const maxFileBytes = 1_000_000;

/** A repository-relative path BELL may read: no absolute path, no "..", no option-like start. */
function safePath(file: string) {
  if (!file || file.includes("\0") || path.isAbsolute(file) || file.startsWith("-")) return false;
  return !path.posix.normalize(file).split("/").some((part) => part === ".." || part === "");
}

const lines = (text: string) => text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");

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
      const { stdout } = await git(run.worktreePath, ["show", `${run.baseSha}:${file}`], { maxBytes: maxFileBytes });
      return lines(stdout);
    });
  const worktree = (file: string) =>
    once(`worktree\0${file}`, async () => {
      const root = await realpath(run.worktreePath);
      const full = await realpath(path.join(root, file));
      if (full !== root && !full.startsWith(`${root}${path.sep}`)) return undefined;
      if ((await stat(full)).size > maxFileBytes) return undefined;
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
