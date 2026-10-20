import { useEffect, useId, useRef } from "react";
import { Play, TriangleAlert } from "lucide-react";
import { useLocale, useT } from "../i18n";
import { byHandReasonText, isByHandReason, type StartReason } from "./respect";

export type { StartCheck, StartReason } from "./respect";

/** A key that changes when the reasons do, so Start asks again for new ones. */
export const startReasonsKey = (reasons: readonly StartReason[]) =>
  JSON.stringify(reasons);

/**
 * The confirm shown in the task dialog when Start is pressed: one sentence
 * per reason ("You can practise this locally; BELL won't publish it while
 * …"), or the good-first-issue lesson, then Back or Start.
 */
export function StartConfirm({
  reasons,
  onConfirm,
  onCancel,
  byHand = false,
}: {
  reasons: StartReason[];
  onConfirm(): void;
  onCancel(): void;
  /** The person writes the change (Learn by hand). */
  byHand?: boolean;
}) {
  const t = useT("mission").startConfirm;
  const m = useT("discovery").byHand;
  const [locale] = useLocale();
  const id = useId().replaceAll(":", "");
  const heading = useRef<HTMLHeadingElement>(null);
  // Moved here when it opens, so a screen reader reads why Start waits.
  useEffect(() => heading.current?.focus(), []);
  const lines = reasons.map((reason) =>
    reason.id === "other-pr"
      ? t.otherPr(reason)
      : reason.id === "pacing"
        ? t.pacing(reason)
        : reason.id === "learning"
          ? t.lesson
          : isByHandReason(reason)
            ? byHandReasonText(reason, m, locale)
            : t.practise[reason.id],
  );
  // A Learn-by-hand run that can publish through the quoted confirm only informs.
  const practise = reasons.some((reason) => !["learning", "by-hand-fitted"].includes(reason.id));
  return (
    <section className="start-confirm" aria-labelledby={`start-confirm-${id}`}>
      <h3 id={`start-confirm-${id}`} ref={heading} tabIndex={-1}>
        <TriangleAlert size={16} aria-hidden="true" /> {byHand ? m.title : t.title}
      </h3>
      <ul>
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <div className="start-confirm-actions">
        <button type="button" className="button secondary" onClick={onCancel}>
          {t.back}
        </button>
        <button type="button" className="button primary" onClick={onConfirm}>
          <Play size={15} aria-hidden="true" />
          {practise ? (byHand ? m.practise : t.practiseLocally) : t.startAnyway}
        </button>
      </div>
    </section>
  );
}
