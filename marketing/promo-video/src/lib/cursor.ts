/**
 * The Remotion cursor's path: it eases between the recorded pointer
 * positions and ripples where it clicks. Times are seconds on one clock
 * (the clip's, or the shot's for stills).
 */
import { ease } from "./ease.ts";

export type CursorEvent =
  | { type: "start"; t: number; x: number; y: number }
  | { type: "move"; from: number; t: number; x: number; y: number; target?: string }
  | { type: "click"; t: number; x: number; y: number; target?: string }
  /** The view cuts away (for example to the top of the page): no cursor from here. */
  | { type: "hide"; t: number };

export interface CursorState {
  x: number;
  y: number;
  /** 1 while the cursor works; it fades out after its last event. */
  opacity: number;
  /** 0 at rest, 1 fully pressed. */
  press: number;
  /** Seconds since each click that still ripples. */
  ripples: number[];
}

/** How long a press and a ripple last, in seconds. */
export const pressSeconds = 0.18;
export const rippleSeconds = 0.55;
/** After its last event the cursor rests this long, then fades out over `fadeSeconds`. */
export const restSeconds = 0.6;
export const fadeSeconds = 0.3;

/** The cursor at `t`, or undefined before its first event. */
export function cursorAt(events: readonly CursorEvent[], t: number): CursorState | undefined {
  const sorted = [...events].sort((a, b) => startOf(a) - startOf(b));
  const first = sorted[0];
  if (!first || first.type === "hide" || t < startOf(first) - 1e-6) return undefined;
  let x = first.x;
  let y = first.y;
  let press = 0;
  const ripples: number[] = [];
  for (const event of sorted) {
    if (event.type === "move") {
      if (t >= event.t) {
        x = event.x;
        y = event.y;
      } else if (t > event.from) {
        const p = ease("inOut", (t - event.from) / (event.t - event.from));
        x += (event.x - x) * p;
        y += (event.y - y) * p;
        break;
      } else break;
    } else if (event.type === "hide") {
      if (t >= event.t) return undefined;
      break;
    } else if (event.type === "click") {
      if (t < event.t) break;
      x = event.x;
      y = event.y;
      const age = t - event.t;
      if (age < pressSeconds) press = Math.sin((age / pressSeconds) * Math.PI);
      if (age < rippleSeconds) ripples.push(age);
    } else if (t >= event.t) {
      x = event.x;
      y = event.y;
    }
  }
  const last = Math.max(...sorted.map((event) => event.t));
  const opacity = sorted.length > 1 ? 1 - Math.min(1, Math.max(0, (t - last - restSeconds) / fadeSeconds)) : 1;
  return { x, y, opacity, press, ripples };
}

const startOf = (event: CursorEvent) => (event.type === "move" ? event.from : event.t);
