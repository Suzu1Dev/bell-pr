import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { captionProblems, cuesFromTimeline, formatTime, parseVtt, toSrt, toVtt } from "./lib/captions.mjs";

const timeline = JSON.parse(readFileSync(new URL("../src/timeline.json", import.meta.url), "utf8"));
const cue = (start, end, ...lines) => ({ start, end, lines });

test("the timeline's captions keep every rule", () => {
  const cues = cuesFromTimeline(timeline);
  assert.equal(cues.length, timeline.captions.length);
  assert.deepEqual(captionProblems(cues, { duration: timeline.durationInFrames / timeline.fps }), []);
});

test("timestamps are formatted to the millisecond for WebVTT and SubRip", () => {
  assert.equal(formatTime(0), "00:00:00.000");
  assert.equal(formatTime(75.28), "00:01:15.280");
  assert.equal(formatTime(3661.0004, ","), "01:01:01,000");
  assert.equal(formatTime(252 / 30), "00:00:08.400");
});

test("WebVTT and SubRip carry the same cues", () => {
  const cues = [cue(0.3, 2.9, "One line"), cue(3, 6, "Two", "lines")];
  const vtt = toVtt(cues);
  assert.ok(vtt.startsWith("WEBVTT\n\n1\n00:00:00.300 --> 00:00:02.900\nOne line\n"));
  assert.deepEqual(parseVtt(vtt), cues);
  assert.equal(toSrt(cues), "1\n00:00:00,300 --> 00:00:02,900\nOne line\n\n2\n00:00:03,000 --> 00:00:06,000\nTwo\nlines\n");
});

test("captionProblems finds long lines, short cues, overlaps and late cues", () => {
  const long = "x".repeat(43);
  const problems = captionProblems(
    [cue(0, 1.5, "Too short"), cue(1, 3, long), cue(4, 5.9, "Two", "lines"), cue(10, 12, "Late")],
    { duration: 11 },
  );
  assert.equal(problems.length, 5, problems.join("\n"));
  assert.match(problems.join("\n"), /1\.50 s; one line need 1\.8 s/);
  assert.match(problems.join("\n"), /43 characters/);
  assert.match(problems.join("\n"), /starts before the cue before it ends/);
  assert.match(problems.join("\n"), /two lines need 2\.6 s/);
  assert.match(problems.join("\n"), /after the video/);
  assert.deepEqual(captionProblems([cue(0, 2, "a", "b", "c")]).length, 2, "three lines, and too short for them");
});
