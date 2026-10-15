import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, BookOpen, LoaderCircle, RefreshCw } from "lucide-react";
import {
  splitConceptHeading,
  type ChangeExplanation,
  type LearnerNote,
  type StoredExplanation,
} from "../../shared/explanations";
import type { RunStatus } from "../../shared/types";
import type { RunUnderstanding } from "../../shared/understanding";
import { api } from "../api";
import { getDemo } from "../demo";
import { useFormat, useLocale, useT } from "../i18n";
import type { DiffFile, Repo } from "../types";
import { LearningCounts } from "./LearningCounts";
import { LearningHeading } from "./LearningHeading";
import { LearningViewContent, LearningViewNav, useLearningView } from "./LearningViews";
import "./learning.css";

// Stored concepts use inline backticks and line breaks like the review panel; share its renderer and chunk.
const MarkdownContent = lazy(() =>
  import("../review/MarkdownContent").then((module) => ({
    default: module.MarkdownContent,
  })),
);

/**
 * One run of the learning record (GET /api/learning): its ready
 * explanations and the person's own notes, keyed by file path.
 */
export interface LearningRun {
  id: string;
  repoId: string;
  title: string;
  status: RunStatus;
  createdAt: string;
  locale?: string;
  prUrl?: string;
  explanations: Record<string, StoredExplanation>;
  notes: Record<string, LearnerNote>;
  /** The run's understanding check, for the learning record's check marks. */
  understanding?: RunUnderstanding;
  /** Approved with the understanding check off. */
  understandingCheckOff?: boolean;
}

/** One page of the learning record: 20 runs, newest first. */
export interface LearningRecordPage {
  runs: LearningRun[];
  /** Reads the next, older page; absent on the last page. */
  nextCursor?: string;
}

/** Reads one page of the learning record; without a cursor, the newest. */
export function fetchLearningPage(cursor?: string, signal?: AbortSignal) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return api<LearningRecordPage>(`/learning${query}`, { signal });
}

/** One file to study: its ready explanation, the person's note on it, or both. */
export interface LearningNote {
  runId: string;
  runTitle: string;
  repoName: string;
  path: string;
  /** When the explanation was generated, or the note last saved. */
  generatedAt?: string;
  explanation?: ChangeExplanation;
  /** What the person wrote about the file. */
  note?: string;
}

export interface LearningNotesProps {
  repos: Repo[];
  demoFiles: DiffFile[];
  /** Opens the task and selects the file; the App decides how to navigate. */
  onOpen: (runId: string, path: string) => void;
  /** Initial filter values; the inputs stay editable afterwards. */
  defaultKeyword?: string;
  defaultRunId?: string;
  /** A page already read: shown at once, without the first request. */
  initial?: LearningRecordPage;
  /** Reads one page; GET /api/learning by default. */
  loadPage?: (
    cursor?: string,
    signal?: AbortSignal,
  ) => Promise<LearningRecordPage>;
}

/**
 * Flattens the record into one entry per file, keeping the record's order
 * (newest run first) and, within a run, the newest entry first. A file
 * appears when its explanation is ready or the person wrote a note on it.
 */
export function collectLearningNotes(
  runs: LearningRun[],
  repos: Repo[],
): LearningNote[] {
  return runs.flatMap((run) => {
    const repoName =
      repos.find((repo) => repo.id === run.repoId)?.fullName || run.repoId;
    const paths = new Set([
      ...Object.keys(run.explanations ?? {}),
      ...Object.keys(run.notes ?? {}),
    ]);
    const entries: LearningNote[] = [];
    for (const path of paths) {
      const stored = run.explanations?.[path];
      const explanation =
        stored?.status === "ready" ? stored.content : undefined;
      const note = run.notes?.[path]?.text?.trim() || undefined;
      if (!explanation && !note) continue;
      entries.push({
        runId: run.id,
        runTitle: run.title,
        repoName,
        path,
        generatedAt: explanation
          ? stored?.generatedAt
          : run.notes?.[path]?.updatedAt,
        ...(explanation ? { explanation } : {}),
        ...(note ? { note } : {}),
      });
    }
    return entries.sort((a, b) =>
      (b.generatedAt || "").localeCompare(a.generatedAt || ""),
    );
  });
}

function matchesKeyword(note: LearningNote, keyword: string) {
  if (!keyword) return true;
  const haystack = [
    note.explanation?.concept,
    note.explanation?.tip,
    note.note,
    note.runTitle,
    note.repoName,
    note.path,
  ]
    .join("\n")
    .toLowerCase();
  return haystack.includes(keyword);
}

function NoteCard({
  note,
  demo,
  onOpen,
}: {
  note: LearningNote;
  demo: boolean;
  onOpen: LearningNotesProps["onOpen"];
}) {
  const t = useT("learning");
  const fmt = useFormat();
  const { heading, body } = note.explanation
    ? splitConceptHeading(note.explanation.concept)
    : { heading: "", body: "" };
  return (
    <article className="note-card">
      <span className="note-number">{note.repoName}</span>
      <div className="note-tags">
        <span className="note-tag">{demo ? t.demoTag : note.runTitle}</span>
        {!demo && note.explanation && (
          <span className="note-ai-label">{t.aiGenerated}</span>
        )}
      </div>
      {/* Focused after "Load more" brings this note in. */}
      <h2 tabIndex={-1}>{heading || note.path}</h2>
      {note.explanation && (
        <>
          <Suspense fallback={<p>{body}</p>}>
            <MarkdownContent>{body}</MarkdownContent>
          </Suspense>
          <div className="learning-note-tip">
            <strong>{t.tip}</strong>
            <Suspense fallback={<p>{note.explanation.tip}</p>}>
              <MarkdownContent>{note.explanation.tip}</MarkdownContent>
            </Suspense>
          </div>
        </>
      )}
      {note.note && (
        <div className="learning-own-note">
          <strong>{t.yourNote}</strong>
          <p>{note.note}</p>
        </div>
      )}
      <code>{note.path}</code>
      <dl className="learning-note-meta">
        <dt>{t.noteRun}</dt>
        <dd>{note.runTitle}</dd>
        <dt>{note.explanation || demo ? t.generatedAt : t.noteSaved}</dt>
        <dd>
          {demo
            ? t.sampleContent
            : note.generatedAt
              ? fmt.dateTime(note.generatedAt)
              : t.notRecorded}
        </dd>
      </dl>
      <button type="button" onClick={() => onOpen(note.runId, note.path)}>
        {t.openInCode} <ArrowUpRight size={15} />
      </button>
    </article>
  );
}

/**
 * The learning notes page: the explanations kept from every contribution
 * and the person's own notes, read page by page from GET /api/learning,
 * with the built-in sample's explanations below them.
 */
export function LearningNotes({
  repos,
  demoFiles,
  onOpen,
  defaultKeyword = "",
  defaultRunId = "",
  initial,
  loadPage = fetchLearningPage,
}: LearningNotesProps) {
  const t = useT("learning");
  const [locale] = useLocale();
  const { view, flags } = useLearningView();
  const [keyword, setKeyword] = useState(defaultKeyword);
  const [runId, setRunId] = useState(defaultRunId);
  const [record, setRecord] = useState<LearningRun[]>(initial?.runs ?? []);
  const [cursor, setCursor] = useState(initial?.nextCursor);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(
    initial ? "ready" : "loading",
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [moreError, setMoreError] = useState("");
  // Bumped by "Try again" after the first page failed.
  const [attempt, setAttempt] = useState(0);
  const load = useRef(loadPage);
  load.current = loadPage;
  const hasInitial = !!initial;
  useEffect(() => {
    if (hasInitial && attempt === 0) return;
    const controller = new AbortController();
    setStatus("loading");
    load.current(undefined, controller.signal).then(
      (page) => {
        if (controller.signal.aborted) return;
        setRecord(page.runs);
        setCursor(page.nextCursor);
        setStatus("ready");
      },
      (cause: unknown) => {
        if (controller.signal.aborted) return;
        setError((cause as Error).message);
        setStatus("failed");
      },
    );
    return () => controller.abort();
  }, [hasInitial, attempt]);

  const moreRequest = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => moreRequest.current?.abort(), []);
  const grid = useRef<HTMLDivElement>(null);
  const count = useRef<HTMLSpanElement>(null);
  // The visible notes before "Load more", to move focus to the first new one.
  const focusFrom = useRef<number | undefined>(undefined);

  const notes = useMemo(
    () => collectLearningNotes(record, repos),
    [record, repos],
  );
  const { run: demoRun, repo: demoRepo } = getDemo(locale);
  const demoNotes = useMemo<LearningNote[]>(
    () =>
      demoFiles
        .filter((file) => file.explanation)
        .map((file) => ({
          runId: demoRun.id,
          runTitle: demoRun.title,
          repoName: demoRepo.fullName,
          path: file.path,
          explanation: file.explanation!,
        })),
    [demoFiles, demoRun, demoRepo],
  );
  const needle = keyword.trim().toLowerCase();
  const visible = notes.filter(
    (note) =>
      (!runId || note.runId === runId) && matchesKeyword(note, needle),
  );
  const visibleDemo = runId
    ? []
    : demoNotes.filter((note) => matchesKeyword(note, needle));
  const runOptions = record.filter((run) =>
    notes.some((note) => note.runId === run.id),
  );

  useEffect(() => {
    const from = focusFrom.current;
    if (from === undefined || loadingMore) return;
    focusFrom.current = undefined;
    const headings = grid.current?.querySelectorAll<HTMLElement>(
      ".note-card h2",
    );
    // Without a new visible note, the count says what the page brought.
    if (headings && headings.length > from) headings[from].focus();
    else count.current?.focus();
  }, [visible.length, loadingMore]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    const controller = new AbortController();
    moreRequest.current = controller;
    setLoadingMore(true);
    setMoreError("");
    try {
      const page = await load.current(cursor, controller.signal);
      if (controller.signal.aborted) return;
      // Counted now, not when the click came: the filters may have changed.
      focusFrom.current =
        grid.current?.querySelectorAll(".note-card h2").length ?? 0;
      setRecord((previous) => [
        ...previous,
        ...page.runs.filter(
          (run) => !previous.some((known) => known.id === run.id),
        ),
      ]);
      setCursor(page.nextCursor);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setMoreError((cause as Error).message);
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false);
    }
  }

  if (view !== "notes")
    return (
      <>
        <LearningHeading notes={false} />
        <LearningViewNav view={view} flags={flags} />
        <LearningViewContent view={view} repos={repos} onOpen={onOpen} />
      </>
    );
  return (
    <>
      <LearningHeading />
      <LearningViewNav view={view} flags={flags} />
      <LearningCounts />
      <div className="learning-filters">
        <label>
          <span>{t.keyword}</span>
          <input
            type="search"
            value={keyword}
            placeholder={t.keywordPlaceholder}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </label>
        <label>
          <span>{t.run}</span>
          <select
            value={runId}
            onChange={(event) => setRunId(event.target.value)}
          >
            <option value="">{t.allRuns}</option>
            {runOptions.map((run) => (
              <option key={run.id} value={run.id}>
                {run.title}
              </option>
            ))}
          </select>
        </label>
        <span
          className="learning-count"
          id="learning-count"
          aria-live="polite"
          tabIndex={-1}
          ref={count}
        >
          {status === "loading"
            ? t.loading
            : status === "failed"
              ? ""
              : notes.length
                ? cursor
                  ? t.noteCountMore({
                      visible: visible.length,
                      total: notes.length,
                    })
                  : t.noteCount({ visible: visible.length, total: notes.length })
                : t.noRealNotes}
        </span>
      </div>
      {status === "loading" ? (
        <div className="learning-empty" role="status">
          <LoaderCircle className="spin" size={24} aria-hidden="true" />
          <p>{t.loading}</p>
        </div>
      ) : status === "failed" ? (
        <div className="learning-empty is-error" role="alert">
          <h2>{t.loadFailed}</h2>
          <p>{error}</p>
          <button
            type="button"
            className="button secondary"
            onClick={() => setAttempt((value) => value + 1)}
          >
            <RefreshCw size={15} aria-hidden="true" /> {t.retry}
          </button>
        </div>
      ) : notes.length === 0 ? (
        <div className="learning-empty">
          <BookOpen size={28} aria-hidden="true" />
          <h2>{t.emptyTitle}</h2>
          <p>{t.emptyBody}</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="learning-empty">
          <p>{t.noMatches}</p>
        </div>
      ) : (
        <div className="learning-grid" ref={grid}>
          {visible.map((note) => (
            <NoteCard
              key={`${note.runId}:${note.path}`}
              note={note}
              demo={false}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}
      {status === "ready" && cursor && (
        <div className="learning-more">
          <button
            type="button"
            className="button secondary"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            aria-describedby="learning-count"
          >
            {loadingMore && (
              <LoaderCircle className="spin" size={15} aria-hidden="true" />
            )}
            {loadingMore ? t.loadingMore : t.loadMore}
          </button>
          {moreError && (
            <p className="inline-error" role="alert">
              {t.loadMoreFailed({ error: moreError })}
            </p>
          )}
        </div>
      )}
      {visibleDemo.length > 0 && (
        <section className="learning-demo" aria-labelledby="learning-demo-title">
          <h2 id="learning-demo-title">
            {t.demoTitle}
            <span className="learning-demo-label">{t.demoTag}</span>
          </h2>
          <p>{t.demoIntro}</p>
          <div className="learning-grid">
            {visibleDemo.map((note) => (
              <NoteCard key={note.path} note={note} demo onOpen={onOpen} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
