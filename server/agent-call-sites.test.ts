// Every place that starts an agent CLI (DESIGN v1.2 F2): a source-reading
// test of each `agentCommand(` call in server/**/*.ts and the access it
// asks for. A Learn-by-hand run must never get a write turn, and the one
// call that can ask for write access sits behind the guard in runAgent; a
// new call site or a changed access fails here until it is checked against
// that guard.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const serverDirectory = import.meta.dirname;

/** The allowed call sites and the access expression each passes. */
const allowed: Record<string, string> = {
  // Behind `if (run.learnByHand && !readonly) throw … noWriteTurn` in runAgent.
  "server/run-executor.ts": 'readonly ? "read" : "write"',
  "server/discovery.ts": '"none"',
  "server/insights.ts": '"none"',
};

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) return entry.name === "fixtures" ? [] : sourceFiles(full);
      return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [full] : [];
    }),
  );
  return files.flat();
}

/** The text of a call's arguments, up to its closing parenthesis. */
function callArguments(source: string, open: number) {
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    if (source[index] === "(") depth++;
    else if (source[index] === ")" && --depth === 0) return source.slice(open + 1, index);
  }
  return source.slice(open + 1);
}

test("agentCommand is called only where the write guard is known, with the access it had", async () => {
  const found: Record<string, string[]> = {};
  for (const file of await sourceFiles(serverDirectory)) {
    const source = await readFile(file, "utf8");
    const relative = path.relative(path.dirname(serverDirectory), file).split(path.sep).join("/");
    for (const match of source.matchAll(/\bagentCommand\(/g)) {
      if (/function\s+agentCommand\($/.test(source.slice(0, match.index + match[0].length))) continue;
      const args = callArguments(source, match.index + match[0].length - 1);
      const access = /\baccess:\s*([^,\n]+?)\s*,?\n/.exec(args)?.[1] ?? "(no access)";
      (found[relative] ??= []).push(access.trim());
    }
  }
  for (const [file, accesses] of Object.entries(found)) {
    assert.ok(
      file in allowed,
      `${file} calls agentCommand: a new agent call site must be checked against the Learn-by-hand write guard in runAgent (server/run-executor.ts) and added here.`,
    );
    assert.deepEqual(
      accesses,
      [allowed[file]],
      `${file} changed the access it passes to agentCommand; only runAgent may ask for write access, behind the Learn-by-hand write guard.`,
    );
  }
  assert.deepEqual(Object.keys(found).sort(), Object.keys(allowed).sort());
  // The guard itself is in place, before the agent runner and the CLI.
  const executor = await readFile(path.join(serverDirectory, "run-executor.ts"), "utf8");
  const guard = executor.indexOf("if (run.learnByHand && !readonly) throw new AppError((m) => m.byHand.noWriteTurn, 409);");
  assert.ok(guard > 0, "the write guard is missing from runAgent");
  assert.ok(guard < executor.indexOf("ctx.dependencies.agentRunner") && guard < executor.indexOf("agentCommand(modelExecution"));
});
