/**
 * The bell's flight, the match cut from the first-hit lockup into S3's
 * floating window (owner's feedback after round 8): on beat 3 of bar 5 the
 * bell glyph of the wordmark lifts off and flies, on one eased arc, onto the
 * app's own bell in the window's sidebar, landing on the bar-6 downbeat
 * exactly on it: the same position, size, colour and tilt, because at the
 * landing it is drawn through the window's own transform (the same view, the
 * same perspective). Then it hands off to the footage's bell in a true
 * cross-dissolve inside a beat's hold (HANDOFF). The name and
 * the descriptor dissolve in the flight's first frames (src/logo.ts) while
 * the window rises in underneath. Pure functions of the film frame
 * (src/bell.test.ts); src/look/BellFlight.tsx draws it.
 */
import { perspective, place } from "./look/camera.ts";
import { ease, tween } from "./look/motion.ts";
import { LOCKUP, lockupScale } from "./logo.ts";
import { music } from "./music.ts";
import { looks } from "./shots.ts";
import { takeView } from "./takes.ts";
import { shotById, takeOf } from "./timeline.ts";

const s3 = shotById("s3-rules");
const establish = takeOf(s3, "establish");
const look = looks["s3-rules"].establish;
const beat = music.beatFrames;
const LOCKUP_FROM = takeOf(s3, "logo").from;

/** The mark's grid (64 units square); the wordmark draws it 8 units further left. */
export const MARK_UNITS = 64;
const WORDMARK_MARK_X = -8;

/**
 * The app's own bell in the capture the window shows (v-rules-card/overview): the sidebar wordmark's mark, its
 * 64-unit box in capture CSS px. The sidebar lays the wordmark out 30 px high at x 27 (15 px of sidebar padding and
 * 12 of the brand row's), centred in the 35 px brand row under 28 px of padding: the box is (27 - 8 x 30/64, 30.5),
 * 30 px square. scripts/measure-bell.mjs finds it in the capture by its moments at (23.258, 30.572), 29.971 px:
 * within 0.08 capture px (scripts/bell.test.mjs keeps the two together).
 */
export const FOOTAGE_BELL = { x: 23.25, y: 30.5, size: 30 } as const;

/** The paper round the app's bell (the sidebar's surface, sampled in the capture), for the patch that hides it in flight. */
export const SIDEBAR_PAPER = "#f4f6f1";

/**
 * The flight: from beat 3 of bar 5 (the lockup readable for a bar and a half) to the bar-6 downbeat, two beats
 * (1.2 s); then a beat's hold in which the hand-off happens, before the window turns to its rest (src/shots.ts).
 */
export const FLIGHT = {
  from: establish.from,
  to: establish.from + 2 * beat,
  /** The window holds until here after the landing (src/shots.ts), so the eye sees the logo become the app's. */
  holdTo: establish.from + 3 * beat,
} as const;

/**
 * The hand-off after the landing, a true cross-dissolve: on the landing frame the patch in the window gives way to
 * the same paper carried under the flying bell (the two cover the footage's bell alike, so nothing changes on
 * screen), then the flying bell and its paper fade out together over the footage's bell, so every pixel blends
 * from the vector to the footage (coverage F x vector + (1 - F) x footage), never both at once.
 */
export const HANDOFF = {
  bell: { from: FLIGHT.to + 2, to: FLIGHT.to + 12 },
} as const;

/**
 * The arc's shape, as shares of the straight line from lift-off to landing: it bows out of the line by ARC at its
 * middle, to the lower left, and its bend sits SKEW further along the line, towards the landing. So the bell
 * leaves the lockup moving left and up, away from its name, and comes into the app's bell from the lower left,
 * never across the app's own "BELL PR" to the right of it (src/bell.test.ts checks every frame against the
 * window's moving picture).
 */
export const ARC = 0.1;
export const SKEW = 0.25;

/** The bell's pose: its centre in the stage's 3D space (screen px before the perspective divide), px a unit, tilt, opacity. */
export interface BellPose {
  x: number;
  y: number;
  z: number;
  /** Screen px per mark unit, before the perspective divide. */
  unit: number;
  rx: number;
  ry: number;
  opacity: number;
}

/** The bell in the lockup at frame f: where the wordmark's own mark would be, on the lockup's push. */
export function lockupBell(f: number) {
  const s = lockupScale(f);
  const cx = LOCKUP.left + (WORDMARK_MARK_X + MARK_UNITS / 2) * LOCKUP.unit;
  const cy = LOCKUP.top + (MARK_UNITS / 2) * LOCKUP.unit;
  return {
    x: LOCKUP.origin.x + (cx - LOCKUP.origin.x) * s,
    y: LOCKUP.origin.y + (cy - LOCKUP.origin.y) * s,
    z: 0,
    unit: LOCKUP.unit * s,
    rx: 0,
    ry: 0,
  };
}

/** The window's view at absolute frame f (S3's establishing take). */
export const windowView = (f: number) => takeView(look, f - establish.from);

/** The app's bell at frame f, through the window's own transform: centre in 3D, px a unit, tilt. */
export function windowBell(f: number) {
  const view = windowView(f);
  const p = place(view, FOOTAGE_BELL.x + FOOTAGE_BELL.size / 2, FOOTAGE_BELL.y + FOOTAGE_BELL.size / 2);
  return { ...p, unit: (view.m * FOOTAGE_BELL.size) / MARK_UNITS, rx: view.rx, ry: view.ry };
}

/** Where the bell lands: the app's bell on the landing frame. */
const landing = windowBell(FLIGHT.to);

/** The arc's control point (a quadratic Bezier's middle sits half way from the line to it). */
export const control = (() => {
  const a = lockupBell(FLIGHT.from);
  const b = landing;
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const length = Math.hypot(dx, dy);
  // The normal that points down the frame (the line runs up and to the left).
  let [nx, ny] = [-dy / length, dx / length];
  if (ny < 0) [nx, ny] = [-nx, -ny];
  return {
    x: (a.x + b.x) / 2 + nx * 2 * ARC * length + (dx / length) * SKEW * length,
    y: (a.y + b.y) / 2 + ny * 2 * ARC * length + (dy / length) * SKEW * length,
  };
})();

/** How far along the flight the bell is at frame f (0 before, 1 from the landing on), eased. */
export const flightProgress = (f: number) => tween(f, FLIGHT.from, FLIGHT.to, ease.flight);

/**
 * The bell at absolute frame f: in the lockup until the flight, then along the arc from the lockup (still on its
 * push) to the app's bell (still moving with the window, so the two meet exactly), its size and its tilt on the
 * same eased curve as its position (the size linear in it, so the bell stays a readable logo through the flight
 * and comes down to the app's size as it docks); from the landing on, the app's bell itself.
 */
export function bellAt(f: number): BellPose {
  const opacity = f < LOCKUP_FROM ? 0 : 1 - tween(f, HANDOFF.bell.from, HANDOFF.bell.to, ease.standard);
  const t = flightProgress(f);
  if (t <= 0) return { ...lockupBell(f), opacity };
  const b = windowBell(f);
  if (t >= 1) return { ...b, opacity };
  const a = lockupBell(f);
  const u = 1 - t;
  // The arc ends where the app's bell lands; the window's last few px of travel to it are added in as the bell
  // arrives (t^6), so the bell meets the app's bell exactly without the window's rise bending its arc.
  const end = landing;
  const follow = t ** 6;
  return {
    x: u * u * a.x + 2 * u * t * control.x + t * t * end.x + follow * (b.x - end.x),
    y: u * u * a.y + 2 * u * t * control.y + t * t * end.y + follow * (b.y - end.y),
    z: t * t * end.z + follow * (b.z - end.z),
    unit: u * a.unit + t * b.unit,
    rx: t * b.rx,
    ry: t * b.ry,
    opacity,
  };
}

/**
 * Where point (u, v) of the mark's 64-unit grid lands on screen at frame f: the CSS transform BellFlight draws
 * (translate3d to the centre, the tilt, the grid scaled by `unit` about its middle) under the stage's perspective.
 */
export function bellPoint(f: number, u: number, v: number) {
  const pose = bellAt(f);
  const local = place({ cx: MARK_UNITS / 2, cy: MARK_UNITS / 2, m: pose.unit, sx: pose.x, sy: pose.y, rx: pose.rx, ry: pose.ry }, u, v);
  return perspective({ x: local.x, y: local.y, z: local.z + pose.z });
}

/** The bell's centre on screen at frame f, and its size there (screen px a unit, after the perspective divide). */
export function bellOnScreen(f: number) {
  const pose = bellAt(f);
  const p = perspective(pose);
  return { x: p.x, y: p.y, unit: pose.unit * p.k, opacity: pose.opacity };
}

/** The patch over the footage's bell in the window: on until the landing; from then the flying bell carries it (HANDOFF). */
export const footagePatch = (f: number) => (f < FLIGHT.to ? 1 : 0);

/** The patch's box (capture px): the mark's outline (units 8-56 x 3.3-60.5) with a 1.5 px margin, clear of the "B" at 56.3. */
export const PATCH_BOX = (() => {
  const k = FOOTAGE_BELL.size / MARK_UNITS;
  return [FOOTAGE_BELL.x + 8 * k - 1.5, FOOTAGE_BELL.y + 3.3 * k - 1.5, FOOTAGE_BELL.x + 56 * k + 1.5, FOOTAGE_BELL.y + 60.5 * k + 1.5] as const;
})();

/** The same box in the mark's own units (its 64-unit grid), for the paper the flying bell carries from the landing on. */
export const PATCH_UNITS = (() => {
  const k = FOOTAGE_BELL.size / MARK_UNITS;
  return PATCH_BOX.map((v, i) => (v - (i % 2 === 0 ? FOOTAGE_BELL.x : FOOTAGE_BELL.y)) / k) as unknown as readonly [number, number, number, number];
})();

/** Whether the flying bell carries the sidebar's paper under it at frame f (from the landing on). */
export const carriesPaper = (f: number) => f >= FLIGHT.to;
