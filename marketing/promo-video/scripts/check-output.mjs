#!/usr/bin/env node
/**
 * Checks the rendered outputs in out/ and exits non-zero on any failure:
 *
 * - every video (ffprobe): the composition's length (± 0.1 s, inside
 *   75-90 s) at 30/1 fps; the 4K master 3840x2160 H.264 + AAC; the web
 *   MP4 1920x1080 H.264 + AAC and the WebM 1920x1080 VP9 + Opus, each web
 *   file at most 20 MB;
 * - poster.jpg: 1920x1080, at most 500 KB;
 * - captions.en.vtt: the cues of src/timeline.ts, in order, without
 *   overlap, within the caption rules, all ending inside the video;
 * - loudness: -15 to -13 LUFS integrated, true peak at most -1 dBTP
 *   (the bundled ffmpeg's loudnorm analysis), for every video;
 * - the music's final hit, measured again in the web MP4's audio inside
 *   the analysis's finalHitWindow, where the analysis records it (± 1
 *   frame), and the end-card logo within ± 0.25 s of the final chord that
 *   follows it (the lead's landing rule for this track).
 *
 *   node scripts/check-output.mjs            everything
 *   node scripts/check-output.mjs --web-only the 1080p files (the 4K master is reported as not checked)
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { tsImport } from "tsx/esm/api";
import { captionProblems, cuesFromTimeline, parseVtt } from "./lib/captions.mjs";
import { decodeMono, frameLevels, largestRise, measureLoudness, packageRoot, probe } from "./lib/media.mjs";

const webOnly = process.argv.includes("--web-only");
const { music, fps } = await tsImport("../src/music.ts", import.meta.url);
const { timeline } = await tsImport("../src/timeline.ts", import.meta.url);

const limits = {
  duration: timeline.durationInFrames / fps,
  tolerance: 0.1,
  window: [75, 90],
  maxWebBytes: 20_000_000,
  maxPosterBytes: 500_000,
  lufs: [-15, -13],
  truePeak: -1,
  landing: 0.25,
};

const videos = [
  { file: "out/bell-pr-promo-en-1080p.mp4", video: "h264", audio: "aac", width: 1920, height: 1080, web: true },
  { file: "out/bell-pr-promo-en-1080p.webm", video: "vp9", audio: "opus", width: 1920, height: 1080, web: true },
  { file: "out/bell-pr-promo-en-2160p.mp4", video: "h264", audio: "aac", width: 3840, height: 2160, web: false },
];

let failures = 0;
const report = (ok, line) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${line}`);
  if (!ok) failures += 1;
};
const size = async (file) => (await stat(path.join(packageRoot, file)).catch(() => undefined))?.size;
const mb = (bytes) => `${(bytes / 1_000_000).toFixed(2)} MB`;

const durations = [];
for (const spec of videos) {
  if (webOnly && !spec.web) {
    console.log(`---- ${spec.file}: not checked (--web-only)`);
    continue;
  }
  const bytes = await size(spec.file);
  if (bytes === undefined) {
    report(false, `${spec.file}: missing; render it first (README.md)`);
    continue;
  }
  const info = await probe(spec.file);
  const duration = Number(info.format.duration);
  durations.push(duration);
  const picture = info.streams.find((stream) => stream.codec_type === "video");
  const sound = info.streams.find((stream) => stream.codec_type === "audio");
  report(
    Math.abs(duration - limits.duration) <= limits.tolerance && duration >= limits.window[0] && duration <= limits.window[1],
    `${spec.file}: ${duration.toFixed(3)} s (the composition's ${limits.duration.toFixed(3)} s ± ${limits.tolerance}, inside ${limits.window.join("-")} s)`,
  );
  report(
    picture?.codec_name === spec.video && picture.width === spec.width && picture.height === spec.height && picture.r_frame_rate === "30/1",
    `${spec.file}: ${picture?.codec_name} ${picture?.width}x${picture?.height} at ${picture?.r_frame_rate} (want ${spec.video} ${spec.width}x${spec.height} at 30/1)`,
  );
  report(sound?.codec_name === spec.audio, `${spec.file}: audio ${sound?.codec_name ?? "missing"} (want ${spec.audio})`);
  if (spec.web) report(bytes <= limits.maxWebBytes, `${spec.file}: ${mb(bytes)} (at most ${mb(limits.maxWebBytes)})`);
  else console.log(`     ${spec.file}: ${mb(bytes)} (no size cap for the master)`);
  const loudness = await measureLoudness(spec.file);
  if (!loudness) report(false, `${spec.file}: loudness could not be measured`);
  else {
    report(
      loudness.lufs >= limits.lufs[0] && loudness.lufs <= limits.lufs[1],
      `${spec.file}: ${loudness.lufs.toFixed(2)} LUFS integrated (want ${limits.lufs.join(" to ")})`,
    );
    report(loudness.truePeak <= limits.truePeak, `${spec.file}: true peak ${loudness.truePeak.toFixed(2)} dBTP (at most ${limits.truePeak})`);
  }
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

const vtt = await readFile(path.join(packageRoot, "out", "captions.en.vtt"), "utf8").catch(() => undefined);
if (vtt === undefined) report(false, 'out/captions.en.vtt: missing; run "npm run captions"');
else {
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
  report(same, `out/captions.en.vtt: ${cues.length} cues, the same as src/timeline.ts`);
  if (!problems.length)
    report(true, `out/captions.en.vtt: ordered, no overlap, within the rules; the last cue ends at ${cues.at(-1).end.toFixed(3)} s (video ${shortest.toFixed(3)} s)`);
}

const mp4 = videos[0].file;
if ((await size(mp4)) !== undefined) {
  const [from, to] = music.finalHitWindow;
  const { samples, sampleRate } = await decodeMono(mp4, { start: from / fps, duration: (to - from) / fps });
  const hit = largestRise(frameLevels(samples, sampleRate, fps, from));
  report(
    Math.abs(hit.frame - music.events.finalHit) <= 1,
    `${mp4}: the final hit measures at frame ${hit.frame} (${(hit.frame / fps).toFixed(3)} s, +${hit.rise.toFixed(1)} dB); the analysis records ${music.events.finalHit}`,
  );
  const chord = hit.frame / fps + (music.track.events.landing - music.track.events.finalHit);
  const offset = music.landingFrame / fps - chord;
  report(
    Math.abs(offset) <= limits.landing,
    `end-card logo locks at frame ${music.landingFrame}, ${offset >= 0 ? "+" : ""}${offset.toFixed(3)} s from the final chord (${chord.toFixed(3)} s; within ±${limits.landing} s)`,
  );
}

if (failures) {
  console.error(`check-output: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log(`check-output: every check passed${webOnly ? " (web files; the 4K master was not checked)" : ""}.`);
