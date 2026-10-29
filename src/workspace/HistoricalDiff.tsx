import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api";
import { useT } from "../i18n";
import { fileStatusLabel } from "../app/labels";
import { CommitPatch } from "../review/CommitHistory";
import type { DiffFile } from "../types";

interface DiffViewResult {
  files: DiffFile[];
  baseSha: string;
  headSha?: string;
}

/** History has its own files and selection, and no callbacks into the current review. */
export function HistoricalDiff({ runId, round, toolbar, showFiles = true }: {
  runId: string; round: string; toolbar?: ReactNode; showFiles?: boolean;
}) {
  const t = useT("workspace").diffRounds;
  const filesLabel = useT("workspace").changes.files;
  const status = useT("common").fileStatus;
  const [retry, setRetry] = useState(0);
  const key = `${runId}:${round}:${retry}`;
  const [result, setResult] = useState<{ key: string; value?: DiffViewResult; error?: string }>();
  const [selected, setSelected] = useState<{ key: string; path: string }>();
  const shown = result?.key === key ? result : undefined;
  const files = shown?.value?.files ?? [];
  const file = files.find((entry) => selected?.key === key && entry.path === selected.path) ?? files[0];

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({ round });
    api<DiffViewResult>(`/runs/${encodeURIComponent(runId)}/diff-view?${query}`).then(
      (value) => { if (!cancelled) setResult({ key, value }); },
      (error: Error) => { if (!cancelled) setResult({ key, error: error.message }); },
    );
    return () => { cancelled = true; };
  }, [key, runId, round]);

  return (
    <section className="historical-diff" aria-label={t.readOnly}>
        <div className={`review-grid explanation-hidden${!showFiles || !files.length ? " files-hidden" : ""}`}>
          {showFiles && files.length > 0 && <aside className="file-panel" aria-label={filesLabel}>
            <div className="file-panel-heading"><strong>{filesLabel} <span>{files.length}</span></strong></div>
            <div className="file-tree">
              {files.map((entry) => (
                <button type="button" key={entry.path} className={`file-item${file?.path === entry.path ? " selected" : ""}`}
                  title={entry.path} aria-pressed={file?.path === entry.path} onClick={() => setSelected({ key, path: entry.path })}>
                  <span className={`file-modified${entry.status === "deleted" ? " file-deleted" : ""}`}
                    title={fileStatusLabel(status, entry.status).title}>{fileStatusLabel(status, entry.status).badge}</span>
                  <span className="file-name">{entry.path}</span>
                  <span className="rv-additions">+{entry.additions}</span>
                  <span className="rv-deletions">−{entry.deletions}</span>
                </button>
              ))}
            </div>
          </aside>}
          <section className="diff-panel">
            <div className="diff-topbar">
              {toolbar}
              {shown?.value && <span className="historical-diff-range">
                <code>{shown.value.baseSha.slice(0, 7)}</code>{" → "}
                {shown.value.headSha ? <code>{shown.value.headSha.slice(0, 7)}</code> : t.workingTree}
              </span>}
            </div>
            {!shown ? <p className="historical-diff-status" role="status">{t.loading}</p>
              : shown.error ? <div className="historical-diff-status">
                  <p role="alert">{shown.error}</p>
                  <button type="button" className="button secondary" onClick={() => setRetry((value) => value + 1)}>{t.retry}</button>
                </div>
              : file ? <>
                  <div className="rv-file-header"><code>{file.path}</code></div>
                  {file.blocked ? <p className="historical-diff-status">{file.blocked}</p>
                    : file.patch ? <CommitPatch path={file.path} patch={file.patch} />
                      : <p className="historical-diff-status">{t.noText}</p>}
                </>
              : <p className="historical-diff-status">{t.empty}</p>}
          </section>
        </div>
    </section>
  );
}
