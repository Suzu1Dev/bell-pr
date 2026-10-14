import { useCallback, useState, type ReactNode } from "react";
import { Globe, ShieldCheck } from "lucide-react";
import { useT } from "../i18n";
import { ProBadge } from "../license/ProBadge";
import { Modal } from "../modals/Modal";
import { CopyCommand } from "../setup/CopyCommand";
import { maskCheckValues, maskedDetail } from "../setup/mask";
import type { DoctorState } from "../setup/useDoctor";
import {
  Feedback,
  SettingSwitch,
  SettingsGroup,
  SettingsSectionFrame,
  StatusChip,
  messageOf,
} from "./controls";
import type { AppSettingsState } from "./useAppSettings";

/** The on/off settings of this section. */
type SafetySetting = "allowUnsandboxedAgents" | "alwaysDiscloseAi";

/** The Claude Code sandbox as the environment check found it, with its fixes. */
function SandboxStatus({
  doctor,
  maskUser,
  children,
}: {
  doctor: DoctorState;
  maskUser: (value: string) => string;
  /** The opt-in for agents without the sandbox. */
  children: ReactNode;
}) {
  const t = useT("settings");
  const setup = useT("setup").checklist;
  const check = doctor.report?.checks.find((value) => value.id === "claude-sandbox");
  const status = !doctor.report
    ? t.status.checking
    : !check
      ? setup.status.skip
      : check.status === "skip" && check.reason === "unknown"
        ? setup.notChecked
        : setup.status[check.status];
  const detail = check && maskedDetail(check, maskUser);
  const fixes = check?.status === "warn" || check?.status === "fail" ? (check.fixes ?? []) : [];
  return (
    <SettingsGroup
      title={setup.labels["claude-sandbox"]}
      text={t.safety.sandbox.text}
      aside={<StatusChip text={status} good={check?.status === "ok"} />}
      className="settings-sandbox"
    >
      {detail && (
        <p className="settings-provider-detail">
          <ShieldCheck size={15} aria-hidden="true" />
          {detail}
        </p>
      )}
      {check && fixes.length > 0 && (
        <div className="setup-check-fixes">
          <span>{setup.fixesTitle}</span>
          {fixes.map((fix) => (
            <CopyCommand
              key={`${fix.label}\n${fix.command}`}
              label={fix.label}
              command={maskCheckValues(fix.command, [check], maskUser)}
            />
          ))}
        </div>
      )}
      {children}
    </SettingsGroup>
  );
}

/**
 * Agent safety: the Claude Code sandbox, the opt-in for agents without it
 * (behind a confirmation that explains the risk), what web access means,
 * and the AI-assistance note on pull requests.
 */
export function SafetySection({
  doctor,
  settings,
  maskUser,
  webAccessLocked,
  providerHref,
}: {
  doctor: DoctorState;
  settings: AppSettingsState;
  maskUser: (value: string) => string;
  /** Web access needs Pro on this plan. */
  webAccessLocked: boolean;
  /** The address of the AI provider section, where web access is set. */
  providerHref: string;
}) {
  const t = useT("settings");
  const s = t.safety;
  const view = settings.view;
  const [saving, setSaving] = useState<SafetySetting | "">("");
  const [error, setError] = useState<{ key: SafetySetting; message: string }>();
  const [confirming, setConfirming] = useState(false);
  const { refresh } = doctor;
  const { save: saveSettings } = settings;

  const save = useCallback(
    async (key: SafetySetting, value: boolean) => {
      setSaving(key);
      setError(undefined);
      try {
        await saveSettings({ [key]: value });
        // The sandbox row says whether unsandboxed agents are allowed.
        if (key === "allowUnsandboxedAgents") void refresh();
      } catch (failure) {
        setError({ key, message: messageOf(failure) });
      } finally {
        setSaving("");
      }
    },
    [saveSettings, refresh],
  );
  const cancel = useCallback(() => setConfirming(false), []);

  return (
    <SettingsSectionFrame section="safety" title={s.title} intro={s.intro}>
      <SandboxStatus doctor={doctor} maskUser={maskUser}>
        <SettingSwitch
          label={s.unsandboxed.label}
          help={s.unsandboxed.help}
          checked={view?.settings.allowUnsandboxedAgents === true}
          loading={!view}
          saving={saving === "allowUnsandboxedAgents"}
          lockedBy={view?.lockedBy.allowUnsandboxedAgents}
          onChange={(checked) => {
            if (checked) setConfirming(true);
            else void save("allowUnsandboxedAgents", false);
          }}
        />
        {confirming && (
          <Modal title={s.unsandboxed.confirmTitle} onClose={cancel}>
            <p className="settings-dialog-text">{s.unsandboxed.confirmText}</p>
            <p className="settings-dialog-text">{s.unsandboxed.confirmBadge}</p>
            <div className="modal-actions">
              <button type="button" className="button secondary" onClick={cancel}>
                {s.unsandboxed.cancel}
              </button>
              <button
                type="button"
                className="button primary settings-danger-button"
                onClick={() => {
                  setConfirming(false);
                  void save("allowUnsandboxedAgents", true);
                }}
              >
                {s.unsandboxed.confirm}
              </button>
            </div>
          </Modal>
        )}
        <Feedback error={error?.key === "allowUnsandboxedAgents" ? error.message : ""} />
      </SandboxStatus>
      <SettingsGroup
        title={s.web.title}
        aside={webAccessLocked ? <ProBadge /> : undefined}
        className="settings-web"
      >
        <p className="settings-text">
          <Globe size={15} aria-hidden="true" />
          {s.web.text}
        </p>
        <p className="settings-text">{s.web.privacy}</p>
        {webAccessLocked && <p className="settings-help">{s.web.pro}</p>}
        <a className="settings-link" href={providerHref}>
          {s.web.open}
        </a>
      </SettingsGroup>
      <SettingsGroup title={s.disclose.title}>
        <SettingSwitch
          label={s.disclose.label}
          help={s.disclose.help}
          checked={view?.settings.alwaysDiscloseAi === true}
          loading={!view}
          saving={saving === "alwaysDiscloseAi"}
          lockedBy={view?.lockedBy.alwaysDiscloseAi}
          onChange={(checked) => void save("alwaysDiscloseAi", checked)}
        />
        <Feedback error={error?.key === "alwaysDiscloseAi" ? error.message : ""} />
      </SettingsGroup>
    </SettingsSectionFrame>
  );
}
