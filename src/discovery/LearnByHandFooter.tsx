import { safeLink, WebLink } from "../review/MarkdownContent";
import { ArrowUpRight, Hand, Loader2 } from "lucide-react";
import type { ContributionOpportunity } from "../../shared/discovery";
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
  const { card: t, byHand } = useT("discovery");
  const reserved = item.byHandReserved === true && item.byHandReservedOutput !== true;
  // The evidence quote the reservation comes from, as the server marked it.
  const quote = reserved ? item.byHandReservedQuote : undefined;
  return (
    <footer>
      <div className="by-hand">
        <p>{t.learnByHandHint}</p>
        {(reserved || item.byHandReservedOutput) && (
          <p className="by-hand-note">{reserved ? byHand.area({ reach: "use", condition: "" }) : t.reservedOutput}</p>
        )}
        {quote && <blockquote>{quote}</blockquote>}
      </div>
      {issueLink && (
        <WebLink className="button secondary" href={safeLink(issueLink) || undefined} target="_blank" rel="noreferrer">
          {t.openIssue}
          <ArrowUpRight size={16} aria-hidden="true" />
        </WebLink>
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
