import assert from "node:assert/strict";
import { test } from "node:test";
import { END_LOGO, LOCK_FRAMES, chordFrame, endLogoState, flareAt, logoLeaves, logoState, logoTake } from "./logo.ts";
import { darkFrom, exhale, hit, stop } from "./moments.ts";
import { frameOf, music } from "./music.ts";
import { timeline } from "./timeline.ts";

test("the first-hit logo: invisible before the hit, fully present and crisp on it", () => {
  assert.equal(logoTake.from, music.events.firstHit);
  for (let f = 0; f < hit; f += 1) assert.equal(logoState(f).opacity, 0, `frame ${f}`);
  const on = logoState(hit);
  assert.equal(on.opacity, 1);
  assert.ok(on.scale <= 1.04 && on.scale >= 1);
  assert.equal(on.blur, 0);
});

test("the logo holds at least 36 frames, then has fully gone before the window's take starts", () => {
  assert.ok(logoLeaves - hit >= 36);
  assert.equal(logoState(logoLeaves).opacity, 1);
  const last = logoState(logoTake.to - 1).opacity;
  assert.ok(last > 0 && last < 0.35, `the last logo frame is a faint trace (${last.toFixed(2)}), not an empty frame`);
  assert.equal(logoState(logoTake.to).opacity, 0);
  const s3 = timeline.shots.find((shot) => shot.id === "s3-rules")!;
  assert.equal(s3.takes[1].from, logoTake.to);
});

test("the breath before the hit: a beat of stillness, the exhale, four dark frames", () => {
  assert.equal(exhale - stop, music.beatFrames);
  assert.equal(hit - darkFrom, 4);
});

test("the end-card logo resolves ON the final chord: still under 72% eight frames after the cut, settled from 1.02 on the chord", () => {
  const end = timeline.shots.at(-1)!;
  assert.ok(endLogoState(end.from + 8).opacity <= 0.72, `${endLogoState(end.from + 8).opacity.toFixed(2)}`);
  assert.ok(endLogoState(chordFrame - 1).scale > 1);
  const on = endLogoState(chordFrame);
  assert.equal(on.opacity, 1);
  assert.equal(on.blur, 0);
  assert.equal(on.scale, 1);
  assert.equal(chordFrame, frameOf(music.track.events.landing!));
  assert.ok(chordFrame <= music.landingFrame && music.landingFrame - chordFrame <= 1);
  // It is the hero on the chord, then moves up to its slot a beat later, before the headline's first line.
  assert.equal(END_LOGO.moveFrom, chordFrame + music.beatFrames);
  assert.ok(END_LOGO.moveTo <= end.captions[0].from);
});

test("the end-card logo pulls into focus from the cut and locks on the final chord", () => {
  const end = timeline.shots.at(-1)!;
  assert.equal(end.from, music.events.finalHit);
  assert.equal(endLogoState(end.from - 1).opacity, 0);
  assert.ok(endLogoState(end.from).opacity > 0.2, "the cut frame already shows the soft logo");
  const landed = endLogoState(music.landingFrame);
  assert.equal(landed.opacity, 1);
  assert.equal(landed.blur, 0);
  assert.equal(landed.scale, 1);
  assert.ok(endLogoState(music.landingFrame - 3).blur > 0, "still pulling in just before the chord");
  // Within ±0.25 s of the chord (VIDEO.md acceptance).
  assert.ok(Math.abs(music.landingFrame / 30 - (music.track.events.landing ?? 0)) <= 0.25);
});

test("the drop is never a still: the first-hit lockup pushes 1.00 to 1.04 through its take, and the studio flares for six frames", () => {
  for (let f = hit; f < logoTake.to - 1; f += 1) assert.ok(logoState(f + 1).scale > logoState(f).scale, `frame ${f}`);
  assert.ok(Math.abs(logoState(logoTake.to - 1).scale - 1.04) < 1e-9);
  assert.ok(flareAt(hit) >= 0.2 && flareAt(hit) <= 0.35, "about 6-8 levels brighter on the hit");
  assert.equal(flareAt(hit - 1), 0);
  assert.ok(flareAt(hit + 6) < 0.001, "back to normal six frames later");
});

test("the end-card logo's last fifth of resolve and its settle from 1.02 happen on the frames before the chord", () => {
  const before = endLogoState(chordFrame - LOCK_FRAMES);
  assert.ok(before.opacity >= 0.75 && before.opacity <= 0.8, `${before.opacity.toFixed(2)} three frames before`);
  assert.ok(Math.abs(before.scale - 1.02) < 1e-9);
  for (let f = chordFrame - LOCK_FRAMES; f < chordFrame; f += 1) {
    assert.ok(endLogoState(f + 1).opacity > endLogoState(f).opacity, `frame ${f}`);
    assert.ok(endLogoState(f + 1).scale < endLogoState(f).scale, `frame ${f}`);
  }
  // The chord frame's own step is the largest of the whole pull.
  const step = (f: number) => endLogoState(f).opacity - endLogoState(f - 1).opacity;
  for (let f = timeline.shots.at(-1)!.from + 1; f < chordFrame; f += 1) assert.ok(step(chordFrame) > step(f), `frame ${f}`);
});
