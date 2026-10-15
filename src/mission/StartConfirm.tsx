import { useEffect, useId, useRef } from "react";
import { Play, TriangleAlert } from "lucide-react";
import { useT } from "../i18n";
import type { StartReason } from "./respect";

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
}: {
  reasons: StartReason[];
  onConfirm(): void;
  onCancel(): void;
}) {
  const t = useT("mission").startConfirm;
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
          : t.practise[reason.id],
  );
  const practise = reasons.some((reason) => reason.id !== "learning");
  return (
    <section className="start-confirm" aria-labelledby={`start-confirm-${id}`}>
      <h3 id={`start-confirm-${id}`} ref={heading} tabIndex={-1}>
        <TriangleAlert size={16} aria-hidden="true" /> {t.title}
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
          {practise ? t.practiseLocally : t.startAnyway}
        </button>
      </div>
    </section>
  );
}
