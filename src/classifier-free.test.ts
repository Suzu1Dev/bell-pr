// The policy classifier stays on the server (plan README §18.10): the
// client reads the reach the server stored with each rule
// (PolicyFinding.reach, stopsConfirm), the sample's precomputed rules and
// discovery's marked quote. No client module, nor a shared module the
// quoted confirm or the respect checks run in the client, imports the
// classifier or the reach reader at runtime; type imports are erased.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.join(import.meta.dirname, "..");
const classifierNames = ["classifyPolicy", "attachCarveOuts", "stopsQuotedConfirm", "refusesAiHelp", "withStoredReach", "carveOutKinds"];

function sources(directory: string): string[] {
  return readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return sources(file);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [file] : [];
  });
}

/** The value imports of a file (`import type` and `export type` left out), as [names, module]. */
function valueImports(file: string) {
  const text = readFileSync(path.join(root, file), "utf8");
  return [...text.matchAll(/^(?:import|export)\s+(?!type\b)([\s\S]*?)\s+from\s+"([^"]+)"/gm)].map(
    ([, names, module]) => [names.replace(/\btype\s+\w+\s*,?/g, ""), module] as const,
  );
}

test("no client module, and no shared module the client's checks run, imports the classifier at runtime", () => {
  const files = [...sources("src"), "shared/contribution.ts", "shared/by-hand-rules.ts", "shared/discovery.ts"];
  const found: string[] = [];
  for (const file of files)
    for (const [names, module] of valueImports(file)) {
      if (/policy-reach(?:\.js)?$/.test(module)) found.push(`${file}: ${module}`);
      if (/project-policy(?:\.js)?$|by-hand-rules(?:\.js)?$/.test(module))
        for (const name of classifierNames)
          if (new RegExp(`\\b${name}\\b`).test(names)) found.push(`${file}: ${name} from ${module}`);
    }
  assert.deepEqual(found, []);
});
