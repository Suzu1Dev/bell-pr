import type { Dispatch, SetStateAction } from "react";
import {
  ArrowUpRight,
  Check,
  FolderGit2,
  GitBranch,
  Plus,
  Sparkles,
} from "lucide-react";
import { getDemo } from "../demo";
import { useLocale, useT } from "../i18n";
import type { Repo } from "../types";
import type { ModalName, Page } from "../app/AppShell";

interface ReposPageProps {
  repos: Repo[];
  openModal: (value: ModalName) => void;
  navigate: (value: Page) => void;
  chooseRun: (id: string) => Promise<boolean>;
  setExploreRepoId: Dispatch<SetStateAction<string>>;
}

/** The imported repositories and the demo project. */
export function ReposPage({
  repos,
  openModal,
  navigate,
  chooseRun,
  setExploreRepoId,
}: ReposPageProps) {
  const t = useT("repos").list;
  const [locale] = useLocale();
  const { repo: demoRepo, run: demoRun } = getDemo(locale);
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
          <strong>{t.discoveryTitle}</strong>
          <small>{t.discoveryText}</small>
        </span>
        <span className="discovery-entry-action">
          {t.discoveryAction} <ArrowUpRight size={17} />
        </span>
      </button>
      <div className="repository-grid">
        {[...repos, demoRepo].map((repo) => (
          <article className="repository-card" key={repo.id}>
            <div className="repository-card-top">
              <span className="repo-icon">
                <FolderGit2 size={24} />
              </span>
              {repo.id === demoRepo.id ? (
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
            <p>
              {repo.id === demoRepo.id ? t.demoDescription : repo.path}
            </p>
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
                if (repo.id === demoRepo.id) chooseRun(demoRun.id);
                else {
                  setExploreRepoId(repo.id);
                  navigate("explore");
                }
              }}
            >
              {repo.id === demoRepo.id ? t.openDemo : t.explore}
              <ArrowUpRight size={15} />
            </button>
          </article>
        ))}
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
