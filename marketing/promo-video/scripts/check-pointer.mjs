#!/usr/bin/env node
/**
 * The drawn pointer, measured in the rendered 1080p film (owner's feedback
 * after round 9: the cursor did not click where it should and sometimes
 * vanished). Every frame of every product take that shows a click is
 * rendered three times from the composition, losslessly (one bundle, one
 * browser): as the film, without the pointer (`pointerProbe: "none"`) and
 * with it at full opacity wherever it is (`pointerProbe: "solid"`); at 2x as
 * the 4K master is, then brought to 1080p with the web files' own Lanczos
 * filter (`--scale=1`: at 1x, for `npm run render:draft`). In the rendered
 * film frames, and again in the encoded video (the web MP4 by default):
 *
 * - the pointer's opacity on every frame: the film minus the pointer-less
 *   frame, fitted (least squares, both averaged over 5x5 px, the local level
 *   taken out) on the solid pointer minus the same;
 * - at every press (the first frame the footage shows the control
 *   pressed): the pointer's centre, a circle fitted to its ring in the
 *   pixels, and the point the capture clicked, found in the pointer-less
 *   frame by matching the captured picture round that point (footage-2x,
 *   resampled at the shot's magnification) within 14 px of where the
 *   camera puts it. The hotspot must be within 4 px of that point and
 *   inside the target's recorded box on screen.
 *
 * Findings (exit 1): a hotspot more than 4 px from its click or outside its
 * box (render or video); a rendered opacity step above 0.13 between two
 * frames of one take; a pointer on a take's first frame (no cut brings one
 * in); a pointer on a take's last frame that is still travelling or pressed
 * less than 10 frames before; a rendered opacity more than 0.05 from the
 * model's (src/look/pointer.ts); the video's opacity outside 0.5-1.5 times
 * the render's, give or take 0.1 (a pointer the video lost or gained; the web files' own
 * sharpening of the thin ring, 1.2-1.3 times over a dark button, and the
 * encoder's noise are measured and reported, not judged frame to frame).
 *
 * Writes out/review/pointer.tsv (the clicks), out/review/pointer-opacity.tsv
 * (every frame), and with --strips=<dir>, for every click the video's
 * frames from 14 before its press to 20 after (every 2nd) and every
 * appearance and disappearance, cropped 2x round the pointer, with a
 * labelled contact sheet per take. --keep-refs reuses the rendered frames
 * in out/pointer-check/<scale>x/.
 *
 *   node scripts/check-pointer.mjs [video] [--scale=1|2] [--strips=<dir>] [--keep-refs]
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { bundle } from "@remotion/bundler";
import { openBrowser, renderFrames, selectComposition } from "@remotion/renderer";
import { chromium } from "playwright-core";
import { tsImport } from "tsx/esm/api";
import { packageRoot, remotion } from "./lib/media.mjs";
import { decodePng, encodePng } from "./lib/png.mjs";
import { decodeRgb } from "./lib/rgb.mjs";

const { timeline } = await tsImport("../src/timeline.ts", import.meta.url);
const { looks } = await tsImport("../src/shots.ts", import.meta.url);
const { takeView } = await tsImport("../src/takes.ts", import.meta.url);
const { project } = await tsImport("../src/look/camera.ts", import.meta.url);
const { focusAmount, LIFT_SCALE, liftOn } = await tsImport("../src/look/dof.ts", import.meta.url);
const { takePointer } = await tsImport("../src/look/pointer.ts", import.meta.url);
const { clipFrameAt } = await tsImport("../src/footage.ts", import.meta.url);
const { music } = await tsImport("../src/music.ts", import.meta.url);

const args = process.argv.slice(2);
const video = args.find((a) => !a.startsWith("--")) ?? "out/bell-pr-promo-en-1080p.mp4";
const strips = args.find((a) => a.startsWith("--strips="))?.slice(9);
const keepRefs = args.includes("--keep-refs");
/** The references' render scale: 2 as the 4K master (then Lanczos to 1080p, as the web files), 1 for a 1x render. */
const scale = Number(args.find((a) => a.startsWith("--scale="))?.slice(8) ?? 2);
const W = 1920;
const H = 1080;
/**
 * `gain`: the video must show the pointer at 0.5-1.5 times the render's opacity, give or take `floor` (the encoder's
 * noise measures 0.02-0.06 where no pointer is drawn). The web files
 * are the 4K master (rendered whole, its frames JPEG, then H.264) brought down with Lanczos and encoded again, which
 * renders the pointer's thin ring half a 4K pixel apart and sharpens it: over a dark button the video measures 1.2-1.3
 * times the lossless render's pointer, over white about 0.9 (round 10). A pointer the video lost or gained (a pop)
 * falls far outside.
 */
const LIMITS = { error: 4, step: 0.13, afterPress: 10, model: 0.05, gain: [0.5, 1.5], floor: 0.1, shown: 0.03 };
const refs = path.join(packageRoot, "out", "pointer-check", `${scale}x`);
const out = path.join(packageRoot, "out", "review");

// The takes that show a click, with their pointers ----------------------------------------------------------------

const footage = (state, file) => JSON.parse(readFileSync(path.join(packageRoot, "public", "footage", state, file), "utf8"));
const takes = [];
for (const shot of timeline.shots)
  for (const take of shot.takes) {
    const look = looks[shot.id]?.[take.id];
    if (!look || look.still !== undefined || look.pointer === false) continue;
    const targets = footage(look.state, "targets.json");
    const pointer = takePointer(look, take.to - take.from, targets);
    if (!pointer.clicks.length) continue;
    takes.push({ shot, take, look, pointer, frames: footage(look.state, "frames.json").frames, name: `${shot.id}/${take.id}` });
  }

/** How far the click's lifted component is forward at frame f (src/scenes/ProductShot.tsx draws it so). */
const liftScale = (look, lift, f) => {
  if (lift === undefined) return 1;
  const on = liftOn(look.lifts[lift], f) * focusAmount(look.focus ?? [{ at: 0, amount: 1 }], f / music.beatFrames);
  return on > 0.001 ? 1 + (LIFT_SCALE - 1) * on : 1;
};

// The reference frames ----------------------------------------------------------------------------------------------

const pad = (frame) => String(frame).padStart(4, "0");
const refFile = (probe, frame) => path.join(refs, probe, `${pad(frame)}.png`);
if (!keepRefs || !takes.every(({ take }) => ["film", "none", "solid"].every((probe) => existsSync(refFile(probe, take.to - 1))))) {
  await rm(refs, { recursive: true, force: true });
  const serveUrl = await bundle({ entryPoint: path.join(packageRoot, "src", "index.ts"), publicDir: path.join(packageRoot, "public"), symlinkPublicDir: true });
  const browser = await openBrowser("chrome", { browserExecutable: process.env.REMOTION_BROWSER_EXECUTABLE || null });
  try {
    for (const probe of ["film", "none", "solid"]) {
      const inputProps = probe === "film" ? {} : { pointerProbe: probe };
      const composition = await selectComposition({ serveUrl, id: "Promo", inputProps, puppeteerInstance: browser });
      const dir = path.join(refs, probe);
      // At 2x the frames are rendered as the 4K master is, then brought to 1080p as the web files are.
      const raw = scale === 1 ? dir : path.join(refs, `${probe}-raw`);
      await mkdir(dir, { recursive: true });
      await mkdir(raw, { recursive: true });
      for (const { take, name } of takes) {
        await renderFrames({
          serveUrl,
          composition,
          inputProps,
          outputDir: raw,
          imageSequencePattern: "[frame].[ext]",
          imageFormat: "png",
          frameRange: [take.from, take.to - 1],
          scale,
          concurrency: 4,
          puppeteerInstance: browser,
          onStart: () => undefined,
          onFrameUpdate: () => undefined,
        });
        // Remotion pads the frame numbers to the range's last frame (723.png in 723-866): pad them all to four digits.
        for (let frame = take.from; frame < take.to; frame += 1) {
          const short = path.join(raw, `${frame}.png`);
          if (existsSync(short) && short !== path.join(raw, `${pad(frame)}.png`)) await rename(short, path.join(raw, `${pad(frame)}.png`));
        }
        if (scale !== 1) {
          await remotion([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-start_number", String(take.from), "-i", path.join(raw, "%04d.png"),
            "-frames:v", String(take.to - take.from), "-vf", "scale=1920:1080:flags=lanczos+accurate_rnd+full_chroma_int", "-start_number", String(take.from),
            path.join(dir, "%04d.png"),
          ]);
          await rm(raw, { recursive: true, force: true });
          await mkdir(raw, { recursive: true });
        }
        console.log(`pointer: rendered ${name} ${take.from}-${take.to - 1} (${probe}, ${scale}x)`);
      }
      if (scale !== 1) await rm(raw, { recursive: true, force: true });
    }
  } finally {
    await browser.close({ silent: true });
  }
}

// Pixels ------------------------------------------------------------------------------------------------------------

/** Luma (Rec. 709 weights on the encoded values) of an RGB buffer. */
const luma = (rgb) => {
  const y = new Float32Array(rgb.length / 3);
  for (let i = 0, j = 0; j < y.length; i += 3, j += 1) y[j] = 0.2126 * rgb[i] + 0.7152 * rgb[i + 1] + 0.0722 * rgb[i + 2];
  return y;
};

/**
 * The video's frames a..b (inclusive), decoded with the bundled ffmpeg: as RGB (BT.709, limited range), or with
 * `luma` as the luma plane itself, brought to full range and not clipped (the web files' Lanczos step overshoots
 * past white on a sharp edge, and an RGB decode would clip it).
 */
function decodeRange(file, a, b, { luma: lumaOnly = false } = {}) {
  return new Promise((resolve, reject) => {
    const size = lumaOnly ? (W * H * 3) / 2 : W * H * 3;
    const format = lumaOnly ? ["-pix_fmt", "yuv420p"] : ["-vf", "scale=in_color_matrix=bt709:in_range=tv:out_range=pc,format=rgb24"];
    const child = spawn("npx", ["remotion", "ffmpeg", "-hide_banner", "-loglevel", "error", "-ss", (a / 30 - 0.001).toFixed(4), "-i", path.resolve(packageRoot, file),
      "-frames:v", String(b - a + 1), ...format, "-f", "image2pipe", "-c:v", "rawvideo", "pipe:1"], { cwd: packageRoot });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exited ${code}`));
      const all = Buffer.concat(chunks);
      if (all.length !== size * (b - a + 1)) return reject(new Error(`decoded ${all.length / size} frames of ${file} for ${a}-${b}`));
      resolve(
        Array.from({ length: b - a + 1 }, (_, i) => {
          const frame = all.subarray(i * size, (i + 1) * size);
          if (!lumaOnly) return frame;
          const y = new Float32Array(W * H);
          for (let k = 0; k < y.length; k += 1) y[k] = ((frame[k] - 16) * 255) / 219;
          return y;
        }),
      );
    });
  });
}

/** A weighted circle fit (Kasa) through the pixels where |d| is large: the ring's centre, in pixel-centre coordinates. */
function circleCentre(d, box) {
  let peak = 0;
  for (let y = box[1]; y <= box[3]; y += 1) for (let x = box[0]; x <= box[2]; x += 1) peak = Math.max(peak, Math.abs(d[y * W + x]));
  if (peak < 8) return undefined;
  // Normal equations of  min sum w (x^2 + y^2 + D x + E y + F)^2.
  const m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const v = [0, 0, 0];
  let n = 0;
  for (let y = box[1]; y <= box[3]; y += 1)
    for (let x = box[0]; x <= box[2]; x += 1) {
      const w = Math.abs(d[y * W + x]);
      if (w < 0.35 * peak) continue;
      const X = x + 0.5;
      const Y = y + 0.5;
      const r = [X, Y, 1];
      const z = -(X * X + Y * Y);
      for (let i = 0; i < 3; i += 1) {
        v[i] += w * r[i] * z;
        for (let j = 0; j < 3; j += 1) m[i * 3 + j] += w * r[i] * r[j];
      }
      n += 1;
    }
  if (n < 12) return undefined;
  const det = (a) => a[0] * (a[4] * a[8] - a[5] * a[7]) - a[1] * (a[3] * a[8] - a[5] * a[6]) + a[2] * (a[3] * a[7] - a[4] * a[6]);
  const D = det(m);
  if (Math.abs(D) < 1e-9) return undefined;
  const solve = (k) => det(m.map((value, i) => (i % 3 === k ? v[Math.floor(i / 3)] : value))) / D;
  const [Dx, Ey, F] = [solve(0), solve(1), solve(2)];
  const x = -Dx / 2;
  const y = -Ey / 2;
  return { x, y, r: Math.sqrt(Math.max(0, x * x + y * y - F)) };
}

/** Bilinear sample of a grey picture (pixel-centre coordinates). */
const sample = (grey, width, height, x, y) => {
  const fx = Math.min(width - 1.001, Math.max(0, x - 0.5));
  const fy = Math.min(height - 1.001, Math.max(0, y - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const ax = fx - x0;
  const ay = fy - y0;
  const i = y0 * width + x0;
  return (grey[i] * (1 - ax) + grey[i + 1] * ax) * (1 - ay) + (grey[i + width] * (1 - ax) + grey[i + width + 1] * ax) * ay;
};

/**
 * Where capture point (cx, cy) shows in a rendered frame: the captured picture round it (a 100x44 px window on
 * screen, resampled from footage-2x at `m` screen px per capture px) matched (normalised cross-correlation) against
 * the frame within 14 px of `guess`; sub-pixel by a parabola through the peak.
 */
function locate(frameGrey, picture, cx, cy, m, guess) {
  const HW = 50;
  const HH = 22;
  const template = [];
  for (let v = -HH; v <= HH; v += 1)
    for (let u = -HW; u <= HW; u += 1) template.push(sample(picture.grey, picture.width, picture.height, 2 * (cx + u / m), 2 * (cy + v / m)));
  const mean = template.reduce((a, b) => a + b, 0) / template.length;
  const t = template.map((value) => value - mean);
  const tNorm = Math.sqrt(t.reduce((a, b) => a + b * b, 0));
  const R = 14;
  const score = new Map();
  let best = { s: -2, dx: 0, dy: 0 };
  for (let dy = -R; dy <= R; dy += 1)
    for (let dx = -R; dx <= R; dx += 1) {
      const values = [];
      for (let v = -HH; v <= HH; v += 1)
        for (let u = -HW; u <= HW; u += 1) values.push(sample(frameGrey, W, H, guess.x + dx + u, guess.y + dy + v));
      const fm = values.reduce((a, b) => a + b, 0) / values.length;
      let dot = 0;
      let norm = 0;
      values.forEach((value, i) => {
        dot += (value - fm) * t[i];
        norm += (value - fm) ** 2;
      });
      const s = dot / Math.max(1e-9, Math.sqrt(norm) * tNorm);
      score.set(`${dx},${dy}`, s);
      if (s > best.s) best = { s, dx, dy };
    }
  const at = (dx, dy) => score.get(`${dx},${dy}`) ?? best.s;
  const vertex = (a, b, c) => (a - 2 * b + c === 0 ? 0 : (0.5 * (a - c)) / (a - 2 * b + c));
  const sx = vertex(at(best.dx - 1, best.dy), best.s, at(best.dx + 1, best.dy));
  const sy = vertex(at(best.dx, best.dy - 1), best.s, at(best.dx, best.dy + 1));
  return { x: guess.x + best.dx + sx, y: guess.y + best.dy + sy, score: best.s, edge: Math.abs(best.dx) === R || Math.abs(best.dy) === R };
}

const pictures = new Map();
async function footageGrey(state, file) {
  const key = `${state}/${file}`;
  if (!pictures.has(key)) {
    const { data } = await decodeRgb(path.join(packageRoot, "public", "footage-2x", state, file), { width: 2880, height: 1620 });
    pictures.set(key, { grey: luma(data), width: 2880, height: 1620 });
  }
  return pictures.get(key);
}

// Measuring -----------------------------------------------------------------------------------------------------------

/**
 * The pointer in one frame (luma `film`) against the frame without it (`none`) and with it at full opacity
 * (`solid`), in the pointer's box: its opacity, a least-squares fit of the film's difference on the solid one's (both
 * averaged over 5x5 px, after the local level is taken out), and from half opacity on, its ring's centre.
 */
function measure(film, none, solid, box) {
  if (box[2] < 0) return { opacity: 0 };
  // The local level (the web files are the 4K master downscaled, the references 1x renders): the median difference
  // in a band 8-24 px round the pointer, outside it.
  const outer = [Math.max(0, box[0] - 24), Math.max(0, box[1] - 24), Math.min(W - 1, box[2] + 24), Math.min(H - 1, box[3] + 24)];
  const band = [];
  for (let y = outer[1]; y <= outer[3]; y += 1)
    for (let x = outer[0]; x <= outer[2]; x += 1)
      if (x < box[0] - 8 || x > box[2] + 8 || y < box[1] - 8 || y > box[3] + 8) band.push(film[y * W + x] - none[y * W + x]);
  band.sort((a, b) => a - b);
  const level = band.length ? band[band.length >> 1] : 0;
  const d = new Float32Array(W * H);
  const full = new Float32Array(W * H);
  for (let y = outer[1]; y <= outer[3]; y += 1)
    for (let x = outer[0]; x <= outer[2]; x += 1) {
      const i = y * W + x;
      full[i] = solid[i] - none[i];
      d[i] = film[i] - none[i] - level;
    }
  // Averaged over 5x5 px: a video encoder softens the pointer's thin ring and keeps what it spreads round it.
  const box5 = (a, x, y) => {
    let sum = 0;
    for (let v = -2; v <= 2; v += 1) for (let u = -2; u <= 2; u += 1) sum += a[(y + v) * W + x + u];
    return sum / 25;
  };
  let dot = 0;
  let norm = 0;
  for (let y = Math.max(2, box[1] - 4); y <= Math.min(H - 3, box[3] + 4); y += 1)
    for (let x = Math.max(2, box[0] - 4); x <= Math.min(W - 3, box[2] + 4); x += 1) {
      const a = box5(d, x, y);
      const b = box5(full, x, y);
      dot += a * b;
      norm += b * b;
    }
  const opacity = norm > 0 ? dot / norm : 0;
  return { opacity, centre: opacity >= 0.5 ? circleCentre(d, box) : undefined };
}

const findings = [];
const clickRows = [
  ["frame", "take", "target", "hotspot_x", "hotspot_y", "click_x", "click_y", "error_px", "error_px_video", "inside_box", "visible_before", "visible_after", "ends", "match"].join("\t"),
];
const opacityRows = [["frame", "take", "opacity", "opacity_video", "model", "step", "step_video", "x", "y"].join("\t")];
const table = [];
const measured = new Map();
const worst = { step: 0, stepVideo: 0, model: 0, codec: 0 };
/** The video's opacity over the render's where the render shows the pointer whole. */
const gains = [];

for (const entry of takes) {
  const { take, look, pointer, name } = entry;
  const videoFrames = await decodeRange(video, take.from, take.to - 1, { luma: true });
  const series = [];
  for (let f = 0; f < videoFrames.length; f += 1) {
    const frame = take.from + f;
    const none = luma(decodePng(await readFile(refFile("none", frame))).data);
    const solid = luma(decodePng(await readFile(refFile("solid", frame))).data);
    const film = luma(decodePng(await readFile(refFile("film", frame))).data);
    // The pointer's pixels: where the solid pointer changes the picture.
    let box = [W, H, -1, -1];
    for (let i = 0; i < none.length; i += 1)
      if (Math.abs(solid[i] - none[i]) > 6) {
        const x = i % W;
        const y = (i - x) / W;
        box = [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)];
      }
    const rendered = measure(film, none, solid, box);
    const encoded = measure(videoFrames[f], none, solid, box);
    const model = pointer.at(f)?.opacity ?? 0;
    series.push({ frame, opacity: rendered.opacity, video: encoded.opacity, model, centre: rendered.centre, videoCentre: encoded.centre });
    const step = f > 0 ? rendered.opacity - series[f - 1].opacity : 0;
    const stepVideo = f > 0 ? encoded.opacity - series[f - 1].video : 0;
    worst.step = Math.max(worst.step, Math.abs(step));
    worst.stepVideo = Math.max(worst.stepVideo, Math.abs(stepVideo));
    worst.model = Math.max(worst.model, Math.abs(rendered.opacity - model));
    worst.codec = Math.max(worst.codec, Math.abs(encoded.opacity - rendered.opacity));
    opacityRows.push(
      [frame, name, rendered.opacity.toFixed(3), encoded.opacity.toFixed(3), model.toFixed(3), step.toFixed(3), stepVideo.toFixed(3), rendered.centre?.x.toFixed(1) ?? "", rendered.centre?.y.toFixed(1) ?? ""].join("\t"),
    );
    if (Math.abs(step) > LIMITS.step) findings.push(`${name} frame ${frame}: the pointer's opacity steps ${step.toFixed(2)} in one frame`);
    if (Math.abs(rendered.opacity - model) > LIMITS.model) findings.push(`${name} frame ${frame}: measured opacity ${rendered.opacity.toFixed(2)}, the model's ${model.toFixed(2)}`);
    if (encoded.opacity < LIMITS.gain[0] * rendered.opacity - LIMITS.floor || encoded.opacity > LIMITS.gain[1] * rendered.opacity + LIMITS.floor)
      findings.push(`${name} frame ${frame}: the video shows the pointer at ${encoded.opacity.toFixed(2)}, the render at ${rendered.opacity.toFixed(2)}`);
    if (rendered.opacity >= 0.9) gains.push(encoded.opacity / rendered.opacity);
  }
  measured.set(name, series);
  const first = series[0];
  const last = series.at(-1);
  if (first.opacity > LIMITS.shown) findings.push(`${name}: the pointer shows on the take's first frame ${first.frame} (${first.opacity.toFixed(2)})`);
  const lastPress = pointer.clicks.at(-1).pressFrame;
  const lastState = pointer.at(take.to - take.from - 1);
  if (last.opacity > LIMITS.shown && (take.to - take.from - lastPress < LIMITS.afterPress || lastState?.moving))
    findings.push(`${name}: the pointer ends with the cut ${take.to - take.from - lastPress} frames after its press${lastState?.moving ? ", travelling" : ""}`);

  for (const click of pointer.clicks) {
    const f = click.pressFrame;
    const frame = take.from + f;
    const at = series[f];
    const view = takeView(look, f);
    const s = liftScale(look, click.lift, click.f);
    const state = pointer.at(f);
    // Where the camera puts the click (the guess the match starts from), and the click found in the pixels.
    const guess = project(view, state.x, state.y);
    const t = Math.min(look.clipTo ?? Infinity, (look.clipFrom ?? 0) + (f / 30) * (look.rate ?? 1));
    const picture = await footageGrey(look.state, clipFrameAt(entry.frames, t).file);
    const none = luma(decodePng(await readFile(refFile("none", frame))).data);
    const found = locate(none, picture, click.x, click.y, view.m * s, guess);
    const errorOf = (centre) => (centre ? Math.hypot(centre.x - found.x, centre.y - found.y) : Infinity);
    const insideOf = (centre) => {
      const b = click.box;
      if (!centre || !b) return false;
      const k = view.m * s;
      return (
        centre.x >= found.x + (b.x - click.x) * k &&
        centre.x <= found.x + (b.x + b.width - click.x) * k &&
        centre.y >= found.y + (b.y - click.y) * k &&
        centre.y <= found.y + (b.y + b.height - click.y) * k
      );
    };
    const hotspot = at.centre;
    const error = errorOf(hotspot);
    const errorVideo = errorOf(at.videoCentre);
    const inside = insideOf(hotspot) && insideOf(at.videoCentre);
    let before = 0;
    for (let k = f - 1; k >= 0 && series[k].opacity > LIMITS.shown; k -= 1) before += 1;
    let after = 0;
    for (let k = f; k < series.length && series[k].opacity > LIMITS.shown; k += 1) after += 1;
    const ends = f + after >= series.length ? "with the cut" : "faded";
    table.push({ frame, name, target: click.target, hotspot, found, error, errorVideo, inside, before, after, ends, score: found.score });
    clickRows.push(
      [frame, name, click.target, hotspot?.x.toFixed(2) ?? "", hotspot?.y.toFixed(2) ?? "", found.x.toFixed(2), found.y.toFixed(2), error.toFixed(2), errorVideo.toFixed(2), inside ? "yes" : "NO", before, after, ends, found.score.toFixed(3)].join("\t"),
    );
    if (!(Math.max(error, errorVideo) <= LIMITS.error)) findings.push(`${name} ${click.target} (frame ${frame}): the hotspot is ${error.toFixed(1)} px (video ${errorVideo.toFixed(1)} px) from the click`);
    if (!inside) findings.push(`${name} ${click.target} (frame ${frame}): the hotspot is outside the target's box`);
    if (found.score < 0.9 || found.edge) findings.push(`${name} ${click.target} (frame ${frame}): the click point was not found in the frame (match ${found.score.toFixed(2)})`);
  }
  console.log(`pointer: ${name}: ${pointer.clicks.length} click(s) measured`);
}

await mkdir(out, { recursive: true });
await writeFile(path.join(out, "pointer.tsv"), `${clickRows.join("\n")}\n`);
await writeFile(path.join(out, "pointer-opacity.tsv"), `${opacityRows.join("\n")}\n`);
console.log("frame\ttake\ttarget\terror px (render, video)\tinside\tbefore\tafter\tends");
for (const row of table)
  console.log(`${row.frame}\t${row.name}\t${row.target}\t${row.error.toFixed(2)}, ${row.errorVideo.toFixed(2)}\t${row.inside ? "yes" : "NO"}\t${row.before}\t${row.after}\t${row.ends}`);
gains.sort((a, b) => a - b);
console.log(
  `pointer: largest opacity step ${worst.step.toFixed(3)} (render), ${worst.stepVideo.toFixed(3)} (video); largest gap to the model ${worst.model.toFixed(3)}; ` +
    `video over render where the pointer is whole: ${gains[0]?.toFixed(2)}-${gains.at(-1)?.toFixed(2)} (median ${gains[gains.length >> 1]?.toFixed(2)})`,
);

// The strips -----------------------------------------------------------------------------------------------------------

if (strips) {
  const root = path.resolve(strips);
  await mkdir(root, { recursive: true });
  /** A 240x135 crop round (x, y) of an RGB frame, doubled (each pixel 2x2), as a PNG. */
  const crop2x = (rgb, x, y) => {
    const x0 = Math.round(Math.min(W - 240, Math.max(0, x - 120)));
    const y0 = Math.round(Math.min(H - 135, Math.max(0, y - 67)));
    const outRgb = Buffer.alloc(480 * 270 * 3);
    for (let v = 0; v < 270; v += 1)
      for (let u = 0; u < 480; u += 1) {
        const i = ((y0 + (v >> 1)) * W + x0 + (u >> 1)) * 3;
        const o = (v * 480 + u) * 3;
        outRgb[o] = rgb[i];
        outRgb[o + 1] = rgb[i + 1];
        outRgb[o + 2] = rgb[i + 2];
      }
    return { png: encodePng(480, 270, outRgb), x0, y0 };
  };
  const index = ["file\tframe\ttake\tgroup\toffset\topacity"];
  const sheets = [];
  for (const entry of takes) {
    const { take, pointer, name } = entry;
    const series = measured.get(name);
    const dir = path.join(root, name.replace("/", "-"));
    await mkdir(dir, { recursive: true });
    const groups = [];
    const opacityAt = (frame) => {
      const s = series[frame - take.from];
      return s ? s.opacity : undefined;
    };
    const centreOf = (f) => {
      const state = pointer.at(Math.max(0, Math.min(take.to - take.from - 1, f)), true);
      return project(takeView(entry.look, Math.max(0, Math.min(take.to - take.from - 1, f))), state.x, state.y);
    };
    for (const run of pointer.runs) {
      const appear = series.findIndex((s, i) => i >= Math.floor(run.appear) && s.opacity > LIMITS.shown);
      let gone = appear;
      while (gone + 1 < series.length && series[gone + 1].opacity > LIMITS.shown) gone += 1;
      groups.push({ title: `appears (${take.from + appear})`, frames: [-4, -2, 0, 2, 4, 6, 8, 10, 12, 14, 16, 18].map((k) => take.from + appear + k), centre: centreOf(appear), base: take.from + appear });
      for (const click of run.clicks) {
        const row = table.find((r) => r.name === name && r.frame === take.from + click.pressFrame);
        groups.push({
          title: `${click.target}: press ${take.from + click.pressFrame}, ${row.error.toFixed(2)} px from the click, ${row.inside ? "inside" : "OUTSIDE"} its box`,
          frames: Array.from({ length: 18 }, (_, i) => take.from + click.pressFrame - 14 + 2 * i),
          centre: row.found,
          base: take.from + click.pressFrame,
          press: row,
        });
      }
      groups.push({ title: gone === series.length - 1 ? `ends with the cut (${take.to - 1})` : `disappears (${take.from + gone})`, frames: [-14, -12, -10, -8, -6, -4, -2, 0, 2, 4, 6, 8].map((k) => take.from + gone + k), centre: centreOf(gone), base: take.from + gone });
    }
    const wanted = [...new Set(groups.flatMap((g) => g.frames))].sort((a, b) => a - b);
    const lo = wanted[0];
    const hi = wanted.at(-1);
    const decoded = await decodeRange(video, lo, hi);
    const tiles = [];
    for (const group of groups) {
      const row = [];
      for (const frame of group.frames) {
        const { png, x0, y0 } = crop2x(decoded[frame - lo], group.centre.x, group.centre.y);
        const file = path.join(dir, `${String(frame).padStart(4, "0")}-${group.base}.png`);
        await writeFile(file, png);
        const opacity = opacityAt(frame);
        const offset = frame - group.base;
        const label = `${frame} (${offset >= 0 ? "+" : ""}${offset})${opacity === undefined ? " · other take" : ` · ${opacity.toFixed(2)}`}`;
        index.push([path.relative(root, file), frame, name, group.title, offset, opacity?.toFixed(3) ?? ""].join("\t"));
        const mark = group.press && frame === group.base ? { x: (group.press.found.x - x0) * 2, y: (group.press.found.y - y0) * 2 } : undefined;
        row.push({ file, label, mark });
      }
      tiles.push({ title: group.title, row });
    }
    const html = `<!doctype html><meta charset="utf-8"><style>
      body { margin: 0; background: #16201b; font: 600 15px sans-serif; color: #e9efe9; }
      h1 { font-size: 20px; margin: 12px 12px 4px; } h2 { font-size: 16px; margin: 12px 12px 4px; color: #a8d5bf; }
      .row { display: grid; grid-template-columns: repeat(6, 480px); gap: 6px; padding: 0 12px; }
      figure { margin: 0; position: relative; } img { display: block; width: 480px; height: 270px; }
      figcaption { padding: 2px 0 4px; font-size: 13px; }
      .mark { position: absolute; width: 0; height: 0; }
      .mark i { position: absolute; background: #ff2fd0; }
      .mark i:nth-child(1) { left: -44px; top: -1px; width: 16px; height: 2px; } .mark i:nth-child(2) { left: 28px; top: -1px; width: 16px; height: 2px; }
      .mark i:nth-child(3) { top: -44px; left: -1px; width: 2px; height: 16px; } .mark i:nth-child(4) { top: 28px; left: -1px; width: 2px; height: 16px; }
    </style><h1>${name}: frames ${take.from}-${take.to - 1} (${path.basename(video)}, crops 2x; labels: frame, offset from the press or the appearance or the end, the pointer's opacity measured in the lossless render; magenta ticks: the click point found in the footage)</h1>${tiles
      .map(
        (group) =>
          `<h2>${group.title}</h2><div class="row">${group.row
            .map(
              (tile) =>
                `<figure><img src="${pathToFileURL(tile.file)}">${tile.mark ? `<div class="mark" style="left:${tile.mark.x}px;top:${tile.mark.y}px"><i></i><i></i><i></i><i></i></div>` : ""}<figcaption>${tile.label}</figcaption></figure>`,
            )
            .join("")}</div>`,
      )
      .join("")}`;
    const page = path.join(dir, "sheet.html");
    await writeFile(page, html);
    sheets.push({ page, png: path.join(root, `${name.replace("/", "-")}-sheet.png`) });
  }
  await writeFile(path.join(root, "index.tsv"), `${index.join("\n")}\n`);
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || process.env.REMOTION_BROWSER_EXECUTABLE });
  try {
    for (const sheet of sheets) {
      const tab = await browser.newPage({ viewport: { width: 6 * 486 + 24, height: 400 } });
      await tab.goto(pathToFileURL(sheet.page).href);
      await tab.waitForLoadState("load");
      await tab.screenshot({ path: sheet.png, fullPage: true });
      await tab.close();
      await rm(sheet.page);
    }
  } finally {
    await browser.close();
  }
  console.log(`pointer: strips and ${sheets.length} contact sheets in ${root}`);
}

for (const finding of findings) console.error(`pointer: ${finding}`);
if (findings.length) {
  console.error(`pointer: ${findings.length} finding(s)`);
  process.exitCode = 1;
} else console.log(`pointer: ${table.length} clicks on target, no pop (out/review/pointer.tsv, out/review/pointer-opacity.tsv)`);
