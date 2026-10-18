/**
 * The sound design (lookdev STYLE-GUIDE §8): Mixkit sound effects under the
 * Mixkit Sound Effects Free License (SFX-LICENSES.md), each placed from the
 * cut so it follows the music when the timeline flexes:
 *
 * - an air swell through the exhale of the stop, cut on the first hit (no
 *   impact on the crash itself);
 * - a soft whoosh peaking as each section's floating window lands (two
 *   different files, alternating, at most one per bar);
 * - a quiet, dry tick on every click the pointer makes on screen;
 * - a sparse keyboard bed while an answer types out (never per character);
 * - one glint with the end card's light sweep.
 *
 * Levels (measured against a music-only render, review.md): the swell and
 * the whooshes sit 17-23 dB under the music at their moments, the glint
 * about 20, the ticks and the keyboard bed lower still; alone, no effect
 * peaks above -16 dBTP and no tick above -20 dBTP; the full mix measures
 * the same integrated loudness as the music alone.
 */
import type { Footage } from "./footage.ts";
import { exhale } from "./moments.ts";
import { music } from "./music.ts";
import { looks } from "./shots.ts";
import { timeline } from "./timeline.ts";
import { clicksBetween } from "./look/pointer.ts";

export const SFX = {
  swell: { file: "mixkit-vacuum-swoosh-transition-1465.wav", peakFrame: 47 },
  whooshA: { file: "mixkit-air-woosh-1489.wav", peakFrame: 21 },
  whooshB: { file: "mixkit-cinematic-wind-swoosh-1471.wav", peakFrame: 12 },
  glint: { file: "mixkit-fairy-magic-sparkle-871.wav", onsetFrame: 5 },
  tick: { file: "mixkit-clear-mouse-clicks-2997.wav" },
  keys: { file: "mixkit-typing-on-a-laptop-keyboard-2531.wav" },
} as const;

export interface SfxCue {
  name: string;
  file: string;
  /** Film frame the sequence starts on. */
  from: number;
  /** Frames of the file skipped at its start. */
  trimBefore: number;
  durationInFrames: number;
  gainDb: number;
  fadeInFrames?: number;
  fadeOutFrames?: number;
}

/** The pairs of capture marks between which an answer types out. */
const TYPING: [string, string][] = [
  ["typing", "typed"],
  ["summary", "summary-typed"],
  ["question", "question-typed"],
  ["untested", "untested-typed"],
  ["correction", "correction-typed"],
  ["why", "why-typed"],
];

export function sfxCues(footage: Footage): SfxCue[] {
  const cues: SfxCue[] = [];
  const hit = music.events.firstHit;
  // The swell: its loudest frame would fall on the hit; the sequence ends one frame before it.
  cues.push({
    name: "swell into the first hit",
    file: SFX.swell.file,
    from: exhale,
    trimBefore: SFX.swell.peakFrame - (hit - exhale),
    durationInFrames: hit - exhale,
    gainDb: -15.5,
    fadeInFrames: 4,
    fadeOutFrames: 1,
  });
  let whoosh = 0;
  let typed = 0;
  for (const shot of timeline.shots)
    for (const take of shot.takes) {
      const look = looks[shot.id]?.[take.id];
      if (!look) continue;
      if (look.float) {
        // Peaks as the window arrives: a rise lands on its second key; a turn in place starts on the cut.
        const landing = take.from + (look.keys.length > 2 ? Math.round(look.keys[1].at * music.beatFrames) : 4);
        const sound = whoosh % 2 === 0 ? SFX.whooshA : SFX.whooshB;
        cues.push({
          name: `whoosh: ${shot.id} window lands`,
          file: sound.file,
          from: landing - sound.peakFrame,
          trimBefore: 0,
          durationInFrames: sound.peakFrame + 30,
          gainDb: shot.id === "s11-your-words" ? -21 : -17,
          fadeOutFrames: 10,
        });
        whoosh += 1;
      }
      const state = footage[look.state];
      if (!state || look.still !== undefined) continue;
      const clipFrom = look.clipFrom ?? 0;
      const rate = look.rate ?? 1;
      const clipTo = clipFrom + ((take.to - take.from) / 30) * rate;
      const filmFrame = (t: number) => take.from + Math.round(((t - clipFrom) / rate) * 30);
      for (const click of clicksBetween(state.events, clipFrom, clipTo))
        cues.push({
          name: `tick: ${shot.id} ${click.target ?? "click"}`,
          file: SFX.tick.file,
          from: filmFrame(click.t),
          trimBefore: 0,
          durationInFrames: 5,
          // The file peaks at -1 dBTP: -19.5 dB keeps a tick under -20 dBTP alone (STYLE-GUIDE §8.3).
          gainDb: -19.5,
          fadeOutFrames: 2,
        });
      for (const [start, end] of TYPING) {
        const a = state.marks[start];
        const b = state.marks[end];
        if (a === undefined || b === undefined) continue;
        const from = Math.max(take.from, filmFrame(a));
        const to = Math.min(take.to, filmFrame(b));
        if (to - from < 8) continue;
        cues.push({
          name: `keys: ${shot.id} ${start}`,
          file: SFX.keys.file,
          from,
          trimBefore: 45 + 66 * (typed % 8),
          durationInFrames: to - from,
          // -20.5 LUFS in the file: about 25 LU under the music, a bed that is felt, not heard.
          gainDb: -19,
          fadeInFrames: 3,
          fadeOutFrames: 4,
        });
        typed += 1;
      }
    }
  const end = timeline.shots.at(-1)!;
  cues.push({
    name: "glint: end-card sweep",
    file: SFX.glint.file,
    from: music.landingFrame + 4 - SFX.glint.onsetFrame,
    trimBefore: 0,
    durationInFrames: Math.min(36, end.to - (music.landingFrame + 4 - SFX.glint.onsetFrame)),
    gainDb: -20,
    fadeOutFrames: 8,
  });
  return cues.filter((cue) => cue.durationInFrames > 0).sort((a, b) => a.from - b.from);
}

/** The linear gain of a cue at frame f of its sequence. */
export function cueGain(cue: SfxCue, f: number) {
  const level = 10 ** (cue.gainDb / 20);
  const fadeIn = cue.fadeInFrames ? Math.min(1, (f + 1) / (cue.fadeInFrames + 1)) : 1;
  const fadeOut = cue.fadeOutFrames ? Math.min(1, (cue.durationInFrames - f) / (cue.fadeOutFrames + 1)) : 1;
  return level * Math.max(0, Math.min(fadeIn, fadeOut));
}
