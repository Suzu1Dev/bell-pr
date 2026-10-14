/** Easing curves for camera, cursor and card motion; x and the result run 0..1. */
export type EaseName = "inOut" | "out" | "in" | "linear";

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export const easeInOutCubic = (x: number) =>
  x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;

export const easeOutCubic = (x: number) => 1 - (1 - x) ** 3;

export const easeInCubic = (x: number) => x * x * x;

export function ease(name: EaseName = "inOut", x: number): number {
  const t = clamp01(x);
  switch (name) {
    case "linear":
      return t;
    case "out":
      return easeOutCubic(t);
    case "in":
      return easeInCubic(t);
    default:
      return easeInOutCubic(t);
  }
}
