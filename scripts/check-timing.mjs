#!/usr/bin/env node
// How long the Explain-it-back check takes, from a BELL PR data dir: the
// median of the seconds each passed check took (`understanding.history[]
// .seconds` of every run in state.json), over all timed checks and over
// the last 10, which Settings → Learning shows. It supports dogfooding the
// check: the budget is 3-5 minutes for a small pull request, and a median
// well over it means cutting prompts, never adding reminders.
//
//   node scripts/check-timing.mjs <data dir> [--json]
//   node scripts/check-timing.mjs --self-test
//
// A development script: it reads one local file, sends nothing anywhere,
// and is not part of the npm package (package.json `files`).
//
// Exit status: 0 on success, 1 when the self-test fails, 2 on a usage or
// read error.
import { readFile } from "node:fs/promises";
import path from "node:path";

/** The middle value, or the rounded mean of the two middle ones; undefined for none. */
export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return undefined;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/**
 * Every timed check in `state` (state.json), oldest first: the run, when
 * it passed and how many seconds it took. Entries without a time (older
 * builds, or a check whose start was not recorded) are left out.
 */
export function timedChecks(state) {
  const checks = [];
  for (const run of Array.isArray(state?.runs) ? state.runs : [])
    for (const entry of Array.isArray(run?.understanding?.history) ? run.understanding.history : [])
      if (
        Number.isFinite(entry?.seconds) &&
        entry.seconds >= 0 &&
        typeof entry.passedAt === "string"
      )
        checks.push({ runId: String(run.id), passedAt: entry.passedAt, seconds: entry.seconds });
  return checks.sort((a, b) => a.passedAt.localeCompare(b.passedAt));
}

/** The numbers the script prints, for `state`. */
export function timing(state) {
  const checks = timedChecks(state);
  const seconds = checks.map((check) => check.seconds);
  const lastTen = seconds.slice(-10);
  return {
    timed: checks.length,
    runs: new Set(checks.map((check) => check.runId)).size,
    medianSeconds: median(seconds),
    lastTen: { count: lastTen.length, medianSeconds: median(lastTen) },
  };
}

const minutes = (seconds) =>
  seconds === undefined ? "none" : `${(seconds / 60).toFixed(1)} min (${seconds} s)`;

function selfTest() {
  const failures = [];
  const expect = (name, actual, expected) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      failures.push(`${name}: ${JSON.stringify(actual)} is not ${JSON.stringify(expected)}`);
  };
  expect("median of none", median([]), undefined);
  expect("median of an odd count", median([300, 120, 200]), 200);
  expect("median of an even count, rounded", median([100, 201]), 151);
  const run = (id, history) => ({ id, understanding: { history } });
  const state = {
    runs: [
      run("a", [
        { passedAt: "2026-10-03T00:00:00Z", seconds: 600 },
        { passedAt: "2026-10-01T00:00:00Z", seconds: 60 },
      ]),
      // No time, a broken one and a run without a check are left out.
      run("b", [{ passedAt: "2026-10-02T00:00:00Z" }, { passedAt: "2026-10-02T01:00:00Z", seconds: "x" }]),
      { id: "c" },
      run(
        "d",
        Array.from({ length: 10 }, (_, index) => ({
          passedAt: `2026-10-${String(10 + index).padStart(2, "0")}T00:00:00Z`,
          seconds: 180 + index,
        })),
      ),
    ],
  };
  expect("timed checks, oldest first", timedChecks(state).slice(0, 2).map((check) => check.seconds), [60, 600]);
  expect("the numbers", timing(state), {
    timed: 12,
    runs: 2,
    medianSeconds: 185,
    // The last 10 by when they passed: run d's, not the early 60 or 600.
    lastTen: { count: 10, medianSeconds: 185 },
  });
  expect("an empty data dir", timing({ version: 1, repos: [], runs: [] }), {
    timed: 0,
    runs: 0,
    medianSeconds: undefined,
    lastTen: { count: 0, medianSeconds: undefined },
  });
  if (failures.length) {
    console.error(`check-timing: self-test failed:\n${failures.join("\n")}`);
    return 1;
  }
  console.log("check-timing: self-test passed.");
  return 0;
}

async function main(argv) {
  if (argv.includes("--self-test")) return selfTest();
  const json = argv.includes("--json");
  const rest = argv.filter((arg) => arg !== "--json");
  if (rest.length !== 1 || rest[0].startsWith("-")) {
    console.error("Usage: node scripts/check-timing.mjs <data dir> [--json]\n       node scripts/check-timing.mjs --self-test");
    return 2;
  }
  const file = path.join(path.resolve(rest[0]), "state.json");
  let state;
  try {
    state = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    console.error(`check-timing: cannot read ${file}: ${error.message}`);
    return 2;
  }
  const result = timing(state);
  if (json) console.log(JSON.stringify(result, null, 2));
  else
    console.log(
      [
        `check-timing: ${result.timed} timed ${result.timed === 1 ? "check" : "checks"} in ${result.runs} ${result.runs === 1 ? "run" : "runs"} (${file})`,
        `median of all timed checks: ${minutes(result.medianSeconds)}`,
        `median of the last ${result.lastTen.count} (as Settings → Learning shows): ${minutes(result.lastTen.medianSeconds)}`,
        "budget: 3-5 minutes for a small pull request (BELL default, DESIGN §14)",
      ].join("\n"),
    );
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
