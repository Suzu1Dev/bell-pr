import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  CirclePlay,
  FolderGit2,
  GitPullRequest,
  Info,
  Languages,
  Loader2,
  Search,
  Settings2,
  X,
} from "lucide-react";
import { htmlLang, locales } from "../../shared/i18n/locale";
import { byHandTurn } from "../app/byHandStatus";
import { useLocale, useT } from "../i18n";
import { chooseLocale } from "../i18n/LanguageSwitcher";
import type { Repo, RunSummary } from "../types";
import "./command-palette.css";

export interface CommandPaletteProps {
  repos: Repo[];
  runs: RunSummary[];
  currentRepoId?: string;
  currentRunId: string;
  onClose: () => void;
  onSelectRun: (id: string) => Promise<boolean>;
  onSelectRepo: (id: string) => void;
  /** The "Go to" commands; each closes the palette first. */
  onOpenSample?: () => void;
  onOpenSettings?: () => void;
  onOpenAbout?: () => void;
}

export function CommandPalette({
  repos,
  runs,
  currentRepoId,
  currentRunId,
  onClose,
  onSelectRun,
  onSelectRepo,
  onOpenSample,
  onOpenSettings,
  onOpenAbout,
}: CommandPaletteProps) {
  const t = useT("app").commandPalette;
  const common = useT("common");
  const statusLabels = common.runStatus;
  const yourTurn = useT("workspace").byHand.turn;
  const [locale, setLocale] = useLocale();
  // With two languages, the command switches to the other one.
  const otherLocale = locales.find((item) => item !== locale) ?? locale;
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
      const text = `${run.title} ${run.branch} ${byHandTurn(run) ? yourTurn : statusLabels[run.status]}`.toLocaleLowerCase();
      return terms.every((term) => text.includes(term));
    });
  }, [repoRuns, query, statusLabels, yourTurn]);
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

  /** Closes the palette, then runs a "Go to" command. */
  const runCommand = (command: () => void) => {
    if (activating.current) return;
    restoreFocus.current = false;
    dialog.current?.close();
    onClose();
    command();
  };

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
        setError(cause instanceof Error ? cause.message : t.openFailed);
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
          <h2 id={titleId}>{t.title}</h2>
        </div>
        <button type="button" className="command-palette-close" aria-label={t.close} onClick={onClose}>
          <X size={17} aria-hidden="true" />
        </button>
      </header>
      <div className="command-palette-body">
        <nav className="command-palette-projects" aria-label={t.chooseProject}>
          <div className="command-palette-section-label">{t.projects} <span>{repos.length}</span></div>
          <div ref={projectList} className="command-palette-project-list">
            {repos.map((repo) => {
              const count = runs.filter((run) => run.repoId === repo.id).length;
              return (
                <button
                  type="button"
                  key={repo.id}
                  aria-pressed={selectedRepo?.id === repo.id}
                  aria-label={t.project({
                    name: repo.fullName,
                    count,
                    current: repo.id === currentRepoId,
                  })}
                  disabled={!!loadingId}
                  onClick={() => selectProject(repo.id)}
                >
                  <FolderGit2 size={17} aria-hidden="true" />
                  <span><strong>{repo.name}</strong><small>{repo.owner}</small></span>
                  <em>{count}</em>
                </button>
              );
            })}
            {!repos.length && <p className="command-palette-no-projects">{t.noProjects}</p>}
          </div>
          <div className="command-palette-section-label command-palette-commands-label">{t.goTo}</div>
          <div className="command-palette-commands">
            {onOpenSample && (
              <button type="button" disabled={!!loadingId} onClick={() => runCommand(onOpenSample)}>
                <CirclePlay size={16} aria-hidden="true" /><span>{t.sample}</span>
              </button>
            )}
            {onOpenSettings && (
              <button type="button" disabled={!!loadingId} onClick={() => runCommand(onOpenSettings)}>
                <Settings2 size={16} aria-hidden="true" /><span>{t.settings}</span>
              </button>
            )}
            <button
              type="button"
              disabled={!!loadingId}
              onClick={() => runCommand(() => chooseLocale(otherLocale, setLocale))}
            >
              <Languages size={16} aria-hidden="true" />
              <span>{t.language}</span>
              <small lang={htmlLang(otherLocale)}>{common.languageNames[otherLocale]}</small>
            </button>
            {onOpenAbout && (
              <button type="button" disabled={!!loadingId} onClick={() => runCommand(onOpenAbout)}>
                <Info size={16} aria-hidden="true" /><span>{t.about}</span>
              </button>
            )}
          </div>
        </nav>
        <section className="command-palette-contributions" aria-label={t.contributionList}>
          <div className="command-palette-search">
            <Search size={18} aria-hidden="true" />
            <input
              ref={search}
              type="text"
              role="combobox"
              aria-label={t.search}
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={highlightedRun ? optionId(highlightedRun.id) : undefined}
              autoComplete="off"
              spellCheck={false}
              placeholder={t.searchPlaceholder}
              value={query}
              readOnly={!!loadingId}
              onChange={(event) => {
                setQuery(event.target.value);
                setError("");
              }}
              onCompositionStart={() => { composing.current = true; }}
              onCompositionEnd={() => { composing.current = false; }}
            />
            {loadingId && <Loader2 size={17} className="command-palette-spin" aria-label={t.opening} />}
          </div>
          <div className="command-palette-results-heading">
            <span title={selectedRepo?.fullName}>{selectedRepo?.fullName ?? t.resultsFallback}</span>
            <span>{t.resultCount({ count: filteredRuns.length })}</span>
          </div>
          <div id={listId} role="listbox" aria-label={t.results} className="command-palette-results" aria-busy={!!loadingId}>
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
                  <span><i aria-hidden="true" />{byHandTurn(run) ? yourTurn : statusLabels[run.status]}<small title={run.branch}>{run.branch}</small></span>
                </span>
                {run.id === currentRunId ? <span className="command-palette-current"><Check size={12} aria-hidden="true" />{t.current}</span> : <ArrowUpRight size={15} className="command-palette-open-icon" aria-hidden="true" />}
              </button>
            ))}
          </div>
          {!filteredRuns.length && (
            <div className="command-palette-empty" role="status">
              <GitPullRequest size={24} aria-hidden="true" />
              <strong>{query.trim() ? t.noMatches : t.noContributions}</strong>
              <p>{query.trim() ? t.tryOtherWords : t.lookAtOverview}</p>
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
              <FolderGit2 size={15} aria-hidden="true" /><span>{t.openOverview}</span><ArrowUpRight size={14} aria-hidden="true" />
            </button>
          )}
        </section>
      </div>
      <footer className="command-palette-footer" aria-label={t.shortcuts}>
        <span><kbd>↑</kbd><kbd>↓</kbd>{t.selectHint}</span>
        <span><kbd>↵</kbd>{t.openHint}</span>
        <span><kbd>{"{"}</kbd><kbd>{"}"}</kbd>{t.switchProjectHint}</span>
        <span><kbd>Esc</kbd>{t.closeHint}</span>
      </footer>
    </dialog>
  );
}
