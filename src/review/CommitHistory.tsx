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
import type { Run } from "../types";
import { parseDiff } from "./diff";
import "./review.css";

const sourceLabel = (commit: CommitSummary) =>
  ({
    initial: "初次送出",
    review: `依 review 修正第 ${commit.round ?? "?"} 輪`,
    sync: "同步目標分支",
    adopted: "接續 GitHub 上的提交",
    other: "其他提交",
  })[commit.source];

/** A commit's patch for one file, read only: no review marks, no selection. */
function CommitPatch({ patch }: { patch: string }) {
  return (
    <div className="rv-code-scroll commit-patch">
      <div className="rv-unified-content">
        {parseDiff(patch).map((line) =>
          line.kind === "hunk" || line.kind === "note" ? (
            <div key={line.id} className="rv-hunk">
              <span>⋯</span>
              <code>{line.text}</code>
            </div>
          ) : (
            <div key={line.id} className={`rv-line rv-line-${line.kind}`}>
              <span className="rv-gutter rv-gutter-old">{line.oldLine}</span>
              <span className="rv-gutter">{line.newLine}</span>
              <span className="rv-sign" aria-hidden="true">
                {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}
              </span>
              <code>{line.text || " "}</code>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

export interface CommitListProps {
  commits: CommitSummary[];
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
  return (
    <ol className="commit-list">
      {commits.map((commit, index) => {
        const expanded = open === commit.sha;
        const merge = commit.parents.length > 1;
        return (
          <li key={commit.sha} className={`commit-item commit-${commit.source}`}>
            <div className="commit-head">
              <span className="commit-index">{index + 1}</span>
              {merge ? <GitMerge size={15} /> : <GitCommitHorizontal size={15} />}
              <span className="commit-source">{sourceLabel(commit)}</span>
              <time dateTime={commit.date}>
                {commit.date ? new Date(commit.date).toLocaleString("zh-TW") : ""}
              </time>
            </div>
            <p className="commit-subject">{commit.subject}</p>
            {commit.body && <p className="commit-body">{commit.body}</p>}
            <div className="commit-meta">
              {prUrl ? (
                <a href={`${prUrl}/commits/${commit.sha}`} target="_blank" rel="noreferrer">
                  <code>{commit.sha.slice(0, 7)}</code>
                  <ExternalLink size={11} />
                </a>
              ) : (
                <code>{commit.sha.slice(0, 7)}</code>
              )}
              <span>{commit.author}</span>
              <span>
                {commit.files} 個檔案 <span className="rv-additions">+{commit.additions}</span>{" "}
                <span className="rv-deletions">−{commit.deletions}</span>
              </span>
            </div>
            {merge && (
              <p className="commit-note">
                合併 commit：下面是相對於 PR 前一版的差異，包含目標分支帶進來的改動。
              </p>
            )}
            <button
              type="button"
              className="commit-toggle"
              aria-expanded={expanded}
              onClick={() => onToggle(commit.sha)}
            >
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              {expanded ? "收起" : "查看改了什麼"}
            </button>
            {expanded &&
              (detail === "loading" || !detail ? (
                <p className="commit-status" role="status">
                  <LoaderCircle className="spin" size={14} /> 讀取這個 commit 的改動…
                </p>
              ) : "error" in detail ? (
                <p className="commit-status commit-error" role="alert">
                  {detail.error}
                </p>
              ) : (
                <div className="commit-files">
                  <ul>
                    {detail.files.map((entry) => (
                      <li key={entry.path}>
                        <button
                          type="button"
                          aria-pressed={file === entry.path}
                          onClick={() => onFile(entry.path)}
                        >
                          <span className={`commit-file-status commit-file-${entry.status}`}>
                            {entry.status === "added" ? "A" : entry.status === "deleted" ? "D" : "M"}
                          </span>
                          <code>{entry.path}</code>
                          <span className="rv-additions">+{entry.additions}</span>
                          <span className="rv-deletions">−{entry.deletions}</span>
                        </button>
                        {file === entry.path &&
                          (entry.blocked ? (
                            <p className="commit-status">{entry.blocked}</p>
                          ) : (
                            <CommitPatch patch={entry.patch} />
                          ))}
                      </li>
                    ))}
                  </ul>
                  {detail.omitted > 0 && (
                    <p className="commit-status">
                      另外 {detail.omitted} 個檔案超過顯示上限，請到 GitHub 查看完整差異。
                    </p>
                  )}
                </div>
              ))}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Every commit of a published contribution: the first push, review rounds,
 * syncs with the target branch and commits taken over from GitHub.
 */
export function CommitHistory({ run, demo }: { run: Run; demo: boolean }) {
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
    api<{ commits: CommitSummary[] }>(`/runs/${run.id}/commits`).then(
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
    if (details[sha] && details[sha] !== "loading") return;
    setDetails((current) => ({ ...current, [sha]: "loading" }));
    api<CommitDetail>(`/runs/${run.id}/commits/${sha}`).then(
      (detail) => setDetails((current) => ({ ...current, [sha]: detail })),
      (failure: Error) =>
        setDetails((current) => ({ ...current, [sha]: { error: failure.message } })),
    );
  }

  return (
    <section className="commit-history" aria-labelledby="commit-history-title">
      <h2 id="commit-history-title">Commit 歷程</h2>
      {!published ? (
        <p className="commit-intro">
          {demo
            ? "示範資料還沒有送出 PR，所以沒有 commit。"
            : "這個貢獻還沒送出 PR。BELL 在送出前把修改保留為未提交的變更，送出時才建立第一個 commit；之後每一輪依 review 修正、同步目標分支，都會在這裡多一個 commit。"}
        </p>
      ) : error ? (
        <p className="commit-status commit-error" role="alert">
          {error}
        </p>
      ) : !commits ? (
        <p className="commit-status" role="status">
          <LoaderCircle className="spin" size={14} /> 讀取 commit 歷程…
        </p>
      ) : (
        <>
          <p className="commit-intro">
            PR 分支上的 {commits.length} 個 commit，依時間順序；標籤說明它在 BELL 裡的來源。
          </p>
          <CommitList
            commits={commits}
            prUrl={run.prUrl}
            open={open}
            detail={open ? details[open] : undefined}
            file={file}
            onToggle={toggle}
            onFile={(path) => setFile((current) => (current === path ? undefined : path))}
          />
        </>
      )}
    </section>
  );
}
