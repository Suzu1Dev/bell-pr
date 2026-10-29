import { useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { currentApiToken } from "../api";
import { useT } from "../i18n";
import { LanguageSwitcher } from "../i18n/LanguageSwitcher";
import { DevicesSection } from "./DevicesSection";
import { BrowserAccess } from "./BrowserAccess";
import {
  Feedback,
  SettingSwitch,
  SettingsGroup,
  SettingsSectionFrame,
  messageOf,
  reloadPage,
} from "./controls";
import { clearSampleProgress } from "./sampleProject";
import type { AppSettingsState } from "./useAppSettings";

/**
 * General: language, this browser's access, and the sample project.
 */
export function GeneralSection({
  settings,
  reload = reloadPage,
}: {
  settings: AppSettingsState;
  /** Reloads after signing out or resetting the sample project. */
  reload?: () => void;
}) {
  const t = useT("settings");
  const g = t.general;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetError, setResetError] = useState("");
  const resetButton = useRef<HTMLButtonElement>(null);
  const view = settings.view;

  const showSample = async (checked: boolean) => {
    setSaving(true);
    setError("");
    try {
      await settings.save({ showSampleProject: checked });
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    if (clearSampleProgress()) reload();
    else {
      setConfirmReset(false);
      setResetError(g.sample.resetFailed);
    }
  };

  return (
    <SettingsSectionFrame section="general" title={t.sections.general}>
      <SettingsGroup title={g.language.title} text={g.language.text}>
        <div className="setup-command settings-language-row">
          <label htmlFor="settings-language">{g.language.label}</label>
          <LanguageSwitcher
            id="settings-language"
            className="settings-language-select"
          />
        </div>
      </SettingsGroup>
      {!currentApiToken() && <BrowserAccess reload={reload} />}
      <DevicesSection />
      <SettingsGroup title={g.sample.title} text={g.sample.text}>
        <SettingSwitch
          label={g.sample.show}
          help={g.sample.showHelp}
          checked={view?.settings.showSampleProject === true}
          loading={!view}
          saving={saving}
          lockedBy={view?.lockedBy.showSampleProject}
          onChange={(checked) => void showSample(checked)}
        />
        <Feedback error={error} />
        <div className="settings-field">
          <div className="settings-actions">
            <button
              ref={resetButton}
              type="button"
              className="button secondary"
              aria-describedby="settings-sample-reset-help"
              aria-expanded={confirmReset}
              aria-controls={confirmReset ? "settings-sample-reset-confirm" : undefined}
              onClick={() => {
                setResetError("");
                setConfirmReset((open) => !open);
              }}
            >
              <RotateCcw size={15} aria-hidden="true" />
              {g.sample.reset}
            </button>
          </div>
          <p id="settings-sample-reset-help" className="settings-help">
            {g.sample.resetHelp}
          </p>
          {confirmReset && (
            <div
              id="settings-sample-reset-confirm"
              className="settings-confirm"
              role="group"
              aria-label={g.sample.reset}
            >
              <p>{g.sample.resetConfirm}</p>
              <div className="settings-actions">
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    setConfirmReset(false);
                    resetButton.current?.focus();
                  }}
                >
                  {t.state.cancel}
                </button>
                <button type="button" className="button primary" onClick={reset}>
                  {g.sample.resetYes}
                </button>
              </div>
            </div>
          )}
          <Feedback error={resetError} />
        </div>
      </SettingsGroup>
    </SettingsSectionFrame>
  );
}
