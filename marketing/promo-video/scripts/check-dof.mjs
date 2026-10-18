#!/usr/bin/env node
/**
 * Checks every product take's sharp plane against the captured footage
 * (no render needed), on the frames where the plane has settled:
 *
 * - feathers: no line of text, icon or other ink lies in a feather (the
 *   ramp between the sharp and the soft plane, where the planes' union is
 *   neither sharp nor soft), where it would come out half sharp; every
 *   feather must sit in a gutter of the UI;
 * - cut lines: no line of ink in the sharp core runs across a frame edge,
 *   or across the window's own bottom or right edge on screen, where it
 *   would be cut in half while sharp.
 *
 * Ink is a capture pixel darker than 160 (UI text, icons and code; card
 * borders and tints are lighter) in a 1440x810 grey copy of the frame the
 * take shows (public/footage-2x/). Exits 1 on a finding; `npm run review`
 * runs it too.
 *
 *   node scripts/check-dof.mjs [shot/take ...]
 */
import path from "node:path";
import { tsImport } from "tsx/esm/api";
import { packageRoot } from "./lib/media.mjs";
import { decodeGrey as decode, H, W } from "./lib/pixels.mjs";

const { timeline } = await tsImport("../src/timeline.ts", import.meta.url);
const { music } = await tsImport("../src/music.ts", import.meta.url);
const { looks } = await tsImport("../src/shots.ts", import.meta.url);
const { takeView } = await tsImport("../src/takes.ts", import.meta.url);
const { project } = await tsImport("../src/look/camera.ts", import.meta.url);
const { planesOf, sharpnessOf, sharpPlane } = await tsImport("../src/look/dof.ts", import.meta.url);

const INK = 160;
/** Ink pixels allowed in a feather or across an edge (anti-aliasing specks, a caret). */
const ALLOWED = 6;

const onScreen = (p) => p.x >= 0 && p.x < 1920 && p.y >= 0 && p.y < 1080;

/** The picture a take shows at its frame f (path under public/footage-2x/). */
function pictureAt(look, f, frames) {
  if (look.still) return path.join(packageRoot, "public", "footage-2x", look.state, `${look.still}.jpg`);
  const t = Math.min(look.clipTo ?? Infinity, (look.clipFrom ?? 0) + (f / 30) * (look.rate ?? 1));
  const index = Math.min(frames.length - 1, Math.max(0, Math.floor(t * 30 + 1e-6)));
  return path.join(packageRoot, "public", "footage-2x", look.state, frames[index].file);
}

/** The settled frames of a take to check: every 6th, and the last, where the sharp plane is not racking. */
function settledFrames(look, length) {
  const out = [];
  const same = (a, b) => ["x0", "y0", "x1", "y1"].every((k) => Math.abs(a[k] - b[k]) < 0.05);
  for (let f = 0; f < length; f += 6) out.push(f);
  out.push(length - 1);
  return [...new Set(out)].filter((f) => {
    const beats = (g) => g / music.beatFrames;
    const a = planesOf(look.dof.mask(1, beats(Math.max(0, f - 1)))).map(sharpPlane);
    const b = planesOf(look.dof.mask(1, beats(f))).map(sharpPlane);
    return a.length === b.length && a.every((plane, i) => same(plane, b[i]));
  });
}

/** Checks one picture under one view and its sharp planes; returns the problems found. */
function checkFrame(pixels, view, planes) {
  const problems = [];
  const ink = (x, y) => pixels[y * W + x] < INK;
  const visible = (x, y) => onScreen(project(view, x, y));
  const sharp = (x, y) => sharpnessOf(planes, x, y);
  // The region the planes and their feathers cover.
  const xa = Math.max(0, Math.floor(Math.min(...planes.map((p) => p.x0 - p.fl))));
  const xb = Math.min(W, Math.ceil(Math.max(...planes.map((p) => p.x1 + p.fr))));
  const ya = Math.max(0, Math.floor(Math.min(...planes.map((p) => p.y0 - p.ft))));
  const yb = Math.min(H, Math.ceil(Math.max(...planes.map((p) => p.y1 + p.fb))));
  // Feathers: ink in the ramp between the planes (sharpness strictly between 0 and 1). A row counts only with more
  // than four ink pixels in its ramp, so a thin vertical rule or a card's bar fading out of focus is not a finding.
  let count = 0;
  const where = [];
  for (let y = ya; y < yb; y += 1) {
    const row = [];
    for (let x = xa; x < xb; x += 1) {
      if (!ink(x, y)) continue;
      const s = sharp(x + 0.5, y + 0.5);
      if (s > 0.02 && s < 0.98) row.push(x);
    }
    if (row.length <= 4) continue;
    const seen = row.filter((x) => visible(x, y));
    if (seen.length <= 4) continue;
    count += seen.length;
    where.push([y, seen[0], seen.at(-1)]);
  }
  if (count > ALLOWED) {
    const ys = where.map((w) => w[0]);
    problems.push(`ink in a feather (${count} px, capture y ${Math.min(...ys)}-${Math.max(...ys)}, x ${Math.min(...where.map((w) => w[1]))}-${Math.max(...where.map((w) => w[2]))})`);
  }
  // Cut lines: lines of ink in the sharp core that cross a frame edge, or reach the window's bottom or right edge on screen.
  const rows = [];
  let open;
  for (let y = ya; y <= yb; y += 1) {
    let n = 0;
    let left = Infinity;
    let right = -Infinity;
    if (y < yb)
      for (let x = xa; x < xb; x += 1)
        if (ink(x, y) && sharp(x + 0.5, y + 0.5) >= 0.98) {
          n += 1;
          left = Math.min(left, x);
          right = Math.max(right, x);
        }
    if (n > 4) {
      if (open) {
        open.yb = y;
        open.left = Math.min(open.left, left);
        open.right = Math.max(open.right, right);
      } else open = { ya: y, yb: y, left, right };
    } else if (open) {
      rows.push(open);
      open = undefined;
    }
  }
  for (const { ya: top0, yb: bottom0, left, right } of rows) {
    const mid = (left + right) / 2;
    const top = project(view, mid, top0);
    const bottom = project(view, mid, bottom0 + 1);
    const a = project(view, left, (top0 + bottom0) / 2);
    const b = project(view, right + 1, (top0 + bottom0) / 2);
    const straddles = (p, q, key, edge) => (p[key] - edge) * (q[key] - edge) < 0;
    const across =
      straddles(top, bottom, "y", 0) || straddles(top, bottom, "y", 1080) || straddles(a, b, "x", 0) || straddles(a, b, "x", 1920);
    const byWindow = (bottom0 >= H - 2 && onScreen(project(view, mid, H - 1))) || (right >= W - 2 && onScreen(project(view, W - 1, top0)));
    const seen = onScreen(top) || onScreen(bottom) || onScreen(a) || onScreen(b);
    if (seen && (across || byWindow))
      problems.push(`a sharp line cut by ${byWindow ? "the window's edge" : "the frame's edge"} (capture y ${top0}-${bottom0}, x ${left}-${right})`);
  }
  return problems;
}

export async function checkDof(only = []) {
  const findings = [];
  for (const shot of timeline.shots)
    for (const take of shot.takes) {
      const look = looks[shot.id]?.[take.id];
      const name = `${shot.id}/${take.id}`;
      if (!look?.dof || (only.length && !only.includes(name))) continue;
      const frames = look.still
        ? undefined
        : (await import(path.join(packageRoot, "public", "footage", look.state, "frames.json"), { with: { type: "json" } })).default.frames;
      const length = take.to - take.from;
      const checks = settledFrames(look, length).map((f) => ({ f, file: pictureAt(look, f, frames) }));
      const files = [...new Set(checks.map((c) => c.file))];
      const pictures = new Map((await decode(files)).map((pixels, i) => [files[i], pixels]));
      const seen = new Set();
      for (const { f, file } of checks) {
        const planes = planesOf(look.dof.mask(1, f / music.beatFrames)).map(sharpPlane);
        for (const problem of checkFrame(pictures.get(file), takeView(look, f), planes)) {
          const key = `${name}: ${problem.replace(/\(.*\)/, "")}`;
          if (seen.has(key)) continue;
          seen.add(key);
          findings.push(`frame ${take.from + f} (${name}): ${problem}`);
        }
      }
    }
  return findings;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const findings = await checkDof(process.argv.slice(2));
  for (const finding of findings) console.error(`dof: ${finding}`);
  console.log(`dof: ${findings.length} finding(s)`);
  if (findings.length) process.exitCode = 1;
}
