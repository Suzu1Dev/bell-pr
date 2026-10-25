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
 * repository (in a Learn-by-hand run, `guide`: the guide's). Compact keeps
 * the evidence folded under a one-line summary, for places read file after
 * file such as the code changes tab.
 */
export function PremiseNotice({
  premise,
  compact = false,
  guide = false,
}: {
  premise?: PremiseCheck;
  compact?: boolean;
  guide?: boolean;
}) {
  const t = useT("workspace").premise;
  if (!premise) return null;
  const source = guide ? t.sourceGuide : t.source;
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
        // Open, the evidence lies over the code, so it folds again when focus
        // moves on or on Escape: it never hides the control that has the focus.
        <details
          onKeyDown={(event) => {
            const details = event.currentTarget;
            if (event.key !== "Escape" || !details.open) return;
            // Handled here, so the page's Escape does not also leave focus mode.
            event.stopPropagation();
            details.open = false;
            details.querySelector("summary")?.focus();
          }}
          onBlur={(event) => {
            const details = event.currentTarget;
            // Leaving the window keeps it open: the reader may be checking the cited lines.
            if (!details.ownerDocument.hasFocus()) return;
            const next = event.relatedTarget as Element | null;
            if (details.contains(next)) return;
            // A dialog over the page (help, command palette) gives the focus back here when it closes.
            if (next?.closest('[aria-modal="true"], dialog[open]')) return;
            details.open = false;
          }}
        >
          <summary>
            {heading}
            <span>{premise.statement}</span>
          </summary>
          <div className="premise-detail" role="region" tabIndex={0} aria-label={t.detailLabel}>
            <p className="premise-statement">{premise.statement}</p>
            {premise.evidence && <p>{premise.evidence}</p>}
            <small>{source}</small>
          </div>
        </details>
      ) : (
        <>
          <h3>{heading}</h3>
          <p className="premise-statement">{premise.statement}</p>
          {premise.evidence && <p>{premise.evidence}</p>}
          <small>{source}</small>
        </>
      )}
    </section>
  );
}
