#!/usr/bin/env node
/**
 * The visual QA pass after a render. Extracts frames from the MP4 with the
 * bundled ffmpeg into out/review/:
 *
 * - the midpoint of every shot and of every caption;
 * - two frames either side of every cut (between shots, between the
 *   stills of a shot, where a clip cuts over a skipped stretch, and where
 *   the capture cut inside a clip);
 * - the measured music hit and the frame the end-card logo lands on.
 *
 * It also writes out/contact-sheet.png, a grid of 24 frames spread evenly
 * over the video, for a look at the whole cut at once. Read the frames and
 * record the verdicts in review.md.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { tsImport } from "tsx/esm/api";
import { packageRoot, remotion } from "./lib/media.mjs";

const timeline = JSON.parse(await readFile(path.join(packageRoot, "src", "timeline.json"), "utf8"));
const music = await tsImport("../src/music.ts", import.meta.url);
const { fps } = timeline;
const video = "out/bell-pr-promo-en-1080p.mp4";
const out = path.join(packageRoot, "out", "review");

const shotAt = (frame) =>
  timeline.shots.find((shot) => frame >= shot.from && frame < shot.to) ?? timeline.shots.at(-1);

/** The named moments each clip's capture recorded. */
const marks = {};
for (const shot of timeline.shots) {
  try {
    const targets = JSON.parse(
      await readFile(path.join(packageRoot, "public", "footage", shot.id, "targets.json"), "utf8"),
    );
    if (targets.marks) marks[shot.id] = targets.marks;
  } catch {
    // Not captured, or a card.
  }
}

/** Every frame to look at, with why. */
function reviewFrames() {
  const frames = new Map();
  const add = (frame, reason) => {
    if (frame < 0 || frame >= timeline.durationInFrames) return;
    frames.set(frame, [...(frames.get(frame) ?? []), reason]);
  };
  const cut = (frame, name) => {
    add(frame - 2, `${name} -2`);
    add(frame + 2, `${name} +2`);
  };
  for (const shot of timeline.shots) {
    add(Math.floor((shot.from + shot.to) / 2), "shot midpoint");
    if (shot.from > 0) cut(shot.from, "cut");
    for (const still of shot.stills?.slice(1) ?? []) cut(shot.from + still.from, "still change");
    for (const [skipFrom] of shot.clip?.skip ?? [])
      cut(shot.from + Math.ceil((skipFrom - shot.clip.startAt) * fps), "clip cut");
    // Cuts the capture made inside a clip (targets.json marks).
    for (const [name, seconds] of Object.entries(marks[shot.id] ?? {}))
      cut(shot.from + Math.round((seconds - (shot.clip?.startAt ?? 0)) * fps), `clip cut "${name}"`);
  }
  timeline.captions.forEach((cue) => add(Math.floor((cue.from + cue.to) / 2), `caption "${cue.text.split("\n")[0]}"`));
  add(music.events.finalHit, "music hit");
  add(music.logoLandFrame, "logo lands");
  return [...frames.entries()].sort((a, b) => a[0] - b[0]);
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
const index = [];
for (const [frame, reasons] of reviewFrames()) {
  const shot = shotAt(frame);
  const name = `${String(frame).padStart(4, "0")}-${shot.id}.png`;
  await extract(frame, path.join(out, name));
  index.push(`${name}  ${(frame / fps).toFixed(2)} s  ${reasons.join("; ")}`);
}
await writeFile(path.join(out, "index.txt"), `${index.join("\n")}\n`);
console.log(`review: ${index.length} frames in out/review/ (see out/review/index.txt)`);

// The contact sheet: 24 frames, evenly spread, in a 6x4 grid.
const sheetDir = path.join(out, "sheet");
await mkdir(sheetDir, { recursive: true });
const tiles = [];
for (let tile = 0; tile < 24; tile += 1) {
  const frame = Math.round(((tile + 0.5) * timeline.durationInFrames) / 24);
  const file = path.join(sheetDir, `${String(frame).padStart(4, "0")}.png`);
  await extract(frame, file);
  tiles.push({ file, label: `${(frame / fps).toFixed(1)} s · ${shotAt(frame).id}` });
}
const html = `<!doctype html><meta charset="utf-8"><style>
  body { margin: 0; background: #24342b; font: 600 15px system-ui, sans-serif; color: #fff; }
  main { display: grid; grid-template-columns: repeat(6, 480px); gap: 8px; padding: 8px; }
  figure { margin: 0; } img { display: block; width: 480px; height: 270px; }
  figcaption { padding: 4px 2px 0; }
</style><main>${tiles
  .map((tile) => `<figure><img src="${pathToFileURL(tile.file)}"><figcaption>${tile.label}</figcaption></figure>`)
  .join("")}</main>`;
const page = path.join(sheetDir, "contact-sheet.html");
await writeFile(page, html);
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || process.env.REMOTION_BROWSER_EXECUTABLE;
if (!executablePath) throw new Error("Set PLAYWRIGHT_CHROMIUM_EXECUTABLE to draw the contact sheet.");
const browser = await chromium.launch({ executablePath });
try {
  const tab = await browser.newPage({ viewport: { width: 6 * 488 + 8, height: 600 } });
  await tab.goto(pathToFileURL(page).href);
  await tab.waitForLoadState("load");
  await tab.screenshot({ path: path.join(packageRoot, "out", "contact-sheet.png"), fullPage: true });
} finally {
  await browser.close();
}
console.log("review: out/contact-sheet.png");
