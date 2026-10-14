import { useState, type Dispatch, type SetStateAction } from "react";
import { api, send } from "../../api";
import type { Repo } from "../../types";
import type { Notify } from "../AppShell";

interface RepoUpdateOptions {
  setRepos: Dispatch<SetStateAction<Repo[]>>;
  /** Reads the open project's analysis again, which may now be outdated. */
  reloadInsights: () => Promise<void>;
  notify: Notify;
}

/**
 * Updates BELL's own clone of a project to the latest default branch, for
 * the update button on the project overview. A local import is never
 * updatable; the server refuses it as well.
 */
export function useRepoUpdate({
  setRepos,
  reloadInsights,
  notify,
}: RepoUpdateOptions) {
  const [updatingRepo, setUpdatingRepo] = useState(false);
  async function updateRepo(target: Repo) {
    setUpdatingRepo(true);
    try {
      const result = await api<{
        repo: Repo;
        from: string;
        to: string;
        updated: boolean;
      }>(`/repos/${target.id}/update`, send("POST"));
      setRepos((previous) =>
        previous.map((repo) => (repo.id === result.repo.id ? result.repo : repo)),
      );
      await reloadInsights();
      notify(
        result.updated
          ? `已更新到最新版本（${result.to.slice(0, 7)}）。專案分析若標示過期，請重新分析；新的貢獻會從最新版本開始。`
          : "已是最新版本。",
      );
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setUpdatingRepo(false);
    }
  }
  return { updatingRepo, updateRepo };
}
