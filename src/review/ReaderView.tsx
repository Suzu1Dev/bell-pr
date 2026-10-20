import { Eye, PenLine, RotateCcw } from "lucide-react";
import type { UnderstandingView } from "../../shared/understanding";
import { useT } from "../i18n";
import type { DiffFile } from "../types";
import { usePanelStrings } from "./i18n";
import { readerAllowed, readerRequests } from "./reader";

/** What ExplanationPanel needs of a Learn-by-hand run; the Changes tab passes it as `byHandReview`. */
export interface ByHandReader {
  /** "Run the review again" opens the Ready dialog instead of a rerun request (DESIGN v1.2 F5). */
  onReviewAgain: () => void;
  /** The run's Explain-it-back check (`useUnderstanding().view`); undefined while it loads. */
  check: UnderstandingView | undefined;
  /** Why the check could not be read (`useUnderstanding().error`): the request waits for it. */
  checkError: string | undefined;
  /** Opens the check next to the diff (`openCheckPanel(run.id)`). */
  onOpenCheck: () => void;
  /** Reads the check again (`useUnderstanding().refresh`). */
  onRetryCheck: () => void;
}

/**
 * "How a reader sees your change" in a Learn-by-hand run, for a file whose
 * explanation or walkthrough nobody asked for: the way to its own question
 * in Explain it back, then a button that asks for this file's explanation
 * and walkthrough only (its progress replaces it; focus moves to the panel).
 * When the check can't be read, it says why and reads it again.
 */
export function ReaderView({
  file,
  reader,
  busy,
  onExplain,
  onWalkthrough,
}: {
  file: DiffFile;
  reader: ByHandReader;
  /** Another explanation or walkthrough is on its way; one request runs at a time. */
  busy: boolean;
  onExplain?: () => void;
  onWalkthrough?: () => void;
}) {
  const review = useT("review");
  const t = usePanelStrings().reader;
  const check = useT("workspace").check;
  const ownQuestion = reader.check?.plan.some((item) => item.path === file.path);
  function show(event: { currentTarget: HTMLElement }) {
    event.currentTarget.closest<HTMLElement>("[role=tabpanel]")?.focus();
    const wanted = readerRequests(file);
    if (wanted.explanation) onExplain?.();
    if (wanted.walkthrough) onWalkthrough?.();
  }
  return (
    <div className="explain-empty">
      <Eye size={28} aria-hidden="true" />
      <h3>{t.title}</h3>
      {!reader.check || readerAllowed(reader.check, file) ? (
        <>
          <p>{t.intro}</p>
          {!reader.check && reader.checkError ? (
            <>
              <p role="alert">{check.loadFailed({ message: reader.checkError })}</p>
              <button type="button" className="explain-retry" onClick={reader.onRetryCheck}>
                <RotateCcw size={14} aria-hidden="true" />
                {check.retry}
              </button>
            </>
          ) : (
            <button type="button" className="explain-retry" disabled={busy || !reader.check} onClick={show}>
              <Eye size={14} aria-hidden="true" />
              {busy ? review.explain.retryBusy : t.show}
            </button>
          )}
        </>
      ) : (
        <>
          <p>{ownQuestion ? t.answerFirst : t.answerAll}</p>
          <button type="button" className="explain-retry" onClick={reader.onOpenCheck}>
            <PenLine size={14} aria-hidden="true" />
            {check.title}
          </button>
        </>
      )}
    </div>
  );
}
