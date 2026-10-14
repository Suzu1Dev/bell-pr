import type { Messages } from "../i18n";

export type DiffLine = {
  id: number;
  kind: "context" | "added" | "removed" | "hunk" | "note";
  text: string;
  oldLine: number | null;
  newLine: number | null;
};

/** Parse unified diff without interpreting code as HTML or losing hunk offsets. */
export function parseDiff(patch: string): DiffLine[] {
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  const result: DiffLine[] = [];
  for (const raw of patch.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      result.push({
        id: result.length,
        kind: "hunk",
        text: raw,
        oldLine: null,
        newLine: null,
      });
      continue;
    }
    if (/^diff --git /.test(raw)) {
      inHunk = false;
      continue;
    }
    if (!inHunk) continue;
    if (raw.startsWith("+")) {
      result.push({
        id: result.length,
        kind: "added",
        text: raw.slice(1),
        oldLine: null,
        newLine: newLine++,
      });
    } else if (raw.startsWith("-")) {
      result.push({
        id: result.length,
        kind: "removed",
        text: raw.slice(1),
        oldLine: oldLine++,
        newLine: null,
      });
    } else if (raw.startsWith(" ")) {
      result.push({
        id: result.length,
        kind: "context",
        text: raw.slice(1),
        oldLine: oldLine++,
        newLine: newLine++,
      });
    } else if (raw.startsWith("\\")) {
      result.push({
        id: result.length,
        kind: "note",
        text: raw,
        oldLine: null,
        newLine: null,
      });
    }
  }
  return result;
}

export type SplitRow = { left?: DiffLine; right?: DiffLine; hunk?: DiffLine };

/** Lines of code a reader can select and ask about (not hunk headers or notes). */
export function isCodeLine(line: DiffLine): boolean {
  return (
    line.kind === "context" || line.kind === "added" || line.kind === "removed"
  );
}

/** One hunk: its header line and the lines below it, notes included. */
export type Hunk = { header?: DiffLine; lines: DiffLine[] };

/** The hunks of a parsed diff in order; lines before any header form a hunk without one. */
export function groupHunks(lines: DiffLine[]): Hunk[] {
  const hunks: Hunk[] = [];
  for (const line of lines) {
    if (line.kind === "hunk") hunks.push({ header: line, lines: [] });
    else {
      if (!hunks.length) hunks.push({ lines: [] });
      hunks[hunks.length - 1].lines.push(line);
    }
  }
  return hunks;
}

/** Where a hunk header says its lines start, and the code it names after the second @@. */
export function hunkStart(
  header: string,
): { oldLine: number; newLine: number; context: string } | undefined {
  const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/.exec(header);
  if (!match) return undefined;
  return {
    oldLine: Number(match[1]),
    newLine: Number(match[2]),
    context: match[3].trim(),
  };
}

/**
 * Short badges keyed by the language names server/git.ts languageFor emits.
 * JSON gets its own badge so it never collides with JavaScript's "JS".
 */
export const languageBadges: Record<string, string> = {
  TypeScript: "TS",
  TSX: "TSX",
  JavaScript: "JS",
  JSX: "JSX",
  Python: "PY",
  Rust: "RS",
  Go: "GO",
  CSS: "CSS",
  SCSS: "SCS",
  JSON: "JSN",
  Markdown: "MD",
  YAML: "YML",
  HTML: "HTM",
  Shell: "SH",
  SQL: "SQL",
  Ruby: "RB",
  Java: "JAV",
  Text: "TXT",
};

/** Badge of at most three characters; unknown languages fall back to their first two letters. */
export function languageBadge(language: string): string {
  return languageBadges[language] ?? language.trim().slice(0, 2).toUpperCase();
}

/** The chat API's limit for one question, in characters. */
const questionLimit = 8000;

/** The longest run of backticks in `text`, which a code span or fence must outnumber. */
function longestBacktickRun(text: string): number {
  return (text.match(/`+/g) ?? []).reduce((longest, run) => Math.max(longest, run.length), 0);
}

/** `text` as a Markdown code span, so a path's `_` or `*` stays literal. */
export function markdownCode(text: string): string {
  const ticks = "`".repeat(longestBacktickRun(text) + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${ticks}${pad}${text}${pad}${ticks}`;
}

/** The first and last line number of the selected lines that have one. */
function lineRange(numbers: (number | null)[]) {
  const present = numbers.filter((value): value is number => value !== null);
  return present.length
    ? {
        first: present.reduce((low, value) => Math.min(low, value)),
        last: present.reduce((high, value) => Math.max(high, value)),
      }
    : undefined;
}

/**
 * The question about selected lines, in the language of `messages` (the UI's
 * review dictionary): the request, a line naming the file and the selected
 * lines' numbers in the old and new version, then the lines as a fenced
 * `diff` block with their `-`, `+` or space prefix and their own
 * indentation, which the chat shows as code. A selection over the chat
 * API's 8,000-character limit is cut inside the block, the fence closed,
 * and a note under the request says that it is an excerpt.
 */
export function selectionQuestion(
  path: string,
  lines: DiffLine[],
  messages: Messages["review"]["selection"],
): string {
  const header = `${messages.question({ path: markdownCode(path), count: lines.length })}\n\n`;
  const oldLines = lineRange(lines.map((line) => line.oldLine));
  const newLines = lineRange(lines.map((line) => line.newLine));
  const range = `${messages.lines({
    path: markdownCode(path),
    ...(oldLines ? { oldLines } : {}),
    ...(newLines ? { newLines } : {}),
  })}\n\n`;
  const body = lines
    .map(
      (line) =>
        `${line.kind === "removed" ? "-" : line.kind === "added" ? "+" : " "}${line.text.replace(/\r$/, "")}`,
    )
    .join("\n");
  // Longer than any run of backticks in the code, which would end the block.
  const fence = "`".repeat(Math.max(3, longestBacktickRun(body) + 1));
  const block = (code: string) => `${fence}diff\n${code}\n${fence}`;
  const question = header + range + block(body);
  if (question.length <= questionLimit) return question;
  const note = `${messages.truncated}\n\n`;
  const room = Math.max(0, questionLimit - (header + note + range + block("")).length);
  return header + note + range + block(body.slice(0, room));
}

/** Align contiguous removals and additions, keeping unchanged lines synchronized. */
export function splitDiff(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (line.kind === "hunk" || line.kind === "note") {
      rows.push({ hunk: line });
      index++;
    } else if (line.kind === "context") {
      rows.push({ left: line, right: line });
      index++;
    } else {
      const removed: DiffLine[] = [];
      const added: DiffLine[] = [];
      while (
        index < lines.length &&
        ["added", "removed"].includes(lines[index].kind)
      ) {
        const change = lines[index++];
        (change.kind === "removed" ? removed : added).push(change);
      }
      for (
        let offset = 0;
        offset < Math.max(removed.length, added.length);
        offset++
      ) {
        rows.push({ left: removed[offset], right: added[offset] });
      }
    }
  }
  return rows;
}
