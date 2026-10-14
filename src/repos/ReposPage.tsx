import { useState, type Dispatch, type SetStateAction } from "react";
import {
  ArrowUpRight,
  Check,
  FolderGit2,
  GitBranch,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { getDemo } from "../demo";
import { useLocale, useT } from "../i18n";
import { ProBadge } from "../license/ProBadge";
import type { Repo } from "../types";
import type { ModalName, Page } from "../app/AppShell";

interface ReposPageProps {
  repos: Repo[];
  openModal: (value: ModalName) => void;
  navigate: (value: Page) => void;
  chooseRun: (id: string) => Promise<boolean>;
  setExploreRepoId: Dispatch<SetStateAction<string>>;
  /** Free: searching GitHub needs Pro, so the discovery entry says PRO. */
  discoveryLocked?: boolean;
  /** Masks a repository's folder while presenting. */
  maskPath?: (path: string) => string;
  /** DELETE /api/repos/:id; rejects with the server's reason. */
  deleteRepository?: (repo: Repo) => Promise<void>;
}

/** The imported repositories and the demo project. */
export function ReposPage({
  repos,
  openModal,
  navigate,
  chooseRun,
  setExploreRepoId,
  discoveryLocked = false,
  maskPath = (path) => path,
  deleteRepository,
}: ReposPageProps) {
  const t = useT("repos").list;
  const [locale] = useLocale();
  const { repo: demoRepo, run: demoRun } = getDemo(locale);
  const [asked, setAsked] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  const remove = async (repo: Repo) => {
    if (!deleteRepository) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteRepository(repo);
      setAsked("");
    } catch (cause) {
      setError({
        id: repo.id,
        message: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="page-content">
      <div className="page-title">
        <div>
          <span className="eyebrow">{t.eyebrow}</span>
          <h1 tabIndex={-1}>{t.title}</h1>
          <p>{t.intro}</p>
        </div>
        <button
          className="button primary"
          onClick={() => openModal("import")}
        >
          <Plus size={16} />
          {t.import}
        </button>
      </div>
      <button
        className="discovery-entry"
        onClick={() => navigate("discovery")}
      >
        <span className="discovery-entry-icon">
          <Sparkles size={24} />
        </span>
        <span>
          <strong className="discovery-entry-title">
            {t.discoveryTitle}
            {discoveryLocked && <ProBadge />}
          </strong>
          <small>{t.discoveryText}</small>
        </span>
        <span className="discovery-entry-action">
          {t.discoveryAction} <ArrowUpRight size={17} />
        </span>
      </button>
      <div className="repository-grid">
        {[...repos, demoRepo].map((repo) => {
          const sample = repo.id === demoRepo.id;
          return (
            <article className="repository-card" key={repo.id}>
              <div className="repository-card-top">
                <span className="repo-icon">
                  <FolderGit2 size={24} />
                </span>
                {sample ? (
                  <span className="demo-pill">{t.demoBadge}</span>
                ) : (
                  <span className="repo-ready">
                    <Check size={13} />
                    {t.imported}
                  </span>
                )}
              </div>
              <span className="repo-owner">{repo.owner}</span>
              <h2>{repo.name}</h2>
              <p>{sample ? t.demoDescription : maskPath(repo.path)}</p>
              <div className="repository-meta">
                <span>
                  <span className="language-dot" />
                  {repo.language || t.languageFallback}
                </span>
                <span>
                  <GitBranch size={13} />
                  {repo.defaultBranch}
                </span>
              </div>
              <button
                className="button secondary"
                onClick={() => {
                  if (sample) chooseRun(demoRun.id);
                  else {
                    setExploreRepoId(repo.id);
                    navigate("explore");
                  }
                }}
              >
                {sample ? t.openDemo : t.explore}
                <ArrowUpRight size={15} />
              </button>
              {!sample && deleteRepository && (
                <div className="repository-delete">
                  {asked === repo.id ? (
                    <div
                      className="run-list-confirm"
                      role="group"
                      aria-label={t.deleteLabel({ name: repo.fullName })}
                    >
                      <p>{t.deleteConfirm({ name: repo.fullName })}</p>
                      <div>
                        <button
                          type="button"
                          className="button secondary"
                          disabled={deleting}
                          onClick={() => {
                            setAsked("");
                            setError(null);
                          }}
                        >
                          {t.deleteNo}
                        </button>
                        <button
                          type="button"
                          className="button danger"
                          disabled={deleting}
                          onClick={() => void remove(repo)}
                        >
                          {deleting ? t.deleting : t.deleteYes}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="run-list-action run-list-action-danger"
                      disabled={deleting}
                      aria-label={t.deleteLabel({ name: repo.fullName })}
                      onClick={() => {
                        setError(null);
                        setAsked(repo.id);
                      }}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                      {t.delete}
                    </button>
                  )}
                  {error?.id === repo.id && (
                    <p role="alert" className="inline-error">
                      {error.message}
                    </p>
                  )}
                </div>
              )}
            </article>
          );
        })}
        <button
          className="repository-add"
          onClick={() => openModal("import")}
        >
          <Plus size={27} />
          <strong>{t.addTitle}</strong>
          <span>{t.addText}</span>
        </button>
      </div>
    </section>
  );
}
