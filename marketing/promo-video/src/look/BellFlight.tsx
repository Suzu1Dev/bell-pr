/**
 * The first-hit bell (src/bell.ts): the wordmark's mark, drawn on its own
 * from the hit, flying from the lockup onto the app's own bell in S3's
 * floating window. A vector (the brand path, inline SVG) laid out at its
 * on-screen size every frame, so it is rasterised crisp at every size and
 * never scaled as a bitmap; its position and tilt are a 3D transform under
 * the same perspective as the window (src/look/ProductWindow.tsx), so on the
 * landing frame it lies exactly on the footage's bell. No motion blur.
 */
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { logoColors, markPath } from "../../../../src/brand/brand-assets.ts";
import { bellAt, carriesPaper, MARK_UNITS, PATCH_UNITS, SIDEBAR_PAPER } from "../bell.ts";
import { PERSPECTIVE, PERSPECTIVE_ORIGIN } from "./camera.ts";

export const BellFlight: React.FC<{ from: number; probe?: "flight" | "footage" }> = ({ from, probe }) => {
  const f = useCurrentFrame() + from;
  if (probe === "footage") return null;
  const pose = bellAt(f);
  const opacity = probe === "flight" ? 1 : pose.opacity;
  if (opacity <= 0.001) return null;
  const size = MARK_UNITS * pose.unit;
  const flat = Math.abs(pose.rx) < 1e-6 && Math.abs(pose.ry) < 1e-6 && Math.abs(pose.z) < 1e-6;
  const transform = flat
    ? `translate(${(pose.x - size / 2).toFixed(4)}px, ${(pose.y - size / 2).toFixed(4)}px)`
    : `translate3d(${pose.x.toFixed(4)}px, ${pose.y.toFixed(4)}px, ${pose.z.toFixed(4)}px) rotateY(${pose.ry.toFixed(4)}deg) ` +
      `rotateX(${pose.rx.toFixed(4)}deg) translate(${(-size / 2).toFixed(4)}px, ${(-size / 2).toFixed(4)}px)`;
  return (
    <AbsoluteFill style={{ perspective: PERSPECTIVE, perspectiveOrigin: `${PERSPECTIVE_ORIGIN.x}px ${PERSPECTIVE_ORIGIN.y}px` }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${MARK_UNITS} ${MARK_UNITS}`}
        style={{ position: "absolute", left: 0, top: 0, transformOrigin: "0 0", transform, opacity, overflow: "visible" }}
        aria-hidden
      >
        {/* From the landing on, the paper that hides the footage's bell travels with this one (src/bell.ts HANDOFF). */}
        {carriesPaper(f) && probe !== "flight" ? (
          <rect
            x={PATCH_UNITS[0]}
            y={PATCH_UNITS[1]}
            width={PATCH_UNITS[2] - PATCH_UNITS[0]}
            height={PATCH_UNITS[3] - PATCH_UNITS[1]}
            fill={SIDEBAR_PAPER}
          />
        ) : null}
        <path fill={logoColors.green} d={markPath} />
      </svg>
    </AbsoluteFill>
  );
};
