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
