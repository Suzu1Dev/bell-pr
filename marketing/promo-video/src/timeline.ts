/**
 * The cut: the fourteen shots of plan direction-v1.1/VIDEO.md §3, their
 * captions and their takes, laid on the music's events by the flex rules.
 *
 * Shot lengths are in SECONDS (VIDEO.md lead addendum: the storyboard's bars
 * were sized at 120 BPM, 2.0 s a bar), so the same rules hold on any track.
 * Captions and takes are placed in beats from the shot's first beat (a
 * negative number counts back from the shot's end), so they move with the
 * grid. Every frame number comes from src/music.ts.
 *
 * Flex rules (VIDEO.md §3; src/timeline.test.ts asserts them):
 * 1. An anchored shot starts on its event. The shots between two anchors
 *    share the gap in proportion to their nominal seconds, each clamped to
 *    its min-max, and every cut snaps to the grid: to the nearest bar line
 *    (section changes on downbeats, lookdev STYLE-GUIDE §2.2), else the
 *    nearest half-bar (beat 3), else the nearest beat, taking at each step
 *    the nearest candidate or a neighbour that keeps every limit. Takes
 *    are placed on half-bars (src/timeline.test.ts).
 * 2. A gap shorter than the sum of the minimums: drop the second caption
 *    beat of S3, then of S11; merge S10 into the tail of S9; drop S8.
 *    S6, S7 and S9 never go below nominal. A shot bounded by two anchors
 *    takes its whole gap: the music fixes it (here S1, intro to riser,
 *    4.9 s: the "tighter opening" the lead's addendum accepts).
 * 3. A gap longer than the sum of the maximums: hold S9, then S6, then S11.
 * 4. A missing optional event (riser, accent): the shot starts on the bar
 *    line nearest to where the nominal lengths put it.
 * 5. A total outside 75-90 s is an error: re-edit the analysis segments.
 *
 * The picture holds the complete end card for END_HOLD_SECONDS after the
 * music's last sound, then fades to black, so the call to action can be
 * read (and paused on) whole.
 */
import { fps, music as loadedMusic, type EventName, type Music } from "./music.ts";

/** Beats from the shot's first beat; negative counts back from its end; "end" is its end. */
export type Beats = number | "end";

export type CaptionStyle = "title" | "card";
/** Where a caption card sits: a corner of the frame, chosen per shot so it never covers the subject. */
export type CaptionPlace = "bottom-left" | "bottom-right" | "top-left" | "top-right" | "bottom";

export interface CaptionSpec {
  text: string;
  from: Beats;
  /** Defaults to the next caption's start, or the shot's end. */
  to?: Beats;
  style?: CaptionStyle;
  place?: CaptionPlace;
}

export interface TakeSpec {
  id: string;
  /** Where the take ends; the last take ends with the shot. */
  until?: Beats;
}

export interface ShotSpec {
  id: string;
  title: string;
  anchor?: EventName;
  seconds: { min: number; nominal: number; max: number };
  captions: CaptionSpec[];
  takes: TakeSpec[];
  /** Flex rule 2: the shot's minimum once its second caption beat is dropped. */
  minOneCaption?: number;
  /** Flex rule 2: never shortened below nominal. */
  keepNominal?: boolean;
  /** Flex rule 2: merged into the tail of this shot when the gap is short. */
  mergeInto?: string;
  /** Flex rule 2: dropped when the gap is still short. */
  droppable?: boolean;
  /** Flex rule 3: holds the extra time, lowest first. */
  holdOrder?: number;
}

const secondsAt120 = (min: number, nominal: number, max: number) => ({ min: min * 2, nominal: nominal * 2, max: max * 2 });

/** Seconds the complete end card holds after the music's last sound (a picture choice, not a music number). */
export const END_HOLD_SECONDS = 2.2;
/** The picture fades to black over the film's last frames. */
export const FADE_OUT_FRAMES = 12;

/** VIDEO.md §3, bars at 120 BPM restated in seconds (x 2.0 s). */
export const shotSpecs: ShotSpec[] = [
  {
    id: "s1-problem",
    title: "Problem",
    anchor: "intro",
    seconds: secondsAt120(3, 4, 5),
    captions: [
      { text: "Vibe coding made pull requests cheap.", from: 0, to: 4, style: "title" },
      { text: "Reviewing them still isn’t.", from: 4, style: "title" },
    ],
    takes: [{ id: "queue" }],
  },
  {
    id: "s2-turn",
    title: "Turn",
    anchor: "riser",
    seconds: secondsAt120(2, 2, 3),
    captions: [{ text: "What if AI made you better,\nnot just faster?", from: 0, to: 7, style: "title" }],
    takes: [{ id: "lift" }],
  },
  {
    id: "s3-rules",
    title: "Rules first",
    anchor: "firstHit",
    seconds: secondsAt120(3, 4, 5),
    minOneCaption: 5,
    captions: [
      { text: "First, read the project’s rules.", from: 5, to: 10, place: "bottom-left" },
      { text: "Every rule, quoted from its source.", from: 10, place: "bottom-left" },
    ],
    // The window starts to rise a beat before the bar-6 downbeat it lands on (anticipate, then land).
    takes: [{ id: "logo", until: 3 }, { id: "establish", until: 10 }, { id: "rules" }],
  },
  {
    id: "s4-still-yours",
    title: "Still yours",
    seconds: secondsAt120(2, 2.5, 3),
    captions: [{ text: "Check the issue is still yours.", from: 0.5, to: 4, place: "bottom-left" }],
    takes: [{ id: "chips", until: 4 }, { id: "plan" }],
  },
  {
    id: "s5-legwork",
    title: "Legwork",
    seconds: secondsAt120(2, 2, 3),
    captions: [{ text: "Agents do the legwork,\non your own machine.", from: 1, place: "bottom-left" }],
    takes: [{ id: "board" }],
  },
  {
    id: "s6-try-first",
    title: "Try first",
    anchor: "lift",
    seconds: secondsAt120(3, 4, 5),
    keepNominal: true,
    holdOrder: 2,
    captions: [
      { text: "Answer first.", from: 2, to: 6, place: "bottom-left" },
      { text: "Then see the explanation.", from: 6, place: "bottom-left" },
    ],
    takes: [{ id: "establish", until: 2 }, { id: "answer", until: 6 }, { id: "reveal", until: 8 }, { id: "example" }],
  },
  {
    id: "s7-taste",
    title: "Taste",
    seconds: secondsAt120(3, 3, 4),
    keepNominal: true,
    captions: [
      { text: "Which way would you do it?", from: 0.5, to: 4, place: "bottom-right" },
      { text: "Taste grows by weighing trade-offs.", from: 4, place: "bottom-right" },
    ],
    takes: [{ id: "guess", until: 4 }, { id: "keep", until: 6 }, { id: "why" }],
  },
  {
    id: "s8-ask",
    title: "Ask",
    seconds: secondsAt120(2, 2, 3),
    droppable: true,
    captions: [{ text: "Stuck on a line? Ask about it.", from: 0.5, place: "top-left" }],
    takes: [{ id: "select", until: 4 }, { id: "answer" }],
  },
  {
    id: "s9-explain-back",
    title: "Explain it back",
    anchor: "climax",
    seconds: secondsAt120(4, 5, 6),
    keepNominal: true,
    holdOrder: 1,
    // The climax opens on the dark stage with its line as display type, then "lights on" to the window.
    captions: [
      { text: "Before it ships, explain it back.", from: 0, to: 4, style: "title" },
      { text: "Missed something? Fix it in a line.", from: 12, place: "bottom-left" },
    ],
    takes: [
      { id: "title", until: 4 },
      { id: "establish", until: 8 },
      { id: "question", until: 12 },
      { id: "partly", until: 14 },
      { id: "result" },
    ],
  },
  {
    id: "s10-predict",
    title: "Predict",
    seconds: secondsAt120(2, 2, 3),
    mergeInto: "s9-explain-back",
    captions: [{ text: "Predict what the maintainer will ask.", from: 0.5, place: "bottom-right" }],
    takes: [{ id: "tests", until: 3 }, { id: "line" }],
  },
  {
    id: "s11-your-words",
    title: "Your words",
    anchor: "accent",
    seconds: secondsAt120(3, 3.5, 4),
    minOneCaption: 4,
    holdOrder: 3,
    captions: [
      { text: "Your words. The project’s rules.", from: 1, to: 7, place: "bottom-right" },
      { text: "And what you didn’t test.", from: 7, place: "bottom-right" },
    ],
    takes: [{ id: "establish", until: 4 }, { id: "words", until: 8 }, { id: "checklist" }],
  },
  {
    id: "s12-send-one",
    title: "Send one",
    seconds: secondsAt120(2, 2.5, 3),
    captions: [{ text: "One Draft PR. Then stay for the review.", from: 1, place: "top-left" }],
    takes: [{ id: "dialog", until: 4 }, { id: "published" }],
  },
  {
    id: "s13-learn",
    title: "Learn",
    seconds: secondsAt120(2, 3, 3),
    captions: [{ text: "Learn from what they actually said.", from: 0.5, place: "bottom-left" }],
    takes: [{ id: "compare", until: 4 }, { id: "practice", until: 6 }, { id: "next" }],
  },
  {
    id: "s14-end",
    title: "End",
    anchor: "finalHit",
    seconds: { min: 3, nominal: 5.5, max: 8 },
    // The logo is the hero on the final chord (the shot's first beat), then moves up as the headline enters.
    captions: [{ text: "From vibe coding to knowing why.", from: 2, style: "title" }],
    takes: [{ id: "end-card" }],
  },
];

export interface Caption {
  shot: string;
  index: number;
  text: string;
  lines: string[];
  from: number;
  to: number;
  style: CaptionStyle;
  place: CaptionPlace;
}

export interface Take {
  id: string;
  from: number;
  to: number;
}

export interface Shot {
  id: string;
  title: string;
  from: number;
  to: number;
  anchor?: EventName;
  spec: ShotSpec;
  /** Both ends are fixed by anchors (flex rule 2, last sentence). */
  bounded: boolean;
  /** The first whole beat at or after `from`: beat 0 of the shot's captions and takes. */
  firstBeat: number;
  captions: Caption[];
  takes: Take[];
  /** Seconds, the limits the shot was laid out with (after any flex step). */
  limits: { min: number; nominal: number; max: number };
}

export interface Timeline {
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  shots: Shot[];
  captions: Caption[];
  /** The flex steps applied (rule 2 and 3), in words. */
  flexSteps: string[];
}

interface Working {
  spec: ShotSpec;
  min: number;
  nominal: number;
  max: number;
  captions: CaptionSpec[];
  takes: TakeSpec[];
  /** Missing optional anchor: start on a bar line (rule 4). */
  barStart: boolean;
}

/** Lays the shots on `music` by the flex rules. */
export function buildTimeline(music: Music = loadedMusic, specs: ShotSpec[] = shotSpecs): Timeline {
  const flexSteps: string[] = [];
  const anchored = (spec: ShotSpec) => spec.anchor !== undefined && music.events[spec.anchor] !== undefined;
  if (!anchored(specs[0])) throw new Error("The first shot needs an anchor that the analysis has.");

  // Phrases: runs of shots from one present anchor to the next.
  const phrases: { start: number; end: number; shots: Working[] }[] = [];
  for (const spec of specs) {
    const working: Working = {
      spec,
      min: spec.keepNominal ? spec.seconds.nominal : spec.seconds.min,
      nominal: spec.seconds.nominal,
      max: spec.seconds.max,
      captions: [...spec.captions],
      takes: [...spec.takes],
      barStart: spec.anchor !== undefined && !anchored(spec),
    };
    if (anchored(spec)) phrases.push({ start: music.events[spec.anchor!]!, end: 0, shots: [working] });
    else phrases.at(-1)!.shots.push(working);
  }
  const durationInFrames = music.durationInFrames + Math.round(END_HOLD_SECONDS * fps);
  phrases.forEach((phrase, index) => (phrase.end = phrases[index + 1]?.start ?? durationInFrames));

  const shots: Shot[] = [];
  for (const phrase of phrases) {
    const gap = (phrase.end - phrase.start) / fps;
    const sum = (key: "min" | "max") => phrase.shots.reduce((total, shot) => total + shot[key], 0);
    const bounded = phrase.shots.length === 1;

    // Rule 2: too short.
    if (gap < sum("min") - 1e-9 && !bounded) {
      const steps: (() => boolean)[] = [
        ...["s3-rules", "s11-your-words"].map((id) => () => {
          const shot = phrase.shots.find((s) => s.spec.id === id && s.captions.length > 1 && s.spec.minOneCaption);
          if (!shot) return false;
          shot.captions = shot.captions.slice(0, 1).map((caption) => ({ ...caption, to: undefined }));
          shot.min = shot.spec.minOneCaption!;
          flexSteps.push(`${id}: second caption beat dropped`);
          return true;
        }),
        () => {
          const index = phrase.shots.findIndex((s) => s.spec.mergeInto);
          const into = phrase.shots.find((s) => s.spec.id === phrase.shots[index]?.spec.mergeInto);
          if (index < 0 || !into) return false;
          const merged = phrase.shots[index];
          into.nominal += merged.nominal;
          into.max += merged.max;
          into.captions.push(...merged.captions.map((caption) => ({ ...caption, from: -4, to: undefined })));
          into.takes = [...into.takes.slice(0, -1), { ...into.takes.at(-1)!, until: -4 }, ...merged.takes];
          phrase.shots.splice(index, 1);
          flexSteps.push(`${merged.spec.id} merged into ${into.spec.id}`);
          return true;
        },
        () => {
          const index = phrase.shots.findIndex((s) => s.spec.droppable);
          if (index < 0) return false;
          flexSteps.push(`${phrase.shots[index].spec.id} dropped`);
          phrase.shots.splice(index, 1);
          return true;
        },
      ];
      for (const step of steps) {
        if (gap >= sum("min") - 1e-9) break;
        step();
      }
      if (gap < sum("min") - 1e-9)
        throw new Error(`The gap at frame ${phrase.start} (${gap.toFixed(2)} s) is shorter than its shots' minimums: re-edit the analysis segments.`);
    }

    // Rule 3: too long.
    let extra = Math.max(0, gap - sum("max"));
    if (extra > 1e-9 && !bounded) {
      const holders = phrase.shots.filter((s) => s.spec.holdOrder).sort((a, b) => a.spec.holdOrder! - b.spec.holdOrder!);
      if (!holders.length)
        throw new Error(`The gap at frame ${phrase.start} is longer than its shots' maximums: re-edit the analysis segments.`);
      holders[0].max += extra;
      flexSteps.push(`${holders[0].spec.id} holds ${extra.toFixed(2)} s longer`);
      extra = 0;
    }

    // Rule 1: share the gap by nominal, clamped.
    const length = new Map<Working, number>();
    let free = [...phrase.shots];
    let left = gap;
    for (let round = 0; round < phrase.shots.length + 1; round += 1) {
      const nominal = free.reduce((total, shot) => total + shot.nominal, 0);
      let clamped = false;
      for (const shot of free) {
        const share = (left * shot.nominal) / nominal;
        const value = bounded ? share : Math.min(shot.max, Math.max(shot.min, share));
        length.set(shot, value);
        if (value !== share) clamped = true;
      }
      if (!clamped) break;
      // Fix the clamped shots and share the rest again.
      const fixed = free.filter((shot) => {
        const share = (left * shot.nominal) / nominal;
        return length.get(shot)! !== share;
      });
      left -= fixed.reduce((total, shot) => total + length.get(shot)!, 0);
      free = free.filter((shot) => !fixed.includes(shot));
      if (!free.length) break;
    }

    // Snap each inner cut to a beat (a bar line after a missing anchor), keeping the limits.
    let from = phrase.start;
    let ideal = phrase.start;
    phrase.shots.forEach((shot, index) => {
      ideal += length.get(shot)! * fps;
      let to = phrase.end;
      if (index < phrase.shots.length - 1) {
        // Bar line first, then half-bar, then beat (a bar line only after a missing anchor, rule 4).
        const steps = phrase.shots[index + 1].barStart ? [music.beatsPerBar] : [music.beatsPerBar, music.beatsPerBar / 2, 1];
        const fits = (end: number) => {
          const seconds = (end - from) / fps;
          const restMin = phrase.shots.slice(index + 1).reduce((total, s) => total + s.min, 0);
          const restMax = phrase.shots.slice(index + 1).reduce((total, s) => total + s.max, 0);
          const rest = (phrase.end - end) / fps;
          return (
            seconds >= shot.min - 1e-9 && seconds <= shot.max + 1e-9 && rest >= restMin - 1e-9 && rest <= restMax + 1e-9
          );
        };
        let found: number | undefined;
        for (const step of steps) {
          const index0 = music.nearestBeatIndex(Math.round(ideal), step);
          found = [index0, index0 - step, index0 + step].map(music.beatFrame).find(fits);
          if (found !== undefined) break;
        }
        to = found ?? music.nearestBeat(Math.round(ideal), steps[0]);
      }
      const first = music.beatIndexAtOrAfter(from);
      shots.push(resolveShot(music, shot, from, to, first, bounded));
      from = to;
    });
  }

  const seconds = durationInFrames / fps;
  if (seconds < 75 || seconds > 90) throw new Error(`The cut is ${seconds.toFixed(2)} s: re-edit the analysis segments (75-90 s).`);
  return {
    fps,
    width: 1920,
    height: 1080,
    durationInFrames,
    shots,
    captions: shots.flatMap((shot) => shot.captions),
    flexSteps,
  };
}

function resolveShot(music: Music, shot: Working, from: number, to: number, firstBeat: number, bounded: boolean): Shot {
  const lastBeat = music.nearestBeatIndex(to, 0.5);
  const at = (beats: Beats | undefined, fallback: number) => {
    if (beats === undefined) return fallback;
    if (beats === "end") return to;
    const frame = beats >= 0 ? music.beatFrame(firstBeat + beats) : music.beatFrame(lastBeat + beats);
    return Math.min(to, Math.max(from, frame));
  };
  const captions: Caption[] = shot.captions.map((spec, index, all) => {
    const start = at(spec.from, from);
    const next = all[index + 1];
    return {
      shot: shot.spec.id,
      index,
      text: spec.text,
      lines: spec.text.split("\n"),
      from: start,
      to: at(spec.to, next ? at(next.from, to) : to),
      style: spec.style ?? "card",
      place: spec.place ?? "bottom-left",
    };
  });
  const takes: Take[] = [];
  let takeFrom = from;
  shot.takes.forEach((spec, index) => {
    const end = index === shot.takes.length - 1 ? to : at(spec.until, to);
    takes.push({ id: spec.id, from: takeFrom, to: end });
    takeFrom = end;
  });
  return {
    id: shot.spec.id,
    title: shot.spec.title,
    from,
    to,
    anchor: shot.spec.anchor,
    spec: shot.spec,
    bounded,
    firstBeat,
    captions,
    takes: takes.filter((take) => take.to > take.from),
    limits: { min: shot.min, nominal: shot.nominal, max: shot.max },
  };
}

/** The film's cut on the loaded music. */
export const timeline: Timeline = buildTimeline();

export const shotById = (id: string) => {
  const shot = timeline.shots.find((s) => s.id === id);
  if (!shot) throw new Error(`No shot "${id}".`);
  return shot;
};

export const takeOf = (shot: Shot, id: string) => {
  const take = shot.takes.find((t) => t.id === id);
  if (!take) throw new Error(`No take "${id}" in ${shot.id}.`);
  return take;
};
