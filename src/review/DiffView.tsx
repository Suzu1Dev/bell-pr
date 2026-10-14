import { useEffect, useMemo, useRef, useState } from "react";
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
import type { DiffFile } from "../types";
import {
  expandDiff,
  languageBadges,
  parseDiff,
  selectionQuestion,
  splitDiff,
  type DiffLine,
  type Reveal,
} from "./diff";
import "./review.css";

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
}

/** Lines one click on an expand arrow shows. */
const expandStep = 20;

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
  onLoadBase,
}: DiffViewProps) {
  const parsed = useMemo(
    () => (file.blocked ? [] : parseDiff(file.patch)),
    [file.patch, file.blocked],
  );
  // Added and deleted files are whole in the patch; only a modified one has code around it.
  const readable = !!onLoadBase && file.status === "modified" && !file.blocked;
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
  const splitRows = useMemo(() => splitDiff(lines), [lines]);
  const [selection, setSelection] = useState<{
    start: number;
    end: number;
  } | null>(null);

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
            error instanceof Error ? error.message : "無法讀取周圍的程式碼。",
          );
          return null;
        },
      );
    }
    return pendingBase.current;
  }

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
    onAsk(selectionQuestion(file.path, selectedLines));
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
    return (
      <div
        key={`${side ?? "unified"}-${line.id}`}
        className={`rv-line rv-line-${line.kind}${line.expanded ? " rv-line-expanded" : ""}${isSelected ? " rv-line-selected" : ""}`}
        role="button"
        tabIndex={0}
        aria-pressed={isSelected}
        aria-label={`${line.kind === "removed" ? "刪除" : line.kind === "added" ? "新增" : "未變更"}，第 ${side === "old" ? line.oldLine : (line.newLine ?? line.oldLine)} 行：${line.text || "空白行"}`}
        onClick={(event) => select(line, event.shiftKey)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            select(line, event.shiftKey);
          }
        }}
        title="點選行以追問，按住 Shift 可選取多行"
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

  function renderGap(line: DiffLine, className: string) {
    const gap = line.gap!;
    const count =
      gap.hidden === null ? expandStep : Math.min(expandStep, gap.hidden);
    return (
      <div key={`gap-${line.id}`} className={`${className} rv-gap`}>
        <span className="rv-gap-actions">
          {gap.afterChange && (
            <button
              type="button"
              onClick={() => void expand(gap.index, "below")}
              disabled={baseLoading}
              aria-label={`顯示上一段變更下方的 ${count} 行`}
              title={`顯示上一段變更下方的 ${count} 行`}
            >
              <ChevronDown size={13} />
            </button>
          )}
          {gap.beforeChange && (
            <button
              type="button"
              onClick={() => void expand(gap.index, "above")}
              disabled={baseLoading}
              aria-label={`顯示這段變更上方的 ${count} 行`}
              title={`顯示這段變更上方的 ${count} 行`}
            >
              <ChevronUp size={13} />
            </button>
          )}
          <button
            type="button"
            onClick={() => void expand(gap.index, "all")}
            disabled={baseLoading}
            aria-label={
              gap.hidden === null
                ? "顯示到檔案結尾"
                : `顯示這裡全部 ${gap.hidden} 行`
            }
            title={
              gap.hidden === null
                ? "顯示到檔案結尾"
                : `顯示這裡全部 ${gap.hidden} 行`
            }
          >
            <UnfoldVertical size={13} />
          </button>
        </span>
        <code>
          {gap.hidden === null
            ? "檔案後面還有未變更的程式碼"
            : `${gap.hidden} 行未變更`}
          {line.text && <span className="rv-gap-header">{line.text}</span>}
        </code>
      </div>
    );
  }

  return (
    <section
      className={`rv-diff ${view === "split" ? "rv-diff-split" : ""}`}
      aria-label={`${file.path} 的程式碼差異`}
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
              className={`rv-whole ${whole ? "rv-whole-on" : ""}`}
              aria-pressed={whole}
              onClick={() => void toggleWhole()}
              disabled={baseLoading}
              title="在變更之間顯示整個檔案"
            >
              {whole ? (
                <FoldVertical size={13} />
              ) : (
                <UnfoldVertical size={13} />
              )}
              完整檔案
            </button>
          )}
          <span className="rv-additions">+{file.additions}</span>
          <span className="rv-deletions">−{file.deletions}</span>
          {hasNote === false && !reviewed && !file.blocked && (
            <span className="rv-note-hint">還沒寫下你的理解</span>
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
            已審閱
          </label>
        </div>
      </div>
      {baseError && (
        <p className="rv-context-error" role="alert">
          {baseError}
        </p>
      )}
      {file.blocked || lines.length === 0 ? (
        <div className="rv-empty">
          <Code2 size={28} />
          <h3>
            {file.blocked
              ? "這個檔案目前無法審閱"
              : "這個檔案沒有可顯示的文字差異"}
          </h3>
          <p>
            {file.blocked || "二進位檔案或沒有文字變更的檔案，無法逐行呈現。"}
          </p>
        </div>
      ) : (
        <div className="rv-code-scroll">
          {view === "split" ? (
            <div className="rv-split-content">
              <div className="rv-split-labels">
                <span>變更前</span>
                <span>變更後</span>
              </div>
              {splitRows.map((row, index) =>
                row.hunk?.kind === "gap" ? (
                  renderGap(row.hunk, "rv-hunk rv-split-hunk")
                ) : row.hunk ? (
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
                line.kind === "gap" ? (
                  renderGap(line, "rv-hunk")
                ) : line.kind === "hunk" || line.kind === "note" ? (
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
              已選取 {selectedLines.length} 行
            </>
          ) : (
            <>
              <MousePointer2 size={13} /> 點選任何一行，讓 Agent 為你解說
              <span className="rv-shift-hint">
                <kbd>Shift</kbd> 可多行選取
              </span>
            </>
          )}
        </span>
        {selectedLines.length > 0 && (
          <div className="rv-selection-actions">
            <button
              type="button"
              className="rv-clear"
              aria-label="清除選取"
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
              解說這段程式碼
              <ChevronRight size={13} />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
