import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createMusic, fps, music, type TrackAnalysis } from "./music.ts";
import { END_HOLD_SECONDS, FADE_OUT_FRAMES, buildTimeline, shotSpecs, timeline } from "./timeline.ts";

const analysis = JSON.parse(readFileSync(new URL("../music/track.analysis.json", import.meta.url), "utf8")) as TrackAnalysis;
const seconds = (frames: number) => frames / fps;

test("the film is 75-90 s: the music's last sound, then the complete end card held about a second and faded", () => {
  assert.equal(timeline.durationInFrames, music.durationInFrames + Math.round(END_HOLD_SECONDS * fps));
  // At most 1.0 s of silent hold past the music's last sound, then the fade (no dead air before a loop).
  assert.ok(END_HOLD_SECONDS * fps - FADE_OUT_FRAMES <= 1.0 * fps && END_HOLD_SECONDS >= 0.8);
  assert.ok(seconds(timeline.durationInFrames) >= 75 && seconds(timeline.durationInFrames) <= 89.5);
  assert.equal(timeline.shots.at(-1)!.to, timeline.durationInFrames);
});

test("all fourteen shots of VIDEO.md §3 are in, in order, end to end (no S8 dropped, no S10 merged)", () => {
  assert.deepEqual(
    timeline.shots.map((shot) => shot.id),
    shotSpecs.map((spec) => spec.id),
  );
  assert.equal(timeline.shots.length, 14);
  assert.deepEqual(timeline.flexSteps, []);
  timeline.shots.forEach((shot, index) => {
    if (index > 0) assert.equal(shot.from, timeline.shots[index - 1].to, `${shot.id} starts where the shot before ends`);
  });
});

test("every anchored shot starts on its event frame", () => {
  const anchored = timeline.shots.filter((shot) => shot.anchor);
  assert.deepEqual(
    anchored.map((shot) => shot.anchor),
    ["intro", "riser", "firstHit", "lift", "climax", "accent", "finalHit"],
  );
  for (const shot of anchored) assert.equal(shot.from, music.events[shot.anchor!], shot.id);
});

/** The beat index of a frame on the grid (a whole number when the frame is on a beat). */
const beatIndex = (frame: number) => music.nearestBeatIndex(frame);
const onHalfBar = (frame: number) => music.onBeat(frame) && beatIndex(frame) % 2 === 0;
const onBar = (frame: number) => music.onBeat(frame) && beatIndex(frame) % music.beatsPerBar === 0;

test("section changes on bar lines, else half-bars; a beat only where the limits leave nothing else", () => {
  const offBar: string[] = [];
  const offHalf: string[] = [];
  for (const shot of timeline.shots.filter((s) => !s.anchor)) {
    assert.ok(music.onBeat(shot.from), `${shot.id} at ${shot.from}`);
    if (!onBar(shot.from)) offBar.push(shot.id);
    if (!onHalfBar(shot.from)) offHalf.push(shot.id);
  }
  // S7 and S13 take a half-bar: a bar line would break S6/S7/S8's or S12/S13's limits.
  assert.deepEqual(offBar, ["s7-taste", "s10-predict", "s13-learn"]);
  // S10 starts on beat 2 of bar 25: S9 never goes under its nominal 10 s and S10 needs its 4 s minimum,
  // and the climax-to-accent gap (14.4 s) leaves only that beat (a bar line or half-bar breaks one of them).
  assert.deepEqual(offHalf, ["s10-predict"]);
  const s9 = timeline.shots.find((s) => s.id === "s9-explain-back")!;
  for (const step of [2, 4]) {
    const index = beatIndex(s9.to);
    for (const candidate of [Math.floor(index / step) * step, Math.ceil(index / step) * step]) {
      const cut = music.beatFrame(candidate);
      const s9s = seconds(cut - s9.from);
      const s10s = seconds(music.events.accent! - cut);
      assert.ok(s9s < 10 - 1e-9 || s10s < 4 - 1e-9, `a cut at ${cut} would keep both limits`);
    }
  }
});

test("cuts between takes fall on half-bars (beat 1 or 3), but for the rise a beat before the bar-6 downbeat", () => {
  for (const shot of timeline.shots)
    for (const take of shot.takes.slice(1)) {
      if (shot.id === "s3-rules" && take.id === "establish") {
        // Anticipate, then land: the window starts to rise on beat 4 and lands on the bar line after it.
        assert.ok(music.onBeat(take.from) && onBar(take.from + music.beatFrames), `${take.from}`);
        continue;
      }
      if (shot.id === "s10-predict") {
        // S10 starts off the half-bar grid (above); its takes keep to beats.
        assert.ok(music.onBeat(take.from), `${shot.id}/${take.id} at ${take.from}`);
        continue;
      }
      assert.ok(onHalfBar(take.from), `${shot.id}/${take.id} at ${take.from}`);
    }
});

test("every crash downbeat of the track is a cut (within a frame)", () => {
  assert.ok(music.crashes.length >= 3);
  const cuts = timeline.shots.flatMap((shot) => [shot.from, ...shot.takes.slice(1).map((take) => take.from)]);
  for (const crash of music.crashes)
    assert.ok(cuts.some((cut) => Math.abs(cut - crash) <= 1), `the crash at ${crash} (${seconds(crash).toFixed(3)} s) is a cut`);
  // The two clearest crashes, bar 9 and the loudest downbeat (bar 23), and the last phrase's return (bar 31).
  for (const frame of [579, 1587, 2163]) assert.ok(cuts.includes(frame), `${frame}`);
});

test("every shot keeps its limits in seconds; only shots fixed by two anchors may not", () => {
  for (const shot of timeline.shots) {
    const length = seconds(shot.to - shot.from);
    if (shot.bounded) continue;
    assert.ok(length >= shot.limits.min - 1e-9 && length <= shot.limits.max + 1e-9, `${shot.id}: ${length.toFixed(2)} s`);
  }
  // The bounded ones: S1 (intro to riser), S2 (riser to first hit), S14 (final hit to the end).
  assert.deepEqual(
    timeline.shots.filter((shot) => shot.bounded).map((shot) => shot.id),
    ["s1-problem", "s2-turn", "s14-end"],
  );
  // S6, S7 and S9 never go below nominal.
  for (const id of ["s6-try-first", "s7-taste", "s9-explain-back"]) {
    const shot = timeline.shots.find((s) => s.id === id)!;
    assert.ok(seconds(shot.to - shot.from) >= shot.spec.seconds.nominal - 1e-9, id);
  }
});

test("captions keep the rules: 42 characters, 2 lines, reading minimums, on the half-beat grid, inside their shot", () => {
  assert.equal(timeline.captions.length, 20);
  timeline.captions.forEach((cue, index) => {
    const shot = timeline.shots.find((s) => s.id === cue.shot)!;
    assert.ok(cue.lines.length <= 2, cue.text);
    for (const line of cue.lines) assert.ok(line.length <= 42, `${line} (${line.length})`);
    const minimum = cue.lines.length === 1 ? 1.8 : 2.6;
    assert.ok(seconds(cue.to - cue.from) >= minimum - 1e-9, `${cue.text}: ${seconds(cue.to - cue.from).toFixed(2)} s`);
    assert.ok(music.onBeat(cue.from, 0.5), `${cue.text} starts at ${cue.from}`);
    assert.ok(cue.from >= shot.from && cue.to <= shot.to, `${cue.text} inside ${shot.id}`);
    const before = timeline.captions[index - 1];
    if (before) assert.ok(cue.from >= before.to, `${cue.text} after the cue before`);
  });
});

test("the captions are VIDEO.md's, with the owner's headline on the end card and no forbidden word", () => {
  const texts = timeline.captions.map((cue) => cue.text.replace(/\n/g, " ").replace(/’/g, "'"));
  assert.deepEqual(texts, [
    "Vibe coding made pull requests cheap.",
    "Reviewing them still isn't.",
    "What if AI made you better, not just faster?",
    "First, read the project's rules.",
    "Every rule, quoted from its source.",
    "Check the issue is still yours.",
    "Agents do the legwork, on your own machine.",
    "Answer first.",
    "Then see the explanation.",
    "Which way would you do it?",
    "Taste grows by weighing trade-offs.",
    "Stuck on a line? Ask about it.",
    "Before it ships, explain it back.",
    "Missed something? Fix it in a line.",
    "Predict what the maintainer will ask.",
    "Your words. The project's rules.",
    "And what you didn't test.",
    "One Draft PR. Then stay for the review.",
    "Learn from what they actually said.",
    "From vibe coding to knowing why.",
  ]);
  for (const text of texts) assert.doesNotMatch(text, /automatic|autonomous|proves/i);
  assert.equal(timeline.captions.at(-1)!.shot, "s14-end");
});

test("the opening breath: S2 runs from the riser through the stop to the first hit", () => {
  const s2 = timeline.shots.find((s) => s.id === "s2-turn")!;
  assert.equal(s2.from, music.events.riser);
  assert.equal(s2.to, music.events.firstHit);
  assert.ok(music.stop && music.stop.from > s2.from && music.stop.to === s2.to);
});

/** The analysis with some events moved (seconds), for the flex rules. */
const variant = (events: Partial<TrackAnalysis["events"]>) => {
  const copy = structuredClone(analysis);
  Object.assign(copy.events, events);
  return createMusic(copy);
};

test("flex rule 2: a short prove-it phrase merges S10 into the tail of S9 first", () => {
  const cut = buildTimeline(variant({ accent: 59.518 }));
  assert.deepEqual(cut.flexSteps.slice(0, 1), ["s10-predict merged into s9-explain-back"]);
  assert.ok(!cut.shots.some((shot) => shot.id === "s10-predict"));
  const s9 = cut.shots.find((shot) => shot.id === "s9-explain-back")!;
  assert.ok(s9.captions.some((cue) => cue.text.startsWith("Predict")), "S10's caption rides in S9's tail");
});

test("flex rule 2: a learn-the-change phrase too short for all three drops S8, never S6 or S7 below nominal", () => {
  const cut = buildTimeline(variant({ climax: 43.918 }));
  assert.ok(cut.flexSteps.includes("s8-ask dropped"), cut.flexSteps.join("; "));
  for (const id of ["s6-try-first", "s7-taste"]) {
    const shot = cut.shots.find((s) => s.id === id)!;
    assert.ok(seconds(shot.to - shot.from) >= shot.spec.seconds.nominal - 1e-9, id);
  }
});

test("flex rule 3: a phrase longer than its maximums holds S9, then S6, then S11", () => {
  const cut = buildTimeline(variant({ climax: 43.918 }));
  assert.ok(cut.flexSteps.some((step) => step.startsWith("s9-explain-back holds")), cut.flexSteps.join("; "));
});

test("flex rule 4: without a riser or accent the next shot starts on a bar line", () => {
  const copy = structuredClone(analysis);
  delete copy.events.accent;
  const other = createMusic(copy);
  const cut = buildTimeline(other);
  const s11 = cut.shots.find((shot) => shot.id === "s11-your-words")!;
  assert.equal((s11.from - other.beatFrame(0)) % 1, 0);
  assert.ok(other.onBeat(s11.from));
  const index = other.nearestBeatIndex(s11.from);
  assert.equal(index % other.beatsPerBar, 0, "on beat 1 of a bar");
});
