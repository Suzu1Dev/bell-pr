import { ExternalLink, GitCommitHorizontal, Undo2 } from "lucide-react";
import type { FollowUpRound } from "../../shared/followups";
import type { PrFeedbackItem } from "../../shared/pr-feedback";
import { useFormat, useT } from "../i18n";
import { rich } from "./rich";

interface Props {
  rounds: FollowUpRound[];
  /** owner/name the PR branch lives in, for commit links. */
  headRepository?: string;
  /** The latest feedback read, to show what each round was asked to address. */
  feedback?: PrFeedbackItem[];
  /** Shown on the round still waiting for review; never on a running or pushed one. */
  onDiscard?: () => void;
  busy?: boolean;
}

/** Rounds of changes made after maintainer review, newest first. */
export function FollowUpRounds({
  rounds,
  headRepository,
  feedback = [],
  onDiscard,
  busy = false,
}: Props) {
  const t = useT("draft").followUps;
  const fmt = useFormat();
  const label = (url: string) => {
    if (!url) return t.yourNote;
    const item = feedback.find((entry) => entry.url === url);
    return item
      ? `${item.author}${item.path ? ` · ${item.path}${typeof item.line === "number" ? `:${item.line}` : ""}` : ""}`
      : t.feedback;
  };
  const commitLink = (commit: string) =>
    headRepository ? (
      <a
        href={`https://github.com/${headRepository}/commit/${commit}`}
        target="_blank"
        rel="noreferrer"
      >
        {commit.slice(0, 7)}
      </a>
    ) : (
      <code>{commit.slice(0, 7)}</code>
    );
  return (
    <section className="follow-up-rounds" aria-labelledby="follow-up-rounds-title">
      <h2 id="follow-up-rounds-title">{t.title}</h2>
      <p>{t.intro}</p>
      <ol>
        {[...rounds].reverse().map((round) => {
          const number = rounds.indexOf(round) + 1;
          return (
            <li key={round.id} className={`is-${round.status}`}>
              <div className="follow-up-round-head">
                <strong>
                  {t.round({ number })}
                  {round.adopted
                    ? ` · ${t.adopted}`
                    : round.kind === "sync"
                      ? ` · ${t.syncRound}`
                      : ""}
                </strong>
                <span className="follow-up-status">{t.status[round.status]}</span>
                <time dateTime={round.requestedAt}>
                  {fmt.dateTime(round.requestedAt)}
                </time>
              </div>
              {!!round.feedbackUrls.length && (
                <ul className="follow-up-feedback">
                  {round.feedbackUrls.map((url) => (
                    <li key={url}>
                      <a href={url} target="_blank" rel="noreferrer">
                        {label(url)} <ExternalLink size={11} />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {round.note && (
                <p className="follow-up-note">{t.note({ note: round.note })}</p>
              )}
              {round.error && (
                <p className="follow-up-error" role="status">
                  {round.error}
                </p>
              )}
              {round.report && <p className="follow-up-report">{round.report}</p>}
              {!!round.conflicts?.length && (
                <div className="follow-up-list is-open">
                  <strong>{t.conflicts}</strong>
                  <ul>
                    {round.conflicts.map((file) => (
                      <li key={file}>
                        <code>{file}</code>{" "}
                        {round.resolutions?.find((entry) => entry.path === file)
                          ?.resolution ?? ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!!round.addressed?.length && (
                <div className="follow-up-list">
                  <strong>{t.addressed}</strong>
                  <ul>
                    {round.addressed.map((item, index) => (
                      <li key={`${item.url}-${index}`}>
                        <span>{label(item.url)}</span>
                        {item.change}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!!round.notAddressed?.length && (
                <div className="follow-up-list is-open">
                  <strong>{t.notAddressed}</strong>
                  <ul>
                    {round.notAddressed.map((item, index) => (
                      <li key={`${item.url}-${index}`}>
                        <span>{label(item.url)}</span>
                        {item.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!!round.checks?.length && (
                <div className="follow-up-list">
                  <strong>{t.checks}</strong>
                  <ul>
                    {round.checks.map((check, index) => (
                      <li key={`${check.command}-${index}`}>
                        <code>{check.command}</code> {check.outcome}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {round.commit && (
                <p className="follow-up-commit">
                  <GitCommitHorizontal size={14} />
                  {round.publishedAt
                    ? rich(t.pushed, {
                        commit: commitLink(round.commit),
                        date: fmt.dateTime(round.publishedAt),
                      })
                    : rich(t.notPushed, { commit: commitLink(round.commit) })}
                </p>
              )}
              {/* With a commit, the server checks GitHub before allowing it. */}
              {round.status === "review" && onDiscard && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={onDiscard}
                >
                  <Undo2 size={14} /> {t.discard}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
