import { useState, type FormEvent } from "react";
import { Check, Loader2, TriangleAlert } from "lucide-react";
import type { AppSettings, AppSettingsView } from "../../shared/app-settings";
import { useT } from "../i18n";
import {
  Feedback,
  NumberField,
  SettingsGroup,
  SettingsSectionFrame,
  messageOf,
} from "./controls";
import { changedSettings, type AppSettingsState } from "./useAppSettings";

/** The limits GET /api/status reports. */
export interface StatusLimits {
  maxActiveRuns: number;
  maxAgentProcesses: number;
  maxQueued: number;
}

/** The three limits with their ranges (shared/app-settings.ts). */
export const limitFields = [
  { key: "maxActiveRuns", min: 1, max: 8, step: 1 },
  { key: "maxAgentProcesses", min: 1, max: 32, step: 1 },
  { key: "agentTimeoutScale", min: 0.5, max: 10, step: 0.1 },
] as const;

export type LimitKey = (typeof limitFields)[number]["key"];
type LimitField = (typeof limitFields)[number];

/** The server's timeout multiplier while nothing sets one (server/agent-timeouts.ts). */
const defaultTimeoutScale = 1;

/**
 * The limits in effect: a saved or environment value from the app
 * settings, else the one the server started with.
 */
export function currentLimits(
  settings: AppSettings,
  limits: StatusLimits,
): Record<LimitKey, number> {
  return {
    maxActiveRuns: settings.maxActiveRuns ?? limits.maxActiveRuns,
    maxAgentProcesses: settings.maxAgentProcesses ?? limits.maxAgentProcesses,
    agentTimeoutScale: settings.agentTimeoutScale ?? defaultTimeoutScale,
  };
}

/** The number typed for `field`, or undefined when it is not a valid value. */
export function parseLimit(text: string, field: LimitField): number | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < field.min || value > field.max)
    return undefined;
  if (Number.isInteger(field.step) && !Number.isInteger(value)) return undefined;
  return value;
}

const asText = (values: Record<LimitKey, number>) =>
  Object.fromEntries(limitFields.map(({ key }) => [key, String(values[key])])) as Record<
    LimitKey,
    string
  >;

/** The form; it starts from the values in effect when it mounts. */
function LimitsForm({
  view,
  limits,
  save,
  onSaved,
}: {
  view: AppSettingsView;
  limits: StatusLimits;
  save: AppSettingsState["save"];
  onSaved: () => void;
}) {
  const t = useT("settings");
  const p = t.performance;
  const current = currentLimits(view.settings, limits);
  const [drafts, setDrafts] = useState(() => asText(current));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const parsed = Object.fromEntries(
    limitFields.map((field) => [field.key, parseLimit(drafts[field.key], field)]),
  ) as Record<LimitKey, number | undefined>;
  const invalid = (field: LimitField) =>
    parsed[field.key] === undefined && !view.lockedBy[field.key]
      ? Number.isInteger(field.step)
        ? p.invalidWhole({ min: field.min, max: field.max })
        : p.invalid({ min: field.min, max: field.max })
      : "";
  const hasErrors = limitFields.some((field) => invalid(field));
  // Only what the person changed: the server refuses a locked setting
  // even with its current value.
  const patch = changedSettings(
    current,
    Object.fromEntries(
      limitFields.map(({ key }) => [key, parsed[key] ?? current[key]]),
    ),
    view.lockedBy,
  );
  const changed = Object.keys(patch).length > 0;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || hasErrors || !changed) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const next = await save(patch);
      setDrafts(asText(currentLimits(next.settings, limits)));
      setMessage(p.saved);
      onSaved();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setSaving(false);
    }
  };

  const help = {
    maxActiveRuns: p.maxActiveRuns,
    maxAgentProcesses: p.maxAgentProcesses,
    agentTimeoutScale: p.agentTimeoutScale,
  };

  return (
    <form className="settings-limits" noValidate onSubmit={(event) => void submit(event)}>
      {limitFields.map((field) => (
        <NumberField
          key={field.key}
          label={help[field.key].label}
          help={help[field.key].help}
          value={drafts[field.key]}
          min={field.min}
          max={field.max}
          step={field.step}
          error={invalid(field)}
          lockedBy={view.lockedBy[field.key]}
          saving={saving}
          onChange={(value) => {
            setDrafts((previous) => ({ ...previous, [field.key]: value }));
            setMessage("");
            setError("");
          }}
        >
          {field.key === "maxActiveRuns" && (
            <p className="settings-help">{p.queue({ count: limits.maxQueued })}</p>
          )}
        </NumberField>
      ))}
      <p className="settings-warning">
        <TriangleAlert size={15} aria-hidden="true" />
        <span>{p.usage}</span>
      </p>
      <Feedback message={message} error={error} />
      <div className="settings-actions">
        <button
          type="submit"
          className="button primary"
          aria-disabled={saving || hasErrors || !changed}
        >
          {saving ? (
            <Loader2 size={16} className="spin" aria-hidden="true" />
          ) : (
            <Check size={16} aria-hidden="true" />
          )}
          {saving ? t.state.saving : p.save}
        </button>
      </div>
    </form>
  );
}

/**
 * Performance: how many runs and agent CLI processes run at once and the
 * agent timeout multiplier, each saved in the app settings unless an
 * environment variable sets it.
 */
export function PerformanceSection({
  settings,
  limits,
  onSaved,
}: {
  settings: AppSettingsState;
  /** From GET /api/status; undefined until it arrives. */
  limits?: StatusLimits;
  /** Called after a save, to read the limits in effect again. */
  onSaved: () => void;
}) {
  const t = useT("settings");
  const view = settings.view;
  return (
    <SettingsSectionFrame
      section="performance"
      title={t.performance.title}
      intro={t.performance.intro}
    >
      <SettingsGroup>
        {view && limits ? (
          <LimitsForm
            view={view}
            limits={limits}
            save={settings.save}
            onSaved={onSaved}
          />
        ) : (
          <p className="settings-help" role="status">
            {t.state.loading}
          </p>
        )}
      </SettingsGroup>
    </SettingsSectionFrame>
  );
}
