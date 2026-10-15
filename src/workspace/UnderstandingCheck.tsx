import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CircleCheck, Loader2, Sparkles, X } from "lucide-react";
import { activeFollowUp } from "../../shared/followups";
import {
  changedLines,
  checkScope,
  confidences,
  effectiveGrade,
  selfGrades,
  tasteDimensions,
  understandingLimits,
  understandingWords,
  validAnswer,
  validCorrection,
  validSummary,
  type Confidence,
  type PlannedItem,
  type SelfGrade,
  type TasteDimension,
  type UnderstandingItem,
  type UnderstandingView,
} from "../../shared/understanding";
import { usePresentation } from "../app/presentation";
import type { CheckPanelMode, Understanding } from "../app/hooks/useUnderstanding";
import { demoCheckFiles } from "../app/hooks/understandingDemo";
import { getDemo } from "../demo";
import ReviewabilitySnapshot from "../draft/ReviewabilitySnapshot";
import { useLocale, useT } from "../i18n";
import type { DiffFile, Repo, Run } from "../types";
import { changesOf } from "./respect";
import "./understanding.css";

export interface UnderstandingCheckProps {
  run: Run;
  files: DiffFile[];
  view: UnderstandingView | undefined;
  demo: boolean;
  onClose(): void;
  /** Called once the check passes here, or the forecast alone is saved. */
  onPassed(): void;
  /** The writes and the state around the view (useUnderstanding). */
  check: Pick<
    Understanding,
    | "required"
    | "error"
    | "refresh"
    | "saveAnswers"
    | "saveGrades"
    | "confirmSummary"
    | "restart"
    | "saveForecast"
  >;
  /** "forecast" shows the last step alone, while the check is off. */
  mode?: CheckPanelMode;
  /** The repository, for its generated paths and merged sizes. */
  repo?: Repo;
  /** Opens a file's explanation once its answer is graded. */
  onOpenFile?(path: string): void;
}

interface AnswerDraft {
  answer: string;
  confidence?: Confidence;
  dontKnow: boolean;
}

interface GradeDraft {
  grade?: SelfGrade;
  correction: string;
}

/**
 * Types `text` out in growing slices, for the sample's "Fill with the
 * sample answer" buttons: timers only, so a test clock can step it. Each
 * field (`key`) types on its own; filling a field again starts it over.
 */
function useTypewriter() {
  const { speed } = usePresentation();
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => clearTimeout(timer));
  }, []);
  return (key: string, text: string, apply: (value: string) => void) => {
    clearTimeout(timers.current.get(key));
    const size = Math.max(1, Math.ceil(text.length / 40));
    const pause = Math.max(16, Math.round(30 / speed));
    let end = 0;
    const tick = () => {
      end = Math.min(text.length, end + size);
      apply(text.slice(0, end));
      if (end < text.length) timers.current.set(key, setTimeout(tick, pause));
      else timers.current.delete(key);
    };
    tick();
  };
}

/** One step of the check: a section with its own heading, which focus moves to. */
function Step({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="check-step" aria-labelledby={id}>
      <h3 id={id} tabIndex={-1}>
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * Explain it back (DESIGN §5.3): a closed-book check next to the diff. The
 * person explains the change, answers a few questions about it, compares
 * each answer with its AI-written reference, grades and corrects it, and
 * may predict what the maintainer will question. Nothing grades the
 * person; the pass rule is the one the server applies.
 */
export default function UnderstandingCheck({
  run,
  files,
  view,
  demo,
  onClose,
  onPassed,
  check,
  mode = "check",
  repo,
  onOpenFile,
}: UnderstandingCheckProps) {
  const t = useT("workspace").check;
  const [locale] = useLocale();
  const sample = demo ? getDemo(locale) : undefined;
  const prefix = useId().replaceAll(":", "");
  const ids = {
    explain: `${prefix}-explain`,
    answer: `${prefix}-answer`,
    grade: `${prefix}-grade`,
    correct: `${prefix}-correct`,
    forecast: `${prefix}-forecast`,
    result: `${prefix}-result`,
  };
  const type = useTypewriter();
  const [summary, setSummary] = useState("");
  const [editing, setEditing] = useState(false);
  const [answers, setAnswers] = useState<Record<string, AnswerDraft>>({});
  const [grades, setGrades] = useState<Record<string, GradeDraft>>({});
  const [forecast, setForecast] = useState<{ dimension?: TasteDimension; question: string }>(() => ({
    dimension: view?.record?.forecast?.dimension,
    question: view?.record?.forecast?.question ?? "",
  }));
  const [skipped, setSkipped] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The headings focus may move to, in order of preference.
  const [focus, setFocus] = useState<string[]>();
  // An explanation to rewrite starts from the recorded one.
  const recorded = view?.record?.summary?.text;
  const invalid = view?.missing.some((entry) => entry.part === "summary") && !!recorded;
  useEffect(() => {
    if (invalid || editing) setSummary((value) => value || recorded || "");
  }, [invalid, editing, recorded]);
  // Focus moves to the step that comes next once it is on screen, which
  // can be a render or two after the write (the view updates first).
  useEffect(() => {
    const target = focus
      ?.map((id) => document.getElementById(id))
      .find((element) => element);
    if (!target) return;
    target.focus();
    setFocus(undefined);
  }, [focus, view, skipped]);
  const passedBefore = useRef(view?.passed);
  useEffect(() => {
    if (view?.passed && passedBefore.current === false) onPassed();
    if (view) passedBefore.current = view.passed;
  }, [view, onPassed]);

  /** Runs one write; a refusal is shown and read out, and nothing moves on. */
  async function perform(task: () => Promise<void>, next?: string[]) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await task();
      if (next) setFocus(next);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const snapshot = changesOf(run, files, repo, sample);
  const header = (
    <header className="check-header">
      <div>
        <h2>
          <Sparkles size={16} aria-hidden="true" />
          {t.title}
        </h2>
        <button type="button" className="icon-button" aria-label={t.close} title={t.close} onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <p>{t.intro}</p>
      {!check.required && <p className="check-note">{t.off}</p>}
      <ReviewabilitySnapshot
        snapshot={snapshot}
        weakened={snapshot.weakened}
        reasons={run.reviewability?.testReasons ?? {}}
        compact
      />
    </header>
  );
  const errorLine = error ? (
    <p className="check-error" role="alert">
      {error}
    </p>
  ) : null;

  if (!view)
    return (
      <div className="understanding-check">
        {header}
        {check.error ? (
          <div className="check-step">
            <p role="alert">{t.loadFailed({ message: check.error })}</p>
            <button type="button" className="button secondary" onClick={check.refresh}>
              {t.retry}
            </button>
          </div>
        ) : (
          <p className="check-step" role="status">
            <Loader2 className="spin" size={15} aria-hidden="true" /> {t.loading}
          </p>
        )}
      </div>
    );

  const record = view.record;
  const items = record?.items ?? [];
  const itemOf = (id: string) => items.find((item) => item.id === id);
  const missing = (part: string, id?: string) =>
    view.missing.some((entry) => entry.part === part && (id === undefined || entry.itemId === id));
  const cards = files.flatMap((file) =>
    file.explanation && (file.explanationStatus ?? "ready") === "ready" ? [file.explanation] : [],
  );
  const sampleAnswer = (id: string) => sample?.understandingSample?.answers[id];
  const forecastStep = (
    <Step id={ids.forecast} title={t.forecastTitle}>
      <fieldset className="check-chips">
        <legend>{t.forecastPrompt}</legend>
        {tasteDimensions.map((dimension) => (
          <label key={dimension} className="check-chip">
            <input
              type="radio"
              name={`${prefix}-dimension`}
              checked={forecast.dimension === dimension}
              onChange={() => setForecast((value) => ({ ...value, dimension }))}
            />
            <span>{t.dimensions[dimension]}</span>
          </label>
        ))}
      </fieldset>
      <label className="field-label" htmlFor={`${prefix}-forecast-line`}>
        {t.forecastLine}
      </label>
      <input
        id={`${prefix}-forecast-line`}
        className="text-input"
        maxLength={understandingLimits.forecastChars}
        value={forecast.question}
        onChange={(event) => setForecast((value) => ({ ...value, question: event.target.value }))}
      />
      {sample?.understandingSample && (
        <FillButton
          label={t.fill}
          onFill={() =>
            type("forecast", sample.understandingSample!.forecast.question, (question) =>
              setForecast((value) => ({ ...value, question })),
            )
          }
        />
      )}
      <p className="field-help">{t.forecastNote}</p>
      <div className="check-actions">
        <button
          type="button"
          className="button primary"
          disabled={busy || (!forecast.dimension && !forecast.question.trim())}
          onClick={() =>
            void perform(async () => {
              await check.saveForecast({
                ...(forecast.dimension ? { dimension: forecast.dimension } : {}),
                ...(forecast.question.trim() ? { question: forecast.question.trim() } : {}),
              });
              setSkipped(true);
              if (mode === "forecast") onPassed();
            }, [ids.result])
          }
        >
          {t.saveForecast}
        </button>
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            setSkipped(true);
            if (mode === "forecast") onClose();
            else setFocus([ids.result]);
          }}
        >
          {t.skip}
        </button>
      </div>
      {errorLine}
    </Step>
  );

  if (mode === "forecast")
    return (
      <div className="understanding-check">
        {header}
        {forecastStep}
      </div>
    );

  // The check is taken while the run waits for review or approval.
  const open =
    ["review", "approved"].includes(run.status) && !run.publishing && !run.workspaceRemovedAt;
  const newSummary = !record?.summary;
  const confirm = !newSummary && view.stale && !editing;
  const rewrite = !newSummary && (editing || missing("summary"));
  const toAnswer = view.plan.filter(
    (item) => item.source !== "attempt" && missing("answer", item.id),
  );
  // Credited try-first answers are added by the next lock; the client never sends them.
  const lockable =
    open &&
    (newSummary ||
      toAnswer.length > 0 ||
      view.plan.some((item) => item.source === "attempt" && missing("answer", item.id)));
  const gradable = view.plan.filter((item) => item.source !== "untested");
  const grading = open && !lockable && !view.passed && !confirm && !rewrite;
  const round = !!activeFollowUp(run.followUps);
  const draftOf = (id: string): AnswerDraft => answers[id] ?? { answer: "", dontKnow: false };
  const gradeOf = (item: UnderstandingItem): GradeDraft =>
    grades[item.id] ?? { grade: effectiveGrade(item), correction: item.correction ?? "" };

  function lock() {
    const reasons: string[] = [];
    if (newSummary && understandingWords(summary) < understandingLimits.summaryMinWords)
      reasons.push(t.summaryShort({ min: understandingLimits.summaryMinWords }));
    else if (newSummary && !validSummary(summary, cards)) reasons.push(t.copied);
    for (const item of toAnswer) {
      const draft = draftOf(item.id);
      const confidence = draft.dontKnow ? "guess" : draft.confidence;
      if (!confidence) reasons.push(t.confidenceMissing);
      else if (!draft.dontKnow && understandingWords(draft.answer) < understandingLimits.answerMinWords)
        reasons.push(t.answerShort({ min: understandingLimits.answerMinWords }));
      else if (!validAnswer({ answer: draft.dontKnow ? "" : draft.answer, dontKnow: draft.dontKnow, confidence }, item.reference))
        reasons.push(t.copied);
    }
    if (reasons.length) {
      setError([...new Set(reasons)].join(" "));
      return;
    }
    void perform(
      () =>
        check.saveAnswers({
          ...(newSummary ? { summary: summary.trim() } : {}),
          items: toAnswer.map((item) => {
            const draft = draftOf(item.id);
            return {
              id: item.id,
              answer: draft.dontKnow ? "" : draft.answer.trim(),
              confidence: draft.dontKnow ? "guess" : draft.confidence!,
              ...(draft.dontKnow ? { dontKnow: true } : {}),
            };
          }),
        }),
      [ids.grade, ids.correct, ids.forecast, ids.result],
    );
  }

  function saveGrades() {
    const chosen = gradable.flatMap((planned) => {
      const item = itemOf(planned.id);
      return item ? [{ item, draft: gradeOf(item) }] : [];
    });
    if (chosen.some(({ draft }) => !draft.grade)) return setError(t.gradeMissing);
    if (chosen.some(({ draft }) => draft.grade !== "got" && !validCorrection(draft.correction)))
      return setError(t.correctionShort({ min: understandingLimits.correctionMinWords }));
    void perform(
      () =>
        check.saveGrades({
          items: chosen.map(({ item, draft }) => ({
            id: item.id,
            grade: draft.grade!,
            ...(draft.grade !== "got" ? { correction: draft.correction.trim() } : { correction: "" }),
          })),
        }),
      [ids.forecast, ids.result],
    );
  }

  const graded = view.plan.flatMap((planned) => {
    const item = itemOf(planned.id);
    if (!item) return [];
    const fixed = item.source === "attempt" || item.dontKnow ? effectiveGrade(item) : undefined;
    const draft = gradeOf(item);
    return [{ planned, item, fixed, draft, grade: fixed ?? draft.grade, name: `${prefix}-${planned.id.replace(/[^\w-]/g, "_")}` }];
  });
  // Step 4 asks for one line per Partly or Missed answer.
  const corrections = graded.filter(
    ({ planned, grade }) => planned.source !== "untested" && !!grade && grade !== "got",
  );
  const saveButton = (
    <>
      <div className="check-actions">
        <button type="button" className="button primary" disabled={busy} onClick={saveGrades}>
          {t.saveGrades}
        </button>
      </div>
      {errorLine}
    </>
  );
  // The receipt of a pass: the counts the pass recorded, or, for a record
  // from before they were kept, the answers on it.
  const lastPass = record?.history?.at(-1);
  const counts = lastPass ?? {
    questions: items.length,
    misses: items.filter((item) => ["partly", "missed"].includes(effectiveGrade(item) ?? "")).length,
  };
  // The question count follows the changed lines of what this check asks
  // about, without the project's generated files, as the server counts them.
  const lines = changedLines(
    checkScope(demoCheckFiles(files), record),
    repo?.contributionRules?.generated,
  );

  return (
    <div className="understanding-check">
      {header}
      {!open && !view.passed && <p className="check-step">{t.notOpen}</p>}
      {open && !view.passed && (
        <p className="check-plan">
          {t.plan({ questions: view.plan.filter((item) => item.path).length, lines })}
        </p>
      )}
      {(open || record?.summary) && (
        <Step id={ids.explain} title={t.explainTitle}>
          {newSummary || rewrite ? (
            <>
              <label className="field-label" htmlFor={`${prefix}-summary`}>
                {round ? t.roundPrompt : t.explainPrompt}
              </label>
              <textarea
                id={`${prefix}-summary`}
                className="text-input check-summary"
                aria-describedby={`${prefix}-summary-words`}
                maxLength={understandingLimits.summaryChars}
                value={summary}
                disabled={!open || view.passed}
                onChange={(event) => setSummary(event.target.value)}
              />
              <p id={`${prefix}-summary-words`} className="field-help" aria-live="polite">
                {t.words({ count: understandingWords(summary), min: understandingLimits.summaryMinWords })}
              </p>
              {sample?.understandingSample && open && (
                <FillButton label={t.fill} onFill={() => type("summary", sample.understandingSample!.summary, setSummary)} />
              )}
              {rewrite && (
                <div className="check-actions">
                  <button
                    type="button"
                    className="button primary"
                    disabled={busy}
                    onClick={() => {
                      if (!validSummary(summary, cards))
                        return setError(
                          understandingWords(summary) < understandingLimits.summaryMinWords
                            ? t.summaryShort({ min: understandingLimits.summaryMinWords })
                            : t.copied,
                        );
                      void perform(async () => {
                        await check.confirmSummary(summary.trim());
                        setEditing(false);
                      }, [ids.answer, ids.grade, ids.result]);
                    }}
                  >
                    {t.saveSummary}
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              {confirm && <p className="check-note" role="status">{t.moved}</p>}
              <blockquote className="check-quote">{record?.summary?.text}</blockquote>
              {confirm && open && (
                <div className="check-actions">
                  <button
                    type="button"
                    className="button primary"
                    disabled={busy}
                    onClick={() => void perform(() => check.confirmSummary(), [ids.answer, ids.grade, ids.result])}
                  >
                    {t.stillAccurate}
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => {
                      setSummary(record?.summary?.text ?? "");
                      setEditing(true);
                    }}
                  >
                    {t.edit}
                  </button>
                </div>
              )}
            </>
          )}
        </Step>
      )}
      {view.plan.length > 0 && !view.passed && (
        <Step id={ids.answer} title={t.answerTitle}>
          {lockable && <p className="field-help">{t.answerIntro}</p>}
          <ol className="check-items">
            {view.plan.map((planned) => (
              <li key={planned.id}>
                <AnswerItem
                  prefix={`${prefix}-${planned.id.replace(/[^\w-]/g, "_")}`}
                  planned={planned}
                  item={itemOf(planned.id)}
                  run={run}
                  editable={toAnswer.includes(planned)}
                  draft={draftOf(planned.id)}
                  onChange={(draft) => setAnswers((value) => ({ ...value, [planned.id]: draft }))}
                  sample={sampleAnswer(planned.id)?.answer}
                  // The typed sample changes the answer only, never a confidence picked meanwhile.
                  onFill={(text) =>
                    type(planned.id, text, (answer) =>
                      setAnswers((value) => ({
                        ...value,
                        [planned.id]: { ...(value[planned.id] ?? { answer: "", dontKnow: false }), answer },
                      })),
                    )
                  }
                />
              </li>
            ))}
          </ol>
          {lockable && (
            <div className="check-actions">
              <button type="button" className="button primary" disabled={busy || confirm} onClick={lock}>
                {busy ? <Loader2 className="spin" size={15} aria-hidden="true" /> : null}
                {t.lock}
              </button>
              <p className="field-help">{t.lockNote}</p>
            </div>
          )}
          {lockable && errorLine}
        </Step>
      )}
      {grading && gradable.length > 0 && (
        <Step id={ids.grade} title={t.gradeTitle}>
          {grading && (
            <>
              <p className="field-help">{t.gradeIntro}</p>
              <dl className="check-definitions">
                {selfGrades.map((grade) => (
                  <div key={grade}>
                    <dt>{t.grades[grade]}</dt>
                    <dd>{t.gradeHints[grade]}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
          <ol className="check-items">
            {graded.map(({ planned, item, fixed, draft, grade, name }) => (
              <li key={planned.id}>
                <p className="check-question">{planned.question}</p>
                <div className="check-compare">
                  <div>
                    <strong>{t.yourAnswer}</strong>
                    <p>{item.dontKnow ? t.dontKnowAnswer : item.answer}</p>
                  </div>
                  <div className="check-reference">
                    <strong>
                      {planned.reference
                        ? planned.source === "untested"
                          ? t.testerReference
                          : t.reference
                        : t.noReference}
                    </strong>
                    {planned.reference && <p>{planned.reference}</p>}
                  </div>
                </div>
                {planned.source === "untested" ? (
                  <p className="field-help">{t.notGraded}</p>
                ) : grading && !fixed ? (
                  <fieldset className="check-chips">
                    <legend>{t.grade}</legend>
                    {selfGrades.map((value) => (
                      <label key={value} className="check-chip">
                        <input
                          type="radio"
                          name={`${name}-grade`}
                          checked={draft.grade === value}
                          onChange={() =>
                            setGrades((all) => ({ ...all, [item.id]: { ...(all[item.id] ?? draft), grade: value } }))
                          }
                        />
                        <span>{t.grades[value]}</span>
                      </label>
                    ))}
                  </fieldset>
                ) : (
                  <p className="check-graded">
                    {grade && t.gradedAs({ grade: t.grades[grade] })}
                    {item.source === "attempt" && ` · ${t.credited}`}
                  </p>
                )}
              </li>
            ))}
          </ol>
          {grading && !corrections.length && saveButton}
        </Step>
      )}
      {corrections.length > 0 && (
        <Step id={ids.correct} title={t.correctTitle}>
          <ol className="check-items">
            {corrections.map(({ planned, item, fixed, draft, name }) => (
              <li key={planned.id}>
                <p className="check-question">{planned.question}</p>
                {grading ? (
                  <>
                    <label className="field-label" htmlFor={`${name}-correction`}>
                      {t.correction}
                    </label>
                    <input
                      id={`${name}-correction`}
                      className="text-input"
                      maxLength={understandingLimits.correctionChars}
                      value={draft.correction}
                      onChange={(event) =>
                        setGrades((all) => ({
                          ...all,
                          [item.id]: { grade: draft.grade ?? fixed, correction: event.target.value },
                        }))
                      }
                    />
                    {sampleAnswer(planned.id)?.correction && (
                      <FillButton
                        label={t.fill}
                        onFill={() =>
                          type(`${planned.id}:correction`, sampleAnswer(planned.id)!.correction!, (correction) =>
                            setGrades((all) => ({
                              ...all,
                              [item.id]: { grade: (all[item.id] ?? draft).grade ?? fixed, correction },
                            })),
                          )
                        }
                      />
                    )}
                  </>
                ) : (
                  <p className="check-correction">
                    <strong>{t.correction}</strong> {item.correction}
                  </p>
                )}
              </li>
            ))}
          </ol>
          {grading && saveButton}
        </Step>
      )}
      {view.passed && open && !skipped && !record?.forecast && forecastStep}
      {view.passed && (
        <section className="check-result" aria-labelledby={ids.result}>
          <h3 id={ids.result} tabIndex={-1}>
            {t.resultTitle}
          </h3>
          <p role="status">
            <CircleCheck size={16} aria-hidden="true" />
            {t.result({ questions: counts.questions, misses: counts.misses })}
          </p>
          {record?.forecast?.dimension && (
            <p className="field-help">
              {t.forecast({ dimension: t.dimensions[record.forecast.dimension] })}
              {record.forecast.question ? ` · ${record.forecast.question}` : ""}
            </p>
          )}
          <ol className="check-items">
            {items.map((item) => {
              const grade = effectiveGrade(item);
              return (
                <li key={item.id}>
                  <p className="check-question">{item.question}</p>
                  <blockquote className="check-quote">{item.dontKnow ? t.dontKnow : item.answer}</blockquote>
                  {grade && (
                    <p className="check-graded">
                      {t.gradedAs({ grade: t.grades[grade] })}
                      {item.source === "attempt" && ` · ${t.credited}`}
                    </p>
                  )}
                  {item.correction && (
                    <p className="check-correction">
                      <strong>{t.correction}</strong> {item.correction}
                    </p>
                  )}
                  {item.path && onOpenFile && (
                    <button type="button" className="run-notice-link" onClick={() => onOpenFile(item.path!)}>
                      {t.openExplanation({ path: item.path })}
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}
      {open && (record?.summary || items.length > 0) && (
        <div className="check-restart">
          {restarting ? (
            <>
              <p role="alert">{t.startOverConfirm}</p>
              <div className="check-actions">
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      await check.restart();
                      setRestarting(false);
                      setSummary("");
                      setAnswers({});
                      setGrades({});
                      setSkipped(false);
                    }, [ids.explain])
                  }
                >
                  {t.startOver}
                </button>
                <button type="button" className="button secondary" onClick={() => setRestarting(false)}>
                  {t.keep}
                </button>
              </div>
            </>
          ) : (
            <button type="button" className="run-notice-link" onClick={() => setRestarting(true)}>
              {t.startOver}
            </button>
          )}
          {!lockable && !grading && errorLine}
        </div>
      )}
    </div>
  );
}

function FillButton({ label, onFill }: { label: string; onFill(): void }) {
  return (
    <button type="button" className="check-fill" onClick={onFill}>
      <Sparkles size={13} aria-hidden="true" />
      {label}
    </button>
  );
}

/** One question of step 2: answered during review, locked, or to answer now. */
function AnswerItem({
  prefix,
  planned,
  item,
  run,
  editable,
  draft,
  onChange,
  sample,
  onFill,
}: {
  prefix: string;
  planned: PlannedItem;
  item: UnderstandingItem | undefined;
  run: Run;
  editable: boolean;
  draft: AnswerDraft;
  onChange(draft: AnswerDraft): void;
  sample?: string;
  /** Types `text` into the answer, for the sample's button. */
  onFill(text: string): void;
}) {
  const t = useT("workspace").check;
  if (planned.source === "attempt") {
    const quiz = item ?? run.attempts?.[planned.path ?? ""]?.quiz;
    const grade = item?.grade ?? run.attempts?.[planned.path ?? ""]?.quiz?.grade;
    return (
      <>
        <p className="check-question">{planned.question}</p>
        <p className="check-credited">
          <CircleCheck size={14} aria-hidden="true" />
          {t.credited}
          {grade && ` · ${t.grades[grade]}`}
        </p>
        {quiz?.answer && <blockquote className="check-quote">{quiz.answer}</blockquote>}
      </>
    );
  }
  if (!editable)
    return (
      <>
        <p className="check-question">{planned.question}</p>
        <blockquote className="check-quote">{item?.dontKnow ? t.dontKnow : item?.answer}</blockquote>
        {item && <p className="field-help">{t.confidenceWas({ confidence: t.confidences[item.confidence] })}</p>}
      </>
    );
  return (
    <>
      <label className="field-label check-question" htmlFor={`${prefix}-answer`}>
        {planned.question}
      </label>
      <textarea
        id={`${prefix}-answer`}
        className="text-input check-answer"
        maxLength={understandingLimits.answerChars}
        value={draft.answer}
        disabled={draft.dontKnow}
        onChange={(event) => onChange({ ...draft, answer: event.target.value })}
      />
      {sample && !draft.dontKnow && (
        <FillButton label={t.fill} onFill={() => onFill(sample)} />
      )}
      <label className="check-dont-know">
        <input
          type="checkbox"
          checked={draft.dontKnow}
          onChange={(event) =>
            onChange(
              event.target.checked
                ? { answer: "", dontKnow: true, confidence: "guess" }
                : { ...draft, dontKnow: false },
            )
          }
        />
        {t.dontKnow}
      </label>
      <fieldset className="check-chips" disabled={draft.dontKnow}>
        <legend>{t.confidence}</legend>
        {confidences.map((value) => (
          <label key={value} className="check-chip">
            <input
              type="radio"
              name={`${prefix}-confidence`}
              checked={(draft.dontKnow ? "guess" : draft.confidence) === value}
              onChange={() => onChange({ ...draft, confidence: value })}
            />
            <span>{t.confidences[value]}</span>
          </label>
        ))}
      </fieldset>
    </>
  );
}
