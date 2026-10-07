import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  FolderGit2,
  GitPullRequest,
  Loader2,
  Search,
  X,
} from "lucide-react";
import type { Repo, Run } from "../types";
import "./command-palette.css";

export interface CommandPaletteProps {
  repos: Repo[];
  runs: Run[];
  currentRepoId?: string;
  currentRunId: string;
  statusLabels: Record<Run["status"], string>;
  onClose: () => void;
  onSelectRun: (id: string) => Promise<boolean>;
  onSelectRepo: (id: string) => void;
}

export function CommandPalette({
  repos,
  runs,
  currentRepoId,
  currentRunId,
  statusLabels,
  onClose,
  onSelectRun,
  onSelectRepo,
}: CommandPaletteProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const projectList = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  const restoreFocus = useRef(true);
  const activating = useRef(false);
  const composing = useRef(false);
  const [repoId, setRepoId] = useState(
    currentRepoId ?? runs.find((run) => run.id === currentRunId)?.repoId ?? repos[0]?.id,
  );
  const [query, setQuery] = useState("");
  const [highlightedId, setHighlightedId] = useState(currentRunId);
  const [loadingId, setLoadingId] = useState("");
  const [error, setError] = useState("");
  const titleId = useId();
  const listId = useId();
  const selectedRepo = repos.find((repo) => repo.id === repoId) ?? repos[0];
  const repoRuns = useMemo(
    () => runs.filter((run) => run.repoId === selectedRepo?.id),
    [runs, selectedRepo?.id],
  );
  const filteredRuns = useMemo(() => {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return repoRuns.filter((run) => {
      const text = `${run.title} ${run.branch} ${statusLabels[run.status]}`.toLocaleLowerCase();
      return terms.every((term) => text.includes(term));
    });
  }, [repoRuns, query, statusLabels]);
  const highlightedRun = filteredRuns.find((run) => run.id === highlightedId) ?? filteredRuns[0];
  const optionId = (id: string) => `${listId}-${encodeURIComponent(id)}`;

  useEffect(() => {
    mounted.current = true;
    const panel = dialog.current;
    const opener = document.activeElement instanceof HTMLElement
      ? document.activeElement : null;
    panel?.showModal();
    search.current?.focus();
    return () => {
      mounted.current = false;
      panel?.close();
      if (restoreFocus.current && opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    if (selectedRepo && repoId !== selectedRepo.id) setRepoId(selectedRepo.id);
  }, [selectedRepo?.id, repoId]);

  useEffect(() => {
    projectList.current
      ?.querySelector<HTMLElement>('[aria-pressed="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedRepo?.id]);

  useEffect(() => {
    const id = highlightedRun?.id ?? "";
    if (id !== highlightedId) setHighlightedId(id);
  }, [highlightedRun?.id, highlightedId]);

  useEffect(() => {
    if (highlightedRun) {
      document.getElementById(optionId(highlightedRun.id))?.scrollIntoView({ block: "nearest" });
    }
  }, [highlightedRun?.id]);

  const selectProject = (id: string) => {
    if (activating.current) return;
    setRepoId(id);
    setQuery("");
    setError("");
    setHighlightedId(runs.find((run) => run.repoId === id && run.id === currentRunId)?.id ?? "");
    search.current?.focus();
  };

  const activateRun = async (id: string) => {
    if (activating.current) return;
    activating.current = true;
    setLoadingId(id);
    setError("");
    try {
      const opened = await onSelectRun(id);
      if (opened && mounted.current) {
        restoreFocus.current = false;
        dialog.current?.close();
        onClose();
      }
    } catch (cause) {
      if (mounted.current) {
        setError(cause instanceof Error ? cause.message : "無法開啟這項貢獻，請重試。");
      }
    } finally {
      activating.current = false;
      if (mounted.current) setLoadingId("");
    }
  };

  return (
    <dialog
      ref={dialog}
      className="command-palette"
      aria-labelledby={titleId}
      aria-busy={!!loadingId}
      onCancel={(event) => {
        event.preventDefault();
        if (!composing.current) onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || composing.current || event.nativeEvent.keyCode === 229) return;
        if (event.altKey || event.ctrlKey || event.metaKey || activating.current) return;
        if (event.shiftKey && event.key !== "{" && event.key !== "}") return;
        if (["{", "}", "[", "]"].includes(event.key)) {
          if (!repos.length) return;
          event.preventDefault();
          event.stopPropagation();
          const direction = event.key === "{" || event.key === "[" ? -1 : 1;
          const index = repos.findIndex((repo) => repo.id === selectedRepo?.id);
          selectProject(repos[(index + direction + repos.length) % repos.length].id);
        } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          event.stopPropagation();
          if (!filteredRuns.length) return;
          const index = filteredRuns.findIndex((run) => run.id === highlightedRun?.id);
          const direction = event.key === "ArrowUp" ? -1 : 1;
          const next = Math.max(0, Math.min(filteredRuns.length - 1, index + direction));
          setHighlightedId(filteredRuns[next].id);
          search.current?.focus();
        } else if (event.key === "Enter" && event.target === search.current && highlightedRun) {
          event.preventDefault();
          event.stopPropagation();
          void activateRun(highlightedRun.id);
        }
      }}
    >
      <header className="command-palette-header">
        <div>
          <span className="command-palette-mark"><GitPullRequest size={17} aria-hidden="true" /></span>
          <h2 id={titleId}>切換專案與貢獻</h2>
        </div>
        <button type="button" className="command-palette-close" aria-label="關閉快速切換" onClick={onClose}>
          <X size={17} aria-hidden="true" />
        </button>
      </header>
      <div className="command-palette-body">
        <nav className="command-palette-projects" aria-label="選擇專案">
          <div className="command-palette-section-label">專案 <span>{repos.length}</span></div>
          <div ref={projectList} className="command-palette-project-list">
            {repos.map((repo) => {
              const count = runs.filter((run) => run.repoId === repo.id).length;
              return (
                <button
                  type="button"
                  key={repo.id}
                  aria-pressed={selectedRepo?.id === repo.id}
                  aria-label={`${repo.fullName}，${count} 項貢獻${repo.id === currentRepoId ? "，目前專案" : ""}`}
                  disabled={!!loadingId}
                  onClick={() => selectProject(repo.id)}
                >
                  <FolderGit2 size={17} aria-hidden="true" />
                  <span><strong>{repo.name}</strong><small>{repo.owner}</small></span>
                  <em>{count}</em>
                </button>
              );
            })}
            {!repos.length && <p className="command-palette-no-projects">尚未匯入專案</p>}
          </div>
        </nav>
        <section className="command-palette-contributions" aria-label="貢獻清單">
          <div className="command-palette-search">
            <Search size={18} aria-hidden="true" />
            <input
              ref={search}
              type="text"
              role="combobox"
              aria-label="搜尋所選專案的貢獻"
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={highlightedRun ? optionId(highlightedRun.id) : undefined}
              autoComplete="off"
              spellCheck={false}
              placeholder="搜尋貢獻…"
              value={query}
              readOnly={!!loadingId}
              onChange={(event) => {
                setQuery(event.target.value);
                setError("");
              }}
              onCompositionStart={() => { composing.current = true; }}
              onCompositionEnd={() => { composing.current = false; }}
            />
            {loadingId && <Loader2 size={17} className="command-palette-spin" aria-label="正在開啟" />}
          </div>
          <div className="command-palette-results-heading">
            <span title={selectedRepo?.fullName}>{selectedRepo?.fullName ?? "貢獻"}</span>
            <span>{filteredRuns.length} 項</span>
          </div>
          <div id={listId} role="listbox" aria-label="符合條件的貢獻" className="command-palette-results" aria-busy={!!loadingId}>
            {filteredRuns.map((run) => (
              <button
                type="button"
                role="option"
                tabIndex={-1}
                id={optionId(run.id)}
                key={run.id}
                aria-selected={run.id === highlightedRun?.id}
                aria-disabled={!!loadingId}
                aria-current={run.id === currentRunId ? "page" : undefined}
                className={`command-palette-result command-palette-status-${run.status}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  if (activating.current) return;
                  setHighlightedId(run.id);
                  void activateRun(run.id);
                }}
              >
                <span className="command-palette-run-icon"><GitPullRequest size={18} aria-hidden="true" /></span>
                <span className="command-palette-run-detail">
                  <strong>{run.title}</strong>
                  <span><i aria-hidden="true" />{statusLabels[run.status]}<small title={run.branch}>{run.branch}</small></span>
                </span>
                {run.id === currentRunId ? <span className="command-palette-current"><Check size={12} aria-hidden="true" />目前</span> : <ArrowUpRight size={15} className="command-palette-open-icon" aria-hidden="true" />}
              </button>
            ))}
          </div>
          {!filteredRuns.length && (
            <div className="command-palette-empty" role="status">
              <GitPullRequest size={24} aria-hidden="true" />
              <strong>{query.trim() ? "沒有符合的貢獻" : "這個專案還沒有貢獻"}</strong>
              <p>{query.trim() ? "試試其他關鍵字。" : "先看看專案全貌與值得改善的方向。"}</p>
            </div>
          )}
          {error && <p className="command-palette-error" role="alert">{error}</p>}
          {selectedRepo && (
            <button
              type="button"
              className="command-palette-overview"
              disabled={!!loadingId}
              onClick={() => {
                if (activating.current) return;
                onSelectRepo(selectedRepo.id);
                restoreFocus.current = false;
                dialog.current?.close();
                onClose();
              }}
            >
              <FolderGit2 size={15} aria-hidden="true" /><span>開啟專案全貌</span><ArrowUpRight size={14} aria-hidden="true" />
            </button>
          )}
        </section>
      </div>
      <footer className="command-palette-footer" aria-label="鍵盤快捷鍵">
        <span><kbd>↑</kbd><kbd>↓</kbd>選擇貢獻</span>
        <span><kbd>↵</kbd>開啟</span>
        <span><kbd>{"{"}</kbd><kbd>{"}"}</kbd>切換專案</span>
        <span><kbd>Esc</kbd>關閉</span>
      </footer>
    </dialog>
  );
}
