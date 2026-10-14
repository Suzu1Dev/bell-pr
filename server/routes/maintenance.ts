/**
 * Storage maintenance: freeing a run's files, deleting a run, a project or
 * all data, GET /api/storage and GET /api/diagnostics.
 *
 * Owned by 3C-reliability-storage. createApp already registers this module
 * in its fixed place, before the /api 404 handler.
 */
import type { Express } from "express";
import { readFileSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { product } from "../../shared/product.js";
import { runDoctor } from "../doctor.js";
import { recentLogLines } from "../log.js";
import { redact } from "../secrets.js";
import { AppError } from "../types.js";
import type { RouteDeps } from "./types.js";

let packageVersionCache: string | undefined;

/**
 * The version in BELL PR's own package.json, found next to this module
 * whether it runs from server/routes or from a bundled build; the API
 * reports AppOptions.version first when the server passes one.
 */
function packageVersion() {
  if (packageVersionCache) return packageVersionCache;
  let directory = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 4; depth++) {
    try {
      const value = JSON.parse(
        readFileSync(path.join(directory, "package.json"), "utf8"),
      ) as { name?: string; version?: string };
      if (value.name === product.npmPackage && value.version)
        return (packageVersionCache = value.version);
    } catch {
      // Not here; look one directory up.
    }
    directory = path.dirname(directory);
  }
  return (packageVersionCache = "unknown");
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Makes text safe to paste into a support request: secrets masked, the
 * data directory shown as `<data>`, the home directory as `~`, any other
 * absolute path as `[path]`, and the GitHub login as `[github-user]`.
 */
export function scrubber(dataDir: string, login?: string) {
  const replacements: [RegExp, string][] = [];
  const literal = (value: string, replacement: string) => {
    if (value.length > 1)
      replacements.push([new RegExp(escape(value), "g"), replacement]);
  };
  const resolved = path.resolve(dataDir);
  let real = resolved;
  try {
    real = realpathSync(resolved);
  } catch {
    // Not created yet; the resolved path is the only spelling.
  }
  if (real !== resolved) literal(real, "<data>");
  literal(resolved, "<data>");
  literal(os.homedir(), "~");
  // file: URLs; POSIX paths not preceded by a URL scheme, a word, `~` or
  // `<data>`; Windows drive paths, also as escaped in JSON.
  replacements.push([/\bfile:\/\/[^\s"'`<>|;,()[\]{}]+/g, "[path]"]);
  replacements.push([/(?<![\w.~>:/\\-])\/[^\s"'`<>|;,()[\]{}]+/g, "[path]"]);
  replacements.push([/\b[A-Za-z]:\\{1,2}[^\s"'`<>|;,()[\]{}]*/g, "[path]"]);
  if (login && /^[A-Za-z0-9-]+$/.test(login))
    replacements.push([
      new RegExp(`(?<![\\w-])${escape(login)}(?![\\w-])`, "gi"),
      "[github-user]",
    ]);
  return (text: string) =>
    replacements.reduce(
      (result, [pattern, replacement]) => result.replace(pattern, replacement),
      redact(text),
    );
}

async function diagnostics({ workbench, options }: RouteDeps) {
  const directory = workbench.store.directory;
  const [doctor, storage, lines] = await Promise.all([
    runDoctor(),
    workbench.storage(),
    recentLogLines(directory, 500),
  ]);
  const login = doctor.checks.find((check) => check.id === "gh-auth")?.detail;
  const scrub = scrubber(directory, login);
  const ready = (id: string) =>
    doctor.checks.find((check) => check.id === id)?.status === "ok";
  return {
    app: {
      name: product.name,
      version: scrub(options.version ?? packageVersion()),
    },
    node: process.version,
    os: { platform: process.platform, release: os.release(), arch: process.arch },
    // Versions and states only: a check's detail can name the account.
    checks: doctor.checks.map((check) => ({
      id: check.id,
      status: check.status,
      required: check.required,
      ...(check.version ? { version: scrub(check.version) } : {}),
    })),
    auth: {
      codex: ready("codex-auth"),
      claude: ready("claude-auth"),
      github: ready("gh-auth"),
    },
    ready: doctor.ready,
    limits: workbench.limits,
    ...(workbench.store.recovery ? { recovery: workbench.store.recovery } : {}),
    dataDir: {
      totalBytes: storage.totalBytes,
      logsBytes: storage.logsBytes,
      repos: storage.repos.length,
      runs: storage.runs.length,
      retentionDays: storage.retentionDays,
    },
    logs: lines.map(scrub),
  };
}

export function registerMaintenanceRoutes(app: Express, deps: RouteDeps) {
  const { workbench, discovery } = deps;
  app.delete("/api/runs/:id/workspace", async (req, res) => {
    res.json({ run: await workbench.removeWorkspace(req.params.id) });
  });
  app.delete("/api/runs/:id", async (req, res) => {
    res.json(await workbench.removeRun(req.params.id));
  });
  app.delete("/api/repos/:id", async (req, res) => {
    res.json(await workbench.removeRepository(req.params.id));
  });
  app.post("/api/data/erase", async (req, res) => {
    const confirm = (req.body as { confirm?: unknown } | undefined)?.confirm;
    if (confirm !== "ERASE")
      throw new AppError((m) => m.storage.erase.confirm, 400);
    // An unreadable discovery file is erased too; only a running search waits.
    const job = await discovery.get().then(
      (result) => result.job,
      () => undefined,
    );
    if (job?.status === "running")
      throw new AppError((m) => m.storage.erase.busy, 409);
    res.json(await workbench.eraseAll(confirm));
  });
  app.get("/api/storage", async (_req, res) => {
    res.json(await workbench.storage());
  });
  app.get("/api/diagnostics", async (_req, res) => {
    res.json(await diagnostics(deps));
  });
}
