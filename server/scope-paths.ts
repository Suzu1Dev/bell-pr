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

const maxLineNumber = 1_000_000;
const lineRangePattern = /^(.*)#L([1-9]\d{0,6})(?:-L?([1-9]\d{0,6}))?$/i;

export interface ParsedScope {
  path: string;
  start?: number;
  end?: number;
}

/**
 * Splits an optional `#L<start>-L<end>` line-range anchor from a path or
 * scope. Returns `{ path }` without `start`/`end` when no valid anchor is
 * present; callers that validate user input use `claimableScope` first.
 */
export function splitScope(value: string): ParsedScope {
  const match = lineRangePattern.exec(value);
  if (!match || !match[1]) return { path: value };
  const start = Number(match[2]);
  const end = match[3] ? Number(match[3]) : start;
  if (start < 1 || end < start || end > maxLineNumber) return { path: value };
  return { path: match[1], start, end };
}

/** Strips any `#L<start>-L<end>` anchor from a scope, leaving the repository path. */
export const baseScopePath = (value: string) => splitScope(value).path;

/**
 * Whether two paths or scopes name a common file or overlapping region:
 * - On different paths: one is a directory above the other.
 * - On the same file: if both name line ranges (`#Lstart-Lend`), they meet
 *   only when those line intervals overlap; if either holds the whole file,
 *   they always meet.
 */
export function pathsMeet(left: string, right: string) {
  const l = splitScope(left);
  const r = splitScope(right);
  const [a, b] = [foldPath(l.path), foldPath(r.path)];
  if (a === b) {
    if (
      l.start !== undefined &&
      l.end !== undefined &&
      r.start !== undefined &&
      r.end !== undefined
    ) {
      return l.start <= r.end && r.start <= l.end;
    }
    return true;
  }
  return b.startsWith(directory(a)) || a.startsWith(directory(b));
}

/**
 * For each scope, the index of the nearest other scope at or above it
 * (the same in ASCII case, a directory above, or an overlapping earlier line
 * range on the same file), or -1. Only for claimable scopes (claimableScope):
 * no "./", no trailing "/", nothing outside printable ASCII.
 */
export function scopeParents(scopes: string[]): number[] {
  const parsed = scopes.map(splitScope);
  // "/" made the lowest character, so a scope sorts right before
  // everything below it, and whole-file scopes sort before `#L...` ranges.
  const keys = parsed.map(({ path }) => foldPath(path).replaceAll("/", "\0"));
  const order = keys
    .map((_, index) => index)
    .sort((a, b) => {
      if (keys[a] !== keys[b]) return keys[a] < keys[b] ? -1 : 1;
      const ra = parsed[a];
      const rb = parsed[b];
      if ((ra.start === undefined) !== (rb.start === undefined))
        return ra.start === undefined ? -1 : 1;
      if (ra.start !== undefined && rb.start !== undefined) {
        if (ra.start !== rb.start) return ra.start - rb.start;
        if (ra.end !== rb.end) return (rb.end ?? 0) - (ra.end ?? 0);
      }
      return a - b;
    });
  const parents = scopes.map(() => -1);
  // Directory / whole-file ancestors, outermost first.
  const above: number[] = [];
  let rangeKey = "";
  let maxEnd = -1;
  let maxEndIndex = -1;
  for (const index of order) {
    const key = keys[index];
    const item = parsed[index];
    while (above.length) {
      const top = keys[above[above.length - 1]];
      if (key === top || key.startsWith(`${top}\0`)) break;
      above.pop();
    }
    if (item.start === undefined || item.end === undefined) {
      if (above.length) parents[index] = above[above.length - 1];
      above.push(index);
      rangeKey = "";
      maxEnd = -1;
      maxEndIndex = -1;
    } else {
      if (key !== rangeKey) {
        rangeKey = key;
        maxEnd = -1;
        maxEndIndex = -1;
      }
      if (maxEndIndex >= 0 && item.start <= maxEnd) {
        parents[index] = maxEndIndex;
      } else if (above.length) {
        parents[index] = above[above.length - 1];
      }
      if (item.end > maxEnd) {
        maxEnd = item.end;
        maxEndIndex = index;
      }
    }
  }
  return parents;
}

/** Whether `scope` holds `file`: the same path (covering its range if ranged), or a directory above it. */
export function scopeHolds(scope: string, file: string) {
  const s = splitScope(scope);
  const f = splitScope(file);
  const [a, b] = [foldPath(s.path), foldPath(f.path)];
  if (s.start === undefined || s.end === undefined) {
    return a === b || b.startsWith(directory(a));
  }
  if (a !== b) return false;
  if (f.start === undefined || f.end === undefined) return true;
  return s.start <= f.start && f.end <= s.end;
}

/** scopeHolds for one set of scopes and many files: whether any of `scopes` holds a file. */
export function scopesHolding(scopes: string[]) {
  return (file: string) => scopes.some((scope) => scopeHolds(scope, file));
}

function cleanBasePath(raw: string): string | undefined {
  const scope = raw.replace(/^(?:\.\/)+/, "").replace(/\/$/, "");
  if (
    !scope ||
    scope.includes("#") ||
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
 * A claimable scope spelled one way: the path without "./" or a trailing
 * "/", with an optional canonical `#L<start>-L<end>` line-range anchor, or
 * undefined when it cannot be compared reliably.
 */
export function claimableScope(raw: string): string | undefined {
  if (typeof raw !== "string" || raw.length > 1024) return undefined;
  const hashIndex = raw.indexOf("#");
  if (hashIndex < 0) return cleanBasePath(raw);
  // A folder path ending with "/" before "#L..." cannot have line numbers.
  if (hashIndex === 0 || raw[hashIndex - 1] === "/") return undefined;
  const match = lineRangePattern.exec(raw);
  if (!match) return undefined;
  const base = cleanBasePath(match[1]);
  if (!base) return undefined;
  const start = Number(match[2]);
  const end = match[3] ? Number(match[3]) : start;
  if (start < 1 || end < start || end > maxLineNumber) return undefined;
  return `${base}#L${start}-L${end}`;
}

/**
 * Whether a path (one Git reported, or one about to be written, optionally
 * with a `#L<start>-L<end>` range) can be checked against claims.
 */
export function comparablePath(file: string) {
  if (typeof file !== "string" || !file || file.length > 4096) return false;
  const { path: base } = splitScope(file);
  if (base.includes("#")) return false;
  return (
    !!base &&
    safeRelativePath(base) &&
    base
      .split("/")
      .every((part) => !!part && part !== "." && foldPath(part) !== ".git")
  );
}
