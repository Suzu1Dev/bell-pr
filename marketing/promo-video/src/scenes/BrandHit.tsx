/**
 * The first hit (variant C): a hard cut from the dark stage to the light
 * studio, the wordmark already crisp ("lights on"), the studio flaring a
 * little brighter for six frames, and a slow linear push through the take;
 * under the wordmark, the product's own published description says what
 * BELL PR is (site/index.html's description, not new positioning; an owner
 * sign-off item). Then both lift and dissolve away (X1), so the logo has
 * fully gone before the product window enters (A's rule, no double
 * exposure).
 */
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";
import { DESCRIPTOR, flareAt, logoState, logoTake } from "../logo.ts";
import { SANS } from "../look/fonts.ts";
import { blurCss } from "../look/motion.ts";
import { LIGHT, StageImage } from "../look/Stage.tsx";
import { spaced } from "../look/type.tsx";

export const WORDMARK_WIDTH = 560;

export const BrandHit: React.FC = () => {
  const f = useCurrentFrame() + logoTake.from;
  const logo = logoState(f);
  const flare = flareAt(f);
  return (
    <AbsoluteFill>
      <StageImage kind="light" />
      {flare > 0.001 ? <AbsoluteFill style={{ backgroundColor: "#ffffff", opacity: flare }} /> : null}
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          opacity: logo.opacity,
          filter: blurCss(logo.blur),
          transform: `translate3d(0, ${logo.y.toFixed(3)}px, 0) scale(${logo.scale.toFixed(5)})`,
          transformOrigin: "50% 50%",
        }}
      >
        <Img src={staticFile("brand-assets/logo-wordmark.svg")} style={{ width: WORDMARK_WIDTH, marginTop: -110 }} />
        <div
          style={{
            marginTop: 34,
            fontFamily: SANS,
            fontSize: 44,
            fontWeight: 500,
            letterSpacing: "-0.008em",
            fontOpticalSizing: "auto",
            color: LIGHT.inkSecondary,
            whiteSpace: "pre",
          }}
        >
          {spaced(DESCRIPTOR)}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
