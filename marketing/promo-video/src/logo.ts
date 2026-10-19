/**
 * The two logo moments as pure functions of the frame (unit-tested in
 * src/logo.test.ts): the wordmark on the first hit (variant C: crisp on the
 * hit, no blur-in) and the end-card logo that locks on the final chord.
 */
import { ease, tween } from "./look/motion.ts";
import { fps, frameOf, music } from "./music.ts";
import { shotById, takeOf } from "./timeline.ts";

const s3 = shotById("s3-rules");
const take = takeOf(s3, "logo");
const end = shotById("s14-end");

/** The product's own one-line description (site/index.html), under the wordmark on the first hit (an owner sign-off). */
export const DESCRIPTOR = "A learning workbench for AI-assisted open-source contributions.";

/** The wordmark holds at full strength until ten frames before its take ends, then leaves, so the white studio is empty for two or three frames at most. */
export const logoLeaves = take.to - 10;
export const logoTake = take;

/**
 * Opacity, scale, blur and lift of the first-hit wordmark (and the line
 * under it) at absolute frame f: crisp on the hit, then a slow linear push
 * from 1.00 to 1.04 through the whole take, so the drop is never a still.
 */
export function logoState(f: number) {
  if (f < take.from || f >= take.to) return { opacity: 0, scale: 1, blur: 0, y: 0 };
  // It fades out through the take's last frame, so no empty frame sits between it and the window.
  const leave = tween(f, logoLeaves, take.to, ease.depart);
  return {
    opacity: 1 - leave,
    scale: 1 + (0.04 * (f - take.from)) / (take.to - 1 - take.from),
    blur: 6 * leave,
    y: -16 * leave,
  };
}

/**
 * The lights-on exposure: the studio flares a little brighter on the hit (a
 * white wash of `alpha`, about 7 levels on the plate) and settles to its
 * normal level six frames later. The wordmark is drawn above it, crisp.
 */
export const FLARE_FRAMES = 6;
export const flareAt = (f: number) => (f < take.from ? 0 : 0.28 * (1 - tween(f, take.from, take.from + FLARE_FRAMES, ease.arrive)));

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
 * one) on an accelerating curve, so it is still resolving through the
 * pushed kick (no more than 70% by the eighth frame) and every frame
 * changes more than the one before: the last fifth of the resolve and the
 * settle from 1.02 to 1.0 come in the three frames before the final chord
 * and complete ON it, and the chord frame carries the largest change of the
 * whole pull, so the lock is the chord's visible event (review round 7: a
 * logo 95% resolved four frames early left the chord with nothing to show).
 */
export const LOCK_FRAMES = 3;
export function endLogoState(f: number) {
  if (f < end.from) return { opacity: 0, blur: 0, scale: 1 };
  const x = tween(f, end.from, chordFrame, ease.linear);
  const p = x ** 1.7;
  const q = tween(f, chordFrame - LOCK_FRAMES, chordFrame, ease.depart);
  return { opacity: Math.max(0.22, p), blur: 14 * (1 - p), scale: 1.02 - 0.02 * q };
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
