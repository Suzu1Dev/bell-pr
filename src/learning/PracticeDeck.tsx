/**
 * The practice deck, the learning page's Practice view (loaded on its own).
 *
 * GET /api/learning/practice gives at most 5 due items from the person's
 * own records, interleaved across projects and taste dimensions. They show
 * one at a time: the question with an answer field and how sure the
 * person is, then the reference, their earlier correction or lesson and a
 * way back to the code, then a self-grade. POST /api/runs/:id/practice
 * records the grade and the confidence only; the answer never leaves the
 * page. The next review follows the 1, 3, 7 and 21 day ladder.
 *
 * Nothing here adds up toward anything and nothing reminds anyone: the
 * only nudge is the sidebar's "N ready". While the person has nothing
 * scheduled (and in the demo, which sends no request), the built-in
 * sample's items show, graded on this page only.
 */
import { useEffect, useId, useRef, useState } from "react";
import { ArrowUpRight, LoaderCircle, RefreshCw } from "lucide-react";
import { nextPractice, type PracticeItem } from "../../shared/practice";
import {
  confidences,
  selfGrades,
  type Confidence,
  type SelfGrade,
} from "../../shared/understanding";
import { ApiError, api, send } from "../api";
import { usePresentation } from "../app/presentation";
import { getDemo } from "../demo";
import { useLocale, useT } from "../i18n";
import type { Repo, Run } from "../types";
import { practiceChangedEvent } from "./practiceReady";

/** Items in one session, as the server sends them. */
export const practiceSessionSize = 5;
const dayMs = 24 * 60 * 60 * 1000;

/** GET /api/learning/practice */
export interface PracticeDeckData {
  items: PracticeItem[];
  /** When the next item is due, while none is due now. */
  nextDueAt?: string;
}

export function fetchPractice(signal?: AbortSignal) {
  return api<PracticeDeckData>("/learning/practice", { signal });
}

/** What grading an item needs, and when the item is next due (ISO time). */
export type RecordPractice = (
  item: PracticeItem,
  answer: { confidence: Confidence; grade: SelfGrade },
) => Promise<string | undefined>;

/**
 * POST /api/runs/:id/practice with the item's key, the confidence and the
 * grade; resolves with the item's next due time from the run it answers.
 */
export const recordPractice: RecordPractice = async (item, answer) => {
  const { run } = await api<{ run?: Pick<Run, "practice"> }>(
    `/runs/${encodeURIComponent(item.runId)}/practice`,
    send("POST", { key: item.key, ...answer }),
  );
  return run?.practice?.[item.key]?.dueAt;
};

/**
 * Grades a sample item on this page only. The sample keeps no schedule,
 * so it is treated as a new item: Got it comes back in 3 days, Partly and
 * Missed in 1.
 */
const recordSample: RecordPractice = async (_item, { confidence, grade }) =>
  nextPractice(undefined, grade, new Date().toISOString(), confidence).dueAt;

/** Whole days from now until `dueAt`, at least 1. */
export function daysUntil(dueAt: string, now = Date.now()) {
  return Math.max(1, Math.round((Date.parse(dueAt) - now) / dayMs));
}

/** Tells the sidebar's "N ready" to count again. */
function announceChange() {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(practiceChangedEvent));
}

type Stage = "ask" | "reveal" | "graded";

/** What a card shows; a card starts at "ask" unless a test says otherwise. */
export interface PracticeCardState {
  stage: Stage;
  answer: string;
  confidence?: Confidence;
  grade?: SelfGrade;
  /** When the item comes back; undefined when the server did not say. */
  dueAt?: string;
}

/** One item: ask, reveal, grade. */
export function PracticeCard({
  item,
  repoName,
  record,
  onOpen,
  onNext,
  last,
  focusOnMount = false,
  initial,
}: {
  item: PracticeItem;
  repoName: string;
  record: RecordPractice;
  /** Opens the run at the file, for "Study it in the code". */
  onOpen: (runId: string, path: string) => void;
  onNext: () => void;
  /** The session's last item: its button reads Done. */
  last: boolean;
  /** Move the focus to the question when the card appears. */
  focusOnMount?: boolean;
  initial?: Partial<PracticeCardState>;
}) {
  const t = useT("learning");
  const p = t.practice;
  const id = useId();
  const [state, setState] = useState<PracticeCardState>({
    stage: "ask",
    answer: "",
    ...initial,
  });
  const [needConfidence, setNeedConfidence] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const question = useRef<HTMLHeadingElement>(null);
  const reveal = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const firstChip = useRef<HTMLInputElement>(null);
  const shown = useRef(state.stage);

  useEffect(() => {
    if (focusOnMount) question.current?.focus();
  }, [focusOnMount]);
  // The button that moved the card on is gone: the focus follows the card.
  useEffect(() => {
    if (shown.current === state.stage) return;
    shown.current = state.stage;
    if (state.stage === "reveal") reveal.current?.focus();
    if (state.stage === "graded") next.current?.focus();
  }, [state.stage]);

  const showAnswer = () => {
    if (!state.confidence) {
      setNeedConfidence(true);
      firstChip.current?.focus();
      return;
    }
    setNeedConfidence(false);
    setState((value) => ({ ...value, stage: "reveal" }));
  };
  const submitGrade = async (value: SelfGrade) => {
    if (saving || !state.confidence) return;
    setSaving(true);
    setError("");
    try {
      const dueAt = await record(item, { confidence: state.confidence, grade: value });
      setState((current) => ({ ...current, stage: "graded", grade: value, dueAt }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSaving(false);
    }
  };

  const revealed = state.stage !== "ask";
  const path = item.path;
  const earlierLabel =
    item.kind === "feedback" ? p.earlier.lesson : p.earlier.correction;
  return (
    <article className="practice-card" aria-labelledby={`${id}-question`}>
      <div className="practice-card-meta">
        <span className="note-tag">{p.kinds[item.kind]}</span>
        {item.dimension && (
          <span className="practice-dimension">{t.dimensions[item.dimension]}</span>
        )}
        <span className="note-number">{repoName}</span>
      </div>
      <h3 id={`${id}-question`} tabIndex={-1} ref={question}>
        {item.question}
      </h3>
      {path && <code className="practice-path">{path}</code>}
      <label className="practice-answer">
        <span>{p.answer}</span>
        <textarea
          rows={3}
          value={state.answer}
          readOnly={revealed}
          aria-describedby={`${id}-answer-help`}
          onChange={(event) =>
            setState((value) => ({ ...value, answer: event.target.value }))
          }
        />
      </label>
      <p id={`${id}-answer-help`} className="practice-help">
        {p.answerHelp}
      </p>
      <fieldset className="practice-choice" disabled={revealed}>
        <legend>{p.confidence}</legend>
        {confidences.map((value, index) => (
          <label key={value} className="practice-chip">
            <input
              type="radio"
              name={`${id}-confidence`}
              value={value}
              checked={state.confidence === value}
              ref={index === 0 ? firstChip : undefined}
              onChange={() => {
                setNeedConfidence(false);
                setState((current) => ({ ...current, confidence: value }));
              }}
            />
            <span>{p.confidences[value]}</span>
          </label>
        ))}
      </fieldset>
      {needConfidence && (
        <p className="practice-hint" role="alert">
          {p.chooseConfidence}
        </p>
      )}
      {!revealed ? (
        <div className="practice-actions">
          <button type="button" className="button primary" onClick={showAnswer}>
            {p.show}
          </button>
        </div>
      ) : (
        <div
          className="practice-reveal"
          role="group"
          tabIndex={-1}
          ref={reveal}
          aria-labelledby={`${id}-reference`}
        >
          <div className="practice-reference">
            <strong id={`${id}-reference`}>{p.reference}</strong>
            {item.reference && item.kind !== "feedback" && (
              <span className="note-ai-label">{p.aiWritten}</span>
            )}
            <p>{item.reference ?? p.noReference}</p>
          </div>
          {item.earlier && (
            <div className="learning-own-note">
              <strong>{earlierLabel}</strong>
              <p>{item.earlier}</p>
            </div>
          )}
          {path &&
            (item.codeAvailable ? (
              <button
                type="button"
                className="practice-study"
                onClick={() => onOpen(item.runId, path)}
              >
                {p.study} <ArrowUpRight size={15} aria-hidden="true" />
              </button>
            ) : (
              <p className="practice-help">{p.cleanedUp}</p>
            ))}
          {state.stage === "reveal" ? (
            <div
              className="practice-grades"
              role="group"
              aria-labelledby={`${id}-grade`}
              aria-busy={saving || undefined}
            >
              <p id={`${id}-grade`} className="practice-grade-label">
                {p.grade}
              </p>
              {selfGrades.map((value) => (
                <button
                  key={value}
                  type="button"
                  className="practice-grade"
                  data-grade={value}
                  disabled={saving}
                  onClick={() => void submitGrade(value)}
                >
                  <strong>{p.grades[value]}</strong>
                  <small>{p.gradeHelp[value]}</small>
                </button>
              ))}
              {saving && (
                <p className="practice-help" role="status">
                  <LoaderCircle className="spin" size={14} aria-hidden="true" />{" "}
                  {p.saving}
                </p>
              )}
              {error && (
                <p className="inline-error" role="alert">
                  {p.saveFailed({ error })}
                </p>
              )}
            </div>
          ) : (
            <div className="practice-after">
              <p className="practice-next" role="status">
                {state.dueAt
                  ? p.nextReview({ days: daysUntil(state.dueAt) })
                  : p.saved}
              </p>
              <button
                type="button"
                className="button secondary"
                ref={next}
                onClick={onNext}
              >
                {last ? p.finish : p.next}
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

/** Items one at a time; after the last one, `onFinished`. */
function PracticeSession({
  items,
  repos,
  record,
  onOpen,
  onFinished,
}: {
  items: PracticeItem[];
  repos: Repo[];
  record: RecordPractice;
  onOpen: (runId: string, path: string) => void;
  onFinished: () => void;
}) {
  const [index, setIndex] = useState(0);
  const item = items[Math.min(index, items.length - 1)];
  if (!item) return null;
  const last = index >= items.length - 1;
  const repoName =
    repos.find((repo) => repo.id === item.repoId)?.fullName || item.repoId;
  return (
    <PracticeCard
      key={item.key}
      item={item}
      repoName={repoName}
      record={record}
      onOpen={onOpen}
      last={last}
      focusOnMount={index > 0}
      onNext={() => (last ? onFinished() : setIndex(index + 1))}
    />
  );
}

/** The built-in sample's items, graded on this page only. */
function SampleDeck({
  onOpen,
}: {
  onOpen: (runId: string, path: string) => void;
}) {
  const t = useT("learning");
  const [locale] = useLocale();
  const { practiceSample = [], repo } = getDemo(locale);
  const [done, setDone] = useState(false);
  if (!practiceSample.length) return null;
  return (
    <section className="learning-demo practice-sample" aria-labelledby="practice-sample-title">
      <h2 id="practice-sample-title">
        {t.practice.sampleTitle}
        <span className="learning-demo-label">{t.demoTag}</span>
      </h2>
      <p>{t.practice.sampleIntro}</p>
      {done ? (
        <p className="practice-done" role="status">
          {t.practice.sampleDone}
        </p>
      ) : (
        <PracticeSession
          items={practiceSample.slice(0, practiceSessionSize)}
          repos={[repo]}
          record={recordSample}
          onOpen={onOpen}
          onFinished={() => setDone(true)}
        />
      )}
    </section>
  );
}

type DeckState =
  | { status: "loading" }
  | { status: "failed"; error: string }
  | ({ status: "ready" } & PracticeDeckData);

export interface PracticeDeckProps {
  repos: Repo[];
  /** Opens a run at a file, as "Study it in the code" in the notes does. */
  onOpen: (runId: string, path: string) => void;
  /** The demo (`demo=play`): only the sample, and no request. */
  demo?: boolean;
  /** A deck already read: shown at once, without the first request. */
  initial?: PracticeDeckData;
  load?: (signal?: AbortSignal) => Promise<PracticeDeckData>;
  record?: RecordPractice;
}

export function PracticeDeck({
  repos,
  onOpen,
  demo: demoFlag,
  initial,
  load = fetchPractice,
  record = recordPractice,
}: PracticeDeckProps) {
  const t = useT("learning");
  const p = t.practice;
  const { play } = usePresentation();
  const demo = demoFlag ?? play;
  const [state, setState] = useState<DeckState>(
    demo ? { status: "ready", items: [] } : initial ? { status: "ready", ...initial } : { status: "loading" },
  );
  // Bumped by "Try again" and after the last item, to read the deck again.
  const [round, setRound] = useState(0);
  const loader = useRef(load);
  loader.current = load;
  const hasInitial = !!initial;
  useEffect(() => {
    if (demo || (hasInitial && round === 0)) return;
    const controller = new AbortController();
    setState({ status: "loading" });
    loader.current(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted)
          setState({ status: "ready", items: data.items ?? [], nextDueAt: data.nextDueAt });
      },
      (failure: unknown) => {
        if (controller.signal.aborted) return;
        // A server without the practice routes has nothing to practise.
        if (failure instanceof ApiError && failure.status === 404)
          setState({ status: "ready", items: [] });
        else
          setState({
            status: "failed",
            error: failure instanceof Error ? failure.message : String(failure),
          });
      },
    );
    return () => controller.abort();
  }, [demo, hasInitial, round]);

  const graded: RecordPractice = async (item, answer) => {
    const dueAt = await record(item, answer);
    announceChange();
    return dueAt;
  };
  const items = state.status === "ready" ? state.items.slice(0, practiceSessionSize) : [];
  // The sample shows while the person has nothing of their own scheduled.
  const showSample =
    demo ||
    state.status === "failed" ||
    (state.status === "ready" && !items.length && !state.nextDueAt);

  return (
    <section className="practice" aria-labelledby="practice-title">
      <div className="practice-head">
        <h2 id="practice-title">{p.title}</h2>
        <p>{p.intro}</p>
      </div>
      {demo ? null : state.status === "loading" ? (
        <div className="learning-empty" role="status" aria-busy="true">
          <LoaderCircle className="spin" size={24} aria-hidden="true" />
          <p>{p.loading}</p>
        </div>
      ) : state.status === "failed" ? (
        <div className="learning-empty is-error" role="alert">
          <p>{p.loadFailed({ error: state.error })}</p>
          <button
            type="button"
            className="button secondary"
            onClick={() => setRound((value) => value + 1)}
          >
            <RefreshCw size={15} aria-hidden="true" /> {p.retry}
          </button>
        </div>
      ) : items.length ? (
        <PracticeSession
          key={round}
          items={items}
          repos={repos}
          record={graded}
          onOpen={onOpen}
          onFinished={() => setRound((value) => value + 1)}
        />
      ) : (
        <div className="learning-empty practice-empty">
          <p className="practice-empty-title">{p.empty}</p>
          {state.nextDueAt && (
            <p>{p.nextReview({ days: daysUntil(state.nextDueAt) })}</p>
          )}
        </div>
      )}
      {showSample && <SampleDeck onOpen={onOpen} />}
    </section>
  );
}
