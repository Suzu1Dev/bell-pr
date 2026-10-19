/**
 * RGB pixels of a picture (PNG, JPEG or a video frame), decoded with the
 * bundled ffmpeg: for the bell's measurements (scripts/measure-bell.mjs,
 * scripts/check-moments.mjs).
 */
import path from "node:path";
import { packageRoot, remotion } from "./media.mjs";

/** Decodes `file` (or the rectangle `crop` = [x, y, w, h] of it, in its own pixels) to 8-bit RGB. */
export async function decodeRgb(file, { width, height, crop } = {}) {
  const filters = [];
  if (crop) filters.push(`crop=${crop[2]}:${crop[3]}:${crop[0]}:${crop[1]}`);
  filters.push("format=rgb24");
  const { stdout } = await remotion([
    "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", path.resolve(packageRoot, file),
    "-frames:v", "1", "-vf", filters.join(","), "-f", "image2pipe", "-c:v", "rawvideo", "pipe:1",
  ]);
  const w = crop ? crop[2] : width;
  const h = crop ? crop[3] : height;
  if (w && h && stdout.length !== w * h * 3) throw new Error(`decoded ${stdout.length} bytes of ${file}, expected ${w * h * 3}`);
  return { data: stdout, width: w, height: h };
}

/**
 * How much of each pixel is `ink` over `paper` (0..1): the projection of the
 * pixel's colour on the line from paper to ink, which is what an
 * anti-aliased edge blends along.
 */
export function coverage(rgb, paper, ink) {
  const d = [ink[0] - paper[0], ink[1] - paper[1], ink[2] - paper[2]];
  const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const out = new Float64Array(rgb.width * rgb.height);
  for (let i = 0; i < out.length; i += 1) {
    const p = [rgb.data[i * 3] - paper[0], rgb.data[i * 3 + 1] - paper[1], rgb.data[i * 3 + 2] - paper[2]];
    out[i] = Math.min(1, Math.max(0, (p[0] * d[0] + p[1] * d[1] + p[2] * d[2]) / dd));
  }
  return out;
}

/** Area (pixels), centroid (pixel centres at +0.5) and bounding box of a coverage map, ignoring values under `floor`. */
export function coverageMoments(alpha, width, height, floor = 0.02) {
  let area = 0;
  let mx = 0;
  let my = 0;
  let box = [Infinity, Infinity, -Infinity, -Infinity];
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const a = alpha[y * width + x];
      if (a < floor) continue;
      area += a;
      mx += a * (x + 0.5);
      my += a * (y + 0.5);
      if (a >= 0.5) box = [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x + 1), Math.max(box[3], y + 1)];
    }
  return { area, cx: mx / area, cy: my / area, box };
}
