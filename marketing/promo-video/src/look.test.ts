import assert from "node:assert/strict";
import { test } from "node:test";
import { CAPTURE } from "./footage.ts";
import { cardBox } from "./look/captionLayout.ts";
import { corners, floating, project, push, viewAt, wholeWindowInFrame, type View } from "./look/camera.ts";
import { keyframeCuts } from "./keyframes.ts";
import { planesOf, sharpPlane } from "./look/dof.ts";
import { pointerAt, pointerWindows } from "./look/pointer.ts";
import { MACRO_MAX_M, PUSH_MAX_M, looks, type TakeLook } from "./shots.ts";
import { takeMaxM, takeView } from "./takes.ts";
import { timeline } from "./timeline.ts";
import { music } from "./music.ts";

const takes = timeline.shots.flatMap((shot) =>
  shot.takes.filter((take) => looks[shot.id]?.[take.id]).map((take) => ({ shot, take, look: looks[shot.id][take.id] })),
);

test("every product take has a look, and every look belongs to a take", () => {
  for (const shot of timeline.shots)
    for (const take of shot.takes)
      if (!["queue", "lift", "logo", "title", "end-card"].includes(take.id)) assert.ok(looks[shot.id]?.[take.id], `${shot.id}/${take.id}`);
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

test("every establishing take holds the whole floating window for two beats or more: four edges in frame, scale 1 or less, the badge's top bar", () => {
  const establishing = takes.filter(({ look }) => look.float);
  assert.deepEqual(
    establishing.map(({ shot }) => shot.id),
    ["s3-rules", "s6-try-first", "s9-explain-back", "s11-your-words"],
  );
  for (const { shot, take, look } of establishing) {
    let whole = 0;
    for (let f = 0; f < take.to - take.from; f += 1) {
      const view = takeView(look, f);
      if (wholeWindowInFrame(view, 40) && view.m <= 1) whole += 1;
    }
    assert.ok(whole >= 2 * music.beatFrames, `${shot.id}: the whole window for ${whole} frames`);
  }
});

test("pushes stay at 2.0 output px per capture px or less (one DPR-4 pixel per pixel of the 4K master); a macro at 2.6 or less", () => {
  for (const { shot, take, look } of takes) {
    const max = takeMaxM(look, take.to - take.from);
    const cap = look.macro ? MACRO_MAX_M : PUSH_MAX_M;
    assert.ok(max <= cap, `${shot.id}/${take.id}: ${max.toFixed(2)} (at most ${cap})`);
  }
  assert.ok(takes.filter(({ look }) => look.macro).length >= 6, "the payoffs get macros");
});

/** The capture point under screen point (X, Y) of view v (tilt ignored: an estimate for speeds). */
const under = (v: View, X: number, Y: number) => ({ x: v.cx + (X - v.sx) / v.m, y: v.cy + (Y - v.sy) / v.m });

test("readable UI never moves faster than 8 px a frame once a take has settled (the sharp plane on screen, or the middle of the frame)", () => {
  for (const { shot, take, look } of takes) {
    const start = look.float ? Math.round(look.keys.at(-1)!.at * music.beatFrames) : 0;
    for (let f = start; f < take.to - take.from - 1; f += 1) {
      const va = takeView(look, f);
      const vb = takeView(look, f + 1);
      // The capture points of the sharp plane that are on screen: its corners and centre, clipped to the frame.
      const lo = under(va, 0, 0);
      const hi = under(va, 1920, 1080);
      const rects = sharpRects(look, f / music.beatFrames) ?? [
        { x0: under(va, 560, 290).x, x1: under(va, 1360, 790).x, y0: under(va, 560, 290).y, y1: under(va, 1360, 790).y },
      ];
      for (const rect of rects) {
        const x0 = Math.max(rect.x0, lo.x);
        const x1 = Math.min(rect.x1, hi.x);
        const y0 = Math.max(rect.y0, lo.y);
        const y1 = Math.min(rect.y1, hi.y);
        if (x0 >= x1 || y0 >= y1) continue;
        const points = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [(x0 + x1) / 2, (y0 + y1) / 2]];
        for (const [x, y] of points) {
          const a = project(va, x, y);
          const b = project(vb, x, y);
          assert.ok(Math.hypot(b.x - a.x, b.y - a.y) <= 8, `${shot.id}/${take.id} frame ${f} at capture ${x.toFixed(0)},${y.toFixed(0)}`);
        }
      }
    }
  }
});

/** The clip seconds a take shows, or undefined for a still. */
const clipSpan = (look: TakeLook, frames: number) =>
  look.still !== undefined
    ? undefined
    : [look.clipFrom ?? 0, Math.min(look.clipTo ?? Infinity, (look.clipFrom ?? 0) + (frames / 30) * (look.rate ?? 1))];

test("no jump cuts: a cut to the same moment of one captured state changes the framing by at least 15% or moves to another part of it", () => {
  for (const shot of timeline.shots)
    for (let i = 1; i < shot.takes.length; i += 1) {
      const a = looks[shot.id]?.[shot.takes[i - 1].id];
      const b = looks[shot.id]?.[shot.takes[i].id];
      if (!a || !b || a.state !== b.state) continue;
      // Another moment of the clip (after a scroll or a step, later or earlier) is another picture, not a jump cut.
      const spanA = clipSpan(a, shot.takes[i - 1].to - shot.takes[i - 1].from);
      const spanB = clipSpan(b, shot.takes[i].to - shot.takes[i].from);
      if (spanA && spanB && (spanB[0] - spanA[1] > 0.5 || spanA[0] - spanB[1] > 0.5)) continue;
      if ((a.still ?? "") !== (b.still ?? "") && (a.still || b.still)) continue;
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
    const gapsAt = (f: number) => {
      const [tl, tr, br, bl] = corners(takeView(look, f));
      return {
        left: Math.max(tl.x, bl.x),
        right: 1920 - Math.min(tr.x, br.x),
        top: Math.max(tl.y, tr.y),
        bottom: 1080 - Math.min(bl.y, br.y),
      };
    };
    for (let f = 0; f < take.to - take.from; f += 3) {
      const gaps = gapsAt(f);
      const later = gapsAt(f + 3);
      for (const [side, gap] of Object.entries(gaps)) {
        // An edge sweeping in or out during a camera move is not a sliver that stays.
        const moving = Math.abs(later[side as keyof typeof later] - gap) > 6;
        if (gap > 0 && gap < 60 && !moving) problems.push(`${shot.id}/${take.id} frame ${f}: ${side} ${gap.toFixed(0)} px`);
      }
    }
  }
  assert.deepEqual(problems.slice(0, 12), []);
});

test("a push that shows the app's sidebar keeps all of it in the soft plane: every feather ends in the gutter after it", () => {
  for (const { shot, take, look } of takes) {
    if (look.float) continue;
    for (let f = 0; f < take.to - take.from; f += 6) {
      const view = takeView(look, f);
      const edge = view.cx - view.sx / view.m; // capture x at the frame's left edge (no tilt)
      if (edge >= 240) continue;
      assert.ok(look.dof, `${shot.id}/${take.id} frame ${f}: the sidebar is in frame from capture x ${edge.toFixed(0)}`);
      for (const rect of sharpRects(look, f / music.beatFrames) ?? [])
        assert.ok(rect.x0 - rect.fl >= 240, `${shot.id}/${take.id} frame ${f}: a feather starts at capture x ${(rect.x0 - rect.fl).toFixed(0)}, inside the sidebar`);
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
  // It shows at most 12 frames before its click (here later than its move's start, less the fade-in).
  assert.ok(Math.abs(pointerWindows(events)[0][0] - 1.1) < 1e-9);
  const moving = pointerAt(events, 1.25)!;
  assert.ok(moving.x > 100 && moving.x < 300);
  const pressed = pointerAt(events, 1.55)!;
  assert.ok(pressed.press > 0 && pressed.ripple !== undefined);
  assert.equal(pointerAt(events, 2.5), undefined);
  // On a clip slowed to half speed the same rhythm holds on screen: the windows stretch with the clip.
  assert.ok(Math.abs(pointerWindows(events, 0.5)[0][0] - 1.3) < 1e-9);
  // The click's ring is gone 8 frames after it, before the UI under it has settled.
  assert.equal(pointerAt(events, 1.5 + 9 / 30)?.ripple, undefined);
  // When the UI replaces what was clicked (scripts/pointer-spots.mjs records when), the ring ends and the disc goes.
  const spots = [{ t: 1.5, dx: 9, dy: 11, changeAt: 1.5 + 1 / 30 }];
  assert.ok(pointerAt(events, 1.5, 1, spots)!.ripple !== undefined);
  assert.equal(pointerAt(events, 1.5 + 2 / 30, 1, spots)?.ripple, undefined);
  assert.ok((pointerAt(events, 1.5 + 3 / 30, 1, spots)?.opacity ?? 0) < 0.01);
});

/** The sharp planes of a take's mask (capture px, cores and feathers), read back from their gradient stops. */
function sharpRects(look: TakeLook, beats: number) {
  if (!look.dof) return undefined;
  return planesOf(look.dof.mask(1, beats)).map(sharpPlane);
}

/** Whether point p is inside the convex quad (corners in order). */
const inside = (quad: { x: number; y: number }[], p: { x: number; y: number }) => {
  let sign = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (Math.abs(cross) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
};

/** Whether the card, grown by 12 px, touches the projected sharp plane (a convex quad). */
function cardTouches(card: { left: number; top: number; width: number; height: number }, quad: { x: number; y: number }[]) {
  const [l, t, r, b] = [card.left - 12, card.top - 12, card.left + card.width + 12, card.top + card.height + 12];
  const edge: { x: number; y: number }[] = [];
  for (let x = l; x <= r; x += 10) edge.push({ x, y: t }, { x, y: b });
  for (let y = t; y <= b; y += 10) edge.push({ x: l, y }, { x: r, y });
  return edge.some((p) => inside(quad, p)) || quad.some((p) => p.x > l && p.x < r && p.y > t && p.y < b);
}

test("a caption card never sits on the sharp plane (12 px clear): it sits over the soft plane or the studio", () => {
  const problems: string[] = [];
  for (const cue of timeline.captions.filter((c) => c.style === "card")) {
    const card = cardBox(cue);
    for (const { shot, take, look } of takes) {
      if (take.to <= cue.from || take.from >= cue.to) continue;
      for (let frame = Math.max(take.from, cue.from); frame < Math.min(take.to, cue.to); frame += 3) {
        const f = frame - take.from;
        const view = takeView(look, f);
        const rects = sharpRects(look, f / music.beatFrames) ?? [{ x0: 0, x1: 1440, y0: 0, y1: 810 }];
        const quads = rects.map((rect) => [
          project(view, rect.x0, rect.y0),
          project(view, rect.x1, rect.y0),
          project(view, rect.x1, rect.y1),
          project(view, rect.x0, rect.y1),
        ]);
        if (quads.some((quad) => cardTouches(card, quad))) {
          problems.push(`${shot.id}/${take.id} frame ${frame}: "${cue.lines[0]}"`);
          break;
        }
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("the WebM gets a keyframe on every cut between the stages and on every take that opens on the studio", () => {
  const cuts = keyframeCuts();
  for (const frame of [music.events.firstHit, music.events.finalHit]) assert.ok(cuts.includes(frame), `${frame}`);
  const title = timeline.shots.find((shot) => shot.id === "s9-explain-back")!.takes.find((take) => take.id === "title")!;
  assert.ok(cuts.includes(title.from) && cuts.includes(title.to), "the climax title's two cuts");
  for (const { take, look } of takes) if (look.float) assert.ok(cuts.includes(take.from), `${take.id} at ${take.from}`);
  assert.ok(cuts.length <= 24, "keyframes cost bits: only where a plate first shows");
});
