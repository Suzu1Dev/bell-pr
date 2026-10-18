/**
 * The two logo moments as pure functions of the frame (unit-tested in
 * src/logo.test.ts): the wordmark on the first hit (variant C: crisp on the
 * hit, no blur-in) and the end-card logo that locks on the final chord.
 */
import { spring } from "remotion";
import { drift, ease, springs, tween } from "./look/motion.ts";
import { fps, music } from "./music.ts";
import { shotById, takeOf } from "./timeline.ts";

const s3 = shotById("s3-rules");
const take = takeOf(s3, "logo");
const end = shotById("s14-end");

/** The wordmark starts to leave two beats after the hit and has gone at the end of its take. */
export const logoLeaves = take.from + 2 * music.beatFrames;
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

/** Opacity, blur and scale of the end-card logo at absolute frame f: it pulls into focus from the cut (never an empty frame) and locks on the chord. */
export function endLogoState(f: number) {
  if (f < end.from) return { opacity: 0, blur: 0, scale: 1 };
  // The pull starts as if two frames before the cut, so the cut frame already holds a soft logo.
  const p = tween(f, end.from - 2, music.landingFrame, ease.arrive);
  return { opacity: p, blur: 18 * (1 - p), scale: 1.05 - 0.05 * p };
}
