#!/usr/bin/env node
/**
 * The guide eval (plan direction-v1.2 DESIGN §9.3): a release gate for the
 * Learn-by-hand guide, run by the owner with real model calls before the
 * v1.2 release candidate and on every guide-prompt or default-model
 * change. The logic is server/eval-guide.ts; the seeded repository, the
 * tasks, the personas and the thresholds are test/eval-guide/.
 *
 *   node scripts/eval-guide.mjs --real [--provider codex|claude]...
 *       [--runs 2] [--model <id>] [--out <directory>]
 *     Runs every persona on every task, --runs times per provider (default
 *     2, the minimum sample), through the signed-in CLIs with read-only
 *     access, in throwaway checkouts. Writes results.json (every turn
 *     before and after BELL's filter) and review-sheet.md (the items a
 *     person rates) to --out (default: a new temporary directory). Model
 *     calls use your own CLI accounts.
 *
 *   node scripts/eval-guide.mjs --score <review-sheet.md> [--baseline <last accepted sheet>]
 *     Scores a rated sheet: pass or fail per threshold. Calls no CLI.
 *
 * Without --real it calls no CLI at all. Keep the scored sheets in
 * plan/direction-v1.2/eval/<date>-<provider>-<model>.md, never in
 * marketing. A development script: not part of the npm package.
 *
 * Exit status: 0 when every threshold passes (or the run finished), 1 when
 * one fails (or the run could not finish), 2 on a usage error.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const providers = ["codex", "claude"];
const usage = `Usage:
  node scripts/eval-guide.mjs --real [--provider codex|claude]... [--runs 2] [--model <id>] [--out <directory>]
  node scripts/eval-guide.mjs --score <review-sheet.md> [--baseline <last accepted sheet>]`;

let options;
try {
  options = parseArgs({
    options: {
      real: { type: "boolean" },
      provider: { type: "string", multiple: true },
      runs: { type: "string" },
      model: { type: "string" },
      out: { type: "string" },
      score: { type: "string" },
      baseline: { type: "string" },
      help: { type: "boolean" },
    },
    strict: true,
  }).values;
} catch (error) {
  console.error(`${error.message}\n${usage}`);
  process.exit(2);
}
if (options.help) {
  console.log(usage);
  process.exit(0);
}

if (!options.real && !options.score) {
  console.error(
    `eval-guide: refusing to run without --real. The eval calls the real codex or claude CLI with your account (owner only, before a release candidate). Nothing was run.\n${usage}`,
  );
  process.exit(2);
}

const { tsImport } = await import("tsx/esm/api");
const load = (file) => tsImport(pathToFileURL(path.join(root, file)).href, import.meta.url);
const fixturesDirectory = path.join(root, "test", "eval-guide");

if (options.score) {
  const evalGuide = await load("server/eval-guide.ts");
  const { thresholds } = await evalGuide.loadFixtures(fixturesDirectory);
  const sheet = await readFile(options.score, "utf8");
  const baseline = options.baseline ? await readFile(options.baseline, "utf8") : undefined;
  const score = evalGuide.scoreSheet(sheet, thresholds, baseline);
  console.log(evalGuide.formatScore(score));
  process.exit(score.pass ? 0 : 1);
}

const selected = options.provider ?? providers;
const runs = Number(options.runs ?? 2);
if (selected.some((provider) => !providers.includes(provider)) || !Number.isInteger(runs) || runs < 1) {
  console.error(usage);
  process.exit(2);
}

const evalGuide = await load("server/eval-guide.ts");
const { agentCommand, agentEventReader } = await load("server/agent-cli.ts");
const { agentEnvironment, command } = await load("server/process.ts");
const { withSchemaFile } = await load("server/by-hand-schemas.ts");

/**
 * One read-only CLI turn under the turn's JSON Schema, as BELL starts a
 * guide turn; the final message is the answer. A file change from either
 * CLI, or a command from Claude Code (whose read turns have no shell), ends
 * the turn as a failure.
 */
async function runner(call) {
  return withSchemaFile(call.schema, async (outputSchema) => {
    const execution = options.model
      ? { provider: call.provider, model: options.model, source: "selected" }
      : { provider: call.provider, source: "cli-default" };
    const cli = await agentCommand(execution, { cwd: call.cwd, access: "read", outputSchema, skipGitRepoCheck: true });
    const read = agentEventReader(call.provider);
    let answer = "";
    let wrote = false;
    await command(cli.executable, cli.args, {
      input: call.prompt,
      cwd: call.cwd,
      timeoutMs: 10 * 60_000,
      maxBytes: 8_000_000,
      env: agentEnvironment(call.provider),
      onLine: (line, stream) => {
        if (stream !== "stdout") return;
        try {
          for (const item of read(JSON.parse(line))) {
            if (item.kind === "file-change" || (item.kind === "command" && call.provider === "claude")) wrote = true;
            if (item.kind === "message" || item.kind === "final") answer = item.text;
          }
        } catch {
          // Only the documented JSONL events count.
        }
      },
    });
    if (wrote) throw new Error("The agent tried to change a file in a read-only turn.");
    return answer;
  });
}

const out = options.out ? path.resolve(options.out) : await mkdtemp(path.join(os.tmpdir(), "bellpr-eval-guide-"));
const work = await mkdtemp(path.join(os.tmpdir(), "bellpr-eval-guide-work-"));
try {
  const fixtures = await evalGuide.loadFixtures(fixturesDirectory);
  const result = await evalGuide.runEval({
    fixtures,
    providers: selected,
    runs,
    runner,
    workDirectory: work,
    onConversation: (conversation) => {
      const failed = conversation.turns.filter((turn) => turn.error).length;
      console.error(`${conversation.id}: ${conversation.turns.length} turns${failed ? `, ${failed} failed` : ""}`);
    },
  });
  await writeFile(path.join(out, "results.json"), `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(path.join(out, "review-sheet.md"), evalGuide.reviewSheet(result, fixtures));
  console.log(`Wrote ${path.join(out, "results.json")} and ${path.join(out, "review-sheet.md")}.`);
  console.log("Rate the sheet, then run: node scripts/eval-guide.mjs --score <the sheet>");
} catch (error) {
  console.error(`eval-guide: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  await rm(work, { recursive: true, force: true });
}
