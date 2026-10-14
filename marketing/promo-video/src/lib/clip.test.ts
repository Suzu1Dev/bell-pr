import assert from "node:assert/strict";
import { test } from "node:test";
import { clipTime, frameAt } from "./clip.ts";

const frames = [
  { file: "a.jpg", t: 0 },
  { file: "b.jpg", t: 0.05 },
  { file: "c.jpg", t: 0.4 },
  { file: "d.jpg", t: 1 },
];

test("frameAt picks the last frame painted at or before the time", () => {
  assert.equal(frameAt(frames, 0).file, "a.jpg");
  assert.equal(frameAt(frames, 0.049).file, "a.jpg");
  assert.equal(frameAt(frames, 0.05).file, "b.jpg");
  assert.equal(frameAt(frames, 0.39).file, "b.jpg", "a frame holds until the next one");
  assert.equal(frameAt(frames, 0.7).file, "c.jpg");
});

test("frameAt holds the first and the last frame outside the clip", () => {
  assert.equal(frameAt(frames, -1).file, "a.jpg");
  assert.equal(frameAt(frames, 99).file, "d.jpg");
});

test("frameAt resamples a 60 fps clip to every other frame at 30 fps", () => {
  const sixty = Array.from({ length: 120 }, (_, index) => ({ file: `${index}`, t: index / 60 }));
  const picked = Array.from({ length: 60 }, (_, frame) => frameAt(sixty, frame / 30).file);
  assert.deepEqual(picked, Array.from({ length: 60 }, (_, frame) => `${frame * 2}`));
});

test("clipTime plays at real speed from startAt and cuts over skips", () => {
  assert.equal(clipTime(0.5, 1), 1.5);
  const skips: [number, number][] = [[2, 3]];
  assert.equal(clipTime(0, 1.9, skips), 1.9);
  assert.equal(clipTime(0, 2, skips), 3);
  assert.equal(clipTime(0, 2.5, skips), 3.5);
});
