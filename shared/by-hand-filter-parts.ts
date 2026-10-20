/**
 * Parts of the code filter (shared/by-hand-filter.ts) that keep it linear
 * in the agent's text and the files it is checked against. Server only.
 *
 * - What the filter reads from its sources (their text, words and lines)
 *   is made once per sources object: an answer's fields, a walkthrough's
 *   units, share it.
 * - Inline code spans and HTML code elements are found in one pass, the
 *   same matches the filter's patterns found: as patterns they read the
 *   rest of the text again from each backtick of a long run, and from each
 *   start tag that is never closed, so an agent field of a few thousand
 *   backticks or start tags held the server for seconds.
 */
import type { FilterSources } from "./by-hand-filter.js";

/** What the filter reads from one sources object. */
interface SourceText {
  /** The cited files' text and the person's diff, where code the guide shows must occur. */
  known: string[];
  /** The identifier-like words of `known`: a name counts only as a whole word ("wait" is not one because "await" is). */
  words: Set<string>;
  /** Single lines of the files and of the person's diff (without its +, - or space), trimmed, for diff lines. */
  lines: Set<string>;
  /** Every file's lines at base and in the worktree, trailing spaces aside, and each such line. */
  files: string[][];
  fileLines: Set<string>;
  /** Code blocks already checked against the files. */
  checked: Map<string, boolean>;
}

const read = new WeakMap<FilterSources, SourceText>();

/** What the filter reads from `sources`, made the first time it is asked for. */
export function sourceText(sources: FilterSources): SourceText {
  const known = read.get(sources);
  if (known) return known;
  const files = [...Object.values(sources.base), ...Object.values(sources.worktree)].filter(
    (lines): lines is readonly string[] => !!lines,
  );
  const text = [...files.map((lines) => lines.join("\n")), ...(sources.diff ? [sources.diff] : [])];
  const trimmed = files.map((lines) => lines.map((line) => line.trimEnd()));
  const made: SourceText = {
    known: text,
    words: new Set(text.flatMap((source) => source.match(/[A-Za-z_$][\w$]*/g) ?? [])),
    lines: new Set([
      ...files.flatMap((file) => file.map((line) => line.trim())),
      ...(sources.diff ?? "").split("\n").map((line) => line.slice(1).trim()),
    ]),
    files: trimmed,
    fileLines: new Set(trimmed.flat()),
    checked: new Map(),
  };
  read.set(sources, made);
  return made;
}

/**
 * Whether `block` is a contiguous run of lines of one of the files
 * (trailing spaces aside). A block with a line no file has is not looked
 * for, and a block is looked for once per sources object.
 */
export function verbatimLines(block: readonly string[], sources: FilterSources) {
  const wanted = block.map((line) => line.trimEnd());
  while (wanted.length && !wanted[wanted.length - 1]) wanted.pop();
  while (wanted.length && !wanted[0]) wanted.shift();
  if (!wanted.length) return false;
  const { files, fileLines, checked } = sourceText(sources);
  if (!wanted.every((line) => fileLines.has(line))) return false;
  const key = wanted.join("\n");
  if (!checked.has(key))
    checked.set(
      key,
      files.some((file) => {
        for (let start = 0; start + wanted.length <= file.length; start++)
          if (wanted.every((line, index) => file[start + index] === line)) return true;
        return false;
      }),
    );
  return checked.get(key)!;
}

/** A found span and the text the filter decides on. */
export interface CodeSpan {
  start: number;
  end: number;
  /** The span's content: inside the backticks, or the element's body. */
  body: string;
}

/**
 * The inline code spans of `text`, as /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g
 * finds them: an opening run of backticks is the end of a run (its whole
 * length first, then shorter ones), with at least one other character
 * after it, and the closer is the next run of exactly its length. Each
 * length's runs are looked up in order, so every run is passed once.
 */
export function inlineCodeSpans(text: string): CodeSpan[] {
  const runs = [...text.matchAll(/`+/g)].map((run) => ({ at: run.index, length: run[0].length }));
  const byLength = new Map<number, number[]>();
  runs.forEach((run, index) => {
    const same = byLength.get(run.length);
    if (same) same.push(index);
    else byLength.set(run.length, [index]);
  });
  // How many runs of each length lie before the run being read.
  const passed = new Map<number, number>();
  const spans: CodeSpan[] = [];
  for (let index = 0; index < runs.length; index++) {
    const run = runs[index];
    for (let ticks = run.length; ticks >= 1; ticks--) {
      const same = byLength.get(ticks);
      if (!same) continue;
      let next = passed.get(ticks) ?? 0;
      while (next < same.length && same[next] <= index) next++;
      passed.set(ticks, next);
      if (next === same.length) continue;
      const closer = runs[same[next]];
      spans.push({ start: run.at + run.length - ticks, end: closer.at + ticks, body: text.slice(run.at + run.length, closer.at) });
      index = same[next];
      break;
    }
  }
  return spans;
}

/** HTML elements that show code (the guide's text is never rendered as HTML, so the code would show). */
const codeTags = "pre|code|samp|kbd|tt|var|xmp|listing|plaintext|textarea|script|style";
const startTag = new RegExp(`<(?:${codeTags})\\b`, "gi");
/** One element at a start tag: its body runs to its end tag or to the end of the text. */
const elementAt = new RegExp(`<(${codeTags})\\b[^>]*>([\\s\\S]*?)(?:<\\/\\1\\s*>|$(?![\\s\\S]))`, "iy");

/**
 * The HTML code elements of `text`, as
 * /<(pre|code|…)\b[^>]*>([\s\S]*?)(?:<\/\1\s*>|$(?![\s\S]))/gi finds them:
 * a start tag after the text's last ">" can never end and is not tried.
 */
export function htmlCodeElements(text: string): CodeSpan[] {
  const lastClose = text.lastIndexOf(">");
  const spans: CodeSpan[] = [];
  let end = 0;
  for (const tag of text.matchAll(startTag)) {
    if (tag.index > lastClose) break;
    if (tag.index < end) continue;
    elementAt.lastIndex = tag.index;
    const element = elementAt.exec(text);
    if (!element) continue;
    end = tag.index + element[0].length;
    spans.push({ start: tag.index, end, body: element[2] });
  }
  return spans;
}

/** `text` with each span replaced by what `replace` gives for it (its text and body). */
export function replaceSpans(text: string, spans: readonly CodeSpan[], replace: (whole: string, body: string) => string) {
  let out = "";
  let last = 0;
  for (const span of spans) {
    out += text.slice(last, span.start) + replace(text.slice(span.start, span.end), span.body);
    last = span.end;
  }
  return out + text.slice(last);
}
