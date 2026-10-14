import assert from "node:assert/strict";
import { test } from "node:test";
import {
  crossfadeFrames,
  events,
  fadeInFrames,
  fps,
  gainDb,
  logoLandFrame,
  segmentVolume,
  segments,
  track,
  volume,
} from "./music.ts";

test("the edit starts on bar starts of the 120 BPM grid (bars 5 and 33)", () => {
  const bar = (seconds: number) => (seconds - track.firstBarSeconds) / track.barSeconds + 1;
  assert.deepEqual(
    segments.map((segment) => Math.round(bar(segment.sourceSeconds[0]) * 1e6) / 1e6),
    [5, 33],
  );
  for (const segment of segments)
    // Remotion trims in whole frames: within one frame of the bar start.
    assert.ok(Math.abs(segment.trimBefore / fps - segment.sourceSeconds[0]) < 1 / fps);
  assert.equal(segments[0].to, segments[1].from);
  assert.equal(segments[1].from, events.climax, "the cut into the climax is the edit point");
});

test("the edit ends with the track's sound, inside the 2259-frame composition", () => {
  const end = segments[1].from + (track.soundEndSeconds * fps - segments[1].trimBefore);
  assert.ok(Math.abs(end - events.tailEnd) < 1, `the sound ends at frame ${end}`);
  assert.ok(Math.ceil(events.tailEnd) === segments[1].to);
});

test("the music fades in over the first 0.5 s, then plays at the gain", () => {
  assert.equal(fadeInFrames, 15);
  assert.equal(segmentVolume(0, 0), 0);
  assert.ok(Math.abs(segmentVolume(0, 7.5) - volume / 2) < 1e-9);
  assert.equal(segmentVolume(0, 600), volume);
  assert.ok(Math.abs(volume - 10 ** (gainDb / 20)) < 1e-12);
});

test("a 2-frame crossfade at the cut keeps the level steady", () => {
  assert.equal(crossfadeFrames, 2);
  const cut = segments[1].from;
  for (let frame = cut - 1; frame <= cut + 1; frame += 0.5) {
    const sum = segmentVolume(0, frame) + segmentVolume(1, frame);
    assert.ok(Math.abs(sum - volume) < 1e-9, `level at frame ${frame}`);
  }
  assert.equal(segmentVolume(0, cut + 1), 0);
  assert.equal(segmentVolume(1, cut - 1), 0);
});

test("the gain brings the source near -14 LUFS", () => {
  const lufs = track.lufs + gainDb;
  assert.ok(lufs >= -15 && lufs <= -13, `${lufs} LUFS`);
});

test("the end-card logo lands within 0.25 s of the measured hit", () => {
  assert.ok(Math.abs(logoLandFrame - events.finalHit) / fps <= 0.25);
  assert.ok(events.finalHit >= 69.5 * fps && events.finalHit <= 73 * fps);
});
