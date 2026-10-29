import { useEffect, useState } from "react";
import { api, send } from "../api";
import { useT } from "../i18n";
import "./permissions.css";
import type { SudoStatus } from "../../shared/sudo";

interface SudoResponse {
  sudo: SudoStatus;
}

export interface SudoAccessViewProps {
  id: string;
  status?: SudoStatus;
  loadError?: string;
  password: string;
  busy: boolean;
  error?: string;
  onPasswordChange: (value: string) => void;
  onEnable: () => void;
  onDisable: () => void;
}

/** Shows what the person can do for each passwordless-sudo state. */
export function SudoAccessView({
  id,
  status,
  loadError,
  password,
  busy,
  error,
  onPasswordChange,
  onEnable,
  onDisable,
}: SudoAccessViewProps) {
  const t = useT("permissions");
  const passwordId = `${id}-sudo-password`;
  const helpId = `${id}-sudo-help`;
  const user = status?.user ?? "";
  return (
    <div className="mission-form-field sudo-access">
      <strong>{t.sudoTitle}</strong>
      {loadError ? (
        <p className="mission-field-note" role="status">
          {t.loadFailed({ message: loadError })}
        </p>
      ) : !status ? (
        <p className="mission-field-note" role="status">
          {t.loading}
        </p>
      ) : !status.available ? (
        <p className="mission-field-note">{t.unavailable}</p>
      ) : status.passwordless ? (
        status.installed ? (
          <>
            <p className="mission-field-note">
              {t.installed({ user })}
            </p>
            <button type="button" onClick={onDisable} disabled={busy}>
              {busy ? t.removing : t.remove}
            </button>
          </>
        ) : (
          <p className="mission-field-note">
            {t.external({ user })}
          </p>
        )
      ) : (
        <>
          <label htmlFor={passwordId}>{t.password({ user })}</label>
          <input
            id={passwordId}
            type="password"
            value={password}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={helpId}
            onChange={(event) => onPasswordChange(event.target.value)}
            onKeyDown={(event) => {
              // Enter must not submit the settings form this panel sits in.
              if (event.key !== "Enter") return;
              event.preventDefault();
              if (password && !busy) onEnable();
            }}
          />
          <button type="button" onClick={onEnable} disabled={!password || busy}>
            {busy ? t.enabling : t.enable}
          </button>
          <p id={helpId} className="mission-field-note">
            {t.help({ user })}
          </p>
        </>
      )}
      {error && (
        <p className="mission-field-note" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Loads sudo status and performs the enable and remove requests. */
export function SudoAccess({ id }: { id: string }) {
  const t = useT("permissions");
  const [status, setStatus] = useState<SudoStatus>();
  const [loadError, setLoadError] = useState<string>();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    api<SudoResponse>("/system/sudo").then(
      (result) => {
        if (!cancelled) setStatus(result.sudo);
      },
      (failure: Error) => {
        if (!cancelled) setLoadError(failure.message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  async function change(options: RequestInit) {
    setBusy(true);
    setError(undefined);
    try {
      const result = await api<SudoResponse>("/system/sudo", options);
      setStatus(result.sudo);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SudoAccessView
      id={id}
      status={status}
      loadError={loadError}
      password={password}
      busy={busy}
      error={error}
      onPasswordChange={setPassword}
      onEnable={() => {
        const submitted = password;
        // Cleared before the request so the password is not kept in state after submit.
        setPassword("");
        void change(send("POST", { password: submitted }));
      }}
      onDisable={() => void change(send("DELETE"))}
    />
  );
}
