/**
 * The sample project's analysis as the demo playback plays it (`demo=play`):
 * useProjectInsights starts it when the sample's overview loads, and the
 * overview shows its loading lines until the analysis is revealed, so a
 * tour or the promo video shows the real loading state. There is one sample,
 * so the page has one of these at a time. Nothing reaches the server.
 */
import { useSyncExternalStore } from "react";
import type { ProjectInsights } from "../../shared/insights";
import type { DemoContent } from "../demo";
import {
  createDemoPlayback,
  type DemoPlayback,
  type PlaybackClock,
} from "../demo/playback";

export interface SampleAnalysis {
  /** From the first loading line until the analysis is revealed. */
  playing: boolean;
  /** The loading lines shown so far, in order. */
  steps: string[];
  /** How many lines the analysis shows in all. */
  total: number;
}

const idle: SampleAnalysis = { playing: false, steps: [], total: 0 };
let state = idle;
let current: DemoPlayback | undefined;
const listeners = new Set<() => void>();

function set(next: SampleAnalysis) {
  state = next;
  for (const listener of [...listeners]) listener();
}

export interface SampleAnalysisOptions {
  /** The demo in the UI language, from getDemo(locale). */
  demo: DemoContent;
  /** 1 is real time; 4 plays four times as fast. */
  speed?: number;
  clock?: PlaybackClock;
}

/**
 * Plays the sample's analysis with its own playback (src/demo/playback.ts):
 * its loading lines one by one, then the insights. Starting again stops the
 * one that plays. Resolves with the insights, or with undefined when it was
 * stopped or started again first.
 */
export function playSampleAnalysis({
  demo,
  speed,
  clock,
}: SampleAnalysisOptions): Promise<ProjectInsights | undefined> {
  current?.stop();
  const playback = createDemoPlayback({ demo, speed, clock });
  current = playback;
  const total = demo.analysisSteps?.length ?? 0;
  set({ playing: true, steps: [], total });
  playback.subscribe((event) => {
    if (
      current === playback &&
      event.kind === "insights" &&
      event.status === "loading"
    )
      set({ playing: true, steps: [...state.steps, event.step], total });
  });
  return playback.analyzeSample().then((insights) => {
    if (current === playback) {
      current = undefined;
      set({ ...state, playing: false });
    }
    return insights;
  });
}

/** Stops the sample analysis that plays, if any. */
export function stopSampleAnalysis() {
  const playback = current;
  current = undefined;
  playback?.stop();
  if (state.playing) set({ ...state, playing: false });
}

/** The sample analysis now. */
export function sampleAnalysisState(): SampleAnalysis {
  return state;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The sample analysis; the component renders again as it plays. */
export function useSampleAnalysis(): SampleAnalysis {
  return useSyncExternalStore(
    subscribe,
    sampleAnalysisState,
    sampleAnalysisState,
  );
}
