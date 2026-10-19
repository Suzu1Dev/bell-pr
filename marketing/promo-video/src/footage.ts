/**
 * The captured footage (scripts/capture.mjs, gitignored): per state, the
 * element boxes, pointer events and named marks (targets.json) and, for
 * clips, the frame list (frames.json). The composition's calculateMetadata
 * loads them once before rendering.
 *
 * Two copies of every picture (scripts/make-proxies.mjs):
 * - public/footage/: the capture, DPR 4 (5760x3240): 4K pushes;
 * - public/footage-2x/: DPR 2 (2880x1620): shots that need no more.
 * The depth of field's back plane is the same picture, blurred in the
 * render (src/look/ProductWindow.tsx).
 */
import { staticFile } from "remotion";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PointerEvent =
  | { type: "start"; t: number; x: number; y: number }
  | { type: "move"; from: number; t: number; x: number; y: number; target?: string }
  | { type: "click"; t: number; x: number; y: number; target?: string }
  | { type: "hide"; t: number };

/** Where the pointer's disc sits beside a click (capture px from the hotspot), so it covers no glyph (scripts/pointer-spots.mjs). */
export interface PointerSpot {
  t: number;
  dx: number;
  dy: number;
  /** Clip seconds where the UI under the click is replaced (a fold, a collapse): the ring and the disc end there. */
  changeAt?: number;
}

export interface StateFootage {
  boxes: Record<string, Box>;
  events: PointerEvent[];
  marks: Record<string, number>;
  spots?: PointerSpot[];
  /** Clip frames: file names (frames/00000.jpg) and their times in seconds. */
  frames?: { file: string; t: number }[];
}

export type Footage = Record<string, StateFootage>;

/** The capture's CSS viewport (src/timeline.json `viewport`). */
export const CAPTURE = { width: 1440, height: 810 } as const;

export type Density = "4x" | "2x";

const roots: Record<Density, string> = { "4x": "footage", "2x": "footage-2x" };

/** The URL of a still (`name` without extension) at a density. */
export const stillUrl = (state: string, name: string, density: Density) =>
  staticFile(`${roots[density]}/${state}/${name}.${density === "4x" ? "png" : "jpg"}`);

/** The URL of clip frame `file` (frames/00000.jpg) at a density. */
export const frameUrl = (state: string, file: string, density: Density) => staticFile(`${roots[density]}/${state}/${file}`);

/**
 * The density a shot needs: source pixels per output pixel must stay at or
 * above 1.2 (tilted or blurred UI, lookdev STYLE-GUIDE §5.4), so DPR 2 serves
 * up to an output magnification of 1.67 per CSS pixel.
 */
export const densityFor = (outputPerCssPx: number): Density => (outputPerCssPx * 1.2 <= 2 ? "2x" : "4x");

async function readJson<T>(state: string, file: string): Promise<T> {
  const response = await fetch(staticFile(`footage/${state}/${file}`));
  if (!response.ok)
    throw new Error(`public/footage/${state}/${file} is missing (${response.status}). Run "npm run capture" first.`);
  return (await response.json()) as T;
}

/** Loads targets.json (and frames.json for clips) of every state in `states`. */
export async function loadFootage(states: { state: string; clip: boolean }[]): Promise<Footage> {
  const footage: Footage = {};
  for (const { state, clip } of states) {
    if (footage[state]?.frames || (footage[state] && !clip)) continue;
    const targets = await readJson<{ boxes: Record<string, Box>; events: PointerEvent[]; marks?: Record<string, number> }>(
      state,
      "targets.json",
    );
    const frames = clip ? (await readJson<{ frames: { file: string; t: number }[] }>(state, "frames.json")).frames : undefined;
    // Clips only, and optional (npm run assets writes it for the clicks the film shows); without it the disc keeps
    // its default offset.
    const spotsFile = clip ? await fetch(staticFile(`footage-2x/${state}/pointer.json`)) : undefined;
    const spots = spotsFile?.ok ? ((await spotsFile.json()) as { spots: PointerSpot[] }).spots : undefined;
    footage[state] = { boxes: targets.boxes, events: targets.events, marks: targets.marks ?? {}, frames, spots };
  }
  return footage;
}

/** The clip frame shown at clip time `t` (seconds): the last frame at or before it. */
export function clipFrameAt(frames: { file: string; t: number }[], t: number) {
  const index = Math.min(frames.length - 1, Math.max(0, Math.floor(t * 30 + 1e-6)));
  return frames[index];
}
