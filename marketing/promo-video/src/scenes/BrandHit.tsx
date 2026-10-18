/**
 * The first hit (variant C): a hard cut from the dark stage to the light
 * studio, the wordmark already crisp ("lights on"), settling from 1.02 with
 * `macroLock` and breathing for two beats; then it lifts and dissolves away
 * (X1), so the logo has fully gone before the product window enters (A's
 * rule, no double exposure).
 */
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";
import { logoState, logoTake } from "../logo.ts";
import { blurCss } from "../look/motion.ts";
import { StageImage } from "../look/Stage.tsx";

export const WORDMARK_WIDTH = 560;

export const BrandHit: React.FC = () => {
  const f = useCurrentFrame() + logoTake.from;
  const logo = logoState(f);
  return (
    <AbsoluteFill>
      <StageImage kind="light" />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <Img
          src={staticFile("brand-assets/logo-wordmark.svg")}
          style={{
            width: WORDMARK_WIDTH,
            marginTop: -54,
            opacity: logo.opacity,
            filter: blurCss(logo.blur),
            transform: `translate3d(0, ${logo.y.toFixed(3)}px, 0) scale(${logo.scale.toFixed(5)})`,
          }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
