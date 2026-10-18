/** Springs and easings (lookdev STYLE-GUIDE §4.1-4.2, measured on remotion 4.0.531). */
import { Easing, interpolate, spring, type SpringConfig } from "remotion";

export const springs = {
  typeRise: { mass: 1, damping: 26, stiffness: 120 },
  heroSettle: { mass: 1, damping: 22, stiffness: 110 },
  heroGlide: { mass: 1.4, damping: 30, stiffness: 70 },
  heavyPush: { mass: 2, damping: 40, stiffness: 60 },
  macroLock: { mass: 1, damping: 24, stiffness: 140 },
  logoLand: { mass: 1, damping: 20, stiffness: 170 },
  uiPop: { mass: 0.6, damping: 16, stiffness: 180 },
} satisfies Record<string, Partial<SpringConfig>>;

export const ease = {
  standard: Easing.bezier(0.65, 0, 0.35, 1),
  arrive: Easing.bezier(0.16, 1, 0.3, 1),
  softArrive: Easing.bezier(0.22, 1, 0.36, 1),
  drift: Easing.bezier(0.37, 0, 0.63, 1),
  depart: Easing.bezier(0.32, 0, 0.67, 0),
  whip: Easing.bezier(0.76, 0, 0.24, 1),
  sweep: Easing.bezier(0.45, 0, 0.55, 1),
  linear: (x: number) => x,
  /** heroGlide stretched over the move (a rise from rest that settles long, no overshoot). */
  glide: (x: number) =>
    x <= 0 ? 0 : x >= 1 ? 1 : spring({ frame: x * 36, fps: 30, config: { mass: 1.4, damping: 30, stiffness: 70 }, durationInFrames: 36 }),
};

export type EaseName = keyof typeof ease;

/** 0..1 from frame `from` to `to`, eased and clamped. */
export const tween = (f: number, from: number, to: number, easing: (x: number) => number = ease.standard) =>
  to <= from ? (f >= to ? 1 : 0) : interpolate(f, [from, to], [0, 1], { easing, extrapolateLeft: "clamp", extrapolateRight: "clamp" });

export const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Camera breathing on holds: +1.2% scale per bar (72 f), linear (STYLE-GUIDE §3.5). */
export const drift = (framesHeld: number, perBar = 0.012) => 1 + (perBar * Math.max(0, framesHeld)) / 72;

/** A CSS blur filter, or nothing when it would not show. */
export const blurCss = (px: number) => (px > 0.05 ? `blur(${px.toFixed(2)}px)` : undefined);
