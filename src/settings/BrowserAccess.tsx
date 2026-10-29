import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { api, endBrowserSession, updateBrowserSession } from "../api";
import { useT } from "../i18n";
import { Modal } from "../modals/Modal";
import { Feedback, SettingSwitch, SettingsGroup, messageOf, reloadPage } from "./controls";

interface BrowserSession {
  remembered: boolean;
}

/** Browser sign-in is separate from the workspace's shared settings. */
export function BrowserAccess({ reload = reloadPage }: { reload?: () => void }) {
  const t = useT("settings");
  const b = t.general.browserAccess;
  const [session, setSession] = useState<BrowserSession | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void api<BrowserSession>("/session", { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setSession(value);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(messageOf(failure));
      });
    return () => controller.abort();
  }, [attempt]);

  const remember = async (checked: boolean) => {
    if (busy) return;
    setBusy(true);
    setSaved(false);
    setError("");
    try {
      const value = await updateBrowserSession(checked);
      setSession(value);
      setSaved(true);
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };

  const signOut = async (all: boolean) => {
    if (busy) return;
    setBusy(true);
    setSaved(false);
    setError("");
    setConfirming(false);
    try {
      await endBrowserSession(all);
      reload();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsGroup title={b.title} text={b.text}>
      <SettingSwitch
        label={b.remember}
        help={b.rememberHelp}
        checked={session?.remembered === true}
        loading={!session}
        saving={busy}
        onChange={(checked) => void remember(checked)}
      />
      <Feedback
        message={!session && !error ? t.state.loading : saved ? t.state.saved : ""}
        error={error}
      />
      {!session && error && (
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            setError("");
            setAttempt((value) => value + 1);
          }}
        >
          {t.state.retry}
        </button>
      )}
      <div className="settings-field" aria-busy={busy || undefined}>
        <div className="settings-actions">
          <button
            type="button"
            className="button secondary"
            disabled={!session || busy}
            onClick={() => void signOut(false)}
          >
            {b.signOut}
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={!session || busy}
            onClick={() => setConfirming(true)}
          >
            {b.revoke}
          </button>
        </div>
        <p className="settings-help">{b.signOutHelp}</p>
      </div>
      {confirming && (
        <Modal
          title={b.confirmTitle}
          onClose={() => setConfirming(false)}
          mark={<ShieldCheck size={23} aria-hidden="true" />}
        >
          <p className="settings-dialog-text">{b.confirmText}</p>
          <p className="settings-dialog-text">{b.confirmBack}</p>
          <p className="settings-dialog-text">{b.signOutHelp}</p>
          <div className="modal-actions">
            <button type="button" className="button secondary" onClick={() => setConfirming(false)}>
              {t.state.cancel}
            </button>
            <button
              type="button"
              className="button primary settings-danger-button"
              onClick={() => void signOut(true)}
            >
              {b.confirm}
            </button>
          </div>
        </Modal>
      )}
    </SettingsGroup>
  );
}
