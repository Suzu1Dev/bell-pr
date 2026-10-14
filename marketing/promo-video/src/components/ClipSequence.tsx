/**
 * A captured clip (screencast or frame-stepped) played as an image
 * sequence. Each video frame shows the clip frame painted last at or before
 * its time, so the clip plays at its real speed whatever its frame rate:
 * nothing is stretched, dropped frames simply hold. A shot may cut over a
 * stretch of the clip (`skip`), such as a page that is still loading.
 */
import { useCurrentFrame, useVideoConfig } from "remotion";
import { footageFile, type ClipMeta } from "../footage.ts";
import type { Camera } from "../lib/camera.ts";
import { clipTime, frameAt, type Skip } from "../lib/clip.ts";
import { Footage } from "./Footage.tsx";

export interface ClipSequenceProps {
  shot: string;
  clip: ClipMeta;
  /** Seconds into the clip at the sequence's first frame. */
  startAt: number;
  /** Stretches of the clip the shot cuts over. */
  skip?: readonly Skip[];
  camera: Camera;
}

export const ClipSequence: React.FC<ClipSequenceProps> = ({ shot, clip, startAt, skip, camera }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const picked = frameAt(clip.frames, clipTime(startAt, frame / fps, skip));
  return <Footage src={footageFile(shot, picked.file)} camera={camera} />;
};
