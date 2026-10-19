/**
 * The camera of a take over time (pure; src/scenes/ProductShot.tsx draws it,
 * src/look.test.ts checks it), in two parts (review round 7): the keys of
 * src/shots.ts in beats (the move that leaves the cut, eased with `push` by
 * default: no more than 60% of a two-beat move in its first beat), and a
 * linear drift through the whole take, so the camera is still moving on the
 * out-cut, on a held clip frame as much as on a moving one.
 */
import { viewAt, type View } from "./look/camera.ts";
import { ease, tween } from "./look/motion.ts";
import { music } from "./music.ts";
import type { TakeLook } from "./shots.ts";

/** The drift per bar: scale (fraction) and screen px along x and y. */
export interface Drift {
  scale?: number;
  x?: number;
  y?: number;
}

/** The default drift: +2% scale and 12 px to the left a bar (the reviewers asked for 1.5-2.5% and 8-16 px). */
export const DRIFT = { scale: 0.02, x: -12, y: 0 } as const;

/** A view carried `frames` frames along by a drift. */
export const driftView = (view: View, frames: number, drift: Drift = {}): View => {
  const bars = Math.max(0, frames) / music.barFrames;
  const d = { ...DRIFT, ...drift };
  return { ...view, m: view.m * (1 + d.scale * bars), sx: view.sx + d.x * bars, sy: view.sy + d.y * bars };
};

/** The camera at frame `f` of a take (frames from its start). */
export function takeView(look: TakeLook, f: number): View {
  return driftView(viewAt(look.keys, f / music.beatFrames), f, look.drift);
}

/** The largest magnification of a take. */
export const takeMaxM = (look: TakeLook, frames: number) => {
  let max = 0;
  for (let f = 0; f <= frames; f += 6) max = Math.max(max, takeView(look, f).m);
  return Math.max(max, takeView(look, frames).m);
};

/** The window's opacity at frame `f` of a take: 1, or its fade-in (a window rising in under the first-hit bell). */
export const takeOpacity = (look: TakeLook, f: number) =>
  look.fadeIn ? tween(f, look.fadeIn.from * music.beatFrames, look.fadeIn.to * music.beatFrames, ease.standard) : 1;
