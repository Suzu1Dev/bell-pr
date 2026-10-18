#!/usr/bin/env node
/**
 * The 1080p web files from the 4K master (review round 7): the master is
 * the composition rendered at --scale=2, so a Lanczos downscale gives every
 * 1080p pixel four rendered ones (a 1x Chrome render measured 23-30% less
 * Laplacian energy on UI text than the downscaled master). With the bundled
 * ffmpeg:
 *
 * - out/bell-pr-promo-en-1080p.mp4: H.264 High, x264 slow at CRF 21, AAC
 *   192k, fast start (about 17-19 MB against the 20 MB budget);
 * - out/bell-pr-promo-en-1080p.webm: VP9 at CRF 30 (constant quality,
 *   row-multithreaded), Opus 160k, with a keyframe on every cut where a
 *   stage plate first shows (src/keyframes.ts), so VP9 keeps the plates'
 *   grain and the gradients do not band (review rounds 3 and 6).
 *
 * Both tagged BT.709, limited range, as Remotion tags its own renders. The
 * sound is the master's own mix. Run after `npm run render:master`.
 *
 *   node scripts/web-from-master.mjs [mp4|webm ...]
 */
import { stat } from "node:fs/promises";
import path from "node:path";
import { tsImport } from "tsx/esm/api";
import { packageRoot, remotion } from "./lib/media.mjs";

const { keyframeCuts } = await tsImport("../src/keyframes.ts", import.meta.url);

const master = path.join(packageRoot, "out", "bell-pr-promo-en-2160p.mp4");
await stat(master).catch(() => {
  throw new Error('out/bell-pr-promo-en-2160p.mp4 is missing: run "npm run render:master" first.');
});
const wanted = process.argv.slice(2);
const make = (kind) => !wanted.length || wanted.includes(kind);

const scale = ["-vf", "scale=1920:1080:flags=lanczos+accurate_rnd+full_chroma_int,format=yuv420p"];
const color = ["-colorspace:v", "bt709", "-color_primaries:v", "bt709", "-color_trc:v", "bt709", "-color_range", "tv"];

if (make("mp4")) {
  const out = path.join(packageRoot, "out", "bell-pr-promo-en-1080p.mp4");
  await remotion([
    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", master, ...scale,
    "-c:v", "libx264", "-preset", "slow", "-crf", "21", "-profile:v", "high", ...color,
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out,
  ]);
  console.log(`web: ${path.relative(packageRoot, out)} ${((await stat(out)).size / 1e6).toFixed(2)} MB`);
}

if (make("webm")) {
  const out = path.join(packageRoot, "out", "bell-pr-promo-en-1080p.webm");
  // Half a frame early, so the keyframe falls on the cut frame itself (frame rule: floor(t * 30)).
  const keys = keyframeCuts().map((frame) => ((frame - 0.5) / 30).toFixed(4)).join(",");
  await remotion([
    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", master, ...scale,
    "-c:v", "libvpx-vp9", "-crf", "30", "-b:v", "0", "-row-mt", "1", "-force_key_frames", keys, ...color,
    "-c:a", "libopus", "-b:a", "160k", out,
  ]);
  console.log(`web: ${path.relative(packageRoot, out)} ${((await stat(out)).size / 1e6).toFixed(2)} MB`);
}
