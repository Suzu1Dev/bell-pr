import { useEffect, useRef, useState } from "react";
import { ExternalLink, ScrollText } from "lucide-react";
import type { AppSettingsView } from "../../shared/app-settings";
import { eulaVersion, productLink } from "../../shared/product";
import { api, send } from "../api";
import { useT } from "../i18n";
import "./onboarding.css";

/**
 * Asks again for the license agreement when onboarding is done but this
 * build's `eulaVersion` was not accepted. It blocks the app (the shell
 * behind it is inert): it cannot be closed, and the only ways on are
 * accepting, which saves `eulaAcceptedVersion`, and the documentation.
 */
export function EulaPrompt({
  onAccepted,
}: {
  /** Called with the saved settings once the acceptance is stored. */
  onAccepted: (view: AppSettingsView) => void;
}) {
  const t = useT("onboarding");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const docsUrl = productLink("docsUrl");

  useEffect(() => {
    heading.current?.focus();
    // Tab stays inside the prompt; Escape does not close it.
    const keep = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const nodes = panel.current?.querySelectorAll<HTMLElement>(
        "a[href], button:not(:disabled)",
      );
      if (!nodes?.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const inside = panel.current?.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keep);
    return () => document.removeEventListener("keydown", keep);
  }, []);

  const accept = async () => {
    setBusy(true);
    setError("");
    try {
      const view = await api<AppSettingsView>(
        "/app-settings",
        send("PUT", { eulaAcceptedVersion: eulaVersion }),
      );
      onAccepted(view);
    } catch (cause) {
      setError(
        t.license.saveFailed({
          message: cause instanceof Error ? cause.message : String(cause),
        }),
      );
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop eula-prompt-backdrop">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="eula-prompt-title"
        aria-describedby="eula-prompt-text"
        className="modal modal-wide eula-prompt"
      >
        <div className="modal-mark">
          <ScrollText size={23} aria-hidden="true" />
        </div>
        <h2 id="eula-prompt-title" ref={heading} tabIndex={-1}>
          {t.eulaPrompt.title}
        </h2>
        <p id="eula-prompt-text" className="modal-subtitle">
          {t.eulaPrompt.text({ version: eulaVersion })}
        </p>
        <ul className="welcome-summary">
          {t.license.summary.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="welcome-note">{t.license.notice}</p>
        <div className="welcome-license-links">
          <a href="/legal/EULA.txt" target="_blank" rel="noreferrer">
            {t.license.read}
            <ExternalLink size={14} aria-hidden="true" />
          </a>
          <span>{t.license.version({ version: eulaVersion })}</span>
          {docsUrl && (
            <a href={docsUrl} target="_blank" rel="noreferrer">
              {t.eulaPrompt.docs}
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          )}
        </div>
        {error && (
          <p className="welcome-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="button primary"
            disabled={busy}
            onClick={() => void accept()}
          >
            {busy ? t.eulaPrompt.accepting : t.eulaPrompt.accept}
          </button>
        </div>
      </div>
    </div>
  );
}
