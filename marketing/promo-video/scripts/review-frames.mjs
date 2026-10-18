#!/usr/bin/env node
/**
 * The visual QA pass after a render (spec V1A task 4). Extracts frames from
 * the web MP4 with the bundled ffmpeg into out/review/ and writes
 * out/review/index.tsv (frame, seconds, shot, take, why it was picked):
 *
 * - the midpoint of every shot and of every caption;
 * - two frames either side of every cut (between shots and between takes),
 *   and the first frame after it;
 * - the breath before the first hit, the hit, and the end-card logo landing;
 * - every 15th frame of every product take (the push-ins and the floating
 *   windows), to look for jitter, smear and inconsistent zoom.
 *
 * Then draws out/contact-sheet.png: the middle of every take, the hit and
 * the landing, labelled. Every frame is looked at; the verdicts go to
 * review.md.
 *
 *   node scripts/review-frames.mjs [video]   (default out/bell-pr-promo-en-1080p.mp4)
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { tsImport } from "tsx/esm/api";
import { packageRoot, remotion } from "./lib/media.mjs";

const { timeline } = await tsImport("../src/timeline.ts", import.meta.url);
const { music, fps } = await tsImport("../src/music.ts", import.meta.url);
const { looks } = await tsImport("../src/shots.ts", import.meta.url);
const video = process.argv[2] ?? "out/bell-pr-promo-en-1080p.mp4";
const out = path.join(packageRoot, "out", "review");

const where = (frame) => {
  const shot = timeline.shots.find((s) => frame >= s.from && frame < s.to) ?? timeline.shots.at(-1);
  const take = shot.takes.find((t) => frame >= t.from && frame < t.to) ?? shot.takes.at(-1);
  return { shot, take };
};

/** Every frame to look at, with why. */
function reviewFrames() {
  const frames = new Map();
  const add = (frame, reason) => {
    if (frame < 0 || frame >= timeline.durationInFrames) return;
    frames.set(frame, [...(frames.get(frame) ?? []), reason]);
  };
  for (const shot of timeline.shots) {
    add(Math.floor((shot.from + shot.to) / 2), "shot midpoint");
    const cuts = [shot.from, ...shot.takes.slice(1).map((take) => take.from)];
    for (const cut of cuts) {
      if (cut === 0) continue;
      add(cut - 2, `cut ${cut} -2`);
      add(cut, `cut ${cut}`);
      add(cut + 2, `cut ${cut} +2`);
    }
    for (const take of shot.takes) {
      if (!looks[shot.id]?.[take.id]) continue;
      add(Math.floor((take.from + take.to) / 2), "take midpoint");
      for (let frame = take.from; frame < take.to; frame += 15) add(frame, `${look(shot, take)} every 15th`);
    }
  }
  timeline.captions.forEach((cue) => add(Math.floor((cue.from + cue.to) / 2), `caption "${cue.lines[0]}"`));
  const hit = music.events.firstHit;
  for (const frame of [hit - 36, hit - 18, hit - 5, hit - 1]) add(frame, "the breath before the hit");
  add(hit, "first hit");
  add(music.events.finalHit, "final hit (measured)");
  add(music.landingFrame, "end-card logo lands");
  add(timeline.durationInFrames - 1, "last frame");
  return [...frames.entries()].sort((a, b) => a[0] - b[0]);
}

const look = (shot, take) => (looks[shot.id]?.[take.id]?.float ? "floating window" : "push-in");

/** Runs `jobs` (functions returning promises), `size` at a time. */
async function pool(jobs, size) {
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < jobs.length) await jobs[next++]();
    }),
  );
}

async function extract(frame, file) {
  await remotion([
    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
    // Input seeking returns the first frame at or after the time.
    "-ss", (frame / fps - 0.001).toFixed(4), "-i", path.join(packageRoot, video),
    "-frames:v", "1", file,
  ]);
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const rows = ["frame\tseconds\tshot\ttake\tfile\twhy"];
const list = reviewFrames();
const jobs = list.map(([frame, reasons]) => {
  const { shot, take } = where(frame);
  const name = `${String(frame).padStart(4, "0")}-${shot.id}-${take.id}.png`;
  rows.push(`${frame}\t${(frame / fps).toFixed(3)}\t${shot.id}\t${take.id}\t${name}\t${reasons.join("; ")}`);
  return () => extract(frame, path.join(out, name));
});
await pool(jobs, 4);
await writeFile(path.join(out, "index.tsv"), `${rows.join("\n")}\n`);
console.log(`review: ${list.length} frames in out/review/ (index: out/review/index.tsv)`);

// The contact sheet: the middle of every take, the hit and the landing.
const tiles = [];
for (const shot of timeline.shots)
  for (const take of shot.takes) tiles.push({ frame: Math.floor((take.from + take.to) / 2), label: `${shot.id} · ${take.id}` });
tiles.push({ frame: music.events.firstHit, label: "first hit" }, { frame: music.landingFrame, label: "end-card landing" });
tiles.sort((a, b) => a.frame - b.frame);
const sheet = path.join(out, "sheet");
await mkdir(sheet, { recursive: true });
await pool(
  tiles.map((tile) => {
    tile.file = path.join(sheet, `${String(tile.frame).padStart(4, "0")}.png`);
    return () => extract(tile.frame, tile.file);
  }),
  4,
);
const html = `<!doctype html><meta charset="utf-8"><style>
  body { margin: 0; background: #16201b; font: 600 15px sans-serif; color: #e9efe9; }
  main { display: grid; grid-template-columns: repeat(6, 480px); gap: 10px; padding: 10px; }
  figure { margin: 0; } img { display: block; width: 480px; height: 270px; }
  figcaption { padding: 5px 2px 0; }
</style><main>${tiles
  .map((tile) => `<figure><img src="${pathToFileURL(tile.file)}"><figcaption>${tile.frame} · ${(tile.frame / fps).toFixed(2)} s · ${tile.label}</figcaption></figure>`)
  .join("")}</main>`;
const page = path.join(sheet, "contact-sheet.html");
await writeFile(page, html);
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || process.env.REMOTION_BROWSER_EXECUTABLE;
if (!executablePath) throw new Error("Set PLAYWRIGHT_CHROMIUM_EXECUTABLE to draw the contact sheet.");
const browser = await chromium.launch({ executablePath });
try {
  const tab = await browser.newPage({ viewport: { width: 6 * 490 + 10, height: 600 } });
  await tab.goto(pathToFileURL(page).href);
  await tab.waitForLoadState("load");
  await tab.screenshot({ path: path.join(packageRoot, "out", "contact-sheet.png"), fullPage: true });
} finally {
  await browser.close();
}
console.log(`review: out/contact-sheet.png (${tiles.length} frames)`);
