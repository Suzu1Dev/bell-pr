import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Bot, Check, CircleCheck, Loader2, TriangleAlert } from "lucide-react";
import type { DoctorCheck, DoctorReport } from "../../shared/doctor";
import type { Fix } from "../../shared/errors";
import { defaultContributionSettings } from "../../shared/insights";
import {
  agentProviders,
  providerLabels,
  type AgentProvider,
  type ModelSettings,
} from "../../shared/models";
import { api, send } from "../api";
import { useT } from "../i18n";
import { modelSettingsChangedEvent } from "../license/useEntitlements";
import { DirectionSettings } from "../mission/DirectionSettings";
import { CopyCommand } from "../setup/CopyCommand";
import { maskCheckValues, maskedDetail } from "../setup/mask";
import type { DoctorState } from "../setup/useDoctor";
import {
  Feedback,
  SettingsGroup,
  SettingsSectionFrame,
  StatusChip,
  messageOf,
} from "./controls";

/** How far an agent CLI is from working, as the environment check found it. */
export type CliState = "checking" | "ready" | "signedOut" | "missing" | "notWorking";

const checkIds = {
  codex: { tool: "codex", auth: "codex-auth" },
  claude: { tool: "claude", auth: "claude-auth" },
} as const satisfies Record<AgentProvider, { tool: string; auth: string }>;

/** The state of `provider`'s CLI and the checks it comes from. */
export function providerState(
  report: DoctorReport | null,
  provider: AgentProvider,
): { state: CliState; tool?: DoctorCheck; auth?: DoctorCheck } {
  if (!report) return { state: "checking" };
  const find = (id: string) => report.checks.find((check) => check.id === id);
  const tool = find(checkIds[provider].tool);
  const auth = find(checkIds[provider].auth);
  const state: CliState =
    !tool || tool.status === "skip"
      ? "missing"
      : tool.status !== "ok"
        ? "notWorking"
        : auth?.status === "ok"
          ? "ready"
          : "signedOut";
  return { state, tool, auth };
}

/** One agent CLI: what it is, whether it works, and how to set it up. */
function ProviderCard({
  provider,
  report,
  maskUser,
}: {
  provider: AgentProvider;
  report: DoctorReport | null;
  maskUser: (value: string) => string;
}) {
  const t = useT("settings");
  const labels = useT("setup").checklist.labels;
  const { state, tool, auth } = providerState(report, provider);
  // The account when it works; why it does not when the CLI fails.
  const shown = state === "ready" ? auth : state === "notWorking" ? tool : undefined;
  const detail = shown ? maskedDetail(shown, maskUser) : undefined;
  const fixing: DoctorCheck[] =
    state === "missing" || state === "notWorking"
      ? [tool, auth].filter((check): check is DoctorCheck => !!check)
      : state === "signedOut" && auth
        ? [auth]
        : [];
  const seen = new Set<string>();
  const fixes = fixing
    .filter((check) => check.status !== "ok")
    .flatMap((check) => check.fixes ?? [])
    .filter((fix: Fix) => {
      const key = `${fix.label}\n${fix.command}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return (
    <SettingsGroup className="settings-provider">
      <div className="settings-service" data-provider={provider}>
        <div className="service-icon">
          <Bot size={24} aria-hidden="true" />
        </div>
        <div>
          <h3>{labels[provider]}</h3>
          <p>{t.provider.description[provider]}</p>
        </div>
        <StatusChip text={t.status[state]} good={state === "ready"} />
      </div>
      {detail && <p className="settings-provider-detail">{detail}</p>}
      {fixes.length > 0 && (
        <div className="setup-check-fixes settings-provider-fixes">
          <span>{t.provider.fixesTitle}</span>
          {fixes.map((fix) => (
            <CopyCommand
              key={`${fix.label}\n${fix.command}`}
              label={fix.label}
              command={maskCheckValues(fix.command, fixing, maskUser)}
            />
          ))}
        </div>
      )}
    </SettingsGroup>
  );
}

/** The shared model settings, edited in place: provider, model, effort, web access. */
function ModelSettingsForm({
  showCurrentRun,
}: {
  showCurrentRun: () => void;
}) {
  const t = useT("settings").provider.models;
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const loads = useRef(0);

  const load = useCallback(async () => {
    const request = ++loads.current;
    setLoadError("");
    try {
      const { settings: saved } = await api<{ settings: ModelSettings }>(
        "/model-settings",
      );
      if (request === loads.current) setSettings(saved);
    } catch (failure) {
      if (request === loads.current) setLoadError(messageOf(failure));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  // Answers that arrive after unmounting are dropped.
  useEffect(
    () => () => {
      loads.current++;
    },
    [],
  );

  // "Use Free settings" in the upgrade dialog saves new ones.
  useEffect(() => {
    const changed = (event: CustomEvent<ModelSettings>) => {
      loads.current++;
      setSettings(event.detail);
    };
    window.addEventListener(modelSettingsChangedEvent, changed);
    return () => window.removeEventListener(modelSettingsChangedEvent, changed);
  }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!settings || saving) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const { settings: saved } = await api<{ settings: ModelSettings }>(
        "/model-settings",
        send("PUT", settings),
      );
      setSettings(saved);
      setMessage(t.saved);
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsGroup className="settings-models">
      {settings === null && !loadError && (
        <p className="settings-help" role="status">
          {t.loading}
        </p>
      )}
      {loadError && (
        <div className="settings-actions">
          <p className="settings-error" role="alert">
            {loadError}
          </p>
          <button type="button" className="button secondary" onClick={() => void load()}>
            {t.reload}
          </button>
        </div>
      )}
      {settings && (
        <form onSubmit={(event) => void save(event)}>
          <fieldset className="direction-settings-container" disabled={saving}>
            <DirectionSettings
              value={{ ...defaultContributionSettings, ...settings }}
              onChange={({ provider, model, reasoningEffort, webAccess }) => {
                setSettings({ provider, model, reasoningEffort, webAccess });
                setMessage("");
                setError("");
              }}
              modelsOnly
              compact
            />
          </fieldset>
          <Feedback message={message} error={error} />
          <div className="settings-actions">
            <button type="button" className="button secondary" onClick={showCurrentRun}>
              {t.current}
            </button>
            <button type="submit" className="button primary" aria-disabled={saving}>
              {saving ? (
                <Loader2 size={16} className="spin" aria-hidden="true" />
              ) : (
                <Check size={16} aria-hidden="true" />
              )}
              {t.save}
            </button>
          </div>
        </form>
      )}
    </SettingsGroup>
  );
}

/**
 * AI provider: whether the Codex CLI and Claude Code are installed and
 * signed in (at least one must be), and the models every project shares,
 * edited here instead of in a dialog.
 */
export function ProviderSection({
  doctor,
  maskUser,
  showCurrentRun,
}: {
  doctor: DoctorState;
  maskUser: (value: string) => string;
  /** Opens the workspace's activity tab, which lists the open run's models. */
  showCurrentRun: () => void;
}) {
  const t = useT("settings");
  const report = doctor.report;
  const ready = report
    ? agentProviders.filter(
        (provider) => providerState(report, provider).state === "ready",
      )
    : [];
  const providerCheck = report?.checks.find((check) => check.id === "provider-ready");
  // A provider chosen in the model settings that is not ready fails the
  // check although another one works: the server's detail says so.
  const chosenNotReady =
    providerCheck?.status === "fail" && ready.length > 0 && providerCheck.detail;
  return (
    <SettingsSectionFrame
      section="provider"
      title={t.provider.title}
      intro={t.provider.intro}
    >
      {!report ? (
        <p className="settings-readiness" role="status">
          <Loader2 size={16} className="spin" aria-hidden="true" />
          {t.status.checking}
        </p>
      ) : ready.length && !chosenNotReady ? (
        <p className="settings-readiness ready" role="status">
          <CircleCheck size={16} aria-hidden="true" />
          {t.provider.readyWith({
            providers: ready.map((provider) => providerLabels[provider]),
          })}
        </p>
      ) : (
        <p className="settings-readiness not-ready" role="status">
          <TriangleAlert size={16} aria-hidden="true" />
          {chosenNotReady || t.provider.needOne}
        </p>
      )}
      <div className="settings-provider-list">
        {agentProviders.map((provider) => (
          <ProviderCard
            key={provider}
            provider={provider}
            report={report}
            maskUser={maskUser}
          />
        ))}
      </div>
      <ModelSettingsForm showCurrentRun={showCurrentRun} />
    </SettingsSectionFrame>
  );
}
