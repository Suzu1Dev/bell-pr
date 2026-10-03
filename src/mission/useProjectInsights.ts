import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { ProjectInsights } from "../../shared/insights";
import { api, send } from "../api";
import { demoInsights } from "./demo";

interface InsightsResult {
  insights: ProjectInsights | null;
  stale: boolean;
}

interface InsightsState extends InsightsResult {
  loading: boolean;
  error: string;
}

type InsightsRequest = (
  repoId: string,
  generate: boolean,
) => Promise<InsightsResult>;

const emptyState: InsightsState = {
  insights: null,
  stale: false,
  loading: false,
  error: "",
};

/** One cache belongs to the mounted workbench, so changing repositories keeps active work. */
export class ProjectInsightsCache {
  private states = new Map<string, InsightsState>([
    ["demo-repo", { ...emptyState, insights: demoInsights }],
  ]);
  private reads = new Map<string, Promise<void>>();
  private analyses = new Map<string, Promise<void>>();
  private revisions = new Map<string, number>();
  private listeners = new Set<() => void>();

  constructor(
    private request: InsightsRequest = (repoId, generate) =>
      api<InsightsResult>(
        `/repos/${repoId}/insights`,
        generate ? send("POST") : undefined,
      ),
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  snapshot(repoId?: string): InsightsState {
    return repoId ? (this.states.get(repoId) ?? emptyState) : emptyState;
  }

  private update(repoId: string, change: Partial<InsightsState>) {
    this.states.set(repoId, { ...this.snapshot(repoId), ...change });
    for (const listener of this.listeners) listener();
  }

  private nextRevision(repoId: string) {
    const revision = (this.revisions.get(repoId) ?? 0) + 1;
    this.revisions.set(repoId, revision);
    return revision;
  }

  load(repoId: string): Promise<void> {
    if (repoId === "demo-repo") return Promise.resolve();
    // Re-entering an active repository joins its original analysis instead of reading old cache.
    const pending = this.analyses.get(repoId) ?? this.reads.get(repoId);
    if (pending) return pending;
    const revision = this.nextRevision(repoId);
    this.update(repoId, { error: "" });
    const operation = Promise.resolve()
      .then(() => this.request(repoId, false))
      .then((result) => {
        if (this.revisions.get(repoId) === revision)
          this.update(repoId, result);
      })
      .catch((error: unknown) => {
        if (this.revisions.get(repoId) === revision)
          this.update(repoId, {
            error:
              error instanceof Error
                ? error.message
                : "無法讀取專案分析，請重試。",
          });
      })
      .finally(() => {
        if (this.reads.get(repoId) === operation) this.reads.delete(repoId);
      });
    this.reads.set(repoId, operation);
    return operation;
  }

  analyze(repoId: string): Promise<void> {
    if (repoId === "demo-repo") {
      this.update(repoId, {
        insights: demoInsights,
        error:
          "示範專案使用預寫分析。匯入你的 repository 後，即可請 AI 閱讀真實原始碼。",
      });
      return Promise.resolve();
    }
    // The map guards duplicate clicks synchronously, before React can render loading=true.
    const pending = this.analyses.get(repoId);
    if (pending) return pending;
    const revision = this.nextRevision(repoId);
    this.update(repoId, { loading: true, error: "" });
    const operation = Promise.resolve()
      .then(() => this.request(repoId, true))
      .then((result) => {
        if (this.revisions.get(repoId) === revision)
          this.update(repoId, result);
      })
      .catch((error: unknown) => {
        if (this.revisions.get(repoId) === revision)
          this.update(repoId, {
            error:
              error instanceof Error
                ? error.message
                : "專案分析未完成，請重試。",
          });
      })
      .finally(() => {
        if (this.analyses.get(repoId) === operation) {
          this.analyses.delete(repoId);
          this.update(repoId, { loading: false });
        }
      });
    this.analyses.set(repoId, operation);
    return operation;
  }
}

export function useProjectInsights(repoId?: string) {
  const [cache] = useState(() => new ProjectInsightsCache());
  const getSnapshot = useCallback(
    () => cache.snapshot(repoId),
    [cache, repoId],
  );
  const state = useSyncExternalStore(cache.subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (repoId) void cache.load(repoId);
  }, [cache, repoId]);

  const analyze = useCallback(
    () => (repoId ? cache.analyze(repoId) : Promise.resolve()),
    [cache, repoId],
  );

  return { ...state, analyze };
}
