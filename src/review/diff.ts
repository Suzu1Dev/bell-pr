import type { Messages } from "../i18n";

export type DiffLine = {
  id: number;
  kind: "context" | "added" | "removed" | "hunk" | "note" | "gap";
  text: string;
  oldLine: number | null;
  newLine: number | null;
  /** An unchanged line read from the base version, beyond the patch's own context. */
  expanded?: boolean;
  /**
   * A gap row: unchanged lines the patch leaves out. hidden is null at the
   * end of the file until the base version is read. afterChange and
   * beforeChange say whether a change sits above or below the gap.
   */
  gap?: {
    index: number;
    hidden: number | null;
    afterChange: boolean;
    beforeChange: boolean;
  };
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

/** Lines shown in each gap: below the change above it, and above the change below it. */
export type Reveal = Record<number, { below: number; above: number }>;

const hunkHeader = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

type HunkRange = {
  header: DiffLine;
  oldBegin: number;
  oldCount: number;
  newBegin: number;
  newCount: number;
  body: DiffLine[];
};

/**
 * The hunks of a parsed diff and the gaps of unchanged lines around them, in
 * old-file numbers. A gap's new numbers are its old ones plus offset; the
 * last gap's end is null until the base version is known.
 */
function diffGaps(lines: DiffLine[], base: string[] | null) {
  const hunks: HunkRange[] = [];
  for (const line of lines) {
    const match = line.kind === "hunk" ? hunkHeader.exec(line.text) : null;
    if (match) {
      const oldCount = match[2] === undefined ? 1 : Number(match[2]);
      const newCount = match[4] === undefined ? 1 : Number(match[4]);
      // A side with no lines starts after the line its header names.
      hunks.push({
        header: line,
        oldBegin: Number(match[1]) + (oldCount === 0 ? 1 : 0),
        oldCount,
        newBegin: Number(match[3]) + (newCount === 0 ? 1 : 0),
        newCount,
        body: [],
      });
    } else hunks.at(-1)?.body.push(line);
  }
  return hunks.length
    ? Array.from({ length: hunks.length + 1 }, (_, index) => {
        const previous = hunks[index - 1];
        const next = hunks[index];
        const start = previous ? previous.oldBegin + previous.oldCount : 1;
        return {
          index,
          previous,
          next,
          start,
          end: next ? next.oldBegin - 1 : base ? base.length : null,
          offset: next
            ? next.newBegin - next.oldBegin
            : previous.newBegin + previous.newCount - start,
        };
      })
    : [];
}

/**
 * The diff with unchanged lines of the base version shown around its hunks.
 * Lines outside the hunks are the same in both versions, so the base file
 * gives their text, and each gap's new line numbers are its old ones plus a
 * fixed offset. `base` is null until it is read; `readable` says whether it
 * can be (a modified file outside the demo). "all" shows the whole file.
 */
export function expandDiff(
  lines: DiffLine[],
  base: string[] | null,
  reveal: Reveal | "all",
  readable: boolean,
): DiffLine[] {
  const gaps = diffGaps(lines, base);
  if (!gaps.length) return lines;
  const result: DiffLine[] = [];
  const push = (line: Omit<DiffLine, "id">) =>
    result.push({ ...line, id: result.length });
  const showBase = (from: number, to: number, offset: number) => {
    for (let oldLine = from; oldLine <= to; oldLine++) {
      const text = base?.[oldLine - 1];
      if (text === undefined) return;
      push({
        kind: "context",
        text,
        oldLine,
        newLine: oldLine + offset,
        expanded: true,
      });
    }
  };
  for (const { index, previous, next, start, end, offset } of gaps) {
    const size = end === null ? null : Math.max(0, end - start + 1);
    const gap = {
      index,
      afterChange: !!previous,
      beforeChange: !!next,
    };
    if (size === null) {
      // The end of the file is unknown until the base version is read.
      if (readable)
        push({
          kind: "gap",
          text: "",
          oldLine: null,
          newLine: null,
          gap: { ...gap, hidden: null },
        });
    } else if (size > 0) {
      const wanted =
        reveal === "all" ? { below: size, above: size } : reveal[index];
      const below = base ? Math.min(wanted?.below ?? 0, size) : 0;
      const above = base ? Math.min(wanted?.above ?? 0, size - below) : 0;
      const hidden = size - below - above;
      showBase(start, start + below - 1, offset);
      if (hidden > 0 && readable)
        push({
          kind: "gap",
          text: next?.header.text ?? "",
          oldLine: null,
          newLine: null,
          gap: { ...gap, hidden },
        });
      else if (hidden > 0 && next) push({ ...next.header });
      showBase(end! - above + 1, end!, offset);
    } else if (next) push({ ...next.header });
    for (const line of next?.body ?? []) push({ ...line });
  }
  return result;
}

/** Lines of code a reader can select and ask about (not hunk headers or notes). */
export function isCodeLine(line: DiffLine): boolean {
  return (
    line.kind === "context" || line.kind === "added" || line.kind === "removed"
  );
}

/** One hunk: its header line and the lines below it, notes included. */
export type Hunk = { header?: DiffLine; lines: DiffLine[] };

/**
 * The hunks of a parsed diff in order; lines before any header form a hunk
 * without one. A gap row of unchanged lines (expandDiff) heads the hunk
 * below it the way its header would.
 */
export function groupHunks(lines: DiffLine[]): Hunk[] {
  const hunks: Hunk[] = [];
  for (const line of lines) {
    if (line.kind === "hunk" || line.kind === "gap")
      hunks.push({ header: line, lines: [] });
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
 * The reveal that also shows lines startLine to endLine of the current file.
 * Lines already shown change nothing; otherwise a gap opens upward from the
 * change below it when the range reaches that change or the lines already
 * opened there (or is nearer to it), and downward from the change above
 * otherwise. A function around a change so appears whole without
 * unrolling the rest of the gap.
 */
export function revealLines(
  lines: DiffLine[],
  base: string[],
  reveal: Reveal,
  startLine: number,
  endLine: number,
): Reveal {
  const next = { ...reveal };
  for (const gap of diffGaps(lines, base)) {
    if (gap.end === null) continue;
    const first = Math.max(gap.start, startLine - gap.offset);
    const last = Math.min(gap.end, endLine - gap.offset);
    if (first > last) continue;
    const shown = next[gap.index] ?? { below: 0, above: 0 };
    const belowEnd = gap.start + shown.below - 1;
    const aboveStart = gap.end - shown.above + 1;
    let hidden = false;
    for (let line = first; line <= last && !hidden; line++)
      hidden = line > belowEnd && line < aboveStart;
    if (!hidden) continue;
    // Grow the side the range touches, or the nearer one.
    const upward =
      !!gap.next &&
      (last >= aboveStart - 1 || gap.end - last < first - gap.start);
    next[gap.index] = upward
      ? { ...shown, above: Math.max(shown.above, gap.end - first + 1) }
      : { ...shown, below: Math.max(shown.below, last - gap.start + 1) };
  }
  return next;
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
    if (line.kind === "hunk" || line.kind === "note" || line.kind === "gap") {
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
