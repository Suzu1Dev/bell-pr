/**
 * The pointer drawn over the footage: it eases between the recorded
 * targets, presses on a click and sends out a ripple. Its size is fixed in
 * output pixels, whatever the camera zoom.
 */
import { AbsoluteFill, useVideoConfig } from "remotion";
import { cameraView, toOutput, type Camera } from "../lib/camera.ts";
import { cursorAt, rippleSeconds, type CursorEvent } from "../lib/cursor.ts";
import { timeline } from "../timeline.ts";

export interface CursorProps {
  events: CursorEvent[];
  /** Seconds on the events' clock. */
  t: number;
  camera: Camera;
  /** 0..1, for fading in and out at the shot's edges. */
  opacity?: number;
}

const size = 44;

export const Cursor: React.FC<CursorProps> = ({ events, t, camera, opacity = 1 }) => {
  const { width, height } = useVideoConfig();
  const state = cursorAt(events, t);
  if (!state || opacity * state.opacity <= 0) return null;
  const view = cameraView(camera, timeline.viewport, { width, height });
  const point = toOutput(view, state.x, state.y);
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: opacity * state.opacity }}>
      {state.ripples.map((age, index) => {
        const p = age / rippleSeconds;
        const radius = 14 + 46 * (1 - (1 - p) ** 2);
        return (
          <div
            key={index}
            style={{
              position: "absolute",
              left: point.x - radius,
              top: point.y - radius,
              width: radius * 2,
              height: radius * 2,
              borderRadius: "50%",
              border: "4px solid var(--color-brand-500)",
              background: "rgb(63 138 105 / 14%)",
              opacity: 1 - p,
            }}
          />
        );
      })}
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        style={{
          position: "absolute",
          left: point.x - 5,
          top: point.y - 3,
          transform: `scale(${1 - 0.14 * state.press})`,
          transformOrigin: "5px 3px",
          filter: "drop-shadow(0 3px 6px rgb(22 43 36 / 35%))",
          overflow: "visible",
        }}
      >
        <path
          d="M4.2 2.4 L4.2 19.6 L8.6 15.6 L11.5 22.1 L14.6 20.7 L11.8 14.4 L17.8 14.2 Z"
          fill="var(--color-text)"
          stroke="#ffffff"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      </svg>
    </AbsoluteFill>
  );
};
