#!/usr/bin/env node
/**
 * Checks the rendered outputs in out/ and exits non-zero on any failure:
 *
 * - both videos (ffprobe): 75.28 ± 0.3 s (inside 60-90 s), 1920x1080,
 *   30/1 fps, H.264 + AAC (MP4) and VP9 + Opus (WebM), at most 20 MB each;
 * - poster.jpg: at most 500 KB, 1920x1080;
 * - captions.en.vtt: the cues of src/timeline.json, in order, without
 *   overlap, all ending inside the video;
 * - loudness: -15 to -13 LUFS integrated when the bundled ffmpeg can measure
 *   it (ebur128 or loudnorm), and the gain math either way;
 * - the music's final hit, measured in the MP4's audio: the end-card logo
 *   lands within 0.25 s of it.
 */
import { stat, readFile } from "node:fs/promises";
import path from "node:path";
import { tsImport } from "tsx/esm/api";
import { captionProblems, cuesFromTimeline, parseVtt } from "./lib/captions.mjs";
import {
  decodeMono,
  ffmpegFilters,
  frameLevels,
  largestRise,
  measureLoudness,
  packageRoot,
  probe,
} from "./lib/media.mjs";

const music = await tsImport("../src/music.ts", import.meta.url);
const timeline = JSON.parse(await readFile(path.join(packageRoot, "src", "timeline.json"), "utf8"));

const limits = {
  duration: 75.28,
  tolerance: 0.3,
  window: [60, 90],
  maxVideoBytes: 20_000_000,
  maxPosterBytes: 500_000,
  lufs: [-15, -13],
  hitTolerance: 0.25,
};

const videos = [
  { file: "out/bell-pr-promo-en-1080p.mp4", video: "h264", audio: ["aac"] },
  { file: "out/bell-pr-promo-en-1080p.webm", video: "vp9", audio: ["opus"] },
];

let failures = 0;
const report = (ok, line) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${line}`);
  if (!ok) failures += 1;
};

async function size(file) {
  try {
    return (await stat(path.join(packageRoot, file))).size;
  } catch {
    return undefined;
  }
}

const mb = (bytes) => `${(bytes / 1_000_000).toFixed(2)} MB`;
const durations = [];

for (const { file, video, audio } of videos) {
  const bytes = await size(file);
  if (bytes === undefined) {
    report(false, `${file}: missing; run "npm run render"`);
    continue;
  }
  const info = await probe(file);
  const duration = Number(info.format.duration);
  durations.push(duration);
  const picture = info.streams.find((stream) => stream.codec_type === "video");
  const sound = info.streams.find((stream) => stream.codec_type === "audio");
  report(
    Math.abs(duration - limits.duration) <= limits.tolerance &&
      duration >= limits.window[0] &&
      duration <= limits.window[1],
    `${file}: duration ${duration.toFixed(3)} s (target ${limits.duration} ± ${limits.tolerance} s, inside ${limits.window.join("-")} s)`,
  );
  report(
    picture?.codec_name === video && picture.width === 1920 && picture.height === 1080 && picture.r_frame_rate === "30/1",
    `${file}: video ${picture?.codec_name} ${picture?.width}x${picture?.height} at ${picture?.r_frame_rate} (want ${video} 1920x1080 at 30/1)`,
  );
  report(audio.includes(sound?.codec_name), `${file}: audio ${sound?.codec_name ?? "missing"} (want ${audio.join(" or ")})`);
  report(bytes <= limits.maxVideoBytes, `${file}: ${mb(bytes)} (at most ${mb(limits.maxVideoBytes)})`);
}

const posterBytes = await size("out/poster.jpg");
if (posterBytes === undefined) report(false, "out/poster.jpg: missing");
else {
  const poster = (await probe("out/poster.jpg")).streams[0];
  report(
    posterBytes <= limits.maxPosterBytes && poster?.width === 1920 && poster?.height === 1080,
    `out/poster.jpg: ${(posterBytes / 1000).toFixed(0)} KB, ${poster?.width}x${poster?.height} (at most ${limits.maxPosterBytes / 1000} KB, 1920x1080)`,
  );
}

let vtt;
try {
  vtt = await readFile(path.join(packageRoot, "out", "captions.en.vtt"), "utf8");
} catch {
  report(false, 'out/captions.en.vtt: missing; run "npm run captions"');
}
if (vtt !== undefined) {
  const cues = parseVtt(vtt);
  const shortest = durations.length ? Math.min(...durations) : limits.duration;
  const problems = captionProblems(cues, { duration: shortest });
  for (const problem of problems) report(false, `out/captions.en.vtt: ${problem}`);
  const expected = cuesFromTimeline(timeline);
  const same =
    cues.length === expected.length &&
    cues.every(
      (cue, index) =>
        Math.abs(cue.start - expected[index].start) < 0.0015 &&
        Math.abs(cue.end - expected[index].end) < 0.0015 &&
        cue.lines.join("\n") === expected[index].lines.join("\n"),
    );
  report(same, `out/captions.en.vtt: ${cues.length} cues, the same as src/timeline.json`);
  if (!problems.length)
    report(true, `out/captions.en.vtt: ordered, no overlap, last cue ends at ${cues.at(-1).end.toFixed(3)} s (video ${shortest.toFixed(3)} s)`);
}

const mp4 = videos[0].file;
if ((await size(mp4)) !== undefined) {
  const filters = await ffmpegFilters();
  if (!filters.has("ebur128")) console.log("     the bundled ffmpeg has no ebur128 filter");
  for (const { file } of videos) {
    const loudness = await measureLoudness(file, filters);
    if (!loudness) console.log(`     ${file}: loudness: not measurable with the bundled ffmpeg`);
    else
      report(
        loudness.lufs >= limits.lufs[0] && loudness.lufs <= limits.lufs[1],
        `${file}: loudness ${loudness.lufs.toFixed(2)} LUFS integrated, by ${loudness.method} (want ${limits.lufs.join(" to ")})`,
      );
  }
  const expectedLufs = music.track.lufs + music.gainDb;
  report(
    Math.abs(music.volume - 10 ** (music.gainDb / 20)) < 1e-9 &&
      expectedLufs >= limits.lufs[0] &&
      expectedLufs <= limits.lufs[1],
    `gain math: source ${music.track.lufs} LUFS ${music.gainDb} dB (volume ${music.volume.toFixed(4)}) = ${expectedLufs.toFixed(1)} LUFS`,
  );

  const { fps } = music;
  const from = Math.round(69.5 * fps);
  const to = Math.round(73.0 * fps);
  const { samples, sampleRate } = await decodeMono(mp4, { start: from / fps, duration: (to - from) / fps });
  const hit = largestRise(frameLevels(samples, sampleRate, fps, from));
  console.log(
    `     measured final hit: frame ${hit.frame} (${(hit.frame / fps).toFixed(3)} s), +${hit.rise.toFixed(1)} dB; music.ts records frame ${music.events.finalHit}`,
  );
  const offset = (music.logoLandFrame - hit.frame) / fps;
  report(
    Math.abs(offset) <= limits.hitTolerance,
    `end-card logo lands at frame ${music.logoLandFrame}, ${offset >= 0 ? "+" : ""}${offset.toFixed(3)} s from the measured hit (within ±${limits.hitTolerance} s)`,
  );
}

if (failures) {
  console.error(`check-output: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log("check-output: every check passed.");
