import { lazy, Suspense, type ReactNode } from "react";
import { Circle, CircleCheck, CircleMinus } from "lucide-react";
import {
  followUpRestatementLimit,
  type FollowUpRestatement,
} from "../../shared/followups";
import type { PrFeedbackItem } from "../../shared/pr-feedback";
import { ErrorBoundary } from "../app/ErrorBoundary";
import { openCheckPanel } from "../app/hooks/useUnderstanding";
import { useT } from "../i18n";
import type { Run } from "../types";

// The Draft tab's panels for the learning loop and the respect checks; they
// load with their facts on demand (DraftLearning.tsx).
export const DraftGuide = lazy(() =>
  import("./DraftLearning").then((module) => ({ default: module.DraftGuide })),
);
export const YourWords = lazy(() =>
  import("./DraftLearning").then((module) => ({ default: module.YourWords })),
);
export const Reviewability = lazy(() =>
  import("./DraftLearning").then((module) => ({ default: module.Reviewability })),
);
export const ForecastCompare = lazy(() => import("../draft/ForecastCompare"));
/** Learn by hand's record, from the one byhand chunk (DESIGN v1.2 F13). */
export const ByHandRecord = lazy(() =>
  import("../byhand/lazy").then((module) => ({ default: module.ByHandRecord })),
);
/** Shared with the publish dialog, so the Markdown renderer loads once. */
export const MarkdownContent = lazy(() =>
  import("../review/MarkdownContent").then((module) => ({
    default: module.MarkdownContent,
  })),
);

/** A panel that loads on demand; a chunk that fails to load leaves the tab as it is. */
export function Deferred({ resetKey, children }: { resetKey?: string; children: ReactNode }) {
  return (
    <ErrorBoundary resetKey={resetKey}>
      <Suspense fallback={null}>{children}</Suspense>
    </ErrorBoundary>
  );
}

/**
 * The Draft checklist's row for the Explain-it-back check: passed,
 * required, or off. While it is off, "Predict the maintainer" opens the
 * check's last step alone, so a forecast can still meet the review. A
 * published run keeps the row only for a pass or its "Check off" mark.
 */
export function UnderstandingRow({
  run,
  check,
}: {
  run: Pick<Run, "id" | "status" | "publishing" | "understandingCheckOff">;
  check: { passed: boolean; off: boolean };
}) {
  const t = useT("workspace").checklist;
  // The check (and the forecast) are taken while the run waits for review or approval.
  const open = ["review", "approved"].includes(run.status) && !run.publishing;
  const state = check.passed
    ? "passed"
    : open
      ? check.off
        ? "off"
        : "required"
      : run.understandingCheckOff
        ? "off"
        : undefined;
  if (!state) return null;
  return (
    <div className={`checklist-item${state === "passed" ? " checked" : ""}`}>
      {state === "passed" ? (
        <CircleCheck size={18} />
      ) : state === "off" ? (
        <CircleMinus size={18} />
      ) : (
        <Circle size={18} />
      )}
      <span>
        {t.understanding}
        <small>
          {state === "passed"
            ? t.understandingPassed
            : state === "off"
              ? t.understandingOff
              : t.understandingRequired}
        </small>
        {state === "off" && open && (
          <button
            type="button"
            className="run-notice-link"
            onClick={() => openCheckPanel(run.id, "forecast")}
          >
            {t.predict}
          </button>
        )}
      </span>
    </div>
  );
}

/** Learn by hand has no AI rounds (until v1.2.1): the person pushes follow-up commits with their own Git. */
export function OwnGitRounds() {
  return <p className="field-help">{useT("draft").followUps.ownGit}</p>;
}

/**
 * Before an AI round: one line per selected comment, in the person's own
 * words. The agent gets these as its task and the comments only as data.
 * The sample shows its own restatement on the disabled form.
 */
export function Restatements({
  items,
  values,
  onChange,
  disabled,
}: {
  items: PrFeedbackItem[];
  values: Record<string, string> | FollowUpRestatement[];
  onChange?(url: string, text: string): void;
  disabled?: boolean;
}) {
  const t = useT("workspace").followUp;
  const value = (url: string) =>
    Array.isArray(values)
      ? (values.find((entry) => entry.url === url)?.text ?? "")
      : (values[url] ?? "");
  if (!items.length) return null;
  return (
    <div className="follow-up-restatements">
      <p className="field-help" id="follow-up-restatement-help">
        {t.restatementHelp}
      </p>
      {items.map((item, index) => (
        <div key={item.url}>
          <label className="field-label" htmlFor={`follow-up-restatement-${index}`}>
            {t.restatement({ author: item.author })}
          </label>
          <blockquote>{item.body.length > 160 ? `${item.body.slice(0, 160)}…` : item.body}</blockquote>
          <input
            id={`follow-up-restatement-${index}`}
            className="text-input"
            aria-describedby="follow-up-restatement-help"
            maxLength={followUpRestatementLimit}
            value={value(item.url)}
            disabled={disabled}
            onChange={(event) => onChange?.(item.url, event.target.value)}
          />
        </div>
      ))}
    </div>
  );
}
