/**
 * Function walkthroughs: for each modified code file, the function, method
 * or test that holds each change, explained as it works now. Which files
 * get one (synchronizeWalkthroughs), the lines a diff changes, the agent's
 * structured output and its validation. The prompt is in
 * prompts/walkthroughs.ts and the job in walkthrough-runs.ts.
 */
import type {
  CodeReference,
  FileWalkthrough,
  FunctionWalkthrough,
} from "../shared/walkthroughs.js";
import { sm } from "./i18n/index.js";
import { safeRelativePath } from "./git.js";
import { jsonText } from "./team.js";
import { AppError, type DiffFile, type Run } from "./types.js";

/** Files explained automatically per run; each costs one agent call. */
export const walkthroughFileLimit = 12;
export const walkthroughFunctionLimit = 6;
export const walkthroughStepLimit = 8;
export const walkthroughReferenceLimit = 5;
/** Starts the key of a walkthrough job's controller (sync-runs.ts runBusy). */
export const walkthroughKeyPrefix = "walkthrough:";

/** Languages without functions to walk through. */
const nonCode = new Set(["Markdown", "Text", "JSON", "YAML", "CSS", "SCSS", "HTML"]);

/** Why a file gets no walkthrough, or undefined when it gets one. */
function unavailableReason(file: DiffFile) {
  if (file.blocked) return file.blocked;
  if (file.status !== "modified") return sm().run.walkthrough.wholeFile;
  if (nonCode.has(file.language)) return sm().run.walkthrough.noFunctions;
  if (Buffer.byteLength(file.patch) > 100_000)
    return sm().run.walkthrough.tooLarge;
  return undefined;
}

/**
 * Keeps run.walkthroughs in step with the diff, as synchronizeExplanations
 * does for change explanations, and copies the state onto each file. The
 * reasons it stores are worded in the locale in effect (the run's).
 */
export function synchronizeWalkthroughs(run: Run, files: DiffFile[]) {
  const walkthroughs: NonNullable<Run["walkthroughs"]> = Object.assign(
    Object.create(null),
    run.walkthroughs,
  );
  run.walkthroughs = walkthroughs;
  const paths = new Set(files.map((file) => file.path));
  for (const key of Object.keys(walkthroughs))
    if (!paths.has(key)) delete walkthroughs[key];
  let eligible = 0;
  for (const file of files) {
    delete file.walkthrough;
    delete file.walkthroughError;
    let unavailable = unavailableReason(file);
    if (!unavailable && ++eligible > walkthroughFileLimit)
      unavailable = sm().run.walkthrough.overLimit({
        limit: walkthroughFileLimit,
      });
    let stored = walkthroughs[file.path];
    // An unavailable entry is retried once the file qualifies again, for
    // example when other files leave the diff and it falls under the limit.
    if (
      !stored ||
      stored.fingerprint !== file.fingerprint ||
      unavailable ||
      stored.status === "unavailable"
    )
      stored = walkthroughs[file.path] = {
        fingerprint: file.fingerprint,
        status: unavailable ? "unavailable" : "pending",
        ...(unavailable ? { error: unavailable } : {}),
      };
    file.walkthroughStatus = stored.status;
    if (stored.content) file.walkthrough = stored.content;
    if (stored.error) file.walkthroughError = stored.error;
  }
}

/** The lines of the current file that the diff adds. */
export function addedLines(patch: string) {
  const added = new Set<number>();
  let next = 0;
  for (const raw of patch.split("\n")) {
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (header) next = Number(header[1]);
    else if (!next) continue;
    else if (raw.startsWith("+")) added.add(next++);
    else if (raw.startsWith(" ")) next++;
  }
  return added;
}

/**
 * The lines of the current file the diff adds, and where it deletes, merged
 * into ranges. Context lines are left out: a function that only sits next to
 * a change is not part of it.
 */
export function changedRanges(patch: string) {
  const lines = new Set<number>();
  let next = 0;
  // A deletion replaced by added lines is located by them; a pure deletion
  // sits after the line before it, inside the same function.
  let deleted = false;
  const settle = () => {
    if (deleted) lines.add(Math.max(1, next - 1));
    deleted = false;
  };
  for (const raw of patch.split("\n")) {
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (header) {
      settle();
      next = Number(header[1]);
    }
    // Lines before the first hunk are the diff's own headers.
    else if (!next) continue;
    else if (raw.startsWith("+")) {
      deleted = false;
      lines.add(next++);
    } else if (raw.startsWith("-")) deleted = true;
    else if (raw.startsWith(" ")) {
      settle();
      next++;
    }
  }
  settle();
  const ranges: { startLine: number; endLine: number }[] = [];
  for (const line of [...lines].sort((a, b) => a - b)) {
    const last = ranges.at(-1);
    if (last && line <= last.endLine + 1) last.endLine = Math.max(last.endLine, line);
    else ranges.push({ startLine: line, endLine: line });
  }
  return ranges;
}

const reference = {
  type: "object",
  properties: {
    name: { type: "string" },
    path: { type: "string" },
    line: { type: ["integer", "null"] },
    note: { type: "string" },
  },
  required: ["name", "path", "line", "note"],
  additionalProperties: false,
};

/** The agent's structured output: every object closed and fully required. */
export const walkthroughJsonSchema = {
  type: "object",
  properties: {
    functions: {
      type: "array",
      maxItems: walkthroughFunctionLimit,
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          kind: { type: "string" },
          startLine: { type: "integer" },
          endLine: { type: "integer" },
          summary: { type: "string" },
          change: { type: "string" },
          steps: {
            type: "array",
            minItems: 2,
            maxItems: walkthroughStepLimit,
            items: {
              type: "object",
              properties: {
                startLine: { type: "integer" },
                endLine: { type: "integer" },
                explanation: { type: "string" },
              },
              required: ["startLine", "endLine", "explanation"],
              additionalProperties: false,
            },
          },
          callers: {
            type: "array",
            maxItems: walkthroughReferenceLimit,
            items: reference,
          },
          callees: {
            type: "array",
            maxItems: walkthroughReferenceLimit,
            items: reference,
          },
          analogy: { type: "string" },
          selfCheck: {
            type: "object",
            properties: { question: { type: "string" }, answer: { type: "string" } },
            required: ["question", "answer"],
            additionalProperties: false,
          },
        },
        required: [
          "name",
          "kind",
          "startLine",
          "endLine",
          "summary",
          "change",
          "steps",
          "callers",
          "callees",
          "analogy",
          "selfCheck",
        ],
        additionalProperties: false,
      },
    },
    newUnits: {
      type: "array",
      maxItems: walkthroughFunctionLimit,
      items: { type: "string" },
    },
  },
  required: ["functions", "newUnits"],
  additionalProperties: false,
};

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
const integer = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) ? value : NaN;

function references(value: unknown): CodeReference[] {
  return (Array.isArray(value) ? value : [])
    .slice(0, walkthroughReferenceLimit)
    .map((entry) => {
      const record = (entry ?? {}) as Record<string, unknown>;
      const line = integer(record.line);
      const raw = text(record.path, 1_024);
      // A line number only means something next to a path that is kept.
      const path = raw && safeRelativePath(raw) ? raw : "";
      return {
        name: text(record.name, 120),
        path,
        line: path && line >= 1 ? line : null,
        note: text(record.note, 300),
      };
    })
    .filter((entry) => entry.name || entry.path);
}

/**
 * Keeps the units and steps whose lines fit the current file. The agent's
 * answer is not trusted: ranges outside the file or the unit are dropped,
 * text is clipped, and reference paths must be plain repository paths. A
 * unit whose every line the diff adds (`added`) has nothing older to
 * explain, so it moves to newUnits.
 */
export function parseWalkthrough(
  answer: string,
  lineCount: number,
  added: Set<number> = new Set(),
): FileWalkthrough {
  let value: unknown;
  try {
    value = JSON.parse(jsonText(answer));
  } catch {
    throw new AppError((m) => m.run.walkthrough.incomplete, 422);
  }
  const record = (value ?? {}) as { functions?: unknown; newUnits?: unknown };
  if (!Array.isArray(record.functions))
    throw new AppError((m) => m.run.walkthrough.incomplete, 422);
  const inside = (start: number, end: number, low: number, high: number) =>
    start >= low && end >= start && end <= high;
  const functions: FunctionWalkthrough[] = [];
  const newUnits = new Set(
    (Array.isArray(record.newUnits) ? record.newUnits : [])
      .slice(0, walkthroughFunctionLimit)
      .map((name) => text(name, 120))
      .filter(Boolean),
  );
  for (const entry of record.functions.slice(0, walkthroughFunctionLimit)) {
    const unit = (entry ?? {}) as Record<string, unknown>;
    const startLine = integer(unit.startLine);
    const endLine = integer(unit.endLine);
    if (!inside(startLine, endLine, 1, lineCount)) continue;
    const name =
      text(unit.name, 120) || sm().run.walkthrough.lineName({ line: startLine });
    let whollyAdded = added.size > 0;
    for (let line = startLine; line <= endLine && whollyAdded; line++)
      whollyAdded = added.has(line);
    if (whollyAdded) {
      newUnits.add(name);
      continue;
    }
    const check = (unit.selfCheck ?? {}) as Record<string, unknown>;
    functions.push({
      name,
      kind: text(unit.kind, 40),
      startLine,
      endLine,
      summary: text(unit.summary, 1_200),
      change: text(unit.change, 600),
      steps: (Array.isArray(unit.steps) ? unit.steps : [])
        .slice(0, walkthroughStepLimit)
        .map((step) => {
          const part = (step ?? {}) as Record<string, unknown>;
          return {
            startLine: integer(part.startLine),
            endLine: integer(part.endLine),
            explanation: text(part.explanation, 600),
          };
        })
        .filter(
          (step) =>
            step.explanation &&
            inside(step.startLine, step.endLine, startLine, endLine),
        ),
      callers: references(unit.callers),
      callees: references(unit.callees),
      analogy: text(unit.analogy, 1_200),
      selfCheck: {
        question: text(check.question, 600),
        answer: text(check.answer, 1_200),
      },
    });
  }
  return { functions, newUnits: [...newUnits] };
}
