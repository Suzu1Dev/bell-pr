#!/usr/bin/env node
/**
 * Writes out/captions.en.vtt and out/captions.en.srt from the cues in
 * src/timeline.json, the same cues the video burns in. Fails when a cue
 * breaks a caption rule (scripts/lib/captions.mjs).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { captionProblems, cuesFromTimeline, toSrt, toVtt } from "./lib/captions.mjs";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const timeline = JSON.parse(await readFile(path.join(packageRoot, "src", "timeline.json"), "utf8"));
const cues = cuesFromTimeline(timeline);
const problems = captionProblems(cues, { duration: timeline.durationInFrames / timeline.fps });
if (problems.length) {
  for (const problem of problems) console.error(`captions: ${problem}`);
  process.exit(1);
}
const out = path.join(packageRoot, "out");
await mkdir(out, { recursive: true });
await writeFile(path.join(out, "captions.en.vtt"), toVtt(cues));
await writeFile(path.join(out, "captions.en.srt"), toSrt(cues));
console.log(`captions: ${cues.length} cues written to out/captions.en.vtt and out/captions.en.srt`);
