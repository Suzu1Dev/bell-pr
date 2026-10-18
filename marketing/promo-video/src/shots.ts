/**
 * How each product take is filmed: which captured state, from which clip
 * second, and the camera (src/look/camera.ts) in beats from the take's
 * start. Every position is in capture CSS px of the 1440x810 viewport,
 * read off the footage (targets.json boxes and the frames themselves).
 *
 * The grammar (owner's look decision, VIDEO.md): each section opens on
 * variant B's whole floating window (all four edges, turned to face the
 * viewer, contact shadow; "establish" takes, with the "Sample project"
 * badge in view), then cuts on the beat to variant C's push-ins on the
 * detail, with two-plane depth of field that keeps the subject sharp and
 * leaves the caption a quiet place to sit. Each section has one
 * beat-locked push (15-25% over one or two beats, landing on a downbeat),
 * and the compositions change from section to section: the panel against
 * the window's right edge (S6), the window on the left with the studio
 * and the caption on the right (S7), the selection mid-frame (S8), macros
 * of the decisive line (S6, S7, S9, S10, S12, S13), the window's bottom
 * edge over a strip of studio (S11, S13).
 *
 * Clip times avoid the capture's own scrolls and reflows: a take starts
 * after one and ends before the next (`clipTo` freezes a take on its last
 * settled frame), so nothing jumps inside a take.
 */
import { focusRect, rackRect, type Feather, type Mask, type Rect } from "./look/dof.ts";
import { floating, push, type Key } from "./look/camera.ts";

export interface TakeLook {
  state: string;
  /** A still (file name without extension) or a clip starting at `clipFrom` seconds. */
  still?: string;
  clipFrom?: number;
  /** Clip seconds per film second (1 = real time). */
  rate?: number;
  /** The clip holds this frame from here on (seconds), so a scroll that follows stays out of the take. */
  clipTo?: number;
  keys: Key[];
  /** A whole floating window: contact shadow and one light sweep. */
  float?: boolean;
  /** Beats from the take's start where the window's light sweep starts. */
  sweepAt?: number;
  /** A macro on the decisive line: magnification up to MACRO_MAX_M (src/look.test.ts). */
  macro?: boolean;
  /**
   * The sharp plane (capture CSS px; one rect or a union of rects, src/look/dof.ts) and how much of it applies (0..1),
   * keyed in beats; the mask may move with the beats. Every feather sits in a gutter of the UI (scripts/check-dof.mjs).
   */
  dof?: { mask: (amount: number, beats: number) => Mask; keys: { at: number; amount: number }[] };
  /** Draw the capture's pointer moves and clicks (default: on for clips). */
  pointer?: boolean;
  /** Camera breathing after the last key: scale per bar (default 1.2%). */
  breathe?: number;
}

/** Pushes stay at or under 2.0 output px per capture px (one DPR-4 pixel per pixel of the 4K master); a macro may go to 2.6. */
export const PUSH_MAX_M = 2.0;
export const MACRO_MAX_M = 2.6;

const REST = { width: 1320, x: 80, y: -72, rx: 5, ry: -9 };

/**
 * The establishing move of a section after the first (B's turn to face):
 * the window is in frame from the cut, turned away, and turns to face the
 * viewer over `beats` beats, landing on a beat. It leaves the cut already
 * moving (`arrive`: fast in, long settle), since every section starts on a
 * downbeat (lookdev STYLE-GUIDE §4.3).
 */
const establish = (beats = 3, amount = 1, rest = REST, from = 1): Key[] => [
  {
    at: 0,
    view: floating(rest.width * (1 - 0.06 * amount), {
      x: rest.x + 150 * amount * from,
      y: rest.y + 50 * amount,
      rx: rest.rx + 6 * amount,
      ry: rest.ry - 15 * amount * from,
    }),
  },
  { at: beats, view: floating(rest.width, { x: rest.x, y: rest.y, rx: rest.rx, ry: rest.ry }), ease: "arrive" },
];

/**
 * The first product shot rises in from below the frame as the logo goes, a
 * beat before the bar-6 downbeat it lands on (heroGlide stretched over 18
 * frames), then turns to face, landing on the next bar line.
 */
const riseIn = (): Key[] => [
  { at: 0, view: floating(REST.width * 0.94, { x: REST.x + 150, y: REST.y + 640, rx: 18, ry: -24 }) },
  { at: 1, view: floating(REST.width * 0.97, { x: REST.x + 90, y: REST.y - 10, rx: 11, ry: -18 }), ease: "glide" },
  { at: 5, view: floating(REST.width, { x: REST.x, y: REST.y, rx: REST.rx, ry: REST.ry }), ease: "standard" },
];

/** The plan waiting for approval, where S4 ends and S5 begins: the same view and sharp plane on both sides of the cut. */
const PLAN_VIEW = (m: number) => push(910, 252, m);
/** The plan card: its feathers in the gaps above it (under the stepper) and under the approve row. */
const PLAN_SHARP: Rect = [291, 150, 1377, 336];
const PLAN_FEATHER: Feather = [40, 24, 40, 24];
/**
 * The board's columns from their headers down (the stepper and the run's summary card above them soft): "Done" and
 * the team's messages to the window's bottom, "To do" and "In progress" (empty by then) to y 560, so the caption
 * under them sits on the soft plane. The two planes meet in the gutter between "In progress" and "Done".
 */
const BOARD_LEFT: Rect = [291, 296, 790, 560];
const BOARD_LEFT_FEATHER: Feather = [20, 18, 6, 30];
const BOARD_RIGHT: Rect = [803, 296, 1440, 810];
const BOARD_RIGHT_FEATHER: Feather = [6, 18, 0, 0];

/** The review screen's right-hand panel (explanation, check, ask): its text starts at x 1097-1099. */
const PANEL = { x0: 1096, x1: 1405 } as const;
/**
 * A sharp band of the right-hand panel. The left feather sits in the gutter between the diff and the panel; the
 * top and bottom feathers default to the gaps above and below (the sticky module line ends at y 323).
 */
const panelBand = (y0: number, y1: number, top = 7, bottom = 14) => (a: number) =>
  focusRect(PANEL.x0, y0, PANEL.x1, y1, [14, top, 14, bottom], a);
/** The `right` that centres the panel (x 1250) on the frame at magnification m: the window's right edge in frame. */
const panelCentred = (m: number) => 960 - (1440 - 1250) * m;

/** A look for each take, by shot id and take id. */
export const looks: Record<string, Record<string, TakeLook>> = {
  "s3-rules": {
    establish: {
      state: "v-rules-card",
      still: "overview",
      float: true,
      sweepAt: 5,
      keys: riseIn(),
    },
    rules: {
      state: "v-rules-card",
      still: "card",
      keys: [
        { at: 0, view: push(810, 446, 1.53, { ry: -3 }) },
        { at: 4, view: push(835, 445, 1.6, { ry: -2 }), ease: "arrive" },
      ],
      // The whole rules card sharp down to the third rule; "Files BELL PR read" and the next section soft, under
      // the caption (the ramp sits in the gap between the third rule and that line).
      dof: { mask: (a) => focusRect(314, 120, 1355, 638, [18, 22, 22, 16], a), keys: [{ at: 0, amount: 1 }] },
    },
  },
  "s4-still-yours": {
    chips: {
      state: "v-before-you-start",
      // After the dialog's own scroll (1.50-2.47 s): the facts settled, the chips green.
      clipFrom: 2.55,
      keys: [
        { at: 0, view: push(720, 232, 1.69) },
        { at: 4, view: push(720, 232, 1.85), ease: "arrive" },
      ],
      // The "Before you start" box; its top ramp sits in the gap under the field's hint line.
      dof: { mask: (a) => focusRect(361, 158, 1079, 299, [22, 7, 22, 20], a), keys: [{ at: 0, amount: 1 }] },
    },
    plan: {
      state: "v-plan",
      still: "plan",
      // It ends on the framing S5 opens on, the same picture (the board's clip starts on this plan), so the
      // section change is seamless and the approval follows on. One push over the bar, landing on the S5 downbeat.
      keys: [
        { at: 0, view: PLAN_VIEW(1.61) },
        { at: 4, view: PLAN_VIEW(1.68), ease: "arrive" },
      ],
      dof: { mask: (a) => focusRect(...PLAN_SHARP, PLAN_FEATHER, a), keys: [{ at: 0, amount: 1 }] },
    },
  },
  "s5-legwork": {
    board: {
      state: "v-board",
      // Slowed so the plan folds on beat 3 (759) and the board's moves fall a beat apart (777-850).
      clipFrom: 0.06,
      rate: 0.617,
      // On the plan (S4's last framing): the approval, the person's call; then the camera pulls back as the plan
      // folds into the board.
      keys: [
        { at: 0, view: PLAN_VIEW(1.68) },
        { at: 2, view: PLAN_VIEW(1.7), ease: "drift" },
        { at: 7, view: push(900, 410, 1.45), ease: "drift" },
      ],
      // The plan sharp, then the board's columns; the stepper, the run's card and the emptied columns' lower half soft.
      dof: {
        mask: (a, beats) => [
          rackRect(PLAN_SHARP, BOARD_LEFT, 2, 7, PLAN_FEATHER, BOARD_LEFT_FEATHER)(a, beats),
          // The right plane starts as the plan's right part (inside the plan's plane) and keeps its left edge in the gutter.
          rackRect([803, PLAN_SHARP[1], PLAN_SHARP[2], PLAN_SHARP[3]], BOARD_RIGHT, 2, 7, PLAN_FEATHER, BOARD_RIGHT_FEATHER)(a, beats),
        ],
        keys: [{ at: 0, amount: 1 }],
      },
    },
  },
  "s6-try-first": {
    establish: {
      state: "v-quiz-attempt",
      clipFrom: 0,
      float: true,
      sweepAt: 0,
      keys: establish(2),
    },
    answer: {
      state: "v-quiz-attempt",
      // The answer types out inside the push, then "Think so" and "Show answer" (before the reveal's scroll at 4.37 s).
      clipFrom: 1.2,
      rate: 1.25,
      clipTo: 4.08,
      keys: [
        { at: 0, view: push(1250, 468, 1.81, { right: 120, ry: -5 }) },
        { at: 2, view: push(1250, 470, 1.92, { right: 120, ry: -4 }), ease: "arrive" },
      ],
      dof: { mask: panelBand(331, 712), keys: [{ at: 0, amount: 1 }] },
    },
    reveal: {
      state: "v-quiz-attempt",
      // After the scroll to the grades: the AI-written reference, then "Got it" (held before the card collapses and
      // the panel's notice under it slides behind the sticky footer, 6.15 s).
      clipFrom: 5.05,
      clipTo: 6.13,
      macro: true,
      keys: [
        { at: 0, view: push(1250, 545, 2.3, { ry: -3 }) },
        { at: 2, view: push(1250, 550, 2.38, { ry: -3 }), ease: "arrive" },
      ],
      dof: { mask: panelBand(331, 712), keys: [{ at: 0, amount: 1 }] },
    },
    example: {
      state: "v-quiz-attempt",
      // After the scroll to the example card (6.77-7.67 s).
      clipFrom: 7.75,
      keys: [
        { at: 0, view: push(1250, 520, 1.62, { right: 120, ry: -4 }) },
        { at: 6, view: push(1250, 520, 1.7, { right: 120, ry: -3 }), ease: "arrive" },
      ],
      dof: { mask: panelBand(331, 712), keys: [{ at: 0, amount: 1 }] },
    },
  },
  "s7-taste": {
    guess: {
      state: "v-road-choice",
      // The guess finishes typing; "Show the alternative" is pressed on the take's last frames (the reveal's
      // scroll starts at 3.63 s).
      clipFrom: 1.75,
      rate: 1.2,
      clipTo: 3.18,
      keys: [
        { at: 0, view: push(1250, 440, 1.8, { right: 680, ry: 7 }) },
        { at: 2, view: push(1250, 440, 1.92, { right: 650, ry: 6 }), ease: "arrive" },
      ],
      dof: { mask: panelBand(331, 560), keys: [{ at: 0, amount: 1 }] },
    },
    alternative: {
      state: "v-road-choice",
      macro: true,
      // After the scroll: the revealed alternative (a fixed interval with jitter, and when it would be the better
      // choice), whole and sharp, before the pointer moves to the choice at 5.10 s.
      clipFrom: 4.7,
      rate: 0.15,
      keys: [
        { at: 0, view: push(1250, 482, 1.98, { right: 640, ry: 6 }) },
        { at: 4, view: push(1250, 484, 2.1, { right: 620, ry: 5 }), ease: "arrive" },
      ],
      dof: { mask: panelBand(360, 606, 18, 18), keys: [{ at: 0, amount: 1 }] },
    },
    keep: {
      state: "v-road-choice",
      // The pointer moves to "Keep this approach" and clicks. "It depends" under it, which the panel's sticky footer
      // cuts, is in the soft plane with the footer; the window's bottom edge leaves a strip of studio.
      clipFrom: 5.1,
      rate: 0.7,
      macro: true,
      keys: [
        { at: 0, view: push(1250, 668, 2.45, { right: 600, bottom: 150, ry: 6 }) },
        { at: 2, view: push(1250, 668, 2.5, { right: 590, bottom: 146, ry: 5 }), ease: "arrive" },
      ],
      // The question and its first row of choices sharp; the paragraph above and "It depends" below soft.
      dof: { mask: panelBand(626, 690, 26, 8), keys: [{ at: 0, amount: 1 }] },
    },
    why: {
      state: "v-road-choice",
      // After the scroll to the why (5.97-6.47 s): it finishes typing and is saved.
      clipFrom: 7.4,
      rate: 1.45,
      macro: true,
      keys: [
        { at: 0, view: push(1250, 556, 2.2, { right: 620, ry: 6 }) },
        { at: 2, view: push(1250, 556, 2.3, { right: 610, ry: 5 }), ease: "arrive" },
      ],
      dof: { mask: panelBand(496, 618, 14, 14), keys: [{ at: 0, amount: 1 }] },
    },
  },
  "s8-ask": {
    select: {
      state: "v-line-ask",
      // The second click selects lines 10-15, then "Explain this code" in the selection bar is pressed.
      clipFrom: 1.45,
      keys: [
        { at: 0, view: push(760, 615, 1.55, { bottom: 170, ry: 3 }) },
        { at: 2, view: push(765, 615, 1.62, { bottom: 165, ry: 2 }), ease: "arrive" },
      ],
      // The selected lines with the code around them and the selection bar sharp; the code above, the file list and
      // the panel soft (the caption sits over the code above).
      dof: { mask: (a) => focusRect(436, 476, 1078, 758, [16, 11, 16, 16], a), keys: [{ at: 0, amount: 1 }] },
    },
    question: {
      state: "v-line-ask",
      // The question arrives with its diff block (the lines asked about) while the agent reads the change; it
      // holds before the panel's jump at 3.10 s.
      clipFrom: 2.75,
      rate: 0.27,
      clipTo: 3.07,
      macro: true,
      keys: [
        { at: 0, view: push(1250, 430, 2.2, { right: panelCentred(2.2), ry: -3 }) },
        { at: 2, view: push(1250, 432, 2.3, { right: panelCentred(2.3), ry: -3 }), ease: "arrive" },
      ],
      dof: { mask: panelBand(336, 530, 12, 20), keys: [{ at: 0, amount: 1 }] },
    },
    answer: {
      state: "v-line-ask",
      // The answer, whole: its first paragraph complete on the frame where the rest of the reply arrives (4.27 s),
      // held. The paragraph under it (whose heading runs into its first line) stays soft.
      clipFrom: 4.27,
      clipTo: 4.27,
      macro: true,
      keys: [
        { at: 0, view: push(1250, 386, 2.3, { right: panelCentred(2.3), ry: -3 }) },
        { at: 4, view: push(1250, 386, 2.45, { right: panelCentred(2.45), ry: -3 }), ease: "arrive" },
      ],
      dof: { mask: panelBand(350, 420, 18, 18), keys: [{ at: 0, amount: 1 }] },
    },
  },
  "s9-explain-back": {
    establish: {
      state: "v-check",
      // Lights on: the closed book (no explanation tabs, the diff stays) while the summary types; then the push lands on the crash.
      clipFrom: 0,
      rate: 0.8,
      float: true,
      sweepAt: 0.5,
      keys: [
        ...establish(2, 0.8),
        { at: 4, view: floating(REST.width * 1.17, { x: REST.x - 60, y: REST.y + 10, rx: 3, ry: -6 }), ease: "standard" },
      ],
    },
    question: {
      state: "v-check",
      // The retry.ts question is answered, then "Think so" (before the scroll to the next question at 4.97 s).
      clipFrom: 2.75,
      rate: 0.9,
      macro: true,
      keys: [
        { at: 0, view: push(1250, 300, 2.3, { ry: -3 }) },
        { at: 4, view: push(1250, 305, 2.4, { ry: -3 }), ease: "arrive" },
      ],
      dof: { mask: panelBand(166, 424, 8, 12), keys: [{ at: 0, amount: 1 }] },
    },
    partly: {
      state: "v-check",
      // After the reveal's scroll: the answer, the AI-written reference beside it, and "Partly".
      clipFrom: 8.75,
      macro: true,
      keys: [
        { at: 0, view: push(1250, 478, 2.1, { ry: -3 }) },
        { at: 2, view: push(1250, 480, 2.18, { ry: -3 }), ease: "arrive" },
      ],
      dof: { mask: panelBand(343, 606, 14, 10), keys: [{ at: 0, amount: 1 }] },
    },
    result: {
      state: "v-check",
      // The result: the one-line correction, whole, in "What I had wrong", and the result line above it.
      clipFrom: 12.97,
      macro: true,
      keys: [
        { at: 0, view: push(1250, 430, 2.05, { ry: -3 }) },
        { at: 3, view: push(1250, 434, 2.12, { ry: -3 }), ease: "arrive" },
      ],
      dof: { mask: panelBand(292, 556, 12, 10), keys: [{ at: 0, amount: 1 }] },
    },
  },
  "s10-predict": {
    tests: {
      state: "v-forecast",
      // "Tests" is picked on beat 3, then the forecast line types out.
      clipFrom: 0.2,
      macro: true,
      keys: [
        { at: 0, view: push(1250, 321, 1.88, { ry: -3 }) },
        { at: 3, view: push(1250, 322, 2.0, { ry: -3 }), ease: "arrive" },
      ],
      dof: { mask: panelBand(178, 425, 8, 20), keys: [{ at: 0, amount: 1 }] },
    },
    line: {
      state: "v-forecast",
      // The saved prediction beside the check's result line, both sharp.
      clipFrom: 2.15,
      macro: true,
      keys: [
        { at: 0, view: push(1250, 300, 2.32, { ry: -3 }) },
        { at: 4, view: push(1250, 302, 2.42, { ry: -3 }), ease: "arrive" },
      ],
      dof: { mask: panelBand(238, 362, 12, 18), keys: [{ at: 0, amount: 1 }] },
    },
  },
  "s11-your-words": {
    establish: {
      state: "v-draft-your-words",
      still: "top",
      float: true,
      sweepAt: 1,
      keys: establish(2, 0.6),
    },
    checklist: {
      state: "v-draft-your-words",
      // The maintainer checklist's last rows, held on the frame where the capture's scroll passes them (5.43 s): "A
      // reviewable change", "Disclosing AI help" with the project's rule, "Understanding check: You explained the
      // change back", every one OK, sharp; the rows above (with the sample GitHub facts) and the header with its
      // read times out of frame or soft, the reviewability snapshot under them soft for the caption. Half-speed
      // camera in the calm bars.
      clipFrom: 5.433,
      clipTo: 5.433,
      keys: [
        { at: 0, view: push(834, 446, 1.7) },
        { at: 4, view: push(834, 446, 1.78), ease: "arrive" },
      ],
      dof: { mask: (a) => focusRect(316, 268, 1352, 600, [20, 6, 20, 30], a), keys: [{ at: 0, amount: 1 }] },
    },
    words: {
      state: "v-draft-your-words",
      // The card after "Use my explanation": the not-tested answer, then "Add my not-tested answer to Testing" and
      // its "In the description" (before the scroll at 2.50 s). The whole card sharp, the editor under it soft.
      clipFrom: 1.0,
      rate: 0.6,
      keys: [
        { at: 0, view: push(700, 312, 1.95) },
        { at: 4, view: push(702, 313, 2.0), ease: "arrive" },
      ],
      dof: { mask: (a) => focusRect(291, 92, 1112, 462, [20, 20, 16, 18], a), keys: [{ at: 0, amount: 1 }] },
    },
  },
  "s12-send-one": {
    dialog: {
      state: "v-publish",
      // After the dialog's scroll to its checks: the pacing line, "Every check passes.", the click on "Open the sample
      // Draft PR" on the last frames (the dialog closes at 3.83 s, after the cut).
      clipFrom: 2.3,
      rate: 0.625,
      keys: [
        { at: 0, view: push(720, 600, 1.75, { ry: 3 }) },
        { at: 3, view: push(720, 610, 1.97, { ry: 2 }), ease: "arrive" },
      ],
      // The dialog under its preview: the preview's last line, which its own scroll box cuts, stays soft.
      dof: { mask: (a) => focusRect(506, 582, 935, 742, [10, 12, 12, 12], a), keys: [{ at: 0, amount: 1 }] },
    },
    published: {
      state: "v-publish",
      clipFrom: 4.4,
      macro: true,
      // The card's left edge (its icon) stays in frame; its right side is plain tint.
      keys: [
        { at: 0, view: push(640, 232, 2.34) },
        { at: 4, view: push(640, 232, 2.5), ease: "arrive" },
      ],
      // The published card sharp; the guide and the sample notice under it soft.
      dof: { mask: (a) => focusRect(291, 197, 1377, 300, 12, a), keys: [{ at: 0, amount: 1 }] },
    },
  },
  "s13-learn": {
    compare: {
      state: "v-forecast-vs-reality",
      // After the scroll to the comparison (1.10-2.00 s): "Your forecast: Tests" and the maintainer's tags on the
      // first comment ("Tests", "Saw it coming") sharp; the comments' text soft (its inline code shows raw backticks,
      // a product fix in the known issues).
      clipFrom: 2.1,
      keys: [
        { at: 0, view: push(831, 312, 1.74) },
        { at: 3, view: push(831, 312, 1.82), ease: "arrive" },
      ],
      dof: {
        mask: (a) => [focusRect(300, 56, 655, 222, [10, 10, 12, 20], a), focusRect(676, 290, 1365, 362, [6, 6, 14, 20], a)],
        keys: [{ at: 0, amount: 1 }],
      },
    },
    practice: {
      state: "v-practice",
      // Days later the question comes back on the Learning page ("Sample practice", from your understanding check):
      // the answer, the reference, what you had wrong last time, "Next review in 3 days" (after "Got it", before
      // the scroll at 1.13 s). The whole card sharp, the sidebar soft.
      clipFrom: 0.85,
      clipTo: 1.1,
      rate: 0.08,
      keys: [
        { at: 0, view: push(706, 424, 1.46) },
        { at: 4, view: push(700, 432, 1.52), ease: "arrive" },
      ],
      dof: { mask: (a) => focusRect(264, 84, 1405, 752, [22, 20, 14, 20], a), keys: [{ at: 0, amount: 1 }] },
    },
  },
};

/** The states a render needs, for calculateMetadata. */
export const footageStates = () => {
  const out = new Map<string, boolean>();
  for (const shot of Object.values(looks))
    for (const look of Object.values(shot)) out.set(look.state, (out.get(look.state) ?? false) || look.still === undefined);
  return [...out].map(([state, clip]) => ({ state, clip }));
};
