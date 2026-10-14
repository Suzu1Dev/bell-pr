#!/usr/bin/env node
// Keeps the public links in package.json in step with shared/product.ts,
// the one place that names them (zero dependencies).
//
//   node scripts/sync-package-meta.mjs --check   fail when they differ
//   node scripts/sync-package-meta.mjs --write   update package.json
//
// package.json mirrors product.ts as follows, and each field is absent
// while its source is empty, so the npm page never shows an invented or
// private link:
//   homepage    = homepageUrl
//   bugs        = { url: publicRepoUrl + "/issues", email: supportEmail },
//                 leaving out the empty parts
//   repository  = { type: "git", url: publicRepoUrl }
//
// Exit status: 0 when in step (or written), 1 when --check finds a
// difference, 2 on a usage or setup error.
import { isDeepStrictEqual } from "node:util";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagePath = path.join(root, "package.json");
const productPath = path.join(root, "shared", "product.ts");
const fields = ["homepage", "bugs", "repository"];

/** The string values of the `product` object literal in product.ts. */
export function readProduct(source) {
  const body = /export const product\b[^=]*=\s*\{([\s\S]*?)\n\};/.exec(source)?.[1];
  if (!body) throw new Error("could not find `export const product = {...}` in shared/product.ts.");
  const values = {};
  for (const match of body.matchAll(/^\s*(\w+):\s*"((?:[^"\\]|\\.)*)"\s*,?\s*$/gm))
    values[match[1]] = JSON.parse(`"${match[2]}"`);
  for (const key of ["homepageUrl", "publicRepoUrl", "supportEmail"])
    if (typeof values[key] !== "string")
      throw new Error(`shared/product.ts has no string value for ${key}.`);
  return values;
}

/** The package.json fields product.ts implies; undefined means absent. */
export function expectedMeta(product) {
  const repo = product.publicRepoUrl.replace(/\/+$/, "");
  const bugs = {
    ...(repo ? { url: `${repo}/issues` } : {}),
    ...(product.supportEmail ? { email: product.supportEmail } : {}),
  };
  return {
    homepage: product.homepageUrl || undefined,
    bugs: Object.keys(bugs).length ? bugs : undefined,
    repository: repo ? { type: "git", url: repo } : undefined,
  };
}

/** package.json with the fields set or removed, keeping the key order. */
export function applyMeta(pkg, meta) {
  const result = {};
  for (const [key, value] of Object.entries(pkg)) {
    if (fields.includes(key)) continue;
    result[key] = value;
    // New fields go after "keywords" (or "description"), as npm init does.
    if (key === (pkg.keywords ? "keywords" : "description"))
      for (const field of fields)
        if (meta[field] !== undefined) result[field] = meta[field];
  }
  for (const field of fields)
    if (meta[field] !== undefined && !(field in result)) result[field] = meta[field];
  return result;
}

function main(args) {
  if (args.length !== 1 || !["--check", "--write"].includes(args[0])) {
    console.error("Usage: node scripts/sync-package-meta.mjs --check | --write");
    return 2;
  }
  const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
  const meta = expectedMeta(readProduct(readFileSync(productPath, "utf8")));
  const differences = fields.filter((field) => !isDeepStrictEqual(pkg[field], meta[field]));
  if (args[0] === "--write") {
    if (differences.length)
      writeFileSync(packagePath, `${JSON.stringify(applyMeta(pkg, meta), null, 2)}\n`);
    console.error(
      differences.length
        ? `sync-package-meta: updated ${differences.join(", ")} in package.json.`
        : "sync-package-meta: package.json already matches shared/product.ts.",
    );
    return 0;
  }
  if (!differences.length) {
    console.error(
      `sync-package-meta: package.json matches shared/product.ts (${fields
        .map((field) => `${field} ${meta[field] === undefined ? "absent" : "set"}`)
        .join(", ")}).`,
    );
    return 0;
  }
  for (const field of differences)
    console.error(
      `package.json ${field}: expected ${meta[field] === undefined ? "no field" : JSON.stringify(meta[field])}, found ${pkg[field] === undefined ? "no field" : JSON.stringify(pkg[field])}.`,
    );
  console.error("Run `node scripts/sync-package-meta.mjs --write` to update package.json.");
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`sync-package-meta: ${error.message}`);
    process.exitCode = 2;
  }
}
