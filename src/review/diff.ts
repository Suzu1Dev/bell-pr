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
  const hunks: {
    header: DiffLine;
    oldBegin: number;
    oldCount: number;
    newBegin: number;
    newCount: number;
    body: DiffLine[];
  }[] = [];
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
  if (!hunks.length) return lines;
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
  for (let index = 0; index <= hunks.length; index++) {
    const previous = hunks[index - 1];
    const next = hunks[index];
    const start = previous ? previous.oldBegin + previous.oldCount : 1;
    const offset = next
      ? next.newBegin - next.oldBegin
      : previous.newBegin + previous.newCount - start;
    const end = next ? next.oldBegin - 1 : base ? base.length : null;
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

/** Keep context questions within the chat API's 8,000-character limit. */
export function selectionQuestion(path: string, lines: DiffLine[]): string {
  const header = `請用白話解釋 ${path} 中選取的 ${lines.length} 行程式碼，說明它們的用途、變更原因與需要注意的地方。\n\n`;
  const context = lines
    .map((line) => {
      const location =
        line.kind === "removed"
          ? `刪除 舊 L${line.oldLine}`
          : line.kind === "added"
            ? `新增 新 L${line.newLine}`
            : `原有 舊 L${line.oldLine}／新 L${line.newLine}`;
      return `${location}: ${line.text}`;
    })
    .join("\n");
  if (header.length + context.length <= 8000) return header + context;
  const note =
    "\n\n[內容已節錄] 選取範圍較長，下方僅附部分內容，請優先解釋這段節錄。\n";
  return `${header}${note}${context.slice(0, Math.max(0, 8000 - header.length - note.length))}`;
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
