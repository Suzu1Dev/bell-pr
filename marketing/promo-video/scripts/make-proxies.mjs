#!/usr/bin/env node
/**
 * Derives two smaller copies of the captured footage (public/footage/, DPR 4,
 * 5760x3240) with the bundled ffmpeg, all gitignored:
 *
 * - public/footage-2x/: 2880x1620 (Lanczos), for shots whose magnification
 *   needs no more than DPR 2 (the composition picks per take and per render
 *   scale, src/footage.ts);
 * - public/footage-soft/: 1440x810, scaled down to 1/5 and back up (bicubic),
 *   which is a cheap, smooth blur of about 1.5 capture px (3 px on screen
 *   at the pushes' magnification): the back plane of the two-plane depth of
 *   field, so the render does not blur a full-frame layer every frame. The
 *   film also veils it (src/look/ProductWindow.tsx): readable-size text in
 *   the soft plane is dimmed and lightly blurred, not smeared.
 *
 * Stills (PNG) become JPEGs in both. Chroma is kept at full resolution
 * (4:4:4) so the brand-green text does not bleed. Skips a state whose
 * copies are newer than its footage; `--force` redoes everything and
 * `--force-soft` only the soft copies.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { packageRoot, remotion } from "./lib/media.mjs";

const force = process.argv.includes("--force");
const forceSoft = process.argv.includes("--force-soft");
const source = path.join(packageRoot, "public", "footage");
const targets = {
  "footage-2x": "scale=2880:1620:flags=lanczos",
  "footage-soft": "scale=288:162:flags=area,scale=1440:810:flags=bicubic",
};

if (!existsSync(source)) throw new Error('public/footage/ is missing: run "npm run capture" first.');
const ffmpeg = (args) => remotion(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", ...args]);
const newest = async (dir) => {
  let time = 0;
  for (const entry of await readdir(dir, { withFileTypes: true }))
    time = Math.max(time, entry.isDirectory() ? await newest(path.join(dir, entry.name)) : (await stat(path.join(dir, entry.name))).mtimeMs);
  return time;
};

for (const state of (await readdir(source)).sort()) {
  const from = path.join(source, state);
  if (!(await stat(from)).isDirectory()) continue;
  const updated = await newest(from);
  for (const [name, filter] of Object.entries(targets)) {
    const to = path.join(packageRoot, "public", name, state);
    if (!force && !(forceSoft && name === "footage-soft") && existsSync(to) && (await newest(to)) > updated) continue;
    await rm(to, { recursive: true, force: true });
    await mkdir(to, { recursive: true });
    const files = await readdir(from);
    for (const still of files.filter((file) => file.endsWith(".png")))
      await ffmpeg(["-i", path.join(from, still), "-vf", `${filter},format=yuvj444p`, "-q:v", "2", path.join(to, still.replace(/\.png$/, ".jpg"))]);
    if (files.includes("frames")) {
      await mkdir(path.join(to, "frames"), { recursive: true });
      await ffmpeg([
        "-start_number", "0", "-i", path.join(from, "frames", "%05d.jpg"),
        "-vf", `${filter},format=yuvj444p`, "-q:v", "2",
        "-start_number", "0", path.join(to, "frames", "%05d.jpg"),
      ]);
    }
    console.log(`proxies: ${name}/${state}`);
  }
}
