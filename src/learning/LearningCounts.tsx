/**
 * The plain counts on the learning page, read from GET /api/learning/counts.
 * They are counted over every run on the server: the learning page itself
 * reads 20 runs at a time and leaves out runs without notes, so it cannot
 * count them. Each line shows only past its threshold, and none of them is
 * a target. Settings → Learning reads the same answer.
 */
import { useEffect, useRef, useState } from "react";
import type { LearningCounts as Counts } from "../../shared/practice";
import { api } from "../api";
import { useT } from "../i18n";

/** How much has to be recorded before a line shows. */
export const countThresholds = {
  /** Graded check answers, for "When you said Sure…". */
  graded: 20,
  /** Runs that reached approval, for "Runs you explained back…". */
  approved: 1,
  /** Maintainer comments tagged "Saw it coming" or "Surprised me". */
  forecasts: 5,
  /** Tagged maintainer comments, for the dimension raised most. */
  tagged: 5,
} as const;

/** GET /api/learning/counts */
export function fetchLearningCounts(signal?: AbortSignal) {
  return api<Counts>("/learning/counts", { signal });
}

/**
 * The counts once they arrive: undefined while they load and null when
 * they could not be read (an older server answers 404), so a caller hides
 * them rather than showing an error for numbers nobody asked for.
 */
export function useLearningCounts(
  load: (signal?: AbortSignal) => Promise<Counts> = fetchLearningCounts,
): Counts | null | undefined {
  const [counts, setCounts] = useState<Counts | null>();
  const loader = useRef(load);
  useEffect(() => {
    const controller = new AbortController();
    loader.current(controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setCounts(value);
      },
      () => {
        if (!controller.signal.aborted) setCounts(null);
      },
    );
    return () => controller.abort();
  }, []);
  return counts;
}

/** One line the counts show, with what its sentence needs. */
export type CountLine =
  | { id: "calibration"; hits: number; of: number }
  | { id: "explained"; explained: number; of: number; checkOff: number }
  | { id: "forecasts"; hits: number; of: number }
  | { id: "recurring"; dimension: Counts["feedback"]["dimensions"][number]["dimension"]; count: number; of: number };

/** The lines past their threshold, in the order the page lists them. */
export function countLines(counts: Counts): CountLine[] {
  const lines: CountLine[] = [];
  const sure = counts.byConfidence?.sure;
  if (counts.graded >= countThresholds.graded && sure?.graded)
    lines.push({ id: "calibration", hits: sure.got, of: sure.graded });
  if (counts.approved >= countThresholds.approved)
    lines.push({
      id: "explained",
      explained: counts.explainedBack,
      // A run can pass its check before it is approved; the sentence never
      // reads "3 of 2".
      of: Math.max(counts.approved, counts.explainedBack),
      checkOff: counts.checkOff,
    });
  if (counts.forecastHits.of >= countThresholds.forecasts)
    lines.push({ id: "forecasts", ...counts.forecastHits });
  const top = counts.feedback.dimensions[0];
  if (counts.feedback.tagged >= countThresholds.tagged && top && counts.feedback.prs)
    lines.push({
      id: "recurring",
      dimension: top.dimension,
      count: top.prs,
      of: counts.feedback.prs,
    });
  return lines;
}

/** The counts past their thresholds; nothing at all while none is. */
export function LearningCountsList({ counts }: { counts: Counts }) {
  const t = useT("learning");
  const lines = countLines(counts);
  if (!lines.length) return null;
  return (
    <section className="learning-counts" aria-labelledby="learning-counts-title">
      <h2 id="learning-counts-title">{t.counts.title}</h2>
      <ul>
        {lines.map((line) => (
          <li key={line.id}>
            {line.id === "calibration"
              ? t.counts.calibration(line)
              : line.id === "explained"
                ? t.counts.explained(line)
                : line.id === "forecasts"
                  ? t.counts.forecasts(line)
                  : t.counts.recurring({
                      ...line,
                      dimension: t.dimensions[line.dimension] ?? line.dimension,
                    })}
          </li>
        ))}
      </ul>
      <p className="learning-counts-note">{t.counts.note}</p>
    </section>
  );
}

/** The counts as the learning page shows them, read from the server. */
export function LearningCounts() {
  const counts = useLearningCounts();
  return counts ? <LearningCountsList counts={counts} /> : null;
}
