/**
 * The code filter of a Learn-by-hand run (DESIGN v1.2 F7), pure core: what
 * an agent wrote is filtered before it is stored, so code reaches the
 * person only as quotes BELL cuts itself from the base commit or from the
 * person's own files. server/by-hand-filter.ts reads those files.
 *
 * 1. A fenced code block is removed unless it is a contiguous run of lines
 *    of a cited or changed file, at base or in the worktree.
 * 2. An inline code span is kept only if its exact text occurs in a cited
 *    file (base or worktree) or in the person's diff, or, for a tooling
 *    answer, if it is a one-line command of at most 120 characters that
 *    does not combine a changed or step file with an editing command or a
 *    redirection; otherwise it becomes "…". An identifier the guide
 *    invents in its prose (one that occurs in none of those) becomes "…"
 *    too, and so does an expression it writes into prose.
 * 3. A code field (an explanation's example.before/after and the like) is
 *    kept only when it is verbatim in base or worktree; otherwise it is
 *    dropped.
 * 4. Every removal is counted. There is no retry turn: when nothing but
 *    removals remains, the answer is the pointers of its valid refs.
 *
 * Quotes are references (`cutQuote`): at most 15 lines, shifted up to 3
 * lines to find their anchor, dropped (and counted) otherwise; a ref
 * outside its file is dropped and counted.
 */
import { byHandLimits, type GuideQuote } from "./by-hand.js";

/** The text the filter checks agent output against. */
export interface FilterSources {
  /** Lines of each cited or changed file at the base commit; absent where it does not exist. */
  base: Readonly<Record<string, readonly string[] | undefined>>;
  /** Lines of each cited or changed file in the person's worktree. */
  worktree: Readonly<Record<string, readonly string[] | undefined>>;
  /** The person's diff. */
  diff?: string;
  /** The changed files and the step's files, which a tooling command must not edit. */
  protectedFiles?: readonly string[];
}

/** A filtered value with what the filter removed (code) and dropped (quotes, refs, fields). */
export interface Filtered<T> {
  value: T;
  removed: number;
  dropped: number;
}

/** A guide answer as the guide's schema gives it (server/by-hand-schemas.ts). */
export interface GuideOutput {
  text: string;
  question?: string | null;
  refs: { path: string; line: number; endLine?: number | null }[];
  quotes: { path: string; startLine: number; endLine: number; from: string; anchor?: string | null }[];
  options?: { name: string; tradeoff: string }[] | null;
  topic: string;
  askedForCode: boolean;
}

/** A guide answer as BELL stores it: valid refs, quotes BELL cut, filtered prose. */
export interface FilteredGuideOutput {
  text: string;
  question?: string;
  refs: { path: string; line: number; endLine?: number }[];
  quotes: GuideQuote[];
  options?: { name: string; tradeoff: string }[];
  topic: string;
  askedForCode: boolean;
}

const removedMark = "…";
const trimEnd = (line: string) => line.replace(/\s+$/, "");

/** Every file's lines at base and in the worktree. */
const allFiles = (sources: FilterSources) =>
  [...Object.values(sources.base), ...Object.values(sources.worktree)].filter(
    (lines): lines is readonly string[] => !!lines,
  );

/** Whether `block` is a contiguous run of lines of one of the files (trailing spaces aside). */
function verbatimLines(block: readonly string[], sources: FilterSources) {
  const wanted = block.map(trimEnd);
  while (wanted.length && !wanted[wanted.length - 1]) wanted.pop();
  while (wanted.length && !wanted[0]) wanted.shift();
  if (!wanted.length) return false;
  return allFiles(sources).some((lines) => {
    const file = lines.map(trimEnd);
    for (let start = 0; start + wanted.length <= file.length; start++)
      if (wanted.every((line, index) => file[start + index] === line)) return true;
    return false;
  });
}

/** The cited files' text and the person's diff, where code the guide shows must occur. */
const corpus = (sources: FilterSources) => [
  ...allFiles(sources).map((lines) => lines.join("\n")),
  ...(sources.diff ? [sources.diff] : []),
];

/** Commands and redirections that edit a file. */
const editing = /\bsed\s+(?:-\w*\s+)*-\w*i|\bperl\s+(?:-\w*\s+)*-\w*[pi]\w*i|\bpatch\b|\bgit\s+apply\b|\btee\b|>{1,2}|\bawk\s+(?:-\w+\s+)*-i\b|\bed\b/;

/**
 * A tooling answer's one-line command: at most 120 characters, not shaped
 * like code (ending in ; { or }, or with an arrow), naming no identifier
 * the project's files don't have, and editing no changed or step file.
 */
function safeCommand(span: string, sources: FilterSources, occurs: (code: string) => boolean) {
  if (span.includes("\n") || span.length > 120 || /[;{}]\s*$|=>/.test(span)) return false;
  if ([...span.matchAll(identifier)].some(([word]) => !occurs(word))) return false;
  const touches = (sources.protectedFiles ?? []).some(
    (file) => span.includes(file) || span.includes(file.split("/").pop() ?? file),
  );
  return !(touches && editing.test(span));
}

/** Fenced code blocks, ``` or ~~~, closed or running to the end of the text. */
const fence = /^( {0,3})(`{3,}|~{3,})[^\n]*\n([\s\S]*?)(?:\n {0,3}\2[`~]*[ \t]*(?=\n|$)|$(?![\s\S]))/gm;
/** Inline code spans of one or more backticks. */
const inline = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g;
/**
 * An expression written into prose: operands joined by code operators with
 * spaces around them on one line ("delayMs * 2 ** attempt;", "x => y"). A
 * spaced hyphen or slash is a dash or "or" in prose, not an operator, and
 * a "*" or "+" that starts a line is a list item.
 */
const expression = /[\w$.()[\]'"]+(?:[ \t]+(?:=>|===|!==|==|!=|\*\*|&&|\|\||[-+*/%]=|<=|>=|[<>*%+=])[ \t]+[\w$.()[\]'"]+)+;?/g;
/** Identifier-like words of prose: camelCase, snake_case and calls such as `retry(`; never part of a path. */
const identifier = /(?<![\w$./-])(?:[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*|[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+|[A-Za-z_$][\w$]*(?=\())(?![\w$/]|\.\w)/g;

/**
 * Filters agent prose (rules 1 and 2): fences, inline code spans and
 * invented identifiers. `tooling` allows the one-line commands of rule 2.
 * With `refs`, an answer left with nothing but removals becomes their
 * pointers (rule 4).
 */
export function filterAgentText(
  text: string,
  sources: FilterSources,
  options: { tooling?: boolean; refs?: readonly { path: string; line: number; endLine?: number }[] } = {},
): Filtered<string> {
  const known = corpus(sources);
  const occurs = (code: string) => known.some((source) => source.includes(code));
  let removed = 0;
  const remove = () => {
    removed++;
    return removedMark;
  };
  // What stays as written is held aside, so a later rule never reads into it.
  const held: string[] = [];
  const hold = (piece: string) => `\uE000${held.push(piece) - 1}\uE000`;
  let value = text
    .replace(fence, (block, _indent: string, _fence: string, body: string) =>
      verbatimLines(body.split("\n"), sources) ? hold(block) : remove(),
    )
    .replace(inline, (span, _ticks: string, body: string) => {
      const code = body.trim();
      return code && (occurs(code) || (options.tooling && safeCommand(code, sources, occurs))) ? hold(span) : remove();
    })
    .replace(/\bhttps?:\/\/\S+/g, hold)
    .replace(expression, (code) => (occurs(code.replace(/[.,;:]+$/, "")) ? code : remove()))
    .replace(identifier, (word) => (occurs(word) ? word : remove()));
  value = value.replace(/\uE000(\d+)\uE000/g, (_match, index: string) => held[Number(index)]);
  if (removed && options.refs?.length && !/[\p{L}\p{N}]/u.test(value.replaceAll(removedMark, "")))
    value = options.refs.map(pointer).join("\n");
  return { value, removed, dropped: 0 };
}

/** `path:line` or `path:line-endLine`. */
const pointer = (ref: { path: string; line: number; endLine?: number }) =>
  ref.endLine && ref.endLine > ref.line ? `${ref.path}:${ref.line}-${ref.endLine}` : `${ref.path}:${ref.line}`;

/** Rule 3: a code field kept only when verbatim in base or worktree, dropped otherwise. */
export function filterCodeField(
  value: string | undefined,
  sources: FilterSources,
): Filtered<string | undefined> {
  if (!value?.trim()) return { value, removed: 0, dropped: 0 };
  return verbatimLines(value.split("\n"), sources)
    ? { value, removed: 0, dropped: 0 }
    : { value: undefined, removed: 0, dropped: 1 };
}

/**
 * Cuts a quote by reference from a file's lines: at most 15 lines from
 * `startLine`; with an `anchor` (at most 80 characters) that the lines do
 * not contain, the range shifts up to 3 lines to find it. Undefined (to be
 * dropped and counted) for a range outside the file or an anchor not
 * found.
 */
export function cutQuote(
  lines: readonly string[] | undefined,
  quote: { startLine: number; endLine: number; anchor?: string | null },
): { startLine: number; endLine: number; text: string } | undefined {
  const { startLine, endLine } = quote;
  if (!lines || !Number.isInteger(startLine) || !Number.isInteger(endLine)) return undefined;
  if (startLine < 1 || endLine < startLine || endLine > lines.length) return undefined;
  const length = Math.min(endLine - startLine + 1, byHandLimits.quoteLines);
  const anchor = quote.anchor?.trim().slice(0, byHandLimits.anchorChars);
  for (const shift of anchor ? [0, -1, 1, -2, 2, -3, 3] : [0]) {
    const start = startLine + shift;
    if (start < 1 || start + length - 1 > lines.length) continue;
    const text = lines.slice(start - 1, start - 1 + length).join("\n");
    if (!anchor || text.includes(anchor))
      return { startLine: start, endLine: start + length - 1, text };
  }
  return undefined;
}

/**
 * Filters one guide answer before it is stored: refs inside their files,
 * quotes cut by BELL, and the prose of the text, the question and the
 * options (rules 1, 2 and 4; commands only for `topic: tooling`).
 */
export function filterGuideOutput(
  output: GuideOutput,
  sources: FilterSources,
): Filtered<FilteredGuideOutput> {
  let removed = 0;
  let dropped = 0;
  const lengthOf = (path: string) => (sources.worktree[path] ?? sources.base[path])?.length ?? 0;
  const refs = output.refs.flatMap((ref) => {
    const end = ref.endLine ?? undefined;
    if (ref.line < 1 || ref.line > lengthOf(ref.path) || (end !== undefined && (end < ref.line || end > lengthOf(ref.path)))) {
      dropped++;
      return [];
    }
    return [{ path: ref.path, line: ref.line, ...(end !== undefined && end !== ref.line ? { endLine: end } : {}) }];
  });
  const quotes = output.quotes.flatMap((quote): GuideQuote[] => {
    const lines = quote.from === "change" ? sources.worktree[quote.path] : sources.base[quote.path];
    const cut = cutQuote(lines, quote);
    if (!cut) {
      dropped++;
      return [];
    }
    return [{ path: quote.path, from: quote.from === "change" ? "change" : "base", ...cut }];
  });
  const tooling = output.topic === "tooling";
  const prose = (value: string, withRefs = false) => {
    const result = filterAgentText(value, sources, { tooling, ...(withRefs ? { refs } : {}) });
    removed += result.removed;
    return result.value;
  };
  const text = prose(output.text, true);
  const question = output.question ? prose(output.question) : undefined;
  const options = output.options?.map((option) => ({ name: prose(option.name), tradeoff: prose(option.tradeoff) }));
  return {
    value: {
      text,
      ...(question ? { question } : {}),
      refs,
      quotes: quotes.slice(0, byHandLimits.quotes),
      ...(options?.length ? { options } : {}),
      topic: output.topic,
      askedForCode: output.askedForCode,
    },
    removed,
    dropped,
  };
}
