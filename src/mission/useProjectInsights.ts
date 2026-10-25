import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Locale } from "../../shared/i18n/locale";
import {
  maxProjectRecommendations,
  projectRecommendationBatchSize,
  type InsightsProgress,
  type InsightsStaleDetail,
  type ProjectInsights,
  type RecommendationPreferences,
} from "../../shared/insights";
import { api, send } from "../api";
import { usePresentation } from "../app/presentation";
import { getDemo } from "../demo";
import { systemClock, type PlaybackClock } from "../demo/playback";
import { getCurrentLocale, getCurrentMessages, useLocale } from "../i18n";
import { playSampleAnalysis, stopSampleAnalysis } from "./sample-analysis";

/** The cache's messages in the active UI language, read when one is shown. */
const messages = () => getCurrentMessages().mission.insights;

/**
 * The prewritten sample analysis in `locale`; `expanded` adds the sample
 * recommendations that "Generate 5 more" shows, as one prewritten batch.
 * The same object comes back for the same arguments.
 */
function sampleInsights(locale: Locale, expanded: boolean): ProjectInsights {
  const key = `${locale}:${expanded}`;
  let insights = sampleAnalyses.get(key);
  if (!insights) {
    const demo = getDemo(locale);
    const extras = demo.extraRecommendations ?? [];
    insights = expanded
      ? {
          ...demo.insights,
          recommendations: [...demo.insights.recommendations, ...extras],
          recommendationExpansion: {
            generatedAt: demo.insights.generatedAt,
            addedIds: extras.map((idea) => idea.id),
            requestedCount: projectRecommendationBatchSize,
          },
        }
      : demo.insights;
    sampleAnalyses.set(key, insights);
    sampleVariants.set(insights, expanded);
  }
  return insights;
}
const sampleAnalyses = new Map<string, ProjectInsights>();
/**
 * Every sample analysis made so far, and whether it has the extra batch.
 * sampleInsights() is the only maker, so a sample shown in any language is
 * in here; a language's sample text loads only when the app shows it.
 */
const sampleVariants = new Map<ProjectInsights, boolean>();

/** The prewritten sample analysis in the active UI language. */
const demoInsights = () => sampleInsights(getCurrentLocale(), false);

/**
 * The analysis to show in `locale`: the prewritten sample analysis follows
 * the UI language, with its extra batch if it was added; an AI analysis
 * stays in the language it was written in.
 */
export function shownInsights(
  insights: ProjectInsights | null,
  locale: Locale,
): ProjectInsights | null {
  const sample = insights && sampleVariants.get(insights);
  return typeof sample === "boolean" ? sampleInsights(locale, sample) : insights;
}

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
  /** Where the server's run is while this operation waits; absent until it answers. */
  progress?: InsightsProgress;
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

/** How often the overview asks where a running analysis is. */
const progressPollMs = 2000;

export interface ProjectInsightsCacheOptions {
  /**
   * The sample's analysis plays (`demo=play`): it starts out loading, and
   * playSample() reveals it, instead of showing it at once.
   */
  playSample?: boolean;
  /** The clock of the sample's playback and of the progress questions; tests pass a fake one. */
  clock?: PlaybackClock;
  /**
   * Where the server's run is. Asked while an analysis or "generate more"
   * waits, because that request says nothing before it ends. Without it,
   * nothing is asked.
   */
  progress?: (repoId: string) => Promise<InsightsProgress | undefined>;
}

/** One cache belongs to the mounted workbench, so changing repositories keeps active work. */
export class ProjectInsightsCache {
  private states = new Map<string, InsightsState>([
    ["demo-repo", { ...emptyState, insights: demoInsights() }],
  ]);
  private reads = new Map<string, Promise<void>>();
  private mutations = new Map<string, Promise<void>>();
  private revisions = new Map<string, number>();
  private listeners = new Set<() => void>();
  /** The sample's analysis while it plays, and whether it has played. */
  private samplePlay?: Promise<void>;
  private samplePlayed = false;

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
    private options: ProjectInsightsCacheOptions = {},
  ) {
    if (options.playSample)
      this.states.set("demo-repo", { ...emptyState, loading: true });
  }

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
    if (repoId === "demo-repo") {
      // A sample analysis that waited for a playback that did not come shows now.
      if (!this.samplePlay && !this.snapshot(repoId).insights)
        this.update(repoId, { insights: demoInsights(), loading: false });
      return Promise.resolve();
    }
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

  /**
   * Plays the sample's analysis (`demo=play`): the overview shows its
   * loading lines, then the analysis, without a request. It plays once per
   * cache; `restart` plays it again, as "Re-analyze" does in playback mode.
   */
  playSample(locale: Locale, speed?: number, restart = false): Promise<void> {
    if (!restart && (this.samplePlay || this.samplePlayed))
      return this.samplePlay ?? Promise.resolve();
    const repoId = "demo-repo";
    this.update(repoId, {
      insights: null,
      stale: false,
      staleDetail: undefined,
      loading: true,
      error: "",
      recommendationError: "",
    });
    const play = playSampleAnalysis({
      demo: getDemo(locale),
      speed,
      clock: this.options.clock,
    }).then(() => {
      if (this.samplePlay !== play) return;
      this.samplePlay = undefined;
      this.samplePlayed = true;
      this.update(repoId, {
        insights: sampleInsights(locale, false),
        loading: false,
      });
    });
    this.samplePlay = play;
    return play;
  }

  /** Stops the sample's analysis if it plays; the next load or playSample() picks it up. */
  dispose() {
    if (!this.samplePlay) return;
    this.samplePlay = undefined;
    stopSampleAnalysis();
  }

  analyze(repoId: string): Promise<void> {
    if (repoId === "demo-repo") {
      this.dispose();
      this.update(repoId, {
        insights: demoInsights(),
        error: messages().demoAnalysis,
      });
      return Promise.resolve();
    }
    return this.generate(repoId, "analyze");
  }

  /**
   * "Generate 5 more" for the sample: its prewritten batch
   * (`extraRecommendations`) joins the analysis once, as a
   * recommendationExpansion, without a request.
   */
  addSampleBatch(): Promise<void> {
    const repoId = "demo-repo";
    const state = this.snapshot(repoId);
    const sample = state.insights && sampleVariants.get(state.insights);
    this.update(
      repoId,
      sample === false
        ? {
            insights: sampleInsights(getCurrentLocale(), true),
            recommendationError: "",
          }
        : { recommendationError: messages().demoMore },
    );
    return Promise.resolve();
  }

  /** Asks the server for more recommendations; the sample has none to ask for. */
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

  /**
   * Asks the server where the run of `repoId` is, one question after the
   * other, until the returned function is called.
   */
  private watchProgress(repoId: string): () => void {
    const read = this.options.progress;
    if (!read) return () => {};
    const clock = this.options.clock ?? systemClock;
    let stopped = false;
    let timer: unknown;
    const poll = (): Promise<void> =>
      read(repoId)
        .then(
          (progress) => {
            if (!stopped) this.update(repoId, { progress });
          },
          // A missed answer leaves the last one on screen; the run itself is not affected.
          () => undefined,
        )
        .then(() => {
          if (!stopped) timer = clock.setTimeout(poll, progressPollMs);
        });
    void poll();
    return () => {
      stopped = true;
      clock.clearTimeout(timer);
    };
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
    const stopWatching = this.watchProgress(repoId);
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
        stopWatching();
        if (this.mutations.get(repoId) === operation) {
          this.mutations.delete(repoId);
          this.update(repoId, {
            loading: false,
            recommending: false,
            progress: undefined,
          });
        }
      });
    this.mutations.set(repoId, operation);
    return operation;
  }
}

/** Where the server's run of the analysis is; undefined when it does not run. */
const readProgress = (repoId: string) =>
  api<{ progress: InsightsProgress | null }>(
    `/repos/${repoId}/insights/progress`,
  ).then(({ progress }) => progress ?? undefined);

export function useProjectInsights(repoId?: string) {
  const [locale] = useLocale();
  const { play, speed } = usePresentation();
  const [cache] = useState(
    () =>
      new ProjectInsightsCache(undefined, undefined, {
        playSample: play,
        progress: readProgress,
      }),
  );
  const getSnapshot = useCallback(
    () => cache.snapshot(repoId),
    [cache, repoId],
  );
  const state = useSyncExternalStore(cache.subscribe, getSnapshot, getSnapshot);
  // In playback mode the sample's analysis plays instead of showing at once.
  const playing = repoId === "demo-repo" && play;
  // Read when it starts; changing them later does not start it again.
  const sample = useRef({ locale, speed });
  sample.current = { locale, speed };

  useEffect(() => () => cache.dispose(), [cache]);
  useEffect(() => {
    if (!repoId) return;
    if (playing)
      void cache.playSample(sample.current.locale, sample.current.speed);
    else void cache.load(repoId);
  }, [cache, repoId, playing]);

  const analyze = useCallback(() => {
    if (!repoId) return Promise.resolve();
    if (playing)
      return cache.playSample(
        sample.current.locale,
        sample.current.speed,
        true,
      );
    return cache.analyze(repoId);
  }, [cache, repoId, playing]);
  const recommendMore = useCallback(
    () =>
      repoId === "demo-repo"
        ? cache.addSampleBatch()
        : repoId
          ? cache.recommendMore(repoId)
          : Promise.resolve(),
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

  const insights = shownInsights(state.insights, locale);

  return { ...state, insights, analyze, recommendMore, savePreferences, reload };
}
