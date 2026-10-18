/**
 * The drawn pointer's state from the capture's pointer events (clip seconds,
 * capture CSS px). The footage has no cursor; the film draws a neutral round
 * pointer (lookdev STYLE-GUIDE §5.5, never an OS arrow) only while it works:
 * it fades in just before a move, eases to the target, presses, and fades
 * out half a second after its click unless the next move follows soon.
 */
import type { PointerEvent } from "../footage.ts";
import { ease } from "./motion.ts";

export interface PointerState {
  x: number;
  y: number;
  opacity: number;
  /** 0 at rest, 1 fully pressed. */
  press: number;
  /** Seconds since the last click, while its ring still shows. */
  ripple?: number;
}

const FADE_IN = 0.2;
const REST = 0.45;
const FADE_OUT = 0.25;
const PRESS = 0.18;
const RIPPLE = 0.5;
/** A gap shorter than this between a click and the next move keeps the pointer on screen. */
const BRIDGE = 0.9;

/** The windows in which the pointer shows: [appear, gone] in clip seconds. */
export function pointerWindows(events: readonly PointerEvent[]): [number, number][] {
  const windows: [number, number][] = [];
  let open: number | undefined;
  for (const event of events) {
    if (event.type === "move") open ??= event.from - FADE_IN;
    if (event.type === "click" && open !== undefined) {
      const end = event.t + REST + FADE_OUT;
      const last = windows.at(-1);
      if (last && open - last[1] < BRIDGE - REST - FADE_OUT) last[1] = end;
      else windows.push([open, end]);
      open = undefined;
    }
    if (event.type === "hide") {
      const last = windows.at(-1);
      if (last && last[1] > event.t + 0.15) last[1] = Math.max(last[0], event.t + 0.15);
    }
  }
  return windows;
}

export function pointerAt(events: readonly PointerEvent[], t: number): PointerState | undefined {
  const windows = pointerWindows(events);
  const window = windows.find(([a, b]) => t >= a && t <= b);
  if (!window) return undefined;
  const start = events.find((e) => e.type === "start");
  let x = start && start.type === "start" ? start.x : 0;
  let y = start && start.type === "start" ? start.y : 0;
  let press = 0;
  let ripple: number | undefined;
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
      press = age < PRESS ? Math.sin((age / PRESS) * Math.PI) : 0;
      ripple = age < RIPPLE ? age : undefined;
    }
  }
  const fadeIn = Math.min(1, (t - window[0]) / FADE_IN);
  const fadeOut = Math.min(1, (window[1] - t) / FADE_OUT);
  return { x, y, opacity: Math.max(0, Math.min(fadeIn, fadeOut)), press, ripple };
}

/** Clicks between clip times a and b (for the UI tick sound). */
export const clicksBetween = (events: readonly PointerEvent[], a: number, b: number) =>
  events.filter((e): e is Extract<PointerEvent, { type: "click" }> => e.type === "click" && e.t >= a && e.t < b);
