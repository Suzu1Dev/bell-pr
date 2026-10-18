/**
 * One camera model for every product shot: a view puts capture CSS point
 * (cx, cy) at screen point (sx, sy), magnified m times (output px per
 * capture CSS px at 1080p), tilted rx/ry degrees about that point under the
 * stage's perspective. A floating window (variant B's establishing shot) is
 * a view with m below 1 and the point at 50%/60% of the window; a push-in
 * (variant C) is a view with m of 1.3-2. Moving between views interpolates
 * every value (m in log space), so a push reads as an even move in depth.
 *
 * The window element is laid out at `layout` CSS px per capture px (the
 * largest magnification of the take, times a supersample for tilted
 * windows) and only ever scaled down by the transform (lookdev STYLE-GUIDE
 * §4.4: size with layout, animate with transform <= 1).
 */
import { CAPTURE } from "../footage.ts";
import { ease, mix, type EaseName } from "./motion.ts";

export const PERSPECTIVE = 2400;
export const PERSPECTIVE_ORIGIN = { x: 960, y: 1080 * 0.45 } as const;

export interface View {
  cx: number;
  cy: number;
  m: number;
  sx: number;
  sy: number;
  rx: number;
  ry: number;
}

/** A floating window `width` px wide whose point at 50%/60% sits at (960 + x, 540 + 0.1 h + y). */
export const floating = (width: number, { x = 0, y = 0, rx = 0, ry = 0 } = {}): View => {
  const m = width / CAPTURE.width;
  return { cx: CAPTURE.width / 2, cy: CAPTURE.height * 0.6, m, sx: 960 + x, sy: 540 + 0.1 * CAPTURE.height * m + y, rx, ry };
};

/**
 * A push-in on capture point (cx, cy) at magnification m, placed at screen
 * (sx, sy). By default the placement is clamped so the window covers the
 * whole frame (no sliver of studio at an edge; a tilt widens the margin).
 */
export const push = (
  cx: number,
  cy: number,
  m: number,
  {
    sx = 960,
    sy = 540,
    rx = 0,
    ry = 0,
    cover = true,
    right,
    left,
  }: {
    sx?: number;
    sy?: number;
    rx?: number;
    ry?: number;
    cover?: boolean;
    /** Show the window's right (or left) edge this many px inside the frame, with the studio beyond it. */
    right?: number;
    left?: number;
  } = {},
): View => {
  if (right !== undefined) sx = 1920 - right - (CAPTURE.width - cx) * m;
  else if (left !== undefined) sx = left + cx * m;
  else if (cover) sx = coverClamp(sx, cx, m, CAPTURE.width, 1920, 30 + Math.abs(ry) * 9);
  if (cover) sy = coverClamp(sy, cy, m, CAPTURE.height, 1080, 30 + Math.abs(rx) * 9);
  return { cx, cy, m, sx, sy, rx, ry };
};

/** The screen position of point c (of a span `span` long, magnified m) that keeps the span over [-margin, frame + margin]. */
function coverClamp(s: number, c: number, m: number, span: number, frame: number, margin: number) {
  const low = frame + margin - (span - c) * m;
  const high = c * m - margin;
  return low <= high ? Math.min(high, Math.max(low, s)) : (low + high) / 2;
}

export interface Key {
  /** Beats from the take's start. */
  at: number;
  view: View;
  /** The easing of the move that ends on this key. */
  ease?: EaseName;
}

/** The view at `beats` from the take's start, between the keys (held before the first and after the last). */
export function viewAt(keys: Key[], beats: number): View {
  if (beats <= keys[0].at) return keys[0].view;
  for (let i = 1; i < keys.length; i += 1) {
    const a = keys[i - 1];
    const b = keys[i];
    if (beats <= b.at) {
      const t = (ease[b.ease ?? "standard"] as (x: number) => number)((beats - a.at) / Math.max(1e-6, b.at - a.at));
      return lerpView(a.view, b.view, t);
    }
  }
  return keys.at(-1)!.view;
}

export const lerpView = (a: View, b: View, t: number): View => ({
  cx: mix(a.cx, b.cx, t),
  cy: mix(a.cy, b.cy, t),
  m: Math.exp(mix(Math.log(a.m), Math.log(b.m), t)),
  sx: mix(a.sx, b.sx, t),
  sy: mix(a.sy, b.sy, t),
  rx: mix(a.rx, b.rx, t),
  ry: mix(a.ry, b.ry, t),
});

/** The window element's CSS transform (transform-origin 0 0) for a view, at layout `layout`. */
export const viewTransform = (v: View, layout: number) =>
  `translate3d(${v.sx.toFixed(3)}px, ${v.sy.toFixed(3)}px, 0) rotateY(${v.ry.toFixed(4)}deg) rotateX(${v.rx.toFixed(4)}deg) ` +
  `scale(${(v.m / layout).toFixed(6)}) translate(${(-v.cx * layout).toFixed(3)}px, ${(-v.cy * layout).toFixed(3)}px)`;

/** Where capture CSS point (x, y) lands on screen under view v (the CSS 3D math, with the perspective divide). */
export function project(v: View, x: number, y: number) {
  let px = (x - v.cx) * v.m;
  let py = (y - v.cy) * v.m;
  let pz = 0;
  const rx = (v.rx * Math.PI) / 180;
  const ry = (v.ry * Math.PI) / 180;
  // rotateX applies first (rightmost in the transform list), then rotateY.
  [py, pz] = [py * Math.cos(rx) - pz * Math.sin(rx), py * Math.sin(rx) + pz * Math.cos(rx)];
  [px, pz] = [px * Math.cos(ry) + pz * Math.sin(ry), -px * Math.sin(ry) + pz * Math.cos(ry)];
  const wx = v.sx + px;
  const wy = v.sy + py;
  const k = PERSPECTIVE / (PERSPECTIVE - pz);
  return { x: PERSPECTIVE_ORIGIN.x + (wx - PERSPECTIVE_ORIGIN.x) * k, y: PERSPECTIVE_ORIGIN.y + (wy - PERSPECTIVE_ORIGIN.y) * k, z: pz };
}

/** The window's four projected corners. */
export const corners = (v: View) => [
  project(v, 0, 0),
  project(v, CAPTURE.width, 0),
  project(v, CAPTURE.width, CAPTURE.height),
  project(v, 0, CAPTURE.height),
];

/** Whether all four window edges are inside the frame with `margin` px to spare. */
export const wholeWindowInFrame = (v: View, margin = 0) =>
  corners(v).every((c) => c.x >= margin && c.x <= 1920 - margin && c.y >= margin && c.y <= 1080 - margin);

/** Screen speed (px per frame) of capture point (x, y) between two views one frame apart. */
export const speed = (a: View, b: View, x: number, y: number) => {
  const p = project(a, x, y);
  const q = project(b, x, y);
  return { dx: q.x - p.x, dy: q.y - p.y };
};
