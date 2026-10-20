/**
 * A guard before every GFM parse (README v1.2 §18.11 item 2; the N1B
 * security review): the parser (micromark with GFM) takes super-linear time
 * on some shapes, and deep nesting overflows the stack in it or in React.
 * Text that is too long, too deeply nested, or too dense in lazy
 * continuation lines, emphasis, link openers or inline raw HTML is not
 * parsed: the renderer shows it as plain text with a notice, and the draft
 * checks read it with `roughProse`. Both run in linear time. Measured on
 * the parser and the renderer: the costliest shapes that pass take up to
 * about 120 ms (lists nested by tabs at 12,000 characters) and 90 ms
 * (lists and tables of e-mail addresses at 24,000, where lines are
 * indented at most 16 columns and runs without a space are at most 2,000
 * characters); beyond the limits, shapes took seconds (setext headings,
 * lazy continuation, emphasis, unclosed inline raw HTML, a dotted word or
 * dashes of 24,000 characters) or threw (nesting).
 */
export const markdownLimits = {
  /** Characters of the whole text: an agent's long report or a long PR description. */
  chars: 24_000,
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
/** Indented past 16 columns, a tab being four: nested lists by indent cost most in a long text. */
const deepIndent = /^(?: {4}| {0,3}\t){4}[ \t]/;

/**
 * The fence open after `line` (its backtick or tilde run), given the one
 * open before it: a fence closes at a run of its character at least as
 * long, without an info string. The line is code when either is open.
 */
function fenceAfter(fence: string | undefined, line: string) {
  const match = fenceLine.exec(line);
  if (!fence) return match?.[1];
  return match && match[1][0] === fence[0] && match[1].length >= fence.length && !match[2].trim() ? undefined : fence;
}

/** Whether `text` is beyond what the GFM parser reads quickly (see markdownLimits). */
export function markdownTooHeavy(text: string): boolean {
  if (text.length > markdownLimits.chars) return true;
  let fence: string | undefined;
  let lines = 0;
  let inContainer = false;
  let lazy = 0;
  let delimiters = 0;
  for (const line of text.split("\n")) {
    const open = fence;
    fence = fenceAfter(fence, line);
    if (open || fence) continue;
    if (!line.trim()) {
      inContainer = false;
      lazy = 0;
      delimiters = 0;
      continue;
    }
    if (++lines > markdownLimits.lines) return true;
    // Over 12,000 characters (the size limit at first): a line indented past 16 columns (a tab is four), or
    // a run of over 2,000 characters without a space (a dotted word or dashes cost most).
    if (text.length > 12_000 && (deepIndent.test(line) || line.split(/\s/).some((word) => word.length > 2_000)))
      return true;
    let rest = line;
    let depth = 0;
    for (let match = containerMarker.exec(rest); match && match[0]; match = containerMarker.exec(rest)) {
      if (++depth > markdownLimits.depth) return true;
      rest = rest.slice(match[0].length);
    }
    if (depth) inContainer = true;
    else if (inContainer && !/^[ \t]{2}/.test(line) && ++lazy > markdownLimits.lazyLines) return true;
    // Each split adds one piece more than the openers it splits at.
    delimiters += rest.split(delimiter).length + 5 * rest.split(htmlOpener).length - 6;
    if (delimiters > markdownLimits.delimiters) return true;
  }
  return false;
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
  // Closed HTML comments: each "<!--" up to the first "-->" after it, as spaces with the line breaks kept.
  for (let start = markdown.indexOf("<!--"); start >= 0; ) {
    const end = markdown.indexOf("-->", start + 4) + 3;
    if (end < 3) break;
    for (let index = start; index < end; index++) if (chars[index] !== "\n") chars[index] = " ";
    start = markdown.indexOf("<!--", end);
  }
  const original = markdown.split("\n");
  let fence: string | undefined;
  return chars
    .join("")
    .split("\n")
    .map((line, index) => {
      const open = fence;
      fence = fenceAfter(fence, original[index]);
      if (open || fence) return "";
      // Code spans blanked: a backtick run up to the next run of the same length, as far as the next
      // backtick allows (linear: a span never scans past a backtick), roughly as GFM reads them.
      const prose = line.replace(/(`+)[^`]*?\1/g, (span) => " ".repeat(span.length));
      return prose.trim() ? prose : "";
    });
}
