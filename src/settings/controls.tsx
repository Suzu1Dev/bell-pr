import { useId, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { useT } from "../i18n";
import type { SettingsSection } from "./sections";

/** The id of a section's heading, which the section is labelled by. */
export const sectionTitleId = (section: SettingsSection) =>
  `settings-${section}-title`;

/** One section of the Settings page: its heading, a sentence and its groups. */
export function SettingsSectionFrame({
  section,
  title,
  intro,
  children,
}: {
  section: SettingsSection;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <section
      className="settings-section"
      aria-labelledby={sectionTitleId(section)}
      data-section={section}
    >
      <header className="settings-section-head">
        <h2 id={sectionTitleId(section)}>{title}</h2>
        {intro && <p>{intro}</p>}
      </header>
      {children}
    </section>
  );
}

/** A card of related settings with its own heading. */
export function SettingsGroup({
  title,
  text,
  aside,
  className,
  children,
}: {
  title?: string;
  text?: ReactNode;
  /** Shown at the end of the heading row, such as a status chip. */
  aside?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={className ? `settings-card ${className}` : "settings-card"}>
      {(title || aside) && (
        <div className="settings-group-head">
          {title && <h3>{title}</h3>}
          {aside}
        </div>
      )}
      {text && <p className="settings-text">{text}</p>}
      {children}
    </div>
  );
}

/**
 * Says that an environment variable sets this value, so the control is
 * read-only. Renders nothing without a variable. `hint` replaces the
 * general sentence for a variable that can only lock one value.
 */
export function LockedNote({
  variable,
  id,
  hint,
}: {
  variable?: string;
  id: string;
  hint?: string;
}) {
  const t = useT("settings").lock;
  if (!variable) return null;
  return (
    <p className="settings-locked" id={id}>
      <span className="settings-lock-badge">
        <Lock size={12} aria-hidden="true" />
        {t.badge}
      </span>
      <span>{hint ?? t.hint({ variable })}</span>
    </p>
  );
}

/** The ids a control is described by, without the empty ones. */
function describedBy(...ids: (string | false | undefined)[]) {
  return ids.filter(Boolean).join(" ") || undefined;
}

/**
 * An on/off setting: a checkbox with its label, an explanation and, when
 * an environment variable sets it, a read-only note.
 */
export function SettingSwitch({
  label,
  help,
  checked,
  loading = false,
  saving = false,
  lockedBy,
  lockedHint,
  onChange,
}: {
  label: string;
  help?: string;
  checked: boolean;
  /** The setting is not known yet: the control is disabled. */
  loading?: boolean;
  /**
   * A change is being saved: further clicks wait for it. The control stays
   * enabled, so it keeps the keyboard focus (a dialog gives it back).
   */
  saving?: boolean;
  /** The environment variable that sets this, when one does. */
  lockedBy?: string;
  /** What the lock note says instead of the general sentence. */
  lockedHint?: string;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="settings-field settings-switch">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={loading || !!lockedBy}
        aria-busy={saving || undefined}
        aria-describedby={describedBy(help && `${id}-help`, lockedBy && `${id}-lock`)}
        onChange={(event) => {
          if (!saving) onChange(event.target.checked);
        }}
      />
      <div className="settings-switch-body">
        <label htmlFor={id}>{label}</label>
        {help && (
          <p id={`${id}-help`} className="settings-help">
            {help}
          </p>
        )}
        <LockedNote variable={lockedBy} id={`${id}-lock`} hint={lockedHint} />
      </div>
    </div>
  );
}

/**
 * A number setting with its range. `value` is the text in the field, so a
 * half-typed number stays as typed; the form checks it before saving.
 */
export function NumberField({
  label,
  help,
  value,
  min,
  max,
  step,
  error,
  lockedBy,
  saving = false,
  onChange,
  children,
}: {
  label: string;
  help: string;
  value: string;
  min: number;
  max: number;
  step: number;
  /** Why the value cannot be saved; "" when it can. */
  error?: string;
  lockedBy?: string;
  /** A save is on its way: the value is read-only until it is done. */
  saving?: boolean;
  onChange: (value: string) => void;
  /** More about the value, below the help, such as what is in effect. */
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="settings-field settings-number">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="settings-number-input"
        type="number"
        inputMode={Number.isInteger(step) ? "numeric" : "decimal"}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={!!lockedBy}
        readOnly={saving}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(
          `${id}-help`,
          error && `${id}-error`,
          lockedBy && `${id}-lock`,
        )}
        onChange={(event) => onChange(event.target.value)}
      />
      <p id={`${id}-help`} className="settings-help">
        {help}
      </p>
      {error && (
        <p id={`${id}-error`} className="settings-field-error">
          {error}
        </p>
      )}
      <LockedNote variable={lockedBy} id={`${id}-lock`} />
      {children}
    </div>
  );
}

/** A short state, such as Ready or Not signed in; `good` shows it in green. */
export function StatusChip({ text, good = false }: { text: string; good?: boolean }) {
  return <span className={`service-status${good ? " connected" : ""}`}>{text}</span>;
}

/** What the last action did: a polite status line, or an alert for a failure. */
export function Feedback({ message, error }: { message?: string; error?: string }) {
  return (
    <>
      <p className="settings-feedback" role="status">
        {error ? "" : message}
      </p>
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/** Reloads the page; one function, so effects that use it stay put. */
export const reloadPage = () => window.location.reload();

/** A failure's message for the UI. */
export const messageOf = (failure: unknown) =>
  failure instanceof Error ? failure.message : String(failure);
