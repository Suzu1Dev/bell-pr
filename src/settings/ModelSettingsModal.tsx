import type { Dispatch, SetStateAction } from "react";
import { Check, CircleCheck, Loader2 } from "lucide-react";
import { DirectionSettings } from "../mission";
import { defaultContributionSettings } from "../../shared/insights";
import type { TaskSetup } from "../app/hooks/useTaskSetup";
import { useT } from "../i18n";
import { Modal } from "../modals/Modal";

interface ModelSettingsModalProps {
  setup: Pick<
    TaskSetup,
    | "modelSettings"
    | "setModelSettings"
    | "settingsLoading"
    | "settingsReady"
    | "settingsNotice"
    | "setSettingsNotice"
    | "settingsSaveButton"
    | "configureContributionModels"
    | "saveModelSettings"
  >;
  busy: boolean;
  formError: string;
  setFormError: Dispatch<SetStateAction<string>>;
  closeModal: () => void;
}

/** The agent, model and reasoning effort every project shares. */
export function ModelSettingsModal({
  setup,
  busy,
  formError,
  setFormError,
  closeModal,
}: ModelSettingsModalProps) {
  const t = useT("settings").modelDialog;
  const {
    modelSettings,
    setModelSettings,
    settingsLoading,
    settingsReady,
    settingsNotice,
    setSettingsNotice,
    settingsSaveButton,
    configureContributionModels,
    saveModelSettings,
  } = setup;
  return (
    <Modal
      wide
      title={t.title}
      subtitle={t.subtitle}
      onClose={closeModal}
    >
      <form onSubmit={(event) => {
        event.preventDefault();
        void saveModelSettings();
      }}>
        {settingsLoading && (
          <p className="field-help" role="status">{t.loading}</p>
        )}
        {!settingsLoading && !settingsReady && (
          <button
            type="button"
            className="save-direction-button"
            onClick={() => void configureContributionModels()}
          >
            {t.reload}
          </button>
        )}
        <fieldset
          className="direction-settings-container"
          disabled={busy || settingsLoading || !settingsReady}
        >
          <DirectionSettings
            value={{ ...defaultContributionSettings, ...modelSettings }}
            onChange={({ provider, model, reasoningEffort, webAccess }) => {
              setModelSettings({ provider, model, reasoningEffort, webAccess });
              setSettingsNotice("");
              setFormError("");
            }}
            modelsOnly
            compact
          />
        </fieldset>
        {formError && (
          <p role="alert" className="inline-error">{formError}</p>
        )}
        {settingsNotice && (
          <p role="status" className="model-settings-saved">
            <CircleCheck size={16} />{settingsNotice}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={closeModal}>
            {t.close}
          </button>
          <button
            ref={settingsSaveButton}
            type="submit"
            className="button primary"
            disabled={busy || settingsLoading || !settingsReady}
          >
            {busy ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
            {busy ? t.saving : t.save}
          </button>
        </div>
      </form>
    </Modal>
  );
}
