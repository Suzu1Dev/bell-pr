import assert from "node:assert/strict";
import { test } from "node:test";
import { END_LOGO, LOCK_FRAMES, TEXT_LEAVE, chordFrame, endLogoState, flareAt, lockupScale, logoState, logoTake } from "./logo.ts";
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

test("the lockup holds whole and readable for 1.2 s, then its name and descriptor dissolve as the bell lifts off", () => {
  // Readable from the hit to the flight's first frame (src/bell.ts), then gone within the flight's first quarter.
  assert.equal(TEXT_LEAVE.from, logoTake.to);
  assert.ok(TEXT_LEAVE.from - hit >= 36, `${TEXT_LEAVE.from - hit} frames`);
  for (let f = hit; f <= TEXT_LEAVE.from; f += 1) assert.equal(logoState(f).opacity, 1, `frame ${f}`);
  assert.ok(TEXT_LEAVE.to - TEXT_LEAVE.from <= 9, "an early dissolve");
  for (let f = TEXT_LEAVE.from; f < TEXT_LEAVE.to; f += 1) assert.ok(logoState(f + 1).opacity < logoState(f).opacity, `frame ${f}`);
  assert.equal(logoState(TEXT_LEAVE.to).opacity, 0);
  const s3 = timeline.shots.find((shot) => shot.id === "s3-rules")!;
  assert.equal(s3.takes[1].from, logoTake.to, "the window's take starts on the flight's first frame");
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

test("the drop is never a still: the first-hit lockup pushes on (the reviewed cut's 1.00-1.04 in 53 frames) until it has gone, and the studio flares for six frames", () => {
  for (let f = hit; f < TEXT_LEAVE.to - 1; f += 1) assert.ok(logoState(f + 1).scale > logoState(f).scale, `frame ${f}`);
  assert.ok(Math.abs(lockupScale(hit + 53) - 1.04) < 1e-9);
  assert.equal(lockupScale(hit), 1);
  assert.ok(flareAt(hit) >= 0.2 && flareAt(hit) <= 0.35, "about 6-8 levels brighter on the hit");
  assert.equal(flareAt(hit - 1), 0);
  assert.ok(flareAt(hit + 6) < 0.001, "back to normal six frames later");
});

test("the end-card logo's last fifth of resolve and its settle from 1.02 happen on the frames before the chord", () => {
  // The last fifth of the resolve comes on the two frames that end on the chord; the settle starts three frames before.
  assert.ok(endLogoState(chordFrame - 2).opacity < 0.8, `${endLogoState(chordFrame - 2).opacity.toFixed(2)} two frames before`);
  const before = endLogoState(chordFrame - LOCK_FRAMES);
  assert.ok(Math.abs(before.scale - 1.02) < 1e-9);
  for (let f = chordFrame - LOCK_FRAMES; f < chordFrame; f += 1) {
    assert.ok(endLogoState(f + 1).opacity > endLogoState(f).opacity, `frame ${f}`);
    assert.ok(endLogoState(f + 1).scale < endLogoState(f).scale, `frame ${f}`);
  }
  // Every frame of the pull changes more than the one before (no pause), and the chord frame's step is the largest.
  const step = (f: number) => endLogoState(f).blur - endLogoState(f - 1).blur;
  for (let f = timeline.shots.at(-1)!.from + 2; f <= chordFrame; f += 1) assert.ok(-step(f) > -step(f - 1), `frame ${f}`);
});
