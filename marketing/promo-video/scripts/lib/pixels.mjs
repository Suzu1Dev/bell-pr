/**
 * Grey pixels of captured pictures, decoded with the bundled ffmpeg in one
 * run (a concat list), at the capture's CSS size (1440x810, one byte per
 * capture px). For checks against the footage: scripts/check-dof.mjs and
 * scripts/pointer-spots.mjs.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { packageRoot } from "./media.mjs";

export const W = 1440;
export const H = 810;

/** Decodes the listed pictures to 1440x810 grey, in order. */
export async function decodeGrey(files) {
  if (!files.length) return [];
  const dir = await mkdtemp(path.join(process.env.TMPDIR || tmpdir(), "promo-pixels-"));
  try {
    const list = path.join(dir, "list.txt");
    await writeFile(list, `ffconcat version 1.0\n${files.map((file) => `file '${file}'`).join("\n")}\n`);
    const chunks = [];
    await new Promise((resolve, reject) => {
      const child = spawn(
        "npx",
        ["remotion", "ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list,
          "-vf", `scale=${W}:${H}:flags=area,format=gray`, "-f", "image2pipe", "-c:v", "rawvideo", "pipe:1"],
        { cwd: packageRoot },
      );
      child.stdout.on("data", (chunk) => chunks.push(chunk));
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
    });
    const all = Buffer.concat(chunks);
    if (all.length !== files.length * W * H) throw new Error(`decoded ${all.length} bytes for ${files.length} pictures`);
    return files.map((_, i) => all.subarray(i * W * H, (i + 1) * W * H));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
