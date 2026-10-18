#!/usr/bin/env node
/**
 * Measures the music's final hit in the edit, as music/track.analysis.json
 * records it: the video frame inside `finalHitWindow` (81.1-84.0 s for
 * Rock Sport Top; the lead's addendum: a plain "last 10 s" search picks an
 * ordinary groove kick) whose per-frame RMS level rises most over the frame
 * before. It reads the licensed source through the edit's segments, so it
 * runs before any render, and fails when the frame differs from the
 * analysis. scripts/check-output.mjs measures the render again.
 */
import { tsImport } from "tsx/esm/api";
import { decodeMono, frameLevels, largestRise } from "./lib/media.mjs";

const { music, fps } = await tsImport("../src/music.ts", import.meta.url);
const [from, to] = music.finalHitWindow;
const segment = music.segments.findLast((s) => s.from <= from);
if (to > segment.to) throw new Error("The final-hit window crosses a join of the edit.");
const sourceStart = (segment.trimBefore + from - segment.from) / fps;
const { samples, sampleRate } = await decodeMono(`public/${music.musicFile}`, { start: sourceStart, duration: (to - from) / fps });
const hit = largestRise(frameLevels(samples, sampleRate, fps, from));
console.log(
  `final hit: frame ${hit.frame} (${(hit.frame / fps).toFixed(3)} s), +${hit.rise.toFixed(1)} dB over the frame before; the analysis records frame ${music.events.finalHit}`,
);
console.log(`the end-card logo lands on frame ${music.landingFrame} (${(music.landingFrame / fps).toFixed(3)} s, the final chord)`);
if (hit.frame !== music.events.finalHit) {
  console.error("measure-hit: music/track.analysis.json records another frame; update events.finalHit.");
  process.exitCode = 1;
}
