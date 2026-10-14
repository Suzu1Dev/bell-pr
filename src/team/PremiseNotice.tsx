import { CircleCheck, CircleHelp, CircleX } from "lucide-react";
import type { PremiseCheck } from "../../shared/team";

const verdicts = {
  holds: { label: "假設成立", icon: CircleCheck },
  refuted: { label: "假設不成立", icon: CircleX },
  unclear: { label: "無法確認假設", icon: CircleHelp },
} as const;

/**
 * The lead's check of the request's assumption, made by reading the
 * repository before planning. Compact keeps the evidence folded, for places
 * read file after file such as the code changes tab.
 */
export function PremiseNotice({
  premise,
  compact = false,
}: {
  premise?: PremiseCheck;
  compact?: boolean;
}) {
  if (!premise) return null;
  const { label, icon: Icon } = verdicts[premise.verdict];
  const heading = (
    <>
      <Icon size={15} aria-hidden="true" />
      <strong>前提查核：{label}</strong>
    </>
  );
  const source = "由 Lead 在規劃前閱讀程式碼得出，可對照引用的位置確認。";
  return (
    <section
      className={`premise-notice premise-${premise.verdict}${compact ? " premise-compact" : ""}`}
      aria-label="前提查核"
    >
      {compact ? (
        <details>
          <summary>
            {heading}
            <span>{premise.statement}</span>
          </summary>
          {premise.evidence && <p>{premise.evidence}</p>}
          <small>{source}</small>
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
