import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronRight,
  Code2,
  FileCode2,
  FileText,
  MessageSquare,
  MousePointer2,
  X,
} from "lucide-react";
import { useT } from "../i18n";
import type { DiffFile } from "../types";
import {
  languageBadges,
  parseDiff,
  selectionQuestion,
  splitDiff,
  type DiffLine,
} from "./diff";
import { withNodes } from "./withNodes";
import "./review.css";

export interface DiffViewProps {
  file: DiffFile;
  reviewed: boolean;
  onReview: () => void;
  onAsk: (question: string) => void;
  view: "unified" | "split";
  /** When given and false, a soft hint invites a learner note; it never blocks the checkbox. */
  hasNote?: boolean;
}

function Syntax({ code }: { code: string }) {
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
}

export function DiffView({
  file,
  reviewed,
  onReview,
  onAsk,
  view,
  hasNote,
}: DiffViewProps) {
  const t = useT("review");
  const lines = useMemo(
    () => (file.blocked ? [] : parseDiff(file.patch)),
    [file.patch, file.blocked],
  );
  const splitRows = useMemo(() => splitDiff(lines), [lines]);
  const [selection, setSelection] = useState<{
    start: number;
    end: number;
  } | null>(null);

  useEffect(() => setSelection(null), [file.path, file.patch, file.blocked]);

  const selectedLines = selection
    ? lines.filter(
        (line) =>
          line.id >= Math.min(selection.start, selection.end) &&
          line.id <= Math.max(selection.start, selection.end) &&
          ["context", "added", "removed"].includes(line.kind),
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
    const sign =
      line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " ";
    const kind =
      line.kind === "added" || line.kind === "removed" ? line.kind : "context";
    return (
      <div
        key={`${side ?? "unified"}-${line.id}`}
        className={`rv-line rv-line-${line.kind}${isSelected ? " rv-line-selected" : ""}`}
        role="button"
        tabIndex={0}
        aria-pressed={isSelected}
        aria-label={t.diff.lineLabel[kind]({
          line: side === "old" ? line.oldLine : (line.newLine ?? line.oldLine),
          text: line.text || t.diff.blankLine,
        })}
        onClick={(event) => select(line, event.shiftKey)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            select(line, event.shiftKey);
          }
        }}
        title={t.diff.lineTitle}
      >
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
      </div>
    );
  }

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
      {file.blocked || lines.length === 0 ? (
        <div className="rv-empty">
          <Code2 size={28} />
          <h3>
            {file.blocked ? t.diff.blockedTitle : t.diff.noTextTitle}
          </h3>
          <p>{file.blocked || t.diff.noTextBody}</p>
        </div>
      ) : (
        <div className="rv-code-scroll">
          {view === "split" ? (
            <div className="rv-split-content">
              <div className="rv-split-labels">
                <span>{t.diff.before}</span>
                <span>{t.diff.after}</span>
              </div>
              {splitRows.map((row, index) =>
                row.hunk ? (
                  <div className="rv-hunk rv-split-hunk" key={index}>
                    <span>⋯</span>
                    <code>{row.hunk.text}</code>
                  </div>
                ) : (
                  <div className="rv-split-row" key={index}>
                    {renderLine(row.left, "old")}
                    {renderLine(row.right, "new")}
                  </div>
                ),
              )}
            </div>
          ) : (
            <div className="rv-unified-content">
              {lines.map((line) =>
                line.kind === "hunk" || line.kind === "note" ? (
                  <div key={line.id} className="rv-hunk">
                    <span>⋯</span>
                    <code>{line.text}</code>
                  </div>
                ) : (
                  renderLine(line)
                ),
              )}
            </div>
          )}
        </div>
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
              onClick={() => setSelection(null)}
            >
              <X size={14} />
            </button>
            <button
              type="button"
              className="rv-ask"
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
