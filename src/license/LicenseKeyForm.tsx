import { useId, useState, type FormEvent } from "react";
import type { LicenseSummary } from "../../shared/plans";
import { useT } from "../i18n";
import { activateLicense } from "./useEntitlements";
import "./license.css";

/** A license key field with its Activate button; the server checks the key. */
export function LicenseKeyForm({
  onActivated,
}: {
  onActivated?: (summary: LicenseSummary) => void;
}) {
  const t = useT("license").key;
  const id = useId();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const summary = await activateLicense(key);
      setKey("");
      onActivated?.(summary);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="license-key-form" onSubmit={submit}>
      <label className="field-label" htmlFor={id}>
        {t.label}
      </label>
      <textarea
        id={id}
        className="text-input license-key-input"
        rows={3}
        value={key}
        placeholder={t.placeholder}
        spellCheck={false}
        autoComplete="off"
        aria-describedby={`${id}-help`}
        aria-invalid={error ? true : undefined}
        onChange={(event) => setKey(event.target.value)}
      />
      <p id={`${id}-help`} className="field-help">
        {t.help}
      </p>
      {error && (
        <p className="license-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="button primary"
        type="submit"
        disabled={busy || !key.trim()}
      >
        {busy ? t.activating : t.activate}
      </button>
    </form>
  );
}
