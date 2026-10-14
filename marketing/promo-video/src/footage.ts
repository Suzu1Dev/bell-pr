/**
 * The captured footage's metadata (public/footage/<shot>/frames.json and
 * targets.json, written by scripts/capture.mjs). It is loaded once, before
 * the render, by the composition's calculateMetadata.
 */
import { staticFile } from "remotion";
import type { ClipFrame } from "./lib/clip.ts";
import type { CursorEvent } from "./lib/cursor.ts";
import { timeline } from "./timeline.ts";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ClipMeta {
  method: "screencast" | "clock";
  width: number;
  height: number;
  duration: number;
  frames: ClipFrame[];
}

export interface ShotFootage {
  clip?: ClipMeta;
  boxes: Record<string, Box>;
  events: CursorEvent[];
}

export type Footage = Record<string, ShotFootage>;

/** The URL of a footage file, such as a still or a clip frame. */
export const footageFile = (shot: string, file: string) =>
  staticFile(`footage/${shot}/${file}`);

async function readJson<T>(shot: string, file: string): Promise<T> {
  const response = await fetch(footageFile(shot, file));
  if (!response.ok)
    throw new Error(
      `public/footage/${shot}/${file} is missing (${response.status}). Run "npm run capture" first.`,
    );
  return (await response.json()) as T;
}

export async function loadFootage(): Promise<Footage> {
  const footage: Footage = {};
  for (const shot of timeline.shots) {
    if (!shot.capture) continue;
    const targets = await readJson<{ boxes: Record<string, Box>; events: CursorEvent[] }>(
      shot.id,
      "targets.json",
    );
    const clip =
      shot.capture.method === "still"
        ? undefined
        : await readJson<ClipMeta>(shot.id, "frames.json");
    footage[shot.id] = { clip, boxes: targets.boxes, events: targets.events };
  }
  return footage;
}
