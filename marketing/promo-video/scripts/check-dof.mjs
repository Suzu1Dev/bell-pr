#!/usr/bin/env node
/**
 * Checks every product take's lifted components (src/look/dof.ts) against
 * the captured footage (no render needed), on every third frame of every
 * take and its last frame (a moving take as much as a settled one: review
 * round 7 found a mask sliding across text in a take this used to skip):
 *
 * - crops: no line of text, icon or other ink lies just outside a lifted
 *   box (1-4 capture px beyond its edge), where the crop would cut it: every
 *   box ends on the component's own border or in a gutter of the UI;
 * - cut lines: on a take's last frame, no line of ink in a lifted box runs
 *   across a frame edge, or across the window's own bottom or right edge on
 *   screen, where it would be cut in half while sharp;
 * - window bottoms: a whole floating window ends in a gutter (its `height`,
 *   or the viewport's bottom): no line of text is sliced by its bottom edge.
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
const { liftOn } = await tsImport("../src/look/dof.ts", import.meta.url);
const { focusAmount } = await tsImport("../src/scenes/ProductShot.tsx", import.meta.url);

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

/** The frames of a take to check: every third, and the last. */
function framesToCheck(length) {
  const out = [];
  for (let f = 0; f < length; f += 3) out.push(f);
  out.push(length - 1);
  return [...new Set(out)];
}

/** The lifted boxes in front at frame f (on and focus at 0.5 or more). */
function liftedAt(look, f) {
  const amount = focusAmount(look.focus ?? [{ at: 0, amount: 1 }], f / music.beatFrames);
  return (look.lifts ?? []).filter((lift) => liftOn(lift, f) * amount >= 0.5).map((lift) => lift.box);
}

const inside = (boxes, x, y) => boxes.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1);

/** Ink just outside each lifted box, where its crop would cut a glyph. */
function checkCrops(pixels, view, boxes) {
  const problems = [];
  const ink = (x, y) => x >= 0 && y >= 0 && x < W && y < H && pixels[y * W + x] < INK;
  const visible = (x, y) => onScreen(project(view, x, y));
  for (const box of boxes) {
    const [x0, y0, x1, y1] = box.map(Math.round);
    const sides = {
      top: [...Array(x1 - x0).keys()].flatMap((i) => [1, 2, 3, 4].map((d) => [x0 + i, y0 - d])),
      bottom: [...Array(x1 - x0).keys()].flatMap((i) => [0, 1, 2, 3].map((d) => [x0 + i, y1 + d])),
      left: [...Array(y1 - y0).keys()].flatMap((i) => [1, 2, 3, 4].map((d) => [x0 - d, y0 + i])),
      right: [...Array(y1 - y0).keys()].flatMap((i) => [0, 1, 2, 3].map((d) => [x1 + d, y0 + i])),
    };
    for (const [side, points] of Object.entries(sides)) {
      const hits = points.filter(([x, y]) => ink(x, y) && !inside(boxes, x, y) && visible(x, y));
      if (hits.length > ALLOWED)
        problems.push(`the lift [${box.join(", ")}] cuts ink on its ${side} edge (${hits.length} px near capture ${hits[0].join(",")})`);
    }
  }
  return problems;
}

/** Lines of ink in a lifted box cut by a frame edge or the window's own edge. */
function checkCuts(pixels, view, boxes) {
  const problems = [];
  const ink = (x, y) => pixels[y * W + x] < INK;
  for (const [bx0, by0, bx1, by1] of boxes) {
    const xa = Math.max(0, Math.floor(bx0));
    const xb = Math.min(W, Math.ceil(bx1));
    const ya = Math.max(0, Math.floor(by0));
    const yb = Math.min(H, Math.ceil(by1));
    const rows = [];
    let open;
    for (let y = ya; y <= yb; y += 1) {
      let n = 0;
      let left = Infinity;
      let right = -Infinity;
      if (y < yb)
        for (let x = xa; x < xb; x += 1)
          if (ink(x, y)) {
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
        problems.push(`a lifted line cut by ${byWindow ? "the window's edge" : "the frame's edge"} (capture y ${top0}-${bottom0}, x ${left}-${right})`);
    }
  }
  return problems;
}

export async function checkDof(only = []) {
  const findings = [];
  for (const shot of timeline.shots)
    for (const take of shot.takes) {
      const look = looks[shot.id]?.[take.id];
      const name = `${shot.id}/${take.id}`;
      if ((!look?.lifts?.length && !look?.float) || (only.length && !only.includes(name))) continue;
      const frames = look.still
        ? undefined
        : (await import(path.join(packageRoot, "public", "footage", look.state, "frames.json"), { with: { type: "json" } })).default.frames;
      const length = take.to - take.from;
      const checks = framesToCheck(length).map((f) => ({ f, file: pictureAt(look, f, frames) }));
      const files = [...new Set(checks.map((c) => c.file))];
      const pictures = new Map((await decode(files)).map((pixels, i) => [files[i], pixels]));
      const seen = new Set();
      for (const { f, file } of checks) {
        if (look.float) {
          // The window's bottom edge: ink within two capture px either side of it is a sliced line.
          const pixels = pictures.get(file);
          const edge = Math.round(look.height ?? H);
          let hits = 0;
          for (let y = Math.max(0, edge - 2); y < Math.min(H, edge + 2); y += 1)
            for (let x = 0; x < W; x += 1) if (pixels[y * W + x] < INK) hits += 1;
          const key = `${name}: bottom`;
          if (hits > ALLOWED && !seen.has(key)) {
            seen.add(key);
            findings.push(`frame ${take.from + f} (${name}): the window's bottom edge (capture y ${edge}) slices a line (${hits} ink px)`);
          }
        }
        const boxes = liftedAt(look, f);
        if (!boxes.length) continue;
        const view = takeView(look, f);
        const problems = [...checkCrops(pictures.get(file), view, boxes), ...(f === length - 1 ? checkCuts(pictures.get(file), view, boxes) : [])];
        for (const problem of problems) {
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
