import { lazy, Suspense, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
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
  clampContributionSettings,
  freeEntitlements,
  proEntitlements,
  proOnlyEfforts,
  type Entitlements,
} from "../../shared/plans";
import {
  defaultPonytailMode,
  ponytailSource,
  type PonytailMode,
} from "../../shared/efficiency";
import { api } from "../api";
import { usePresentation } from "../app/presentation";
import { useT } from "../i18n";
import { ProBadge } from "../license/ProBadge";
import { ReadinessMessage } from "../setup/ReadinessNotice";
import { useDoctor, type DoctorState } from "../setup/useDoctor";
import { usePlan } from "./plan";
import { providerReadiness, withProvider } from "./readiness";
import type { StartCheck } from "./StartConfirm";
import "./mission.css";

// The task dialog's facts: their own chunk, with the respect rules.
const BeforeYouStart = lazy(() => import("./BeforeYouStart"));

/** The efforts only Pro offers; "Default" is on every plan. */
const proEfforts: readonly string[] = proOnlyEfforts;
/** The most teammates Pro runs, for the notice that Free runs fewer. */
const proTeammates = proEntitlements(1).maxTeammates;

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
  /** What the plan unlocks, when the parent knows it; read otherwise. */
  entitlements?: Entitlements;
  /**
   * The sample project: every Pro control is unlocked and marked PRO, and
   * provider readiness is not checked. Default: the `demo=play` flag.
   */
  demo?: boolean;
  /** A useDoctor() state to share; the form loads its own otherwise. */
  doctor?: DoctorState;
  /**
   * The model catalog for a render that runs no effects, such as a static
   * render in tests. A mounted form loads the catalog and shows that one.
   */
  initialCatalog?: ModelCatalog;
  /**
   * The task's repository, in the task dialog only: the issue field then
   * shows its Before-you-start facts. The settings defaults have none.
   */
  repoId?: string;
  /** Tells the task dialog the facts read and whether Start asks once. */
  onStartCheck?: (check: StartCheck) => void;
  /** The person writes the change (Learn by hand): no team size, and plan approval always on. */
  byHand?: boolean;
}

export function DirectionSettings({
  value,
  onChange,
  compact = false,
  modelsOnly = false,
  entitlements,
  demo: demoProp,
  doctor,
  initialCatalog,
  repoId,
  onStartCheck,
  byHand = false,
}: DirectionSettingsProps) {
  const { directions, settings: t } = useT("mission");
  const { reasoningEffort: efforts, reasoningEffortWithId } = useT("common");
  const id = useId();
  const presentation = usePresentation();
  const demo = demoProp ?? presentation.play;
  const plan = usePlan({ entitlements, demo });
  const ownDoctor = useDoctor({ enabled: !demo && !doctor });
  const report = demo ? null : (doctor ?? ownDoctor).report;
  const [catalog, setCatalog] = useState<ModelCatalog | null>(
    initialCatalog ?? null,
  );
  // The reason the catalog request failed; null while it has not failed.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingModels, setLoadingModels] = useState(!initialCatalog);
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
  const readiness = (option: AgentProvider) =>
    providerReadiness(report, option);
  const selectedReadiness = withProvider(
    { ready: true, checking: false, missing: [] },
    readiness(provider),
  );
  const effortLocked = plan.locked("deepReasoning");
  const effortMarked = plan.marked("deepReasoning");
  const webLocked = plan.locked("webAccess");
  const teamLocked = plan.locked("teamSize");
  const teamMarked = plan.marked("teamSize");
  const teamLimit = teamLocked
    ? (plan.entitlements?.maxTeammates ?? freeEntitlements.maxTeammates)
    : undefined;

  // Free runs at most 2 teammates. A value above the plan's limit (the
  // default asks for 3, and a project saved under Pro may ask for 4) is
  // lowered as soon as it arrives, and the form says why. The server
  // clamps a saved setting too (PUT /api/repos/:id/settings answers
  // clamped: true), for clients that do not.
  const overLimit =
    !modelsOnly && teamLimit !== undefined && value.maxTeammates > teamLimit;
  const [clampedOnLoad, setClampedOnLoad] = useState(false);
  const latest = useRef({ value, onChange, entitlements: plan.entitlements });
  latest.current = { value, onChange, entitlements: plan.entitlements };
  // A layout effect, so the lower value applies in the same commit as the
  // settings or the plan that brought it. As a passive effect it could run
  // after a keystroke that came in between (the form unlocks in that
  // commit) and put back the form without what was just typed.
  useLayoutEffect(() => {
    const { value: current, onChange: apply, entitlements: limits } =
      latest.current;
    if (!overLimit || !limits) return;
    const clamp = clampContributionSettings(current, limits);
    if (!clamp.clamped) return;
    apply(clamp.settings);
    setClampedOnLoad(true);
  }, [overLimit, teamLimit]);
  // The notice stays after the parent took the lower value, while Free lasts.
  const clampNotice =
    !modelsOnly && teamLimit !== undefined && (overLimit || clampedOnLoad);

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
              {repoId && (
                <Suspense fallback={null}>
                  <BeforeYouStart
                    repoId={repoId}
                    issueUrl={value.issueUrl}
                    demo={demo}
                    onFacts={onStartCheck}
                    byHand={byHand}
                  />
                </Suspense>
              )}
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
            {agentProviders.map((option) => {
              const state = readiness(option)?.state;
              return (
                <option key={option} value={option}>
                  {state
                    ? t.model.providerOption({
                        provider: providerLabels[option],
                        state: t.model.providerStates[state],
                      })
                    : providerLabels[option]}
                </option>
              );
            })}
          </select>
          <p id={`${id}-provider-help`} className="mission-field-note">
            {t.model.providerHelp[provider]}
          </p>
          <ReadinessMessage
            readiness={selectedReadiness}
            maskUser={presentation.maskUser}
          />
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
              aria-describedby={`${id}-reasoning-default ${id}-reasoning-help`}
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
              {availableEfforts.map((effort) => {
                const label = reasoningEffortWithId({ effort });
                const proOnly = proEfforts.includes(effort);
                return (
                  <option
                    key={effort}
                    value={effort}
                    disabled={proOnly && effortLocked}
                  >
                    {proOnly && effortMarked
                      ? t.model.proOption({ label })
                      : label}
                  </option>
                );
              })}
            </select>
            <p id={`${id}-reasoning-default`} className="mission-field-note">
              {t.model.defaultEffortNote}
            </p>
            <p id={`${id}-reasoning-help`} className="mission-field-note">
              {unknownEffort && !loadingModels
                ? t.model.unknownEffort
                : t.model.effortHelp}
            </p>
          </div>
        </div>
        <label
          className={`mission-plan-option${webLocked && value.webAccess !== true ? " mission-option-locked" : ""}`}
        >
          <input
            type="checkbox"
            checked={value.webAccess === true}
            // Saved under Pro, web access can still be turned off on Free.
            disabled={webLocked && value.webAccess !== true}
            onChange={(event) => update("webAccess", event.target.checked)}
            aria-describedby={`${id}-web-help`}
          />
          <span className="mission-plan-copy">
            <strong>
              <Globe size={16} />
              {t.model.webAccess}
              {plan.marked("webAccess") && <ProBadge />}
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
            <label htmlFor={`${id}-ponytail`} title={t.ponytail.credit}>
              {t.ponytail.label}
            </label>
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
            {!byHand && <fieldset className="mission-fieldset mission-team-size">
              <legend>
                <span className="mission-legend-icon">
                  <Users size={16} />
                </span>
                {t.team.legend}
              </legend>
              <div className="mission-team-choices">
                {([2, 3, 4] as const).map((count) => {
                  const proOnly = count > freeEntitlements.maxTeammates;
                  const locked = teamLimit !== undefined && count > teamLimit;
                  return (
                    <label
                      className={`mission-team-choice${value.maxTeammates === count ? " selected" : ""}${locked ? " locked" : ""}`}
                      key={count}
                    >
                      <input
                        type="radio"
                        name={`${id}-teammates`}
                        checked={value.maxTeammates === count}
                        disabled={locked}
                        onChange={() => update("maxTeammates", count)}
                      />
                      <strong>{count}</strong>
                      <span>{t.team.teammates}</span>
                      {proOnly && teamMarked && <ProBadge />}
                    </label>
                  );
                })}
              </div>
              <p className="mission-field-note">{t.team.note}</p>
              {clampNotice && (
                <p className="mission-clamp-notice" role="status">
                  {t.team.clampNotice({ free: teamLimit, pro: proTeammates })}
                </p>
              )}
            </fieldset>}
            <label className="mission-plan-option">
              <input
                type="checkbox"
                checked={byHand || value.requirePlanApproval}
                disabled={byHand}
                onChange={(event) =>
                  update("requirePlanApproval", event.target.checked)
                }
              />
              <span className="mission-plan-copy">
                <strong>
                  <Settings2 size={16} />
                  {t.planApproval.label}
                </strong>
                <small>{byHand ? t.planApproval.byHand : t.planApproval.help}</small>
              </span>
            </label>
          </div>
        </>
      )}
    </div>
  );
}
