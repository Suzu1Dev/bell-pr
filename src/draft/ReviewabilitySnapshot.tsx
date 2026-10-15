import { useEffect, useId, useState } from "react";
import { Info, LoaderCircle, Ruler, Split } from "lucide-react";
import { draftProseWords } from "../../shared/draft-checks";
import type {
  ReviewabilityBand,
  ReviewabilitySnapshot as Snapshot,
  WeakenedTest,
} from "../../shared/reviewability";
import { useFormat, useT } from "../i18n";
import { CopyButton } from "./CopyButton";
import "./drafts.css";

/**
 * How reviewable the change is (DESIGN F9): its size against BELL's bands
 * and the project's own merged sizes, tests, new dependencies, files
 * outside the plan, whitespace-only changes, and a one-line reason for each
 * weakened test.
 */
export interface ReviewabilitySnapshotProps {
  snapshot: Snapshot;
  weakened: Pick<WeakenedTest, "id" | "path" | "line" | "text">[];
  /** The saved reason of each weakened-test item, by its id. */
  reasons: Record<string, string>;
  /** Saves the reasons; a promise it returns keeps the card busy and shows its failure. */
  onSaveReasons?(reasons: Record<string, string>): void | Promise<void>;
  /** Opens the Ask-the-agent preset "How could this be split into separate changes?". */
  onAskSplit?(): void;
  /** The short form at the top of the check panel. */
  compact?: boolean;
}

/** The band's colour: green, amber or red (BELL defaults, DESIGN F9). */
export const bandTone: Record<ReviewabilityBand, "ok" | "warn" | "alert"> = {
  small: "ok",
  medium: "warn",
  large: "warn",
  "very-large": "alert",
};

/** A reason the publish check accepts: 3 words or more (CJK characters count one each). */
export const reasonMinWords = 3;
/** The longest reason the server stores (DESIGN §8, `reviewability.testReasons`). */
export const reasonMaxChars = 300;

export function validReason(text = "") {
  return draftProseWords(text.trim()) >= reasonMinWords;
}

/**
 * The saved reasons as Markdown lines for the PR's Testing section. They
 * are the person's own words and file paths, so nothing is translated.
 */
export function reasonLines(
  weakened: ReviewabilitySnapshotProps["weakened"],
  reasons: Record<string, string>,
) {
  return weakened
    .filter((item) => validReason(reasons[item.id]))
    .map(
      (item) =>
        `- \`${item.line ? `${item.path}:${item.line}` : item.path}\`: ${reasons[item.id].trim()}`,
    )
    .join("\n");
}

/**
 * The reasons to save from the fields: every weakened item's trimmed text,
 * and "" for one the person emptied, which the server reads as "remove the
 * saved reason". A field that is too short is not sent (Save is off then).
 */
export function reasonsToSave(
  weakened: ReviewabilitySnapshotProps["weakened"],
  drafts: Record<string, string>,
) {
  return Object.fromEntries(
    weakened.flatMap((item) => {
      const text = (drafts[item.id] ?? "").trim();
      return !text || validReason(text) ? [[item.id, text]] : [];
    }),
  );
}

export default function ReviewabilitySnapshot({
  snapshot,
  weakened,
  reasons,
  onSaveReasons,
  onAskSplit,
  compact = false,
}: ReviewabilitySnapshotProps) {
  const t = useT("draft").reviewability;
  const fmt = useFormat();
  const id = useId().replaceAll(":", "");
  const [drafts, setDrafts] = useState<Record<string, string>>(reasons);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savedKey = JSON.stringify(reasons);
  // A save the parent stored comes back as `reasons`: the fields follow it.
  useEffect(() => {
    setDrafts(JSON.parse(savedKey) as Record<string, string>);
  }, [savedKey]);
  const band = t.band({ band: t.bands[snapshot.band] });
  const tone = bandTone[snapshot.band];
  const numbers = [
    { key: "lines", label: t.lines, value: snapshot.changedLines },
    { key: "files", label: t.files, value: snapshot.files },
    { key: "tests", label: t.tests, value: snapshot.testFilesChanged },
    { key: "dependencies", label: t.dependencies, value: snapshot.newDependencies.length },
    { key: "outside", label: t.outsidePlan, value: snapshot.outsidePlan.length },
    { key: "whitespace", label: t.whitespace, value: snapshot.whitespaceOnly.length },
  ];
  const changed = weakened.some(
    (item) => (drafts[item.id] ?? "").trim() !== (reasons[item.id] ?? "").trim(),
  );
  const invalid = weakened.some(
    (item) => !!drafts[item.id]?.trim() && !validReason(drafts[item.id]),
  );
  const missing = weakened.filter((item) => !validReason(reasons[item.id])).length;
  const saved = reasonLines(weakened, reasons);
  const save = async () => {
    if (!onSaveReasons) return;
    const next = reasonsToSave(weakened, drafts);
    setSaving(true);
    setError("");
    try {
      // The parent may answer with a promise (the PUT); a failure stays here.
      await onSaveReasons(next);
    } catch (cause) {
      setError(t.saveFailed({ reason: (cause as Error).message }));
    } finally {
      setSaving(false);
    }
  };
  const label = (item: ReviewabilitySnapshotProps["weakened"][number]) =>
    item.line === 0
      ? t.deleted({ path: item.path })
      : item.id.includes("#-")
        ? t.removed({ path: item.path, line: item.line })
        : t.added({ path: item.path, line: item.line });

  const head = (
    <header className="reviewability-head">
      <h3 id={`reviewability-${id}`}>
        <Ruler size={16} aria-hidden="true" /> {t.title}
      </h3>
      <span
        className={`reviewability-band is-${tone}`}
        title={t.bandHelp}
        aria-describedby={compact ? undefined : `reviewability-help-${id}`}
      >
        {band}
      </span>
    </header>
  );
  const figures = (
    <dl className="reviewability-numbers">
      {numbers.map((number) => (
        <div key={number.key}>
          <dt>{number.label}</dt>
          <dd>{fmt.number(number.value)}</dd>
        </div>
      ))}
    </dl>
  );
  if (compact)
    return (
      <section
        className="reviewability is-compact"
        aria-labelledby={`reviewability-${id}`}
      >
        {head}
        {figures}
        {missing > 0 && (
          <p className="reviewability-missing">{t.weakenedCount({ count: missing })}</p>
        )}
      </section>
    );
  return (
    <section className="reviewability" aria-labelledby={`reviewability-${id}`}>
      {head}
      {figures}
      <p id={`reviewability-help-${id}`} className="reviewability-note">
        <Info size={13} aria-hidden="true" /> {t.linesNote} {t.bandHelp}
      </p>
      {(
        [
          ["dependencies", snapshot.newDependencies.map((dependency) => dependency.name)],
          ["outsidePlan", snapshot.outsidePlan],
          ["whitespace", snapshot.whitespaceOnly],
        ] as const
      ).map(
        ([key, items]) =>
          items.length > 0 && (
            <p key={key} className="reviewability-list">
              <strong>{t[key]}</strong> {fmt.list([...items], { type: "unit" })}
            </p>
          ),
      )}
      <div className="reviewability-merged">
        <h4>{t.merged}</h4>
        {snapshot.mergedSizes?.length ? (
          <ul>
            {snapshot.mergedSizes.map((size) => (
              <li key={size.number}>
                {t.mergedSize({
                  number: size.number,
                  additions: size.additions,
                  deletions: size.deletions,
                  files: size.changedFiles,
                })}
              </li>
            ))}
          </ul>
        ) : (
          <p>{t.mergedNone}</p>
        )}
      </div>
      <div className="reviewability-split">
        <h4>{t.split}</h4>
        <p>{t.splitLead}</p>
        {onAskSplit && (
          <button type="button" className="button secondary" onClick={onAskSplit}>
            <Split size={14} aria-hidden="true" /> {t.askSplit}
          </button>
        )}
      </div>
      {weakened.length > 0 && (
        <div className="reviewability-weakened">
          <h4>{t.weakened}</h4>
          <p>{t.weakenedLead}</p>
          <ol>
            {weakened.map((item) => {
              const field = `reviewability-reason-${id}-${item.id.replace(/[^\w-]/g, "_")}`;
              const value = drafts[item.id] ?? "";
              const bad = !!value.trim() && !validReason(value);
              return (
                <li key={item.id}>
                  <p className="reviewability-weakened-line">
                    <code>{label(item)}</code>
                    {item.text && <code className="reviewability-weakened-text">{item.text}</code>}
                  </p>
                  <label htmlFor={field}>{t.reason}</label>
                  <input
                    id={field}
                    type="text"
                    value={value}
                    maxLength={reasonMaxChars}
                    disabled={!onSaveReasons || saving}
                    aria-invalid={bad || undefined}
                    aria-describedby={`${field}-hint`}
                    onChange={(event) =>
                      setDrafts((previous) => ({ ...previous, [item.id]: event.target.value }))
                    }
                  />
                  <small id={`${field}-hint`}>{t.reasonHint}</small>
                </li>
              );
            })}
          </ol>
          {onSaveReasons && (
            <button
              type="button"
              className="button primary"
              disabled={!changed || invalid || saving}
              onClick={() => void save()}
            >
              {saving && <LoaderCircle className="spin" size={14} aria-hidden="true" />}
              {saving ? t.saving : t.save}
            </button>
          )}
          {error && (
            <p className="reviewability-error" role="alert">
              {error}
            </p>
          )}
          {saved && (
            <div className="reviewability-saved">
              <p>{t.saved}</p>
              <pre>{saved}</pre>
              <CopyButton text={saved} label={t.copy} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
