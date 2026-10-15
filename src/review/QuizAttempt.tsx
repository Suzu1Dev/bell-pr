import { useEffect, useId, useRef, useState, type Ref } from "react";
import { Check, Eye, HelpCircle, LoaderCircle } from "lucide-react";
import {
  confidences,
  isConfidentMiss,
  selfGrades,
  understandingLimits,
  type Confidence,
  type SelfGrade,
} from "../../shared/understanding";
import { useT } from "../i18n";
import { MarkdownContent } from "./MarkdownContent";
import {
  attemptError,
  dontKnowInput,
  revealInput,
  saveFirst,
  useTypewriter,
  type QuizInput,
  type QuizRecord,
} from "./try-first";

export interface QuizAttemptProps {
  /** The file's `selfCheck` question (Markdown). */
  question: string;
  /** Its AI-written answer (Markdown); rendered only once the attempt is on record. */
  reference: string;
  /** The quiz saved for this version of the file (`run.attempts[path].quiz`). */
  saved?: QuizRecord;
  /**
   * Saves a step through ExplanationPanel's `onAttempt`. It must reject
   * when the save failed: the reference stays hidden until it resolves.
   */
  onSave?: (quiz: QuizInput) => Promise<void>;
  /** Demo only: the sample answer "Fill with the sample answer" types. */
  sample?: string;
  demo: boolean;
}

/** The step being saved. */
export type QuizPending = "reveal" | "grade";

/** Where focus goes after a step, by its `data-focus` value. */
type FocusTarget = "grades" | "graded" | "reference";

/**
 * The "Quiz yourself" card, tried first: an answer and a confidence before
 * the reference shows, then a self-grade. Show answer with the field empty
 * is a one-click skip. It never gates anything; a graded answer at the
 * file's current version counts toward the understanding check.
 */
export function QuizAttempt({
  question,
  reference,
  saved,
  onSave,
  sample,
  demo,
}: QuizAttemptProps) {
  const t = useT("review").tryFirst;
  const [answer, setAnswer] = useState(saved?.answer ?? "");
  const [confidence, setConfidence] = useState(saved?.confidence);
  const [record, setRecord] = useState(saved);
  const [pending, setPending] = useState<QuizPending>();
  const [error, setError] = useState<string>();
  const typewriter = useTypewriter();
  const root = useRef<HTMLElement>(null);
  const focusNext = useRef<FocusTarget>(undefined);

  // The saved attempt changed under the card: the run reloaded after a
  // save, a 409 or a diff refresh. Show what is on record now; an answer
  // that was never saved stays in the field. None for this version of the
  // file means the diff moved on: the card starts over with an empty field,
  // since the answer on record was written for the earlier version.
  const savedKey = JSON.stringify(saved ?? null);
  const [shownKey, setShownKey] = useState(savedKey);
  if (shownKey !== savedKey) {
    setShownKey(savedKey);
    setRecord(saved);
    if (saved) {
      setAnswer(saved.answer ?? "");
      setConfidence(saved.confidence);
    } else if (record) {
      setAnswer("");
      setConfidence(undefined);
    }
  }

  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = undefined;
    root.current
      ?.querySelector<HTMLElement>(`[data-focus="${target}"]`)
      ?.focus();
  });

  async function save(input: QuizInput, step: QuizPending, then: FocusTarget) {
    if (pending) return;
    typewriter.stop();
    setPending(step);
    setError(undefined);
    try {
      const done = await saveFirst(input, onSave);
      focusNext.current = then;
      setRecord((current) => ({ ...current, ...done }));
    } catch (failure) {
      setError(attemptError(failure, t.fileChanged));
    } finally {
      setPending(undefined);
    }
  }

  return (
    <QuizAttemptView
      ref={root}
      question={question}
      reference={reference}
      demo={demo}
      sample={sample}
      answer={answer}
      confidence={confidence}
      record={record}
      pending={pending}
      error={error}
      typing={typewriter.typing}
      onAnswer={setAnswer}
      onConfidence={setConfidence}
      onReveal={() => {
        const input = revealInput(answer, confidence);
        void save(input, "reveal", input.skipped ? "reference" : "grades");
      }}
      onDontKnow={() => void save(dontKnowInput(answer), "reveal", "graded")}
      onGrade={(grade) => void save({ grade }, "grade", "graded")}
      onFill={() => sample && typewriter.type(sample, setAnswer)}
    />
  );
}

export interface QuizAttemptViewProps {
  question: string;
  reference: string;
  demo: boolean;
  sample?: string;
  /** The answer being written. */
  answer: string;
  confidence?: Confidence;
  /** The attempt on record; until there is one, the reference is not rendered. */
  record?: QuizRecord;
  pending?: QuizPending;
  error?: string;
  /** The sample answer is being typed. */
  typing: boolean;
  onAnswer(value: string): void;
  onConfidence(value: Confidence): void;
  onReveal(): void;
  onDontKnow(): void;
  onGrade(grade: SelfGrade): void;
  onFill(): void;
  ref?: Ref<HTMLElement>;
}

/** The card's markup for one state; QuizAttempt holds the state. */
export function QuizAttemptView({
  question,
  reference,
  demo,
  sample,
  answer,
  confidence,
  record,
  pending,
  error,
  typing,
  onAnswer,
  onConfidence,
  onReveal,
  onDontKnow,
  onGrade,
  onFill,
  ref,
}: QuizAttemptViewProps) {
  const review = useT("review");
  const t = review.tryFirst;
  const id = useId();
  const gradable = record && !record.skipped && !record.grade;
  const confidentMiss =
    record?.grade &&
    record.confidence &&
    isConfidentMiss({ grade: record.grade, confidence: record.confidence });
  return (
    <section
      ref={ref}
      className="explain-card explain-card-selfcheck tf-card"
    >
      <h3>
        <HelpCircle size={15} aria-hidden="true" />
        {review.explain.cards.selfCheck}
        <span className="tf-badge">{t.badge}</span>
      </h3>
      <div id={`${id}-question`}>
        <MarkdownContent>{question}</MarkdownContent>
      </div>
      {!record && (
        <div className="tf-form">
          <label className="tf-label" htmlFor={`${id}-answer`}>
            {t.quiz.answerLabel}
          </label>
          <textarea
            id={`${id}-answer`}
            className="explain-note-input tf-input"
            rows={3}
            maxLength={understandingLimits.answerChars}
            placeholder={t.quiz.answerPlaceholder}
            aria-describedby={`${id}-question`}
            value={answer}
            onChange={(event) => onAnswer(event.target.value)}
          />
          <p className="tf-label" id={`${id}-confidence`}>
            {t.quiz.confidenceLabel}
          </p>
          <div
            className="tf-chips"
            role="radiogroup"
            aria-labelledby={`${id}-confidence`}
          >
            {confidences.map((value) => (
              <label className="tf-chip" key={value}>
                <input
                  type="radio"
                  name={`${id}-confidence`}
                  value={value}
                  checked={confidence === value}
                  onChange={() => onConfidence(value)}
                />
                {t.confidences[value]}
              </label>
            ))}
          </div>
          {answer.trim() && !confidence && (
            <p className="tf-hint">{t.quiz.confidenceHint}</p>
          )}
          <div className="tf-actions">
            <button
              type="button"
              className="tf-button tf-button-primary"
              aria-busy={pending === "reveal"}
              onClick={onReveal}
            >
              {pending === "reveal" ? (
                <LoaderCircle size={14} className="explain-spin" aria-hidden="true" />
              ) : (
                <Eye size={14} aria-hidden="true" />
              )}
              {pending === "reveal" ? t.saving : t.quiz.reveal}
            </button>
            <button
              type="button"
              className="tf-button tf-button-quiet"
              onClick={onDontKnow}
            >
              {t.quiz.dontKnow}
            </button>
            {demo && sample && (
              <button
                type="button"
                className="tf-button tf-fill"
                disabled={typing}
                onClick={onFill}
              >
                {t.fill}
              </button>
            )}
          </div>
        </div>
      )}
      {/* One region before and after the reveal, so the reference is announced when it arrives. */}
      <div className="tf-compare">
        {record && (
          <div className="tf-yours">
            <p className="tf-label">
              {t.quiz.yourAnswer}
              {record.confidence && (
                <span className="tf-tag">{t.confidences[record.confidence]}</span>
              )}
            </p>
            <p className="tf-yours-text">
              {record.skipped
                ? t.quiz.skipped
                : record.answer || t.quiz.dontKnowAnswer}
            </p>
          </div>
        )}
        <div className="tf-reference" aria-live="polite">
          {record && (
            <div
              className="tf-reference-body"
              tabIndex={-1}
              data-focus="reference"
            >
              <p className="tf-label">{t.quiz.reference}</p>
              <p className="tf-provenance">
                {demo ? t.quiz.referenceLabelDemo : t.quiz.referenceLabel}
              </p>
              <MarkdownContent>{reference}</MarkdownContent>
            </div>
          )}
        </div>
      </div>
      {gradable && (
        <div
          className="tf-grades"
          role="group"
          aria-labelledby={`${id}-grades`}
          aria-busy={pending === "grade"}
          tabIndex={-1}
          data-focus="grades"
        >
          <p className="tf-label" id={`${id}-grades`}>
            {t.quiz.gradeLabel}
          </p>
          {selfGrades.map((grade) => (
            <button
              type="button"
              className="tf-grade"
              key={grade}
              aria-labelledby={`${id}-grade-${grade}`}
              aria-describedby={`${id}-grade-${grade}-hint`}
              onClick={() => onGrade(grade)}
            >
              <strong id={`${id}-grade-${grade}`}>{t.grades[grade]}</strong>
              <span id={`${id}-grade-${grade}-hint`}>{t.gradeHints[grade]}</span>
            </button>
          ))}
        </div>
      )}
      {record?.grade && (
        <div className="tf-graded">
          <p tabIndex={-1} data-focus="graded">
            <Check size={14} aria-hidden="true" />
            {t.quiz.graded[record.grade]}
          </p>
          {confidentMiss && <p className="tf-miss">{t.quiz.confidentMiss}</p>}
        </div>
      )}
      {error && (
        <p className="tf-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
