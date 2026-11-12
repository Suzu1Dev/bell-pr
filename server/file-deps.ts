/**
 * Cross-file dependency discovery and conflict matching (1c).
 *
 * Scans tracked source files in a repository for relative module imports
 * (TypeScript, JavaScript and Python) without external dependencies, and
 * matches both manual cross-file dependency rules (`warn` | `block`) and
 * auto-detected import edges against held claims.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type {
  CollabDependencyHit,
  CollabDetectedImport,
  CollabFileDependency,
} from "../shared/collab.js";
import { baseScopePath, claimableScope, foldPath, pathsMeet } from "./scope-paths.js";

const maxScannedFiles = 400;
const maxFileBytes = 128 * 1024;
const cacheTtlMs = 30_000;

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py"]);
const resolveExtensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const ignoredDirs = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  "vendor",
  "__pycache__",
  ".venv",
]);

interface CachedScan {
  at: number;
  imports: CollabDetectedImport[];
}

const scanCache = new Map<string, CachedScan>();

const jsImportPattern =
  /(?:import|export)\s+(?:type\s+)?(?:[^"'`]*?\s+from\s+)?["'](\.\.?\/[^"'\r\n]+)["']|import\(\s*["'](\.\.?\/[^"'\r\n]+)["']\s*\)|require\(\s*["'](\.\.?\/[^"'\r\n]+)["']\s*\)/g;
const pyImportPattern = /^\s*from\s+(\.+[A-Za-z0-9_.]*)\s+import\s+/gm;

async function walkSourceFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  const queue = [""];
  while (queue.length && found.length < maxScannedFiles) {
    const relDir = queue.shift()!;
    const absDir = relDir ? path.join(root, relDir) : root;
    const entries = await readdir(absDir, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (found.length >= maxScannedFiles) break;
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entry.name) && !entry.name.startsWith(".")) queue.push(relPath);
      } else if (entry.isFile() && sourceExtensions.has(path.extname(entry.name).toLowerCase())) {
        if (claimableScope(relPath)) found.push(relPath);
      }
    }
  }
  return found;
}

function resolveJsSpecifier(fromFile: string, specifier: string, knownByFolded: Map<string, string>): string | undefined {
  const clean = specifier.split(/[?#]/, 1)[0];
  if (!clean) return undefined;
  const dir = path.posix.dirname(fromFile);
  const joined = path.posix.normalize(dir === "." ? clean : `${dir}/${clean}`);
  if (joined.startsWith("..") || path.posix.isAbsolute(joined)) return undefined;
  const candidates = [joined];
  // TypeScript ESM imports spell `.ts` / `.tsx` sources as `.js` / `.jsx`.
  if (/\.[cm]?jsx?$/i.test(joined)) {
    const stem = joined.replace(/\.[cm]?jsx?$/i, "");
    for (const ext of resolveExtensions) candidates.push(`${stem}${ext}`);
  } else {
    for (const ext of resolveExtensions) candidates.push(`${joined}${ext}`);
    for (const ext of resolveExtensions) candidates.push(`${joined}/index${ext}`);
  }
  for (const candidate of candidates) {
    const match = knownByFolded.get(foldPath(candidate));
    if (match) return match;
  }
  return undefined;
}

function resolvePySpecifier(fromFile: string, specifier: string, knownByFolded: Map<string, string>): string | undefined {
  const dots = /^\.+/.exec(specifier)?.[0].length ?? 0;
  if (!dots) return undefined;
  const rest = specifier.slice(dots).replaceAll(".", "/");
  let dir = path.posix.dirname(fromFile);
  for (let i = 1; i < dots; i += 1) dir = path.posix.dirname(dir);
  const base = path.posix.normalize([dir === "." ? "" : dir, rest].filter(Boolean).join("/"));
  if (!base || base.startsWith("..")) return undefined;
  for (const candidate of [`${base}.py`, `${base}/__init__.py`]) {
    const match = knownByFolded.get(foldPath(candidate));
    if (match) return match;
  }
  return undefined;
}

/**
 * Scans a repository working tree for relative file-to-file imports. Cached
 * briefly in memory and writes nothing to disk.
 */
export async function scanRepositoryImports(repoPath: string | undefined): Promise<CollabDetectedImport[]> {
  if (!repoPath) return [];
  const now = Date.now();
  const cached = scanCache.get(repoPath);
  if (cached && now - cached.at < cacheTtlMs) return cached.imports;

  const rootStat = await stat(repoPath).catch(() => undefined);
  if (!rootStat?.isDirectory()) return [];

  const files = await walkSourceFiles(repoPath);
  const knownByFolded = new Map(files.map((file) => [foldPath(file), file]));
  const seen = new Set<string>();
  const imports: CollabDetectedImport[] = [];

  for (const file of files) {
    const abs = path.join(repoPath, file);
    const info = await stat(abs).catch(() => undefined);
    if (!info || info.size > maxFileBytes) continue;
    const content = await readFile(abs, "utf8").catch(() => "");
    if (!content) continue;
    if (file.endsWith(".py")) {
      pyImportPattern.lastIndex = 0;
      for (let match = pyImportPattern.exec(content); match; match = pyImportPattern.exec(content)) {
        const target = resolvePySpecifier(file, match[1], knownByFolded);
        if (!target || foldPath(target) === foldPath(file)) continue;
        const key = `${foldPath(file)}\0${foldPath(target)}`;
        if (!seen.has(key)) {
          seen.add(key);
          imports.push({ from: file, to: target });
        }
      }
    } else {
      jsImportPattern.lastIndex = 0;
      for (let match = jsImportPattern.exec(content); match; match = jsImportPattern.exec(content)) {
        const spec = match[1] ?? match[2] ?? match[3];
        if (!spec) continue;
        const target = resolveJsSpecifier(file, spec, knownByFolded);
        if (!target || foldPath(target) === foldPath(file)) continue;
        const key = `${foldPath(file)}\0${foldPath(target)}`;
        if (!seen.has(key)) {
          seen.add(key);
          imports.push({ from: file, to: target });
        }
      }
    }
  }

  imports.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
  scanCache.set(repoPath, { at: now, imports });
  return imports;
}

export interface HeldClaimSummary {
  claimId: string;
  holderId: string;
  holderName: string;
  title: string;
  scopes: readonly string[];
}

/**
 * Finds cross-file dependencies where an asked path touches one side of a
 * dependency edge (`from` or `to`) and another teammate holds the counterpart
 * path. Direct overlaps on the same path are omitted because `meets` already
 * reports them.
 */
export function matchFileDependencies({
  askedScopes,
  heldClaims,
  excludeHolderIds,
  manualDeps = [],
  detectedImports = [],
}: {
  askedScopes: readonly string[];
  heldClaims: readonly HeldClaimSummary[];
  excludeHolderIds: ReadonlySet<string>;
  manualDeps?: readonly CollabFileDependency[];
  detectedImports?: readonly CollabDetectedImport[];
}): CollabDependencyHit[] {
  if (!askedScopes.length || !heldClaims.length) return [];
  const otherClaims = heldClaims.filter((claim) => !excludeHolderIds.has(claim.holderId));
  if (!otherClaims.length) return [];

  const manualPairs = new Set<string>();
  const edges: {
    from: string;
    to: string;
    mode: "warn" | "block";
    autoDetected?: true;
    note?: string;
  }[] = [];

  for (const dep of manualDeps) {
    const key = [foldPath(dep.from), foldPath(dep.to)].sort().join("\0");
    manualPairs.add(key);
    edges.push({
      from: dep.from,
      to: dep.to,
      mode: dep.mode,
      ...(dep.note ? { note: dep.note } : {}),
    });
  }
  for (const imp of detectedImports) {
    const key = [foldPath(imp.from), foldPath(imp.to)].sort().join("\0");
    if (manualPairs.has(key)) continue;
    edges.push({ from: imp.from, to: imp.to, mode: "warn", autoDetected: true });
  }

  const hits: CollabDependencyHit[] = [];
  const seenHits = new Set<string>();

  for (const asked of askedScopes) {
    const askedBase = baseScopePath(asked);
    for (const edge of edges) {
      const touchesFrom = pathsMeet(askedBase, edge.from);
      const touchesTo = pathsMeet(askedBase, edge.to);
      if (!touchesFrom && !touchesTo) continue;
      const counterpart = touchesFrom ? edge.to : edge.from;
      for (const claim of otherClaims) {
        // Skip if this claim already directly meets the asked scope.
        if (claim.scopes.some((scope) => pathsMeet(asked, scope))) continue;
        const heldScope = claim.scopes.find((scope) => pathsMeet(baseScopePath(scope), counterpart));
        if (!heldScope) continue;
        const dedupeKey = `${foldPath(askedBase)}\0${claim.claimId}\0${foldPath(counterpart)}`;
        if (seenHits.has(dedupeKey)) continue;
        seenHits.add(dedupeKey);
        hits.push({
          askedPath: askedBase,
          heldPath: heldScope,
          holder: claim.holderName,
          title: claim.title,
          claimId: claim.claimId,
          mode: edge.mode,
          ...(edge.autoDetected ? { autoDetected: true } : {}),
          ...(edge.note ? { note: edge.note } : {}),
        });
      }
    }
  }
  return hits;
}
