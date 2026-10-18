/**
 * Caption cues from src/timeline.ts, their rules, and the WebVTT and SubRip
 * formats. The film's captions (src/look/Captions.tsx and the kinetic title
 * lines of the opening and the end card) read the same cues, so the files
 * and the video agree to the frame.
 */

/** The rules every cue keeps. */
export const captionRules = {
  maxLineLength: 42,
  maxLines: 2,
  /** Seconds a cue must stay on screen, by its number of lines. */
  minSeconds: { 1: 1.8, 2: 2.6 },
};

/** Cues in seconds, in time order: {start, end, lines}, from a timeline with `fps` and `captions` in frames. */
export function cuesFromTimeline(timeline) {
  return timeline.captions
    .map((cue) => ({
      start: cue.from / timeline.fps,
      end: cue.to / timeline.fps,
      lines: cue.text.split("\n"),
    }))
    .sort((a, b) => a.start - b.start);
}

/** Problems with the cues, as sentences; empty when they keep every rule. */
export function captionProblems(cues, { duration } = {}) {
  const problems = [];
  cues.forEach((cue, index) => {
    const name = `Cue ${index + 1} ("${cue.lines.join(" ")}")`;
    if (!(cue.end > cue.start)) problems.push(`${name} ends before it starts.`);
    if (cue.lines.length > captionRules.maxLines)
      problems.push(`${name} has ${cue.lines.length} lines; at most ${captionRules.maxLines}.`);
    for (const line of cue.lines)
      if (line.length > captionRules.maxLineLength)
        problems.push(`${name} has a line of ${line.length} characters; at most ${captionRules.maxLineLength}.`);
    const min = captionRules.minSeconds[Math.min(cue.lines.length, 2)];
    if (cue.end - cue.start < min - 1e-6)
      problems.push(`${name} shows for ${(cue.end - cue.start).toFixed(2)} s; ${cue.lines.length === 1 ? "one line" : "two lines"} need ${min} s.`);
    if (duration !== undefined && cue.end > duration + 1e-6)
      problems.push(`${name} ends at ${cue.end.toFixed(3)} s, after the video (${duration.toFixed(3)} s).`);
    const previous = cues[index - 1];
    if (previous && cue.start < previous.end - 1e-6)
      problems.push(`${name} starts before the cue before it ends.`);
  });
  return problems;
}

/** `seconds` as hh:mm:ss.mmm (WebVTT) or hh:mm:ss,mmm (SubRip). */
export function formatTime(seconds, separator = ".") {
  const millis = Math.round(seconds * 1000);
  const hours = Math.floor(millis / 3_600_000);
  const minutes = Math.floor((millis % 3_600_000) / 60_000);
  const secs = Math.floor((millis % 60_000) / 1000);
  const pad = (value, size = 2) => String(value).padStart(size, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}${separator}${pad(millis % 1000, 3)}`;
}

export function toVtt(cues) {
  const blocks = cues.map(
    (cue, index) =>
      `${index + 1}\n${formatTime(cue.start)} --> ${formatTime(cue.end)}\n${cue.lines.join("\n")}`,
  );
  return `WEBVTT\n\n${blocks.join("\n\n")}\n`;
}

export function toSrt(cues) {
  const blocks = cues.map(
    (cue, index) =>
      `${index + 1}\n${formatTime(cue.start, ",")} --> ${formatTime(cue.end, ",")}\n${cue.lines.join("\n")}`,
  );
  return `${blocks.join("\n\n")}\n`;
}

/** Reads the cues back from WebVTT text (as written by toVtt). */
export function parseVtt(text) {
  const toSeconds = (stamp) => {
    const [hours, minutes, rest] = stamp.split(":");
    return Number(hours) * 3600 + Number(minutes) * 60 + Number(rest);
  };
  const cues = [];
  for (const block of text.replace(/\r/g, "").split(/\n\n+/)) {
    const lines = block.split("\n").filter(Boolean);
    const at = lines.findIndex((line) => line.includes("-->"));
    if (at < 0) continue;
    const [start, end] = lines[at].split("-->").map((part) => toSeconds(part.trim().split(/\s+/)[0]));
    cues.push({ start, end, lines: lines.slice(at + 1) });
  }
  return cues;
}
