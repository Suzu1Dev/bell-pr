#!/usr/bin/env node
/**
 * Finds the music's final hit in the edit, as src/music.ts records it: the
 * video frame between 69.5 s and 73.0 s whose per-frame RMS level rises most
 * over the frame before. It reads the source MP3 through the edit's second
 * segment (video frame 1200 = source frame 1954) and fails when the frame
 * differs from music.ts. check-output.mjs measures the render again.
 */
import { tsImport } from "tsx/esm/api";
import { decodeMono, frameLevels, largestRise } from "./lib/media.mjs";

const music = await tsImport("../src/music.ts", import.meta.url);
const { fps, segments, events } = music;
const window = { from: Math.round(69.5 * fps), to: Math.round(73.0 * fps) };
const second = segments[1];
const sourceStart = (second.trimBefore + window.from - second.from) / fps;
const { samples, sampleRate } = await decodeMono(`public/${music.musicFile}`, {
  start: sourceStart,
  duration: (window.to - window.from) / fps,
});
const hit = largestRise(frameLevels(samples, sampleRate, fps, window.from));
console.log(
  `final hit: frame ${hit.frame} (${(hit.frame / fps).toFixed(3)} s), +${hit.rise.toFixed(1)} dB over the frame before; music.ts records ${events.finalHit}`,
);
if (hit.frame !== events.finalHit) {
  console.error("measure-hit: src/music.ts records another frame; update events.finalHit.");
  process.exitCode = 1;
}
