#!/usr/bin/env node
// BELL's checked list of AI rules published outside repositories
// (server/policy-registry.ts), checked offline: every field, quote length,
// PolicyKind and HelpKind value and date, https URLs, unique keys,
// carve-outs only on rules that restrict AI output (never on one that
// restricts AI help itself), each carve-out with its own quote naming its
// kinds by the F12 word table, a rule's reach as BELL reads its quote, and
// a sign-off not before the check.
//
//   node scripts/check-policy-registry.mjs [--entries <file.json>]
//
// --entries checks the entries of a JSON file instead of the shipped list.
// Entries without a maintainer's sign-off (BELL never reads them) and entries
// whose quotes were checked more than 90 days ago ("re-check": they still
// block and never lift) are printed as warnings.
//
// Exit status: 0 when every entry is well formed, 1 when one is not, 2 on
// a setup error.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

let registry;
let entries;
try {
  const { tsImport } = await import("tsx/esm/api");
  registry = await tsImport(pathToFileURL(path.join(root, "server/policy-registry.ts")).href, import.meta.url);
  const file = args[0] === "--entries" ? args[1] : undefined;
  if (args.length && !file) throw new Error("usage: node scripts/check-policy-registry.mjs [--entries <file.json>]");
  entries = file ? JSON.parse(readFileSync(path.resolve(file), "utf8")) : registry.policyRegistry;
  if (!Array.isArray(entries)) throw new Error("the entries must be a JSON array");
} catch (error) {
  console.error(`check-policy-registry: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

const report = registry.checkRegistry(entries, new Date().toISOString());
const checkedOn = (key) => entries.find((entry) => entry.key === key)?.checkedOn ?? "?";
const signed = entries.length - report.awaiting.length;
console.log(`check-policy-registry: ${entries.length} entries, ${signed} signed off.`);
for (const key of report.awaiting)
  console.log(`warning: ${key} (checked on ${checkedOn(key)}) is awaiting a maintainer's sign-off; BELL never reads it until then.`);
for (const key of report.recheck)
  console.log(`warning: re-check ${key}: its quotes were checked on ${checkedOn(key)}, more than 90 days ago; it still blocks and never lifts.`);
for (const error of report.errors) console.error(`error: ${error}`);
if (report.errors.length) {
  console.error(`check-policy-registry: ${report.errors.length} problem(s) in the entries.`);
  process.exit(1);
}
console.log("check-policy-registry: every entry is well formed.");
