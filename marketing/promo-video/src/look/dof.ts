/**
 * Depth-of-field masks for src/look/ProductWindow.tsx, in capture CSS px
 * ("cpx", turned into layout px by the window). Opaque = the sharp plane.
 *
 * The sharp plane is a rectangle with soft edges (feathers). Each feather is
 * placed in a gutter of the UI (between cards, rows or columns), so no line
 * of text or icon is half sharp: `npm run review` checks every settled mask
 * against the captured footage (scripts/check-dof.mjs).
 */

/** Feather widths in capture px: one for all sides, or [left, top, right, bottom]. */
export type Feather = number | [left: number, top: number, right: number, bottom: number];

const sides = (feather: Feather) => (typeof feather === "number" ? [feather, feather, feather, feather] : feather);

/** A sharp band in capture CSS px with soft edges `feather` px wide, as two intersected mask layers. */
export function focusRect(x0: number, y0: number, x1: number, y1: number, feather: Feather = 60, amount = 1): string[] {
  const out = `rgba(0,0,0,${(1 - amount).toFixed(3)})`;
  const [fl, ft, fr, fb] = sides(feather);
  return [
    `linear-gradient(90deg, ${out} ${x0 - fl}cpx, #000 ${x0}cpx, #000 ${x1}cpx, ${out} ${x1 + fr}cpx)`,
    `linear-gradient(180deg, ${out} ${y0 - ft}cpx, #000 ${y0}cpx, #000 ${y1}cpx, ${out} ${y1 + fb}cpx)`,
  ];
}

export type Rect = [x0: number, y0: number, x1: number, y1: number];

/**
 * The sharp plane moving from rect `a` (feathers `fa`) to rect `b` (feathers `fb`, default `fa`) between beats `from`
 * and `to`: a rack across the UI (`standard`).
 */
export const rackRect =
  (a: Rect, b: Rect, from: number, to: number, fa: Feather = 40, fb: Feather = fa) =>
  (amount: number, beats: number): string[] => {
    const x = Math.min(1, Math.max(0, (beats - from) / Math.max(1e-6, to - from)));
    const t = x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
    const r = a.map((v, i) => v + (b[i] - v) * t) as Rect;
    const [sa, sb] = [sides(fa), sides(fb)];
    const f = sa.map((v, i) => v + (sb[i] - v) * t) as [number, number, number, number];
    return focusRect(r[0], r[1], r[2], r[3], f, amount);
  };

/** The sharp plane of a mask read back from its gradient stops: the sharp core and the feather on each side (capture px). */
export interface SharpPlane {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Feather widths: left, top, right, bottom. */
  fl: number;
  ft: number;
  fr: number;
  fb: number;
}

export function sharpPlane(layers: string[]): SharpPlane {
  const stops = (layer: string) => [...layer.matchAll(/(-?[\d.]+)cpx/g)].map((m) => Number(m[1]));
  const [a, x0, x1, b] = stops(layers[0]);
  const [c, y0, y1, d] = stops(layers[1]);
  return { x0, y0, x1, y1, fl: x0 - a, ft: y0 - c, fr: b - x1, fb: d - y1 };
}

/** How sharp capture point (x, y) is under the plane: 1 in the core, falling to 0 across the feathers. */
export function sharpness(plane: SharpPlane, x: number, y: number) {
  const along = (v: number, lo: number, hi: number, fLo: number, fHi: number) =>
    v < lo ? Math.max(0, 1 - (lo - v) / Math.max(1e-6, fLo)) : v > hi ? Math.max(0, 1 - (v - hi) / Math.max(1e-6, fHi)) : 1;
  return along(x, plane.x0, plane.x1, plane.fl, plane.fr) * along(y, plane.y0, plane.y1, plane.ft, plane.fb);
}

/** A mask: one sharp plane (two layers) or several (a union, each drawn as its own sharp copy). */
export type Mask = string[] | string[][];

/** The planes of a mask. */
export const planesOf = (mask: Mask): string[][] => (Array.isArray(mask[0]) ? (mask as string[][]) : [mask as string[]]);

/** How sharp capture point (x, y) is under the union of a mask's planes. */
export const sharpnessOf = (planes: SharpPlane[], x: number, y: number) =>
  1 - planes.reduce((rest, plane) => rest * (1 - sharpness(plane, x, y)), 1);
