import assert from "node:assert/strict";
import { test } from "node:test";
import { markPath } from "../../../src/brand/brand-assets.ts";
import {
  ARC,
  bellAt,
  bellOnScreen,
  bellPoint,
  FLIGHT,
  FOOTAGE_BELL,
  footagePatch,
  HANDOFF,
  lockupBell,
  MARK_UNITS,
  PATCH_BOX,
  windowBell,
  windowView,
} from "./bell.ts";
import { corners, project } from "./look/camera.ts";
import { pathMoments } from "./look/pathMoments.ts";
import { LOCKUP, logoState, logoTake, TEXT_LEAVE } from "./logo.ts";
import { music } from "./music.ts";
import { looks } from "./shots.ts";
import { takeOpacity } from "./takes.ts";
import { timeline } from "./timeline.ts";

const s3 = timeline.shots.find((shot) => shot.id === "s3-rules")!;
const establish = s3.takes.find((take) => take.id === "establish")!;
const look = looks["s3-rules"].establish;
const beat = music.beatFrames;
const hit = music.events.firstHit;
/** The mark's outline on its grid (units). */
const GLYPH = pathMoments(markPath).box;
const corners4 = (box: readonly number[]) => [
  [box[0], box[1]],
  [box[2], box[1]],
  [box[2], box[3]],
  [box[0], box[3]],
];
/** The app's bell as the window draws it: a mark-grid point through the window's own projection. */
const footagePoint = (f: number, u: number, v: number) =>
  project(windowView(f), FOOTAGE_BELL.x + (u * FOOTAGE_BELL.size) / MARK_UNITS, FOOTAGE_BELL.y + (v * FOOTAGE_BELL.size) / MARK_UNITS);
const windowOpacity = (f: number) => takeOpacity(look, f - establish.from);
/** The screen box of the bell's outline at frame f. */
const bellBox = (f: number) => {
  const points = corners4(GLYPH).map(([u, v]) => bellPoint(f, u, v));
  return [Math.min(...points.map((p) => p.x)), Math.min(...points.map((p) => p.y)), Math.max(...points.map((p) => p.x)), Math.max(...points.map((p) => p.y))];
};
const overlaps = (a: number[], b: number[]) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
/** The screen box of a capture rectangle under the window's view at frame f. */
const windowBox = (f: number, r: number[]) => {
  const points = corners4(r).map(([x, y]) => project(windowView(f), x, y));
  return [Math.min(...points.map((p) => p.x)), Math.min(...points.map((p) => p.y)), Math.max(...points.map((p) => p.x)), Math.max(...points.map((p) => p.y))];
};

test("the flight is on the music: lift-off on beat 3 of bar 5 after 1.2 s of the lockup, landing on the bar-6 downbeat, 0.8-1.4 s", () => {
  assert.equal(FLIGHT.from, establish.from);
  assert.equal(FLIGHT.from, logoTake.to);
  assert.ok(music.onBeat(FLIGHT.from) && music.nearestBeatIndex(FLIGHT.from) % 2 === 0, `lift-off ${FLIGHT.from} on a half-bar`);
  assert.ok(FLIGHT.from - hit >= 1.2 * 30, `the lockup readable ${((FLIGHT.from - hit) / 30).toFixed(2)} s`);
  assert.equal(FLIGHT.to, music.barFrame(6), "the landing on the bar-6 downbeat");
  const seconds = (FLIGHT.to - FLIGHT.from) / 30;
  assert.ok(seconds >= 0.8 && seconds <= 1.4, `${seconds} s`);
  // The window's whoosh peaks on the frame before the landing (src/sfx.ts reads landsAt).
  assert.equal(establish.from + Math.round(look.landsAt! * beat), FLIGHT.to);
  // A beat's hold after the landing, in which the hand-off ends, before the window turns to its rest.
  assert.equal(FLIGHT.holdTo - FLIGHT.to, beat);
  assert.ok(HANDOFF.bell.to < FLIGHT.holdTo);
  const hold = look.keys.find((key) => Math.round(key.at * beat) === FLIGHT.holdTo - establish.from)!;
  assert.ok(hold, "a key where the hold ends");
  const landKey = look.keys.find((key) => Math.round(key.at * beat) <= FLIGHT.to - establish.from && key.ease === "rise")!;
  assert.deepEqual(hold.view, landKey.view, "the window holds its landing framing (only the drift moves it)");
});

test("the bell starts exactly where the wordmark's own mark sat in the lockup, on the lockup's push", () => {
  for (const f of [hit, hit + 18, FLIGHT.from]) {
    const pose = bellAt(f);
    const lockup = lockupBell(f);
    assert.equal(pose.x, lockup.x);
    assert.equal(pose.y, lockup.y);
    assert.equal(pose.unit, lockup.unit);
    assert.equal(pose.opacity, 1);
  }
  // The wordmark's mark is the 64-unit mark moved 8 units left, at the wordmark's own scale.
  assert.ok(Math.abs(lockupBell(hit).x - (LOCKUP.left + 24 * LOCKUP.unit)) < 1e-9);
  assert.equal(bellAt(hit - 1).opacity, 0);
});

test("the bell lands exactly on the app's own bell: every point of its outline within 0.01 px, its size within 0.1%", () => {
  for (let f = FLIGHT.to; f <= FLIGHT.holdTo; f += 1) {
    for (const [u, v] of [...corners4(GLYPH), [MARK_UNITS / 2, MARK_UNITS / 2]]) {
      const a = bellPoint(f, u, v);
      const b = footagePoint(f, u, v);
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 0.01, `frame ${f} at (${u}, ${v}): ${Math.hypot(a.x - b.x, a.y - b.y).toFixed(4)} px`);
    }
    const flying = bellOnScreen(f);
    const app = windowBell(f);
    assert.ok(Math.abs(flying.unit / (app.unit * (2400 / (2400 - app.z))) - 1) < 0.001, `frame ${f}: size`);
  }
});

test("one smooth eased path: no reversal, one rise and fall of speed, at rest relative to the window at both ends", () => {
  const speeds: number[] = [];
  let before: { x: number; y: number } | undefined;
  for (let f = FLIGHT.from; f <= FLIGHT.to; f += 1) {
    const p = bellOnScreen(f);
    const q = bellOnScreen(f + 1);
    const v = { x: q.x - p.x, y: q.y - p.y };
    speeds.push(Math.hypot(v.x, v.y));
    if (before && Math.hypot(v.x, v.y) > 0.5 && Math.hypot(before.x, before.y) > 0.5)
      assert.ok(v.x * before.x + v.y * before.y > 0, `frame ${f}: the bell turns back`);
    before = v;
  }
  const peak = speeds.indexOf(Math.max(...speeds));
  // Up to one peak and down from it; as the bell takes up the window's last few px of travel the fall may level off
  // for a few frames (a ripple under 3% of the peak speed, about 0.2 px a frame), never surge again.
  const ripple = 0.03 * speeds[peak];
  for (let i = 1; i <= peak; i += 1) assert.ok(speeds[i] >= speeds[i - 1] - 0.05, `speeding up to the peak, frame ${FLIGHT.from + i}`);
  let lowest = speeds[peak];
  for (let i = peak + 1; i < speeds.length; i += 1) {
    assert.ok(speeds[i] <= lowest + ripple, `slowing after the peak, frame ${FLIGHT.from + i}: ${speeds[i].toFixed(2)} after ${lowest.toFixed(2)}`);
    lowest = Math.min(lowest, speeds[i]);
  }
  // Eased, not linear: it leaves the lockup and reaches the app's bell slowly (the window's own drift aside).
  assert.ok(speeds[0] < 0.1 * speeds[peak], `lift-off ${speeds[0].toFixed(2)} px a frame`);
  const app = (f: number) => project(windowView(f), FOOTAGE_BELL.x + 15, FOOTAGE_BELL.y + 15);
  const relative = (f: number) => {
    const [a, b] = [bellOnScreen(f), bellOnScreen(f - 1)];
    const [c, d] = [app(f), app(f - 1)];
    return Math.hypot(a.x - b.x - (c.x - d.x), a.y - b.y - (c.y - d.y));
  };
  assert.ok(relative(FLIGHT.to) < 0.5, `docking at ${relative(FLIGHT.to).toFixed(2)} px a frame against the window`);
  // Its size runs on the same eased curve: shrinking every frame, from the lockup's size to the app's.
  for (let f = FLIGHT.from + 1; f <= FLIGHT.to; f += 1) assert.ok(bellAt(f).unit < bellAt(f - 1).unit, `frame ${f}`);
});

test("a gentle arc: the path bows 5-15% of its length out of the straight line, never doubling back", () => {
  const a = bellOnScreen(FLIGHT.from);
  const b = bellOnScreen(FLIGHT.to);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  let most = 0;
  for (let f = FLIGHT.from; f <= FLIGHT.to; f += 1) {
    const p = bellOnScreen(f);
    most = Math.max(most, Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / length);
  }
  assert.ok(most / length >= 0.05 && most / length <= 0.15, `${((100 * most) / length).toFixed(1)}%`);
  assert.ok(ARC > 0);
});

test("no double exposure: the window shows only once the lockup's name has gone and the bell has left its place", () => {
  const lockupBox = (() => {
    const points = corners4(GLYPH).map(([u, v]) => bellPoint(FLIGHT.from, u, v));
    return [Math.min(...points.map((p) => p.x)), Math.min(...points.map((p) => p.y)), Math.max(...points.map((p) => p.x)), Math.max(...points.map((p) => p.y))];
  })();
  // The descriptor's and the name's rows, generously (the descriptor's line box, the wordmark's own box).
  const textBottom = LOCKUP.descriptorTop + 70;
  for (let f = FLIGHT.from; f <= FLIGHT.to; f += 1) {
    if (windowOpacity(f) <= 0.02) continue;
    const [tl, tr] = corners(windowView(f), look.height);
    const top = Math.min(tl.y, tr.y);
    if (logoState(f).opacity > 0.02) assert.ok(top > textBottom, `frame ${f}: the window (top ${top.toFixed(0)}) under the lockup's text`);
    if (overlaps(bellBox(f), lockupBox)) assert.ok(top > lockupBox[3], `frame ${f}: the window reaches the lockup's bell before it has left`);
  }
  // The window is there by the middle of the flight, whole.
  assert.equal(windowOpacity(Math.round((FLIGHT.from + FLIGHT.to) / 2)), 1);
  assert.ok(windowOpacity(TEXT_LEAVE.to) > 0, "and comes in as the name goes (no frame with nothing but studio)");
});

test("the bell never crosses the app's own name or the sidebar's first label on its way in", () => {
  // Capture boxes round "BELL PR", its plan chips and "WORKSPACE" (the sidebar's ink nearest the mark).
  const NAME = [56, 33, 210, 58];
  const LABEL = [27, 95, 110, 110];
  for (let f = FLIGHT.from; f < FLIGHT.to; f += 1) {
    if (windowOpacity(f) <= 0.02) continue;
    assert.ok(!overlaps(bellBox(f), windowBox(f, NAME)), `frame ${f}: over "BELL PR"`);
    assert.ok(!overlaps(bellBox(f), windowBox(f, LABEL)), `frame ${f}: over "WORKSPACE"`);
  }
});

test("the hand-off: the footage's bell is hidden until the landing, then a cross-dissolve inside the hold", () => {
  for (let f = establish.from; f < FLIGHT.to; f += 1) assert.equal(footagePatch(f), 1, `frame ${f}`);
  assert.equal(footagePatch(FLIGHT.to), 0, "from the landing the flying bell carries the paper");
  assert.equal(bellAt(HANDOFF.bell.from).opacity, 1);
  assert.equal(bellAt(HANDOFF.bell.to).opacity, 0);
  for (let f = HANDOFF.bell.from; f < HANDOFF.bell.to; f += 1) assert.ok(bellAt(f + 1).opacity < bellAt(f).opacity, `frame ${f}`);
  assert.ok(HANDOFF.bell.to - HANDOFF.bell.from >= 6, "over a few frames");
  // The patch covers the whole mark and stops short of the app's "B" (capture x 56.3).
  const k = FOOTAGE_BELL.size / MARK_UNITS;
  assert.ok(PATCH_BOX[0] < FOOTAGE_BELL.x + GLYPH[0] * k && PATCH_BOX[2] > FOOTAGE_BELL.x + GLYPH[2] * k && PATCH_BOX[2] < 56);
  assert.ok(PATCH_BOX[1] < FOOTAGE_BELL.y + GLYPH[1] * k && PATCH_BOX[3] > FOOTAGE_BELL.y + GLYPH[3] * k);
});
