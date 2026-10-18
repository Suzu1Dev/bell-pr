#!/usr/bin/env node
/**
 * Where the film's pointer disc sits beside each click, so it never covers
 * a glyph (review round 6). The disc is drawn beside its hotspot, like an
 * arrow's body beside its tip (src/look/ProductWindow.tsx); for each click
 * the film shows (src/timeline.ts, src/shots.ts) this takes the first
 * offset in a preference list whose disc (its on-screen size at the
 * magnification the click is shown at) covers no glyph, on the frame
 * before the click and on the frame four frames after it (the UI's answer,
 * a label that changes). A glyph is a sharp step in the picture (light text
 * on a dark button as much as dark text on white): a flat area, light or
 * dark, is clear. Where no offset is clear (a dense row of chips), the one
 * that covers the least is used and reported. It also records when the UI
 * answers the click by replacing what was under it (a plan folding, a card
 * collapsing): the click's ring and the disc end there instead of floating
 * over the new UI. Writes public/footage-2x/<state>/pointer.json
 * (gitignored, read with the footage).
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tsImport } from "tsx/esm/api";
import { packageRoot } from "./lib/media.mjs";
import { decodeGrey, H, W } from "./lib/pixels.mjs";

/** Offsets (capture px, right and down from the hotspot) in order of preference: down-right first, like an arrow. */
const OFFSETS = [
  [9, 11], [12, 13], [14, 9], [8, 15], [16, 12], [12, 17], [18, 7], [7, 19], [20, 14], [15, 19], [22, 9], [10, 22],
  [24, 16], [18, 22], [26, 10], [14, 25], [-9, 12], [-13, 9], [28, 20], [20, 26], [30, 26], [24, 30], [34, 18],
  [-18, 26], [36, 28], [28, 34], [40, 22], [-24, 30],
];
/** The disc's radius on screen (1080p px): the 20 px disc, its 2 px white ring and a pixel of margin. */
const DISC = 13;
/** Clip frames after a click searched for the UI's answer, and the mean step (levels) round the click that counts. */
const AFTER = 8;
const CHANGE = 20;

/** Mean absolute difference of two pictures in a 160x80 capture px box round (x, y). */
const areaDiff = (a, b, x, y) => {
  let sum = 0;
  let n = 0;
  for (let py = Math.max(0, Math.round(y - 40)); py < Math.min(H, Math.round(y + 40)); py += 1)
    for (let px = Math.max(0, Math.round(x - 80)); px < Math.min(W, Math.round(x + 80)); px += 1) {
      sum += Math.abs(a[py * W + px] - b[py * W + px]);
      n += 1;
    }
  return sum / Math.max(1, n);
};

/** A step this large between neighbouring capture px is the edge of a glyph (or a button's outline). */
const STEP = 48;

/** The glyph-edge pixels a disc of radius R at (x, y) would cover (off the picture counts as covered). */
const covered = (pixels, x, y, R) => {
  let count = 0;
  for (let dy = -R; dy <= R; dy += 1)
    for (let dx = -R; dx <= R; dx += 1) {
      if (dx * dx + dy * dy > R * R) continue;
      const px = Math.round(x + dx);
      const py = Math.round(y + dy);
      if (px < 0 || py < 0 || px + 1 >= W || py + 1 >= H) count += 1;
      else {
        const v = pixels[py * W + px];
        if (Math.abs(v - pixels[py * W + px + 1]) > STEP || Math.abs(v - pixels[(py + 1) * W + px]) > STEP) count += 1;
      }
    }
  return count;
};

const { timeline } = await tsImport("../src/timeline.ts", import.meta.url);
const { looks } = await tsImport("../src/shots.ts", import.meta.url);
const { takeView } = await tsImport("../src/takes.ts", import.meta.url);

/** Per state, the clicks the film shows and the smallest magnification it shows each at. */
const shown = new Map();
for (const shot of timeline.shots)
  for (const take of shot.takes) {
    const look = looks[shot.id]?.[take.id];
    if (!look || look.still !== undefined) continue;
    const targets = JSON.parse(await readFile(path.join(packageRoot, "public", "footage", look.state, "targets.json"), "utf8"));
    const from = look.clipFrom ?? 0;
    const rate = look.rate ?? 1;
    const to = Math.min(look.clipTo ?? Infinity, from + ((take.to - take.from) / 30) * rate);
    for (const click of targets.events.filter((e) => e.type === "click" && e.t >= from && e.t < to)) {
      const m = takeView(look, ((click.t - from) / rate) * 30).m;
      const byState = shown.get(look.state) ?? new Map();
      byState.set(click.t, Math.min(byState.get(click.t) ?? Infinity, m));
      shown.set(look.state, byState);
    }
  }

const root = path.join(packageRoot, "public");
const crowded = [];
for (const [state, byClick] of [...shown].sort()) {
  const dir = path.join(root, "footage", state);
  const frames = JSON.parse(await readFile(path.join(dir, "frames.json"), "utf8")).frames;
  const clicks = JSON.parse(await readFile(path.join(dir, "targets.json"), "utf8")).events.filter((e) => e.type === "click" && byClick.has(e.t));
  const at = (t) => frames[Math.min(frames.length - 1, Math.max(0, Math.floor(t * 30 + 1e-6)))].file;
  // Per click: the frame before it, then the AFTER clip frames that follow it.
  const files = clicks.flatMap((click) =>
    [at(click.t - 1 / 30), ...Array.from({ length: AFTER }, (_, k) => at(click.t + (k + 1) / 30))].map((file) => path.join(root, "footage-2x", state, file)),
  );
  const pictures = await decodeGrey(files);
  const spots = clicks.map((click, i) => {
    const group = pictures.slice(i * (AFTER + 1), (i + 1) * (AFTER + 1));
    const [before, after] = [group[0], group[4]];
    // The UI's answer that replaces what was clicked (a plan folding, a dialog closing, a layout shift): the first
    // frame, from the second after the click on, that differs from the first (the control's own pressed or selected
    // state) by more than CHANGE levels on average round the click (a chip turning selected changes it by 5-8, a
    // fold by 80). The ring and the disc end there.
    let changeAt;
    for (let k = 2; k < group.length; k += 1)
      if (areaDiff(group[1], group[k], click.x, click.y) > CHANGE) {
        changeAt = click.t + (k - 1) / 30;
        break;
      }
    const R = Math.ceil(DISC / byClick.get(click.t));
    const cost = ([dx, dy]) => covered(before, click.x + dx, click.y + dy, R) + covered(after, click.x + dx, click.y + dy, R);
    let offset = OFFSETS.find((o) => cost(o) === 0);
    if (!offset) {
      // A dense spot (a row of chips over a line of help text): the offset that covers the least.
      offset = OFFSETS.reduce((best, o) => (cost(o) < cost(best) ? o : best));
      crowded.push(`${state} ${click.t.toFixed(2)} s (${click.target}): ${cost(offset)} edge px under the disc at best`);
    }
    return { t: click.t, dx: offset[0], dy: offset[1], ...(changeAt === undefined ? {} : { changeAt: +changeAt.toFixed(4) }) };
  });
  await writeFile(path.join(root, "footage-2x", state, "pointer.json"), `${JSON.stringify({ spots }, null, 1)}\n`);
  console.log(
    `pointer: ${state}: ${spots.map((spot) => `${spot.t.toFixed(2)} s (${spot.dx}, ${spot.dy})${spot.changeAt ? ` UI changes ${spot.changeAt.toFixed(3)} s` : ""}`).join(", ")}`,
  );
}
for (const line of crowded) console.log(`pointer: no clear spot for ${line}`);
