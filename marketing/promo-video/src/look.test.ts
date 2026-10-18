import assert from "node:assert/strict";
import { test } from "node:test";
import { CAPTURE } from "./footage.ts";
import { corners, floating, project, push, viewAt, wholeWindowInFrame } from "./look/camera.ts";
import { pointerAt, pointerWindows } from "./look/pointer.ts";
import { looks } from "./shots.ts";
import { takeMaxM, takeView } from "./takes.ts";
import { timeline } from "./timeline.ts";

const takes = timeline.shots.flatMap((shot) =>
  shot.takes.filter((take) => looks[shot.id]?.[take.id]).map((take) => ({ shot, take, look: looks[shot.id][take.id] })),
);

test("every product take has a look, and every look belongs to a take", () => {
  for (const shot of timeline.shots)
    for (const take of shot.takes)
      if (!["queue", "lift", "logo", "end-card"].includes(take.id)) assert.ok(looks[shot.id]?.[take.id], `${shot.id}/${take.id}`);
  for (const [shotId, byTake] of Object.entries(looks))
    for (const takeId of Object.keys(byTake))
      assert.ok(timeline.shots.find((s) => s.id === shotId)?.takes.some((t) => t.id === takeId), `${shotId}/${takeId}`);
});

test("the projection puts the view's focus point where the view says", () => {
  const view = push(800, 400, 1.6, { sx: 900, sy: 500, rx: 3, ry: -6, cover: false });
  const p = project(view, 800, 400);
  // The focus point is on the rotation axis: only the perspective divide moves it (z = 0).
  assert.ok(Math.abs(p.x - 900) < 1e-9 && Math.abs(p.y - 500) < 1e-9);
});

test("a push covers the frame unless it shows an edge on purpose", () => {
  const view = push(720, 250, 1.75);
  const [tl, tr, br, bl] = corners(view);
  assert.ok(tl.x < 0 && tl.y < 0 && tr.x > 1920 && br.y > 1080 && bl.x < 0);
  const edged = push(1251, 400, 1.85, { right: 120 });
  assert.ok(Math.abs(project(edged, CAPTURE.width, 400).x - 1800) < 1e-6);
});

test("every establishing take ends on the whole floating window: four edges in frame, with the badge's top bar", () => {
  const establishing = takes.filter(({ look }) => look.float);
  assert.deepEqual(
    establishing.map(({ shot }) => shot.id),
    ["s3-rules", "s6-try-first", "s9-explain-back", "s11-your-words"],
  );
  for (const { shot, take, look } of establishing) {
    const rest = takeView(look, take.to - take.from - 1);
    assert.ok(wholeWindowInFrame(rest, 40), `${shot.id}: all four edges at least 40 px inside`);
    assert.ok(rest.m <= 1, `${shot.id}: the whole window at scale 1 or less`);
  }
});

test("no take magnifies past 2.0 output px per capture px (one DPR-4 pixel per pixel of the 4K master)", () => {
  for (const { shot, take, look } of takes) {
    const max = takeMaxM(look, take.to - take.from);
    assert.ok(max <= 2.0, `${shot.id}/${take.id}: ${max.toFixed(2)}`);
  }
});

test("readable UI never moves faster than 8 px a frame once a take has settled", () => {
  for (const { shot, take, look } of takes) {
    const start = look.float ? Math.round(look.keys.at(-1)!.at * 18) : 0;
    for (let f = start; f < take.to - take.from - 1; f += 1) {
      const a = project(takeView(look, f), 720, 405);
      const b = project(takeView(look, f + 1), 720, 405);
      assert.ok(Math.hypot(b.x - a.x, b.y - a.y) <= 8, `${shot.id}/${take.id} frame ${f}`);
    }
  }
});

test("no jump cuts: a cut within one captured state changes the framing by at least 15% or moves to another part of it", () => {
  for (const shot of timeline.shots)
    for (let i = 1; i < shot.takes.length; i += 1) {
      const a = looks[shot.id]?.[shot.takes[i - 1].id];
      const b = looks[shot.id]?.[shot.takes[i].id];
      if (!a || !b || a.state !== b.state) continue;
      const before = takeView(a, shot.takes[i - 1].to - shot.takes[i - 1].from - 1);
      const after = takeView(b, 0);
      const ratio = Math.max(before.m, after.m) / Math.min(before.m, after.m);
      const moved = Math.hypot(before.cx - after.cx, before.cy - after.cy);
      assert.ok(ratio >= 1.15 || moved >= 200, `${shot.id}: ${shot.takes[i].id} (x${ratio.toFixed(2)}, ${moved.toFixed(0)} px)`);
    }
});

test("no slivers: a push either covers each frame edge or leaves at least 60 px of studio there", () => {
  const problems: string[] = [];
  for (const { shot, take, look } of takes) {
    if (look.float) continue;
    for (let f = 0; f < take.to - take.from; f += 3) {
      const [tl, tr, br, bl] = corners(takeView(look, f));
      const gaps = {
        left: Math.max(tl.x, bl.x),
        right: 1920 - Math.min(tr.x, br.x),
        top: Math.max(tl.y, tr.y),
        bottom: 1080 - Math.min(bl.y, br.y),
      };
      for (const [side, gap] of Object.entries(gaps))
        if (gap > 0 && gap < 60) problems.push(`${shot.id}/${take.id} frame ${f}: ${side} ${gap.toFixed(0)} px`);
    }
  }
  assert.deepEqual(problems.slice(0, 12), []);
});

test("a push that crops the app's sidebar at the frame edge puts it in the soft plane", () => {
  for (const { shot, take, look } of takes) {
    if (look.float) continue;
    for (let f = 0; f < take.to - take.from; f += 6) {
      const view = takeView(look, f);
      const edge = view.cx - (view.sx / view.m); // capture x at the frame's left edge (no tilt)
      if (edge > 20 && edge < 266) assert.ok(look.dof, `${shot.id}/${take.id} frame ${f}: the sidebar is cut at capture x ${edge.toFixed(0)}`);
    }
  }
});

test("camera keys interpolate magnification in log space and hold outside their range", () => {
  const a = floating(1000);
  const b = { ...a, m: a.m * 4 };
  const keys = [
    { at: 0, view: a },
    { at: 2, view: b, ease: "linear" as const },
  ];
  assert.ok(Math.abs(viewAt(keys, 1).m - a.m * 2) < 1e-9);
  assert.equal(viewAt(keys, -1), a);
  assert.equal(viewAt(keys, 5), b);
});

test("the pointer shows only while it works: in before a move, out after its click", () => {
  const events = [
    { type: "start" as const, t: 0, x: 100, y: 100 },
    { type: "move" as const, from: 1, t: 1.5, x: 300, y: 200, target: "a" },
    { type: "click" as const, t: 1.5, x: 300, y: 200, target: "a" },
    { type: "hide" as const, t: 1.8 },
  ];
  assert.equal(pointerAt(events, 0.5), undefined);
  assert.deepEqual(pointerWindows(events)[0][0], 0.8);
  const moving = pointerAt(events, 1.25)!;
  assert.ok(moving.x > 100 && moving.x < 300);
  const pressed = pointerAt(events, 1.55)!;
  assert.ok(pressed.press > 0 && pressed.ripple !== undefined);
  assert.equal(pointerAt(events, 2.5), undefined);
});
