import type { ReactNode } from "react";
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
import type {
  CodeReference,
  FunctionWalkthrough,
} from "../../shared/walkthroughs";
import { useFormat, useT } from "../i18n";
import type { DiffFile } from "../types";
import { MarkdownContent } from "./MarkdownContent";
import { withNodes } from "./withNodes";

/** Lines of the current file, inclusive. */
export interface LineRange {
  startLine: number;
  endLine: number;
}

export interface WalkthroughCardsProps {
  file: DiffFile;
  demo: boolean;
  /** The current-file lines marked in the diff, when a walkthrough part is selected. */
  highlight?: LineRange;
  onHighlight?: (range: LineRange | undefined) => void;
  onRetry?: () => void;
  busy?: boolean;
}

function References({
  title,
  icon,
  entries,
}: {
  title: string;
  icon: ReactNode;
  entries: CodeReference[];
}) {
  const t = useT("review").walkthrough;
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
        <p>{t.none}</p>
      )}
    </div>
  );
}

/**
 * The functions around a file's changes, explained as they work now: a
 * summary, the parts in order (each marks its lines in the diff), who calls
 * it and what it calls, an analogy and a self-check. Units the diff adds
 * whole are only named; the explanation covers them.
 */
export function WalkthroughCards({
  file,
  demo,
  highlight,
  onHighlight,
  onRetry,
  busy,
}: WalkthroughCardsProps) {
  const t = useT("review").walkthrough;
  const format = useFormat();
  const status = file.walkthroughStatus;
  const walkthrough = file.walkthrough;
  const lines = (start: number, end: number) => t.lines({ start, end });
  const selected = (startLine: number, endLine: number) =>
    highlight?.startLine === startLine && highlight.endLine === endLine;
  const mark = (startLine: number, endLine: number) =>
    onHighlight?.(
      selected(startLine, endLine) ? undefined : { startLine, endLine },
    );

  if (file.blocked || status === "unavailable" || (demo && !walkthrough))
    return (
      <div className="explain-empty">
        <AlertCircle size={28} />
        <h3>{t.unavailableTitle}</h3>
        <p>{file.blocked || file.walkthroughError || t.demoOnly}</p>
      </div>
    );
  if (status === "failed")
    return (
      <div className="explain-empty explain-generation-error" role="alert">
        <AlertCircle size={28} />
        <h3>{t.failedTitle}</h3>
        <p>{file.walkthroughError || t.failedBody}</p>
        {onRetry && (
          <button
            className="explain-retry"
            type="button"
            disabled={busy}
            onClick={onRetry}
          >
            <RotateCcw size={14} />
            {busy ? t.busy : t.retry}
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
              {status === "generating" ? t.generatingTitle : t.pendingTitle}
            </h3>
            <p>{status === "generating" ? t.generatingBody : t.pendingBody}</p>
          </div>
        </div>
      </div>
    );
  const added = walkthrough.newUnits ?? [];
  // The locale's separator between listed names (", " or the ideographic comma).
  const separator = format.list(["", ""], { type: "unit" });
  const addedNote = added.length > 0 && (
    <p className="walkthrough-new-units">
      {withNodes(t.newUnits, {
        names: (
          <>
            {added.map((name, index) => (
              <span key={`${name}:${index}`}>
                {index > 0 && separator}
                <code>{name}</code>
              </span>
            ))}
          </>
        ),
      })}
    </p>
  );
  if (!walkthrough.functions.length)
    return added.length ? (
      <div className="explain-empty">
        <Workflow size={28} />
        <h3>{t.onlyNewTitle}</h3>
        {addedNote}
      </div>
    ) : (
      <div className="explain-empty">
        <Workflow size={28} />
        <h3>{t.noneTitle}</h3>
        <p>{t.noneBody}</p>
      </div>
    );
  return (
    <>
      <div className="explain-ready-label">
        <Check size={13} />
        {demo ? t.readyDemo : t.readyLive}
      </div>
      {walkthrough.functions.map((unit: FunctionWalkthrough) => (
        <section
          className="explain-card walkthrough-card"
          key={`${unit.name}:${unit.startLine}`}
        >
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
              title={t.locate}
            >
              <Locate size={13} />
              {lines(unit.startLine, unit.endLine)}
            </button>
          </h3>
          <MarkdownContent>{unit.summary}</MarkdownContent>
          {unit.change && (
            <div className="walkthrough-change">
              <span>{t.change}</span>
              <MarkdownContent>{unit.change}</MarkdownContent>
            </div>
          )}
          {unit.steps.length > 0 && (
            <div className="walkthrough-steps">
              <h4>
                <ListOrdered size={13} />
                {t.steps}
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
                      title={t.locateStep}
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
          <References
            title={t.callers}
            icon={<ArrowUpLeft size={13} />}
            entries={unit.callers}
          />
          <References
            title={t.callees}
            icon={<ArrowDownRight size={13} />}
            entries={unit.callees}
          />
          {unit.analogy && (
            <div className="walkthrough-analogy">
              <span>
                <Lightbulb size={13} />
                {t.analogy}
              </span>
              <MarkdownContent>{unit.analogy}</MarkdownContent>
            </div>
          )}
          {unit.selfCheck.question && (
            <details className="walkthrough-check">
              <summary>{t.selfCheck({ question: unit.selfCheck.question })}</summary>
              <MarkdownContent>{unit.selfCheck.answer}</MarkdownContent>
            </details>
          )}
        </section>
      ))}
      {addedNote}
    </>
  );
}
