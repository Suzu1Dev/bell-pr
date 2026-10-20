import { useState, type ReactNode } from "react";
import { Archive, BookOpenCheck, Clock3, MessageSquareWarning, ShieldAlert } from "lucide-react";
import { useFormat, useT } from "../i18n";
import { navigate } from "../navigation/route";
import { settingsSections } from "../settings/sections";
import type { Run } from "../types";

/**
 * A badge in the run's title row that links to the setting behind it. The
 * tooltip says what it means and shows on hover and on keyboard focus,
 * until Escape dismisses it. Without a section to link to, the badge is a
 * focusable label.
 */
function RunBadge({
  kind,
  section,
  icon,
  label,
  tooltip,
}: {
  kind: "unsandboxed" | "check-off";
  section?: string;
  icon: ReactNode;
  label: string;
  tooltip: string;
}) {
  const [dismissed, setDismissed] = useState(false);
  // The tooltip opens toward the side with room for it.
  const [toLeft, setToLeft] = useState(false);
  const place = (badge: HTMLElement) => {
    const width = Math.min(320, window.innerWidth * 0.7);
    setToLeft(badge.getBoundingClientRect().left + width > window.innerWidth - 16);
  };
  return (
    <span
      className={`unsandboxed-badge${kind === "check-off" ? " check-off-badge" : ""}${dismissed ? " is-dismissed" : ""}${toLeft ? " opens-left" : ""}`}
      onMouseEnter={(event) => place(event.currentTarget)}
      onFocus={(event) => place(event.currentTarget)}
      onMouseLeave={() => setDismissed(false)}
      onBlur={() => setDismissed(false)}
      onKeyDown={(event) => {
        if (event.key === "Escape") setDismissed(true);
      }}
    >
      {section ? (
        <a
          href={`#/settings/${section}`}
          aria-describedby={`${kind}-help`}
          onClick={(event) => {
            // Through the router, so presentation flags stay in the address.
            event.preventDefault();
            navigate({ name: "settings", section });
          }}
        >
          {icon}
          {label}
        </a>
      ) : (
        <span className="badge-label" tabIndex={0} aria-describedby={`${kind}-help`}>
          {icon}
          {label}
        </span>
      )}
      <span id={`${kind}-help`} className="unsandboxed-help" role="tooltip">
        {tooltip}
      </span>
    </span>
  );
}

/**
 * A persistent warning on a run whose Claude Code agent ran without the
 * operating system's sandbox (`run.unsandboxed`), linking to the safety
 * setting that allowed it.
 */
export function UnsandboxedBadge() {
  const t = useT("workspace").unsandboxed;
  return (
    <RunBadge
      kind="unsandboxed"
      section="safety"
      icon={<ShieldAlert size={14} aria-hidden="true" />}
      label={t.label}
      tooltip={t.tooltip}
    />
  );
}

/** Settings → Learning, once this build has that section. */
const learningSection = (settingsSections as readonly string[]).includes("learning")
  ? "learning"
  : undefined;

/**
 * "Understanding check off": on a run approved without the Explain-it-back
 * check (`run.understandingCheckOff`, for good), or on an unpublished run
 * while the person keeps the check off. It links to Settings → Learning.
 */
export function UnderstandingOffBadge({ approved }: { approved: boolean }) {
  const t = useT("workspace").checkOff;
  return (
    <RunBadge
      kind="check-off"
      section={learningSection}
      icon={<BookOpenCheck size={14} aria-hidden="true" />}
      label={t.label}
      tooltip={approved ? t.tooltip : t.tooltipSetting}
    />
  );
}

/** Whether the run shows the "Understanding check off" badge. */
export function showsCheckOff(run: Run, checkOff: boolean) {
  return run.understandingCheckOff === true || (checkOff && run.status !== "published");
}

/**
 * The latest request for changes, once a feedback read said a maintainer
 * asked for them: the review's own date, or the read's. Nothing polls it.
 */
export function changesRequestedAt(run: Run): string | undefined {
  const feedback = run.prFeedback;
  if (feedback?.reviewDecision !== "CHANGES_REQUESTED") return undefined;
  const reviews = feedback.items
    .filter((item) => item.kind === "review" && item.state === "CHANGES_REQUESTED")
    .map((item) => item.createdAt)
    .sort();
  return reviews.at(-1) ?? feedback.fetchedAt;
}

/**
 * What the workspace says about a run beyond its status: that it waits for
 * a free slot because the limit of runs executing at once is reached, that
 * its working files were cleaned up while its reports and notes stay, and
 * that a maintainer waits on the person (after a feedback read that asked
 * for changes).
 */
export function RunNotices({
  run,
  queued,
}: {
  run: Run;
  /** The run waits in the queue behind the runs already executing. */
  queued: boolean;
}) {
  const t = useT("workspace").runNotices;
  const fmt = useFormat();
  const waiting = run.status === "published" ? changesRequestedAt(run) : undefined;
  if (!queued && !run.workspaceRemovedAt && !waiting) return null;
  return (
    <div className="run-notices">
      {queued && (
        <p className="run-notice" role="status">
          <Clock3 size={15} aria-hidden="true" />
          <span>{t.queued}</span>
        </p>
      )}
      {run.workspaceRemovedAt && (
        <p className="run-notice" role="status">
          <Archive size={15} aria-hidden="true" />
          <span>{t.workspaceRemoved}</span>
        </p>
      )}
      {waiting && (
        <p className="run-notice" role="status">
          <MessageSquareWarning size={15} aria-hidden="true" />
          <span>{t.waiting({ date: fmt.date(waiting) })}</span>
        </p>
      )}
    </div>
  );
}
