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
 * Two scans run over EVERY frame of the video (one decode pass), because a
 * defect a few frames long hides between samples:
 *
 * - discontinuities: the mean absolute luma difference to the frame before
 *   (on a 480x270 copy); above 8 on a frame that is not a cut (nor the
 *   UI's answer, within 6 frames, to a click the pointer makes on screen,
 *   nor a frame where the camera itself moves more than 4 px at a frame
 *   corner, nor a take whose UI updates in place, `liveFrom`), the picture
 *   jumped inside a take (a capture's scroll or reflow);
 * - card edges: in a ring 6-18 px around every caption card (its box from
 *   the same layout as the film, the text measured in Chrome with the
 *   film's font), the count of pixels with a luma step above 70 to their
 *   neighbour; more than 8 means a sharp line of UI text (or the pointer)
 *   runs into the card instead of soft plane or studio;
 * - empty cards: on the second frame of every caption card that comes in
 *   (not one handed over), the card's box must already hold its text (at
 *   least 150 pixels 40 levels darker than the card's own median), never an
 *   empty frosted box (review rounds 1 and 7).
 *
 * A third check runs on the footage itself, at every take's settled frames
 * (scripts/check-dof.mjs): no glyph in a depth-of-field feather and no
 * sharp line cut by a frame or window edge.
 *
 * All go to out/review/scans.tsv; any finding makes the script exit 1.
 *
 *   node scripts/review-frames.mjs [video]   (default out/bell-pr-promo-en-1080p.mp4)
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { tsImport } from "tsx/esm/api";
import { checkDof } from "./check-dof.mjs";
import { packageRoot, remotion } from "./lib/media.mjs";

const { timeline } = await tsImport("../src/timeline.ts", import.meta.url);
const { music, fps } = await tsImport("../src/music.ts", import.meta.url);
const { looks } = await tsImport("../src/shots.ts", import.meta.url);
const { takeView } = await tsImport("../src/takes.ts", import.meta.url);
const { project } = await tsImport("../src/look/camera.ts", import.meta.url);
const { cardBox, CAPTION_ROLE } = await tsImport("../src/look/captionLayout.ts", import.meta.url);
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

// The scans over every frame -------------------------------------------------------------

/** Every cut of the film: shot starts and take starts (the frame a new picture begins). */
const cutFrames = new Set(timeline.shots.flatMap((shot) => [shot.from, ...shot.takes.map((take) => take.from)]));

/** The caption cards' boxes, with every line measured in Chrome in the film's font. */
async function measuredCards() {
  const fontFile = path.join(packageRoot, "node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-opsz-normal.woff2");
  const cues = timeline.captions.filter((cue) => cue.style === "card");
  const lines = [...new Set(cues.flatMap((cue) => cue.lines))];
  const page = `<!doctype html><meta charset="utf-8"><style>
    @font-face { font-family: "Promo DM Sans"; src: url("${pathToFileURL(fontFile)}") format("woff2-variations"); font-weight: 100 1000; }
    span { position: absolute; white-space: pre; font: ${CAPTION_ROLE.weight} ${CAPTION_ROLE.size}px "Promo DM Sans";
      letter-spacing: ${CAPTION_ROLE.tracking}em; font-optical-sizing: auto; font-kerning: normal; }
  </style>${lines.map((line, i) => `<span id="l${i}">${line.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</span>`).join("")}`;
  const file = path.join(out, "measure.html");
  await writeFile(file, page);
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || process.env.REMOTION_BROWSER_EXECUTABLE });
  try {
    const tab = await browser.newPage();
    await tab.goto(pathToFileURL(file).href);
    await tab.evaluate(() => document.fonts.ready);
    const widths = await tab.evaluate((n) => Array.from({ length: n }, (_, i) => document.getElementById(`l${i}`).getBoundingClientRect().width), lines.length);
    const width = new Map(lines.map((line, i) => [line, widths[i]]));
    return cues.map((cue) => ({ cue, box: cardBox(cue, (line) => width.get(line)) }));
  } finally {
    await browser.close();
  }
}

/** Decodes the video once, as full-resolution luma, and hands every frame to `each(frame, pixels)`. */
function eachFrame(file, each) {
  const W = 1920;
  const H = 1080;
  const size = W * H;
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["remotion", "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", path.join(packageRoot, file),
      "-vf", "format=gray", "-f", "image2pipe", "-c:v", "rawvideo", "pipe:1"], { cwd: packageRoot });
    let buffer = Buffer.alloc(0);
    let frame = 0;
    child.stdout.on("data", (chunk) => {
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
      while (buffer.length >= size) {
        each(frame, buffer.subarray(0, size));
        frame += 1;
        buffer = buffer.subarray(size);
        if (buffer.length) buffer = Buffer.from(buffer);
      }
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(frame) : reject(new Error(`ffmpeg exited ${code}`))));
  });
}

/**
 * The film frames on which the UI answers one of the pointer's clicks (up to 6 frames after it): the plan
 * folding on "Approve", a card collapsing on "Got it". Those are cause and effect, not a capture's scroll.
 */
const clickFrames = (() => {
  const frames = [];
  for (const shot of timeline.shots)
    for (const take of shot.takes) {
      const look = looks[shot.id]?.[take.id];
      if (!look || look.still !== undefined) continue;
      const targets = JSON.parse(readFileSync(path.join(packageRoot, "public", "footage", look.state, "targets.json"), "utf8"));
      const from = look.clipFrom ?? 0;
      const rate = look.rate ?? 1;
      const to = Math.min(look.clipTo ?? Infinity, from + ((take.to - take.from) / fps) * rate);
      for (const event of targets.events)
        if (event.type === "click" && event.t >= from && event.t < to) frames.push(take.from + Math.round(((event.t - from) / rate) * fps));
    }
  return frames;
})();
const answersClick = (frame) => clickFrames.some((click) => frame > click && frame <= click + 6);

/** Whether the camera itself moves fast at this frame (more than 4 px at a frame corner): a push, not a jump. */
const cameraMoves = (frame) => {
  const { shot, take } = where(frame);
  const look = looks[shot.id]?.[take.id];
  if (!look || frame <= take.from) return false;
  const [a, b] = [takeView(look, frame - 1 - take.from), takeView(look, frame - take.from)];
  return [[0, 0], [1920, 0], [1920, 1080], [0, 1080]].some(([X, Y]) => {
    const p = { x: a.cx + (X - a.sx) / a.m, y: a.cy + (Y - a.sy) / a.m };
    const q = project(b, p.x, p.y);
    return Math.hypot(q.x - X, q.y - Y) > 4;
  });
};

/** Whether the take's captured UI updates in place at this frame (`liveFrom`, clip seconds). */
const live = (frame) => {
  const { shot, take } = where(frame);
  const look = looks[shot.id]?.[take.id];
  if (look?.liveFrom === undefined) return false;
  return (look.clipFrom ?? 0) + ((frame - take.from) / fps) * (look.rate ?? 1) >= look.liveFrom;
};

const cards = await measuredCards();
const findings = [];
const scanRows = ["frame\tseconds\tscan\tvalue\twhere"];
let previous;
const decoded = await eachFrame(video, (frame, pixels) => {
  // Discontinuities: a 480x270 grid of the luma.
  const grid = new Uint8Array(480 * 270);
  for (let y = 0; y < 270; y += 1) for (let x = 0; x < 480; x += 1) grid[y * 480 + x] = pixels[(y * 4 + 2) * 1920 + x * 4 + 2];
  if (previous) {
    let sum = 0;
    for (let i = 0; i < grid.length; i += 1) sum += Math.abs(grid[i] - previous[i]);
    const diff = sum / grid.length;
    if (diff > 8 && !cutFrames.has(frame) && !answersClick(frame) && !cameraMoves(frame) && !live(frame)) {
      const { shot, take } = where(frame);
      findings.push(`frame ${frame}: the picture jumps (mean luma step ${diff.toFixed(1)}) inside ${shot.id}/${take.id}`);
      scanRows.push(`${frame}\t${(frame / fps).toFixed(3)}\tdiscontinuity\t${diff.toFixed(2)}\t${shot.id}/${take.id}`);
    }
  }
  previous = grid;
  // Empty cards: the second frame of a card that comes in already shows its lines.
  const arriving = cards.find(({ cue }) => frame === cue.from + 1 && !cards.some((other) => other.cue !== cue && other.cue.shot === cue.shot && other.cue.to === cue.from));
  if (arriving) {
    const { left, top, width, height } = arriving.box;
    const values = [];
    for (let y = Math.round(top + 14); y < Math.round(top + height - 14); y += 1)
      for (let x = Math.round(left + 14); x < Math.round(left + width - 14); x += 1) values.push(pixels[y * 1920 + x]);
    const median = [...values].sort((a, b) => a - b)[values.length >> 1];
    const ink = values.filter((v) => v < median - 40).length;
    if (ink < 150) {
      const { shot, take } = where(frame);
      findings.push(`frame ${frame}: the caption card "${arriving.cue.lines[0]}" shows without its text (${ink} ink px) (${shot.id}/${take.id})`);
      scanRows.push(`${frame}\t${(frame / fps).toFixed(3)}\tempty card\t${ink}\t${shot.id}/${take.id}`);
    }
  }
  // Card edges: settled card frames only (not while a card comes in, hands over or leaves).
  const card = cards.find(({ cue }) => frame >= cue.from + 8 && frame < cue.to - 8);
  if (card && frame % 2 === 0) {
    const { left, top, width, height } = card.box;
    const [l, t, r, b] = [Math.round(left), Math.round(top), Math.round(left + width), Math.round(top + height)];
    let count = 0;
    // The ring 6-18 px outside the box: clear of the card's own edge and shadow (and of a few px of text-measure difference).
    for (let y = Math.max(1, t - 18); y < Math.min(1079, b + 18); y += 1)
      for (let x = Math.max(1, l - 18); x < Math.min(1919, r + 18); x += 1) {
        if (x >= l - 6 && x < r + 6 && y >= t - 6 && y < b + 6) continue;
        const v = pixels[y * 1920 + x];
        if (Math.abs(v - pixels[y * 1920 + x + 1]) > 70 || Math.abs(v - pixels[(y + 1) * 1920 + x]) > 70) count += 1;
      }
    if (count > 8) {
      const { shot, take } = where(frame);
      findings.push(`frame ${frame}: ${count} sharp edge pixels in the ring round the card "${card.cue.lines[0]}" (${shot.id}/${take.id})`);
      scanRows.push(`${frame}\t${(frame / fps).toFixed(3)}\tcard edge\t${count}\t${shot.id}/${take.id}`);
    }
  }
});
// The sharp planes against the footage: no glyph in a feather, no sharp line cut by an edge (scripts/check-dof.mjs).
for (const finding of await checkDof()) {
  findings.push(`depth of field: ${finding}`);
  scanRows.push(`\t\tdepth of field\t\t${finding}`);
}
await writeFile(path.join(out, "scans.tsv"), `${scanRows.join("\n")}\n`);
console.log(`review: scanned ${decoded} frames for jumps inside takes and sharp UI against caption cards (out/review/scans.tsv)`);
if (decoded !== timeline.durationInFrames) findings.push(`decoded ${decoded} frames, the composition has ${timeline.durationInFrames}`);
for (const finding of findings.slice(0, 40)) console.error(`review: ${finding}`);
if (findings.length) {
  console.error(`review: ${findings.length} finding(s)`);
  process.exitCode = 1;
}
