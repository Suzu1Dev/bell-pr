#!/usr/bin/env node
/**
 * Finds the app's own bell (the sidebar wordmark's mark) in the capture the
 * first-hit bell lands on (v-rules-card/overview, DPR 4) by its moments: the
 * coverage of the brand green over the sidebar's paper gives the filled
 * area and centroid in capture px, and the brand path (src/brand/
 * brand-assets.ts) gives them in its own units, so the mark's scale and
 * where its 64-unit box sits follow, to a small fraction of a pixel. The
 * film's constant (FOOTAGE_BELL in src/bell.ts) must match it within
 * 0.05 capture px (scripts/bell.test.mjs runs this when the footage is
 * there).
 *
 *   node scripts/measure-bell.mjs [--json]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tsImport } from "tsx/esm/api";
import { coverage, coverageMoments, decodeRgb } from "./lib/rgb.mjs";

const { markPath, markSize, logoColors } = await tsImport("../../../src/brand/brand-assets.ts", import.meta.url);
const { pathMoments } = await tsImport("../src/look/pathMoments.ts", import.meta.url);

/** The sidebar's paper and the mark's green, as captured (sampled round the logo; uniform there). */
export const SIDEBAR_PAPER = [244, 246, 241];
const hex = (value) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));

/** Measures the mark in a DPR-4 capture still; returns capture CSS px. */
export async function measureBell(file = "public/footage/v-rules-card/overview.png", dpr = 4) {
  // Round the sidebar wordmark's mark only (capture px 22-54 x 26-64; its "B" starts at 56).
  const crop = [22 * dpr, 26 * dpr, 32 * dpr, 38 * dpr];
  const rgb = await decodeRgb(file, { crop });
  const alpha = coverage(rgb, SIDEBAR_PAPER, hex(logoColors.green));
  const px = coverageMoments(alpha, rgb.width, rgb.height);
  const unit = pathMoments(markPath);
  // Scale from the areas (capture px per unit), then the 64-unit box from the centroids.
  const scale = Math.sqrt(px.area / unit.area) / dpr;
  const cx = crop[0] / dpr + px.cx / dpr;
  const cy = crop[1] / dpr + px.cy / dpr;
  const x = cx - unit.cx * scale;
  const y = cy - unit.cy * scale;
  // The outline's extent, for a second opinion on the scale (pixels at least half covered).
  const glyph = {
    width: (px.box[2] - px.box[0]) / dpr,
    height: (px.box[3] - px.box[1]) / dpr,
    unitsWidth: (unit.box[2] - unit.box[0]) * scale,
    unitsHeight: (unit.box[3] - unit.box[1]) * scale,
  };
  return { x, y, size: markSize * scale, centre: { x: cx, y: cy }, scale, glyph, areaUnits: unit.area, areaPx: px.area / dpr / dpr };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await measureBell();
  if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else
    console.log(
      `the app's bell in v-rules-card/overview: 64-unit box at (${result.x.toFixed(3)}, ${result.y.toFixed(3)}) capture px, ` +
        `${result.size.toFixed(3)} px square (${result.scale.toFixed(5)} px a unit); centroid (${result.centre.x.toFixed(3)}, ${result.centre.y.toFixed(3)}); ` +
        `outline ${result.glyph.width.toFixed(2)} x ${result.glyph.height.toFixed(2)} px (the path says ${result.glyph.unitsWidth.toFixed(2)} x ${result.glyph.unitsHeight.toFixed(2)})`,
    );
}
