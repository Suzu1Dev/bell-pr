import { useT } from "../i18n";
import type { Repo } from "../types";
import { ByHandRecord, Deferred } from "../workspace/draftMounts";
import type { LearningRun } from "./LearningNotes";

/**
 * The person's own explanation of each contribution, written in the
 * understanding check, above the file notes; and the "Understanding check
 * off" mark, for good, on runs approved without the check; and a
 * Learn-by-hand run's record. The notes' filters apply: the chosen
 * contribution and the keyword.
 */
export function LearningRunCards({
  runs,
  repos,
  runId,
  keyword,
}: {
  runs: LearningRun[];
  repos: Repo[];
  /** The contribution the filter shows; "" for all. */
  runId: string;
  /** The keyword filter, trimmed and in lower case. */
  keyword: string;
}) {
  const t = useT("learning").runs;
  const repoName = (run: LearningRun) =>
    repos.find((repo) => repo.id === run.repoId)?.fullName || run.repoId;
  const shown = runs.filter((run) => {
    const summary = run.understanding?.summary?.text?.trim() ?? "";
    if (!summary && !run.understandingCheckOff && !run.byHandSummary) return false;
    if (runId && run.id !== runId) return false;
    return (
      !keyword ||
      [run.title, repoName(run), summary].join("\n").toLowerCase().includes(keyword)
    );
  });
  if (!shown.length) return null;
  return (
    <section className="learning-runs" aria-labelledby="learning-runs-title">
      <h2 id="learning-runs-title">{t.title}</h2>
      <div className="learning-run-grid">
        {shown.map((run) => {
          const summary = run.understanding?.summary?.text?.trim();
          return (
            <article key={run.id} className="learning-run-card">
              <span className="note-number">{repoName(run)}</span>
              <h3>{run.title}</h3>
              {run.understandingCheckOff && (
                <span className="learning-check-off">{t.checkOff}</span>
              )}
              {run.byHandSummary && (
                <Deferred resetKey={run.id}>
                  <ByHandRecord summary={run.byHandSummary} place="learning" />
                </Deferred>
              )}
              {summary ? (
                <div className="learning-own-note">
                  <strong>{t.summary}</strong>
                  <p>{summary}</p>
                </div>
              ) : (
                run.understandingCheckOff && <p className="learning-run-text">{t.checkOffText}</p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
