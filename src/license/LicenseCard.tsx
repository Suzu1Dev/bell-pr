import { useId, useState } from "react";
import { licenseGraceDays, type LicenseSummary } from "../../shared/plans";
import { productLink } from "../../shared/product";
import { useFormat, useT } from "../i18n";
import { LicenseKeyForm } from "./LicenseKeyForm";
import { PlanChip } from "./PlanChip";
import {
  deactivateLicense,
  startTrial,
  useEntitlements,
} from "./useEntitlements";
import "./license.css";

const dayMs = 24 * 60 * 60 * 1000;
const unmasked = (value: string) => value;

/**
 * The license section of Settings: the plan, the licensee (only what the key
 * carries; pool keys have no name or e-mail), expiry, updates and trial
 * days, and the controls to activate a key, remove it or start the trial.
 * With BELLPR_LICENSE_KEY set it is read-only and says so.
 */
export function LicenseCard({
  status,
  maskUser = unmasked,
}: {
  /** GET /api/status, or anything with the license summary. */
  status?: { license?: LicenseSummary } | null;
  /** Masks the licensee's name and e-mail, as presentation mode does. */
  maskUser?: (value: string) => string;
  /**
   * Masks file paths, like the other settings sections take it. The card
   * shows no path today; the prop keeps the masking props the same.
   */
  maskPath?: (value: string) => string;
}) {
  const t = useT("license");
  const fmt = useFormat();
  const titleId = useId();
  const { summary } = useEntitlements(status);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState("");
  const date = (value: string | number) => fmt.date(value, { timeZone: "UTC" });
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
      setConfirmRemove(false);
    }
  };

  let statusLine = "";
  if (summary?.plan === "pro")
    statusLine =
      summary.status === "grace" && summary.expiresAt
        ? t.card.status.grace({
            date: date(Date.parse(summary.expiresAt) + licenseGraceDays * dayMs),
          })
        : t.card.status.pro;
  else if (summary?.plan === "trial")
    statusLine = t.card.status.trial({ days: summary.trialDaysLeft ?? 0 });
  else if (summary) statusLine = t.card.reasons[summary.reason ?? "no_license"];
  const purchaseUrl = productLink("purchaseUrl");

  return (
    <section className="license-card" aria-labelledby={titleId}>
      <div className="license-card-head">
        <h3 id={titleId}>{t.card.title}</h3>
        <PlanChip summary={summary} beta={false} />
      </div>
      {!summary ? (
        <p className="field-help" role="status">
          {t.card.checking}
        </p>
      ) : (
        <>
          <p className="license-status">{statusLine}</p>
          {summary.licenseId && (
            <dl className="license-details">
              <div>
                <dt>{t.card.licenseId}</dt>
                <dd>
                  <code>{summary.licenseId}</code>
                </dd>
              </div>
              {(summary.name || summary.email) && (
                <div>
                  <dt>{t.card.licensee}</dt>
                  <dd>
                    {summary.name && <span>{maskUser(summary.name)}</span>}
                    {summary.email && (
                      <span className="license-email">{maskUser(summary.email)}</span>
                    )}
                  </dd>
                </div>
              )}
              <div>
                <dt>{t.card.expires}</dt>
                <dd>{summary.expiresAt ? date(summary.expiresAt) : t.card.never}</dd>
              </div>
              {summary.updatesUntil && (
                <div>
                  <dt>{t.card.updatesUntil}</dt>
                  <dd>
                    {date(summary.updatesUntil)}
                    <span className="field-help">{t.card.updatesHint}</span>
                  </dd>
                </div>
              )}
            </dl>
          )}
          {summary.envLocked ? (
            <p className="license-env">
              <span className="license-env-badge">{t.card.setByEnvironment}</span>
              {t.card.envHint}
            </p>
          ) : (
            <div className="license-controls">
              {summary.plan !== "pro" && <LicenseKeyForm />}
              <div className="license-actions">
                {summary.plan === "free" && summary.trialAvailable && (
                  <button
                    className="button secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => act(startTrial)}
                  >
                    {t.card.startTrial}
                  </button>
                )}
                {summary.plan !== "pro" && purchaseUrl && (
                  <a
                    className="button secondary"
                    href={purchaseUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t.card.buy}
                  </a>
                )}
                {summary.source === "file" && !confirmRemove && (
                  <button
                    className="button secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmRemove(true)}
                  >
                    {t.card.remove}
                  </button>
                )}
              </div>
              {summary.source === "file" && confirmRemove && (
                <div className="license-confirm" role="group" aria-label={t.card.remove}>
                  <p>{t.card.removeConfirm}</p>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => setConfirmRemove(false)}
                  >
                    {t.card.cancel}
                  </button>
                  <button
                    className="button primary"
                    type="button"
                    disabled={busy}
                    onClick={() => act(deactivateLicense)}
                  >
                    {t.card.removeYes}
                  </button>
                </div>
              )}
            </div>
          )}
          {error && (
            <p className="license-error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}
