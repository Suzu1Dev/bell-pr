/**
 * The drawn pointer of one product take, from the capture's recorded moves
 * and clicks (scripts/capture.mjs). The footage has no cursor; the film
 * draws a neutral round pointer (lookdev STYLE-GUIDE §5.5, never an OS
 * arrow) whose centre is its hotspot (owner's feedback after round 9: the
 * disc drawn beside the click read as missing its button, and the pointer
 * vanished six frames after a click or when the page dropped back).
 *
 * Everything here is in film frames of the take, so a slowed or held clip
 * keeps the same rhythm on screen. For each click the take shows:
 *
 * - it fades in (FADE frames) while it rests just outside the target
 *   (ENTRY px on screen from it, towards where the capture's pointer came
 *   from), starting LEAD frames before it moves;
 * - it travels on one eased path and settles on the click point SETTLE
 *   frames before the press, the frame the footage shows the control
 *   pressed;
 * - it presses there (the ring shrinks, a ring spreads from the hotspot),
 *   stays HOLD frames, then fades out over FADE frames.
 *
 * A click that follows soon after another in the same take keeps the
 * pointer on screen: it travels from the click before. The pointer belongs
 * to the plane of what it clicks: its path is carried by the lifted
 * component that holds its target (src/look/dof.ts, the same scale about
 * the same centre as the footage's lifted layer), from its first frame and,
 * after the press, with that plane as it was at the press (a lift that ends,
 * such as the plan that folds, does not make it jump). src/look/
 * ProductWindow.tsx draws it inside the window's own transform, so camera,
 * drift and tilt carry it like the footage.
 */
import type { Box, PointerEvent, StateFootage } from "../footage.ts";
import { music } from "../music.ts";
import type { TakeLook } from "../shots.ts";
import { takeView } from "../takes.ts";
import { project } from "./camera.ts";
import { focusAmount, LIFT_SCALE, liftOn } from "./dof.ts";
import { ease, mix } from "./motion.ts";

/** Film frames (and screen px at 1080p). */
export const POINTER = {
  /** Fade in and fade out, linear: 1/12 of the opacity a frame. */
  FADE: 12,
  /** The fade-in starts this many frames before the pointer moves (it rests while it comes in). */
  LEAD: 6,
  /** It arrives on the click point this many frames before the press. */
  SETTLE: 2,
  /** The path's length: the capture's own move, kept within these bounds... */
  LEG_MIN: 12,
  LEG_MAX: 18,
  /** ...and never shorter than this when the take's start leaves no room. */
  LEG_FLOOR: 10,
  /** It stays on the click this long after the press (0.5 s), then fades. */
  HOLD: 15,
  /** At least this long on a click before it travels to the next one. */
  REST: 6,
  /** A click whose pointer would come in within this many frames of the last one leaving keeps it on screen. */
  BRIDGE: 6,
  /** The press: the ring shrinks and comes back over these frames. */
  PRESS: 8,
  /** The click's ring spreads from the hotspot over these frames. */
  RIPPLE: 14,
  /** Where it comes in from: this far (screen px) from the click, towards where the capture's pointer was. */
  ENTRY: 160,
  ENTRY_CLEAR: 40,
  /** The entry point stays this far inside the frame. */
  MARGIN: 48,
  /** The pointer's radius on screen (24 px across, STYLE-GUIDE §5.5) and the click ring's growth. */
  RADIUS: 12,
  RIPPLE_GROWTH: 18,
} as const;

interface Point {
  x: number;
  y: number;
}

/** One click the take shows. */
export interface PointerClick {
  /** Film frame of the press (from the take's start; fractional: the clip's own time). */
  f: number;
  /** The first whole film frame that shows the control pressed. */
  pressFrame: number;
  /** Clip seconds of the click. */
  t: number;
  /** The capture's click point (capture CSS px). */
  x: number;
  y: number;
  target: string;
  /** The target's box as recorded (capture CSS px). */
  box?: Box;
  /** The lifted component (index in the take's lifts) that holds the click point, if any. */
  lift?: number;
}

/** One path: from a point to a click, eased, between two film frames. */
interface Leg {
  a: number;
  b: number;
  from: Point;
  to: Point;
  /** The plane at the path's start: a lift (with the amount it is frozen at, after a press) or the page. */
  fromLift?: number;
  fromHeld?: number;
  toLift?: number;
}

/** One stretch the pointer is on screen: it comes in, makes one or more clicks, and leaves. */
export interface PointerRun {
  /** The fade-in starts (opacity 0 on this frame, 1 FADE frames later). */
  appear: number;
  /** The fade-out ends (opacity 0 from here). */
  gone: number;
  legs: Leg[];
  clicks: PointerClick[];
}

export interface PointerState {
  /** The hotspot, carried into its plane (capture CSS px of the window). */
  x: number;
  y: number;
  opacity: number;
  /** 0 at rest, 1 fully pressed. */
  press: number;
  /** 0..1 through the click's ring, while it shows. */
  ripple?: number;
  /** The ring's centre: the click point, carried like the pointer. */
  rippleAt?: Point;
  /** Whether it is travelling (between a path's start and its arrival). */
  moving: boolean;
}

/** The clip seconds a take shows: from `clipFrom` to its end (or `clipTo`, where it holds). */
export const clipSpan = (look: Pick<TakeLook, "clipFrom" | "clipTo" | "rate">, frames: number) => {
  const from = look.clipFrom ?? 0;
  return { from, to: Math.min(look.clipTo ?? Infinity, from + (frames / 30) * (look.rate ?? 1)), rate: look.rate ?? 1 };
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * The pointer of a take: its clicks and its runs, and its state at any frame. `look` is the take's look
 * (src/shots.ts), `frames` its length, `state` its footage. Pure; src/scenes/ProductShot.tsx draws it, the tests
 * and scripts/check-pointer.mjs check it.
 */
export function takePointer(look: TakeLook, frames: number, state: Pick<StateFootage, "events" | "boxes">) {
  const span = clipSpan(look, frames);
  const lifts = look.lifts ?? [];
  const focusKeys = look.focus ?? [{ at: 0, amount: 1 }];
  /** How far lift i is forward at film frame f (with the take's focus amount), as the window draws it. */
  const onAt = (i: number, f: number) => liftOn(lifts[i], f) * focusAmount(focusKeys, f / music.beatFrames);
  const filmFrame = (t: number) => ((t - span.from) / span.rate) * 30;
  /** The lifted component that holds capture point (x, y) at frame f: the one furthest forward (the later on top). */
  const liftHolding = (x: number, y: number, f: number) => {
    let found: number | undefined;
    let best = 0.001;
    lifts.forEach((lift, index) => {
      const [x0, y0, x1, y1] = lift.box;
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1 && onAt(index, f) >= best) {
        found = index;
        best = onAt(index, f);
      }
    });
    return found;
  };
  const events = state.events;
  const clicks: PointerClick[] = events
    .filter((e): e is Extract<PointerEvent, { type: "click" }> => e.type === "click")
    .filter((e) => e.t >= span.from - 1e-9 && e.t <= span.to + 1e-9 && filmFrame(e.t) < frames)
    .map((e) => {
      const f = filmFrame(e.t);
      return {
        f,
        pressFrame: Math.ceil(f - 1e-6),
        t: e.t,
        x: e.x,
        y: e.y,
        target: e.target ?? "click",
        box: e.target ? state.boxes[e.target] : undefined,
        lift: liftHolding(e.x, e.y, f),
      };
    });

  /** Where the capture's pointer was before the move that ends on `click`: the click or the parked start before it. */
  const cameFrom = (click: PointerClick): Point => {
    const move = events.find((e) => e.type === "move" && Math.abs(e.t - click.t) < 1e-6);
    const before = move?.type === "move" ? move.from : click.t;
    const last = events.filter((e) => (e.type === "click" || e.type === "start") && e.t <= before + 1e-9 && e !== move).at(-1);
    return last && (last.type === "click" || last.type === "start") ? { x: last.x, y: last.y } : { x: click.x, y: click.y + 1 };
  };

  /**
   * Just outside the target: ENTRY screen px from the click towards where the capture's pointer came from, and at
   * least ENTRY_CLEAR px beyond the target's box that way (a wide button), in frame.
   */
  const entryPoint = (click: PointerClick, f: number): Point => {
    const view = takeView(look, f);
    const from = cameFrom(click);
    const base = Math.atan2(from.y - click.y, from.x - click.x);
    /** How far (capture px) from the click along `angle` the target's box ends. */
    const exit = (angle: number) => {
      const box = click.box;
      if (!box) return 0;
      const [dx, dy] = [Math.cos(angle), Math.sin(angle)];
      const tx = dx > 1e-9 ? (box.x + box.width - click.x) / dx : dx < -1e-9 ? (box.x - click.x) / dx : Infinity;
      const ty = dy > 1e-9 ? (box.y + box.height - click.y) / dy : dy < -1e-9 ? (box.y - click.y) / dy : Infinity;
      return Math.max(0, Math.min(tx, ty));
    };
    const inFrame = (p: Point) => {
      const s = project(view, p.x, p.y);
      return s.x >= POINTER.MARGIN && s.x <= 1920 - POINTER.MARGIN && s.y >= POINTER.MARGIN && s.y <= 1080 - POINTER.MARGIN;
    };
    // The direction it came from first, then turning either way in 20-degree steps.
    for (let step = 0; step <= 9; step += 1)
      for (const sign of step === 0 ? [1] : [1, -1]) {
        const angle = base + sign * step * (Math.PI / 9);
        const r = Math.max(POINTER.ENTRY / view.m, exit(angle) + POINTER.ENTRY_CLEAR / view.m);
        const p = { x: click.x + Math.cos(angle) * r, y: click.y + Math.sin(angle) * r };
        if (inFrame(p)) return p;
      }
    return { x: click.x, y: click.y };
  };

  const runs: PointerRun[] = [];
  for (const click of clicks) {
    const move = events.find((e) => e.type === "move" && Math.abs(e.t - click.t) < 1e-6);
    const captured = move?.type === "move" ? ((move.t - move.from) / span.rate) * 30 : POINTER.LEG_MIN;
    const arrive = click.f - POINTER.SETTLE;
    let length = clamp(captured, POINTER.LEG_MIN, POINTER.LEG_MAX);
    if (arrive - length - POINTER.LEAD < 0) length = Math.max(POINTER.LEG_FLOOR, arrive - POINTER.LEAD);
    const fresh = { start: arrive - length, appear: Math.max(0, arrive - length - POINTER.LEAD) };
    const run = runs.at(-1);
    const previous = run?.clicks.at(-1);
    if (run && previous && fresh.appear <= previous.f + POINTER.HOLD + POINTER.FADE + POINTER.BRIDGE) {
      // It stays on screen and travels from the click before.
      const start = Math.max(previous.f + POINTER.REST, arrive - clamp(captured, POINTER.LEG_FLOOR, POINTER.LEG_MAX));
      run.legs.push({
        a: start,
        b: Math.max(start + 1, arrive),
        from: { x: previous.x, y: previous.y },
        to: { x: click.x, y: click.y },
        fromLift: previous.lift,
        fromHeld: previous.lift === undefined ? undefined : onAt(previous.lift, previous.f),
        toLift: click.lift,
      });
      run.clicks.push(click);
    } else {
      runs.push({
        appear: fresh.appear,
        gone: 0,
        legs: [{ a: fresh.start, b: arrive, from: entryPoint(click, fresh.start), to: { x: click.x, y: click.y }, fromLift: click.lift, toLift: click.lift }],
        clicks: [click],
      });
    }
  }
  for (const run of runs) run.gone = run.clicks.at(-1)!.f + POINTER.HOLD + POINTER.FADE;

  /** Point p carried into lift i's plane at frame f (held at least `held` forward), or left on the page. */
  const carry = (p: Point, f: number, lift?: number, held = 0): Point => {
    if (lift === undefined) return p;
    const on = Math.max(onAt(lift, f), held);
    // The window draws a lift only from 0.001 forward (src/look/ProductWindow.tsx).
    if (on <= 0.001) return p;
    // Carried even outside the box: the whole path belongs to the plane of what it clicks. The same scale about the
    // same centre as the lifted layer (liftPoint in src/look/dof.ts).
    const [x0, y0, x1, y1] = lifts[lift].box;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const s = 1 + (LIFT_SCALE - 1) * on;
    return { x: cx + (p.x - cx) * s, y: cy + (p.y - cy) * s };
  };

  /** The run that owns frame f: the one on screen, else the nearest in time. */
  const runAt = (f: number) => {
    if (!runs.length) return undefined;
    let best = runs[0];
    let distance = Infinity;
    for (const run of runs) {
      const d = f < run.appear ? run.appear - f : f > run.gone ? f - run.gone : 0;
      if (d < distance) {
        distance = d;
        best = run;
      }
    }
    return best;
  };

  /**
   * The pointer at film frame f of the take. `solid` (the pixel check's probe) gives the same pointer at full
   * opacity wherever its run puts it, also before it comes in and after it has gone.
   */
  const at = (f: number, solid = false): PointerState | undefined => {
    const run = runAt(f);
    if (!run) return undefined;
    const opacity = clamp(Math.min((f - run.appear) / POINTER.FADE, (run.gone - f) / POINTER.FADE), 0, 1);
    if (!solid && opacity <= 0) return undefined;
    // The position: resting before the first path, on a path, or on the last click reached.
    let position: Point = carry(run.legs[0].from, f, run.legs[0].toLift);
    let moving = false;
    for (let i = 0; i < run.legs.length; i += 1) {
      const leg = run.legs[i];
      const click = run.clicks[i];
      if (f < leg.a) break;
      if (f < leg.b) {
        const p = ease.standard((f - leg.a) / (leg.b - leg.a));
        const point = { x: mix(leg.from.x, leg.to.x, p), y: mix(leg.from.y, leg.to.y, p) };
        const a = carry(point, f, leg.fromLift, leg.fromHeld);
        const b = carry(point, f, leg.toLift);
        position = { x: mix(a.x, b.x, p), y: mix(a.y, b.y, p) };
        moving = true;
        break;
      }
      // Arrived: on the click, in its plane (held as it was at the press once pressed).
      const held = f >= click.f && click.lift !== undefined ? onAt(click.lift, click.f) : 0;
      position = carry(leg.to, f, click.lift, held);
    }
    // The press and the click's ring, from the last click made.
    const last = run.clicks.filter((c) => c.f <= f).at(-1);
    let press = 0;
    let ripple: number | undefined;
    let rippleAt: Point | undefined;
    if (last) {
      const age = f - last.f;
      press = age < POINTER.PRESS ? Math.sin((age / POINTER.PRESS) * Math.PI) : 0;
      if (age < POINTER.RIPPLE) {
        ripple = age / POINTER.RIPPLE;
        rippleAt = carry({ x: last.x, y: last.y }, f, last.lift, last.lift === undefined ? 0 : onAt(last.lift, last.f));
      }
    }
    return { ...position, opacity: solid ? 1 : opacity, press, ripple, rippleAt, moving };
  };

  return { clicks, runs, at, span };
}

/** Clicks between clip times a and b (for the UI tick sound). */
export const clicksBetween = (events: readonly PointerEvent[], a: number, b: number) =>
  events.filter((e): e is Extract<PointerEvent, { type: "click" }> => e.type === "click" && e.t >= a && e.t < b);
