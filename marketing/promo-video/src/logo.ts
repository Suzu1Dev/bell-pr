/**
 * The two logo moments as pure functions of the frame (unit-tested in
 * src/logo.test.ts): the wordmark on the first hit (variant C: crisp on the
 * hit, no blur-in; its bell then flies into S3's window, src/bell.ts) and
 * the end-card logo that locks on the final chord.
 */
import { ease, tween } from "./look/motion.ts";
import { fps, frameOf, music } from "./music.ts";
import { shotById, takeOf } from "./timeline.ts";

const s3 = shotById("s3-rules");
const take = takeOf(s3, "logo");
const end = shotById("s14-end");

/** The product's own one-line description (site/index.html), under the wordmark on the first hit (an owner sign-off). */
export const DESCRIPTOR = "A learning workbench for AI-assisted open-source contributions.";

export const logoTake = take;

/**
 * The first-hit lockup, laid out as the reviewed cut laid it out (src/scenes/BrandHit.tsx keeps its centred
 * column): the wordmark 560 px wide (its 196 x 64 unit box) pulled up 110 px, the descriptor (DM Sans 44 px,
 * line-height normal, 1.302 em) 34 px under it, the column centred in the frame. That puts the wordmark's box at
 * 347.93, which Chrome draws on the device pixel: 348 at 1x and at the 4K master's 2x. The bell, drawn on its own
 * (src/look/BellFlight.tsx), sits in that box. The push scales the whole lockup about the frame's centre.
 */
const COLUMN = (560 * 64) / 196 - 110 + 34 + 44 * 1.302;
export const LOCKUP = {
  width: 560,
  /** Screen px a wordmark unit, before the push. */
  unit: 560 / 196,
  left: 960 - 560 / 2,
  marginTop: -110,
  descriptorGap: 34,
  /** The wordmark box's top as drawn (the column's 347.93 on the device pixel). */
  top: Math.round((1080 - COLUMN) / 2 - 110),
  /** The descriptor's line box top (the column's own value; Chrome sets the text on the device pixel). */
  descriptorTop: (1080 - COLUMN) / 2 - 110 + (560 * 64) / 196 + 34,
  origin: { x: 960, y: 540 },
} as const;

/** The slow push of the reviewed cut (1.00 to 1.04 over its 53 frames), from the hit until the lockup has gone. */
export const PUSH_PER_FRAME = 0.04 / 53;
export const lockupScale = (f: number) => 1 + PUSH_PER_FRAME * Math.max(0, f - take.from);

/**
 * The name and the descriptor dissolve over the first seven frames of the bell's flight (src/bell.ts), as the bell
 * lifts off: crisp and whole until then, gone before the window rising under them reaches them.
 */
export const TEXT_LEAVE = { from: take.to, to: take.to + 7 } as const;

/**
 * Opacity, scale, blur and lift of the lockup's name and descriptor at absolute frame f: crisp on the hit, the slow
 * linear push through the hold (the drop is never a still), then a short blurred dissolve. The bell is drawn on
 * its own (src/look/BellFlight.tsx) on the same push.
 */
export function logoState(f: number) {
  if (f < take.from || f >= TEXT_LEAVE.to) return { opacity: 0, scale: 1, blur: 0, y: 0 };
  const leave = tween(f, TEXT_LEAVE.from, TEXT_LEAVE.to, ease.standard);
  return { opacity: 1 - leave, scale: lockupScale(f), blur: 5 * leave, y: -12 * leave };
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
