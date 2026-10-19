/**
 * The first hit (variant C): a hard cut from the dark stage to the light
 * studio (drawn under this by S3's ProductShot), the wordmark already crisp
 * ("lights on"), the studio flaring a little brighter for six frames, and a
 * slow linear push; under the wordmark, the product's own published
 * description says what BELL PR is (site/index.html's description, not new
 * positioning; an owner sign-off item). The wordmark's bell is not drawn
 * here: src/look/BellFlight.tsx draws it in its place on the same push, and
 * on beat 3 of bar 5 flies it into S3's window (src/bell.ts) while the name
 * and the descriptor dissolve (src/logo.ts) and the window comes in under
 * them, so the window never shows through the lockup (no double exposure).
 */
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";
import { DESCRIPTOR, flareAt, LOCKUP, logoState, logoTake } from "../logo.ts";
import { SANS } from "../look/fonts.ts";
import { blurCss } from "../look/motion.ts";
import { LIGHT } from "../look/Stage.tsx";
import { spaced } from "../look/type.tsx";

export const BrandHit: React.FC = () => {
  const f = useCurrentFrame() + logoTake.from;
  const logo = logoState(f);
  const flare = flareAt(f);
  return (
    <AbsoluteFill>
      {flare > 0.001 ? <AbsoluteFill style={{ backgroundColor: "#ffffff", opacity: flare }} /> : null}
      {logo.opacity > 0.001 ? (
        <AbsoluteFill
          style={{
            // The reviewed cut's own layout (a centred column: the wordmark, then the descriptor 34 px under it), so
            // the lockup lands on the same pixels at every render scale.
            alignItems: "center",
            justifyContent: "center",
            opacity: logo.opacity,
            filter: blurCss(logo.blur),
            transform: `translate3d(0, ${logo.y.toFixed(3)}px, 0) scale(${logo.scale.toFixed(5)})`,
            transformOrigin: "50% 50%",
          }}
        >
          {/*
            The reviewed cut's own wordmark image, clipped to its name ("BELL PR", from x 28% on; the mark ends at
            24.5%, the "B" starts at 31.9%), so the lockup lands on the same pixels as before at every render
            scale; its mark is drawn by BellFlight in the same place.
          */}
          <Img src={staticFile("brand-assets/logo-wordmark.svg")} style={{ width: LOCKUP.width, marginTop: LOCKUP.marginTop, clipPath: "inset(0 0 0 28%)" }} />
          <div
            style={{
              marginTop: LOCKUP.descriptorGap,
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
      ) : null}
    </AbsoluteFill>
  );
};
