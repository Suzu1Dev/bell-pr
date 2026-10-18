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
