/**
 * The drawn pointer's state from the capture's pointer events (clip seconds,
 * capture CSS px). The footage has no cursor; the film draws a neutral round
 * pointer (lookdev STYLE-GUIDE §5.5, never an OS arrow) only while it works:
 * it fades in at most 12 frames before its click (just before its move when
 * that is shorter), eases to the target, presses, and has faded out six
 * frames after the click unless the next move follows at once. The film
 * also fades it out of the soft plane (src/scenes/ProductShot.tsx).
 */
import type { PointerEvent, PointerSpot } from "../footage.ts";
import { ease } from "./motion.ts";

export interface PointerState {
  x: number;
  y: number;
  opacity: number;
  /** 0 at rest, 1 fully pressed. */
  press: number;
  /** 0..1 through the ring of the last click, while it shows (it may outlast the pointer). */
  ripple?: number;
  /** Where that click was. */
  rippleAt?: { x: number; y: number };
  /** Where the disc sits beside the hotspot for the click it is working toward (capture px), if the footage says. */
  offset?: { x: number; y: number };
}

/**
 * Film seconds (each is scaled by the take's clip rate into clip seconds, so
 * a slowed clip keeps the same rhythm on screen).
 */
const FADE_IN = 0.2;
/** The pointer shows at most 12 frames before its click... */
const LEAD = 12 / 30;
/** ...and has gone within six frames after it (0.2 s): it never parks on the text it clicked. */
const REST = 0.05;
const FADE_OUT = 0.15;
const PRESS = 0.18;
/** The click's ring lasts 8 frames: it is gone before the UI's answer to the click has settled. */
const RIPPLE = 8 / 30;
/** A gap shorter than this between a click and the next move keeps the pointer on screen. */
const BRIDGE = 0.45;

/** The windows in which the pointer shows: [appear, gone] in clip seconds, for a clip played at `rate`. */
export function pointerWindows(events: readonly PointerEvent[], rate = 1): [number, number][] {
  const windows: [number, number][] = [];
  let open: number | undefined;
  for (const event of events) {
    if (event.type === "move") open ??= event.from - FADE_IN * rate;
    if (event.type === "click" && open !== undefined) {
      const start = Math.max(open, event.t - LEAD * rate);
      const end = event.t + (REST + FADE_OUT) * rate;
      const last = windows.at(-1);
      if (last && start - last[1] < (BRIDGE - REST - FADE_OUT) * rate) last[1] = end;
      else windows.push([start, end]);
      open = undefined;
    }
    if (event.type === "hide") {
      const last = windows.at(-1);
      if (last && last[1] > event.t + 0.15 * rate) last[1] = Math.max(last[0], event.t + 0.15 * rate);
    }
  }
  return windows;
}

/** The pointer at clip time `t` of a clip played at `rate` (clip seconds per film second); `spots` place its disc. */
export function pointerAt(events: readonly PointerEvent[], t: number, rate = 1, spots?: readonly PointerSpot[]): PointerState | undefined {
  const windows = pointerWindows(events, rate);
  const window = windows.find(([a, b]) => t >= a && t <= b);
  const lastClick = events.filter((e): e is Extract<PointerEvent, { type: "click" }> => e.type === "click" && e.t <= t).at(-1);
  const rippleAge = lastClick && t - lastClick.t < RIPPLE * rate ? t - lastClick.t : undefined;
  if (!window && rippleAge === undefined) return undefined;
  const start = events.find((e) => e.type === "start");
  let x = start && start.type === "start" ? start.x : 0;
  let y = start && start.type === "start" ? start.y : 0;
  let press = 0;
  for (const event of events) {
    if (event.type === "move") {
      if (t >= event.t) {
        x = event.x;
        y = event.y;
      } else if (t > event.from) {
        const p = ease.standard((t - event.from) / Math.max(1e-6, event.t - event.from));
        x += (event.x - x) * p;
        y += (event.y - y) * p;
        break;
      } else break;
    } else if (event.type === "click" && t >= event.t) {
      x = event.x;
      y = event.y;
      const age = t - event.t;
      press = age < PRESS * rate ? Math.sin((age / (PRESS * rate)) * Math.PI) : 0;
    }
  }
  // The disc's place: that of the click it is moving to, or of the one it just made.
  const clicks = events.filter((e) => e.type === "click");
  const target = clicks.find((e) => e.t >= t) ?? clicks.at(-1);
  const near = lastClick && t - lastClick.t < (REST + FADE_OUT) * rate + 1e-9 ? lastClick : target;
  const spot = near && spots?.find((s) => Math.abs(s.t - near.t) < 1e-3);
  const fadeIn = window ? Math.min(1, (t - window[0]) / (FADE_IN * rate)) : 0;
  const fadeOut = window ? Math.min(1, (window[1] - t) / (FADE_OUT * rate)) : 0;
  return {
    x,
    y,
    opacity: Math.max(0, Math.min(fadeIn, fadeOut)),
    press,
    ripple: rippleAge === undefined ? undefined : rippleAge / (RIPPLE * rate),
    rippleAt: lastClick && rippleAge !== undefined ? { x: lastClick.x, y: lastClick.y } : undefined,
    offset: spot ? { x: spot.dx, y: spot.dy } : undefined,
  };
}

/** Clicks between clip times a and b (for the UI tick sound). */
export const clicksBetween = (events: readonly PointerEvent[], a: number, b: number) =>
  events.filter((e): e is Extract<PointerEvent, { type: "click" }> => e.type === "click" && e.t >= a && e.t < b);
