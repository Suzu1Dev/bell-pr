/**
 * The filled area, centroid and bounding box of an SVG path (absolute M, L,
 * H, V, C, Q, A and Z, the commands the brand's paths use), from the path
 * flattened into polygons. Sub-paths are summed with their signed areas, so
 * a cut-out drawn the other way round (the bell's clapper hole) subtracts,
 * as the non-zero fill draws it. Used to find the app's own bell in the
 * capture by its moments (scripts/measure-bell.mjs) and to check the flying
 * bell against it (src/bell.test.ts).
 */

export interface Moments {
  /** Filled area, in the path's units squared. */
  area: number;
  /** Centroid of the filled area. */
  cx: number;
  cy: number;
  /** Bounding box of the outline. */
  box: [number, number, number, number];
}

type Point = [number, number];

/** The path flattened: one closed polygon per sub-path. */
export function flatten(d: string, steps = 48): Point[][] {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) ?? [];
  const polygons: Point[][] = [];
  let current: Point[] = [];
  let at: Point = [0, 0];
  let start: Point = [0, 0];
  let i = 0;
  let command = "";
  const num = () => Number(tokens[i++]);
  const close = () => {
    if (current.length > 2) polygons.push(current);
    current = [];
  };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) command = tokens[i++];
    if (command !== command.toUpperCase()) throw new Error(`Relative path command "${command}" is not supported.`);
    switch (command) {
      case "M":
        close();
        at = [num(), num()];
        start = at;
        current.push(at);
        command = "L";
        break;
      case "L":
        at = [num(), num()];
        current.push(at);
        break;
      case "H":
        at = [num(), at[1]];
        current.push(at);
        break;
      case "V":
        at = [at[0], num()];
        current.push(at);
        break;
      case "C": {
        const [x1, y1, x2, y2, x, y] = [num(), num(), num(), num(), num(), num()];
        const [x0, y0] = at;
        for (let s = 1; s <= steps; s += 1) {
          const t = s / steps;
          const u = 1 - t;
          current.push([
            u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
            u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y,
          ]);
        }
        at = [x, y];
        break;
      }
      case "Q": {
        const [x1, y1, x, y] = [num(), num(), num(), num()];
        const [x0, y0] = at;
        for (let s = 1; s <= steps; s += 1) {
          const t = s / steps;
          const u = 1 - t;
          current.push([u * u * x0 + 2 * u * t * x1 + t * t * x, u * u * y0 + 2 * u * t * y1 + t * t * y]);
        }
        at = [x, y];
        break;
      }
      case "A": {
        const [rx, ry, rotation, large, sweep, x, y] = [num(), num(), num(), num(), num(), num(), num()];
        current.push(...arc(at, rx, ry, rotation, large === 1, sweep === 1, [x, y], steps));
        at = [x, y];
        break;
      }
      case "Z":
        at = start;
        close();
        break;
      default:
        throw new Error(`Path command "${command}" is not supported.`);
    }
  }
  close();
  return polygons;
}

/** An elliptical arc (SVG endpoint parameterisation, F.6.5 of SVG 1.1) as points after its start. */
function arc(from: Point, rx: number, ry: number, rotation: number, large: boolean, sweep: boolean, to: Point, steps: number): Point[] {
  const phi = (rotation * Math.PI) / 180;
  const [cos, sin] = [Math.cos(phi), Math.sin(phi)];
  const dx = (from[0] - to[0]) / 2;
  const dy = (from[1] - to[1]) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  let [a, b] = [Math.abs(rx), Math.abs(ry)];
  const lambda = (x1 * x1) / (a * a) + (y1 * y1) / (b * b);
  if (lambda > 1) [a, b] = [a * Math.sqrt(lambda), b * Math.sqrt(lambda)];
  const num = a * a * b * b - a * a * y1 * y1 - b * b * x1 * x1;
  const den = a * a * y1 * y1 + b * b * x1 * x1;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (k * a * y1) / b;
  const cyp = (-k * b * x1) / a;
  const cx = cos * cxp - sin * cyp + (from[0] + to[0]) / 2;
  const cy = sin * cxp + cos * cyp + (from[1] + to[1]) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const theta = angle(1, 0, (x1 - cxp) / a, (y1 - cyp) / b);
  let delta = angle((x1 - cxp) / a, (y1 - cyp) / b, (-x1 - cxp) / a, (-y1 - cyp) / b);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const n = Math.max(8, Math.ceil((steps * Math.abs(delta)) / Math.PI));
  const points: Point[] = [];
  for (let s = 1; s <= n; s += 1) {
    const t = theta + (delta * s) / n;
    const [ex, ey] = [a * Math.cos(t), b * Math.sin(t)];
    points.push(s === n ? to : [cos * ex - sin * ey + cx, sin * ex + cos * ey + cy]);
  }
  return points;
}

/** Area, centroid and bounding box of the filled path (non-zero, with cut-outs wound the other way). */
export function pathMoments(d: string): Moments {
  let area = 0;
  let mx = 0;
  let my = 0;
  const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  const polygons = flatten(d, 96);
  // The outer outline's orientation decides the sign: the largest sub-path counts positive.
  const signed = polygons.map((polygon) => {
    let a = 0;
    let x = 0;
    let y = 0;
    for (let i = 0; i < polygon.length; i += 1) {
      const [x0, y0] = polygon[i];
      const [x1, y1] = polygon[(i + 1) % polygon.length];
      const cross = x0 * y1 - x1 * y0;
      a += cross / 2;
      x += ((x0 + x1) * cross) / 6;
      y += ((y0 + y1) * cross) / 6;
      box[0] = Math.min(box[0], x0);
      box[1] = Math.min(box[1], y0);
      box[2] = Math.max(box[2], x0);
      box[3] = Math.max(box[3], y0);
    }
    return { a, x, y };
  });
  const sign = Math.sign(signed.reduce((best, s) => (Math.abs(s.a) > Math.abs(best.a) ? s : best)).a);
  for (const s of signed) {
    area += sign * s.a;
    mx += sign * s.x;
    my += sign * s.y;
  }
  return { area, cx: mx / area, cy: my / area, box };
}
