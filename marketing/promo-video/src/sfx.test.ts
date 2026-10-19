import assert from "node:assert/strict";
import { test } from "node:test";
import type { Footage } from "./footage.ts";
import { hit } from "./moments.ts";
import { music } from "./music.ts";
import { SFX, cueGain, sfxCues } from "./sfx.ts";
import { chordFrame } from "./logo.ts";
import { looks } from "./shots.ts";
import { timeline } from "./timeline.ts";

/** Stand-in footage metadata: every state with one click at 1.0 s and a typing passage 0.5-1.5 s. */
const footage: Footage = Object.fromEntries(
  [...new Set(Object.values(looks).flatMap((shot) => Object.values(shot).map((look) => look.state)))].map((state) => [
    state,
    {
      boxes: {},
      events: [
        { type: "start", t: 0, x: 0, y: 0 },
        { type: "move", from: 0.6, t: 1, x: 10, y: 10, target: "x" },
        { type: "click", t: 1, x: 10, y: 10, target: "x" },
      ],
      marks: { typing: 0.5, typed: 1.5 },
      frames: Array.from({ length: 600 }, (_, i) => ({ file: `frames/${String(i).padStart(5, "0")}.jpg`, t: i / 30 })),
    },
  ]),
);
const cues = sfxCues(footage);

test("the swell rises through the exhale and is cut on the first hit (nothing is stacked on the crash)", () => {
  const swell = cues.find((cue) => cue.name.startsWith("swell"))!;
  assert.equal(swell.from + swell.durationInFrames, hit);
  assert.ok(!cues.some((cue) => cue.from === hit), "no sound effect starts on the hit");
});

test("at most one whoosh a bar, one per establishing window", () => {
  const whooshes = cues.filter((cue) => cue.name.startsWith("whoosh"));
  assert.equal(whooshes.length, 4);
  whooshes.forEach((cue, index) => {
    if (index > 0) assert.ok(cue.from - whooshes[index - 1].from >= music.barFrames);
  });
});

test("ticks fall on the clicks the pointer makes on screen, and nowhere else", () => {
  const expected: number[] = [];
  for (const shot of timeline.shots)
    for (const take of shot.takes) {
      const look = looks[shot.id]?.[take.id];
      if (!look || look.still) continue;
      const clipFrom = look.clipFrom ?? 0;
      const rate = look.rate ?? 1;
      const frame = take.from + Math.round(((1 - clipFrom) / rate) * 30);
      if (clipFrom <= 1 && (look.clipTo ?? Infinity) > 1 && frame < take.to) expected.push(frame);
    }
  const ticks = cues.filter((cue) => cue.name.startsWith("tick")).map((cue) => cue.from);
  assert.deepEqual(ticks.sort((a, b) => a - b), expected.sort((a, b) => a - b));
});

test("levels stay under the music: swells and whooshes at -15 dB or lower, ticks and keys lower still", () => {
  for (const cue of cues) {
    const ceiling = /^(swell|whoosh)/.test(cue.name) ? -15 : -19;
    assert.ok(cue.gainDb <= ceiling, `${cue.name}: ${cue.gainDb} dB`);
    assert.ok(cue.from >= 0 && cue.from + cue.durationInFrames <= timeline.durationInFrames, cue.name);
  }
  const swell = cues.find((cue) => cue.name.startsWith("swell"))!;
  assert.equal(cueGain(swell, swell.durationInFrames - 1) < cueGain(swell, swell.durationInFrames - 3), true);
});

test("one glint, its onset on the final chord as the end-card logo locks", () => {
  const glints = cues.filter((cue) => cue.name.startsWith("glint"));
  assert.equal(glints.length, 1);
  assert.equal(glints[0].from + SFX.glint.onsetFrame, chordFrame);
});

test("each whoosh peaks on the frame before its window's downbeat, leading into the beat", () => {
  const whooshes = cues.filter((cue) => cue.name.startsWith("whoosh"));
  const peaks = whooshes.map((cue) => cue.from + (cue.file === SFX.whooshA.file ? SFX.whooshA.peakFrame : SFX.whooshB.peakFrame));
  const downbeats = [music.barFrame(6), music.events.lift, music.barFrame(22), music.events.accent!];
  assert.deepEqual(peaks, downbeats.map((frame) => frame - 1));
});
