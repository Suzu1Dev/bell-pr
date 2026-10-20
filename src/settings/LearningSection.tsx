import { useCallback, useState } from "react";
import { GraduationCap } from "lucide-react";
import type { LearningCounts } from "../../shared/practice";
import { useT } from "../i18n";
import { useLearningCounts } from "../learning/LearningCounts";
import { Modal } from "../modals/Modal";
import {
  Feedback,
  SettingSwitch,
  SettingsGroup,
  SettingsSectionFrame,
  messageOf,
} from "./controls";
import type { AppSettingsState } from "./useAppSettings";

/** The on/off settings of this section. */
type LearningSetting = "skipUnderstandingCheck" | "hideTryFirst";

/** Timed checks before their median time shows. */
export const medianCheckThreshold = 3;
/** The median covers this many of the latest timed checks. */
const medianWindow = 10;

/**
 * The confirmation before the understanding check turns off. It says what
 * is lost, what stays mandatory, what is recorded and how to go back.
 * **Keep the check** is the dialog's first button, so it has the focus
 * (Modal focuses the first action), and Escape or the close button keep
 * the check too.
 */
export function CheckOffDialog({
  onKeep,
  onTurnOff,
}: {
  onKeep: () => void;
  onTurnOff: () => void;
}) {
  const t = useT("settings").learning.check;
  return (
    <Modal
      title={t.confirmTitle}
      onClose={onKeep}
      mark={<GraduationCap size={23} aria-hidden="true" />}
    >
      <p className="settings-dialog-text">{t.confirmLost}</p>
      <p className="settings-dialog-text">{t.confirmKept}</p>
      <p className="settings-dialog-text">{t.confirmRecorded}</p>
      <p className="settings-dialog-text">{t.confirmBack}</p>
      <div className="modal-actions">
        <button type="button" className="button secondary" onClick={onKeep}>
          {t.keep}
        </button>
        <button
          type="button"
          className="button primary settings-danger-button"
          onClick={onTurnOff}
        >
          {t.turnOff}
        </button>
      </div>
    </Modal>
  );
}

/**
 * The runs approved without the check and, from 3 timed checks on, the
 * median time of the latest ones: the measure of whether the check costs
 * more than its 3-5 minute budget. Both are counted on this computer.
 */
export function CheckCounts({ counts }: { counts: LearningCounts }) {
  const t = useT("settings").learning.counts;
  const { timed, median } = counts.checkSeconds;
  return (
    <div className="settings-learning-counts">
      <ul className="settings-list">
        <li>{t.checkOff({ count: counts.checkOff })}</li>
        {timed >= medianCheckThreshold && median !== undefined && (
          <li>
            {t.median({
              count: Math.min(timed, medianWindow),
              minutes: median / 60,
            })}
          </li>
        )}
      </ul>
      <p className="settings-help">{t.local}</p>
    </div>
  );
}

/**
 * Learning: the understanding check ("Explain it back") with its explicit
 * off-switch, and the try-first prompts during review.
 *
 * Turning the check off takes a confirmation; turning it back on takes
 * none. With BELLPR_REQUIRE_UNDERSTANDING_CHECK=1 the switch is read-only
 * and names the variable, which can only keep the check on. The counts
 * come from GET /api/learning/counts and hide when it fails.
 */
export function LearningSection({ settings }: { settings: AppSettingsState }) {
  const t = useT("settings").learning;
  const view = settings.view;
  const counts = useLearningCounts();
  const [saving, setSaving] = useState<LearningSetting | "">("");
  const [error, setError] = useState<{ key: LearningSetting; message: string }>();
  const [confirming, setConfirming] = useState(false);
  const { save: saveSettings } = settings;
  const checkLock = view?.lockedBy.skipUnderstandingCheck;

  const save = useCallback(
    async (key: LearningSetting, value: boolean) => {
      setSaving(key);
      setError(undefined);
      try {
        await saveSettings({ [key]: value });
      } catch (failure) {
        setError({ key, message: messageOf(failure) });
      } finally {
        setSaving("");
      }
    },
    [saveSettings],
  );
  const keep = useCallback(() => setConfirming(false), []);

  return (
    <SettingsSectionFrame section="learning" title={t.title} intro={t.intro}>
      <SettingsGroup title={t.check.title} text={t.check.text}>
        <SettingSwitch
          label={t.check.label}
          help={t.check.help}
          checked={view?.settings.skipUnderstandingCheck !== true}
          loading={!view}
          saving={saving === "skipUnderstandingCheck"}
          lockedBy={checkLock}
          lockedHint={checkLock ? t.check.lockedBy({ variable: checkLock }) : undefined}
          onChange={(checked) => {
            if (checked) void save("skipUnderstandingCheck", false);
            else setConfirming(true);
          }}
        />
        {confirming && (
          <CheckOffDialog
            onKeep={keep}
            onTurnOff={() => {
              setConfirming(false);
              void save("skipUnderstandingCheck", true);
            }}
          />
        )}
        <Feedback
          error={error?.key === "skipUnderstandingCheck" ? error.message : ""}
        />
        {counts && <CheckCounts counts={counts} />}
      </SettingsGroup>
      <SettingsGroup title={t.tryFirst.title}>
        <SettingSwitch
          label={t.tryFirst.label}
          help={t.tryFirst.help}
          checked={view?.settings.hideTryFirst !== true}
          loading={!view}
          saving={saving === "hideTryFirst"}
          lockedBy={view?.lockedBy.hideTryFirst}
          onChange={(checked) => void save("hideTryFirst", !checked)}
        />
        <Feedback error={error?.key === "hideTryFirst" ? error.message : ""} />
      </SettingsGroup>
    </SettingsSectionFrame>
  );
}
