/**
 * The camera of a take over time (pure; src/scenes/ProductShot.tsx draws it,
 * src/look.test.ts checks it): the keys of src/shots.ts in beats, then the
 * camera's breathing after the last key.
 */
import { viewAt, type View } from "./look/camera.ts";
import { drift } from "./look/motion.ts";
import { music } from "./music.ts";
import type { TakeLook } from "./shots.ts";

/** The camera at frame `f` of a take (frames from its start), breathing after its last key. */
export function takeView(look: TakeLook, f: number): View {
  const beats = f / music.beatFrames;
  const view = viewAt(look.keys, beats);
  const last = look.keys.at(-1)!.at;
  if (beats <= last) return view;
  const k = drift((beats - last) * music.beatFrames, look.breathe ?? 0.012);
  return { ...view, m: view.m * k };
}

/** The largest magnification of a take. */
export const takeMaxM = (look: TakeLook, frames: number) => {
  let max = 0;
  for (let f = 0; f <= frames; f += 6) max = Math.max(max, takeView(look, f).m);
  return Math.max(max, takeView(look, frames).m);
};

