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
 *
 * markdownTooSlow also flags text the parser would take too long on for
 * other reasons, whose work the same pass estimates (`Work`): it walks back
 * over the paragraph read so far for each closer that finds no opener
 * ("a* a* …", "] ] …", "](b) ](b) …") and for each word after a bracket left
 * open; it reads unclosed HTML ("<?", "<!--", "<!x", "<![CDATA[") on to the
 * paragraph's end once for each opener; its autolink finders read runs of
 * dots, dashes or URL punctuation from every start in them; it splices a
 * paragraph's events for each run of text tokens it merges, each emphasis
 * pair and each stray bracket; and each list, quote or footnote definition
 * that closes copies the whole document's events. The estimate errs high: a
 * paragraph starts again only where the parser's surely does (a blank line,
 * a heading, a bullet item, a table's row or cell), a walk stops early only
 * at an opener the parser surely reads as one, and only a fence at the
 * margin, which the parser surely reads as code, costs nothing.
 */
export const markdownNestingLimit = 32;

/**
 * Estimated parser time past which markdownTooSlow flags text, in
 * nanoseconds: with the time any text within the input caps takes anyway,
 * parsing stays within about a second.
 */
const workBudget = 400_000_000;
/**
 * Nanoseconds the parser takes per unit of each kind of work: the most
 * measured at 60,000 characters of the densest text for each, in a fresh
 * Node process. A long-running process with a fuller heap can take more.
 */
const nanoseconds = {
  /** Per event a closer or a closing bracket walks back over. */
  walk: 4,
  /** Per event a word after an open bracket walks back to it. */
  bracket: 3,
  /** Per character an unclosed HTML opener reads on. */
  html: 16,
  /** Per character the email finder reads from each start. */
  email: 2.5,
  /** Per character the URL finder reads from each start. */
  url: 1.5,
  /** Per character of a run of URL punctuation read again from each character in it. */
  trail: 14,
  /** Per event after it that adjacent text tokens merging into one moves. */
  merge: 2.6,
  /** Per event after it that an emphasis or strikethrough pair moves. */
  pair: 1.7,
  /** Per event after it that the marker of a bracket that closes no link moves. */
  splice: 0.5,
  /** Per document event each closed list, quote or footnote definition copies. */
  container: 3.5,
};

/** How much more nesting text read as code may hold. */
const codeFactor = 4;
/** How far down the open runs a closer looks for one the parser would pair it with. */
const pairingReach = 64;
/** "---", "* * *", "___": a line of three or more of one of these, spaces allowed. */
const thematicBreak = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
/**
 * A quote marker, a footnote definition's label ("[^1]:", up to 999
 * characters and none of them "[" or white space, as GFM takes it), or a
 * list marker followed by a space, a tab or the line's end, at any
 * indentation.
 */
const containerMarker = /[ \t]*(?:>|\[\^(?:\\[[\\\]]|[^\\[\]\s]){1,999}\]:|(?:[-*+]|\d{1,9}[.)])(?=[ \t]|$))[ \t]?/y;
/** A fence's opening or closing line, after any quote or list markers. */
const fenceLine = /^[ \t]*(`{3,}|~{3,})(.*)$/;
/** A line that closes a fence at the margin for the parser. */
const fenceClose = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
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
/** Where the autolink finders take a URL to start. */
const urlStart = /www\.|https?:\/\//gi;
/** Characters the autolink reader may take for punctuation trailing a URL, and reads on past to see. */
const urlTrail = /[!"&'),.:;<>?\]_}~*]/;
/** "<" and a letter or "/" may open an HTML tag. */
const tagStart = /^[A-Za-z/]$/;
/**
 * An HTML tag still open at the end of the text, which may close on a later
 * line. A value in quotes is read up to the next "<" and a letter, where
 * another such tag would start, so that reading stays linear.
 */
const unclosedTag =
  /<(?:[A-Za-z][A-Za-z0-9-]*(?:[ \t]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[ \t]*=[ \t]*(?:[^\s"'=<>`]+|'[^'\n<]*'|"[^"\n<]*"))?)*(?:[ \t]+[A-Za-z_:][A-Za-z0-9_.:-]*[ \t]*(?:=[ \t]*(?:'(?:[^'<]|<(?![A-Za-z/]))*|"(?:[^"<]|<(?![A-Za-z/]))*)?)?)?|\/[A-Za-z][A-Za-z0-9-]*)[ \t]*$/y;

/** A table's delimiter row: "| --- | :-: |", outer pipes optional. */
const delimiterRow = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

type Html = "comment" | "instruction" | "declaration" | "cdata";

/** An opener or an opening bracket, and whether a walk back surely stops at it. */
interface Spot {
  /** The parser's events before it. */
  position: number;
  /** The code (or the paragraph's text, 0) it was read in. */
  region: number;
  /** Read where nothing this reading cannot follow (code spans across lines, HTML, URLs) may hide it from the parser. */
  trusted: boolean;
}

/** Where the parser does none of this work: no walk stops there. */
const unseen: Spot = { position: 0, region: -1, trusted: false };

/**
 * The parser's work that grows with the square of what repeats, as estimated
 * nanoseconds (`time`). Walks are measured in the parser's events (each
 * token's start and end), which `token` estimates as the text is read; HTML
 * and the autolink finders read characters. A paragraph here starts again
 * only where the parser's surely does, so its walks go no further back than
 * this one's.
 */
class Work {
  time = 0;

  /** Whether to estimate at all: not for a caller that asks about nesting only. */
  constructor(readonly on: boolean) {
    this.quiet = !on;
  }

  /** Events of the text read so far, and where the paragraph being read starts. */
  private events = 0;
  private start = 0;
  /** Code being read, outermost first, each with the last opening bracket in it a walk surely stops at. */
  private regions = [{ id: 0, anchor: -1 }];
  private nextRegion = 1;
  /**
   * Opening brackets that may still be open, oldest first; and those of
   * them surely still open to the parser: trusted, and with no closing
   * bracket since that may have closed them without this reading knowing.
   */
  private open: Spot[] = [];
  private surelyOpen: Spot[] = [];
  /**
   * Backtick runs that may open a code span the parser closes on a later
   * line: as the parser pairs them, a run closes the earliest open one of
   * its length, and whatever opened after that one was inside the span.
   */
  private ticks: number[] = [];
  /** Whether an HTML tag may run on from a line before. */
  private tag = false;
  /** Whether the text being read is surely code to the parser, which then does none of this work. */
  private quiet: boolean;
  /** Whether the line being read is surely a table row, whose cells the parser reads as text of their own. */
  table = false;
  /**
   * Splices of the paragraph's events, each of which moves the events after
   * it: where adjacent text tokens merge into one, where an emphasis or
   * strikethrough pair forms, and where a bracket's marker goes. Their
   * weights, and their weights times their positions, added up.
   */
  private splices = 0;
  private spliced = 0;
  /**
   * Text tokens that may still merge. The parser merges each run of
   * adjacent text tokens before anything else, with a splice where the run
   * ends. Counting a merge wherever a run may end once two tokens have
   * gathered since the last counted, as early as possible, counts at least
   * as many as the parser makes, and no later.
   */
  private text = 0;
  /** Unclosed HTML openers of each kind: how many, and their offsets in the text added up. */
  private html: Record<Html, { count: number; sum: number }> = {
    comment: { count: 0, sum: 0 },
    instruction: { count: 0, sum: 0 },
    declaration: { count: 0, sum: 0 },
    cdata: { count: 0, sum: 0 },
  };
  /** Where URLs run in the line being read, as start and end offsets, and the next to look at. */
  private urls: number[] = [];
  private url = 0;
  /** Lists, quotes and footnote definitions opened, and the document's own events so far. */
  private containers = 0;
  private structure = 0;

  /** `count` tokens of the parser start here, which may be text. */
  token(count = 1) {
    if (this.quiet) return;
    this.events += 2 * count;
    this.text += count;
  }

  /** A token that may not be text starts here, `surely` or not, ending a run of text tokens. */
  split(surely: boolean) {
    if (this.quiet) return;
    this.events += 2;
    if (this.text > 1) {
      this.splice(1, nanoseconds.merge);
      this.text = 0;
    } else if (surely) this.text = 0;
    else this.text++;
  }

  /** Reads what follows as surely code (`quiet`), or not. */
  mute(quiet: boolean) {
    this.quiet = quiet || !this.on;
  }

  /** Ends the paragraph at offset `position`, and starts the next. */
  paragraph(position: number) {
    for (const kind of Object.keys(this.html) as Html[]) this.closeHtml(kind, position);
    this.time += this.splices * this.events - this.spliced;
    this.start = this.events;
    this.splices = 0;
    this.spliced = 0;
    this.text = 0;
    this.open = [];
    this.surelyOpen = [];
    this.ticks = [];
    this.tag = false;
    for (const region of this.regions) region.anchor = -1;
  }

  /** Ends the text at offset `position`, and returns the estimate. */
  end(position: number) {
    this.paragraph(position);
    return this.time + nanoseconds.container * this.containers * this.structure;
  }

  /** A line of document structure: lists, quotes and footnote definitions it opens, and the events it adds. */
  container(opened: number, events: number) {
    this.containers += opened;
    this.structure += events;
  }

  /**
   * Whether code spans or HTML that this reading does not follow (across
   * lines) may hide what is read here from the parser: openers here do not
   * stop a walk, nor do closing brackets here close one.
   */
  private get doubt() {
    if (this.ticks.length || this.tag) return true;
    for (const open of Object.values(this.html)) if (open.count) return true;
    return false;
  }

  /** An HTML tag at the end of the line may run on to the next. */
  openTag() {
    if (!this.quiet) this.tag = true;
  }

  /** A backtick run of `size`. */
  backticks(size: number) {
    if (this.quiet) return;
    const open = this.ticks.indexOf(size);
    if (open >= 0) this.ticks.length = open;
    else this.ticks.push(size);
  }

  enter() {
    this.regions.push({ id: this.nextRegion++, anchor: -1 });
  }

  leave() {
    this.regions.pop();
  }

  /** An opener or opening bracket at offset `position`. */
  spot(position: number): Spot {
    if (this.quiet) return unseen;
    return { position: this.events, region: this.regions[this.regions.length - 1].id, trusted: !this.doubt && !this.inUrl(position) };
  }

  /** A closer walks back to `from`, the opener it pairs with, or else to the paragraph's start. */
  walk(from?: Spot) {
    if (this.quiet) return;
    const stop =
      from && from.trusted && from.position >= this.start && this.regions.some((region) => region.id === from.region)
        ? from.position
        : this.start;
    this.time += nanoseconds.walk * (this.events - stop);
  }

  /** `count` splices of the kind that costs `weight` per event they move. */
  splice(count = 1, weight = nanoseconds.splice) {
    if (this.quiet) return;
    this.splices += count * weight;
    this.spliced += count * weight * this.events;
  }

  openBracket(position: number) {
    if (this.quiet) return;
    const spot = this.spot(position);
    if (spot.trusted) {
      this.regions[this.regions.length - 1].anchor = spot.position;
      this.surelyOpen.push(spot);
    }
    this.open.push(spot);
  }

  /**
   * A closing bracket at offset `position` that closes no link walks back to
   * the nearest opening one; it may close the last open bracket only where
   * the parser surely reads both.
   */
  closeBracket(position: number) {
    if (this.quiet) return;
    let stop = this.start;
    for (const region of this.regions) stop = Math.max(stop, region.anchor);
    this.time += nanoseconds.walk * (this.events - stop);
    const last = this.open[this.open.length - 1];
    if (last && !this.doubt && !this.inUrl(position) && last.region === this.regions[this.regions.length - 1].id) {
      this.open.pop();
      // The parser closes the last bracket open to it, which is this one only if this one surely is.
      if (this.surelyOpen[this.surelyOpen.length - 1] === last) this.surelyOpen.pop();
      else this.surelyOpen = [];
    } else this.surelyOpen = [];
  }

  /**
   * `count` autolink starts here each walk back to the last bracket open to
   * the parser: at most to the last surely open, or else to the oldest that
   * may be.
   */
  autolink(count: number) {
    if (!count || !this.open.length || this.quiet) return;
    const stop = this.surelyOpen.length ? this.surelyOpen[this.surelyOpen.length - 1] : this.open[0];
    this.time += nanoseconds.bracket * count * (this.events - stop.position);
  }

  openHtml(kind: Html, position: number) {
    if (this.quiet) return;
    this.html[kind].count++;
    this.html[kind].sum += position;
  }

  /** Each unclosed opener of `kind` reads on to offset `position`. */
  closeHtml(kind: Html, position: number) {
    const open = this.html[kind];
    this.time += nanoseconds.html * (open.count * position - open.sum);
    open.count = 0;
    open.sum = 0;
  }

  /**
   * Reads a line at offset `position` as the autolink finders do, which take
   * no notice of code, and notes where URLs run in it. The email finder
   * reads each run of "-", ".", "_", "+", ASCII letters and digits from every
   * start in it: the run's first character and each after "-", ".", "_" or
   * "+". The URL finder reads from each "www." or "http://" to the next
   * space, and the autolink reader reads each run of URL punctuation in it
   * again from each character.
   */
  line(text: string, position: number) {
    this.urls = [];
    this.url = 0;
    if (this.quiet) return;
    // A line ending.
    this.split(true);
    let starts = 0;
    for (let index = 0; index < text.length; index++)
      if (isEmailText(text.charCodeAt(index))) {
        if (!starts || isEmailBreak(text.charCodeAt(index - 1))) starts++;
        this.time += nanoseconds.email * starts;
      } else starts = 0;
    let end = 0;
    for (const match of text.matchAll(urlStart)) {
      if (match.index >= end) {
        end = match.index;
        let run = 0;
        let entity = false;
        for (; end < text.length && text[end] !== " " && text[end] !== "\t"; end++) {
          // "&amp;" counts as punctuation too.
          if (urlTrail.test(text[end]) || (entity && /[A-Za-z]/.test(text[end]))) {
            run++;
            this.time += nanoseconds.trail * run;
            entity = text[end] === "&" || (entity && text[end] !== ";");
          } else {
            run = 0;
            entity = false;
          }
        }
        this.urls.push(position + match.index, position + end);
      }
      this.time += nanoseconds.url * (end - match.index);
    }
  }

  /** Whether offset `position`, at or after the last one asked about, is in a URL of the line. */
  private inUrl(position: number) {
    while (this.url < this.urls.length && this.urls[this.url + 1] <= position) this.url += 2;
    return this.url < this.urls.length && this.urls[this.url] <= position;
  }
}

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
  at: Spot;
}

/** Open delimiter runs and brackets of one block of inline text. */
class Nesting {
  readonly work: Work;

  constructor(estimate: boolean) {
    this.work = new Work(estimate);
  }

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
  delimiter(kind: string, length: number, canOpen: boolean, canClose: boolean, limit: number, at: Spot): boolean {
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
          // It walks back over the whole paragraph.
          this.work.walk();
          break;
        }
        // Runs between an opener and its closer become text inside the span.
        while (runs.length - 1 > match) depth = Math.max(depth, runs.pop()!.inner);
        const run = runs[match];
        this.work.walk(run.at);
        const used = Math.min(size, run.size);
        this.work.splice(Math.ceil(used / 2), nanoseconds.pair);
        // The parser pairs a run two characters at a time: "**" closing "**" is one level.
        depth = Math.max(depth, run.inner) + Math.ceil(used / 2);
        if (depth > limit) return true;
        size -= used;
        run.size -= used;
        if (run.size === 0) runs.pop();
      }
      this.nest(depth);
    }
    if (canOpen && size > 0) runs.push({ kind, size, length, canClose, inner: 0, at });
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
  return read(markdown, limit, Infinity);
}

/**
 * Whether the parser should not be asked to read `markdown`: it nests past
 * markdownNestingLimit, or its other work on it would take too long.
 */
export function markdownTooSlow(markdown: string): boolean {
  return read(markdown, markdownNestingLimit, workBudget);
}

/** Whether `markdown` nests deeper than `limit`, or Work estimates more than `budget` for it. */
function read(markdown: string, limit: number, budget: number): boolean {
  const codeLimit = limit * codeFactor;
  // One count for prose and code alike; code only raises the limit.
  const nesting = new Nesting(budget !== Infinity);
  const work = nesting.work;
  let fence: { char: string; size: number } | undefined;
  let inParagraph = false;
  // Footnote definitions that may still be open: four columns at the start of a line continue all of them.
  let footnotes = 0;
  // Columns before the line that opened them: four more than that continue them.
  let footnoteIndent = 0;
  // Whether the lines being read are code (a fence, or indented), which Work reads as one region.
  let inCode = false;
  const region = (code: boolean) => {
    if (code === inCode) return;
    if (code) work.enter();
    else work.leave();
    inCode = code;
  };
  // Quote markers at the start of the line before, which this line's continue;
  // and the first list marker of the last line that had one, whose list a
  // marker of the same kind in the same column continues.
  let quotes = 0;
  let list: { column: number; kind: string; content: number } | undefined;
  // What ends an HTML block that may be open, where a fence line is HTML
  // ("" for a blank line).
  let htmlBlock: RegExp | "" | undefined;
  // A fence the parser may still be in, as long as no line at the margin
  // closes it; and one it surely is in, whose lines it reads none of as
  // text, and whether the line before closed that.
  let maybeFence: { char: string; size: number } | undefined;
  let sureFence: { char: string; size: number } | undefined;
  let sureEnded = false;
  // The line before while it may be a table's header row: text with no
  // marker, after no line with one since the last blank line, which may
  // have made it a lazy line.
  let header: string | undefined;
  let markerLines = false;
  let start = 0;
  const reset = (position: number) => {
    nesting.reset();
    inParagraph = false;
    work.paragraph(position);
  };
  // A lone carriage return ends a line for the parser too.
  for (const line of markdown.split(/\r\n?|\n/)) {
    const at = start;
    start += line.length + 1;
    const headerBefore = header;
    header = undefined;
    if (sureEnded) {
      sureFence = undefined;
      sureEnded = false;
      work.mute(false);
      work.paragraph(at);
    }
    const closing = fenceClose.exec(line);
    const closes = (open?: { char: string; size: number }) => !!(open && closing && closing[1][0] === open.char && closing[1].length >= open.size);
    // A line that closes a fence opens none.
    const fenceBefore = maybeFence;
    if (closes(maybeFence)) maybeFence = undefined;
    sureEnded = closes(sureFence);
    work.line(line, at);
    if (work.time > budget) return true;
    if (blank.test(line) || (!fence && thematicBreak.test(line))) {
      reset(at);
      if (htmlBlock === "" && blank.test(line)) htmlBlock = undefined;
      if (blank.test(line)) markerLines = false;
      work.table = false;
      quotes = 0;
      if (!blank.test(line)) list = undefined;
      work.container(0, 4);
      continue;
    }
    // A heading with no marker before it is a block of one line: it
    // interrupts any paragraph and cannot be a lazy continuation.
    if (!fence && atxHeading.test(line)) {
      reset(at);
      work.table = false;
      region(false);
      if (inline(line, at, nesting, limit, codeLimit)) return true;
      reset(start);
      quotes = 0;
      list = undefined;
      work.container(0, 4);
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
    // For Work: each marker may open a list, quote or footnote definition, unless it continues one.
    let count = 0;
    let leadingQuotes = 0;
    let first: typeof list;
    // Whether the first list marker surely starts an item: it is a bullet or "1." and each marker up to it is at most three spaces in.
    let startsItem = true;
    for (;;) {
      containerMarker.lastIndex = position;
      const match = containerMarker.exec(line);
      if (!match) break;
      // Five or more columns after a list marker start an indented code
      // block in its item (a comment box's " *      *"): nothing after nests.
      if (afterList && match[0].length - match[0].trimStart().length >= 4) break;
      const marker = match[0].trim();
      const space = match[0].slice(0, match[0].length - match[0].trimStart().length);
      if (markers === 0) for (const char of space) lead += char === "\t" ? 4 : 1;
      // A quote marker costs the parser about a quarter of a list marker:
      // pytest's "--pdb" separators (">>>…>>> traceback >>>…>>>") nest 34.
      markers += marker.startsWith(">") ? 1 / codeFactor : 1;
      for (const char of match[0].trimEnd()) indent += char === "\t" ? 4 : char === " " ? 1 : 0;
      const continued = Math.floor(indent / 2) + (indent >= footnoteIndent + 4 ? footnotes : 0);
      if (Math.ceil(markers) + continued > (fence ? codeLimit : limit)) return true;
      if (marker.startsWith("[")) opened++;
      afterList = !marker.startsWith(">") && !marker.startsWith("[");
      count++;
      if (!first) {
        if (space.length > 3 || space.includes("\t") || marker.startsWith("[")) startsItem = false;
        if (marker.startsWith(">") && count === leadingQuotes + 1) leadingQuotes++;
        if (afterList) {
          first = { column: position + space.length, kind: marker.slice(-1), content: containerMarker.lastIndex };
          if (!/^(?:[-*+]|1[.)])$/.test(marker)) startsItem = false;
        }
      }
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
    if (count) {
      markerLines = true;
      work.table = false;
    }
    // A table ends where another block starts; GFM reads each row and
    // each cell of one as inline text of its own. A table starts at a
    // delimiter row with as many cells as the header row above it.
    if (work.table && /^(?: {0,3}(?:[#<]|`{3}|~{3})| {4}|[ \t]*\t)/.test(line)) work.table = false;
    if (work.table) work.paragraph(at);
    else if (!fence && !count && headerBefore !== undefined && !markerLines && line.includes("|") && delimiterRow.test(line) && cells(line) === cells(headerBefore)) {
      work.table = true;
      work.paragraph(at);
    }
    if (htmlBlock) {
      if (htmlBlock.test(line)) htmlBlock = undefined;
    } else if (htmlBlock === undefined && rest.trimStart().startsWith("<")) {
      htmlBlock = htmlBlockEnd(rest.trimStart());
      if (htmlBlock && htmlBlock.test(rest.trimStart().slice(1))) htmlBlock = undefined;
    }
    // Leading quote markers continue the quotes of the line before, and an
    // item continues the list of the last item in its column; any other
    // marker opens a container.
    const sibling = first && list && first.column === list.column && first.kind === list.kind;
    // In fenced code the parser surely reads as such, markers are text.
    if (sureFence) work.container(0, 4);
    else work.container(count - Math.min(leadingQuotes, quotes) - (sibling ? 1 : 0), 4 + 6 * count);
    quotes = leadingQuotes;
    if (first) list = first;
    else if (list && position + rest.length - rest.trimStart().length < list.content) list = undefined;
    // An empty list item cannot interrupt a paragraph, nor can a marker
    // indented four columns or more: such a line ends nothing.
    if (blank.test(rest)) {
      if (!listMarker && lead <= 3) reset(at);
      continue;
    }
    // An item with text starts a new paragraph for the parser even where
    // nesting is still counted on, unless code or HTML takes the line.
    if (first && startsItem) work.paragraph(at);
    // Fence lines start nothing again: the parser may not see the fence at
    // all (indented past an item's content, or after "2.", which cannot
    // interrupt a paragraph).
    const fenceMatch = fenceLine.exec(rest);
    if (fence) {
      region(true);
      if (fenceMatch && fenceMatch[1][0] === fence.char && fenceMatch[1].length >= fence.size && blank.test(fenceMatch[2]))
        fence = undefined;
      else if (inline(rest, at + position, nesting, codeLimit, codeLimit)) return true;
      continue;
    }
    if (fenceMatch && !(fenceMatch[1][0] === "`" && fenceMatch[2].includes("`"))) {
      fence = { char: fenceMatch[1][0], size: fenceMatch[1].length };
      // A fence at the margin, with no marker, no HTML block and no fence
      // before it, surely opens one: it is in no list item, quote or
      // indented code.
      if (!fenceBefore && !sureFence && position === 0 && /^[`~]/.test(line) && htmlBlock === undefined) {
        sureFence = { ...fence };
        work.paragraph(at);
        work.mute(true);
      }
      maybeFence ??= { ...fence };
      region(true);
      // The parser may read this line as text too, info string and all.
      if (inline(fenceMatch[2], start - 1 - fenceMatch[2].length, nesting, codeLimit, codeLimit)) return true;
      continue;
    }
    // An indented line outside a paragraph may be code, or a list item's text: read it against the code limit.
    // So is a line whose first marker sits four columns in, such as a C comment's " * " in an indented block.
    const code = !inParagraph && (lead >= 4 || /^(?: {4}|\t)/.test(rest));
    if (!code) inParagraph = true;
    if (!code && !count) header = line;
    region(code);
    if (inline(rest, at + position, nesting, code ? codeLimit : limit, codeLimit)) return true;
  }
  return work.end(start) > budget;
}

/**
 * Reads one line of inline text into `nesting` against `limit`. What a code
 * span or an HTML tag encloses is read too, against `codeLimit`: the parser
 * may pair backticks otherwise (across lines). Text already read against
 * `codeLimit` reads straight through tags. True when either goes past its
 * limit. `base` is where the text starts, for Work, which reads what code
 * encloses as a region of its own.
 */
function inline(text: string, base: number, nesting: Nesting, limit: number, codeLimit: number): boolean {
  const work = nesting.work;
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
    const previous = index > 0 ? text[index - 1] : " ";
    if (work.on) {
      const starts = autolinkStarts(previous, char);
      work.autolink(starts);
      // Emphasis, a label start, an escape and a hard break ("\\" at the end of
      // a line) are surely not text; a closing bracket, a backtick, "<", "&",
      // "~" or "!" may not be.
      if (char === "*" || char === "_" || char === "[" || (char === "\\" && (index + 1 === text.length || isPunctuation(text.charCodeAt(index + 1))))) work.split(true);
      else if ("]`<&~!".includes(char)) work.split(false);
      else work.token(tokenStarts(previous, char, starts));
    }
    if (char === "\\") {
      // A backslash before ASCII punctuation escapes it (three tokens); before anything else it escapes nothing.
      const next = text[index + 1] ?? "";
      if (work.on && isPunctuation(next.charCodeAt(0))) {
        work.split(true);
        work.split(true);
      } else if (work.on && next) {
        const nextStarts = autolinkStarts(char, next);
        work.autolink(nextStarts);
        work.token(tokenStarts(char, next, nextStarts));
      }
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
      work.backticks(size);
      if (next < list.length) {
        work.enter();
        if (inline(text.slice(end, list[next]), base + end, nesting, codeLimit, codeLimit)) return true;
        work.leave();
        work.backticks(size);
        index = list[next] + size;
      } else index = end;
      continue;
    }
    if (char === "<" && (limit !== codeLimit || work.on)) {
      const html = work.on && htmlOpener(text, index);
      if (html) work.openHtml(html, base + index);
      angleSpan.lastIndex = index;
      const span = angleSpan.exec(text);
      if (span && limit !== codeLimit) {
        work.enter();
        if (inline(text.slice(index + 1, angleSpan.lastIndex - 1), base + index + 1, nesting, codeLimit, codeLimit)) return true;
        work.leave();
        index = angleSpan.lastIndex;
        continue;
      }
      // A tag this reading does not take for one may still be one, across lines.
      if (!span && work.on && tagStart.test(text[index + 1] ?? "")) {
        unclosedTag.lastIndex = index;
        if (unclosedTag.test(text)) work.openTag();
      }
    }
    if (char === "|" && work.table) work.paragraph(base + index);
    if (char === ">" && work.on) {
      const position = base + index;
      work.closeHtml("declaration", position);
      if (text[index - 1] === "?") work.closeHtml("instruction", position);
      if (index >= 2 && text.startsWith("--", index - 2)) work.closeHtml("comment", position);
      if (index >= 2 && text.startsWith("]]", index - 2)) work.closeHtml("cdata", position);
    }
    if (char === "[") {
      nesting.openBracket();
      // A label start is two tokens, and its marker may go.
      work.split(true);
      work.splice();
      work.openBracket(base + index);
      index++;
      continue;
    }
    if (char === "]") {
      if (nesting.closeBracket(limit)) return true;
      work.splice();
      work.closeBracket(base + index);
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
        if (start > index && work.on) {
          work.autolink(autolinkStarts(previous, kind));
          work.split(kind !== "~");
        }
        // GFM strikethrough takes runs of one or two tildes; longer ones are text.
        if (kind !== "~" || size <= 2) {
          // The parser lets "*" open before a "~" and close after one, as for any marker another construct uses.
          const canOpen = kind === "_" ? left && (!right || punctuation.test(previous)) : left || (kind === "*" && following === "~");
          const canClose = kind === "_" ? right && (!left || punctuation.test(following)) : right || (kind === "*" && previous === "~");
          if (nesting.delimiter(kind, size, canOpen, canClose, limit, work.spot(base + start))) return true;
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

/** ASCII punctuation, by character code. */
function isPunctuation(code: number) {
  return (code >= 33 && code <= 47) || (code >= 58 && code <= 64) || (code >= 91 && code <= 96) || (code >= 123 && code <= 126);
}

function isLetter(code: number) {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

/** A character of a run the email finder reads: "-", ".", "_", "+", an ASCII letter or digit. */
function isEmailText(code: number) {
  return isLetter(code) || (code >= 48 && code <= 57) || code === 45 || code === 46 || code === 95 || code === 43;
}

/** A character after which the email finder starts again: "-", ".", "_" or "+". */
function isEmailBreak(code: number) {
  return code === 45 || code === 46 || code === 95 || code === 43;
}

function isSpace(char: string) {
  return char === " " || char === "\t" || whitespace.test(char);
}

/**
 * How many autolink readers start at `char` after `previous`, each walking
 * back to a bracket left open: email at the start of a run of its
 * characters, "www." after white space or "(*_[]~", "http" after anything
 * but a letter.
 */
function autolinkStarts(previous: string, char: string) {
  const code = char.charCodeAt(0);
  const before = previous.charCodeAt(0);
  let starts = 0;
  if (isEmailText(code) && !isEmailText(before) && before !== 47) starts++;
  if ((code === 119 || code === 87) && (isSpace(previous) || "(*_[]~".includes(previous))) starts++;
  if ((code === 104 || code === 72) && !isLetter(before)) starts++;
  return starts;
}

/**
 * How many of the parser's tokens start at `char` after `previous`: one at
 * ASCII punctuation, where most constructs start, where an autolink reader
 * starts (`autolinks` of them do), and where other text follows punctuation
 * or white space.
 */
function tokenStarts(previous: string, char: string, autolinks: number) {
  if (autolinks || isPunctuation(char.charCodeAt(0))) return 1;
  const before = previous.charCodeAt(0);
  if (isSpace(char)) return isPunctuation(before) ? 1 : 0;
  return isPunctuation(before) || isSpace(previous) ? 1 : 0;
}

/** How many cells a table row has: pipes split them, but not escaped ones, nor one at either end. */
function cells(row: string) {
  let text = row.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
  return text.split(/(?<!\\)\|/).length;
}

/**
 * What ends the HTML block that `text`, starting with "<", may open:
 * CommonMark's script, pre, style and textarea, comments, processing
 * instructions, declarations and CDATA end at their closers; any other tag
 * ends it at a blank line ("").
 */
function htmlBlockEnd(text: string): RegExp | "" | undefined {
  if (/^<(?:script|pre|style|textarea)(?:[\s>]|$)/i.test(text)) return /<\/(?:script|pre|style|textarea)>/i;
  if (text.startsWith("<!--")) return /-->/;
  if (text.startsWith("<?")) return /\?>/;
  if (text.startsWith("<![CDATA[")) return /\]\]>/;
  if (/^<![A-Za-z]/.test(text)) return />/;
  if (/^<\/?[A-Za-z]/.test(text)) return "";
  return undefined;
}

/** The HTML that "<" at `index` opens and that reads on to its end: a comment, a processing instruction, CDATA or a declaration. */
function htmlOpener(text: string, index: number): Html | undefined {
  if (text.startsWith("<!--", index)) return "comment";
  if (text.startsWith("<?", index)) return "instruction";
  if (text.startsWith("<![CDATA[", index)) return "cdata";
  if (text[index + 1] === "!" && /[A-Za-z]/.test(text[index + 2] ?? "")) return "declaration";
  return undefined;
}
