/**
 * Depth of field as a lift (review round 7): the component a take is about
 * (a card, a row, a dialog's section, a block of quoted text) comes forward
 * as its own layer, cropped on its own outer border, a little larger
 * (LIFT_SCALE) and with a soft layered shadow under it, while the rest of
 * the window drops back: the same picture blurred SOFT_BLUR px on screen
 * under a uniform veil of the studio's colour. The crop follows a border
 * or, inside an unbordered run of text, a gutter, so no card, row or line
 * is ever half sharp (a sharp rectangle drawn on the flat page read as a
 * blur box added in post: rounds 6 and 7). `npm run review` checks every
 * box against the captured footage (scripts/check-dof.mjs).
 *
 * Boxes are in capture CSS px ("cpx", 1440x810), turned into layout px by
 * src/look/ProductWindow.tsx.
 */
import { music } from "../music.ts";
import { ease, mix } from "./motion.ts";

export type Rect = [x0: number, y0: number, x1: number, y1: number];

/** One lifted component: its box and corner radius (cpx; per corner tl, tr, br, bl where a side is the UI's own scroll clip). */
export interface Lift {
  box: Rect;
  radius?: number | [tl: number, tr: number, br: number, bl: number];
  /** Beats from the take's start: lifted from here (ramping in over RACK_FRAMES when after the start)... */
  from?: number;
  /** ...until here (a hard end: the UI under it changed, such as a plan that folds)... */
  to?: number;
  /** ...or, with `settle`, dropping back over the RACK_FRAMES before `to` (the camera leaves it). */
  settle?: boolean;
}

/** The lifted layer's scale about its own centre, and the back plane's veil (studio colour) and blur (1080p screen px). */
export const LIFT_SCALE = 1.025;
export const VEIL = { color: [239, 241, 237] as const, alpha: 0.25 };
export const SOFT_BLUR = 3.5;
/** A lift that starts inside a take comes forward over this many frames (lookdev STYLE-GUIDE §5.3: a rack in 12-18 f). */
export const RACK_FRAMES = 15;

const beatFrames = music.beatFrames;

/** How far each lift is forward at frame f of the take (0..1), before the take's focus amount. */
export function liftOn(lift: Lift, f: number) {
  const from = (lift.from ?? 0) * beatFrames;
  const to = lift.to === undefined ? Infinity : lift.to * beatFrames;
  if (f < from || f >= to) return 0;
  // `standard` (in-out), as a rack focus.
  const rack = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
  const rackIn = from <= 0 ? 1 : rack((f - from) / RACK_FRAMES);
  const rackOut = lift.settle ? rack((to - f) / RACK_FRAMES) : 1;
  return Math.min(rackIn, rackOut);
}

/** A box scaled by s about its centre. */
export const scaleBox = ([x0, y0, x1, y1]: Rect, s: number): Rect => {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return [cx + (x0 - cx) * s, cy + (y0 - cy) * s, cx + (x1 - cx) * s, cy + (y1 - cy) * s];
};

/** Where capture point (x, y) shows once the lift `on` (0..1) carries it: lifted points move with their layer. */
export const liftPoint = (lift: Lift, on: number, x: number, y: number) => {
  const [x0, y0, x1, y1] = lift.box;
  if (on <= 0 || x < x0 || x > x1 || y < y0 || y > y1) return { x, y };
  const s = 1 + (LIFT_SCALE - 1) * on;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return { x: cx + (x - cx) * s, y: cy + (y - cy) * s };
};

/** The lifted boxes in front at frame f (on ≥ 0.5), scaled: the sharp plane, for the layout tests and checks. */
export const sharpBoxes = (lifts: readonly Lift[], f: number, amount = 1): Rect[] =>
  lifts.filter((lift) => liftOn(lift, f) * amount >= 0.5).map((lift) => scaleBox(lift.box, 1 + (LIFT_SCALE - 1) * liftOn(lift, f) * amount));

/** How far the window drops back behind its lifts at `beats` from the take's start (keys eased `standard`). */
export const focusAmount = (keys: readonly { at: number; amount: number }[], beats: number) => {
  if (beats <= keys[0].at) return keys[0].amount;
  for (let i = 1; i < keys.length; i += 1)
    if (beats <= keys[i].at)
      return mix(keys[i - 1].amount, keys[i].amount, ease.standard((beats - keys[i - 1].at) / (keys[i].at - keys[i - 1].at)));
  return keys.at(-1)!.amount;
};
