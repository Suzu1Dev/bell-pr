import assert from "node:assert/strict";
import { test } from "node:test";
import { endLogoState, logoLeaves, logoState, logoTake } from "./logo.ts";
import { darkFrom, exhale, hit, stop } from "./moments.ts";
import { music } from "./music.ts";
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
  assert.equal(logoState(logoTake.to - 1).opacity, 0);
  const s3 = timeline.shots.find((shot) => shot.id === "s3-rules")!;
  assert.equal(s3.takes[1].from, logoTake.to);
});

test("the breath before the hit: a beat of stillness, the exhale, four dark frames", () => {
  assert.equal(exhale - stop, music.beatFrames);
  assert.equal(hit - darkFrom, 4);
});

test("the end-card logo pulls into focus from the cut and locks on the final chord", () => {
  const end = timeline.shots.at(-1)!;
  assert.equal(end.from, music.events.finalHit);
  assert.equal(endLogoState(end.from - 1).opacity, 0);
  const landed = endLogoState(music.landingFrame);
  assert.equal(landed.opacity, 1);
  assert.equal(landed.blur, 0);
  assert.equal(landed.scale, 1);
  assert.ok(endLogoState(music.landingFrame - 3).blur > 0, "still pulling in just before the chord");
  // Within ±0.25 s of the chord (VIDEO.md acceptance).
  assert.ok(Math.abs(music.landingFrame / 30 - (music.track.events.landing ?? 0)) <= 0.25);
});
