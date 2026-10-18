/**
 * Depth-of-field masks for src/look/ProductWindow.tsx, in capture CSS px
 * ("cpx", turned into layout px by the window). Opaque = the sharp plane.
 */

/** A sharp band in capture CSS px with soft edges `feather` px wide, as two intersected mask layers. */
export function focusRect(x0: number, y0: number, x1: number, y1: number, feather = 60, amount = 1): string[] {
  const out = `rgba(0,0,0,${(1 - amount).toFixed(3)})`;
  return [
    `linear-gradient(90deg, ${out} ${x0 - feather}cpx, #000 ${x0}cpx, #000 ${x1}cpx, ${out} ${x1 + feather}cpx)`,
    `linear-gradient(180deg, ${out} ${y0 - feather}cpx, #000 ${y0}cpx, #000 ${y1}cpx, ${out} ${y1 + feather}cpx)`,
  ];
}

export type Rect = [x0: number, y0: number, x1: number, y1: number];

/** The sharp plane moving from rect `a` to rect `b` between beats `from` and `to` (a rack across the UI, `standard`). */
export const rackRect =
  (a: Rect, b: Rect, from: number, to: number, feather = 40) =>
  (amount: number, beats: number): string[] => {
    const x = Math.min(1, Math.max(0, (beats - from) / Math.max(1e-6, to - from)));
    const t = x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
    const r = a.map((v, i) => v + (b[i] - v) * t) as Rect;
    return focusRect(r[0], r[1], r[2], r[3], feather, amount);
  };
