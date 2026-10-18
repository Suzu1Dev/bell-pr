#!/usr/bin/env node
/**
 * Writes out/captions.en.vtt and out/captions.en.srt from the cues of
 * src/timeline.ts, the same cues the film shows (the kinetic title lines
 * and the caption cards). Fails when a cue breaks a caption rule
 * (scripts/lib/captions.mjs).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tsImport } from "tsx/esm/api";
import { captionProblems, cuesFromTimeline, toSrt, toVtt } from "./lib/captions.mjs";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const { timeline } = await tsImport("../src/timeline.ts", import.meta.url);
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
