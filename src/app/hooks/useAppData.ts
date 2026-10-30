import { useEffect, useState } from "react";
import type { AppSettings, AppSettingsView } from "../../../shared/app-settings";
import { api, ApiError } from "../../api";
import type { Repo, RunSummary } from "../../types";

/** What /api/status reports about the local CLIs and the run limits. */
export type Status = {
  codex: boolean;
  codexAuthenticated?: boolean;
  claude?: boolean;
  claudeAuthenticated?: boolean;
  github: boolean;
  githubUser?: string;
  /** No required environment check fails. */
  ready?: boolean;
  limits?: {
    maxActiveRuns: number;
    maxAgentProcesses: number;
    maxQueued: number;
  };
  /** The server's version, for the About dialog. */
  version?: string;
};

/** The first load's requests; each one answers on its own. */
export type AppDataSource = "status" | "repos" | "runs" | "appSettings";

/** Where a request of the first load stands. */
export type LoadState = "pending" | "done" | "failed";

/** Receives each answer of the first load as soon as it arrives. */
export interface AppDataSink {
  status(value: Status): void;
  repos(value: Repo[]): void;
  runs(value: RunSummary[]): void;
  appSettings(value: AppSettingsView): void;
  failed(source: AppDataSource, error: Error): void;
}

/**
 * Starts the first load: status, repositories, runs and app settings as
 * four independent requests. The lists do not wait for the status, whose
 * environment probes can take seconds, and one failed request does not
 * hold back the others.
 */
export function loadAppData(
  request: <T>(path: string) => Promise<T>,
  sink: AppDataSink,
): void {
  const failed = (source: AppDataSource) => (error: unknown) =>
    sink.failed(source, error instanceof Error ? error : new Error(String(error)));
  request<Status>("/status").then(sink.status, failed("status"));
  request<{ repos: Repo[] }>("/repos").then(
    (body) => sink.repos(body.repos),
    failed("repos"),
  );
  request<{ runs: RunSummary[] }>("/runs").then(
    (body) => sink.runs(body.runs),
    failed("runs"),
  );
  request<AppSettingsView>("/app-settings").then(
    sink.appSettings,
    failed("appSettings"),
  );
}

const pending: Record<AppDataSource, LoadState> = {
  status: "pending",
  repos: "pending",
  runs: "pending",
  appSettings: "pending",
};

/**
 * The app's data: the status, repositories, runs and app settings, loaded
 * as independent requests (see loadAppData), then the runs-list poll
 * every 4 s.
 */
export function useAppData() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  /** The saved app settings; null until they load or when they cannot. */
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [loaded, setLoaded] = useState(pending);
  const [apiError, setApiError] = useState("");
  /** Missing, expired or revoked access, including in an already-open tab. */
  const [apiTokenRequired, setApiTokenRequired] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const settle = (source: AppDataSource, state: LoadState) =>
      setLoaded((previous) => ({ ...previous, [source]: state }));
    loadAppData(api, {
      status(value) {
        if (cancelled) return;
        setStatus(value);
        settle("status", "done");
      },
      repos(value) {
        if (cancelled) return;
        setRepos(value);
        settle("repos", "done");
      },
      runs(value) {
        if (cancelled) return;
        setRuns(value);
        settle("runs", "done");
      },
      appSettings(value) {
        if (cancelled) return;
        setAppSettings(value.settings);
        settle("appSettings", "done");
      },
      failed(source, error) {
        if (cancelled) return;
        settle(source, "failed");
        if (error instanceof ApiError && error.status === 401) {
          setApiTokenRequired(true);
          return;
        }
        // The settings only decide the welcome flow and the agreement
        // prompt; the other requests report a broken connection.
        if (source !== "appSettings")
          setApiError((shown) => shown || error.message);
      },
    });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (apiTokenRequired) return;
    let stopped = false;
    let fetching = false;
    const timer = setInterval(async () => {
      if (fetching) return;
      fetching = true;
      try {
        const { runs: latest } = await api<{ runs: RunSummary[] }>("/runs");
        if (!stopped) setRuns(latest);
      } catch (error) {
        if (!stopped && error instanceof ApiError && error.status === 401)
          setApiTokenRequired(true);
        /* The current-run poll reports actionable connection errors. */
      } finally {
        fetching = false;
      }
    }, 4000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [apiTokenRequired]);
  return {
    repos,
    setRepos,
    runs,
    setRuns,
    status,
    setStatus,
    appSettings,
    setAppSettings,
    /** Which first-load requests answered, failed or are still on their way. */
    loaded,
    apiError,
    setApiError,
    apiTokenRequired,
  };
}

export type AppData = ReturnType<typeof useAppData>;
