/**
 * The plan as the mission and discovery screens see it: what the license
 * unlocks, which Pro controls are locked, and which carry the PRO chip.
 *
 * A screen whose parent passes the plan in (entitlements or the license
 * summary) asks for nothing; otherwise it reads GET /api/license once when
 * it mounts and follows every change made through `src/license`. The server
 * still decides: locking a control only saves a request that would answer
 * 402.
 */
import { useEffect, useState } from "react";
import type {
  Entitlements,
  LicenseSummary,
  ProFeature,
} from "../../shared/plans";
import { entitlementsOf, useEntitlements } from "../license/useEntitlements";

export interface PlanOptions {
  /** What the plan unlocks, when the parent knows it. */
  entitlements?: Entitlements;
  /** The license summary (GET /api/status), when the parent has it. */
  license?: LicenseSummary;
  /**
   * The sample project: every Pro control is unlocked and marked PRO, and
   * nothing is read from the server.
   */
  demo?: boolean;
  /** False reads nothing, for a screen that is told what it needs. */
  read?: boolean;
}

export interface PlanState {
  /** What the plan unlocks; undefined while it is unknown. */
  entitlements?: Entitlements;
  /** The license summary, when known. */
  summary?: LicenseSummary;
  /** True while the license is being read for the first time. */
  checking: boolean;
  demo: boolean;
  /**
   * Whether a Pro control is locked: `!features[feature] && !demo`. Nothing
   * is locked while the plan is unknown, so Pro sees no flicker.
   */
  locked(feature: ProFeature): boolean;
  /** Whether a Pro control shows the PRO chip: it is locked, or in the demo. */
  marked(feature: ProFeature): boolean;
}

export function usePlan({
  entitlements,
  license,
  demo = false,
  read = true,
}: PlanOptions = {}): PlanState {
  const given = entitlements !== undefined || license !== undefined;
  const fetches = read && !given && !demo;
  // Without a status it fetches nothing itself; it follows license changes.
  const own = useEntitlements(undefined);
  const { refresh } = own;
  const [checking, setChecking] = useState(fetches);
  useEffect(() => {
    if (!fetches) {
      setChecking(false);
      return;
    }
    let live = true;
    setChecking(true);
    void refresh().finally(() => {
      if (live) setChecking(false);
    });
    return () => {
      live = false;
    };
  }, [fetches, refresh]);
  const known =
    entitlements ?? (license ? entitlementsOf(license) : own.entitlements);
  const locked = (feature: ProFeature) =>
    !demo && known !== undefined && !known.features[feature];
  return {
    entitlements: known,
    summary: license ?? own.summary,
    checking: fetches && checking && !known,
    demo,
    locked,
    marked: (feature) => demo || locked(feature),
  };
}
