import { useEffect, useRef, useState } from "react";
import { MessageSquare } from "lucide-react";
import { byHandLimits, helpAllowed } from "../../../shared/by-hand";
import type { Run } from "../../types";
import { CopyRef } from "./CopyRef";
import { useWriteText } from "./text";

/**
 * "Questions on my plan" (DESIGN v1.2 F3; cut K2): up to three guide turns (busy "guide"; "plan" is the guide's
 * first read) on the person's plan, never the outline, while they plan (the questions stay), never without planning help.
 */
export function PlanQuestions({ run, onAsk, busy }: { run: Run; onAsk(): Promise<void>; busy: boolean }) {
  const { questions: t, guide } = useWriteText();
  const entries = run.byHand?.planQuestions ?? [];
  const left = Math.max(0, byHandLimits.planQuestions - entries.length);
  const asking = run.byHand?.busy?.kind === "guide";
  const reading = asking || run.byHand?.busy?.kind === "plan";
  const planning = run.status === "awaiting_plan";
  // A turn that ends with no new question (the CLI failed, timed out) says why in the run log's words, as the guide panel does.
  const turn = useRef<{ count: number; log?: string }>(undefined);
  const [failed, setFailed] = useState<string>();
  useEffect(() => {
    const sent = turn.current;
    turn.current = asking ? { count: entries.length, log: run.logs.at(-1)?.time } : undefined;
    const reason = () => [...run.logs].reverse().find((log) => log.agent === "lead" && log.kind === "notice" && log.time > (sent?.log ?? ""))?.message ?? "";
    setFailed(asking || !sent || entries.length > sent.count ? undefined : reason());
  }, [asking]); // eslint-disable-line react-hooks/exhaustive-deps -- once per turn, as it starts and as it ends
  if (!helpAllowed(run, "plan") || !(planning || entries.length)) return null;
  return (
    <section aria-label={t.title}>
      {planning && <div className="by-hand-row">
        <button type="button" className="button secondary" disabled={busy || reading || !left} onClick={() => void onAsk().catch(() => undefined)}>
          <MessageSquare size={15} aria-hidden="true" /> {t.title}
        </button>
        <span role="status">{reading ? t.reading : t.left({ left, max: byHandLimits.planQuestions })}</span>
      </div>}
      {failed !== undefined && <p className="inline-error" role="alert">{guide.failed({ reason: failed })}</p>}
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
