import { ArrowUpRight, Hand, Loader2 } from "lucide-react";
import type { ContributionOpportunity } from "../../shared/discovery";
import { classifyPolicy } from "../../shared/project-policy";
import { useT } from "../i18n";

/**
 * The footer of a newcomer-issue card (DESIGN v1.2 F1, F12): "Start
 * learning by hand" next to "Open the issue". Where the project keeps such
 * issues for people learning without AI tools ("use" wording, or BELL
 * can't tell), the button is never offered: the card says BELL won't
 * publish a learn-by-hand run there and quotes the rule. Where the rule is
 * about AI-generated pull requests, the button stays with a warning; the
 * task dialog then shows the project's case.
 */
export function LearnByHandFooter({
  item,
  issueLink,
  choosing,
  disabled,
  onStart,
}: {
  item: ContributionOpportunity;
  issueLink?: string;
  /** This card's project is being imported. */
  choosing: boolean;
  disabled: boolean;
  onStart(): void;
}) {
  const t = useT("discovery").card;
  const reserved = item.byHandReserved === true && item.byHandReservedOutput !== true;
  // The evidence quote the reservation comes from, by the same classifier.
  const quote = reserved
    ? item.evidence.find((evidence) =>
        classifyPolicy("discovery", evidence.quote).some((finding) => finding.kind === "area"),
      )?.quote
    : undefined;
  return (
    <footer>
      <div className="by-hand">
        <p>{t.learnByHandHint}</p>
        {(reserved || item.byHandReservedOutput) && (
          <p className="by-hand-note">{reserved ? t.reservedUse : t.reservedOutput}</p>
        )}
        {quote && <blockquote>{quote}</blockquote>}
      </div>
      {issueLink && (
        <a className="button secondary" href={issueLink} target="_blank" rel="noreferrer">
          {t.openIssue}
          <ArrowUpRight size={16} aria-hidden="true" />
        </a>
      )}
      {!reserved && (
        <button type="button" className="button primary" disabled={disabled} onClick={onStart}>
          {choosing ? <Loader2 className="spin" size={16} /> : <Hand size={16} aria-hidden="true" />}
          {choosing ? t.importing : t.startByHand}
        </button>
      )}
    </footer>
  );
}
