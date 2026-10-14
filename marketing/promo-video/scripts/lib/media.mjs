/**
 * The ffmpeg and ffprobe that ship with Remotion (`npx remotion ffmpeg`,
 * `npx remotion ffprobe`); no system ffmpeg is needed. Remotion's build
 * leaves most filters out, so loudness is measured with whatever EBU R128
 * filter it has, and per-frame levels are computed here from decoded PCM.
 */
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const packageRoot = fileURLToPath(new URL("../..", import.meta.url));

/** Runs `npx remotion <args>`; resolves with stdout and stderr as buffers. */
export function remotion(args) {
  return new Promise((resolve, reject) => {
    execFile(
      "npx",
      ["remotion", ...args],
      { cwd: packageRoot, encoding: "buffer", maxBuffer: 1024 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          error.message += `\n${stderr.toString().slice(-2000)}`;
          reject(error);
        } else resolve({ stdout, stderr });
      },
    );
  });
}

/** Duration, codecs, sizes and frame rates of a media file, as ffprobe JSON. */
export async function probe(file) {
  const { stdout } = await remotion([
    "ffprobe",
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_type,codec_name,width,height,r_frame_rate",
    "-of",
    "json",
    path.resolve(packageRoot, file),
  ]);
  return JSON.parse(stdout.toString());
}

/** The names of the filters the bundled ffmpeg has. */
export async function ffmpegFilters() {
  const { stdout } = await remotion(["ffmpeg", "-hide_banner", "-filters"]);
  const names = new Set();
  for (const line of stdout.toString().split("\n")) {
    const match = /^\s*[.A-Z|]{2,3}\s+(\w+)\s+\S+->\S+/.exec(line);
    if (match) names.add(match[1]);
  }
  return names;
}

/**
 * The integrated loudness (LUFS) of a file's audio, measured per EBU R128
 * with the ebur128 filter, else with loudnorm's analysis; null when the
 * bundled ffmpeg has neither.
 */
export async function measureLoudness(file, filters) {
  const input = path.resolve(packageRoot, file);
  if (filters.has("ebur128")) {
    const { stderr } = await remotion(["ffmpeg", "-hide_banner", "-nostats", "-i", input, "-vn", "-af", "ebur128", "-f", "null", "-"]);
    const summary = stderr.toString().split("Summary:").pop();
    const match = /I:\s+(-?[\d.]+) LUFS/.exec(summary);
    if (match) return { method: "ebur128", lufs: Number(match[1]) };
  }
  if (filters.has("loudnorm")) {
    const { stderr } = await remotion([
      "ffmpeg", "-hide_banner", "-nostats", "-i", input, "-vn", "-af", "loudnorm=print_format=json", "-f", "null", "-",
    ]);
    const match = /"input_i"\s*:\s*"(-?[\d.]+)"/.exec(stderr.toString());
    if (match) return { method: "loudnorm (EBU R128 integrated)", lufs: Number(match[1]) };
  }
  return null;
}

/** Decodes `duration` seconds from `start` as mono 16-bit samples (-1..1). */
export async function decodeMono(file, { start, duration, sampleRate = 48_000 }) {
  const { stdout } = await remotion([
    "ffmpeg", "-hide_banner", "-loglevel", "error",
    "-ss", String(start), "-t", String(duration), "-i", path.resolve(packageRoot, file),
    "-vn", "-ac", "1", "-ar", String(sampleRate), "-c:a", "pcm_s16le", "-f", "wav", "pipe:1",
  ]);
  return { samples: wavSamples(stdout), sampleRate };
}

/** The samples of a 16-bit PCM WAV file, as floats. */
export function wavSamples(buffer) {
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    let size = buffer.readUInt32LE(offset + 4);
    if (id === "data") {
      // Piped WAV output may carry a placeholder size.
      if (size === 0 || size === 0xffffffff || offset + 8 + size > buffer.length)
        size = buffer.length - offset - 8;
      const count = Math.floor(size / 2);
      const samples = new Float32Array(count);
      for (let index = 0; index < count; index += 1)
        samples[index] = buffer.readInt16LE(offset + 8 + index * 2) / 32768;
      return samples;
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error("The decoded audio has no data chunk.");
}

/**
 * The RMS level (dBFS) of each video frame of `samples`, which start at
 * video frame `firstFrame`.
 */
export function frameLevels(samples, sampleRate, fps, firstFrame) {
  const levels = [];
  const perFrame = sampleRate / fps;
  for (let index = 0; (index + 1) * perFrame <= samples.length; index += 1) {
    let sum = 0;
    const from = Math.round(index * perFrame);
    const to = Math.round((index + 1) * perFrame);
    for (let sample = from; sample < to; sample += 1) sum += samples[sample] ** 2;
    const rms = Math.sqrt(sum / (to - from));
    levels.push({ frame: firstFrame + index, db: 20 * Math.log10(Math.max(rms, 1e-9)) });
  }
  return levels;
}

/** The frame whose level rises most over the frame before it. */
export function largestRise(levels) {
  let best;
  for (let index = 1; index < levels.length; index += 1) {
    const rise = levels[index].db - levels[index - 1].db;
    if (!best || rise > best.rise) best = { frame: levels[index].frame, rise };
  }
  if (!best) throw new Error("Too little audio to find a rise.");
  return best;
}
