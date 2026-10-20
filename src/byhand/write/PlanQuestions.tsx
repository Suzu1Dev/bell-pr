import { MessageSquare } from "lucide-react";
import { byHandLimits, helpAllowed } from "../../../shared/by-hand";
import type { Run } from "../../types";
import { CopyRef } from "./CopyRef";
import { useWriteText } from "./text";

/**
 * "Questions on my plan" (DESIGN v1.2 F3; cut K2): up to three guide turns
 * that read the person's plan, never the outline, and answer with
 * questions about missing steps, risky assumptions and tests. Asked only
 * while the person plans (the server refuses it later; the questions stay),
 * never in a fitted run whose help set lacks planning help.
 */
export function PlanQuestions({ run, onAsk, busy }: { run: Run; onAsk(): Promise<void>; busy: boolean }) {
  const t = useWriteText().questions;
  const entries = run.byHand?.planQuestions ?? [];
  const left = Math.max(0, byHandLimits.planQuestions - entries.length);
  const reading = run.byHand?.busy?.kind === "plan";
  const planning = run.status === "awaiting_plan";
  if (!helpAllowed(run, "plan") || !(planning || entries.length)) return null;
  return (
    <section aria-label={t.title}>
      {planning && <div className="by-hand-row">
        <button type="button" className="button secondary" disabled={busy || reading || !left} onClick={() => void onAsk().catch(() => undefined)}>
          <MessageSquare size={15} aria-hidden="true" /> {t.title}
        </button>
        <span role="status">{reading ? t.reading : t.left({ left, max: byHandLimits.planQuestions })}</span>
      </div>}
      {entries.map((entry) => (
        <div key={entry.id}>
          <p>{entry.text}</p>
          {entry.ask && <p>{entry.ask}</p>}
          {entry.refs?.map((ref) => <CopyRef key={`${ref.path}:${ref.line}`} text={`${ref.path}:${ref.line}`} />)}
        </div>
      ))}
    </section>
  );
}
