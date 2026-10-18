/**
 * The two logo moments as pure functions of the frame (unit-tested in
 * src/logo.test.ts): the wordmark on the first hit (variant C: crisp on the
 * hit, no blur-in) and the end-card logo that locks on the final chord.
 */
import { spring } from "remotion";
import { drift, ease, springs, tween } from "./look/motion.ts";
import { fps, frameOf, music } from "./music.ts";
import { shotById, takeOf } from "./timeline.ts";

const s3 = shotById("s3-rules");
const take = takeOf(s3, "logo");
const end = shotById("s14-end");

/** The wordmark holds at full strength until ten frames before its take ends, then leaves, so the white studio is empty for two or three frames at most. */
export const logoLeaves = take.to - 10;
export const logoTake = take;

/** Opacity, scale, blur and lift of the first-hit wordmark at absolute frame f. */
export function logoState(f: number) {
  if (f < take.from || f >= take.to) return { opacity: 0, scale: 1, blur: 0, y: 0 };
  const settle = spring({ frame: f - take.from, fps, config: springs.macroLock });
  // It fades out through the take's last frame, so no empty frame sits between it and the window.
  const leave = tween(f, logoLeaves, take.to, ease.depart);
  return {
    opacity: 1 - leave,
    scale: (1.02 - 0.02 * settle) * drift(Math.min(f, logoLeaves) - take.from),
    blur: 6 * leave,
    y: -16 * leave,
  };
}

/**
 * The final chord, by the frame rule (the frame whose display interval
 * holds it): the end-card logo resolves on it, and its light sweep and the
 * glint start on it. music.landingFrame (the lead's rounded frame) is the
 * frame after, by which everything has locked.
 */
export const chordFrame = Math.min(music.landingFrame, frameOf(music.track.events.landing ?? music.landingFrame / fps));

/**
 * Opacity, blur and scale of the end-card logo at absolute frame f: it pulls
 * into focus from the cut (a soft logo on the cut frame, never an empty
 * one) on an even in-out curve, so it is still resolving through the pushed kick
 * (no more than 70% by the eighth frame) and locks ON the final chord,
 * settling from 1.02 to 1.0 on the same frame.
 */
export function endLogoState(f: number) {
  if (f < end.from) return { opacity: 0, blur: 0, scale: 1 };
  // An even in-out (`drift`): about two thirds there eight frames after the cut, whole on the chord.
  const p = tween(f, end.from, chordFrame, ease.drift);
  return { opacity: Math.max(0.22, p), blur: 14 * (1 - p), scale: 1.02 - 0.02 * p };
}

/** The logo is the hero on the chord (centred, 520 px), then moves up to its slot over the headline in one beat. */
export const END_LOGO = {
  hero: { cy: 452, width: 520 },
  slot: { cy: 222, width: 330 },
  moveFrom: chordFrame + music.beatFrames,
  moveTo: chordFrame + 2 * music.beatFrames,
} as const;

export function endLogoPlace(f: number) {
  const t = tween(f, END_LOGO.moveFrom, END_LOGO.moveTo, ease.standard);
  return { cy: END_LOGO.hero.cy + (END_LOGO.slot.cy - END_LOGO.hero.cy) * t, width: END_LOGO.hero.width + (END_LOGO.slot.width - END_LOGO.hero.width) * t };
}
