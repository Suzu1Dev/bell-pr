#!/usr/bin/env node
/**
 * Pixel checks of two moments, on frames rendered from the composition (one
 * bundle, one browser):
 *
 * 1. The bell's landing (src/bell.ts). Each frame from the landing through
 *    the hand-off is rendered three times: the film as it is, the flying
 *    bell alone (the footage's bell patched out: `bellProbe: "flight"`) and
 *    the footage's bell alone (no flying bell, no patch: `bellProbe:
 *    "footage"`). The bell's moments in each (the brand green's coverage
 *    over the sidebar's paper round the landing point) give its centre and
 *    size: the flying bell must sit within 1 px of the footage's bell and be
 *    within 2% of its size, and the film's frames must match the footage's
 *    bell alone (the hand-off shows no jump).
 * 2. The end card's lines (src/scenes/EndCard.tsx) on the complete card:
 *    the rows that hold ink, top to bottom, are the logo, the headline's two
 *    lines, `npx bell-pr` alone, "Free to start · Runs on your machine"
 *    alone and the non-affiliation line, with clear space between them, and
 *    the command centred.
 *
 * Writes out/review/moments.tsv and the frames under out/review/moments/
 * (moments@4k with --scale=2, the 4K master's pixels, still in 1080p px);
 * exits 1 on a finding.
 *
 *   node scripts/check-moments.mjs [--scale=2]
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import { tsImport } from "tsx/esm/api";
import { packageRoot } from "./lib/media.mjs";
import { coverage, coverageMoments, decodeRgb } from "./lib/rgb.mjs";

const { FLIGHT, HANDOFF, bellOnScreen } = await tsImport("../src/bell.ts", import.meta.url);
const { END_CARD, endCardRows } = await tsImport("../src/scenes/endCardLayout.ts", import.meta.url);
const { logoColors, markPath } = await tsImport("../../../src/brand/brand-assets.ts", import.meta.url);
const { pathMoments } = await tsImport("../src/look/pathMoments.ts", import.meta.url);

const scale = Number(process.argv.find((a) => a.startsWith("--scale="))?.slice(8) ?? 1);
const out = path.join(packageRoot, "out", "review", `moments${scale === 2 ? "@4k" : ""}`);
const hex = (value) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
const PAPER = [244, 246, 241];
const GREEN = hex(logoColors.green);
const LIMITS = { offset: 1, size: 0.02, handoff: 0.25 };

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const serveUrl = await bundle({ entryPoint: path.join(packageRoot, "src", "index.ts"), publicDir: path.join(packageRoot, "public"), symlinkPublicDir: true });
const browser = await openBrowser("chrome", { browserExecutable: process.env.REMOTION_BROWSER_EXECUTABLE || null });
const compositions = new Map();
async function still(frame, probe) {
  const inputProps = probe ? { bellProbe: probe } : {};
  const key = probe ?? "film";
  if (!compositions.has(key)) compositions.set(key, await selectComposition({ serveUrl, id: "Promo", inputProps, puppeteerInstance: browser }));
  const output = path.join(out, `${String(frame).padStart(4, "0")}-${key}${scale === 2 ? "@4k" : ""}.png`);
  await renderStill({ serveUrl, composition: compositions.get(key), frame, output, scale, inputProps, puppeteerInstance: browser, imageFormat: "png", overwrite: true });
  return output;
}

const rows = ["check\tframe\tvalue\tlimit\tresult"];
const findings = [];
const record = (check, frame, value, limit, ok) => {
  rows.push(`${check}\t${frame}\t${value}\t${limit}\t${ok ? "ok" : "FINDING"}`);
  if (!ok) findings.push(`${check} at ${frame}: ${value} (limit ${limit})`);
};

try {
  // 1. The landing and the hand-off.
  const unitArea = pathMoments(markPath).area;
  // Every frame from the landing through the hand-off, and the end of the hold.
  const frames = [];
  for (let frame = FLIGHT.to; frame <= HANDOFF.bell.to; frame += 1) frames.push(frame);
  frames.push(FLIGHT.holdTo);
  for (const frame of frames) {
    const at = bellOnScreen(frame);
    // The mark's own ground: 30 units left of its centre to 31 right (the app's "B" starts 38.5 units right), 34 up and down.
    const crop = [Math.floor((at.x - 30 * at.unit) * scale), Math.floor((at.y - 34 * at.unit) * scale)];
    crop.push(Math.ceil((at.x + 31 * at.unit) * scale) - crop[0], Math.ceil((at.y + 34 * at.unit) * scale) - crop[1]);
    const measure = async (file) => {
      const rgb = await decodeRgb(file, { crop });
      const m = coverageMoments(coverage(rgb, PAPER, GREEN), rgb.width, rgb.height);
      return { x: (crop[0] + m.cx) / scale, y: (crop[1] + m.cy) / scale, size: Math.sqrt(m.area / unitArea) / scale, rgb };
    };
    const footage = await measure(await still(frame, "footage"));
    const film = await measure(await still(frame));
    let line = `footage (${footage.x.toFixed(2)}, ${footage.y.toFixed(2)}) ${footage.size.toFixed(4)} px a unit; film (${film.x.toFixed(2)}, ${film.y.toFixed(2)}) ${film.size.toFixed(4)}`;
    if (frame < HANDOFF.bell.to) {
      // The flying bell alone (drawn whole, the footage's bell patched out) against the footage's bell alone.
      const flight = await measure(await still(frame, "flight"));
      const offset = Math.hypot(flight.x - footage.x, flight.y - footage.y);
      const size = flight.size / footage.size - 1;
      record("landing: flying bell vs the app's bell, centre offset (px at 1080p)", frame, offset.toFixed(3), LIMITS.offset, offset <= LIMITS.offset);
      record("landing: flying bell / the app's bell, size - 1", frame, size.toFixed(4), `±${LIMITS.size}`, Math.abs(size) <= LIMITS.size);
      line = `flying (${flight.x.toFixed(2)}, ${flight.y.toFixed(2)}) ${flight.size.toFixed(4)}; ${line}`;
    }
    // The film's bell through the cross-dissolve against the app's bell alone: no jump in place or size on any frame.
    const offset = Math.hypot(film.x - footage.x, film.y - footage.y);
    const size = film.size / footage.size - 1;
    record("hand-off: the film's bell vs the app's bell, centre offset (px)", frame, offset.toFixed(3), LIMITS.handoff, offset <= LIMITS.handoff);
    record("hand-off: the film's bell / the app's bell, size - 1", frame, size.toFixed(4), `±${LIMITS.size}`, Math.abs(size) <= LIMITS.size);
    let sum = 0;
    for (let i = 0; i < film.rgb.data.length; i += 1) sum += Math.abs(film.rgb.data[i] - footage.rgb.data[i]);
    const mean = sum / film.rgb.data.length;
    if (frame >= HANDOFF.bell.to) record("after the hand-off: the film is the footage (mean level difference round the bell)", frame, mean.toFixed(3), 0.05, mean <= 0.05);
    else rows.push(`vector vs footage raster\t${frame}\tmean level difference round the bell ${mean.toFixed(2)} (the cross-dissolve takes it to 0)\t-\t-`);
    rows.push(`centres\t${frame}\t${line}\t-\t-`);
  }

  // 2. The end card's lines on the complete card.
  const card = END_CARD.checkFrame;
  const file = await still(card);
  const rgb = await decodeRgb(file, { width: 1920 * scale, height: 1080 * scale });
  const ink = [];
  for (let y = 0; y < rgb.height; y += 1) {
    let left = -1;
    let right = -1;
    for (let x = 0; x < rgb.width; x += 1) {
      const i = (y * rgb.width + x) * 3;
      // The dark stage is under 40 levels; type and logo are over 90 (the dimmest, the footer, about 125).
      if (Math.max(rgb.data[i], rgb.data[i + 1], rgb.data[i + 2]) > 90) {
        if (left < 0) left = x;
        right = x;
      }
    }
    ink.push(left < 0 ? null : [left, right]);
  }
  const bands = [];
  for (let y = 0; y < ink.length; y += 1) {
    if (!ink[y]) continue;
    const last = bands.at(-1);
    if (last && y - last.bottom <= 6 * scale) {
      last.bottom = y;
      last.left = Math.min(last.left, ink[y][0]);
      last.right = Math.max(last.right, ink[y][1]);
    } else bands.push({ top: y, bottom: y, left: ink[y][0], right: ink[y][1] });
  }
  const expected = endCardRows();
  const px = (v) => (v / scale).toFixed(1);
  record("end card: rows of ink", card, bands.length, expected.length, bands.length === expected.length);
  bands.forEach((band, i) => {
    const name = expected[i]?.name ?? `extra ${i}`;
    const centre = (band.left + band.right + 1) / 2 / scale;
    rows.push(`end card row\t${card}\t${name}: y ${px(band.top)}-${px(band.bottom + 1)}, x ${px(band.left)}-${px(band.right + 1)}, centre ${centre.toFixed(1)}\t-\t-`);
    if (i > 0) {
      const gap = (band.top - bands[i - 1].bottom - 1) / scale;
      const least = expected[i]?.gapAbove ?? 24;
      record(`end card: clear space above ${name} (px)`, card, gap.toFixed(1), `>= ${least}`, gap >= least);
    }
    if (name === "command" || name === "facts") record(`end card: ${name} centred (px off the middle)`, card, Math.abs(centre - 960).toFixed(1), 3, Math.abs(centre - 960) <= 3);
  });
} finally {
  await browser.close({ silent: true });
}

await writeFile(path.join(packageRoot, "out", "review", `moments${scale === 2 ? "@4k" : ""}.tsv`), `${rows.join("\n")}\n`);
console.log(rows.join("\n"));
if (findings.length) {
  console.error(`\n${findings.length} finding(s):\n${findings.join("\n")}`);
  process.exit(1);
}
console.log("\nmoments: the bell lands on the app's bell and hands off without a jump; the end card's lines are clear");
