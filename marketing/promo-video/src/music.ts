/**
 * The music edit: "Ramp It Up" by Ahjay Stelino (Mixkit item 69, Mixkit
 * Stock Music Free License; see MUSIC-LICENSE.md), cut to 75.28 s on its
 * bar grid.
 *
 * Numbers derived from the owner's beat analysis (the analysis file itself is
 * not copied: it holds a local path):
 * - 120 BPM on a fitted grid, beat 0 at 0.146 s, a bar every 2.0 s;
 * - the whole track: -10.4 LUFS integrated, peak +0.48 dBFS, 102.13 s,
 *   sound until 100.43 s;
 * - the edit: source 9.146-49.146 s plays at video 0-40 s (bars 5-24),
 *   then source 65.146 s to its natural end plays from video 40 s (bar 33
 *   on). Both edit points are bar starts.
 *
 * Remotion trims audio in whole video frames: the segments start at source
 * frames 274 and 1954 (9.133 s and 65.133 s), 13 ms before the grid.
 */
export const fps = 30;

export const musicFile = "music/mixkit-ramp-it-up-69.mp3";

export const track = {
  bpm: 120,
  beatZeroSeconds: 0.146,
  /** Bar 1 starts two beats in. */
  firstBarSeconds: 1.146,
  barSeconds: 2,
  lufs: -10.4,
  peakDbfs: 0.48,
  durationSeconds: 102.13,
  soundEndSeconds: 100.43,
} as const;

/** The two source segments, in video frames. */
export const segments = [
  { from: 0, to: 1200, trimBefore: 274, sourceSeconds: [9.146, 49.146] },
  { from: 1200, to: 2259, trimBefore: 1954, sourceSeconds: [65.146, 100.43] },
] as const;

/**
 * Video-time events, in frames. `finalHit` is measured, not estimated: the
 * frame with the largest rise of per-frame RMS level in video 69.5-73.0 s
 * (scripts/measure-hit.mjs; check-output.mjs measures it again in the
 * render). It is the downbeat at 70.0 s (+7.8 dB over the frame before);
 * at about 72.0 s the track falls into its tail, it does not hit.
 */
export const events = {
  riser: 180,
  drop: 240,
  lift: 720,
  climax: 1200,
  accent: 1620,
  finalHit: 2099,
  tailEnd: 2258.4,
} as const;

/** The end-card logo lands this many frames after the measured hit (±7.5 allowed). */
export const logoLandOffset = 5;
export const logoLandFrame = events.finalHit + logoLandOffset;

/**
 * Gain. The whole track measures -10.4 LUFS, but the edit skips its quiet
 * intro and measures -9.75 LUFS, so -4.2 dB (not the -3.6 dB the whole
 * track would need) brings the edit to about -14 LUFS.
 */
export const gainDb = -4.2;
export const volume = 10 ** (gainDb / 20);

/** A fade-in over the first 0.5 s and a 2-frame crossfade at the 40 s cut. */
export const fadeInFrames = 15;
export const crossfadeFrames = 2;

/**
 * The volume of segment `index` at composition frame `frame`: the fade-in,
 * then the crossfade centred on the cut, otherwise the gain.
 */
export function segmentVolume(index: 0 | 1, frame: number): number {
  const cut = segments[1].from;
  const half = crossfadeFrames / 2;
  let level = 1;
  if (index === 0) {
    level = Math.min(1, Math.max(0, frame / fadeInFrames));
    if (frame > cut - half) level *= Math.max(0, (cut + half - frame) / crossfadeFrames);
  } else if (frame < cut + half) {
    level = Math.max(0, (frame - (cut - half)) / crossfadeFrames);
  }
  return level * volume;
}
