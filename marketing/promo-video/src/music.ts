/**
 * The music, as the film sees it: music/track.analysis.json (the tracked,
 * path-free beat-analysis contract of plan direction-v1.1/VIDEO.md §2)
 * turned into video frames. No other file holds a music number: the
 * timeline, the scenes, the sound effects and the checks all read them from
 * here, so swapping the track means swapping the gitignored audio and that
 * one JSON file.
 *
 * The frame rule (lookdev STYLE-GUIDE §2.1): an event at time t belongs to
 * floor(t * fps), the frame whose display interval contains it, so the
 * picture leads the sound by less than a frame. The one exception is the
 * end-card landing on the final chord, which the lead fixed at the rounded
 * frame (VIDEO.md addendum: 81.718 s = frame 2452).
 */
import analysis from "../music/track.analysis.json";

export const fps = 30;

export type RequiredEvent = "intro" | "firstHit" | "lift" | "climax" | "finalHit" | "tailEnd";
export type OptionalEvent = "riser" | "accent" | "landing";
export type EventName = RequiredEvent | OptionalEvent;
export const requiredEvents: readonly RequiredEvent[] = ["intro", "firstHit", "lift", "climax", "finalHit", "tailEnd"];

export interface TrackAnalysis {
  version: number;
  trackId: string;
  title: string;
  artist: string;
  licenseRef: string;
  audioFile: string;
  md5: string;
  durationSeconds: number;
  soundEndSeconds: number;
  grid: { bpm: number; beatZeroSeconds: number; beatsPerBar: number; firstBarSeconds: number };
  loudness: { lufs: number; peakDbfs: number; gainDb: number };
  edit: {
    segments: { sourceFrom: number; sourceTo: number; videoFrom: number }[];
    fadeInFrames: number;
    crossfadeFrames: number;
    crossfade?: "equal-power" | "linear";
  };
  events: Record<RequiredEvent, number> & Partial<Record<OptionalEvent, number>>;
  stop?: { from: number; to: number };
  finalHitWindow: [number, number];
  measuredBy: Record<string, string>;
  reviewed: boolean;
}

export interface Segment {
  /** Video frames [from, to). */
  from: number;
  to: number;
  /** Source frame at `from` (Remotion trims audio in whole frames). */
  trimBefore: number;
}

/** The frame whose display interval contains `seconds`. */
export const frameOf = (seconds: number) => Math.floor(seconds * fps + 1e-6);

/** Everything the film needs from one analysis file, in frames. */
export function createMusic(track: TrackAnalysis) {
  const { bpm, beatsPerBar, beatZeroSeconds } = track.grid;
  const beatSeconds = 60 / bpm;

  /** The first frame of grid beat `index` (0 = the first beat; halves allowed). */
  const beatFrame = (index: number) => frameOf(beatZeroSeconds + index * beatSeconds);
  /** The beat index (on a grid of `step` beats) nearest to `frame`. */
  const nearestBeatIndex = (frame: number, step = 1) =>
    Math.max(0, Math.round((frame / fps - beatZeroSeconds) / beatSeconds / step) * step);
  /** The first whole beat at or after `frame`. */
  const beatIndexAtOrAfter = (frame: number) => {
    let index = Math.max(0, Math.floor((frame / fps - beatZeroSeconds) / beatSeconds) - 1);
    while (beatFrame(index) < frame) index += 1;
    return index;
  };
  const nearestBeat = (frame: number, step = 1) => beatFrame(nearestBeatIndex(frame, step));
  const onBeat = (frame: number, step = 1) => nearestBeat(frame, step) === frame;

  const events = {} as Record<RequiredEvent, number> & Partial<Record<OptionalEvent, number>>;
  for (const [name, seconds] of Object.entries(track.events))
    if (typeof seconds === "number")
      events[name as EventName] = name === "tailEnd" ? Math.round(seconds * fps) : frameOf(seconds);
  for (const name of requiredEvents)
    if (events[name] === undefined) throw new Error(`music/track.analysis.json has no "${name}" event.`);

  const durationInFrames = events.tailEnd;
  const landingFrame =
    track.events.landing !== undefined
      ? Math.round(track.events.landing * fps)
      : beatFrame(Math.ceil((track.events.finalHit - beatZeroSeconds) / beatSeconds));

  const segments: Segment[] = track.edit.segments.map((segment, index, all) => ({
    from: Math.round(segment.videoFrom * fps),
    to: index + 1 < all.length ? Math.round(all[index + 1].videoFrom * fps) : durationInFrames,
    trimBefore: Math.round(segment.sourceFrom * fps),
  }));
  const { fadeInFrames, crossfadeFrames } = track.edit;
  const linear = track.edit.crossfade === "linear";
  const curve = (x: number, out: boolean) =>
    linear ? (out ? 1 - x : x) : out ? Math.cos((x * Math.PI) / 2) : Math.sin((x * Math.PI) / 2);

  /**
   * The gain of segment `index` at video frame `frame` (before the master
   * volume): the fade-in at the start, and the crossfade at each join. The
   * crossfade runs over the `crossfadeFrames` frames before the join, so
   * the downbeat after it is the next segment's alone; it is equal-power
   * (cos/sin) unless the analysis says linear (a linear 2-frame fade dips
   * about 2 dB just before the downbeat, analysis notes).
   */
  function segmentGain(index: number, frame: number): number {
    let gain = 1;
    if (index === 0 && fadeInFrames > 0) gain *= Math.min(1, Math.max(0, (frame + 1) / (fadeInFrames + 1)));
    const segment = segments[index];
    const next = segments[index + 1];
    if (next && frame >= next.from - crossfadeFrames) {
      if (frame >= next.from) return 0;
      gain *= curve((frame - (next.from - crossfadeFrames) + 0.5) / crossfadeFrames, true);
    }
    if (index > 0 && frame < segment.from) {
      if (frame < segment.from - crossfadeFrames) return 0;
      gain *= curve((frame - (segment.from - crossfadeFrames) + 0.5) / crossfadeFrames, false);
    }
    return gain;
  }

  return {
    track,
    bpm,
    beatsPerBar,
    beatSeconds,
    /** Frames per beat (18 at 100 BPM) and per bar (72). */
    beatFrames: beatSeconds * fps,
    barFrames: beatSeconds * fps * beatsPerBar,
    beatFrame,
    /** The first frame of beat `beat` (1-based) of bar `bar` (1-based). */
    barFrame: (bar: number, beat = 1) => beatFrame((bar - 1) * beatsPerBar + (beat - 1)),
    nearestBeatIndex,
    beatIndexAtOrAfter,
    nearestBeat,
    onBeat,
    /** Video-time events in frames; optional events are missing when the track has none. */
    events,
    durationInFrames,
    /** The frame the end-card logo locks on (the final chord). */
    landingFrame,
    /** The 2-beat stop before the first hit (kick and bass out), if the track has one. */
    stop: track.stop ? { from: frameOf(track.stop.from), to: frameOf(track.stop.to) } : undefined,
    musicFile: track.audioFile,
    gainDb: track.loudness.gainDb,
    volume: 10 ** (track.loudness.gainDb / 20),
    fadeInFrames,
    crossfadeFrames,
    segments,
    segmentGain,
    /** Where scripts/measure-hit.mjs and check-output.mjs look for the final hit, in frames. */
    finalHitWindow: track.finalHitWindow.map(frameOf) as [number, number],
  };
}

export type Music = ReturnType<typeof createMusic>;

/** The film's music: the loaded analysis. */
export const music: Music = createMusic(analysis as unknown as TrackAnalysis);
