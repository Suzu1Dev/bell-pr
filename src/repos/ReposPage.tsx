import type { Dispatch, SetStateAction } from "react";
import {
  ArrowUpRight,
  Check,
  FolderGit2,
  GitBranch,
  Plus,
  Sparkles,
} from "lucide-react";
import { demoRepo, demoRun } from "../demo";
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
  return (
    <section className="page-content">
      <div className="page-title">
        <div>
          <span className="eyebrow">YOUR REPOSITORIES</span>
          <h1 tabIndex={-1}>下一個貢獻，從這裡開始。</h1>
          <p>帶入你在意的專案，讓想法成為真正的改動。</p>
        </div>
        <button
          className="button primary"
          onClick={() => openModal("import")}
        >
          <Plus size={16} />
          匯入 Repository
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
          <strong>還沒決定要貢獻哪個專案？</strong>
          <small>
            讓 AI 從 GitHub 找出有需求、適合你起步的開發機會。
          </small>
        </span>
        <span className="discovery-entry-action">
          推薦貢獻項目 <ArrowUpRight size={17} />
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
                <span className="demo-pill">示範專案</span>
              ) : (
                <span className="repo-ready">
                  <Check size={13} />
                  已匯入
                </span>
              )}
            </div>
            <span className="repo-owner">{repo.owner}</span>
            <h2>{repo.name}</h2>
            <p>
              {repo.id === demoRepo.id
                ? "透過 SDK 智慧重試的範例，體驗一次完整的貢獻與審查。"
                : repo.path}
            </p>
            <div className="repository-meta">
              <span>
                <span className="language-dot" />
                {repo.language || "Git repository"}
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
              {repo.id === demoRepo.id
                ? "探索示範工作台"
                : "了解專案與貢獻方向"}
              <ArrowUpRight size={15} />
            </button>
          </article>
        ))}
        <button
          className="repository-add"
          onClick={() => openModal("import")}
        >
          <Plus size={27} />
          <strong>加入你的 Repository</strong>
          <span>GitHub 連結或本機 Git 專案</span>
        </button>
      </div>
    </section>
  );
}
