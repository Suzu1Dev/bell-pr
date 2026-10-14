/**
 * S3-S10: the product on screen. A clip (screencast or frame-stepped) or a
 * series of stills, seen through the shot's camera, with the cursor over it.
 * Clips replay the pointer recorded during the capture; still shots take
 * their cursor keys from timeline.json and the targets the capture recorded.
 */
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { ClipSequence } from "../components/ClipSequence.tsx";
import { Cursor } from "../components/Cursor.tsx";
import { Footage } from "../components/Footage.tsx";
import { footageFile, type Box, type ShotFootage } from "../footage.ts";
import { cameraAt } from "../lib/camera.ts";
import { clipTime } from "../lib/clip.ts";
import type { CursorEvent } from "../lib/cursor.ts";
import type { Shot, StillCursorKey } from "../timeline.ts";

const edgeFrames = 6;

/** The still shot's cursor keys as cursor events, in seconds of the shot. */
export function stillCursorEvents(
  keys: readonly StillCursorKey[],
  boxes: Record<string, Box>,
  fps: number,
): CursorEvent[] {
  const center = (target: string, dx = 0, dy = 0) => {
    const box = boxes[target];
    if (!box) throw new Error(`No cursor target "${target}" was captured.`);
    return { x: box.x + box.width / 2 + dx, y: box.y + box.height / 2 + dy };
  };
  return keys.map((key): CursorEvent => {
    if (key.type === "start") return { type: "start", t: key.f / fps, x: key.x, y: key.y };
    if (key.type === "move")
      return { type: "move", from: key.from / fps, t: key.f / fps, ...center(key.target, key.dx, key.dy), target: key.target };
    return { type: "click", t: key.f / fps, ...center(key.target), target: key.target };
  });
}

export const FootageScene: React.FC<{ shot: Shot; footage: ShotFootage }> = ({ shot, footage }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const duration = shot.to - shot.from;
  const edges = Math.min(
    interpolate(frame, [0, edgeFrames], [0, 1], { extrapolateRight: "clamp" }),
    interpolate(frame, [duration - edgeFrames, duration], [1, 0], { extrapolateLeft: "clamp" }),
  );

  if (footage.clip) {
    const startAt = shot.clip?.startAt ?? 0;
    const skip = shot.clip?.skip ?? [];
    const camera = cameraAt(shot.camera ?? [{ f: 0, x: 720, y: 405, zoom: 1 }], frame);
    return (
      <AbsoluteFill>
        <ClipSequence shot={shot.id} clip={footage.clip} startAt={startAt} skip={skip} camera={camera} />
        <Cursor events={footage.events} t={clipTime(startAt, frame / fps, skip)} camera={camera} opacity={edges} />
      </AbsoluteFill>
    );
  }

  const stills = shot.stills ?? [];
  const current = stills.reduce((found, still, index) => (still.from <= frame ? index : found), 0);
  const crossfade = stills[current]?.crossfade ?? 0;
  const events = stillCursorEvents(shot.cursor ?? [], footage.boxes, fps);
  // During a crossfade the previous still stays underneath the new one.
  const layers =
    crossfade > 0 && current > 0 && frame < stills[current].from + crossfade
      ? [current - 1, current]
      : [current];
  return (
    <AbsoluteFill>
      {layers.map((index) => {
        const still = stills[index];
        const opacity =
          layers.length > 1 && index === current
            ? interpolate(frame, [still.from, still.from + crossfade], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              })
            : 1;
        return (
          <AbsoluteFill key={still.state} style={{ opacity }}>
            <Footage
              src={footageFile(shot.id, `${still.state}.png`)}
              camera={cameraAt(still.camera, frame - still.from)}
            />
          </AbsoluteFill>
        );
      })}
      {events.length > 0 && (
        <Cursor
          events={events}
          t={frame / fps}
          camera={cameraAt(stills[current].camera, frame - stills[current].from)}
          opacity={edges}
        />
      )}
    </AbsoluteFill>
  );
};
