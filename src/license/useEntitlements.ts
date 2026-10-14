/**
 * The plan in the UI: the license summary from /api/status (or
 * /api/license), the features it unlocks, and the calls that change it.
 *
 * The server decides: locking a control here only saves a request that
 * would answer 402. Every change goes through the helpers below, which send
 * `bellpr:license-changed` so every `useEntitlements` follows at once.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ApiErrorBody } from "../../shared/errors";
import type { ModelSettings } from "../../shared/models";
import {
  freeEntitlements,
  proEntitlements,
  proMaxActiveRuns,
  proOnlyEfforts,
  type Entitlements,
  type LicenseSummary,
  type ProFeature,
} from "../../shared/plans";
import { api, proRequiredEvent, send } from "../api";

/** Window event sent after the license changed; `detail` is the new summary. */
export const licenseChangedEvent = "bellpr:license-changed";
/** Window event sent after "Use Free settings" saved the shared model settings. */
export const modelSettingsChangedEvent = "bellpr:model-settings-changed";

declare global {
  interface WindowEventMap {
    "bellpr:license-changed": CustomEvent<LicenseSummary>;
    "bellpr:model-settings-changed": CustomEvent<ModelSettings>;
  }
}

function announce(summary: LicenseSummary) {
  if (typeof window !== "undefined")
    window.dispatchEvent(
      new CustomEvent<LicenseSummary>(licenseChangedEvent, { detail: summary }),
    );
  return summary;
}

export async function fetchLicense(): Promise<LicenseSummary> {
  return (await api<{ license: LicenseSummary }>("/license")).license;
}

/** Activates a key; rejects with the server's reason (400 license_invalid, 409). */
export async function activateLicense(key: string): Promise<LicenseSummary> {
  const { license } = await api<{ license: LicenseSummary }>(
    "/license",
    send("PUT", { key }),
  );
  return announce(license);
}

/** Removes the saved key (the request carries JSON, as the server requires). */
export async function deactivateLicense(): Promise<LicenseSummary> {
  const { license } = await api<{ license: LicenseSummary }>(
    "/license",
    send("DELETE"),
  );
  return announce(license);
}

/** Starts the 14-day trial; 409 trial_unavailable once it was used. */
export async function startTrial(): Promise<LicenseSummary> {
  const { license } = await api<{ license: LicenseSummary }>(
    "/license/trial",
    send("POST"),
  );
  return announce(license);
}

/**
 * Opens the UpgradeDialog for `feature` without a request, as a locked
 * control does on Free.
 */
export function requestUpgrade(feature?: ProFeature): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ApiErrorBody>(proRequiredEvent, {
      detail: { error: "", code: "pro_required", ...(feature ? { feature } : {}) },
    }),
  );
}

/**
 * "Use Free settings": saves the shared model settings with web access off
 * and a Pro-only effort back to Default; everything else stays.
 */
export async function applyFreeModelSettings(): Promise<ModelSettings> {
  const { settings } = await api<{ settings: ModelSettings }>("/model-settings");
  const proEffort = (proOnlyEfforts as readonly unknown[]).includes(
    settings.reasoningEffort,
  );
  const saved = await api<{ settings: ModelSettings }>(
    "/model-settings",
    send("PUT", {
      ...settings,
      webAccess: false,
      ...(proEffort ? { reasoningEffort: "" } : {}),
    }),
  );
  if (typeof window !== "undefined")
    window.dispatchEvent(
      new CustomEvent<ModelSettings>(modelSettingsChangedEvent, {
        detail: saved.settings,
      }),
    );
  return saved.settings;
}

/**
 * What a plan unlocks, as the UI shows it. Pro and the trial run up to
 * `proMaxActiveRuns`; the server's configured limit applies below that.
 */
export function entitlementsOf(summary: LicenseSummary): Entitlements {
  if (summary.plan === "free") return freeEntitlements;
  return { ...proEntitlements(proMaxActiveRuns), plan: summary.plan };
}

/** True when the version is a prerelease, such as 1.0.0-beta.0. */
export function isPrerelease(version: string) {
  return /^\d+\.\d+\.\d+-/.test(version);
}

export interface EntitlementsState {
  /** The license summary; undefined until it is known. */
  summary?: LicenseSummary;
  /** What the plan unlocks; undefined until the plan is known. */
  entitlements?: Entitlements;
  /**
   * Whether a Pro control is locked: `!features[feature] && !demo`. While
   * the plan is unknown nothing is locked, so Pro users see no flicker;
   * the server still answers 402 when it must.
   */
  locked(feature: ProFeature, opts?: { demo?: boolean }): boolean;
  /** Fetches /api/license again. */
  refresh(): Promise<LicenseSummary | undefined>;
}

/**
 * The plan for the UI. It starts from `status.license` (GET /api/status),
 * follows every change made through this module, and fetches /api/license
 * when the status has no license.
 */
export function useEntitlements(
  status?: { license?: LicenseSummary } | null,
): EntitlementsState {
  const fromStatus = status?.license;
  const [summary, setSummary] = useState<LicenseSummary | undefined>(fromStatus);
  const refresh = useCallback(async () => {
    try {
      const next = await fetchLicense();
      setSummary(next);
      return next;
    } catch {
      // The status keeps what it had; a gated request still answers 402.
      return undefined;
    }
  }, []);
  useEffect(() => {
    if (fromStatus) setSummary(fromStatus);
  }, [fromStatus]);
  // A status without a license (an older server) is completed once.
  const statusLoaded = status != null;
  useEffect(() => {
    if (statusLoaded && !fromStatus) void refresh();
  }, [statusLoaded, fromStatus, refresh]);
  useEffect(() => {
    const changed = (event: CustomEvent<LicenseSummary>) => {
      if (event.detail) setSummary(event.detail);
      else void refresh();
    };
    window.addEventListener(licenseChangedEvent, changed);
    return () => window.removeEventListener(licenseChangedEvent, changed);
  }, [refresh]);
  const entitlements = useMemo(
    () => (summary ? entitlementsOf(summary) : undefined),
    [summary],
  );
  const locked = useCallback(
    (feature: ProFeature, opts: { demo?: boolean } = {}) =>
      entitlements !== undefined && !entitlements.features[feature] && !opts.demo,
    [entitlements],
  );
  return { summary, entitlements, locked, refresh };
}
