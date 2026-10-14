import { useEffect, useState } from "react";
import type { ApiErrorBody } from "../../shared/errors";
import {
  planFeatureTable,
  trialDays,
  type LicenseSummary,
  type ProFeature,
} from "../../shared/plans";
import { productLink } from "../../shared/product";
import { proRequiredEvent } from "../api";
import { useT } from "../i18n";
import { Modal } from "../modals/Modal";
import { LicenseKeyForm } from "./LicenseKeyForm";
import { ProBadge } from "./ProBadge";
import {
  applyFreeModelSettings,
  fetchLicense,
  startTrial,
} from "./useEntitlements";
import "./license.css";

/** Features a person can drop to stay on Free: model settings only. */
const freeSettingsFeatures: readonly ProFeature[] = ["webAccess", "deepReasoning"];

/**
 * Explains a Pro feature and offers the ways to Pro. Mount it once: it
 * opens on every `bellpr:pro-required` event, which the API client sends
 * on a 402 and `requestUpgrade(feature)` sends for a locked control.
 *
 * It shows the feature that triggered it among the Pro rows of the plan
 * table, "Enter license key" and "Start 14-day trial" when this data
 * directory can, "Buy Pro" only while `purchaseUrl` is set ("Purchasing
 * opens soon" with a pricing link when only `pricingUrl` is), and "Use Free
 * settings" for web access and deep reasoning. In the demo nothing is sent
 * to the server.
 */
export function UpgradeDialog({
  demo = false,
  summary: given,
  initialRequest = null,
  onFreeSettingsApplied,
}: {
  demo?: boolean;
  /** The license, when the parent has it; otherwise it is fetched on open. */
  summary?: LicenseSummary;
  /** Opens the dialog at once with this 402 body. */
  initialRequest?: ApiErrorBody | null;
  onFreeSettingsApplied?: () => void;
}) {
  const t = useT("license");
  const [request, setRequest] = useState<ApiErrorBody | null>(initialRequest);
  const [fetched, setFetched] = useState<LicenseSummary>();
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  useEffect(() => {
    const open = (event: CustomEvent<ApiErrorBody>) => {
      setRequest(event.detail ?? { error: "" });
      setShowKey(false);
      setError("");
      setDone("");
    };
    window.addEventListener(proRequiredEvent, open);
    return () => window.removeEventListener(proRequiredEvent, open);
  }, []);
  const isOpen = request !== null;
  useEffect(() => {
    if (!isOpen || demo || given) return;
    let cancelled = false;
    fetchLicense()
      .then((summary) => {
        if (!cancelled) setFetched(summary);
      })
      .catch(() => {
        // Without the state the dialog offers only what needs none.
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, demo, given]);
  if (!request) return null;

  const summary = given ?? fetched;
  const close = () => setRequest(null);
  const feature = request.feature;
  const triggered = planFeatureTable.find(
    (row) => feature !== undefined && row.feature === feature,
  );
  const subtitle =
    request.error ||
    (triggered?.feature
      ? t.upgrade.featureNeedsPro[triggered.feature]
      : t.upgrade.general);
  // Free has these with a smaller limit: say what Pro allows.
  const proLimits: Partial<Record<ProFeature, string>> = t.upgrade.proLimits;
  // The rows a Pro feature gates; the license term row is not a feature.
  const proRows = planFeatureTable.filter((row) => row.feature !== undefined);
  const purchaseUrl = productLink("purchaseUrl");
  const pricingUrl = productLink("pricingUrl");
  const canChange = !demo && summary?.envLocked !== true;
  const trialAvailable = canChange && summary?.trialAvailable === true;
  const freeSettings =
    !demo && feature !== undefined && freeSettingsFeatures.includes(feature);
  const act = async (action: () => Promise<string>) => {
    setBusy(true);
    setError("");
    try {
      setDone(await action());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t.upgrade.title} subtitle={subtitle} onClose={close} wide>
      {done ? (
        <>
          <p className="license-notice" role="status">
            {done}
          </p>
          <div className="modal-actions">
            <button className="button primary" type="button" onClick={close}>
              {t.upgrade.close}
            </button>
          </div>
        </>
      ) : (
        <>
          <h3 className="upgrade-list-title">{t.upgrade.proList}</h3>
          <ul className="upgrade-features">
            {proRows.map((row) => (
              <li
                key={row.id}
                className={
                  row === triggered ? "upgrade-feature current" : "upgrade-feature"
                }
              >
                <ProBadge />
                <span>{t.plans.features[row.id].label}</span>
                {row.feature && proLimits[row.feature] && (
                  <span className="upgrade-feature-limit">{proLimits[row.feature]}</span>
                )}
                {row === triggered && (
                  <span className="upgrade-feature-tag">{t.upgrade.thisFeature}</span>
                )}
              </li>
            ))}
          </ul>
          {summary?.envLocked && <p className="field-help">{t.upgrade.envLocked}</p>}
          {trialAvailable && <p className="field-help">{t.upgrade.trialHint}</p>}
          {freeSettings && <p className="field-help">{t.upgrade.freeSettingsHint}</p>}
          {!purchaseUrl && pricingUrl && (
            <p className="field-help">
              {t.upgrade.purchasingSoon}{" "}
              <a href={pricingUrl} target="_blank" rel="noreferrer">
                {t.upgrade.seePricing}
              </a>
            </p>
          )}
          {showKey && canChange && (
            <LicenseKeyForm onActivated={() => setDone(t.upgrade.activated)} />
          )}
          {error && (
            <p className="license-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions upgrade-actions">
            <button className="button secondary" type="button" onClick={close}>
              {t.upgrade.notNow}
            </button>
            {freeSettings && (
              <button
                className="button secondary"
                type="button"
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    await applyFreeModelSettings();
                    onFreeSettingsApplied?.();
                    return t.upgrade.freeSettingsApplied;
                  })
                }
              >
                {t.upgrade.useFreeSettings}
              </button>
            )}
            {canChange && !showKey && (
              <button
                className="button secondary"
                type="button"
                onClick={() => setShowKey(true)}
              >
                {t.upgrade.enterKey}
              </button>
            )}
            {trialAvailable && (
              <button
                className="button primary"
                type="button"
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    const next = await startTrial();
                    return t.upgrade.trialStarted({ days: next.trialDaysLeft ?? trialDays });
                  })
                }
              >
                {t.upgrade.startTrial}
              </button>
            )}
            {purchaseUrl && (
              <a
                className="button primary"
                href={purchaseUrl}
                target="_blank"
                rel="noreferrer"
              >
                {t.upgrade.buy}
              </a>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
