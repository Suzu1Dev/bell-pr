import { useEffect, useState } from "react";
import { api } from "../../api";
import type { Repo, RunSummary } from "../../types";

/** What /api/status reports about the local CLIs and the run limits. */
export type Status = {
  codex: boolean;
  codexAuthenticated?: boolean;
  claude?: boolean;
  claudeAuthenticated?: boolean;
  github: boolean;
  githubUser?: string;
  limits?: {
    maxActiveRuns: number;
    maxAgentProcesses: number;
    maxQueued: number;
  };
};

/**
 * The app's first load of status, repositories and runs (one request batch),
 * then the runs-list poll every 4 s. They stay one hook so the first load
 * remains a single Promise.all.
 */
export function useAppData() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [apiError, setApiError] = useState("");
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<Status>("/status"),
      api<{ repos: Repo[] }>("/repos"),
      api<{ runs: RunSummary[] }>("/runs"),
    ])
      .then(([s, r, jobs]) => {
        if (cancelled) return;
        setStatus(s);
        setRepos(r.repos);
        setRuns(jobs.runs);
      })
      .catch((error) => {
        if (!cancelled) setApiError(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    let stopped = false;
    let fetching = false;
    const timer = setInterval(async () => {
      if (fetching) return;
      fetching = true;
      try {
        const { runs: latest } = await api<{ runs: RunSummary[] }>("/runs");
        if (!stopped) setRuns(latest);
      } catch {
        /* The current-run poll reports actionable connection errors. */
      } finally {
        fetching = false;
      }
    }, 4000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);
  return {
    repos,
    setRepos,
    runs,
    setRuns,
    status,
    setStatus,
    apiError,
    setApiError,
  };
}

export type AppData = ReturnType<typeof useAppData>;
