/**
 * Typed access to timeline.json, the single source of shot and caption
 * timing. Frames are composition frames at 30 fps unless a field says it is
 * relative to its shot.
 */
import type { CameraKey } from "./lib/camera.ts";
import data from "./timeline.json";

export type Scene = "problem" | "brand" | "footage" | "end";

/** A cursor key for still shots, in frames relative to the shot. */
export type StillCursorKey =
  | { type: "start"; f: number; x: number; y: number }
  | { type: "move"; from: number; f: number; target: string; dx?: number; dy?: number }
  | { type: "click"; f: number; target: string };

export interface StillSegment {
  state: string;
  /** Frame relative to the shot where this still starts showing. */
  from: number;
  /** Frames over which it fades in over the still before; a cut when absent. */
  crossfade?: number;
  camera: CameraKey[];
}

export interface Shot {
  id: string;
  title: string;
  from: number;
  to: number;
  scene: Scene;
  workspace?: boolean;
  capture?: {
    method: "still" | "screencast" | "clock";
    route: string;
    flags?: Record<string, string>;
    states?: string[];
  };
  /**
   * Clips: where in the clip (seconds) the shot starts, and the stretches
   * of the clip it cuts over.
   */
  clip?: { startAt: number; skip?: [number, number][] };
  /** Clips: camera keys relative to the shot. */
  camera?: CameraKey[];
  /** Still shots: the stills in order, each with its own camera. */
  stills?: StillSegment[];
  /** Still shots: the cursor; clips replay the recorded pointer instead. */
  cursor?: StillCursorKey[];
}

export interface Caption {
  from: number;
  to: number;
  text: string;
  /** "title" cues are drawn by their scene; the rest by <Captions>. */
  style?: "title";
  /** Lower third by default; "top" when the shot's subject is low. */
  position?: "top";
}

export interface Timeline {
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  viewport: { width: number; height: number; deviceScaleFactor: number };
  baseFlags: Record<string, string>;
  clockStart: string;
  shots: Shot[];
  captions: Caption[];
}

export const timeline = data as Timeline;

export const shotById = (id: string): Shot => {
  const shot = timeline.shots.find((each) => each.id === id);
  if (!shot) throw new Error(`No shot "${id}" in timeline.json.`);
  return shot;
};
