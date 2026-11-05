/**
 * Splitting a contribution into separate ones. A maintainer reviews one fix
 * faster than several, so BELL PR looks for the independent parts of a
 * change in the agent team's plan (`suggestSplit`, in reviewability.ts) and
 * lets the person move each part into a contribution of its own. A file
 * belongs to one contribution; it is never cut into hunks.
 */
import type { RunGroup } from "./types.js";

/** A contribution a split started from or made, as the run lists it. */
export interface SplitRef {
  runId: string;
  title: string;
}

/** What a split request may hold: 2 to 8 contributions, each with 1 or more files. */
export const splitLimits = {
  minContributions: 2,
  maxContributions: 8,
  titleChars: 120,
  maxPaths: 150,
} as const;

/**
 * The most parts one part may build on (`Run.group.after`). A split makes
 * at most 7 others, and splitting a part again replaces it with its parts,
 * so more than this is not reached in practice.
 */
export const groupAfterLimit = 64;

/**
 * Drops what `run` links to a deleted contribution, in place: the original it
 * was split from, the part from its list, or the part it builds on. A list
 * left empty goes, so the original can be split again. A part it built on
 * becomes `builtOn` when given: the original that part was split from,
 * which holds its files again. Returns whether anything changed.
 */
export function dropSplitLinks(
  run: { id?: string; splitFrom?: SplitRef; splitInto?: SplitRef[]; group?: RunGroup },
  removedId: string,
  builtOn?: string,
) {
  let changed = false;
  const after = run.group?.after?.flatMap((id) =>
    // A part never builds on itself or on the original it came from.
    id !== removedId ? [id] : builtOn && builtOn !== run.id && builtOn !== run.splitFrom?.runId ? [builtOn] : [],
  );
  if (after && after.join("\0") !== run.group?.after?.join("\0")) {
    // A new object: the client passes a shallow copy of its open run.
    const { after: _removed, ...rest } = run.group!;
    const group = after.length ? { ...rest, after: [...new Set(after)] } : rest;
    if (Object.keys(group).length) run.group = group;
    else delete run.group;
    changed = true;
  }
  if (run.splitFrom?.runId === removedId) {
    delete run.splitFrom;
    changed = true;
  }
  const into = run.splitInto?.filter((ref) => ref.runId !== removedId);
  if (into && into.length !== run.splitInto?.length) {
    if (into.length) run.splitInto = into;
    else delete run.splitInto;
    changed = true;
  }
  return changed;
}

/** The body of `POST /api/runs/:id/split`. */
export interface SplitRequest {
  contributions: { title: string; paths: string[] }[];
}

/**
 * One group of files and plan tasks that belong together. The plan splits work
 * by file, often for speed, so a part is not always one fix: `issues` lists
 * the issue numbers its tasks cite, and a part that cites several holds
 * several fixes in files BELL PR cannot cut apart.
 */
export interface SplitPart {
  title: string;
  paths: string[];
  taskIds: string[];
  issues: string[];
  /**
   * The part's files whose tasks cite more than one issue between them, grouped
   * by those issues: each holds several fixes that no split can separate.
   */
  mixed: { paths: string[]; issues: string[] }[];
}

export interface SplitSuggestion {
  /** The independent parts, in plan order; a change with one part has nothing to split. */
  parts: SplitPart[];
  /**
   * Changed files that belong to no part: tied to no plan task, or only to
   * tasks that change tests or documentation. The person places them.
   */
  unassigned: string[];
}

/** What a plan task contributes to the suggestion: `TeamTask` has all of it. */
export interface SplitTask {
  id: string;
  title: string;
  description?: string;
  /** Scopes: file names or directory prefixes ending with "/". */
  files: readonly string[];
  dependsOn?: readonly string[];
  /** The paths the task really changed; absent on old runs, which fall back to the scopes. */
  integratedFiles?: readonly string[];
}
