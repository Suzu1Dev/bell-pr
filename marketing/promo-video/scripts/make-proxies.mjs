#!/usr/bin/env node
/**
 * Derives a smaller copy of the captured footage (public/footage/, DPR 4,
 * 5760x3240) with the bundled ffmpeg, gitignored: public/footage-2x/,
 * 2880x1620 (Lanczos), for shots whose magnification needs no more than
 * DPR 2 (the composition picks per take and per render scale,
 * src/footage.ts). The depth of field's back plane is blurred in the render,
 * by a fixed amount in screen px (src/look/ProductWindow.tsx), so it needs
 * no copy of its own.
 *
 * Stills (PNG) become JPEGs. Chroma is kept at full resolution (4:4:4) so
 * the brand-green text does not bleed. Skips a state whose copy is newer
 * than its footage; `--force` redoes everything.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { packageRoot, remotion } from "./lib/media.mjs";

const force = process.argv.includes("--force");
const source = path.join(packageRoot, "public", "footage");
const targets = { "footage-2x": "scale=2880:1620:flags=lanczos" };

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
    if (!force && existsSync(to) && (await newest(to)) > updated) continue;
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
