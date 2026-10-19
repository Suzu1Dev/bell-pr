import {
  memo,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Code2,
  FileCode2,
  FileText,
  FoldVertical,
  MessageSquare,
  MousePointer2,
  UnfoldVertical,
  X,
} from "lucide-react";
import { useRovingList } from "../a11y/useRovingList";
import { useT } from "../i18n";
import type { DiffFile } from "../types";
import {
  expandDiff,
  groupHunks,
  hunkStart,
  isCodeLine,
  languageBadges,
  parseDiff,
  revealLines,
  selectionQuestion,
  splitDiff,
  type DiffLine,
  type Reveal,
} from "./diff";
import { scrollBehavior } from "../app/presentation";
import { withNodes } from "./withNodes";
import "./review.css";

/** How far PageUp and PageDown move in the list of lines. */
const linesPerPage = 10;
/** Lines one click on an expand arrow shows. */
const expandStep = 20;

export interface DiffViewProps {
  file: DiffFile;
  reviewed: boolean;
  onReview: () => void;
  onAsk: (question: string) => void;
  view: "unified" | "split";
  /** When given and false, a soft hint invites a learner note; it never blocks the checkbox. */
  hasNote?: boolean;
  /** Reads the base version of a modified file, so the code around its changes can be shown. */
  onLoadBase?: () => Promise<string[]>;
  /** Lines of the current file to mark, such as a walkthrough step; shown and scrolled to. */
  highlight?: { startLine: number; endLine: number };
}

// Memoized: every arrow key in the list re-renders the diff, and a line's
// tokens only change with its text.
const Syntax = memo(function Syntax({ code }: { code: string }) {
  const tokens = code.split(
    /(\/\/.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:import|from|export|async|await|function|return|const|let|for|try|catch|throw|if|new|type|interface|class|extends|public|readonly|true|false|void|number|string|unknown)\b|\b\d[\d_]*\b)/g,
  );
  return (
    <>
      {tokens.map((token, index) => {
        const kind = token.startsWith("//")
          ? "comment"
          : /^['"`]/.test(token)
            ? "string"
            : /^\d/.test(token)
              ? "number"
              : /^(?:import|from|export|async|await|function|return|const|let|for|try|catch|throw|if|new|type|interface|class|extends|public|readonly|true|false|void|number|string|unknown)$/.test(
                    token,
                  )
                ? "keyword"
                : "";
        return kind ? (
          <span className={`rv-token-${kind}`} key={index}>
            {token}
          </span>
        ) : (
          token
        );
      })}
    </>
  );
});

export function DiffView({
  file,
  reviewed,
  onReview,
  onAsk,
  view,
  hasNote,
  onLoadBase,
  highlight,
}: DiffViewProps) {
  const t = useT("review");
  const parsed = useMemo(
    () => (file.blocked ? [] : parseDiff(file.patch)),
    [file.patch, file.blocked],
  );
  // Added and deleted files are whole in the patch; only a modified one has
  // code around it, and only with a hunk to place it (not a mode change)
  // and as a regular file (a submodule, mode 160000, is a commit).
  const readable =
    !!onLoadBase &&
    file.status === "modified" &&
    !file.blocked &&
    parsed.some((line) => line.kind === "hunk") &&
    !/^index [0-9a-f]+\.\.[0-9a-f]+ 160000$/m.test(file.patch);
  const [base, setBase] = useState<string[] | null>(null);
  const [reveal, setReveal] = useState<Reveal>({});
  const [whole, setWhole] = useState(false);
  const [baseLoading, setBaseLoading] = useState(false);
  const [baseError, setBaseError] = useState("");
  const version = `${file.path}\0${file.patch}`;
  const currentVersion = useRef(version);
  currentVersion.current = version;
  const pendingBase = useRef<Promise<string[] | null> | null>(null);
  const lines = useMemo(
    () => expandDiff(parsed, base, whole ? "all" : reveal, readable),
    [parsed, base, whole, reveal, readable],
  );
  const hunks = useMemo(() => groupHunks(lines), [lines]);
  const splitHunks = useMemo(
    () => hunks.map((hunk) => ({ header: hunk.header, rows: splitDiff(hunk.lines) })),
    [hunks],
  );
  // The keyboard moves through the code lines in diff order, in both views.
  const codeLines = useMemo(() => lines.filter(isCodeLine), [lines]);
  const positions = useMemo(
    () => new Map(codeLines.map((line, index) => [line.id, index])),
    [codeLines],
  );
  const [selection, setSelection] = useState<{
    start: number;
    end: number;
  } | null>(null);
  // The list of lines is one tab stop; the arrow keys move inside it.
  const roving = useRovingList(codeLines.length, { pageSize: linesPerPage });
  const askButton = useRef<HTMLButtonElement>(null);
  const focusAskButton = useRef(false);
  const hintId = useId();

  useEffect(() => {
    setBase(null);
    setReveal({});
    setWhole(false);
    setBaseError("");
    setBaseLoading(false);
    pendingBase.current = null;
  }, [version]);
  // Shown lines are renumbered whenever more code appears.
  useEffect(() => setSelection(null), [file.blocked, lines]);

  /** The base version, read once per diff version; null when it cannot be read. */
  function readBase(): Promise<string[] | null> {
    if (base) return Promise.resolve(base);
    if (!onLoadBase || !readable) return Promise.resolve(null);
    if (!pendingBase.current) {
      const requested = version;
      setBaseLoading(true);
      setBaseError("");
      pendingBase.current = onLoadBase().then(
        (value) => {
          if (currentVersion.current !== requested) return null;
          setBase(value);
          setBaseLoading(false);
          return value;
        },
        (error: unknown) => {
          if (currentVersion.current !== requested) return null;
          pendingBase.current = null;
          setBaseLoading(false);
          setBaseError(
            error instanceof Error ? error.message : t.diff.gap.loadFailed,
          );
          return null;
        },
      );
    }
    return pendingBase.current;
  }

  const highlightStart = highlight?.startLine;
  const highlightEnd = highlight?.endLine;
  const scrollPending = useRef(false);
  const codeScroll = useRef<HTMLDivElement>(null);
  const highlighted = (line: DiffLine) =>
    highlightStart !== undefined &&
    highlightEnd !== undefined &&
    line.kind !== "removed" &&
    line.newLine !== null &&
    line.newLine >= highlightStart &&
    line.newLine <= highlightEnd;
  // A marked range outside the shown hunks opens just enough of the file.
  useEffect(() => {
    if (highlightStart === undefined || highlightEnd === undefined) return;
    scrollPending.current = true;
    const shown = new Set(lines.map((line) => line.newLine));
    let missing = false;
    for (let line = highlightStart; line <= highlightEnd && !missing; line++)
      missing = !shown.has(line);
    if (!missing || !readable) return;
    let active = true;
    void readBase().then((value) => {
      // A range chosen or cleared meanwhile must not open the old one.
      if (value && active)
        setReveal((current) =>
          revealLines(parsed, value, current, highlightStart, highlightEnd),
        );
    });
    return () => {
      active = false;
    };
    // Only a new range (or a new diff) opens lines; growing them does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightStart, highlightEnd, version]);
  useEffect(() => {
    if (!scrollPending.current) return;
    const first = codeScroll.current?.querySelector(".rv-line-highlighted");
    if (!first) return;
    scrollPending.current = false;
    first.scrollIntoView?.({ block: "center", behavior: scrollBehavior() });
  }, [lines, highlightStart, highlightEnd]);

  async function expand(index: number, side: "below" | "above" | "all") {
    if (!(await readBase())) return;
    setReveal((current) => {
      const shown = current[index] ?? { below: 0, above: 0 };
      return {
        ...current,
        [index]:
          side === "all"
            ? { below: Infinity, above: 0 }
            : { ...shown, [side]: shown[side] + expandStep },
      };
    });
  }

  async function toggleWhole() {
    if (whole) setWhole(false);
    else if (await readBase()) setWhole(true);
  }

  useEffect(() => {
    // Enter on an unselected line selects it first; the ask button that
    // the selection brings takes focus once it is rendered.
    if (focusAskButton.current && askButton.current) {
      focusAskButton.current = false;
      askButton.current.focus();
    }
  });

  const selectedLines = selection
    ? codeLines.filter(
        (line) =>
          line.id >= Math.min(selection.start, selection.end) &&
          line.id <= Math.max(selection.start, selection.end),
      )
    : [];
  const selectedIds = new Set(selectedLines.map((line) => line.id));
  const paths = file.path.split("/");
  const name = paths.pop();
  // The header has room for the full name when no short badge is defined.
  const languageLabel = languageBadges[file.language] ?? file.language;

  function select(line: DiffLine, extend: boolean) {
    setSelection((current) =>
      extend && current
        ? { start: current.start, end: line.id }
        : { start: line.id, end: line.id },
    );
  }

  function askAboutSelection() {
    if (file.blocked || selectedLines.length === 0) return;
    onAsk(selectionQuestion(file.path, selectedLines, t.selection));
  }

  function clearSelection() {
    setSelection(null);
    // The clear button goes away with the selection; focus returns to the code.
    roving.focusItem(roving.activeIndex);
  }

  function onLinesKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = codeLines[roving.activeIndex];
    // The buttons of a gap row take their own keys.
    if ((event.target as HTMLElement).closest?.("button")) return;
    if (
      !current ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.nativeEvent.isComposing
    )
      return;
    if (event.key === "Enter") {
      event.preventDefault();
      if (selectedIds.has(current.id)) askButton.current?.focus();
      else {
        setSelection({ start: current.id, end: current.id });
        focusAskButton.current = true;
      }
    } else if (event.key === " ") {
      event.preventDefault();
      select(current, event.shiftKey);
    } else if (event.key === "Escape") {
      // Without a selection, Escape is left to the page (it ends focus mode).
      if (!selection) return;
      event.preventDefault();
      setSelection(null);
    } else {
      const next = roving.handleKeyDown(event);
      if (next !== undefined && event.shiftKey) {
        const target = codeLines[next];
        setSelection((previous) => ({
          start: previous?.start ?? current.id,
          end: target.id,
        }));
      }
    }
  }

  function hunkLabel(header: DiffLine | undefined) {
    if (!header) return undefined;
    // The gap after the last change heads no hunk of its own.
    if (header.kind === "gap" && !header.text) return t.diff.gap.endLabel;
    const start = hunkStart(header.text);
    if (!start) return header.text;
    return start.context ? t.diff.hunkLabelIn(start) : t.diff.hunkLabel(start);
  }

  function renderNote(line: DiffLine, split: boolean) {
    return (
      <div
        key={line.id}
        className={`rv-hunk${split ? " rv-split-hunk" : ""}`}
      >
        <span aria-hidden="true">⋯</span>
        <code>{line.text}</code>
      </div>
    );
  }

  /** Unchanged lines the patch leaves out, with the controls that show them. */
  function renderGap(line: DiffLine, split: boolean) {
    const gap = line.gap!;
    const count =
      gap.hidden === null ? expandStep : Math.min(expandStep, gap.hidden);
    const below = t.diff.gap.showBelow({ count });
    const above = t.diff.gap.showAbove({ count });
    const all =
      gap.hidden === null
        ? t.diff.gap.showToEnd
        : t.diff.gap.showAll({ count: gap.hidden });
    return (
      <div className={`rv-hunk${split ? " rv-split-hunk" : ""} rv-gap`} role="none">
        <span className="rv-gap-actions">
          {gap.afterChange && (
            <button
              type="button"
              onClick={() => void expand(gap.index, "below")}
              disabled={baseLoading}
              aria-label={below}
              title={below}
            >
              <ChevronDown size={13} aria-hidden="true" />
            </button>
          )}
          {gap.beforeChange && (
            <button
              type="button"
              onClick={() => void expand(gap.index, "above")}
              disabled={baseLoading}
              aria-label={above}
              title={above}
            >
              <ChevronUp size={13} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            onClick={() => void expand(gap.index, "all")}
            disabled={baseLoading}
            aria-label={all}
            title={all}
          >
            <UnfoldVertical size={13} aria-hidden="true" />
          </button>
        </span>
        <code aria-hidden="true">
          {gap.hidden === null
            ? t.diff.gap.toEnd
            : t.diff.gap.hidden({ count: gap.hidden })}
          {line.text && <span className="rv-gap-header">{line.text}</span>}
        </code>
      </div>
    );
  }

  function renderHeader(header: DiffLine | undefined, split: boolean) {
    // The group's name says where the hunk starts, so the raw header is not read out.
    if (!header) return null;
    if (header.kind === "gap") return renderGap(header, split);
    return (
      <div
        className={`rv-hunk${split ? " rv-split-hunk" : ""}`}
        aria-hidden="true"
      >
        <span>⋯</span>
        <code>{header.text}</code>
      </div>
    );
  }

  function renderLine(line: DiffLine | undefined, side?: "old" | "new") {
    if (!line)
      return (
        <div className="rv-line rv-line-empty" aria-hidden="true">
          <span className="rv-gutter" />
          <span className="rv-sign" />
          <code>&nbsp;</code>
        </div>
      );
    const isSelected = selectedIds.has(line.id);
    const position = positions.get(line.id) ?? 0;
    const sign =
      line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " ";
    const kind =
      line.kind === "added" || line.kind === "removed" ? line.kind : "context";
    const className = `rv-line rv-line-${line.kind}${line.expanded ? " rv-line-expanded" : ""}${highlighted(line) ? " rv-line-highlighted" : ""}${isSelected ? " rv-line-selected" : ""}`;
    const content = (
      <>
        {side ? (
          <span className="rv-gutter">
            {side === "old" ? line.oldLine : line.newLine}
          </span>
        ) : (
          <>
            <span className="rv-gutter rv-gutter-old">{line.oldLine}</span>
            <span className="rv-gutter">{line.newLine}</span>
          </>
        )}
        <span className="rv-sign" aria-hidden="true">
          {sign}
        </span>
        <code>
          <Syntax code={line.text} />
          {line.text === "" ? "\u00a0" : ""}
        </code>
      </>
    );
    const onClick = (event: MouseEvent) => {
      select(line, event.shiftKey);
      // The old side's copy of an unchanged line cannot take focus itself:
      // its entry in the list does, so the keys go on from the clicked line.
      roving.focusItem(position, { preventScroll: true });
    };
    // Split view shows an unchanged line on both sides. Its new side is the
    // line's entry in the list; the old side is a copy for the mouse only.
    if (side === "old" && line.kind === "context")
      return (
        <div
          key={`${side}-${line.id}`}
          className={className}
          aria-hidden="true"
          onClick={onClick}
          title={t.diff.lineTitle}
        >
          {content}
        </div>
      );
    const { ref, tabIndex, onFocus } = roving.itemProps(position);
    return (
      <div
        key={`${side ?? "unified"}-${line.id}`}
        ref={ref}
        className={className}
        role="option"
        tabIndex={tabIndex}
        aria-selected={isSelected}
        aria-label={t.diff.lineLabel[kind]({
          line: side === "old" ? line.oldLine : (line.newLine ?? line.oldLine),
          text: line.text || t.diff.blankLine,
        })}
        onFocus={onFocus}
        onClick={onClick}
        title={t.diff.lineTitle}
      >
        {content}
      </div>
    );
  }

  const listProps = {
    role: "listbox",
    "aria-multiselectable": true,
    "aria-label": t.diff.listLabel,
    "aria-describedby": hintId,
    onKeyDown: onLinesKeyDown,
  } as const;

  return (
    <section
      className={`rv-diff ${view === "split" ? "rv-diff-split" : ""}`}
      aria-label={t.diff.regionLabel({ path: file.path })}
    >
      <div className="rv-file-header">
        <div className="rv-file-path">
          {file.language === "Markdown" ? (
            <FileText size={16} />
          ) : (
            <FileCode2 size={16} />
          )}
          <span className="rv-breadcrumb">
            {paths.map((part, index) => (
              <span key={`${part}-${index}`}>
                {part}
                <ChevronRight size={12} />
              </span>
            ))}
          </span>
          <strong>{name}</strong>
          <span className="rv-file-language">{languageLabel}</span>
        </div>
        <div className="rv-file-actions">
          {readable && (
            <button
              type="button"
              className={`rv-whole${whole ? " rv-whole-on" : ""}`}
              aria-pressed={whole}
              onClick={() => void toggleWhole()}
              disabled={baseLoading}
              title={t.diff.gap.wholeFileTitle}
            >
              {whole ? (
                <FoldVertical size={13} aria-hidden="true" />
              ) : (
                <UnfoldVertical size={13} aria-hidden="true" />
              )}
              {t.diff.gap.wholeFile}
            </button>
          )}
          <span className="rv-additions">+{file.additions}</span>
          <span className="rv-deletions">−{file.deletions}</span>
          {hasNote === false && !reviewed && !file.blocked && (
            <span className="rv-note-hint">{t.diff.noteHint}</span>
          )}
          <label className={`rv-reviewed ${reviewed ? "rv-reviewed-yes" : ""}`}>
            <input
              type="checkbox"
              checked={reviewed}
              onChange={onReview}
              disabled={Boolean(file.blocked)}
            />
            <span className="rv-review-check" aria-hidden="true">
              {reviewed && <Check size={11} strokeWidth={3} />}
            </span>
            {t.diff.reviewed}
          </label>
        </div>
      </div>
      {baseError && (
        <p className="rv-context-error" role="alert">
          {baseError}
        </p>
      )}
      {file.blocked || codeLines.length === 0 ? (
        <div className="rv-empty">
          <Code2 size={28} />
          <h3>
            {file.blocked ? t.diff.blockedTitle : t.diff.noTextTitle}
          </h3>
          <p>{file.blocked || t.diff.noTextBody}</p>
        </div>
      ) : (
        <div className="rv-code-scroll" ref={codeScroll}>
          {view === "split" ? (
            <div className="rv-split-content">
              <div className="rv-split-labels">
                <span>{t.diff.before}</span>
                <span>{t.diff.after}</span>
              </div>
              <div {...listProps}>
                {splitHunks.map((hunk, hunkIndex) => (
                  <div
                    role="group"
                    aria-label={hunkLabel(hunk.header)}
                    key={hunk.header?.id ?? `start-${hunkIndex}`}
                  >
                    {renderHeader(hunk.header, true)}
                    {hunk.rows.map((row, index) =>
                      row.hunk ? (
                        renderNote(row.hunk, true)
                      ) : (
                        <div className="rv-split-row" key={index}>
                          {renderLine(row.left, "old")}
                          {renderLine(row.right, "new")}
                        </div>
                      ),
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rv-unified-content" {...listProps}>
              {hunks.map((hunk, hunkIndex) => (
                <div
                  role="group"
                  aria-label={hunkLabel(hunk.header)}
                  key={hunk.header?.id ?? `start-${hunkIndex}`}
                >
                  {renderHeader(hunk.header, false)}
                  {hunk.lines.map((line) =>
                    line.kind === "note"
                      ? renderNote(line, false)
                      : renderLine(line),
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {!file.blocked && codeLines.length > 0 && (
        <>
          <p className="rv-visually-hidden" id={hintId}>
            {t.diff.keyboardHint({ button: t.diff.askSelection })}
          </p>
          <span className="rv-visually-hidden" role="status">
            {selectedLines.length
              ? t.diff.selectedLines({ count: selectedLines.length })
              : ""}
          </span>
        </>
      )}
      <div
        className={`rv-diff-footer ${selectedLines.length ? "rv-diff-footer-active" : ""}`}
      >
        <span>
          {selectedLines.length ? (
            <>
              <span className="rv-selection-dot" />
              {t.diff.selectedLines({ count: selectedLines.length })}
            </>
          ) : (
            <>
              <MousePointer2 size={13} /> {t.diff.idleHint}
              <span className="rv-shift-hint">
                {withNodes(t.diff.shiftHint, {
                  key: <kbd>{t.diff.shiftKey}</kbd>,
                })}
              </span>
            </>
          )}
        </span>
        {selectedLines.length > 0 && (
          <div className="rv-selection-actions">
            <button
              type="button"
              className="rv-clear"
              aria-label={t.diff.clearSelection}
              onClick={clearSelection}
            >
              <X size={14} />
            </button>
            <button
              type="button"
              className="rv-ask"
              ref={askButton}
              onClick={askAboutSelection}
            >
              <MessageSquare size={13} />
              {t.diff.askSelection}
              <ChevronRight size={13} />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
