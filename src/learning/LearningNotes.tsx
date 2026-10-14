import { Suspense, lazy, useMemo, useState } from "react";
import { ArrowUpRight, BookOpen } from "lucide-react";
import {
  splitConceptHeading,
  type ChangeExplanation,
} from "../../shared/explanations";
import { getDemo } from "../demo";
import { useFormat, useLocale, useT } from "../i18n";
import type { DiffFile, Repo, RunSummary } from "../types";
import "./learning.css";

// Stored concepts use inline backticks and line breaks like the review panel; share its renderer and chunk.
const MarkdownContent = lazy(() =>
  import("../review/MarkdownContent").then((module) => ({
    default: module.MarkdownContent,
  })),
);

/** One ready explanation, flattened with the task and repository it came from. */
export interface LearningNote {
  runId: string;
  runTitle: string;
  repoName: string;
  path: string;
  generatedAt?: string;
  explanation: ChangeExplanation;
}

export interface LearningNotesProps {
  runs: RunSummary[];
  repos: Repo[];
  demoFiles: DiffFile[];
  /** Opens the task and selects the file; the App decides how to navigate. */
  onOpen: (runId: string, path: string) => void;
  /** Initial filter values; the inputs stay editable afterwards. */
  defaultKeyword?: string;
  defaultRunId?: string;
}

/** Flattens every stored explanation that is ready, newest first. */
export function collectLearningNotes(runs: RunSummary[], repos: Repo[]): LearningNote[] {
  const notes: LearningNote[] = [];
  for (const run of runs) {
    const repoName =
      repos.find((repo) => repo.id === run.repoId)?.fullName || run.repoId;
    for (const [path, stored] of Object.entries(run.explanations || {})) {
      if (stored.status !== "ready" || !stored.content) continue;
      notes.push({
        runId: run.id,
        runTitle: run.title,
        repoName,
        path,
        generatedAt: stored.generatedAt,
        explanation: stored.content,
      });
    }
  }
  return notes.sort((a, b) =>
    (b.generatedAt || "").localeCompare(a.generatedAt || ""),
  );
}

function matchesKeyword(note: LearningNote, keyword: string) {
  if (!keyword) return true;
  const haystack = [
    note.explanation.concept,
    note.explanation.tip,
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
  const { heading, body } = splitConceptHeading(note.explanation.concept);
  return (
    <article className="note-card">
      <span className="note-number">{note.repoName}</span>
      <div className="note-tag">{demo ? t.demoTag : note.runTitle}</div>
      <h2>{heading || note.path}</h2>
      <Suspense fallback={<p>{body}</p>}>
        <MarkdownContent>{body}</MarkdownContent>
      </Suspense>
      <div className="learning-note-tip">
        <strong>{t.tip}</strong>
        <Suspense fallback={<p>{note.explanation.tip}</p>}>
          <MarkdownContent>{note.explanation.tip}</MarkdownContent>
        </Suspense>
      </div>
      <code>{note.path}</code>
      <dl className="learning-note-meta">
        <dt>{t.noteRun}</dt>
        <dd>{note.runTitle}</dd>
        <dt>{t.generatedAt}</dt>
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

export function LearningNotes({
  runs,
  repos,
  demoFiles,
  onOpen,
  defaultKeyword = "",
  defaultRunId = "",
}: LearningNotesProps) {
  const t = useT("learning");
  const [locale] = useLocale();
  const [keyword, setKeyword] = useState(defaultKeyword);
  const [runId, setRunId] = useState(defaultRunId);
  const notes = useMemo(() => collectLearningNotes(runs, repos), [runs, repos]);
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
  const runOptions = runs.filter((run) =>
    notes.some((note) => note.runId === run.id),
  );

  return (
    <>
      <div className="page-title">
        <div>
          <span className="eyebrow">{t.eyebrow}</span>
          <h1 tabIndex={-1}>{t.title}</h1>
          <p>{t.intro}</p>
        </div>
      </div>
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
        <span className="learning-count" aria-live="polite">
          {notes.length
            ? t.noteCount({ visible: visible.length, total: notes.length })
            : t.noRealNotes}
        </span>
      </div>
      {notes.length === 0 ? (
        <div className="learning-empty">
          <BookOpen size={28} />
          <h2>{t.emptyTitle}</h2>
          <p>{t.emptyBody}</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="learning-empty">
          <p>{t.noMatches}</p>
        </div>
      ) : (
        <div className="learning-grid">
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
