/**
 * "Who writes the code?" in the task dialog (DESIGN v1.2 F1): the agent
 * team (the default) or Learn by hand, with the fitted or full-help choice
 * when the project's rules allow the quoted confirm (F12), and the reason
 * when BELL won't publish a learn-by-hand run there. Strings in `modals`;
 * the case lines are the task dialog's start reasons (`mission`).
 */
import { useId } from "react";
import { Bot, Hand } from "lucide-react";
import type { ByHandRulesCase } from "../../shared/by-hand-rules";
import { useLocale, useT } from "../i18n";
import { byHandReasonText, byHandStartReason } from "../mission/respect";
import "./write/byhand.css";

/** Who writes the change; sent as POST /api/runs `learnByHand`. */
export type RunMode = "agents" | "hand";

export interface ModeChoiceProps {
  mode: RunMode;
  onModeChange(mode: RunMode): void;
  /**
   * The F12 case of the project's rules for this task (byHandRulesCase);
   * undefined while the rules are unread. Learn by hand is never
   * preselected where the case is not `none`.
   */
  rulesCase?: ByHandRulesCase;
  /** "Fit the guide to the project's rules" (the `fitted` case only); sent as `byHandFit`. */
  fitted: boolean;
  onFittedChange(fitted: boolean): void;
  /** The sample shows the agent team only: Learn by hand is disabled with the reason. */
  sample?: boolean;
  disabled?: boolean;
}

export function ModeChoice({
  mode,
  onModeChange,
  rulesCase,
  fitted,
  onFittedChange,
  sample = false,
  disabled = false,
}: ModeChoiceProps) {
  const t = useT("modals").newTask.byHand;
  const reasons = useT("mission").startConfirm.byHand;
  const [locale] = useLocale();
  const id = useId();
  const reason = mode === "hand" && !sample ? byHandStartReason(rulesCase) : undefined;
  const line = reason && byHandReasonText(reason, reasons, locale);
  // Every carve-out the run would be fitted to, verbatim.
  const quotes =
    rulesCase?.case === "fitted"
      ? [...new Set(rulesCase.lock.rules.flatMap((rule) => rule.allows.map((allow) => allow.quote)))]
      : [];
  const card = (value: RunMode, Icon: typeof Bot, title: string, text?: string) => (
    <label className={`mission-direction${mode === value ? " mission-direction-selected" : ""}`}>
      <input
        type="radio"
        name={`${id}-mode`}
        checked={mode === value}
        disabled={disabled || (value === "hand" && sample)}
        onChange={() => onModeChange(value)}
      />
      <Icon size={17} aria-hidden="true" />
      <span>
        <strong>{title}</strong>
        {text && <small>{text}</small>}
      </span>
    </label>
  );
  const option = (value: boolean, title: string, text: string) => (
    <label className="mission-plan-option">
      <input
        type="radio"
        name={`${id}-fit`}
        checked={fitted === value}
        disabled={disabled}
        onChange={() => onFittedChange(value)}
      />
      <span className="mission-plan-copy">
        <strong>{title}</strong>
        <small>{text}</small>
      </span>
    </label>
  );
  return (
    <fieldset className="mode-choice">
      <legend className="field-label">{t.legend}</legend>
      <div className="mission-direction-grid">
        {card("agents", Bot, t.agents)}
        {card("hand", Hand, t.hand, sample ? t.sample : t.handText)}
      </div>
      {reason?.id === "by-hand-fitted" ? (
        <div className="mode-fit" role="group" aria-label={t.hand}>
          {option(true, t.fit, line ?? "")}
          {quotes.map((quote) => (
            <blockquote key={quote}>{quote}</blockquote>
          ))}
          {option(false, t.full, t.fullNote)}
        </div>
      ) : (
        line && (
          <p className="mode-case" role="status">
            {line} {t.practice}
          </p>
        )
      )}
    </fieldset>
  );
}
