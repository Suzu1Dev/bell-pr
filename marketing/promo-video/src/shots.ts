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
 * leaves the caption a quiet place to sit.
 */
import { focusRect } from "./look/dof.ts";
import { floating, push, type Key } from "./look/camera.ts";

export interface TakeLook {
  state: string;
  /** A still (file name without extension) or a clip starting at `clipFrom` seconds. */
  still?: string;
  clipFrom?: number;
  /** Clip seconds per film second (1 = real time). */
  rate?: number;
  keys: Key[];
  /** A whole floating window: contact shadow and one light sweep. */
  float?: boolean;
  /** Beats from the take's start where the window's light sweep starts. */
  sweepAt?: number;
  /** Sharp-plane mask (capture CSS px) and how much of it applies (0..1), keyed in beats. */
  dof?: { mask: (amount: number) => string[]; keys: { at: number; amount: number }[] };
  /** Draw the capture's pointer moves and clicks (default: on for clips). */
  pointer?: boolean;
  /** Camera breathing after the last key: scale per bar (default 1.2%). */
  breathe?: number;
}

const REST = { width: 1340, x: 70, y: -30, rx: 5, ry: -9 };

/**
 * The establishing move of a section after the first (B's turn to face):
 * the window is in frame from the cut, turned away, and turns to face the
 * viewer over four beats, landing on a downbeat.
 */
const establish = (beats = 3, amount = 1): Key[] => [
  {
    at: 0,
    view: floating(REST.width * (1 - 0.06 * amount), {
      x: REST.x + 150 * amount,
      y: REST.y + 50 * amount,
      rx: REST.rx + 6 * amount,
      ry: REST.ry - 15 * amount,
    }),
  },
  { at: beats, view: floating(REST.width, { x: REST.x, y: REST.y, rx: REST.rx, ry: REST.ry }), ease: "standard" },
];

/** The first product shot rises in from below the frame right after the logo has gone, then turns to face. */
const riseIn = (): Key[] => [
  { at: 0, view: floating(REST.width * 0.94, { x: REST.x + 150, y: REST.y + 860, rx: 18, ry: -24 }) },
  { at: 2, view: floating(REST.width * 0.97, { x: REST.x + 90, y: REST.y + 20, rx: 11, ry: -18 }), ease: "glide" },
  { at: 5, view: floating(REST.width, { x: REST.x, y: REST.y, rx: REST.rx, ry: REST.ry }), ease: "standard" },
];

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
        { at: 0, view: push(820, 470, 1.42, { ry: -4 }) },
        { at: 5, view: push(835, 470, 1.52, { ry: -2 }), ease: "drift" },
      ],
      dof: { mask: (a) => focusRect(300, 120, 1370, 690, 70, a), keys: [{ at: 0, amount: 1 }] },
    },
  },
  "s4-still-yours": {
    chips: {
      state: "v-before-you-start",
      clipFrom: 1.5,
      keys: [
        { at: 0, view: push(720, 380, 1.3) },
        { at: 3.5, view: push(720, 250, 1.75), ease: "standard" },
      ],
      dof: { mask: (a) => focusRect(361, 160, 1079, 299, 80, a), keys: [{ at: 1.5, amount: 0 }, { at: 3.5, amount: 1 }] },
    },
    plan: {
      state: "v-plan",
      still: "plan",
      keys: [
        { at: 0, view: push(834, 320, 1.42) },
        { at: 4, view: push(850, 320, 1.5), ease: "drift" },
      ],
      dof: { mask: (a) => focusRect(291, 150, 1377, 600, 70, a), keys: [{ at: 0, amount: 1 }] },
    },
  },
  "s5-legwork": {
    board: {
      state: "v-board",
      clipFrom: 0,
      keys: [
        { at: 0, view: push(850, 320, 1.5) },
        { at: 3, view: push(834, 360, 1.36), ease: "standard" },
        { at: 8, view: push(834, 370, 1.4), ease: "drift" },
      ],
    },
  },
  "s6-try-first": {
    establish: {
      state: "v-quiz-attempt",
      clipFrom: 0,
      float: true,
      sweepAt: 3,
      keys: establish(),
    },
    answer: {
      state: "v-quiz-attempt",
      clipFrom: 3.1,
      keys: [
        { at: 0, view: push(1251, 500, 1.85, { right: 120, ry: -5 }) },
        { at: 6, view: push(1251, 520, 1.9, { right: 120, ry: -4 }), ease: "drift" },
      ],
      dof: { mask: (a) => focusRect(1085, 120, 1420, 800, 50, a), keys: [{ at: 0, amount: 1 }] },
    },
    example: {
      state: "v-quiz-attempt",
      clipFrom: 7.6,
      keys: [
        { at: 0, view: push(1251, 470, 1.9, { right: 120, ry: -4 }) },
        { at: 3, view: push(1251, 470, 1.95, { right: 120, ry: -3 }), ease: "drift" },
      ],
      dof: { mask: (a) => focusRect(1085, 120, 1420, 800, 50, a), keys: [{ at: 0, amount: 1 }] },
    },
  },
  "s7-taste": {
    guess: {
      state: "v-road-choice",
      clipFrom: 0.35,
      keys: [
        { at: 0, view: push(1180, 470, 1.45, { right: 120, ry: -6 }) },
        { at: 5, view: push(1230, 470, 1.6, { right: 120, ry: -5 }), ease: "drift" },
      ],
      dof: { mask: (a) => focusRect(1085, 120, 1420, 800, 50, a), keys: [{ at: 0, amount: 0.6 }, { at: 2, amount: 1 }] },
    },
    keep: {
      state: "v-road-choice",
      clipFrom: 5.2,
      keys: [
        { at: 0, view: push(1251, 520, 1.85, { right: 120, ry: -4 }) },
        { at: 6, view: push(1251, 540, 1.9, { right: 120, ry: -3 }), ease: "drift" },
      ],
      dof: { mask: (a) => focusRect(1085, 120, 1420, 800, 50, a), keys: [{ at: 0, amount: 1 }] },
    },
  },
  "s8-ask": {
    select: {
      state: "v-line-ask",
      clipFrom: 0.5,
      keys: [
        { at: 0, view: push(760, 560, 1.6, { ry: 3 }) },
        { at: 3, view: push(770, 570, 1.66, { ry: 2 }), ease: "drift" },
      ],
      dof: { mask: (a) => focusRect(437, 470, 1075, 700, 60, a), keys: [{ at: 0, amount: 1 }] },
    },
    answer: {
      state: "v-line-ask",
      clipFrom: 2.3,
      keys: [
        { at: 0, view: push(1000, 420, 1.4, { ry: -3 }) },
        { at: 4, view: push(1220, 380, 1.6, { right: 120, ry: -5 }), ease: "drift" },
      ],
      dof: { mask: (a) => focusRect(880, 100, 1420, 760, 60, a), keys: [{ at: 1, amount: 0 }, { at: 3, amount: 1 }] },
    },
  },
  "s9-explain-back": {
    establish: {
      state: "v-check",
      still: "closed-book",
      float: true,
      sweepAt: 2,
      keys: establish(2),
    },
    summary: {
      state: "v-check",
      clipFrom: 0.3,
      keys: [
        { at: 0, view: push(1251, 320, 1.85, { right: 120, ry: -5 }) },
        { at: 3, view: push(1251, 330, 1.9, { right: 120, ry: -4 }), ease: "drift" },
      ],
      dof: { mask: (a) => focusRect(1085, 120, 1420, 800, 50, a), keys: [{ at: 0, amount: 1 }] },
    },
    answer: {
      state: "v-check",
      clipFrom: 2.75,
      keys: [
        { at: 0, view: push(1170, 330, 1.5, { right: 120, ry: -6 }) },
        { at: 6, view: push(1230, 420, 1.7, { right: 120, ry: -4 }), ease: "drift" },
      ],
      dof: { mask: (a) => focusRect(1085, 120, 1420, 800, 50, a), keys: [{ at: 0, amount: 1 }] },
    },
    grade: {
      state: "v-check",
      clipFrom: 9.3,
      keys: [
        { at: 0, view: push(1251, 520, 1.85, { right: 120, ry: -4 }) },
        { at: 4, view: push(1251, 540, 1.9, { right: 120, ry: -3 }), ease: "drift" },
      ],
      dof: { mask: (a) => focusRect(1085, 120, 1420, 800, 50, a), keys: [{ at: 0, amount: 1 }] },
    },
  },
  "s10-predict": {
    forecast: {
      state: "v-forecast",
      clipFrom: 0.25,
      keys: [
        { at: 0, view: push(1130, 330, 1.4, { right: 120, ry: -6 }) },
        { at: 7, view: push(1200, 400, 1.6, { right: 120, ry: -4 }), ease: "drift" },
      ],
      dof: { mask: (a) => focusRect(1085, 120, 1420, 800, 50, a), keys: [{ at: 0, amount: 1 }] },
    },
  },
  "s11-your-words": {
    establish: {
      state: "v-draft-your-words",
      still: "top",
      float: true,
      sweepAt: 2,
      keys: establish(2, 0.6),
    },
    words: {
      state: "v-draft-your-words",
      clipFrom: 0.37,
      keys: [
        { at: 0, view: push(700, 270, 1.45) },
        { at: 4, view: push(700, 280, 1.5), ease: "drift" },
      ],
      dof: { mask: (a) => focusRect(291, 90, 1109, 462, 60, a), keys: [{ at: 0, amount: 1 }] },
    },
    checklist: {
      state: "v-draft-your-words",
      clipFrom: 5.9,
      keys: [
        { at: 0, view: push(760, 330, 1.3) },
        { at: 4, view: push(760, 360, 1.34), ease: "drift" },
      ],
    },
  },
  "s12-send-one": {
    dialog: {
      state: "v-publish",
      clipFrom: 1.25,
      keys: [
        { at: 0, view: push(720, 420, 1.25, { left: 300, ry: 4 }) },
        { at: 4, view: push(720, 560, 1.5, { left: 260, ry: 3 }), ease: "standard" },
      ],
      dof: { mask: (a) => focusRect(480, 40, 960, 769, 40, a), keys: [{ at: 0, amount: 1 }] },
    },
    published: {
      state: "v-publish",
      clipFrom: 4.4,
      keys: [
        { at: 0, view: push(640, 260, 1.6) },
        { at: 5, view: push(640, 260, 1.66), ease: "drift" },
      ],
      dof: { mask: (a) => focusRect(291, 190, 1377, 270, 60, a), keys: [{ at: 0, amount: 0.8 }] },
    },
  },
  "s13-learn": {
    compare: {
      state: "v-forecast-vs-reality",
      clipFrom: 1.9,
      keys: [
        { at: 0, view: push(830, 330, 1.35) },
        { at: 5, view: push(830, 260, 1.5), ease: "drift" },
      ],
    },
    practice: {
      state: "v-practice",
      clipFrom: 0.3,
      keys: [
        { at: 0, view: push(620, 430, 1.4) },
        { at: 4, view: push(600, 470, 1.5), ease: "drift" },
      ],
      dof: { mask: (a) => focusRect(266, 87, 1402, 835, 40, a), keys: [{ at: 0, amount: 0.8 }] },
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
