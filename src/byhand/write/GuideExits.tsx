import { useState } from "react";
import { CircleHelp, CircleMinus, ListOrdered, UserRound, Users } from "lucide-react";
import type { ByHandCheckInInput, ByHandStep, ByHandStepInput, ExitKind, TestRun } from "../../../shared/by-hand";
import { useT } from "../../i18n";
import { serializeRoute } from "../../navigation/route";
import { CopyRef } from "./CopyRef";
import { useWriteText } from "./text";

/**
 * "I'm stuck" and the exits (DESIGN v1.2 F6), in this order: ask a human,
 * make this step smaller, park it, and, last and never highlighted, hand
 * the task to the agent team. The card lists the deterministic checks of
 * R0 and records that it was read (`talked`) and the exit taken.
 */
export function GuideExits({
  runId,
  step,
  tests,
  fingerprint,
  issueUrl,
  onStep,
  onCheckIn,
  onLeave,
  busy,
}: {
  runId: string;
  /** The step the person is on, if any. */
  step?: ByHandStep;
  tests: readonly TestRun[];
  /** The current change's fingerprint. */
  fingerprint: string;
  issueUrl?: string;
  onStep(stepId: string, input: ByHandStepInput): Promise<void>;
  onCheckIn(input: ByHandCheckInInput): Promise<void>;
  onLeave(): Promise<void>;
  busy: boolean;
}) {
  const t = useWriteText().exits;
  const cancel = useT("common").actions.cancel;
  const [open, setOpen] = useState(false);
  const [exit, setExit] = useState<ExitKind>();
  const [note, setNote] = useState(t.note);
  const last = [...tests].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).at(-1);
  const checks = [
    ...(last?.changeFingerprint === fingerprint ? [] : [t.checks.tests]),
    ...(last && last.outcome !== "passed" ? [t.checks.failing] : []),
    t.checks.small,
  ];
  const stuck = () => {
    setOpen(true);
    if (step) void onStep(step.id, { talked: true }).catch(() => undefined);
  };
  const take = (choice: ExitKind) => {
    setExit(choice);
    if (choice !== "leave") void onCheckIn({ ...(step ? { stepId: step.id } : {}), signal: "button", choice }).catch(() => undefined);
    if (choice === "park" && step) void onStep(step.id, { parked: true }).catch(() => undefined);
  };
  const button = (choice: ExitKind, Icon: typeof Users, label: string) => (
    <button type="button" className="mission-text-button" aria-pressed={exit === choice} disabled={busy || (choice === "park" && !step)} onClick={() => take(choice)}>
      <Icon size={14} aria-hidden="true" /> {label}
    </button>
  );
  return (
    <section aria-label={t.stuck}>
      <button type="button" className="button secondary" aria-expanded={open} onClick={() => (open ? setOpen(false) : stuck())}>
        <CircleHelp size={15} aria-hidden="true" /> {t.stuck}
      </button>
      {open && (
        <div className="by-hand" role="group" aria-label={t.title}>
          <strong>{t.title}</strong>
          <ul>
            {checks.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className="by-hand-row">
            {button("human", UserRound, t.human)}
            {button("smaller", ListOrdered, t.smaller)}
            {button("park", CircleMinus, t.park)}
            {button("leave", Users, t.leave)}
          </div>
          {exit === "human" && (
            <>
              <p>{t.humanText}</p>
              {issueUrl && (
                <a href={issueUrl} target="_blank" rel="noreferrer">
                  {t.issue}
                </a>
              )}
              <textarea className="text-input" aria-label={t.human} rows={4} value={note} onChange={(event) => setNote(event.target.value)} />
              <CopyRef text={note} shown={false} />
            </>
          )}
          {exit === "smaller" && <a href={serializeRoute({ name: "run", runId, tab: "activity" })}>{t.openPlan}</a>}
          {exit === "leave" && (
            <div className="by-hand-row">
              <p>{t.leaveText}</p>
              <button type="button" className="button secondary" disabled={busy} onClick={() => void onLeave().catch(() => undefined)}>
                {t.leaveGo}
              </button>
              <button type="button" className="mission-text-button" onClick={() => setExit(undefined)}>
                {cancel}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
