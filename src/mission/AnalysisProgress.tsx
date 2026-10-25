import { Check, Loader2 } from "lucide-react";
import type { InsightsPhase, InsightsProgress } from "../../shared/insights";
import { useT } from "../i18n";

const phases: readonly InsightsPhase[] = [
  "reading",
  "agent",
  "checking",
  "saving",
];

/** A stopwatch reading such as "3:05". */
const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/**
 * How much of its wait limit the running try has used, to a tenth of a
 * percent. Only a try that has started has a time to measure; elsewhere
 * (reading, the wait between tries, checking, saving) the bar has no value.
 */
function usedPercent({ phase, waitedSeconds, limitSeconds }: InsightsProgress) {
  if (phase !== "agent" || waitedSeconds === undefined || !limitSeconds)
    return undefined;
  return Math.min(100, Math.round((1000 * waitedSeconds) / limitSeconds) / 10);
}

/**
 * The steps of a running analysis, as the server reports them: the finished
 * ones, the current one with its time, and the latest notice from the CLI
 * (a retry, a rate limit). Only the notice is announced as it changes; the
 * clock is not.
 */
export function AnalysisProgress({ progress }: { progress: InsightsProgress }) {
  const t = useT("mission");
  const text = t.progress;
  const current = phases.indexOf(progress.phase);
  const percent = usedPercent(progress);
  const detail =
    progress.phase === "agent"
      ? [
          progress.attempt !== undefined &&
          progress.attempts !== undefined &&
          progress.attempt > 1
            ? text.attempt({
                attempt: progress.attempt,
                attempts: progress.attempts,
              })
            : "",
          progress.waitedSeconds !== undefined && progress.limitSeconds
            ? text.waited({
                waited: clock(progress.waitedSeconds),
                limit: clock(progress.limitSeconds),
              })
            : "",
        ]
          .filter(Boolean)
          .join(" · ")
      : text.elapsed({ elapsed: clock(progress.elapsedSeconds) });
  return (
    <div className="mission-analysis-steps">
      <div
        className={`mission-analysis-progress${percent === undefined ? " is-indeterminate" : ""}`}
        role="progressbar"
        aria-label={t.empty.progressLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent === undefined ? undefined : Math.round(percent)}
        aria-valuetext={[text.phases[progress.phase], detail]
          .filter(Boolean)
          .join(", ")}
      >
        <span
          style={percent === undefined ? undefined : { width: `${percent}%` }}
        />
      </div>
      <ol>
        {phases.slice(0, current + 1).map((phase, index) => {
          const active = index === current;
          return (
            <li key={phase} className={active ? "current" : "done"}>
              {active ? (
                <Loader2 className="mission-spin" size={14} aria-hidden="true" />
              ) : (
                <Check size={14} aria-hidden="true" />
              )}
              <span>
                {text.phases[phase]}
                {active && detail && <small>{detail}</small>}
              </span>
            </li>
          );
        })}
      </ol>
      {/* Always there, even empty: screen readers often skip a live region that appears with its text. */}
      <p className="mission-analysis-notice" role="status">
        {progress.notice}
      </p>
      <p className="mission-analysis-note">{text.note}</p>
    </div>
  );
}
