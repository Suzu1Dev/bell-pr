/**
 * How BELL PR tells whether two repository paths or scopes name a common
 * file. Overlap warnings (group-local.ts) and coordination claims
 * (coordination.ts) share these rules, so the two never disagree.
 */
import { safeRelativePath, sensitivePath } from "./git.js";

/** ASCII lower case only, so every build and Node release folds alike. */
export const foldPath = (value: string) =>
  value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
const directory = (scope: string) => (scope.endsWith("/") ? scope : `${scope}/`);

/**
 * Whether two paths or scopes name a common file: the same, or one is a
 * directory above the other. An exact name also meets what is below it,
 * because a file and a directory cannot share a name.
 */
export function pathsMeet(left: string, right: string) {
  const [a, b] = [foldPath(left), foldPath(right)];
  return a === b || b.startsWith(directory(a)) || a.startsWith(directory(b));
}

/**
 * For each scope, the index of the nearest other scope at or above it
 * (the same in ASCII case, or a directory above), or -1. Two scopes meet
 * (pathsMeet) exactly when following these links from one reaches the
 * other, so checking a set of scopes takes one sort instead of comparing
 * each with each. Only for claimable scopes (claimableScope): no "./", no
 * trailing "/", nothing outside printable ASCII.
 */
export function scopeParents(scopes: string[]): number[] {
  // "/" made the lowest character, so a scope sorts right before
  // everything below it, and nothing else sorts in between.
  const keys = scopes.map((scope) => foldPath(scope).replaceAll("/", "\0"));
  const order = keys
    .map((_, index) => index)
    .sort((a, b) => (keys[a] < keys[b] ? -1 : keys[a] > keys[b] ? 1 : a - b));
  const parents = scopes.map(() => -1);
  // The scopes above the one being placed, outermost first.
  const above: number[] = [];
  for (const index of order) {
    const key = keys[index];
    while (above.length) {
      const top = keys[above[above.length - 1]];
      if (key === top || key.startsWith(`${top}\0`)) break;
      above.pop();
    }
    if (above.length) parents[index] = above[above.length - 1];
    above.push(index);
  }
  return parents;
}

/** Whether `scope` holds `file`: the same path, or a directory above it, in any ASCII case. */
export function scopeHolds(scope: string, file: string) {
  const [a, b] = [foldPath(scope), foldPath(file)];
  return a === b || b.startsWith(directory(a));
}

/** scopeHolds for one set of scopes and many files: whether any of `scopes` holds a file. */
export function scopesHolding(scopes: string[]) {
  const folded = scopes.map((scope) => [foldPath(scope), directory(foldPath(scope))] as const);
  return (file: string) => {
    const name = foldPath(file);
    return folded.some(([scope, below]) => name === scope || name.startsWith(below));
  };
}

/**
 * A claimable scope spelled one way: the path without "./" or a trailing
 * "/", or undefined when it cannot be compared reliably with every other
 * spelling of the same file on every file system a participant may use.
 * Rejected, rather than guessed at: anything outside printable ASCII
 * (Unicode normalisation and case folding differ between file systems),
 * backslashes, empty, "." and ".." segments, segments with leading or
 * trailing spaces or a trailing dot (Windows drops those), Windows short
 * names ("PROGRA~1"), characters Windows cannot store (`:*?"<>|`), glob
 * braces, ".git" in any case and the files BELL PR holds back
 * (sensitivePath). The whole repository is not a scope.
 */
export function claimableScope(raw: string): string | undefined {
  if (typeof raw !== "string" || raw.length > 1024) return undefined;
  const scope = raw.replace(/^(?:\.\/)+/, "").replace(/\/$/, "");
  if (
    !scope ||
    !/^[\x20-\x7e]+$/.test(scope) ||
    !safeRelativePath(scope) ||
    /[:*?"<>|{}]/.test(scope) ||
    sensitivePath(scope) ||
    sensitivePath(foldPath(scope))
  )
    return undefined;
  const segments = scope.split("/");
  if (
    segments.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        part !== part.trim() ||
        part.endsWith(".") ||
        /~\d/.test(part) ||
        foldPath(part) === ".git",
    )
  )
    return undefined;
  return scope;
}

/**
 * Whether a path (one Git reported, or one about to be written) can be
 * checked against claims: relative, inside the repository, one spelling
 * per segment, and nothing Git keeps for itself. Callers refuse a path
 * that is not; one that is but lies outside every scope of a claim is
 * held by none, so the check fails closed either way.
 */
export function comparablePath(file: string) {
  return (
    typeof file === "string" &&
    !!file &&
    file.length <= 4096 &&
    safeRelativePath(file) &&
    file
      .split("/")
      .every((part) => !!part && part !== "." && foldPath(part) !== ".git")
  );
}
