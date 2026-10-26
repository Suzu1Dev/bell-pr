/**
 * Whether Markdown text nests deeper than the GFM parser (micromark) should
 * be asked to read. Its time grows with the square (or worse) of some
 * nesting, so a few thousand levels take seconds and more take minutes or
 * overflow the stack: quote, list and footnote markers that open on one line
 * ("- - - … x", "[^a]: [^a]: …"), list items and footnotes that indentation
 * continues line after line, emphasis and strikethrough that close around
 * each other ("*a *a … a* a*", "***…a…***", "~a ~a … a~ a~"), links or images
 * that close around each other ("[a [a … ](b) ](b)"), closers that look back
 * past many open delimiters ("_a _a … a* a*"), and long chains of delimiters
 * that each both open and close ("a*a*a*…", ".~.~.~…"). Emphasis depth counts
 * the parser's pairings: "**" or "~~" closing its partner is one level, and
 * one long run ("*****…") counts half its length, since the parser pairs it
 * two characters at a time. Sibling markup ("**a** **b**", "[a](b) [c](d)")
 * and openers that never close cost the parser little, and do not count.
 *
 * One pass, linear in the text. It is a heuristic, not a parser: it follows
 * CommonMark only as far as the limit needs, and errs toward counting.
 * Nothing is skipped: code (fenced blocks and their info strings, indented
 * blocks, code spans, autolinks and HTML tags, and code spans or tags inside
 * code) is read into the same count, against `codeFactor` times the limit, so where this reading and the parser disagree about what
 * is code, what opens in one still closes in the other, and at most that
 * much nesting goes unseen. The count starts again only where inline text
 * surely ends: a blank line (spaces and tabs only), a line of nothing but
 * quote or footnote markers, an ATX heading at the margin, or a thematic
 * break.
 * Callers show or read text this flags as written instead of parsing it.
 */
export const markdownNestingLimit = 32;

/** How much more nesting text read as code may hold. */
const codeFactor = 4;
/** How far down the open runs a closer looks for one the parser would pair it with. */
const pairingReach = 64;
/** "---", "* * *", "___": a line of three or more of one of these, spaces allowed. */
const thematicBreak = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
/**
 * A quote marker, a footnote definition's label ("[^1]:"), or a list marker
 * followed by a space, a tab or the line's end, at any indentation.
 */
const containerMarker = /[ \t]*(?:>|\[\^(?:\\.|[^\\\]])+\]:|(?:[-*+]|\d{1,9}[.)])(?=[ \t]|$))[ \t]?/y;
/** A fence's opening or closing line, after any quote or list markers. */
const fenceLine = /^[ \t]*(`{3,}|~{3,})(.*)$/;
/**
 * CommonMark's autolinks and open or closing HTML tags. Comments, processing
 * instructions and declarations are left out: a lazy match for them would be
 * quadratic here. Whatever this misses is read as text; whatever it takes is
 * read as code.
 */
const angleSpan =
  /<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*|[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*|[A-Za-z][A-Za-z0-9-]*(?:[ \t]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[ \t]*=[ \t]*(?:[^\s"'=<>`]+|'[^'\n<]*'|"[^"\n<]*"))?)*[ \t]*\/?|\/[A-Za-z][A-Za-z0-9-]*[ \t]*)>/y;
const blank = /^[ \t]*$/;
/** An ATX heading at the margin: "#" to "######" after at most three spaces, then a space, a tab or the line's end. */
const atxHeading = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const whitespace = /\s/u;
const punctuation = /[\p{P}\p{S}]/u;

interface Run {
  kind: string;
  /** Delimiters of the run still open. */
  size: number;
  /** The run's length as written, for the rule of 3. */
  length: number;
  /** Whether the run could also close, for the rule of 3. */
  canClose: boolean;
  /** The depth already closed inside the run. */
  inner: number;
}

/** Open delimiter runs and brackets of one block of inline text. */
class Nesting {
  /** Emphasis ("*", "_") and strikethrough ("~") pair in separate passes, so each has its own runs. */
  private runs: Record<"emphasis" | "strike", Run[]> = { emphasis: [], strike: [] };
  /** Open brackets, each with the depth already closed inside it. */
  private brackets: number[] = [];
  /** Open runs that closers looked back past without a match. */
  private lookBack = 0;
  /** Runs that could both open and close: the parser reads a long chain of them in quadratic time. */
  private both = 0;

  reset() {
    this.runs = { emphasis: [], strike: [] };
    this.brackets = [];
    this.lookBack = 0;
    this.both = 0;
  }

  /** A delimiter run; true when it closes deeper than `limit` or makes the parser look back too far. */
  delimiter(kind: string, length: number, canOpen: boolean, canClose: boolean, limit: number): boolean {
    if (canOpen && canClose && ++this.both > limit * 64) return true;
    const runs = this.runs[kind === "~" ? "strike" : "emphasis"];
    let size = length;
    if (canClose) {
      let depth = 0;
      while (size > 0) {
        // The nearest open run the parser would pair this closer with.
        let match = -1;
        for (let index = runs.length - 1; index >= Math.max(0, runs.length - pairingReach); index--)
          if (pairs(runs[index], kind, length, canOpen)) {
            match = index;
            break;
          }
        if (match < 0) {
          // The parser looks back over every open run for one it can close:
          // about 500,000 such steps take it a few hundred milliseconds at
          // most, while a C++ crash report pasted without a fence ("T*"
          // closers past "__1" openers) reaches 65,536 in 150 frames.
          this.lookBack += this.runs.emphasis.length + this.runs.strike.length;
          if (this.lookBack > limit * limit * 512) return true;
          break;
        }
        // Runs between an opener and its closer become text inside the span.
        while (runs.length - 1 > match) depth = Math.max(depth, runs.pop()!.inner);
        const run = runs[match];
        const used = Math.min(size, run.size);
        // The parser pairs a run two characters at a time: "**" closing "**" is one level.
        depth = Math.max(depth, run.inner) + Math.ceil(used / 2);
        if (depth > limit) return true;
        size -= used;
        run.size -= used;
        if (run.size === 0) runs.pop();
      }
      this.nest(depth);
    }
    if (canOpen && size > 0) runs.push({ kind, size, length, canClose, inner: 0 });
    return false;
  }

  openBracket() {
    this.brackets.push(0);
  }

  /** A closing bracket; true when it closes deeper than `limit`. */
  closeBracket(limit: number): boolean {
    const inner = this.brackets.pop();
    if (inner === undefined) return false;
    const depth = inner + 1;
    if (depth > limit) return true;
    this.nest(depth);
    return false;
  }

  /** What closed at `depth` nests inside whatever is still open, in every pass. */
  private nest(depth: number) {
    for (const open of [this.runs.emphasis, this.runs.strike]) {
      const outer = open[open.length - 1];
      if (outer) outer.inner = Math.max(outer.inner, depth);
    }
    const bracket = this.brackets.length - 1;
    if (bracket >= 0) this.brackets[bracket] = Math.max(this.brackets[bracket], depth);
  }
}

/**
 * Whether the parser pairs a closing run with this open one: the same
 * character; for strikethrough the same length ("~" with "~", "~~" with
 * "~~"); for emphasis CommonMark's rule of 3.
 */
function pairs(run: Run, kind: string, length: number, canOpen: boolean) {
  if (run.kind !== kind) return false;
  if (kind === "~") return run.length === length;
  return !((run.canClose || canOpen) && (run.length + length) % 3 === 0 && !(run.length % 3 === 0 && length % 3 === 0));
}

/** Whether `markdown` nests deeper than `limit` in any of the ways above. */
export function markdownTooNested(markdown: string, limit = markdownNestingLimit): boolean {
  const codeLimit = limit * codeFactor;
  // One count for prose and code alike; code only raises the limit.
  const nesting = new Nesting();
  let fence: { char: string; size: number } | undefined;
  let inParagraph = false;
  // Footnote definitions that may still be open: four columns at the start of a line continue all of them.
  let footnotes = 0;
  // Columns before the line that opened them: four more than that continue them.
  let footnoteIndent = 0;
  const reset = () => {
    nesting.reset();
    inParagraph = false;
  };
  // A lone carriage return ends a line for the parser too.
  for (const line of markdown.split(/\r\n?|\n/)) {
    if (blank.test(line) || (!fence && thematicBreak.test(line))) {
      reset();
      continue;
    }
    // A heading with no marker before it is a block of one line: it
    // interrupts any paragraph and cannot be a lazy continuation.
    if (!fence && atxHeading.test(line)) {
      reset();
      if (inline(line, nesting, limit, codeLimit)) return true;
      reset();
      continue;
    }
    // Quote, list and footnote markers that open at the start of the line,
    // and items opened above that the white space before them continues:
    // each takes two columns of it or more (a tab, up to four).
    let position = 0;
    let markers = 0;
    let indent = 0;
    let opened = 0;
    let listMarker = false;
    let afterList = false;
    // Columns of white space before the first marker: four or more, and it cannot start a quote or a list.
    let lead = 0;
    for (;;) {
      containerMarker.lastIndex = position;
      const match = containerMarker.exec(line);
      if (!match) break;
      // Five or more columns after a list marker start an indented code
      // block in its item (a comment box's " *      *"): nothing after nests.
      if (afterList && match[0].length - match[0].trimStart().length >= 4) break;
      const marker = match[0].trim();
      if (markers === 0) for (const char of match[0].slice(0, match[0].length - match[0].trimStart().length)) lead += char === "\t" ? 4 : 1;
      // A quote marker costs the parser about a quarter of a list marker:
      // pytest's "--pdb" separators (">>>…>>> traceback >>>…>>>") nest 34.
      markers += marker.startsWith(">") ? 1 / codeFactor : 1;
      for (const char of match[0].trimEnd()) indent += char === "\t" ? 4 : char === " " ? 1 : 0;
      const continued = Math.floor(indent / 2) + (indent >= footnoteIndent + 4 ? footnotes : 0);
      if (Math.ceil(markers) + continued > (fence ? codeLimit : limit)) return true;
      if (marker.startsWith("[")) opened++;
      afterList = !marker.startsWith(">") && !marker.startsWith("[");
      if (afterList) listMarker = true;
      position = containerMarker.lastIndex;
    }
    if (opened) {
      if (footnotes && indent >= footnoteIndent + 4) footnotes += opened;
      else {
        footnotes = opened;
        footnoteIndent = indent;
      }
    }
    const rest = line.slice(position);
    // An empty list item cannot interrupt a paragraph, nor can a marker
    // indented four columns or more: such a line ends nothing.
    if (blank.test(rest)) {
      if (!listMarker && lead <= 3) reset();
      continue;
    }
    // Fence lines start nothing again: the parser may not see the fence at
    // all (indented past an item's content, or after "2.", which cannot
    // interrupt a paragraph).
    const fenceMatch = fenceLine.exec(rest);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence.char && fenceMatch[1].length >= fence.size && blank.test(fenceMatch[2]))
        fence = undefined;
      else if (inline(rest, nesting, codeLimit, codeLimit)) return true;
      continue;
    }
    if (fenceMatch && !(fenceMatch[1][0] === "`" && fenceMatch[2].includes("`"))) {
      fence = { char: fenceMatch[1][0], size: fenceMatch[1].length };
      // The parser may read this line as text too, info string and all.
      if (inline(fenceMatch[2], nesting, codeLimit, codeLimit)) return true;
      continue;
    }
    // An indented line outside a paragraph may be code, or a list item's text: read it against the code limit.
    // So is a line whose first marker sits four columns in, such as a C comment's " * " in an indented block.
    const code = !inParagraph && (lead >= 4 || /^(?: {4}|\t)/.test(rest));
    if (!code) inParagraph = true;
    if (inline(rest, nesting, code ? codeLimit : limit, codeLimit)) return true;
  }
  return false;
}

/**
 * Reads one line of inline text into `nesting` against `limit`. What a code
 * span or an HTML tag encloses is read too, against `codeLimit`: the parser
 * may pair backticks otherwise (across lines). Text already read against
 * `codeLimit` reads straight through tags. True when either goes past its
 * limit.
 */
function inline(text: string, nesting: Nesting, limit: number, codeLimit: number): boolean {
  // Backtick runs, for code spans: a run closes at the next run of the same length.
  const runs = new Map<number, number[]>();
  for (const match of text.matchAll(/`+/g)) {
    const list = runs.get(match[0].length) ?? [];
    list.push(match.index);
    runs.set(match[0].length, list);
  }
  const nextRun = new Map<number, number>();
  for (let index = 0; index < text.length; ) {
    const char = text[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "`") {
      let end = index;
      while (text[end] === "`") end++;
      const size = end - index;
      // A run that starts after an escaped backtick has a length of its own, perhaps listed nowhere.
      const list = runs.get(size) ?? [];
      let next = nextRun.get(size) ?? 0;
      while (next < list.length && list[next] <= index) next++;
      nextRun.set(size, next);
      if (next < list.length) {
        if (inline(text.slice(end, list[next]), nesting, codeLimit, codeLimit)) return true;
        index = list[next] + size;
      } else index = end;
      continue;
    }
    if (char === "<" && limit !== codeLimit) {
      angleSpan.lastIndex = index;
      if (angleSpan.exec(text)) {
        if (inline(text.slice(index + 1, angleSpan.lastIndex - 1), nesting, codeLimit, codeLimit)) return true;
        index = angleSpan.lastIndex;
        continue;
      }
    }
    if (char === "[") {
      nesting.openBracket();
      index++;
      continue;
    }
    if (char === "]") {
      if (nesting.closeBracket(limit)) return true;
      index++;
      continue;
    }
    if (char === "*" || char === "_" || char === "~") {
      let end = index;
      let changes = 0;
      for (; text[end] === char || (char !== "~" && (text[end] === "*" || text[end] === "_")); end++)
        if (end === index || text[end] !== text[end - 1]) changes++;
      const before = index > 0 ? text[index - 1] : " ";
      const after = end < text.length ? text[end] : " ";
      // A long run that alternates "*_*_…" and can open or close: each change is a run of its own.
      if (changes > limit && (flanking(before, after) || flanking(after, before))) return true;
      for (let start = index; start < end; ) {
        const kind = text[start];
        let stop = start;
        while (text[stop] === kind) stop++;
        const size = stop - start;
        const previous = start > 0 ? text[start - 1] : " ";
        const following = stop < text.length ? text[stop] : " ";
        const left = flanking(previous, following);
        const right = flanking(following, previous);
        // GFM strikethrough takes runs of one or two tildes; longer ones are text.
        if (kind !== "~" || size <= 2) {
          // The parser lets "*" open before a "~" and close after one, as for any marker another construct uses.
          const canOpen = kind === "_" ? left && (!right || punctuation.test(previous)) : left || (kind === "*" && following === "~");
          const canClose = kind === "_" ? right && (!left || punctuation.test(following)) : right || (kind === "*" && previous === "~");
          if (nesting.delimiter(kind, size, canOpen, canClose, limit)) return true;
        }
        start = stop;
      }
      index = end;
      continue;
    }
    index++;
  }
  return false;
}

/** CommonMark's left-flanking test for a delimiter run between `before` and `after`; swapped, right-flanking. */
function flanking(before: string, after: string) {
  if (whitespace.test(after)) return false;
  return !punctuation.test(after) || whitespace.test(before) || punctuation.test(before);
}
