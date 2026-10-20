import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitCommitHorizontal,
  GitMerge,
  LoaderCircle,
} from "lucide-react";
import type { CommitDetail, CommitSummary } from "../../shared/commits";
import { api } from "../api";
import { getDemo } from "../demo";
import { useFormat, useLocale, useT } from "../i18n";
import type { Run } from "../types";
import { parseDiff } from "./diff";
import "./review.css";

/** A commit's patch for one file, read only: no review marks, no selection. */
function CommitPatch({ path, patch }: { path: string; patch: string }) {
  const t = useT("review");
  return (
    <div
      className="rv-code-scroll"
      role="region"
      aria-label={t.diff.regionLabel({ path })}
      // The patch can be wider than the card; the keyboard scrolls it too.
      tabIndex={0}
    >
      <div className="rv-unified-content">
        {parseDiff(patch).map((line) =>
          line.kind === "hunk" || line.kind === "note" ? (
            <div key={line.id} className="rv-hunk">
              <span aria-hidden="true">⋯</span>
              <code>{line.text}</code>
            </div>
          ) : (
            <div key={line.id} className={`rv-line rv-line-${line.kind}`}>
              <span className="rv-gutter rv-gutter-old">{line.oldLine}</span>
              <span className="rv-gutter">{line.newLine}</span>
              <span className="rv-sign" aria-hidden="true">
                {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}
              </span>
              <code>{line.text || " "}</code>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

export interface CommitListProps {
  commits: CommitSummary[];
  /** The PR's address; each short id links to the commit on it. */
  prUrl?: string;
  open?: string;
  detail?: CommitDetail | "loading" | { error: string };
  file?: string;
  onToggle: (sha: string) => void;
  onFile: (path: string) => void;
}

/** The PR branch's commits, oldest first, each opening to its files and their diffs. */
export function CommitList({
  commits,
  prUrl,
  open,
  detail,
  file,
  onToggle,
  onFile,
}: CommitListProps) {
  const t = useT("review").commits;
  const badges = useT("common").fileStatus;
  const format = useFormat();
  const source = (commit: CommitSummary) =>
    commit.source === "review"
      ? t.sources.review({ round: commit.round === undefined ? "?" : String(commit.round) })
      : t.sources[commit.source];
  return (
    <ol className="commit-list">
      {commits.map((commit, index) => {
        const expanded = open === commit.sha;
        const merge = commit.parents.length > 1;
        return (
          <li key={commit.sha} className={`commit-item commit-${commit.source}`}>
            <div className="commit-head">
              <strong>{index + 1}</strong>
              {merge ? (
                <GitMerge size={15} aria-hidden="true" />
              ) : (
                <GitCommitHorizontal size={15} aria-hidden="true" />
              )}
              <strong>{source(commit)}</strong>
              <time dateTime={commit.date}>
                {commit.date ? format.dateTime(commit.date) : ""}
              </time>
            </div>
            <p className="commit-subject">{commit.subject}</p>
            {commit.body && <p className="commit-body">{commit.body}</p>}
            <div className="commit-meta">
              {prUrl ? (
                <a href={`${prUrl}/commits/${commit.sha}`} target="_blank" rel="noreferrer">
                  <code>{commit.sha.slice(0, 7)}</code>
                  <ExternalLink size={11} aria-hidden="true" />
                </a>
              ) : (
                <code>{commit.sha.slice(0, 7)}</code>
              )}
              <span>{commit.author}</span>
              <span>
                {t.files({ count: commit.files })}{" "}
                <span className="rv-additions">+{commit.additions}</span>{" "}
                <span className="rv-deletions">−{commit.deletions}</span>
              </span>
            </div>
            {merge && <p>{t.mergeNote}</p>}
            <button
              type="button"
              className="button secondary"
              aria-expanded={expanded}
              onClick={() => onToggle(commit.sha)}
            >
              {expanded ? (
                <ChevronDown size={14} aria-hidden="true" />
              ) : (
                <ChevronRight size={14} aria-hidden="true" />
              )}
              {expanded ? t.hide : t.show}
            </button>
            {expanded &&
              (detail === "loading" || !detail ? (
                <p className="muted" role="status">
                  <LoaderCircle className="spin" size={14} aria-hidden="true" />{" "}
                  {t.loadingDetail}
                </p>
              ) : "error" in detail ? (
                <p className="inline-error" role="alert">
                  {detail.error}
                </p>
              ) : (
                // The files read as the code changes tab's file list.
                <>
                  <ul className="commit-files">
                    {detail.files.map((entry) => (
                      <li key={entry.path}>
                        <button
                          type="button"
                          className={`file-item${file === entry.path ? " selected" : ""}`}
                          aria-pressed={file === entry.path}
                          onClick={() => onFile(entry.path)}
                        >
                          <span
                            className={`file-modified${entry.status === "deleted" ? " file-deleted" : ""}`}
                            title={badges[entry.status].title}
                          >
                            {badges[entry.status].badge}
                          </span>
                          <code>{entry.path}</code>
                          <span className="rv-additions">+{entry.additions}</span>
                          <span className="rv-deletions">−{entry.deletions}</span>
                        </button>
                        {file === entry.path &&
                          (entry.blocked ? (
                            <p className="muted">{entry.blocked}</p>
                          ) : (
                            <CommitPatch path={entry.path} patch={entry.patch} />
                          ))}
                      </li>
                    ))}
                  </ul>
                  {detail.omitted > 0 && (
                    <p className="muted">{t.omitted({ count: detail.omitted })}</p>
                  )}
                </>
              ))}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Every commit of a published contribution: the first push, review rounds,
 * syncs with the target branch and commits taken over from GitHub. The
 * sample shows its prewritten history, labelled as such.
 */
export function CommitHistory({ run, demo }: { run: Run; demo: boolean }) {
  const t = useT("review").commits;
  const [locale] = useLocale();
  const sample = demo ? getDemo(locale).commitHistory : undefined;
  const [commits, setCommits] = useState<CommitSummary[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string>();
  const [details, setDetails] = useState<
    Record<string, CommitDetail | "loading" | { error: string }>
  >({});
  const [file, setFile] = useState<string>();
  const published = !demo && !!run.prUrl;

  useEffect(() => {
    setCommits(null);
    setError("");
    setOpen(undefined);
    setDetails({});
    if (!published) return;
    let cancelled = false;
    api<{ commits: CommitSummary[] }>(
      `/runs/${encodeURIComponent(run.id)}/commits`,
    ).then(
      (result) => !cancelled && setCommits(result.commits),
      (failure: Error) => !cancelled && setError(failure.message),
    );
    return () => {
      cancelled = true;
    };
  }, [run.id, run.publishCommit, published]);

  function toggle(sha: string) {
    setFile(undefined);
    if (open === sha) return setOpen(undefined);
    setOpen(sha);
    if (sample || (details[sha] && details[sha] !== "loading")) return;
    setDetails((current) => ({ ...current, [sha]: "loading" }));
    api<CommitDetail>(`/runs/${encodeURIComponent(run.id)}/commits/${sha}`).then(
      (detail) => setDetails((current) => ({ ...current, [sha]: detail })),
      (failure: Error) =>
        setDetails((current) => ({ ...current, [sha]: { error: failure.message } })),
    );
  }

  const list = (entries: CommitSummary[], prUrl?: string) => (
    <CommitList
      commits={entries}
      prUrl={prUrl}
      open={open}
      detail={open ? (sample ? sample.details[open] : details[open]) : undefined}
      file={file}
      onToggle={toggle}
      onFile={(path) => setFile((current) => (current === path ? undefined : path))}
    />
  );

  const intro = sample
    ? run.status === "published"
      ? t.publishedDemo
      : t.unpublishedDemo
    : !published
      ? t.unpublished
      : commits && !error
        ? t.intro({ count: commits.length })
        : undefined;
  return (
    <section
      className="activity-main commit-history"
      aria-labelledby="commit-history-title"
    >
      <div className="section-heading">
        <div>
          <h2 id="commit-history-title">{t.title}</h2>
          {intro && <p>{intro}</p>}
        </div>
      </div>
      {sample ? (
        list(sample.commits)
      ) : !published ? null : error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : !commits ? (
        <p className="muted" role="status">
          <LoaderCircle className="spin" size={14} aria-hidden="true" /> {t.loading}
        </p>
      ) : (
        list(commits, run.prUrl)
      )}
    </section>
  );
}
