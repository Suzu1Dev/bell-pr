#!/usr/bin/env node
/**
 * The spots the film's pointer clicks, checked against the footage (owner's
 * feedback after round 9: the cursor did not seem to click where it
 * should). The pointer's hotspot is the capture's own click point
 * (src/look/pointer.ts); this checks that point and its target. For every
 * click the film shows (src/timeline.ts, src/shots.ts):
 *
 * - the click point lies inside the target's recorded box (targets.json,
 *   the control's bounding box when the move to it started);
 * - that box is where the footage shows the control on the frame of the
 *   press: its outline runs along an edge of the picture (a button's fill
 *   or border) on at least 70% of its length, within 2 capture px, so the
 *   control did not move between the recording of its box and the click.
 *
 * Returns the findings; run alone (and by `npm run assets`, and `npm test`
 * when the footage is there) it prints a line per click and exits 1 on a
 * finding. A finding means the capture's click targets are wrong: capture
 * the state again.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tsImport } from "tsx/esm/api";
import { packageRoot } from "./lib/media.mjs";
import { decodeGrey, H, W } from "./lib/pixels.mjs";

/** A step of at least this many levels across the outline counts as an edge; at least this share of it must be one. */
const STEP = 10;
const SHARE = 0.7;

export async function checkClickTargets({ log = () => undefined } = {}) {
  const { timeline } = await tsImport("../src/timeline.ts", import.meta.url);
  const { looks } = await tsImport("../src/shots.ts", import.meta.url);
  const { takePointer } = await tsImport("../src/look/pointer.ts", import.meta.url);
  const { clipFrameAt } = await tsImport("../src/footage.ts", import.meta.url);
  const findings = [];
  const json = async (state, file) => JSON.parse(await readFile(path.join(packageRoot, "public", "footage", state, file), "utf8"));
  const clicks = [];
  for (const shot of timeline.shots)
    for (const take of shot.takes) {
      const look = looks[shot.id]?.[take.id];
      if (!look || look.still !== undefined || look.pointer === false) continue;
      const targets = await json(look.state, "targets.json");
      const pointer = takePointer(look, take.to - take.from, targets);
      if (!pointer.clicks.length) continue;
      const frames = (await json(look.state, "frames.json")).frames;
      for (const click of pointer.clicks) {
        const t = Math.min(look.clipTo ?? Infinity, (look.clipFrom ?? 0) + (click.pressFrame / 30) * (look.rate ?? 1));
        clicks.push({ name: `${shot.id}/${take.id}`, state: look.state, click, file: path.join(packageRoot, "public", "footage-2x", look.state, clipFrameAt(frames, t).file) });
      }
    }
  const pictures = await decodeGrey(clicks.map((c) => c.file));
  clicks.forEach(({ name, click }, i) => {
    const grey = pictures[i];
    const box = click.box;
    if (!box) {
      findings.push(`${name} ${click.target}: no recorded box`);
      return;
    }
    const [x0, y0, x1, y1] = [box.x, box.y, box.x + box.width, box.y + box.height];
    if (!(click.x > x0 && click.x < x1 && click.y > y0 && click.y < y1)) findings.push(`${name} ${click.target}: the click (${click.x}, ${click.y}) is outside its box`);
    const at = (x, y) => grey[Math.min(H - 1, Math.max(0, Math.round(y))) * W + Math.min(W - 1, Math.max(0, Math.round(x)))];
    // Along each side, 4 px in from the corners (rounded), every px: the largest step across the side within 2 px.
    let edges = 0;
    let samples = 0;
    const side = (from, to, point, across) => {
      for (let s = from + 4; s <= to - 4; s += 1) {
        let step = 0;
        for (let d = -2; d <= 2; d += 1) {
          const [ax, ay] = point(s, d - 1);
          const [bx, by] = point(s, d + 1);
          step = Math.max(step, Math.abs(at(ax, ay) - at(bx, by)));
        }
        samples += 1;
        if (step >= STEP) edges += 1;
      }
    };
    side(x0, x1, (s, d) => [s, y0 + d]);
    side(x0, x1, (s, d) => [s, y1 + d]);
    side(y0, y1, (s, d) => [x0 + d, s]);
    side(y0, y1, (s, d) => [x1 + d, s]);
    const share = edges / Math.max(1, samples);
    log(`pointer spots: ${name} ${click.target} at (${click.x}, ${click.y}): in its box ${Math.round(x0)}-${Math.round(x1)} x ${Math.round(y0)}-${Math.round(y1)}, outline on an edge ${(share * 100).toFixed(0)}%`);
    if (share < SHARE) findings.push(`${name} ${click.target}: the recorded box's outline is on an edge of the footage for ${(share * 100).toFixed(0)}% only`);
  });
  return findings;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const findings = await checkClickTargets({ log: console.log });
  for (const finding of findings) console.error(`pointer spots: ${finding}`);
  if (findings.length) process.exitCode = 1;
}
