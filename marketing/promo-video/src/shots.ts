/**
 * How each product take is filmed: which captured state, from which clip
 * second, and the camera (src/look/camera.ts) in beats from the take's
 * start. Every position is in capture CSS px of the 1440x810 viewport,
 * read off the footage (targets.json boxes and the frames themselves).
 *
 * The grammar (owner's look decision, VIDEO.md): each section opens on
 * variant B's whole floating window (all four edges, contact shadow;
 * "establish" takes, with the "Sample project" badge in view), each with
 * its own move (S3 rises from below, S6 comes in from the left, S9 is a
 * locked-off wide that then pushes in, S11 pulls back to reveal), then cuts
 * on the beat to variant C's push-ins on the detail. In a push the
 * component the take is about (a card, a row, a dialog's section) is lifted
 * out of the page, cropped on its own border (src/look/dof.ts), while the
 * rest drops back, blurred under a veil; a caption sits on the dropped-back
 * page or the studio, never on a lifted component. Pushes are flat (no
 * tilt: at these magnifications a tilt reads as a crooked screenshot) and
 * keep the window's edge at most 120 px inside the frame on the panel side
 * (the studio is never a dead third of the frame). Every camera leaves its
 * cut moving and keeps drifting to the next one (src/takes.ts).
 *
 * Clip times avoid the capture's own scrolls and reflows: a take starts
 * after one and ends before the next (`clipTo` freezes a take on its last
 * settled frame, or holds a single frame: S8's answer, S11's checklist;
 * the camera still drifts), so nothing jumps inside a take.
 */
import { floating, push, type Key, type View } from "./look/camera.ts";
import type { Lift, Rect } from "./look/dof.ts";
import { music } from "./music.ts";
import { driftView, type Drift } from "./takes.ts";

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
  /** The camera's linear drift per bar (src/takes.ts; default +2% scale and 12 px to the left). */
  drift?: Drift;
  /** A whole floating window: contact shadow and one light sweep. */
  float?: boolean;
  /** Beats from the take's start where the window's light sweep starts. */
  sweepAt?: number;
  /** The window's visible height (capture px), ending in a gutter above the viewport's bottom so no line is sliced. */
  height?: number;
  /** A macro on the decisive line: magnification up to MACRO_MAX_M (src/look.test.ts). */
  macro?: boolean;
  /** The components lifted out of the page (src/look/dof.ts); scripts/check-dof.mjs checks each box against the footage. */
  lifts?: Lift[];
  /** How far the page drops back behind the lifts (0..1), keyed in beats (default 1 throughout). */
  focus?: { at: number; amount: number }[];
  /** Draw the capture's pointer moves and clicks (default: on for clips). */
  pointer?: boolean;
  /**
   * Clip seconds from which the captured UI updates in place without a click (the board's cards moving between
   * columns as the agents work): the per-frame jump scan of `npm run review` expects those steps.
   */
  liveFrom?: number;
}

/** Pushes stay at or under 2.0 output px per capture px (one DPR-4 pixel per pixel of the 4K master); a macro may go to 2.6. */
export const PUSH_MAX_M = 2.0;
export const MACRO_MAX_M = 2.6;

const REST = { width: 1320, x: 80, y: -72, rx: 5, ry: -9 };
const rest = () => floating(REST.width, { x: REST.x, y: REST.y, rx: REST.rx, ry: REST.ry });

/**
 * The first product shot rises in from below the frame as the logo goes, a
 * beat before the bar-6 downbeat it lands on (heroGlide stretched over 18
 * frames), then turns to face, landing on the next bar line.
 */
const riseIn = (): Key[] => [
  { at: 0, view: floating(REST.width * 0.94, { x: REST.x + 150, y: REST.y + 640, rx: 18, ry: -24 }) },
  { at: 1, view: floating(REST.width * 0.97, { x: REST.x + 90, y: REST.y - 10, rx: 11, ry: -18 }), ease: "glide" },
  { at: 5, view: rest(), ease: "standard" },
];

/** The window's right edge this far inside the frame in a push on the right-hand panel: studio on at most 6% of the width. */
const EDGE = 120;
/** A push on the right-hand panel (x 1081-1421), the window's right edge EDGE px inside the frame. */
const panel = (cy: number, m: number, sy = 540, cover = true) => push(1250, cy, m, { right: EDGE, sy, cover });

/** The plan card, where S4 ends and S5 begins: the same picture on both sides of the cut. */
const PLAN: Rect = [291, 150, 1377, 596];
const planLook: TakeLook = {
  state: "v-plan",
  still: "plan",
  keys: [
    { at: 0, view: push(834, 373, 1.56) },
    { at: 4, view: push(834, 373, 1.6) },
  ],
  lifts: [{ box: PLAN }],
};
/** S5 opens on S4's last frame, drift included. */
const planEnd: View = driftView(planLook.keys[1].view, 4 * music.beatFrames, planLook.drift);
/** The board after the plan folds (clip 0.867 s, film beat 2.22 of S5): its four columns, to the viewport's bottom. */
const FOLD = 40 / music.beatFrames;
const COLUMNS: Rect[] = [
  [291, 301, 535, 810],
  [547, 301, 791, 810],
  [803, 301, 1047, 810],
  [1067, 301, 1377, 810],
];

/** A look for each take, by shot id and take id. */
export const looks: Record<string, Record<string, TakeLook>> = {
  "s3-rules": {
    establish: {
      state: "v-rules-card",
      still: "overview",
      float: true,
      sweepAt: 5,
      height: 783,
      keys: riseIn(),
      drift: { scale: 0.012, x: 0 },
    },
    rules: {
      state: "v-rules-card",
      still: "card",
      // The three rules, each quoted with its CONTRIBUTING.md line, lifted; the headings and the card round them drop back.
      keys: [
        { at: 0, view: push(834, 502, 1.6) },
        { at: 4, view: push(834, 502, 1.66) },
      ],
      lifts: [
        { box: [318, 358, 1350, 429], radius: 4 },
        { box: [318, 466, 1350, 537], radius: 4 },
        { box: [318, 574, 1350, 645], radius: 4 },
      ],
    },
  },
  "s4-still-yours": {
    chips: {
      state: "v-before-you-start",
      // After the dialog's own scroll (1.50-2.47 s): the facts settled, the chips green. A macro on the whole
      // "Before you start" box: its two rows of chips at about 30 px.
      clipFrom: 2.55,
      macro: true,
      keys: [
        { at: 0, view: push(720, 230, 2.32, { sy: 440 }) },
        { at: 4, view: push(720, 230, 2.4, { sy: 436 }) },
      ],
      lifts: [{ box: [360, 160, 1080, 300] }],
    },
    plan: planLook,
  },
  "s5-legwork": {
    board: {
      state: "v-board",
      // Slowed so the plan folds two beats in (the approve click on 759, the board in place on 763) and the board's
      // moves fall a beat apart (777-850).
      clipFrom: 0.06,
      rate: 0.617,
      liveFrom: 0.867,
      // On the plan (S4's last framing): the approval, the person's call; then, as the plan folds into the board, a
      // short move to the whole board, and the drift.
      keys: [
        { at: 0, view: planEnd },
        { at: FOLD, view: planEnd },
        { at: 6, view: push(834, 452, 1.55, { sx: 1025, sy: 540, cover: false }), ease: "standard" },
      ],
      // The plan card until it folds, then the board's four columns come forward together (a 15-frame rack).
      lifts: [{ box: PLAN, to: FOLD }, ...COLUMNS.map((box) => ({ box, radius: [8, 8, 0, 0] as [number, number, number, number], from: FOLD }))],
      drift: { scale: 0.015, x: -8 },
    },
  },
  "s6-try-first": {
    establish: {
      state: "v-quiz-attempt",
      clipFrom: 0,
      float: true,
      sweepAt: 0,
      height: 802,
      // In from the left, turning the other way from S3's rise.
      keys: [
        { at: 0, view: floating(REST.width * 0.95, { x: REST.x - 210, y: REST.y + 40, rx: REST.rx + 4, ry: REST.ry + 11 }) },
        { at: 2, view: rest() },
      ],
      drift: { scale: 0.012, x: 0 },
    },
    answer: {
      state: "v-quiz-attempt",
      // The answer types out inside the push, then "Think so" and "Show answer" (before the reveal's scroll at 4.37 s).
      clipFrom: 1.2,
      rate: 1.25,
      clipTo: 4.08,
      keys: [
        { at: 0, view: panel(522, 1.8) },
        { at: 4, view: panel(522, 1.9) },
      ],
      lifts: [{ box: [1099, 332, 1403, 712] }],
    },
    reveal: {
      state: "v-quiz-attempt",
      // After the scroll to the grades: the AI-written reference, then "Got it" (held before the card collapses and
      // the panel's notice under it slides behind the sticky footer, 6.15 s).
      clipFrom: 5.05,
      clipTo: 6.13,
      macro: true,
      keys: [
        { at: 0, view: panel(568, 2.28) },
        { at: 2, view: panel(568, 2.36) },
      ],
      lifts: [
        { box: [1116, 427, 1386, 613], radius: 6 },
        { box: [1116, 649, 1386, 709], radius: 6 },
      ],
    },
    example: {
      state: "v-quiz-attempt",
      // After the scroll to the example card (6.77-7.67 s); its bottom runs under the panel's sticky footer.
      clipFrom: 7.75,
      keys: [
        { at: 0, view: panel(522, 1.62) },
        { at: 6, view: panel(522, 1.72) },
      ],
      lifts: [{ box: [1099, 332, 1403, 712], radius: [8, 8, 0, 0] }],
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
        { at: 0, view: panel(486, 1.8) },
        { at: 2, view: panel(486, 1.88) },
      ],
      lifts: [{ box: [1099, 332, 1403, 641] }],
    },
    alternative: {
      state: "v-road-choice",
      macro: true,
      // After the scroll: the revealed alternative (a fixed interval with jitter, and when it would be the better
      // choice), whole and sharp, before the pointer moves to the choice at 5.10 s. The frame's top edge sits in the
      // gap under the panel's sticky header (and the line it half covers), and the zoom drifts about that edge.
      clipFrom: 4.7,
      rate: 0.15,
      keys: [
        { at: 0, view: push(1250, 350, 2.36, { right: EDGE, sy: 0, cover: false }) },
        { at: 4, view: push(1250, 350, 2.42, { right: EDGE, sy: 0, cover: false }) },
      ],
      drift: { scale: 0.015, x: -10 },
      lifts: [{ box: [1108, 352, 1395, 618], radius: [0, 0, 6, 6] }],
    },
    keep: {
      state: "v-road-choice",
      // The pointer moves to "Keep this approach" and clicks; the question and its first row of choices lifted,
      // "It depends" and the panel's sticky footer that cuts it dropped back, the window's bottom edge over the studio.
      clipFrom: 5.1,
      rate: 0.7,
      macro: true,
      keys: [
        { at: 0, view: push(1250, 657, 2.46, { right: EDGE, bottom: 246 }) },
        { at: 2, view: push(1250, 657, 2.5, { right: EDGE, bottom: 240 }) },
      ],
      lifts: [{ box: [1105, 626, 1395, 688], radius: 6 }],
    },
    why: {
      state: "v-road-choice",
      // After the scroll to the why (5.97-6.47 s): it finishes typing and is saved.
      clipFrom: 7.4,
      rate: 1.45,
      macro: true,
      keys: [
        { at: 0, view: panel(574, 2.24) },
        { at: 2, view: panel(574, 2.3) },
      ],
      lifts: [{ box: [1105, 493, 1395, 627], radius: 6 }],
    },
  },
  "s8-ask": {
    select: {
      state: "v-line-ask",
      // The second click selects lines 10-15, then "Explain this code" in the selection bar is pressed.
      clipFrom: 1.45,
      keys: [
        { at: 0, view: push(756, 627, 1.56, { bottom: 172 }) },
        { at: 2, view: push(756, 627, 1.62, { bottom: 168 }) },
      ],
      // The selected lines and the selection bar lifted; the code round them, the file list and the panel dropped back.
      lifts: [
        { box: [436, 494, 1076, 677], radius: 0 },
        { box: [436, 728, 1076, 759], radius: 6 },
      ],
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
        { at: 0, view: panel(431, 2.16) },
        { at: 2, view: panel(431, 2.24) },
      ],
      lifts: [{ box: [1113, 326, 1389, 539], radius: [0, 0, 6, 6] }],
    },
    answer: {
      state: "v-line-ask",
      // The answer's first paragraph, complete, held at "reread" (6.97 s): the capture backs the panel up to it once
      // the reply has settled, so the frame is the same on every capture; the paragraph under it (whose heading runs
      // into its first line) and the sticky header above drop back.
      clipFrom: 6.97,
      clipTo: 6.97,
      macro: true,
      keys: [
        { at: 0, view: panel(385, 2.32, 470) },
        { at: 4, view: panel(385, 2.42, 470) },
      ],
      lifts: [{ box: [1092, 343, 1408, 427], radius: 6 }],
    },
  },
  "s9-explain-back": {
    establish: {
      state: "v-check",
      // Lights on: the closed book (no explanation tabs, the diff stays) as a locked-off wide for two beats, the
      // summary still empty (the clip's first frame held); then the push onto "1. Explain" as the summary types,
      // landing on the crash as it finishes.
      clipFrom: -1.24,
      rate: 1.2,
      float: true,
      sweepAt: 0.5,
      height: 802,
      keys: [
        { at: 0, view: rest() },
        { at: 2, view: rest() },
        { at: 3.7, view: push(1251, 314, 1.98, { right: EDGE, sy: 470 }) },
      ],
      drift: { scale: 0.008, x: 0 },
      lifts: [{ box: [1097, 268, 1405, 360], radius: 6 }],
      focus: [
        { at: 0, amount: 0 },
        { at: 2.8, amount: 0 },
        { at: 3.6, amount: 1 },
      ],
    },
    question: {
      state: "v-check",
      // The retry.ts question is answered, then "Think so" (before the scroll to the next question at 4.97 s).
      clipFrom: 2.75,
      rate: 0.9,
      macro: true,
      keys: [
        { at: 0, view: panel(295, 2.24, 470) },
        { at: 4, view: panel(295, 2.32, 470) },
      ],
      lifts: [{ box: [1092, 168, 1410, 422], radius: 6 }],
    },
    partly: {
      state: "v-check",
      // After the reveal's scroll: the question, the answer, the AI-written reference beside it, and "Partly".
      clipFrom: 8.75,
      macro: true,
      keys: [
        { at: 0, view: panel(445, 2.06, 450) },
        { at: 2, view: panel(445, 2.12, 450) },
      ],
      lifts: [{ box: [1092, 285, 1410, 605], radius: 6 }],
    },
    result: {
      state: "v-check",
      // The result: the result line, the question, the answer and the one-line correction in "What I had wrong".
      clipFrom: 12.97,
      macro: true,
      keys: [
        { at: 0, view: panel(425, 2.1, 450) },
        { at: 2, view: panel(425, 2.16, 450) },
      ],
      lifts: [{ box: [1092, 290, 1410, 560], radius: 6 }],
    },
  },
  "s10-predict": {
    tests: {
      state: "v-forecast",
      // "Tests" is picked, then the forecast line types out (before the scroll to the result at 2.1 s).
      clipFrom: 0.2,
      rate: 0.75,
      macro: true,
      keys: [
        { at: 0, view: panel(301, 1.98, 450) },
        { at: 4, view: panel(301, 2.06, 450) },
      ],
      lifts: [{ box: [1092, 174, 1410, 428], radius: 6 }],
    },
    line: {
      state: "v-forecast",
      // The saved prediction under the check's result line, both lifted.
      clipFrom: 2.15,
      macro: true,
      keys: [
        { at: 0, view: panel(302, 2.46, 450) },
        { at: 4, view: panel(302, 2.5, 450) },
      ],
      lifts: [{ box: [1092, 240, 1410, 364], radius: 6 }],
    },
  },
  "s11-your-words": {
    establish: {
      state: "v-draft-your-words",
      still: "top",
      float: true,
      sweepAt: 1,
      height: 790,
      // A slow pull-back reveal in the calm bars: from close on the draft to the whole window, which then holds.
      keys: [
        { at: 0, view: floating(REST.width * 1.5, { x: REST.x - 60, y: REST.y + 160, rx: 2, ry: -4 }) },
        { at: 2.5, view: rest() },
      ],
      drift: { scale: 0.01, x: 0 },
    },
    checklist: {
      state: "v-draft-your-words",
      // The maintainer checklist's last rows, held on the frame where the capture's scroll passes them (5.43 s):
      // "Your own words", "A reviewable change", "Disclosing AI help" with the project's rule, "Understanding check:
      // You explained the change back", every one OK and lifted; the pacing row above them and the reviewability
      // snapshot under them drop back, the rows with the sample GitHub facts and the read times out of frame.
      // Half-speed camera in the calm bars.
      clipFrom: 5.433,
      clipTo: 5.433,
      keys: [
        { at: 0, view: push(842, 381, 1.68, { sy: 500 }) },
        { at: 4, view: push(842, 381, 1.71, { sy: 500 }) },
      ],
      drift: { scale: 0.012, x: -8 },
      lifts: [
        { box: [332, 175, 1352, 261], radius: 6 },
        { box: [332, 269, 1352, 356], radius: 6 },
        { box: [332, 364, 1352, 492], radius: 6 },
        { box: [332, 500, 1352, 587], radius: 6 },
      ],
    },
    words: {
      state: "v-draft-your-words",
      // The card after "Use my explanation": the not-tested answer, then "Add my not-tested answer to Testing" and
      // its "In the description" (before the scroll at 2.50 s). The whole card lifted.
      clipFrom: 1.0,
      rate: 0.6,
      macro: true,
      keys: [
        { at: 0, view: push(700, 275, 1.92, { sy: 470 }) },
        { at: 4, view: push(700, 275, 1.97, { sy: 470 }) },
      ],
      drift: { scale: 0.012, x: -6 },
      lifts: [{ box: [291, 90, 1109, 461] }],
    },
  },
  "s12-send-one": {
    dialog: {
      state: "v-publish",
      // After the dialog's scroll to its checks: the pacing line, "Every check passes.", the click on "Open the sample
      // Draft PR" on the last frames (the dialog closes at 3.83 s, after the cut). The preview above them, whose last
      // line its own scroll box cuts, drops back.
      clipFrom: 2.3,
      rate: 0.625,
      macro: true,
      keys: [
        { at: 0, view: push(720, 664, 1.88) },
        { at: 4, view: push(720, 664, 1.98) },
      ],
      lifts: [{ box: [494, 578, 946, 750], radius: 6 }],
    },
    published: {
      state: "v-publish",
      clipFrom: 4.4,
      macro: true,
      // The card's left edge (its icon) in frame; its right side, plain tint, runs off the frame.
      keys: [
        { at: 0, view: push(640, 248, 2.34, { sy: 520 }) },
        { at: 4, view: push(640, 248, 2.42, { sy: 520 }) },
      ],
      lifts: [{ box: [291, 200, 1377, 297] }],
    },
    waiting: {
      state: "v-forecast-vs-reality",
      // The draft waiting for the review: "Maintainer feedback" with "Read feedback", and the saved forecast beside the
      // empty "What the maintainers said"; "Read feedback" is pressed just before the cut to what they said.
      clipFrom: 0,
      rate: 0.75,
      keys: [
        { at: 0, view: push(834, 674, 1.56, { bottom: 84 }) },
        { at: 2, view: push(834, 674, 1.62, { bottom: 80 }) },
      ],
      lifts: [{ box: [285, 545, 1383, 616], radius: 6 }, { box: [291, 630, 1377, 803] }],
    },
  },
  "s13-learn": {
    compare: {
      state: "v-forecast-vs-reality",
      // After the scroll to the comparison (1.10-2.00 s): "Your forecast: Tests" beside the first maintainer comment,
      // whole, for a beat and a half; then the camera pushes onto the comment, past 2x, as the forecast drops back and
      // leaves the frame: "2. Please add a test for the exhausted case ...", its "Tests" tag and "Saw it coming". The
      // comment shows its inline code as raw backticks (a product fix in the known issues), as developers read Markdown.
      clipFrom: 2.1,
      macro: true,
      keys: [
        { at: 0, view: push(834, 239, 1.7, { sy: 420 }) },
        { at: 1.5, view: push(834, 239, 1.72, { sy: 420 }) },
        { at: 6, view: push(990, 254, 2.3, { sy: 430, cover: false }) },
      ],
      drift: { scale: 0.015, x: 0 },
      lifts: [{ box: [310, 112, 654, 217], to: 1.9, settle: true }, { box: [671, 142, 1358, 366] }],
    },
    practice: {
      state: "v-practice",
      // Days later the question comes back on the Learning page ("Sample practice", from your understanding check):
      // the whole card for two beats, then a push down onto the reference, "What you had wrong last time" and "Next
      // review in 3 days" (after "Got it", before the scroll at 1.13 s), still drifting into the end card's cut.
      clipFrom: 0.85,
      clipTo: 1.1,
      rate: 0.08,
      macro: true,
      keys: [
        { at: 0, view: push(646, 462, 1.5) },
        { at: 1.5, view: push(646, 462, 1.53) },
        { at: 5, view: push(646, 538, 1.94, { cover: false }) },
      ],
      lifts: [{ box: [266, 152, 1026, 772] }],
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
