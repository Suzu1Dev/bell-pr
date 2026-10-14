import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { locales } from "../../shared/i18n/locale";
import {
  maxProjectRecommendations,
  type InsightsStaleDetail,
  type ProjectInsights,
  type RecommendationPreferences,
} from "../../shared/insights";
import { api, send } from "../api";
import { getDemo } from "../demo";
import { getCurrentLocale, getCurrentMessages, useLocale } from "../i18n";

/** The cache's messages in the active UI language, read when one is shown. */
const messages = () => getCurrentMessages().mission.insights;

/** The prewritten sample analysis in the active UI language. */
const demoInsights = () => getDemo(getCurrentLocale()).insights;
// Every locale's sample analysis, to tell it apart from other analyses.
const demoAnalyses = new Set(locales.map((locale) => getDemo(locale).insights));

interface InsightsResult {
  insights: ProjectInsights | null;
  stale: boolean;
  /** Only sent with a stale result when git could list the changes; absent means unknown. */
  staleDetail?: InsightsStaleDetail;
  recommendationPreferences?: RecommendationPreferences;
}

interface InsightsState extends InsightsResult {
  loading: boolean;
  error: string;
  recommending: boolean;
  recommendationError: string;
  recommendationPreferences: RecommendationPreferences;
  savingPreferences: boolean;
  preferenceError: string;
}

type InsightsOperation = "load" | "analyze" | "recommend";
type InsightsRequest = (
  repoId: string,
  operation: InsightsOperation,
) => Promise<InsightsResult>;

const emptyState: InsightsState = {
  insights: null,
  stale: false,
  loading: false,
  error: "",
  recommending: false,
  recommendationError: "",
  recommendationPreferences: { order: [], hidden: [] },
  savingPreferences: false,
  preferenceError: "",
};

/** One cache belongs to the mounted workbench, so changing repositories keeps active work. */
export class ProjectInsightsCache {
  private states = new Map<string, InsightsState>([
    ["demo-repo", { ...emptyState, insights: demoInsights() }],
  ]);
  private reads = new Map<string, Promise<void>>();
  private mutations = new Map<string, Promise<void>>();
  private revisions = new Map<string, number>();
  private listeners = new Set<() => void>();

  constructor(
    private request: InsightsRequest = (repoId, operation) =>
      api<InsightsResult>(
        `/repos/${repoId}/insights${operation === "recommend" ? "/recommendations" : ""}`,
        operation === "load" ? undefined : send("POST"),
      ),
    private savePreferencesRequest = (
      repoId: string,
      preferences: RecommendationPreferences,
    ) =>
      api<{ recommendationPreferences: RecommendationPreferences }>(
        `/repos/${repoId}/insights/preferences`,
        send("PUT", preferences),
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
    const pending = this.mutations.get(repoId) ?? this.reads.get(repoId);
    if (pending) return pending;
    const revision = this.nextRevision(repoId);
    this.update(repoId, { error: "" });
    const operation = Promise.resolve()
      .then(() => this.request(repoId, "load"))
      .then((result) => {
        if (this.revisions.get(repoId) === revision)
          this.update(repoId, {
            ...result,
            // A fresh or unknown result must not keep an older change listing.
            staleDetail: result.staleDetail,
            recommendationPreferences: result.recommendationPreferences ?? {
              order: [],
              hidden: [],
            },
          });
      })
      .catch((error: unknown) => {
        if (this.revisions.get(repoId) === revision)
          this.update(repoId, {
            error:
              error instanceof Error ? error.message : messages().loadFailed,
          });
      })
      .finally(() => {
        if (this.reads.get(repoId) === operation) this.reads.delete(repoId);
      });
    this.reads.set(repoId, operation);
    return operation;
  }

  /** Reads the analysis anew once nothing is in flight, for example after BELL's clone was updated. */
  async refresh(repoId: string): Promise<void> {
    const pending = this.mutations.get(repoId) ?? this.reads.get(repoId);
    if (pending) await pending.catch(() => undefined);
    return this.load(repoId);
  }

  analyze(repoId: string): Promise<void> {
    if (repoId === "demo-repo") {
      this.update(repoId, {
        insights: demoInsights(),
        error: messages().demoAnalysis,
      });
      return Promise.resolve();
    }
    return this.generate(repoId, "analyze");
  }

  recommendMore(repoId: string): Promise<void> {
    const pending = this.mutations.get(repoId);
    if (pending) return pending;
    const state = this.snapshot(repoId);
    const error =
      repoId === "demo-repo" || state.insights?.source === "demo"
        ? messages().demoMore
        : !state.insights || state.stale
          ? messages().reanalyzeFirst
          : state.insights.recommendations.length >= maxProjectRecommendations
            ? messages().limit({ max: maxProjectRecommendations })
            : "";
    if (error) {
      this.update(repoId, { recommendationError: error });
      return Promise.resolve();
    }
    return this.generate(repoId, "recommend");
  }

  savePreferences(
    repoId: string,
    preferences: RecommendationPreferences,
  ): Promise<void> {
    const pending = this.mutations.get(repoId);
    if (pending) return pending;
    const state = this.snapshot(repoId);
    if (!state.insights) return Promise.resolve();
    const revision = this.nextRevision(repoId);
    this.update(repoId, {
      recommendationPreferences: preferences,
      savingPreferences: true,
      preferenceError: "",
    });
    const operation = Promise.resolve()
      .then(() => repoId === "demo-repo"
        ? { recommendationPreferences: preferences }
        : this.savePreferencesRequest(repoId, preferences))
      .then((result) => {
        if (this.revisions.get(repoId) === revision) this.update(repoId, result);
      })
      .catch((error: unknown) => {
        if (this.revisions.get(repoId) === revision)
          this.update(repoId, {
            recommendationPreferences: state.recommendationPreferences,
            preferenceError: error instanceof Error
              ? messages().preferencesReverted({ reason: error.message })
              : messages().preferencesRevertedRetry,
          });
      })
      .finally(() => {
        if (this.mutations.get(repoId) === operation) {
          this.mutations.delete(repoId);
          this.update(repoId, { savingPreferences: false });
        }
      });
    this.mutations.set(repoId, operation);
    return operation;
  }

  private generate(
    repoId: string,
    action: "analyze" | "recommend",
  ): Promise<void> {
    // The map guards duplicate clicks synchronously, before React can render loading=true.
    const pending = this.mutations.get(repoId);
    if (pending) return pending;
    const revision = this.nextRevision(repoId);
    const recommending = action === "recommend";
    this.update(
      repoId,
      recommending
        ? { recommending: true, recommendationError: "" }
        : { loading: true, error: "", recommendationError: "" },
    );
    const operation = Promise.resolve()
      .then(() => this.request(repoId, action))
      .then((result) => {
        if (this.revisions.get(repoId) === revision)
          this.update(repoId, {
            ...result,
            staleDetail: result.staleDetail,
            recommendationPreferences: result.recommendationPreferences ?? {
              order: [],
              hidden: [],
            },
          });
      })
      .catch((error: unknown) => {
        if (this.revisions.get(repoId) === revision)
          this.update(repoId, {
            [recommending ? "recommendationError" : "error"]:
              error instanceof Error
                ? error.message
                : recommending
                  ? messages().moreFailed
                  : messages().analysisFailed,
          });
      })
      .finally(() => {
        if (this.mutations.get(repoId) === operation) {
          this.mutations.delete(repoId);
          this.update(repoId, { loading: false, recommending: false });
        }
      });
    this.mutations.set(repoId, operation);
    return operation;
  }
}

export function useProjectInsights(repoId?: string) {
  const [locale] = useLocale();
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
  const recommendMore = useCallback(
    () => (repoId ? cache.recommendMore(repoId) : Promise.resolve()),
    [cache, repoId],
  );

  const savePreferences = useCallback(
    (preferences: RecommendationPreferences) =>
      repoId ? cache.savePreferences(repoId, preferences) : Promise.resolve(),
    [cache, repoId],
  );

  const reload = useCallback(
    () => (repoId ? cache.refresh(repoId) : Promise.resolve()),
    [cache, repoId],
  );

  // The prewritten sample analysis follows the UI language; an AI analysis
  // stays in the language it was written in.
  const insights =
    state.insights && demoAnalyses.has(state.insights)
      ? getDemo(locale).insights
      : state.insights;

  return { ...state, insights, analyze, recommendMore, savePreferences, reload };
}
