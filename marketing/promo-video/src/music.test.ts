import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createMusic, frameOf, fps, music, requiredEvents, type TrackAnalysis } from "./music.ts";

const analysis = JSON.parse(readFileSync(new URL("../music/track.analysis.json", import.meta.url), "utf8")) as TrackAnalysis;

test("the analysis file is the contract of VIDEO.md §2, path-free", () => {
  for (const key of ["version", "trackId", "title", "artist", "licenseRef", "audioFile", "md5", "grid", "loudness", "edit", "events", "measuredBy", "reviewed"])
    assert.ok(key in analysis, `missing ${key}`);
  for (const name of requiredEvents) assert.equal(typeof analysis.events[name], "number", name);
  assert.match(analysis.audioFile, /^music\/[\w.-]+\.mp3$/);
  const text = readFileSync(new URL("../music/track.analysis.json", import.meta.url), "utf8");
  assert.doesNotMatch(text, /\/home\/|\/Users\/|\/tmp\/|[A-Za-z]:\\\\/);
  // Listening is the owner's: the analysis stays unreviewed until then.
  assert.equal(analysis.reviewed, false);
});

test("events become frames by the frame rule (the frame whose interval holds the time)", () => {
  assert.equal(frameOf(9.718), 291);
  assert.equal(music.events.intro, 0);
  assert.equal(music.events.firstHit, frameOf(analysis.events.firstHit));
  assert.equal(music.events.lift, frameOf(analysis.events.lift));
  assert.equal(music.events.climax, frameOf(analysis.events.climax));
  assert.equal(music.events.finalHit, frameOf(analysis.events.finalHit));
  assert.equal(music.durationInFrames, Math.round(analysis.events.tailEnd * fps));
  // The lead fixed the landing on the final chord at the rounded frame (VIDEO.md addendum: 2452).
  assert.equal(music.landingFrame, Math.round(analysis.events.landing! * fps));
});

test("the grid: beats, bars and the anchors on it", () => {
  assert.equal(music.beatFrames, (60 / analysis.grid.bpm) * fps);
  assert.equal(music.beatFrame(0), frameOf(analysis.grid.beatZeroSeconds));
  for (const name of ["firstHit", "lift", "climax"] as const) assert.ok(music.onBeat(music.events[name]), `${name} on the grid`);
  assert.equal(music.barFrame(5), music.events.firstHit);
  // The landing is the first beat after the measured final hit.
  const after = music.beatIndexAtOrAfter(music.events.finalHit + 1);
  assert.ok(Math.abs(music.beatFrame(after) - music.landingFrame) <= 1);
});

test("the edit: segments in whole frames, end to end, the last one ending at the tail", () => {
  assert.equal(music.segments.length, analysis.edit.segments.length);
  assert.equal(music.segments[0].from, 0);
  music.segments.forEach((segment, index) => {
    assert.equal(segment.trimBefore, Math.round(analysis.edit.segments[index].sourceFrom * fps));
    if (index > 0) assert.equal(segment.from, music.segments[index - 1].to);
  });
  assert.equal(music.segments.at(-1)!.to, music.durationInFrames);
  // The cut removes whole bars, so both sides stay on one grid.
  const shift = music.segments[1].trimBefore - music.segments[1].from;
  assert.equal(shift % music.barFrames, 0);
});

test("the crossfade is equal-power and ends before the downbeat at the join", () => {
  const join = music.segments[1].from;
  for (let frame = join - music.crossfadeFrames; frame < join; frame += 1) {
    const a = music.segmentGain(0, frame);
    const b = music.segmentGain(1, frame);
    assert.ok(Math.abs(a * a + b * b - 1) < 1e-9, `power at ${frame}`);
    assert.ok(a > 0 && b > 0);
  }
  assert.equal(music.segmentGain(0, join), 0);
  assert.equal(music.segmentGain(1, join), 1);
  assert.equal(music.segmentGain(1, join - music.crossfadeFrames - 1), 0);
  assert.ok(music.segmentGain(0, 0) > 0 && music.segmentGain(0, 0) < 1, "the fade-in");
  assert.equal(music.segmentGain(0, music.fadeInFrames), 1);
});

test("the gain brings the edit into -15..-13 LUFS", () => {
  const lufs = analysis.loudness.lufs + analysis.loudness.gainDb;
  assert.ok(lufs >= -15 && lufs <= -13, `${lufs} LUFS`);
  assert.ok(Math.abs(music.volume - 10 ** (analysis.loudness.gainDb / 20)) < 1e-12);
});

test("a track without its optional events still loads", () => {
  const bare = structuredClone(analysis);
  delete bare.events.riser;
  delete bare.events.accent;
  delete bare.events.landing;
  delete bare.stop;
  const other = createMusic(bare);
  assert.equal(other.events.riser, undefined);
  assert.equal(other.stop, undefined);
  assert.ok(other.landingFrame > other.events.finalHit);
});
