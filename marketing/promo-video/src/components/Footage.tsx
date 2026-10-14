/**
 * One captured image of the 1440x810 viewport (2880x1620 pixels) seen
 * through the camera. The image is scaled by layout size rather than a CSS
 * transform, so Chrome resamples it once at the output size and text stays
 * crisp; up to zoom 1.5 every output pixel has a source pixel behind it.
 */
import type { CSSProperties } from "react";
import { AbsoluteFill, Img, useVideoConfig } from "remotion";
import { cameraView, type Camera } from "../lib/camera.ts";
import { timeline } from "../timeline.ts";

export interface FootageProps {
  src: string;
  camera: Camera;
  style?: CSSProperties;
  imageStyle?: CSSProperties;
}

export const Footage: React.FC<FootageProps> = ({ src, camera, style, imageStyle }) => {
  const { width, height } = useVideoConfig();
  const { viewport } = timeline;
  const view = cameraView(camera, viewport, { width, height });
  return (
    <AbsoluteFill style={{ overflow: "hidden", ...style }}>
      <Img
        src={src}
        style={{
          position: "absolute",
          left: -view.left * view.scale,
          top: -view.top * view.scale,
          width: viewport.width * view.scale,
          height: viewport.height * view.scale,
          maxWidth: "none",
          ...imageStyle,
        }}
      />
    </AbsoluteFill>
  );
};
