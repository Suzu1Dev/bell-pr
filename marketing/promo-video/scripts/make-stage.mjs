#!/usr/bin/env node
/**
 * Writes the pre-dithered stage plates to public/stage/ (gitignored):
 * dark.png and light.png at 1920x1080, dark@2x.png and light@2x.png at
 * 3840x2160 for the 4K master.
 *
 * Each is a soft light pool (a normalized Gaussian of the elliptical radius,
 * mixed in linear light: no color stops, so no ring for the eye or the
 * encoder to find), quantized to 8 bits with TPDF +-1 LSB dither. The dark
 * plate also carries a static, coarse TPDF grain of +-2.5 LSB in 5x5 px
 * cells at 1080p, the light plate one of +-2 LSB in 2x2 px cells: the
 * encoders flatten single-pixel dither but keep clusters, so the decoded
 * gradient does not contour (lookdev STYLE-GUIDE §6.3-6.4, variants C and
 * B's measured fixes). The dark plate's cells are the size VP9 at CRF 35
 * keeps (measured on the plate alone: 2x2 px cells gave 391 px flat runs in
 * the WebM, 5x5 px at +-2.5 LSB 86 px; x264 kept either at 40 px). Near
 * white a one-level step is under 0.5% and does not show, so the light
 * plate keeps its finer grain. Seeded, so every run writes the same files.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "./lib/png.mjs";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const out = path.join(packageRoot, "public", "stage");

const hex = (h) => [0, 2, 4].map((i) => parseInt(h.slice(1 + i, 3 + i), 16));
const toLinear = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (v) => {
  const c = Math.min(1, Math.max(0, v));
  return 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
};

/** mulberry32: a small seeded generator, uniform in [0, 1). */
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function plate({ width, height, center, radius, inner, outer, falloff, grain = 0, cell = 2, seed = 7 }) {
  const a = hex(outer).map(toLinear);
  const b = hex(inner).map(toLinear);
  const rand = random(seed);
  const cols = Math.ceil(width / cell);
  const coarse = new Float32Array(cols * Math.ceil(height / cell));
  for (let i = 0; i < coarse.length; i += 1) coarse[i] = rand() - rand();
  const rgb = new Uint8Array(width * height * 3);
  const floor = Math.exp(-falloff);
  for (let y = 0; y < height; y += 1) {
    const dy = (y + 0.5 - center[1] * height) / (radius[1] * height);
    for (let x = 0; x < width; x += 1) {
      const dx = (x + 0.5 - center[0] * width) / (radius[0] * width);
      const g = Math.min(1, Math.max(0, (Math.exp(-falloff * (dx * dx + dy * dy)) - floor) / (1 - floor)));
      const noise = rand() - rand() + (grain ? grain * coarse[Math.floor(y / cell) * cols + Math.floor(x / cell)] : 0);
      for (let c = 0; c < 3; c += 1) {
        const value = Math.round(toSrgb(a[c] + (b[c] - a[c]) * g) + noise);
        rgb[(y * width + x) * 3 + c] = Math.min(255, Math.max(0, value));
      }
    }
  }
  return encodePng(width, height, rgb);
}

await mkdir(out, { recursive: true });
for (const [suffix, scale] of [["", 1], ["@2x", 2]]) {
  const size = { width: 1920 * scale, height: 1080 * scale };
  // The dark stage of the type beats: a lifted green-black centre, no glow.
  await writeFile(
    path.join(out, `dark${suffix}.png`),
    plate({ ...size, center: [0.5, 0.46], radius: [0.8, 0.92], inner: "#10221a", outer: "#020403", falloff: 2.6, grain: 2.5, cell: 5 * scale }),
  );
  // The light studio of the product beats: a white key light upper middle, warm grey corners.
  await writeFile(
    path.join(out, `light${suffix}.png`),
    plate({ ...size, center: [0.5, 0.36], radius: [1.0, 1.15], inner: "#ffffff", outer: "#e7ebe4", falloff: 2.0, grain: 2, cell: 2 * scale, seed: 11 }),
  );
}
console.log("stage: public/stage/dark.png, light.png and their @2x versions");
