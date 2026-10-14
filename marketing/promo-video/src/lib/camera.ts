/**
 * The virtual camera over the captured UI. A camera key names the point it
 * looks at (x, y in CSS pixels of the 1440x810 capture viewport) and a zoom
 * (1 shows the whole viewport; 1.5 shows a 960x540 region). Keys are frames
 * relative to the start of their shot or still.
 */
import { ease, type EaseName } from "./ease.ts";

export interface CameraKey {
  /** Frame, relative to the shot or still segment. */
  f: number;
  x: number;
  y: number;
  zoom: number;
  /** The easing into this key from the one before; "inOut" by default. */
  ease?: EaseName;
  /**
   * The view frames an open dialog; the page behind it is blurred, so the
   * view may cut through the sidebar.
   */
  dialog?: boolean;
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface Size {
  width: number;
  height: number;
}

/**
 * The camera at `frame`: held before the first key and after the last,
 * eased between keys. Zoom moves in log space, so a push in feels even.
 */
export function cameraAt(keys: readonly CameraKey[], frame: number): Camera {
  if (keys.length === 0) throw new Error("A camera needs at least one key.");
  const sorted = [...keys].sort((a, b) => a.f - b.f);
  if (frame <= sorted[0].f) return pick(sorted[0]);
  const last = sorted[sorted.length - 1];
  if (frame >= last.f) return pick(last);
  const next = sorted.findIndex((key) => key.f > frame);
  const from = sorted[next - 1];
  const to = sorted[next];
  const p = ease(to.ease, (frame - from.f) / (to.f - from.f));
  return {
    x: from.x + (to.x - from.x) * p,
    y: from.y + (to.y - from.y) * p,
    zoom: Math.exp(Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * p),
  };
}

const pick = ({ x, y, zoom }: CameraKey): Camera => ({ x, y, zoom });

export interface CameraView {
  /** Output pixels per CSS pixel. */
  scale: number;
  /** The CSS pixel at the output's top-left corner. */
  left: number;
  top: number;
}

/**
 * Where the camera puts the viewport in the output frame. The zoom never
 * drops below 1 and the view never leaves the viewport, so no edge of the
 * capture is ever on screen.
 */
export function cameraView(camera: Camera, viewport: Size, output: Size): CameraView {
  const zoom = Math.max(1, camera.zoom);
  const width = viewport.width / zoom;
  const height = viewport.height / zoom;
  const left = Math.min(Math.max(camera.x - width / 2, 0), viewport.width - width);
  const top = Math.min(Math.max(camera.y - height / 2, 0), viewport.height - height);
  return { scale: output.width / width, left, top };
}

/** A CSS pixel point of the viewport in output pixels. */
export function toOutput(view: CameraView, x: number, y: number) {
  return { x: (x - view.left) * view.scale, y: (y - view.top) * view.scale };
}
