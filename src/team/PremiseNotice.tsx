import { CircleCheck, CircleHelp, CircleX } from "lucide-react";
import type { PremiseCheck, PremiseVerdict } from "../../shared/team";
import { useT } from "../i18n";
import "./team.css";

const icons = {
  holds: CircleCheck,
  refuted: CircleX,
  unclear: CircleHelp,
} as const satisfies Record<PremiseVerdict, unknown>;

/** A verdict word this build knows; a later build's word reads as unclear. */
export function knownVerdict(verdict: string): PremiseVerdict {
  return Object.hasOwn(icons, verdict) ? (verdict as PremiseVerdict) : "unclear";
}

/**
 * The lead's check of the request's assumption, made by reading the
 * repository. Compact keeps the evidence folded under a one-line summary,
 * for places read file after file such as the code changes tab.
 */
export function PremiseNotice({
  premise,
  compact = false,
}: {
  premise?: PremiseCheck;
  compact?: boolean;
}) {
  const t = useT("team").premise;
  if (!premise) return null;
  const verdict = knownVerdict(premise.verdict);
  const Icon = icons[verdict];
  const heading = (
    <>
      <Icon size={15} aria-hidden="true" />
      <strong>{t.heading({ verdict: t.verdicts[verdict] })}</strong>
    </>
  );
  return (
    <section
      className={`premise-notice premise-${verdict}${compact ? " premise-compact" : ""}`}
      aria-label={t.label}
    >
      {compact ? (
        <details>
          <summary>
            {heading}
            <span>{premise.statement}</span>
          </summary>
          {premise.evidence && <p>{premise.evidence}</p>}
          <small>{t.source}</small>
        </details>
      ) : (
        <>
          <h3>{heading}</h3>
          <p className="premise-statement">{premise.statement}</p>
          {premise.evidence && <p>{premise.evidence}</p>}
          <small>{t.source}</small>
        </>
      )}
    </section>
  );
}
