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
import { focusRect, rackRect, type Mask } from "./look/dof.ts";
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

const REST = { width: 1340, x: 70, y: -48, rx: 5, ry: -9 };
/** The mirror rest (S11): the window left of centre, turned the other way, the caption on the right. */
const REST_LEFT = { width: 1300, x: -110, y: -64, rx: 5, ry: 9 };

/**
 * The establishing move of a section after the first (B's turn to face):
 * the window is in frame from the cut, turned away, and turns to face the
 * viewer over `beats` beats, landing on a beat.
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
  { at: beats, view: floating(rest.width, { x: rest.x, y: rest.y, rx: rest.rx, ry: rest.ry }), ease: "standard" },
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
const PLAN_SHARP: [number, number, number, number] = [291, 100, 1377, 420];

/** The review screen's right-hand panel (explanation, check): its cards start at x 1097-1099. */
const PANEL = { x0: 1099, x1: 1405 } as const;
/** A sharp band of the right-hand panel; its ramp sits in the panel's own left padding, so no diff token is half sharp. */
const panelBand = (y0: number, y1: number, feather = 14) => (a: number) => focusRect(PANEL.x0, y0, PANEL.x1, y1, feather, a);

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
        { at: 0, view: push(720, 440, 1.37, { ry: -3 }) },
        { at: 4, view: push(835, 442, 1.6, { ry: -2 }), ease: "drift" },
      ],
      // The card's rules sharp; the "files read" line and the next section under it go soft, under the caption
      // (the ramp sits in the gap under the third rule).
      dof: { mask: (a) => focusRect(318, 120, 1355, 642, 22, a), keys: [{ at: 0, amount: 1 }] },
    },
  },
  "s4-still-yours": {
    chips: {
      state: "v-before-you-start",
      // After the dialog's own scroll (1.50-2.47 s): the facts settled, the chips green.
      clipFrom: 2.55,
      keys: [
        { at: 0, view: push(720, 232, 1.55) },
        { at: 4, view: push(720, 232, 1.85), ease: "standard" },
      ],
      dof: { mask: (a) => focusRect(361, 160, 1079, 299, 22, a), keys: [{ at: 0, amount: 1 }] },
    },
    plan: {
      state: "v-plan",
      still: "plan",
      // It ends on the framing S5 opens on, the same picture (the board's clip starts on this plan), so the
      // section change is seamless and the approval follows on.
      // One push over the bar, landing on the S5 downbeat.
      keys: [
        { at: 0, view: PLAN_VIEW(1.46) },
        { at: 4, view: PLAN_VIEW(1.68), ease: "drift" },
      ],
      dof: { mask: (a) => focusRect(...PLAN_SHARP, 40, a), keys: [{ at: 0, amount: 1 }] },
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
      // The plan sharp, then the board's top rows; the cropped sidebar and the lower board (under the caption) soft.
      dof: { mask: rackRect(PLAN_SHARP, [291, 0, 1440, 575], 2, 7, 40), keys: [{ at: 0, amount: 1 }] },
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
        { at: 0, view: push(1250, 465, 1.6, { right: 120, ry: -5 }) },
        { at: 2, view: push(1250, 470, 1.92, { right: 120, ry: -4 }), ease: "drift" },
      ],
      dof: { mask: panelBand(330, 712), keys: [{ at: 0, amount: 1 }] },
    },
    reveal: {
      state: "v-quiz-attempt",
      // After the scroll to the grades: the AI-written reference, then "Got it".
      clipFrom: 5.05,
      macro: true,
      keys: [
        { at: 0, view: push(1250, 545, 2.3, { ry: -3 }) },
        { at: 2, view: push(1250, 550, 2.38, { ry: -3 }), ease: "drift" },
      ],
      dof: { mask: panelBand(330, 712), keys: [{ at: 0, amount: 1 }] },
    },
    example: {
      state: "v-quiz-attempt",
      // After the scroll to the example card (6.77-7.67 s).
      clipFrom: 7.75,
      keys: [
        { at: 0, view: push(1250, 520, 1.62, { right: 120, ry: -4 }) },
        { at: 6, view: push(1250, 520, 1.7, { right: 120, ry: -3 }), ease: "drift" },
      ],
      dof: { mask: panelBand(345, 712), keys: [{ at: 0, amount: 1 }] },
    },
  },
  "s7-taste": {
    guess: {
      state: "v-road-choice",
      // The guess types out; "Show the alternative" just before the cut (the reveal's scroll starts at 3.63 s).
      clipFrom: 0.35,
      rate: 1.25,
      clipTo: 3.18,
      keys: [
        { at: 0, view: push(1250, 420, 1.62, { right: 700, ry: 7 }) },
        { at: 2, view: push(1250, 420, 1.92, { right: 640, ry: 6 }), ease: "standard" },
      ],
      dof: { mask: panelBand(230, 560), keys: [{ at: 0, amount: 1 }] },
    },
    keep: {
      state: "v-road-choice",
      // After the scroll: the choice, and the click on "Keep this approach" late in the take.
      clipFrom: 4.65,
      macro: true,
      keys: [
        { at: 0, view: push(1250, 650, 2.45, { right: 600, bottom: 150, ry: 6 }) },
        { at: 2, view: push(1250, 650, 2.55, { right: 580, bottom: 150, ry: 5 }), ease: "drift" },
      ],
      // The question and its three choices sharp; the alternative's paragraph above them wholly soft.
      dof: { mask: panelBand(622, 720, 12), keys: [{ at: 0, amount: 1 }] },
    },
    why: {
      state: "v-road-choice",
      // After the scroll to the why (5.97-6.47 s): it types out and is saved.
      clipFrom: 6.5,
      rate: 1.3,
      macro: true,
      keys: [
        { at: 0, view: push(1250, 500, 2.0, { right: 620, ry: 6 }) },
        { at: 4, view: push(1250, 500, 2.08, { right: 610, ry: 5 }), ease: "drift" },
      ],
      dof: { mask: panelBand(395, 650), keys: [{ at: 0, amount: 1 }] },
    },
  },
  "s8-ask": {
    select: {
      state: "v-line-ask",
      // The two clicks select lines 10-15; "Explain this code" in the selection bar is pressed late in the take.
      clipFrom: 0.3,
      keys: [
        { at: 0, view: push(760, 600, 1.55, { bottom: 170, ry: 3 }) },
        { at: 4, view: push(770, 605, 1.62, { bottom: 160, ry: 2 }), ease: "drift" },
      ],
      // The selection and its bar sharp, the code above it soft under the caption.
      dof: { mask: (a) => focusRect(437, 482, 1075, 764, 22, a), keys: [{ at: 0, amount: 1 }] },
    },
    answer: {
      state: "v-line-ask",
      // After the panel's jump to the new question (3.10 s): the question's diff block, then the answer types out (stops before 4.27 s).
      clipFrom: 3.12,
      rate: 0.47,
      clipTo: 4.24,
      keys: [
        { at: 0, view: push(1150, 445, 1.6, { right: 120, ry: -3 }) },
        { at: 3, view: push(1250, 470, 1.85, { right: 120, ry: -5 }), ease: "drift" },
      ],
      // The question's diff block sharp, then a rack down to the answer as it types: the "Sample · prewritten"
      // line between them and the sticky module line above stay in the soft plane.
      dof: { mask: rackRect([PANEL.x0, 330, PANEL.x1, 440], [PANEL.x0, 553, PANEL.x1, 612], 0.6, 1.4, 6), keys: [{ at: 0, amount: 1 }] },
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
        { at: 4, view: push(1250, 305, 2.4, { ry: -3 }), ease: "drift" },
      ],
      dof: { mask: panelBand(170, 422), keys: [{ at: 0, amount: 1 }] },
    },
    partly: {
      state: "v-check",
      // After the reveal's scroll: the AI-written reference beside the answer, and "Partly".
      clipFrom: 8.75,
      macro: true,
      keys: [
        { at: 0, view: push(1250, 515, 2.35, { ry: -3 }) },
        { at: 2, view: push(1250, 518, 2.42, { ry: -3 }), ease: "drift" },
      ],
      dof: { mask: panelBand(380, 612), keys: [{ at: 0, amount: 1 }] },
    },
    result: {
      state: "v-check",
      // The result: the one-line correction, whole, in "What I had wrong", and the result line above it.
      clipFrom: 12.97,
      macro: true,
      keys: [
        { at: 0, view: push(1250, 430, 2.05, { ry: -3 }) },
        { at: 3, view: push(1250, 434, 2.12, { ry: -3 }), ease: "drift" },
      ],
      dof: { mask: panelBand(296, 556), keys: [{ at: 0, amount: 1 }] },
    },
  },
  "s10-predict": {
    tests: {
      state: "v-forecast",
      // "Tests" is picked on beat 3, then the forecast line types out.
      clipFrom: 0.2,
      macro: true,
      keys: [
        { at: 0, view: push(1250, 320, 1.9, { ry: -3 }) },
        { at: 3, view: push(1250, 322, 2.15, { ry: -3 }), ease: "standard" },
      ],
      dof: { mask: panelBand(180, 428), keys: [{ at: 0, amount: 1 }] },
    },
    line: {
      state: "v-forecast",
      // The saved prediction in the result, beside the result line.
      clipFrom: 2.15,
      macro: true,
      keys: [
        { at: 0, view: push(1250, 330, 2.55, { ry: -3 }) },
        { at: 4, view: push(1250, 332, 2.58, { ry: -3 }), ease: "drift" },
      ],
      dof: { mask: panelBand(318, 356, 10), keys: [{ at: 0, amount: 1 }] },
    },
  },
  "s11-your-words": {
    establish: {
      state: "v-draft-your-words",
      still: "top",
      float: true,
      sweepAt: 1,
      // A different entrance: the window comes from the left and faces right, the captions on the right.
      keys: establish(2, 0.6, REST_LEFT, -1),
    },
    words: {
      state: "v-draft-your-words",
      // "Use my explanation" fills the description, "Add my not-tested answer" fills Testing (before the scroll at
      // 2.50 s). The description sits under the card, so the explanation is seen landing in the PR; the window's
      // bottom edge leaves a strip of studio for the caption. Half-speed camera in the calm bars.
      clipFrom: 0.1,
      keys: [
        { at: 0, view: push(700, 440, 1.38, { bottom: 212 }) },
        { at: 4, view: push(700, 445, 1.46, { bottom: 206 }), ease: "drift" },
      ],
      dof: { mask: (a) => focusRect(291, 70, 1109, 810, 30, a), keys: [{ at: 0, amount: 1 }] },
    },
    checklist: {
      state: "v-draft-your-words",
      clipFrom: 5.92,
      keys: [
        { at: 0, view: push(840, 405, 1.42) },
        { at: 4, view: push(840, 440, 1.6), ease: "drift" },
      ],
      // The checklist's rows sharp, the cropped sidebar and the rows under the caption soft.
      dof: { mask: (a) => focusRect(316, 58, 1352, 470, 8, a), keys: [{ at: 0, amount: 1 }] },
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
        { at: 0, view: push(720, 560, 1.68, { ry: 3 }) },
        { at: 3, view: push(720, 590, 1.97, { ry: 2 }), ease: "standard" },
      ],
      dof: { mask: (a) => focusRect(500, 580, 940, 740, 22, a), keys: [{ at: 0, amount: 1 }] },
    },
    published: {
      state: "v-publish",
      clipFrom: 4.4,
      macro: true,
      // The card's left edge (its icon) stays in frame; its right side is plain tint.
      keys: [
        { at: 0, view: push(640, 232, 2.2) },
        { at: 4, view: push(640, 232, 2.5), ease: "standard" },
      ],
      // The published card sharp; the guide and the sample notice under it soft.
      dof: { mask: (a) => focusRect(291, 197, 1377, 300, 12, a), keys: [{ at: 0, amount: 1 }] },
    },
  },
  "s13-learn": {
    compare: {
      state: "v-forecast-vs-reality",
      // After the scroll to the comparison (1.10-2.00 s).
      clipFrom: 2.1,
      keys: [
        { at: 0, view: push(830, 368, 1.52) },
        { at: 3, view: push(830, 362, 1.72), ease: "drift" },
      ],
      dof: { mask: (a) => focusRect(291, 30, 1377, 520, 30, a), keys: [{ at: 0, amount: 1 }] },
    },
    practice: {
      state: "v-practice",
      // Days later the question comes back: the answer, "Got it" (frozen before the scroll at 1.13 s).
      clipFrom: 0.25,
      clipTo: 1.1,
      keys: [{ at: 0, view: push(650, 470, 1.32, { left: 110, bottom: 212 }) }],
      dof: { mask: (a) => focusRect(185, 100, 1440, 810, 30, a), keys: [{ at: 0, amount: 1 }] },
    },
    next: {
      state: "v-practice",
      // After the scroll: what you had wrong last time, and "Next review in 3 days" as the end framing.
      clipFrom: 1.5,
      macro: true,
      keys: [
        { at: 0, view: push(540, 540, 2.15) },
        { at: 3, view: push(520, 560, 2.4), ease: "drift" },
      ],
      // What you had wrong and the next review sharp; the "Next item" button, cut by the frame's edge, soft.
      dof: { mask: (a) => focusRect(285, 455, 770, 600, 18, a), keys: [{ at: 0, amount: 1 }] },
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
