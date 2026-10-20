#!/usr/bin/env node
// Bundles the server into build/cli.mjs (the entry of bin/bellpr.mjs).
//
// Packages stay external: npm installs the "dependencies" of package.json
// next to the bundle. build/ sits one level below the package root like
// server/, so the URLs the server resolves relative to its own file
// (../dist/, ../vendor/ponytail/rules.md, ../package.json) work from both.
//
// The bundle gets the version and the build date as constants: the date is
// package.json "bellpr.releaseDate" when set, else today (UTC).
//
// Usage: node scripts/build-server.mjs
import { builtinModules } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const buildDate =
  pkg.bellpr?.releaseDate ?? new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(buildDate)) {
  console.error(
    `build-server: bellpr.releaseDate must be YYYY-MM-DD, not "${buildDate}".`,
  );
  process.exit(1);
}

const result = await build({
  absWorkingDir: root,
  entryPoints: ["server/cli.ts"],
  outfile: "build/cli.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  // Stack traces map to the sources; the sources themselves stay out.
  sourcemap: "linked",
  sourcesContent: false,
  define: {
    __BELLPR_VERSION__: JSON.stringify(pkg.version),
    __BELLPR_BUILD_DATE__: JSON.stringify(buildDate),
  },
  metafile: true,
  logLevel: "warning",
});

// Every package the bundle imports must be a dependency, or an installed
// copy fails at runtime.
const builtins = new Set(builtinModules);
const dependencies = new Set(Object.keys(pkg.dependencies ?? {}));
const missing = new Set();
for (const output of Object.values(result.metafile.outputs))
  for (const { path: specifier, external } of output.imports) {
    if (!external || specifier.startsWith("node:") || builtins.has(specifier))
      continue;
    const name = specifier.startsWith("@")
      ? specifier.split("/").slice(0, 2).join("/")
      : specifier.split("/")[0];
    if (!dependencies.has(name)) missing.add(name);
  }
if (missing.size) {
  console.error(
    `build-server: build/cli.mjs imports packages that are not in "dependencies": ${[...missing].join(", ")}.`,
  );
  process.exit(1);
}
const bytes = result.metafile.outputs["build/cli.mjs"]?.bytes ?? 0;
console.log(
  `build-server: build/cli.mjs ${(bytes / 1024).toFixed(1)} kB, version ${pkg.version}, build date ${buildDate}`,
);
