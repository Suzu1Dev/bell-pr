import { Eye, PenLine } from "lucide-react";
import type { UnderstandingView } from "../../shared/understanding";
import { useT } from "../i18n";
import type { DiffFile } from "../types";
import { usePanelStrings } from "./i18n";

/** What ExplanationPanel needs of a Learn-by-hand run; the Changes tab passes it as `byHandReview`. */
export interface ByHandReader {
  /** "Run the review again" opens the Ready dialog instead of a rerun request (DESIGN v1.2 F5). */
  onReviewAgain: () => void;
  /** The run's Explain-it-back check (`useUnderstanding().view`); undefined while it loads. */
  check: UnderstandingView | undefined;
  /** Opens the check next to the diff (`openCheckPanel(run.id)`). */
  onOpenCheck: () => void;
}

/** Nobody asked for the file's explanation or walkthrough yet; a held-back file gets neither. */
export function unasked(file: DiffFile, part: "explanation" | "walkthrough") {
  const status = part === "explanation" ? file.explanationStatus : file.walkthroughStatus;
  return !file.blocked && !file[part] && (!status || status === "pending");
}

/** What "Show how a reader sees it" asks for: what this file still lacks, and nothing for another file. */
export function readerRequests(file: DiffFile) {
  const status = file.explanationStatus ?? "";
  return {
    explanation: !file.explanation && !["generating", "unavailable"].includes(status),
    walkthrough: unasked(file, "walkthrough"),
  };
}

/**
 * Whether the file may be explained now, by the server's rule (DESIGN v1.2
 * F10): the check is off in Settings, or the file's own question has an
 * answer saved at the file's current version, or the file has no question
 * and every question has one. Not while the check is still loading.
 */
export function readerAllowed(check: UnderstandingView | undefined, file: Pick<DiffFile, "path">) {
  if (!check) return false;
  if (!check.required) return true;
  const answered = (id: string) =>
    !check.missing.some((part) => part.part === "answer" && part.itemId === id);
  const own = check.plan.find((item) => item.path === file.path);
  return own ? answered(own.id) : check.plan.every((item) => answered(item.id));
}

/**
 * "How a reader sees your change" in a Learn-by-hand run, where a file's
 * explanation or walkthrough would otherwise wait: the way to its own
 * question in Explain it back, then a button that asks for this file's
 * explanation and walkthrough only, after the person's own answer.
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
  const checkTitle = useT("workspace").check.title;
  const { check } = reader;
  const ownQuestion = !check || check.plan.some((item) => item.path === file.path);
  function show() {
    const wanted = readerRequests(file);
    if (wanted.explanation) onExplain?.();
    if (wanted.walkthrough) onWalkthrough?.();
  }
  return (
    <div className="explain-empty">
      <Eye size={28} aria-hidden="true" />
      <h3>{t.title}</h3>
      {readerAllowed(check, file) ? (
        <>
          <p>{t.intro}</p>
          <button type="button" className="explain-retry" disabled={busy} onClick={show}>
            <Eye size={14} aria-hidden="true" />
            {busy ? review.explain.retryBusy : t.show}
          </button>
        </>
      ) : (
        <>
          <p>{ownQuestion ? t.answerFirst : t.answerAll}</p>
          <button type="button" className="explain-retry" onClick={reader.onOpenCheck}>
            <PenLine size={14} aria-hidden="true" />
            {checkTitle}
          </button>
        </>
      )}
    </div>
  );
}
