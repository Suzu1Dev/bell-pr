/**
 * A guard before every GFM parse (README v1.2 §18.11 item 2; the N1B
 * security review): the parser (micromark with GFM) takes super-linear time
 * on some shapes, and deep nesting overflows the stack in it or in React.
 * Text that is too long, too deeply nested, or too dense in lazy
 * continuation lines, emphasis, link openers or inline raw HTML is not
 * parsed: the renderer shows it as plain text with a notice, and the draft
 * checks read it with `roughProse`. Both run in linear time. Measured on
 * the parser: the costliest shapes that pass (nested lists by indent,
 * tables, headings, dotted words at 12,000 characters; 1,500 emphasis runs)
 * take up to about 70 ms; beyond the limits, shapes took seconds (setext
 * headings, lazy continuation, emphasis, unclosed inline raw HTML) or threw
 * (nesting).
 */
export const markdownLimits = {
  /** Characters of the whole text. */
  chars: 12_000,
  /** Lines with text, outside code fences (setext headings, table rows and list items cost most). */
  lines: 1_000,
  /** Block quotes and list items one line opens. */
  depth: 16,
  /** Lines of one paragraph that continue a quote or list item lazily (without its marker or indent). */
  lazyLines: 400,
  /** Emphasis, strikethrough and link openers in one paragraph; inline raw HTML ("<!--", "<?", "<!") counts five. */
  delimiters: 500,
} as const;

/** A code fence's opening or closing line, inside block quotes or a list item too. */
const fenceLine = /^[ \t>]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?(`{3,}|~{3,})([^`]*)$/;
/** One block quote or list item marker at the start of what is left of a line. */
const containerMarker = /^ {0,3}(?:>|[-*+](?=[ \t]|$)|\d{1,9}[.)](?=[ \t]|$))[ \t]?/;
/** Emphasis and strikethrough runs (an underscore inside a word is no emphasis) and link openers. */
const delimiter = /\*+|~+|(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])|\[/gu;
/** Inline raw HTML that reads to its closer: unclosed, each reads to the paragraph's end. */
const htmlOpener = /<[!?]/g;

/** The fence a line opens or closes, or undefined. */
function fenceOf(line: string) {
  const match = fenceLine.exec(line);
  return match ? { char: match[1][0], size: match[1].length, info: match[2].trim() } : undefined;
}

/** Whether `text` is beyond what the GFM parser reads quickly (see markdownLimits). */
export function markdownTooHeavy(text: string): boolean {
  if (text.length > markdownLimits.chars) return true;
  let fence: { char: string; size: number } | undefined;
  let lines = 0;
  let inContainer = false;
  let lazy = 0;
  let delimiters = 0;
  for (const line of text.split("\n")) {
    const marker = fenceOf(line);
    if (fence) {
      if (marker && marker.char === fence.char && marker.size >= fence.size && !marker.info) fence = undefined;
      continue;
    }
    if (marker) {
      fence = marker;
      continue;
    }
    if (!line.trim()) {
      inContainer = false;
      lazy = 0;
      delimiters = 0;
      continue;
    }
    if (++lines > markdownLimits.lines) return true;
    let rest = line;
    let depth = 0;
    for (let match = containerMarker.exec(rest); match && match[0]; match = containerMarker.exec(rest)) {
      if (++depth > markdownLimits.depth) return true;
      rest = rest.slice(match[0].length);
    }
    if (depth) inContainer = true;
    else if (inContainer && !/^[ \t]{2}/.test(line) && ++lazy > markdownLimits.lazyLines) return true;
    delimiters += (rest.match(delimiter)?.length ?? 0) + 5 * (rest.match(htmlOpener)?.length ?? 0);
    if (delimiters > markdownLimits.delimiters) return true;
  }
  return false;
}

/** Spaces in place of `text[start..end)`, line breaks kept, so line numbers still match. */
function blank(chars: string[], start: number, end: number) {
  for (let index = start; index < end; index++) if (chars[index] !== "\n") chars[index] = " ";
}

/**
 * The prose of a text the parser does not read (markdownTooHeavy), line by
 * line in linear time: fenced code blocks (an unclosed one to the end, as
 * GitHub shows it), code spans within a line and closed HTML comments
 * blanked, as markdownProse blanks them. Indented code and an unclosed
 * comment stay prose and are checked.
 */
export function roughProse(markdown: string): string[] {
  const chars = markdown.split("");
  // Closed HTML comments: each "<!--" up to the first "-->" after it.
  for (let start = markdown.indexOf("<!--"); start >= 0; ) {
    const end = markdown.indexOf("-->", start + 4);
    if (end < 0) break;
    blank(chars, start, end + 3);
    start = markdown.indexOf("<!--", end + 3);
  }
  const original = markdown.split("\n");
  let fence: { char: string; size: number } | undefined;
  return chars
    .join("")
    .split("\n")
    .map((line, index) => {
      const marker = fenceOf(original[index]);
      if (fence) {
        if (marker && marker.char === fence.char && marker.size >= fence.size && !marker.info) fence = undefined;
        return "";
      }
      if (marker) {
        fence = marker;
        return "";
      }
      const prose = codeSpansBlanked(line);
      return prose.trim() ? prose : "";
    });
}

/**
 * A line with its code spans blanked: a backtick run up to the next run
 * of the same length, as far as the next backtick allows (linear: a span
 * never scans past a backtick), roughly as GFM reads them.
 */
const codeSpansBlanked = (line: string) => line.replace(/(`+)[^`]*?\1/g, (span) => " ".repeat(span.length));
