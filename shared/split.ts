/**
 * Splitting a contribution into separate ones. A maintainer reviews one fix
 * faster than several, so BELL PR looks for the independent parts of a
 * change in the agent team's plan (`suggestSplit`, in reviewability.ts) and
 * lets the person move each part into a contribution of its own. A file
 * belongs to one contribution; it is never cut into hunks.
 */

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
 * Drops what `run` links to a deleted contribution, in place: the original it
 * was split from, or the part from its list. A list left empty goes, so the
 * original can be split again. Returns whether anything changed.
 */
export function dropSplitLinks(
  run: { splitFrom?: SplitRef; splitInto?: SplitRef[] },
  removedId: string,
) {
  let changed = false;
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
