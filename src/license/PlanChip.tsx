import type { LicenseSummary } from "../../shared/plans";
import { useT } from "../i18n";
import { appVersion } from "../version";
import { isPrerelease } from "./useEntitlements";
import "./license.css";

/**
 * The plan as a chip: FREE, PRO or TRIAL · Nd, with BETA beside it in a
 * prerelease build. Nothing for the plan while it is unknown.
 */
export function PlanChip({
  summary,
  version = appVersion,
  beta = true,
}: {
  summary?: LicenseSummary;
  /** The build's version; a prerelease shows BETA. */
  version?: string;
  /** False leaves BETA out, as the license card does. */
  beta?: boolean;
}) {
  const t = useT("license");
  const showBeta = beta && isPrerelease(version);
  if (!summary && !showBeta) return null;
  const days = summary?.trialDaysLeft ?? 0;
  const [text, label] =
    summary?.plan === "pro"
      ? [t.chip.pro, t.chipLabel.pro]
      : summary?.plan === "trial"
        ? [t.chip.trial({ days }), t.chipLabel.trial({ days })]
        : [t.chip.free, t.chipLabel.free];
  return (
    <span className="plan-chips">
      {summary && (
        <span
          className={`plan-chip plan-chip-${summary.plan}`}
          role="img"
          aria-label={label}
          title={label}
        >
          {text}
        </span>
      )}
      {showBeta && (
        <span
          className="beta-chip"
          role="img"
          aria-label={t.chipLabel.beta}
          title={t.chipLabel.beta}
        >
          {t.chip.beta}
        </span>
      )}
    </span>
  );
}
