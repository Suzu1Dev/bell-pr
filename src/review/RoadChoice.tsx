import { useEffect, useId, useRef, useState, type Ref } from "react";
import { Eye, LoaderCircle, Shuffle } from "lucide-react";
import {
  roadChoices,
  understandingLimits,
  type RoadChoice as Choice,
} from "../../shared/understanding";
import { useT } from "../i18n";
import { MarkdownContent } from "./MarkdownContent";
import {
  attemptError,
  saveFirst,
  useTypewriter,
  type RoadInput,
  type RoadRecord,
} from "./try-first";

export interface RoadChoiceProps {
  /** The explanation's "What if it were done differently?" text (Markdown). */
  alternatives: string;
  /** Keywords to look up; they stay at the foot of the card as before. */
  lookup?: string[];
  /** The road choice saved for this version of the file (`run.attempts[path].road`). */
  saved?: RoadRecord;
  /** Saves through ExplanationPanel's `onAttempt`; rejects when the save failed. */
  onSave?: (road: RoadInput) => Promise<void>;
  /** Demo only: the sample guess and why that "Fill with the sample answer" types. */
  sample?: { guess: string; why: string };
  demo: boolean;
}

/**
 * The "What if it were done differently?" card, tried first: an optional
 * guess at another way before the alternative shows, then which approach
 * fits this project, with an optional why. Each choice is saved as it is
 * made. Skipping takes one click: Show the alternative with the field
 * empty.
 */
export function RoadChoice({
  alternatives,
  lookup,
  saved,
  onSave,
  sample,
  demo,
}: RoadChoiceProps) {
  const t = useT("review").tryFirst;
  const [guess, setGuess] = useState(saved?.guess ?? "");
  const [revealed, setRevealed] = useState(Boolean(saved));
  const [choice, setChoice] = useState(saved?.choice);
  const [why, setWhy] = useState(saved?.why ?? "");
  const [savedWhy, setSavedWhy] = useState(saved?.why ?? "");
  const [revealing, setRevealing] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();
  const typewriter = useTypewriter();
  const root = useRef<HTMLElement>(null);
  const focusChoices = useRef(false);
  // Choices are saved one at a time, newest last, so a quick change of
  // mind never lands before the choice it replaced.
  const sending = useRef(false);
  const latest = useRef<RoadInput>(undefined);

  // The saved choice changed under the card (the run reloaded). A choice
  // that arrives before the reveal is shown; once revealed, the card's own
  // saves keep the record up to date, so a reload never overwrites the
  // why being typed. None for this version of the file means the diff
  // moved on: the card starts over, and a typed guess stays in the field.
  const savedKey = JSON.stringify(saved ?? null);
  const [shownKey, setShownKey] = useState(savedKey);
  if (shownKey !== savedKey) {
    setShownKey(savedKey);
    if (!saved) {
      setRevealed(false);
      setChoice(undefined);
      setWhy("");
      setSavedWhy("");
      setDone(false);
    } else if (!revealed) {
      setRevealed(true);
      setGuess(saved.guess ?? "");
      setChoice(saved.choice);
      setWhy(saved.why ?? "");
      setSavedWhy(saved.why ?? "");
    }
  }

  useEffect(() => {
    if (!focusChoices.current) return;
    focusChoices.current = false;
    root.current
      ?.querySelector<HTMLElement>('[data-focus="choices"]')
      ?.focus();
  });

  async function reveal() {
    if (revealing) return;
    typewriter.stop();
    const text = guess.trim();
    setRevealing(true);
    setError(undefined);
    try {
      // A guess is on record before the alternative shows.
      if (text) await saveFirst({ guess: text }, onSave);
      focusChoices.current = true;
      setGuess(text);
      setRevealed(true);
    } catch (failure) {
      setError(attemptError(failure, t.fileChanged));
    } finally {
      setRevealing(false);
    }
  }

  async function persist(input: RoadInput) {
    latest.current = input;
    if (sending.current) return;
    sending.current = true;
    setDone(false);
    setError(undefined);
    try {
      while (latest.current) {
        const next = latest.current;
        latest.current = undefined;
        await saveFirst(next, onSave);
        if (next.why !== undefined) setSavedWhy(next.why);
      }
      setDone(Boolean(onSave));
    } catch (failure) {
      latest.current = undefined;
      setError(attemptError(failure, t.fileChanged));
    } finally {
      sending.current = false;
    }
  }

  const reason = why.trim();
  return (
    <RoadChoiceView
      ref={root}
      alternatives={alternatives}
      lookup={lookup}
      demo={demo}
      sample={sample}
      guess={guess}
      revealed={revealed}
      revealing={revealing}
      choice={choice}
      why={why}
      canSaveWhy={Boolean(choice && reason && reason !== savedWhy)}
      saved={done}
      error={error}
      typing={typewriter.typing}
      onGuess={setGuess}
      onReveal={() => void reveal()}
      onChoice={(value) => {
        setChoice(value);
        void persist(reason ? { choice: value, why: reason } : { choice: value });
      }}
      onWhy={(value) => {
        setWhy(value);
        setDone(false);
      }}
      onSaveWhy={() => choice && void persist({ choice, why: reason })}
      onFillGuess={() => sample && typewriter.type(sample.guess, setGuess)}
      onFillWhy={() =>
        sample &&
        typewriter.type(sample.why, (value) => {
          setWhy(value);
          setDone(false);
        })
      }
    />
  );
}

export interface RoadChoiceViewProps {
  alternatives: string;
  lookup?: string[];
  demo: boolean;
  sample?: { guess: string; why: string };
  guess: string;
  /** Until then the alternative is not rendered. */
  revealed: boolean;
  /** The guess is being saved. */
  revealing: boolean;
  choice?: Choice;
  why: string;
  canSaveWhy: boolean;
  /** The last choice and why are saved. */
  saved: boolean;
  error?: string;
  typing: boolean;
  onGuess(value: string): void;
  onReveal(): void;
  onChoice(value: Choice): void;
  onWhy(value: string): void;
  onSaveWhy(): void;
  onFillGuess(): void;
  onFillWhy(): void;
  ref?: Ref<HTMLElement>;
}

/** The card's markup for one state; RoadChoice holds the state. */
export function RoadChoiceView({
  alternatives,
  lookup,
  demo,
  sample,
  guess,
  revealed,
  revealing,
  choice,
  why,
  canSaveWhy,
  saved,
  error,
  typing,
  onGuess,
  onReveal,
  onChoice,
  onWhy,
  onSaveWhy,
  onFillGuess,
  onFillWhy,
  ref,
}: RoadChoiceViewProps) {
  const review = useT("review");
  const t = review.tryFirst;
  const id = useId();
  return (
    <section
      ref={ref}
      className="explain-card explain-card-alternatives tf-card"
    >
      <h3>
        <Shuffle size={15} aria-hidden="true" />
        {review.explain.cards.alternatives}
        <span className="tf-badge">{t.badge}</span>
      </h3>
      {!revealed && (
        <div className="tf-form">
          <label className="tf-label" htmlFor={`${id}-guess`}>
            {t.road.guessLabel}
          </label>
          <textarea
            id={`${id}-guess`}
            className="explain-note-input tf-input"
            rows={2}
            maxLength={understandingLimits.lineChars}
            placeholder={t.road.guessPlaceholder}
            value={guess}
            onChange={(event) => onGuess(event.target.value)}
          />
          <div className="tf-actions">
            <button
              type="button"
              className="tf-button tf-button-primary"
              aria-busy={revealing}
              onClick={onReveal}
            >
              {revealing ? (
                <LoaderCircle size={14} className="explain-spin" aria-hidden="true" />
              ) : (
                <Eye size={14} aria-hidden="true" />
              )}
              {revealing ? t.saving : t.road.reveal}
            </button>
            {demo && sample && (
              <button
                type="button"
                className="tf-button tf-fill"
                disabled={typing}
                onClick={onFillGuess}
              >
                {t.fill}
              </button>
            )}
          </div>
        </div>
      )}
      <div className="tf-reference" aria-live="polite">
        {revealed && (
          <div className="tf-reference-body">
            {guess && (
              <div className="tf-yours">
                <p className="tf-label">{t.road.yourGuess}</p>
                <p className="tf-yours-text">{guess}</p>
              </div>
            )}
            <MarkdownContent>{alternatives}</MarkdownContent>
          </div>
        )}
      </div>
      {revealed && (
        <div className="tf-form">
          <p className="tf-label" id={`${id}-choice`}>
            {t.road.choiceLabel}
          </p>
          <div
            className="tf-chips"
            role="radiogroup"
            aria-labelledby={`${id}-choice`}
            tabIndex={-1}
            data-focus="choices"
          >
            {roadChoices.map((value) => (
              <label className="tf-chip" key={value}>
                <input
                  type="radio"
                  name={`${id}-choice`}
                  value={value}
                  checked={choice === value}
                  onChange={() => onChoice(value)}
                />
                {t.road.choices[value]}
              </label>
            ))}
          </div>
          <label className="tf-label" htmlFor={`${id}-why`}>
            {t.road.whyLabel}
          </label>
          <textarea
            id={`${id}-why`}
            className="explain-note-input tf-input"
            rows={2}
            maxLength={understandingLimits.lineChars}
            value={why}
            onChange={(event) => onWhy(event.target.value)}
          />
          <div className="tf-actions">
            <button
              type="button"
              className="tf-button"
              disabled={!canSaveWhy}
              onClick={onSaveWhy}
            >
              {t.road.saveWhy}
            </button>
            {demo && sample && (
              <button
                type="button"
                className="tf-button tf-fill"
                disabled={typing}
                onClick={onFillWhy}
              >
                {t.fill}
              </button>
            )}
            <span className="tf-status" role="status">
              {saved ? t.road.saved : ""}
            </span>
          </div>
        </div>
      )}
      {lookup && lookup.length > 0 && (
        <p className="explain-lookup">
          <span>{review.explain.lookup}</span>
          {lookup.map((keyword) => (
            <code key={keyword}>{keyword}</code>
          ))}
        </p>
      )}
      {error && (
        <p className="tf-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
