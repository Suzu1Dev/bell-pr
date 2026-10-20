import { useEffect, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import { repeatFailure, type ByHandCheckInInput, type ByHandStep, type ByHandStepInput, type TestRun } from "../../../shared/by-hand";
import { useT } from "../../i18n";
import { talkChecks } from "./GuideExits";
import { useWriteText } from "./text";

/**
 * R0, "Talk it through" (DESIGN v1.2 F6; cut K6): a local form, no model
 * call: what the person is trying, expects and sees, then the
 * deterministic checks. Opening it records an R0 use (`talked`).
 */
export function TalkItThrough({ step, tests, fingerprint, onStep }: {
  step?: ByHandStep;
  tests: readonly TestRun[];
  fingerprint: string;
  onStep(stepId: string, input: ByHandStepInput): Promise<void>;
}) {
  const text = useWriteText();
  const t = text.talk;
  const [open, setOpen] = useState(false);
  const toggle = () => {
    if (!open && step) void onStep(step.id, { talked: true }).catch(() => undefined);
    setOpen(!open);
  };
  return (
    <>
      <button type="button" className="mission-text-button" aria-expanded={open} onClick={toggle}>
        <MessageCircle size={14} aria-hidden="true" /> {t.label}
      </button>
      {open && (
        <div className="by-hand" role="group" aria-label={t.label}>
          {[t.trying, t.expect, t.see].map((label) => (
            <textarea key={label} className="text-input" aria-label={label} placeholder={label} rows={2} />
          ))}
          <ul>
            {talkChecks(tests, fingerprint, text.exits).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/**
 * The same failure three BELL test runs in a row (cut K6): one non-modal
 * card, once per step, pointing at the exits; recorded as a check-in.
 */
export function RepeatFailure({ step, tests, onCheckIn }: {
  step?: ByHandStep;
  tests: readonly TestRun[];
  onCheckIn(input: ByHandCheckInInput): Promise<void>;
}) {
  const t = useWriteText().talk;
  const close = useT("common").actions.close;
  const [shown, setShown] = useState(true);
  const repeated = repeatFailure([...tests]);
  useEffect(() => {
    if (repeated) void onCheckIn({ ...(step ? { stepId: step.id } : {}), signal: "repeat-failure" }).catch(() => undefined);
  }, [repeated]); // eslint-disable-line react-hooks/exhaustive-deps -- once per step (the parent keys it by step)
  if (!repeated || !shown) return null;
  return (
    <p className="by-hand-note" role="status">
      {t.repeat}{" "}
      <button type="button" className="icon-button" aria-label={close} title={close} onClick={() => setShown(false)}>
        <X size={13} aria-hidden="true" />
      </button>
    </p>
  );
}
