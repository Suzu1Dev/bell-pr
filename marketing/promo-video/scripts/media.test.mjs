import assert from "node:assert/strict";
import { test } from "node:test";
import { frameLevels, largestRise, wavSamples } from "./lib/media.mjs";

/** A mono 16-bit WAV file of `samples`. */
function wav(samples, sampleRate = 48_000) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((value, index) => data.writeInt16LE(Math.round(value * 32767), index * 2));
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

test("wavSamples reads 16-bit PCM, also with a placeholder data size", () => {
  const file = wav([0, 0.5, -0.5]);
  assert.deepEqual([...wavSamples(file)].map((value) => Math.round(value * 100) / 100), [0, 0.5, -0.5]);
  file.writeUInt32LE(0xffffffff, 40);
  assert.equal(wavSamples(file).length, 3);
});

test("frameLevels gives one RMS level per video frame", () => {
  const perFrame = 1600; // 48 kHz at 30 fps
  const quiet = Array.from({ length: perFrame }, () => 0.01);
  const loud = Array.from({ length: perFrame }, () => 0.5);
  const levels = frameLevels(Float32Array.from([...quiet, ...loud, ...quiet]), 48_000, 30, 2085);
  assert.deepEqual(levels.map((level) => level.frame), [2085, 2086, 2087]);
  assert.ok(Math.abs(levels[0].db - -40) < 0.01);
  assert.ok(Math.abs(levels[1].db - -6.02) < 0.01);
});

test("largestRise finds the frame that jumps most over the one before", () => {
  const levels = [-20, -18, -30, -9, -10, -2].map((db, index) => ({ frame: 100 + index, db }));
  assert.deepEqual(largestRise(levels), { frame: 103, rise: 21 });
});
