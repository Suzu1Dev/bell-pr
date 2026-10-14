import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpLeft,
  Check,
  Lightbulb,
  ListOrdered,
  LoaderCircle,
  Locate,
  RotateCcw,
  Workflow,
} from "lucide-react";
import type { CodeReference, FunctionWalkthrough } from "../../shared/walkthroughs";
import type { DiffFile } from "../types";
import { MarkdownContent } from "./MarkdownContent";

export interface WalkthroughCardsProps {
  file: DiffFile;
  demo: boolean;
  /** The current-file lines marked in the diff, when a walkthrough part is selected. */
  highlight?: { startLine: number; endLine: number };
  onHighlight?: (range: { startLine: number; endLine: number } | undefined) => void;
  onRetry?: () => void;
  busy?: boolean;
}

const lines = (start: number, end: number) =>
  start === end ? `第 ${start} 行` : `第 ${start}–${end} 行`;

function References({ title, icon, entries }: { title: string; icon: React.ReactNode; entries: CodeReference[] }) {
  return (
    <div className="walkthrough-references">
      <h4>
        {icon}
        {title}
      </h4>
      {entries.length ? (
        <ul>
          {entries.map((entry, index) => (
            <li key={`${entry.path}:${entry.line}:${index}`}>
              {entry.name && <strong>{entry.name}</strong>}
              {entry.path && (
                <code>
                  {entry.path}
                  {entry.line !== null && `:${entry.line}`}
                </code>
              )}
              {entry.note && <span>{entry.note}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p>沒有找到。</p>
      )}
    </div>
  );
}

/**
 * The functions around a file's changes, explained as they work now: a
 * summary, the parts in order (each marks its lines in the diff), who calls
 * it and what it calls, an analogy and a self-check.
 */
export function WalkthroughCards({
  file,
  demo,
  highlight,
  onHighlight,
  onRetry,
  busy,
}: WalkthroughCardsProps) {
  const status = file.walkthroughStatus;
  const walkthrough = file.walkthrough;
  const selected = (startLine: number, endLine: number) =>
    highlight?.startLine === startLine && highlight.endLine === endLine;
  const mark = (startLine: number, endLine: number) =>
    onHighlight?.(selected(startLine, endLine) ? undefined : { startLine, endLine });

  if (file.blocked || status === "unavailable" || (demo && !walkthrough))
    return (
      <div className="explain-empty">
        <AlertCircle size={28} />
        <h3>這個檔案沒有程式碼解說</h3>
        <p>
          {file.blocked ||
            file.walkthroughError ||
            "示範資料只為部分檔案準備了程式碼解說。"}
        </p>
      </div>
    );
  if (status === "failed")
    return (
      <div className="explain-empty explain-generation-error" role="alert">
        <AlertCircle size={28} />
        <h3>程式碼解說尚未完成</h3>
        <p>{file.walkthroughError || "產生程式碼解說時發生問題，變更內容仍可正常審閱。"}</p>
        {onRetry && (
          <button className="explain-retry" type="button" disabled={busy} onClick={onRetry}>
            <RotateCcw size={14} />
            {busy ? "其他程式碼解說整理中…" : "重新產生程式碼解說"}
          </button>
        )}
      </div>
    );
  if (!walkthrough)
    return (
      <div className="explain-generating" role="status" aria-live="polite">
        <div className="explain-progress-heading">
          {status === "generating" ? (
            <LoaderCircle className="explain-spin" size={18} />
          ) : (
            <Workflow size={18} />
          )}
          <div>
            <h3>
              {status === "generating"
                ? "正在閱讀這個檔案和它的呼叫端"
                : "程式碼解說會自動準備好"}
            </h3>
            <p>
              {status === "generating"
                ? "找出包住每段變更的函式，逐步拆解原本的運作方式。"
                : "會依序為每個修改過的程式檔產生，先從你正在看的檔案開始。"}
            </p>
          </div>
        </div>
      </div>
    );
  const added = walkthrough.newUnits ?? [];
  const addedNote = added.length > 0 && (
    <p className="walkthrough-new-units">
      這次新增的程式碼沒有原本的邏輯可以拆解：
      {added.map((name, index) => (
        <span key={`${name}:${index}`}>
          {index > 0 && "、"}
          <code>{name}</code>
        </span>
      ))}
      ，請看「變更解說」。
    </p>
  );
  if (!walkthrough.functions.length)
    return added.length ? (
      <div className="explain-empty">
        <Workflow size={28} />
        <h3>這個檔案的變更都是新增的程式碼</h3>
        {addedNote}
      </div>
    ) : (
      <div className="explain-empty">
        <Workflow size={28} />
        <h3>沒有找到包住這些變更的函式</h3>
        <p>這些變更可能在頂層設定或宣告裡；可以展開周圍的程式碼，或在「追問 Agent」詢問。</p>
      </div>
    );
  return (
    <>
      <div className="explain-ready-label">
        <Check size={13} />
        {demo ? "示範解說 · 預先整理的學習內容" : "已讀過目前的檔案與它的呼叫端"}
      </div>
      {walkthrough.functions.map((unit: FunctionWalkthrough) => (
        <section className="explain-card walkthrough-card" key={`${unit.name}:${unit.startLine}`}>
          <h3 className="walkthrough-title">
            <Workflow size={15} />
            <span>
              <strong>{unit.name}</strong>
              {unit.kind && <small>{unit.kind}</small>}
            </span>
            <button
              type="button"
              className="walkthrough-locate"
              aria-pressed={selected(unit.startLine, unit.endLine)}
              onClick={() => mark(unit.startLine, unit.endLine)}
              title="在程式碼中標示這個範圍"
            >
              <Locate size={13} />
              {lines(unit.startLine, unit.endLine)}
            </button>
          </h3>
          <MarkdownContent>{unit.summary}</MarkdownContent>
          {unit.change && (
            <div className="walkthrough-change">
              <span>這次修改與它的關係</span>
              <MarkdownContent>{unit.change}</MarkdownContent>
            </div>
          )}
          {unit.steps.length > 0 && (
            <div className="walkthrough-steps">
              <h4>
                <ListOrdered size={13} />
                逐步拆解
              </h4>
              <ol>
                {unit.steps.map((step, index) => (
                  <li
                    key={`${step.startLine}:${index}`}
                    className={
                      selected(step.startLine, step.endLine)
                        ? "walkthrough-step-selected"
                        : undefined
                    }
                  >
                    {/* The control is the line range; the explanation stays outside it, links and all. */}
                    <button
                      type="button"
                      className="walkthrough-step-lines"
                      aria-pressed={selected(step.startLine, step.endLine)}
                      onClick={() => mark(step.startLine, step.endLine)}
                      title="在程式碼中標示這幾行"
                    >
                      <Locate size={11} />
                      {lines(step.startLine, step.endLine)}
                    </button>
                    <MarkdownContent>{step.explanation}</MarkdownContent>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <References title="誰呼叫它" icon={<ArrowUpLeft size={13} />} entries={unit.callers} />
          <References title="它呼叫什麼" icon={<ArrowDownRight size={13} />} entries={unit.callees} />
          {unit.analogy && (
            <div className="walkthrough-analogy">
              <span>
                <Lightbulb size={13} />
                換個方式想
              </span>
              <MarkdownContent>{unit.analogy}</MarkdownContent>
            </div>
          )}
          {unit.selfCheck.question && (
            <details className="walkthrough-check">
              <summary>考考自己：{unit.selfCheck.question}</summary>
              <MarkdownContent>{unit.selfCheck.answer}</MarkdownContent>
            </details>
          )}
        </section>
      ))}
      {addedNote}
    </>
  );
}
