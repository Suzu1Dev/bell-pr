import type { Dispatch, SetStateAction } from "react";
import { Check, CircleCheck, Loader2 } from "lucide-react";
import { DirectionSettings } from "../mission";
import { defaultContributionSettings } from "../../shared/insights";
import type { TaskSetup } from "../app/hooks/useTaskSetup";
import { Modal } from "../modals/Modal";

interface ModelSettingsModalProps {
  setup: TaskSetup;
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
      title="設定貢獻模型"
      subtitle="所有專案共用的 Agent、模型與思考強度，套用到之後建立的任務與專案分析。"
      onClose={closeModal}
    >
      <form onSubmit={(event) => {
        event.preventDefault();
        void saveModelSettings();
      }}>
        {settingsLoading && (
          <p className="field-help" role="status">正在載入模型設定…</p>
        )}
        {!settingsLoading && !settingsReady && (
          <button
            type="button"
            className="save-direction-button"
            onClick={() => void configureContributionModels()}
          >
            重新載入模型設定
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
            關閉
          </button>
          <button
            ref={settingsSaveButton}
            type="submit"
            className="button primary"
            disabled={busy || settingsLoading || !settingsReady}
          >
            {busy ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
            {busy ? "正在儲存…" : "儲存設定"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
