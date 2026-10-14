import { useEffect, useId, useState } from "react";
import {
  Bug,
  Cpu,
  FileText,
  Gauge,
  Globe,
  Lightbulb,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  WandSparkles,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type {
  ContributionDirection,
  ContributionSettings,
} from "../../shared/insights";
import {
  agentProviders,
  providerLabels,
  type AgentProvider,
  type ModelCatalog,
  type ReasoningEffort,
} from "../../shared/models";
import {
  defaultPonytailMode,
  ponytailSource,
  type PonytailMode,
} from "../../shared/efficiency";
import { api } from "../api";
import { useT } from "../i18n";
import "./mission.css";

/** The directions in display order; their labels are in the `mission` dictionary. */
export const directionOptions = [
  { value: "bugfix", icon: Bug },
  { value: "feature", icon: Lightbulb },
  { value: "performance", icon: Gauge },
  { value: "ux", icon: WandSparkles },
  { value: "testing", icon: ShieldCheck },
  { value: "docs", icon: FileText },
  { value: "maintenance", icon: Wrench },
] as const satisfies readonly {
  value: ContributionDirection;
  icon: LucideIcon;
}[];

/**
 * Reads a provider's model catalog through the API client, so the request
 * carries the UI locale and a failure arrives as an `ApiError` with the
 * server's message. Aborting `signal` rejects with the abort error unchanged.
 */
export function loadModelCatalog(
  provider: AgentProvider,
  signal?: AbortSignal,
): Promise<ModelCatalog> {
  return api<ModelCatalog>(
    `/models?provider=${encodeURIComponent(provider)}`,
    { signal },
  );
}

export interface DirectionSettingsProps {
  value: ContributionSettings;
  onChange: (next: ContributionSettings) => void;
  compact?: boolean;
  modelsOnly?: boolean;
}

export function DirectionSettings({
  value,
  onChange,
  compact = false,
  modelsOnly = false,
}: DirectionSettingsProps) {
  const { directions, settings: t } = useT("mission");
  const efforts = useT("common").reasoningEffort;
  const id = useId();
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  // The reason the catalog request failed; null while it has not failed.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingModels, setLoadingModels] = useState(true);
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const provider = value.provider ?? "codex";
  const providerLabel = providerLabels[provider];
  useEffect(() => {
    const controller = new AbortController();
    setCatalog(null);
    setLoadingModels(true);
    setLoadError(null);
    loadModelCatalog(provider, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setCatalog(result);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setLoadError(error instanceof Error ? error.message : "");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingModels(false);
      });
    return () => controller.abort();
  }, [catalogAttempt, provider]);
  // A catalog can arrive with an error of its own, such as a CLI that is not
  // signed in; the server words it in the UI language.
  const modelError =
    loadError === null
      ? catalog?.error || ""
      : loadError || t.model.loadFailed({ provider: providerLabel });
  const models = catalog?.models ?? [];
  const defaultModel = models.find((model) => model.isDefault);
  const selectedModel = value.model
    ? models.find((model) => model.id === value.model)
    : defaultModel;
  const availableEfforts = selectedModel?.reasoningEfforts ?? [];
  const unknownModel = !!value.model && !selectedModel;
  const unknownEffort =
    !!value.reasoningEffort &&
    !availableEfforts.includes(value.reasoningEffort);
  function update<K extends keyof ContributionSettings>(
    key: K,
    next: ContributionSettings[K],
  ) {
    onChange({ ...value, [key]: next });
  }

  return (
    <div
      className={`mission-settings${compact ? " mission-settings-compact" : ""}${modelsOnly ? " mission-settings-models-only" : ""}`}
    >
      {!modelsOnly && (
        <>
          <fieldset className="mission-fieldset">
            <legend>
              <span className="mission-legend-icon">
                <Sparkles size={16} />
              </span>
              {t.directionLegend}
            </legend>
            <p className="mission-field-note">{t.directionNote}</p>
            <div className="mission-direction-grid">
              {directionOptions.map(
                ({ value: direction, icon: Icon }) => (
                  <label
                    className={`mission-direction${value.direction === direction ? " mission-direction-selected" : ""}`}
                    key={direction}
                  >
                    <input
                      type="radio"
                      name={`${id}-direction`}
                      value={direction}
                      checked={value.direction === direction}
                      onChange={() => update("direction", direction)}
                    />
                    <Icon size={17} aria-hidden="true" />
                    <span>
                      <strong>{directions[direction].label}</strong>
                      {!compact && <small>{directions[direction].hint}</small>}
                    </span>
                  </label>
                ),
              )}
            </div>
          </fieldset>

          <div className="mission-settings-fields">
            <div className="mission-form-field">
              <label htmlFor={`${id}-target`}>{t.targetUser.label}</label>
              <input
                id={`${id}-target`}
                maxLength={2000}
                value={value.targetUser}
                onChange={(event) => update("targetUser", event.target.value)}
                placeholder={t.targetUser.placeholder}
              />
            </div>
            <div className="mission-form-field">
              <label htmlFor={`${id}-outcome`}>{t.outcome.label}</label>
              <textarea
                id={`${id}-outcome`}
                maxLength={4000}
                value={value.outcome}
                onChange={(event) => update("outcome", event.target.value)}
                rows={compact ? 2 : 3}
                placeholder={t.outcome.placeholder}
              />
            </div>
            <div className="mission-form-columns">
              <div className="mission-form-field">
                <label htmlFor={`${id}-constraints`}>
                  {t.constraints.label} <span>{t.optional}</span>
                </label>
                <textarea
                  id={`${id}-constraints`}
                  maxLength={4000}
                  value={value.constraints}
                  onChange={(event) => update("constraints", event.target.value)}
                  rows={3}
                  placeholder={t.constraints.placeholder}
                  aria-describedby={`${id}-constraints-help`}
                />
                <p id={`${id}-constraints-help`} className="mission-field-note">
                  {t.constraints.help}
                </p>
              </div>
              <div className="mission-form-field">
                <label htmlFor={`${id}-acceptance`}>
                  {t.acceptance.label} <span>{t.optional}</span>
                </label>
                <textarea
                  id={`${id}-acceptance`}
                  maxLength={4000}
                  value={value.acceptance}
                  onChange={(event) => update("acceptance", event.target.value)}
                  rows={3}
                  placeholder={t.acceptance.placeholder}
                  aria-describedby={`${id}-acceptance-help`}
                />
                <p id={`${id}-acceptance-help`} className="mission-field-note">
                  {t.acceptance.help}
                </p>
              </div>
            </div>
            <div className="mission-form-field">
              <label htmlFor={`${id}-issue`}>
                {t.issue.label} <span>{t.optional}</span>
              </label>
              <input
                id={`${id}-issue`}
                type="text"
                inputMode="url"
                maxLength={400}
                value={value.issueUrl ?? ""}
                onChange={(event) => update("issueUrl", event.target.value)}
                placeholder="https://github.com/owner/repo/issues/123"
                aria-describedby={`${id}-issue-help`}
              />
              <p id={`${id}-issue-help`} className="mission-field-note">
                {t.issue.help}
              </p>
            </div>
          </div>

        </>
      )}
      <div
        className="mission-model-settings"
        role="group"
        aria-labelledby={`${id}-model-heading`}
      >
        <div className="mission-model-header">
          <h3 id={`${id}-model-heading`} className="mission-model-heading">
            <Cpu size={16} aria-hidden="true" />
            {t.model.heading}
          </h3>
          <p className="mission-field-note">{t.model.note}</p>
        </div>
        <div className="mission-form-field">
          <label htmlFor={`${id}-provider`}>{t.model.agent}</label>
          <select
            id={`${id}-provider`}
            value={provider}
            aria-describedby={`${id}-provider-help`}
            onChange={(event) =>
              onChange({
                ...value,
                provider: event.target.value as AgentProvider,
                model: "",
                reasoningEffort: "",
              })
            }
          >
            {agentProviders.map((option) => (
              <option key={option} value={option}>
                {providerLabels[option]}
              </option>
            ))}
          </select>
          <p id={`${id}-provider-help`} className="mission-field-note">
            {t.model.providerHelp[provider]}
          </p>
        </div>
        <div className="mission-form-columns">
          <div className="mission-form-field">
            <label htmlFor={`${id}-model`}>{t.model.model}</label>
            <select
              id={`${id}-model`}
              value={value.model ?? ""}
              disabled={loadingModels}
              aria-describedby={`${id}-model-help`}
              onChange={(event) => {
                const model = event.target.value;
                const nextModel = model
                  ? models.find((option) => option.id === model)
                  : defaultModel;
                const reasoningEffort =
                  value.reasoningEffort &&
                  nextModel?.reasoningEfforts.includes(value.reasoningEffort)
                    ? value.reasoningEffort
                    : "";
                onChange({ ...value, model, reasoningEffort });
              }}
            >
              <option value="">
                {t.model.providerDefault({
                  provider: providerLabel,
                  model: defaultModel?.name,
                })}
              </option>
              {unknownModel && (
                <option value={value.model}>
                  {t.model.unconfirmed({ value: value.model ?? "" })}
                </option>
              )}
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
            <p id={`${id}-model-help`} className="mission-field-note">
              {loadingModels
                ? t.model.loading({ provider: providerLabel })
                : unknownModel
                  ? t.model.unknownModel
                  : selectedModel?.description ||
                    t.model.defaultModelHelp({ provider: providerLabel })}
            </p>
          </div>
          <div className="mission-form-field">
            <label htmlFor={`${id}-reasoning`}>{t.model.effort}</label>
            <select
              id={`${id}-reasoning`}
              value={value.reasoningEffort ?? ""}
              disabled={
                loadingModels ||
                (!availableEfforts.length && !value.reasoningEffort)
              }
              aria-describedby={`${id}-reasoning-help`}
              onChange={(event) =>
                update(
                  "reasoningEffort",
                  event.target.value as ReasoningEffort | "",
                )
              }
            >
              <option value="">
                {t.model.modelDefault({
                  effort: selectedModel?.defaultReasoningEffort
                    ? efforts[selectedModel.defaultReasoningEffort]
                    : undefined,
                })}
              </option>
              {unknownEffort && (
                <option value={value.reasoningEffort}>
                  {t.model.unconfirmed({ value: value.reasoningEffort ?? "" })}
                </option>
              )}
              {availableEfforts.map((effort) => (
                <option key={effort} value={effort}>
                  {efforts[effort]} · {effort}
                </option>
              ))}
            </select>
            <p id={`${id}-reasoning-help`} className="mission-field-note">
              {unknownEffort && !loadingModels
                ? t.model.unknownEffort
                : t.model.effortHelp}
            </p>
          </div>
        </div>
        <label className="mission-plan-option">
          <input
            type="checkbox"
            checked={value.webAccess === true}
            onChange={(event) => update("webAccess", event.target.checked)}
            aria-describedby={`${id}-web-help`}
          />
          <span className="mission-plan-copy">
            <strong>
              <Globe size={16} />
              {t.model.webAccess}
            </strong>
            <small id={`${id}-web-help`}>{t.model.webAccessHelp}</small>
          </span>
        </label>
        {modelError && (
          <div className="mission-model-error" role="status">
            <span>{t.model.error({ message: modelError })}</span>
            <button
              type="button"
              onClick={() => setCatalogAttempt((attempt) => attempt + 1)}
              disabled={loadingModels}
            >
              {t.model.reload}
            </button>
          </div>
        )}
      </div>

      {!modelsOnly && (
        <>
          <div className="mission-form-field mission-ponytail-setting">
            <label htmlFor={`${id}-ponytail`}>{t.ponytail.label}</label>
            <select
              id={`${id}-ponytail`}
              value={value.ponytailMode ?? defaultPonytailMode}
              onChange={(event) =>
                update("ponytailMode", event.target.value as PonytailMode)
              }
              aria-describedby={`${id}-ponytail-help`}
            >
              <option value="lite">{t.ponytail.modes.lite}</option>
              <option value="full">{t.ponytail.modes.full}</option>
              <option value="off">{t.ponytail.modes.off}</option>
            </select>
            <p id={`${id}-ponytail-help`} className="mission-field-note">
              {t.ponytail.help}{" "}
              <a href={ponytailSource} target="_blank" rel="noreferrer">
                {t.ponytail.link}
              </a>
            </p>
          </div>

          <div className="mission-team-settings">
            <fieldset className="mission-fieldset mission-team-size">
              <legend>
                <span className="mission-legend-icon">
                  <Users size={16} />
                </span>
                {t.team.legend}
              </legend>
              <div className="mission-team-choices">
                {([2, 3, 4] as const).map((count) => (
                  <label
                    className={
                      value.maxTeammates === count
                        ? "mission-team-choice selected"
                        : "mission-team-choice"
                    }
                    key={count}
                  >
                    <input
                      type="radio"
                      name={`${id}-teammates`}
                      checked={value.maxTeammates === count}
                      onChange={() => update("maxTeammates", count)}
                    />
                    <strong>{count}</strong>
                    <span>{t.team.teammates}</span>
                  </label>
                ))}
              </div>
              <p className="mission-field-note">{t.team.note}</p>
            </fieldset>
            <label className="mission-plan-option">
              <input
                type="checkbox"
                checked={value.requirePlanApproval}
                onChange={(event) =>
                  update("requirePlanApproval", event.target.checked)
                }
              />
              <span className="mission-plan-copy">
                <strong>
                  <Settings2 size={16} />
                  {t.planApproval.label}
                </strong>
                <small>{t.planApproval.help}</small>
              </span>
            </label>
          </div>
        </>
      )}
    </div>
  );
}
