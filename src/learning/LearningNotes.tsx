import { Suspense, lazy, useMemo, useState } from "react";
import { ArrowUpRight, BookOpen } from "lucide-react";
import {
  splitConceptHeading,
  type ChangeExplanation,
} from "../../shared/explanations";
import { demoRepo, demoRun } from "../demo";
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

const formatDate = (value?: string) =>
  value
    ? new Date(value).toLocaleString("zh-TW", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "未記錄";

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
  const { heading, body } = splitConceptHeading(note.explanation.concept);
  return (
    <article className="note-card">
      <span className="note-number">{note.repoName}</span>
      <div className="note-tag">{demo ? "示範" : note.runTitle}</div>
      <h2>{heading || note.path}</h2>
      <Suspense fallback={<p>{body}</p>}>
        <MarkdownContent>{body}</MarkdownContent>
      </Suspense>
      <div className="learning-note-tip">
        <strong>提示</strong>
        <Suspense fallback={<p>{note.explanation.tip}</p>}>
          <MarkdownContent>{note.explanation.tip}</MarkdownContent>
        </Suspense>
      </div>
      <code>{note.path}</code>
      <dl className="learning-note-meta">
        <dt>任務</dt>
        <dd>{note.runTitle}</dd>
        <dt>產生時間</dt>
        <dd>{demo ? "示範內容" : formatDate(note.generatedAt)}</dd>
      </dl>
      <button type="button" onClick={() => onOpen(note.runId, note.path)}>
        回到程式碼理解它 <ArrowUpRight size={15} />
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
  const [keyword, setKeyword] = useState(defaultKeyword);
  const [runId, setRunId] = useState(defaultRunId);
  const notes = useMemo(() => collectLearningNotes(runs, repos), [runs, repos]);
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
    [demoFiles],
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
          <span className="eyebrow">LEARN BY CONTRIBUTING</span>
          <h1 tabIndex={-1}>讓看懂的程式碼，成為你的經驗。</h1>
          <p>
            每個任務審查時產生的解說都會留在這裡，可以跨任務回顧同一個觀念。
          </p>
        </div>
      </div>
      <div className="learning-filters">
        <label>
          <span>關鍵字</span>
          <input
            type="search"
            value={keyword}
            placeholder="搜尋觀念、提示、檔案或任務"
            onChange={(event) => setKeyword(event.target.value)}
          />
        </label>
        <label>
          <span>任務</span>
          <select
            value={runId}
            onChange={(event) => setRunId(event.target.value)}
          >
            <option value="">全部任務</option>
            {runOptions.map((run) => (
              <option key={run.id} value={run.id}>
                {run.title}
              </option>
            ))}
          </select>
        </label>
        <span className="learning-count" aria-live="polite">
          {notes.length
            ? `${visible.length} / ${notes.length} 則筆記`
            : "尚無真實任務的筆記"}
        </span>
      </div>
      {notes.length === 0 ? (
        <div className="learning-empty">
          <BookOpen size={28} />
          <h2>還沒有屬於你的學習筆記</h2>
          <p>
            先在「Repositories」頁匯入 repository 並建立任務；進入審查後，每個檔案的解說會自動彙整到這裡。
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="learning-empty">
          <p>沒有符合篩選條件的筆記。</p>
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
            示範筆記
            <span className="learning-demo-label">示範</span>
          </h2>
          <p>來自內建示範任務的解說，用來預覽真實筆記的樣子。</p>
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
