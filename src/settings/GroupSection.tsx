import { useCallback, useState } from "react";
import type { CollabStatus } from "../../shared/collab";
import { currentApiToken } from "../api";
import { useT } from "../i18n";
import {
  Feedback,
  SettingSwitch,
  SettingsGroup,
  SettingsSectionFrame,
  StatusChip,
  messageOf,
} from "./controls";
import type { AppSettingsState } from "./useAppSettings";

/**
 * BELL PR Group: turns live team coordination on or off for this BELL PR
 * host, saves the preference in app-settings.json so restarts keep it, and
 * links directly to the Group board (#/group) and paired-device controls.
 */
export function GroupSection({
  settings,
  collab,
  groupHref,
  generalHref,
  onSaved,
}: {
  settings: AppSettingsState;
  collab?: CollabStatus;
  groupHref: string;
  generalHref: string;
  onSaved: () => void;
}) {
  const g = useT("settings").group;
  const view = settings.view;
  const [pairedDevice] = useState(() => currentApiToken()?.startsWith("bpd_") === true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const { save: saveSettings } = settings;
  const lockedBy = view?.lockedBy.groupWork;
  const enabled = Boolean(view?.settings.groupWork || collab);

  const toggle = useCallback(
    async (checked: boolean) => {
      setSaving(true);
      setMessage("");
      setError("");
      try {
        await saveSettings({ groupWork: checked });
        onSaved();
        setMessage(checked ? g.turnedOn : g.turnedOff);
      } catch (failure) {
        setError(messageOf(failure));
      } finally {
        setSaving(false);
      }
    },
    [saveSettings, onSaved, g.turnedOn, g.turnedOff],
  );

  const statusText = !enabled
    ? g.status.off
    : collab?.state === "ready"
      ? g.status.ready
      : collab?.state === "stopped"
        ? g.status.stopped
        : g.status.notSetUp;
  const statusGood = enabled && collab?.state !== "stopped";

  return (
    <SettingsSectionFrame section="group" title={g.title} intro={g.intro}>
      <SettingsGroup
        title={g.cardTitle}
        text={g.cardText}
        aside={<StatusChip text={statusText} good={statusGood} />}
      >
        <SettingSwitch
          label={g.label}
          help={g.help}
          checked={enabled}
          loading={!view}
          disabled={pairedDevice}
          saving={saving}
          lockedBy={lockedBy}
          lockedHint={lockedBy === "--group" ? g.flagHint : undefined}
          onChange={(checked) => void toggle(checked)}
        />
        {pairedDevice && !lockedBy && <p className="settings-help">{g.hostOnly}</p>}
        <Feedback message={message} error={error} />
        {enabled && (
          <div className="settings-actions">
            <a className="button primary" href={groupHref}>
              {g.openBoard}
            </a>
          </div>
        )}
      </SettingsGroup>
      <SettingsGroup title={g.how.title} text={g.how.intro}>
        <ul className="settings-list">
          <li>{g.how.holds}</li>
          <li>{g.how.guards}</li>
          <li>{g.how.devices}</li>
        </ul>
        <a className="settings-link" href={generalHref}>
          {g.how.openDevices}
        </a>
      </SettingsGroup>
    </SettingsSectionFrame>
  );
}
