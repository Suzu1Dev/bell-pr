/**
 * The code filter of a Learn-by-hand run (DESIGN v1.2 F7), pure core: what
 * an agent wrote is filtered before it is stored, so code reaches the
 * person only as quotes BELL cuts itself from the base commit or from the
 * person's own files. server/by-hand-filter.ts reads those files.
 *
 * 1. A code block is removed unless it is a contiguous run of lines of a
 *    cited or changed file, at base or in the worktree: a fenced block
 *    (also inside a list item or a quote), an indented block, an HTML
 *    element that shows code (pre, code, …), or a diff hunk; an added
 *    diff line ("+" then code) outside a hunk is removed unless it is a
 *    line of those files or of the person's diff.
 * 2. An inline code span is kept only if its exact text occurs in a cited
 *    file (base or worktree) or in the person's diff, or, for a tooling
 *    answer, if it is a one-line command of at most 120 characters that
 *    does not combine a changed or step file with an editing command or a
 *    redirection; otherwise it becomes "…". An identifier the guide
 *    invents in its prose (one that occurs in none of those) becomes "…"
 *    too, and so does an expression it writes into prose, with spaces or
 *    without ("delay * 2", "delay*2", "x=y", "a&&b", "arr[i]", "i++",
 *    "retry(fn, 2)"), also across a line break Markdown shows as a space.
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
function safeCommand(span: string, sources: FilterSources, isWord: (word: string) => boolean) {
  if (span.includes("\n") || span.length > 120 || /[;{}]\s*$|=>/.test(span)) return false;
  if ([...span.matchAll(identifier)].some(([word]) => !isWord(word))) return false;
  const touches = (sources.protectedFiles ?? []).some(
    (file) => span.includes(file) || span.includes(file.split("/").pop() ?? file),
  );
  return !(touches && editing.test(span));
}

/**
 * Fenced code blocks, ``` or ~~~, after any indentation, quote marker or
 * list marker, closed by the same fence or running to the end of the text.
 */
const fence =
  /^((?:[ \t]*>)*[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?[ \t]*)(`{3,}(?![^\n]*`)|~{3,})[^\n]*\n([\s\S]*?)(?:\n(?:[ \t]*>)*[ \t]*\2[`~]*[ \t]*(?=\n|$)|$(?![\s\S]))/gm;
/** HTML elements that show code (the guide's text is never rendered as HTML, so the code would show). */
const htmlCode =
  /<(pre|code|samp|kbd|tt|var|xmp|listing|plaintext|textarea|script|style)\b[^>]*>([\s\S]*?)(?:<\/\1\s*>|$(?![\s\S]))/gi;
/** A unified diff's hunk header. */
const hunkHeader = /^[ \t]*@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/;
/** A line a diff adds, after any indentation or quote marker; "++" is not one. */
const addedLine = /^((?:[ \t]*>)*[ \t]*)\+(?!\+)(.*)$/;
/** A character of code, which a prose bullet starting with "+" does not need. */
const codeCharacter = /[;{}()=<>[\]]/;
/** A list item's marker and the spaces after it, where the item's text starts. */
const listMarker = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+(?=\S)/;
/** The width of a line's indentation, a tab counting as 4 columns. */
const indentOf = (row: string) => (/^[ \t]*/.exec(row)?.[0] ?? "").replace(/\t/g, "    ").length;
/** A line without up to `width` columns of indentation. */
const dedent = (row: string, width: number) =>
  row.replace(/^[ \t]+/, (margin) => margin.replace(/\t/g, "    ")).replace(new RegExp(`^ {0,${width}}`), "");
/**
 * A long run of base64 (or base64url) text with the mix of capitals,
 * small letters and digits that encoding gives: a payload the person
 * could decode, not prose, a path or a commit hash.
 */
const encodedRun = /[A-Za-z0-9+/_-]{40,}={0,2}/g;
const encoded = (run: string) => {
  const count = (pattern: RegExp) => run.match(pattern)?.length ?? 0;
  const letters = count(/[A-Za-z]/g);
  return count(/\d/g) >= 3 && count(/[A-Z]/g) >= letters / 5 && count(/[a-z]/g) >= letters / 5;
};
/** Marks text held aside while the rules run; never kept from agent text. */
const holdMark = "\uE000";
/** Inline code spans of one or more backticks. */
const inline = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g;
/**
 * An expression written into prose: operands joined by code operators with
 * spaces around them ("delayMs * 2 ** attempt;", "x => y", "a ?? b"). A
 * spaced hyphen or slash is a dash or "or" in prose, not an operator, and
 * a "*" or "+" that starts a line is a list item.
 */
const expression = /[\w$.()[\]'"]+(?:[ \t]+(?:\?\?|<<=?|>>>?=?|[&|^]=|=>|===|!==|==|!=|\*\*|&&|\|\||[-+*/%]=|<=|>=|[<>*%+=])[ \t]+[\w$.()[\]'"]+)+;?/g;
/** Identifier-like words of prose: camelCase, snake_case and calls such as `retry(` (not "file(s)"); never part of a path. */
const identifier = /(?<![\w$./-])(?:[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*|[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+|[A-Za-z_$][\w$]*(?=\((?!(?:s|es|ies)\))))(?![\w$/]|\.\w)/g;
/** Faces that look like names: "o_O", "xD". */
const emoticon = /^(?:[oO]_[oO]|[xX]_[xX]|T_T|xD|XD)$/;
/**
 * A keyboard shortcut ("Ctrl+C", "Cmd+Shift+P"), prose with a "+" in it:
 * key names and single capitals or digits.
 */
const keyChord =
  /^(?:(?:Ctrl|Control|Cmd|Command|Alt|Option|Opt|Shift|Meta|Super|Win|Fn|Esc|Enter|Return|Tab|Space|Backspace|Delete|Del|Home|End|PgUp|PgDn|Up|Down|Left|Right|F\d{1,2}|[A-Z0-9])\+)+(?:[A-Za-z][a-z]*\d*|\d|[^\w\s+])$/;
/** A run of text without spaces, where code written without spaces lives (CJK text around it splits it too). */
const word = /[!-~]+/g;
/**
 * Code written without spaces: a name, number or string, a code operator
 * and another operand ("delay*2", "x=y", "a&&b", "x=>y", "a?.b", "a::b",
 * "Vec<u8>"). "C++", "e-mail", "and/or", "24/7", "10:30" and "3:1" have
 * none: a lone "-", "/", ":", "&", "|" or "^" is no operator here.
 */
const compactOperator =
  /[\w$'")\]](?:===|!==|==|!=|<=|>=|=>|&&|\|\||\?\?|\?\.|\*\*=?|<<=?|>>>?=?|::|[-+*/%&|^]=|[=*%<>+])(?=[\w$'"([{!-])/;
/** Other shapes of code without spaces: "i++", "++i", "arr[i]", "x?1:2", "{retries:3}". */
const compactShapes = [
  /(?<![\w$+])(?![cCgG]\+\+)[A-Za-z_$][\w$.]*(?:\+\+|--)(?![\w$+-])/,
  /(?<![\w$+])\+\+[A-Za-z_$]/,
  /(?<![\w$])[A-Za-z_$][\w$]*\[[^\]\s]*\]/,
  /[\w$)\]]\?[\w$("'-][^\s?:]*:[\w$("'-]/,
  /\{[^{}\s]*[:;=,(][^{}]*\}/,
];
/** Whether a run of text without spaces is code (a CLI flag such as "--max-count=5" and a shortcut are not). */
const compactCode = (run: string) =>
  !keyChord.test(run) &&
  !/^-{1,2}[A-Za-z][\w-]*(?:=[\w./:,@-]*)?$/.test(run) &&
  ((/[A-Za-z_$"']/.test(run) && compactOperator.test(run)) || compactShapes.some((shape) => shape.test(run)));
/** A call with arguments, or a member call ("retry(fn, 2)", "Math.max(a, b)"); "file(s)" is prose. */
const call = /(?<![\w$.])[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\((?!(?:s|es|ies)\))[^()\n]{0,120}\)/g;
/** Characters a reader never sees: zero-width space, word joiner, soft hyphen, byte-order mark, direction marks. */
const invisible = /[\u00AD\u200B\u2060\uFEFF\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
/** ASCII punctuation by its HTML entity name, which Markdown decodes. */
const entityNames: Record<string, string> = {
  lt: "<", gt: ">", amp: "&", quot: '"', apos: "'", ast: "*", midast: "*", lowast: "*", equals: "=", plus: "+",
  minus: "-", lpar: "(", rpar: ")", lsqb: "[", rsqb: "]", lbrack: "[", rbrack: "]", lcub: "{", rcub: "}",
  lbrace: "{", rbrace: "}", semi: ";", colon: ":", excl: "!", percnt: "%", Hat: "^", vert: "|", verbar: "|",
  lowbar: "_", grave: "`", num: "#", dollar: "$", period: ".", comma: ",", quest: "?", commat: "@", sol: "/", bsol: "\\",
};
/**
 * Prose as Markdown shows it, so code can't hide behind an escape
 * ("delay\\*2"), a character reference ("delay&#42;2") or an invisible
 * character; never BELL's own placeholder character.
 */
const asShown = (text: string) =>
  text
    .replace(invisible, "")
    .replace(/&(?:#(\d{1,7})|#[xX]([\da-fA-F]{1,6})|([A-Za-z]+));/g, (entity, decimal?: string, hex?: string, name?: string) => {
      const point = decimal ? Number(decimal) : hex ? parseInt(hex, 16) : undefined;
      if (point === undefined) return entityNames[name!] ?? entity;
      return point > 0 && point <= 0x10ffff && point !== 0xe000 ? String.fromCodePoint(point).replace(invisible, "") : entity;
    })
    .replace(/\\([!-/:-@[-`{-~])/g, "$1");
/** A line break Markdown shows as a space: not before a blank line, a list item, a quote, a heading, a table row or a fence. */
const softBreak = /\n(?![ \t]*(?:\n|$|[-*+][ \t]|\d{1,9}[.)][ \t]|>|#|\||`{3}|~{3}))/g;

/**
 * Replaces the matches of `pattern` found in the text as Markdown shows it,
 * with each soft line break read as a space (the offsets stay the same), so
 * code split over two lines is found; `replace` returns undefined to keep
 * the original text.
 */
function replaceShown(text: string, pattern: RegExp, replace: (match: string) => string | undefined) {
  let out = "";
  let last = 0;
  for (const match of text.replace(softBreak, " ").matchAll(pattern)) {
    const next = replace(match[0]);
    if (next === undefined) continue;
    out += text.slice(last, match.index) + next;
    last = match.index + match[0].length;
  }
  return out + text.slice(last);
}

/**
 * The lines of a diff: each hunk (a header and its lines) is kept only when
 * every line of it is a line of the files or of the person's diff, and an
 * added line outside a hunk ("+" then code) only when it is one.
 */
function diffLines(text: string, known: (line: string) => boolean, keep: (block: string) => string, remove: () => string) {
  const rows = text.split("\n");
  const out: string[] = [];
  for (let index = 0; index < rows.length; index++) {
    if (hunkHeader.test(rows[index])) {
      let end = index + 1;
      while (end < rows.length && /^[ +\-\\]/.test(rows[end]) && !hunkHeader.test(rows[end])) end++;
      const body = rows.slice(index + 1, end).filter((row) => !row.startsWith("\\"));
      out.push(body.every((row) => known(row.slice(1))) ? keep(rows.slice(index, end).join("\n")) : remove());
      index = end - 1;
      continue;
    }
    const added = addedLine.exec(rows[index]);
    out.push(added && codeCharacter.test(added[2]) && !known(added[2]) ? `${added[1]}${remove()}` : rows[index]);
  }
  return out.join("\n");
}

/**
 * Indented code blocks: after a blank line, lines indented 4 columns past
 * the text of the list item they are in (past the margin outside a list).
 * `block` decides each one from its lines and that width.
 */
function indentedBlocks(text: string, block: (rows: string[], width: number) => string) {
  const rows = text.split("\n");
  const out: string[] = [];
  let itemText = 0; // where the text of the current list item starts; 0 outside lists
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const afterBlank = index === 0 || !rows[index - 1].trim();
    const width = itemText + 4;
    if (row.trim() && afterBlank && indentOf(row) >= width) {
      let end = index + 1;
      while (end < rows.length && (!rows[end].trim() || indentOf(rows[end]) >= width)) end++;
      while (!rows[end - 1].trim()) end--;
      out.push(block(rows.slice(index, end), width));
      index = end - 1;
      continue;
    }
    const marker = listMarker.exec(row);
    if (marker) itemText = indentOf(marker[0].replace(/\S/g, " "));
    else if (row.trim() && afterBlank && indentOf(row) < itemText) itemText = 0;
    out.push(row);
  }
  return out.join("\n");
}

/** The text of an HTML element's content: no tags, the usual entities decoded. */
const elementText = (body: string) =>
  body
    .replace(/<\/?[A-Za-z][^>]*>/g, "")
    .replace(/&(lt|gt|quot|#39|apos|amp);/g, (_entity, name: string) =>
      ({ lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", amp: "&" })[name] ?? "",
    );

/**
 * Filters agent prose (rules 1 and 2): code blocks (fenced, indented, an
 * HTML code element or a diff), inline code spans and invented
 * identifiers. `tooling` allows the one-line commands of rule 2. With
 * `refs`, an answer left with nothing but removals becomes their pointers
 * (rule 4).
 */
export function filterAgentText(
  text: string,
  sources: FilterSources,
  options: { tooling?: boolean; refs?: readonly { path: string; line: number; endLine?: number }[] } = {},
): Filtered<string> {
  const known = corpus(sources);
  const occurs = (code: string) => known.some((source) => source.includes(code));
  // An identifier counts as a whole word of the sources: "wait" is not one because "await" is.
  const words = new Set(known.flatMap((source) => source.match(/[A-Za-z_$][\w$]*/g) ?? []));
  const isWord = (word: string) => words.has(word);
  // Single lines of the files and of the person's diff (without its +, - or space), for diff lines.
  const lines = new Set([
    ...allFiles(sources).flatMap((file) => file.map((line) => line.trim())),
    ...(sources.diff ?? "").split("\n").map((line) => line.slice(1).trim()),
  ]);
  const knownLine = (line: string) => !line.trim() || lines.has(line.trim());
  let removed = 0;
  const remove = () => {
    removed++;
    return removedMark;
  };
  // What stays as written is held aside, so a later rule never reads into it.
  const held: string[] = [];
  const hold = (piece: string) => `${holdMark}${held.push(piece) - 1}${holdMark}`;
  /** An encoded payload the sources don't have. */
  const payload = (run: string) => encoded(run) && !occurs(run);
  /** A code block stays when its lines, as written or without their margin, are a run of a file's lines. */
  const block = (whole: string, ...readings: string[][]) =>
    readings.some((rows) => verbatimLines(rows, sources)) ? hold(whole) : remove();
  let value = text.replaceAll(holdMark, "").replace(fence, (whole, prefix: string, _fence: string, body: string) => {
    const quoted = /^(?:[ \t]*>[ \t]?)*/;
    const margin = prefix.replace(quoted, "").length;
    const rows = body.split("\n");
    return block(whole, rows, rows.map((row) => dedent(prefix.includes(">") ? row.replace(quoted, "") : row, margin)));
  });
  value = value.replace(htmlCode, (whole, _tag: string, body: string) => {
    const code = elementText(body);
    return !code.trim() || occurs(code.trim()) || verbatimLines(code.split("\n"), sources) ? hold(whole) : remove();
  });
  value = diffLines(value, knownLine, hold, remove);
  value = indentedBlocks(value, (rows, width) => block(rows.join("\n"), rows, rows.map((row) => dedent(row, width))));
  value = value
    .replace(inline, (span, _ticks: string, body: string) => {
      const code = body.trim();
      return code && (occurs(code) || (options.tooling && safeCommand(code, sources, isWord))) ? hold(span) : remove();
    })
    .replace(/\bhttps?:\/\/\S+/g, (url) => ([...url.matchAll(encodedRun)].some(([run]) => payload(run)) ? remove() : hold(url)));
  // From here on the rules read prose as Markdown shows it.
  value = asShown(value).replace(encodedRun, (run) => (payload(run) ? remove() : run));
  value = replaceShown(value, expression, (code) =>
    occurs(code.replace(/[.,;:]+$/, "")) || keyChord.test(code.replace(/\s+/g, "")) ? undefined : remove(),
  );
  // Code without spaces goes with the run of text it is in, sentence punctuation aside.
  value = value.replace(word, (run) => {
    const code = run.replace(/[.,:!?]+$/, "");
    const bare = code.replace(/^[(["']+|[)\]"';]+$/g, "");
    return !compactCode(code) || occurs(code) || (!!bare && occurs(bare)) ? run : remove() + run.slice(code.length);
  });
  value = value.replace(identifier, (name) => (isWord(name) || emoticon.test(name) ? name : remove()));
  // A call is kept only as the files have it, or as a bare mention of a name they have ("retry()").
  value = replaceShown(value, call, (code) => {
    const bare = /^([\w$.]+)\(\s*\)$/.exec(code);
    return occurs(code) || (bare && bare[1].split(".").every(isWord)) ? undefined : remove();
  });
  value = value.replace(new RegExp(`${holdMark}(\\d+)${holdMark}`, "g"), (_match, index: string) => held[Number(index)]);
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
