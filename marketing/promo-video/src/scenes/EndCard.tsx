/**
 * S14 End on the dark stage, the bookend of the opening: a hard cut on the
 * measured final hit; the logo pulls into focus and locks on the final chord
 * (music.landingFrame) with one light sweep inside its letters; then the
 * owner's headline, beat by beat: "From vibe coding" / "to knowing why.",
 * with "vibe coding" racked soft and dim (2 px at most, so the rest frame
 * works as a still) and "knowing why." turning mint while "From" and "to"
 * stay near white (COMPARISON.md must-fixes 1-2). Then `npx bell-pr`,
 * "Free to start · Runs on your machine", the homepage only when
 * shared/product.ts sets one, and the non-affiliation line.
 */
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";
import { MONO, SANS } from "../look/fonts.ts";
import { blurCss, ease, tween } from "../look/motion.ts";
import { DARK, StageImage } from "../look/Stage.tsx";
import { FocusLine, ROLES, words } from "../look/type.tsx";
import { endLogoState } from "../logo.ts";
import { music } from "../music.ts";
import { shotById } from "../timeline.ts";
import { product } from "../../../../shared/product.ts";

const shot = shotById("s14-end");
const beat = music.beatFrames;
const land = music.landingFrame;
/** The logo's focus pull runs from the cut to the chord. */
export const LOGO_WIDTH = 330;

export const EndCard: React.FC = () => {
  const f = useCurrentFrame() + shot.from;
  const headline = shot.captions[0];
  const [line1, line2] = ["From vibe coding", "to knowing why."];
  const rack = headline.from + 2 * beat;
  const logo = endLogoState(f);
  const sweep = tween(f, land + 4, land + 28, ease.sweep);
  const sweepOn = f >= land + 4 && f <= land + 28;
  const footer = tween(f, rack + beat, rack + 2 * beat, ease.softArrive);
  const legal = tween(f, rack + 2 * beat, rack + 3 * beat, ease.softArrive);
  const drift = 1 + (0.008 * (f - shot.from)) / music.barFrames;
  return (
    <AbsoluteFill style={{ backgroundColor: DARK.edge }}>
      <StageImage kind="dark" />
      <AbsoluteFill style={{ alignItems: "center", transform: `scale(${drift.toFixed(5)})`, transformOrigin: "50% 45%" }}>
        <div
          style={{
            position: "absolute",
            top: 168,
            width: LOGO_WIDTH,
            height: (LOGO_WIDTH * 64) / 196,
            opacity: logo.opacity,
            filter: blurCss(logo.blur),
            transform: `scale(${logo.scale.toFixed(5)})`,
          }}
        >
          <Img src={staticFile("brand-assets/logo-on-dark.svg")} style={{ width: "100%", display: "block" }} />
          {sweepOn ? (
            <div
              style={{
                position: "absolute",
                inset: 0,
                // The band is masked by the logo itself, so it can only light the letters.
                maskImage: `url(${staticFile("brand-assets/logo-on-dark.svg")})`,
                WebkitMaskImage: `url(${staticFile("brand-assets/logo-on-dark.svg")})`,
                maskSize: "100% 100%",
                WebkitMaskSize: "100% 100%",
                background: "linear-gradient(105deg, rgba(255,255,255,0) 40%, rgba(255,255,255,0.85) 50%, rgba(255,255,255,0) 60%)",
                backgroundSize: "300% 100%",
                backgroundPosition: `${((1 - sweep) * 100).toFixed(2)}% 0`,
                mixBlendMode: "screen",
              }}
            />
          ) : null}
        </div>
        <FocusLine
          words={words(line1, { 0: "base", 1: "soft", 2: "soft" })}
          frame={f}
          enter={headline.from}
          rack={{ at: rack, dimTo: DARK.dim, soften: 1.6, frames: 14 }}
          role={ROLES.displayL}
          color={DARK.text}
          style={{ position: "absolute", top: 372 }}
        />
        <FocusLine
          words={words(line2, { 0: "base", 1: "key", 2: "key" })}
          frame={f}
          enter={headline.from + beat}
          rack={{ at: rack, dimTo: DARK.dim, keyTo: DARK.mint, frames: 14 }}
          sweepAt={rack + 8}
          role={ROLES.displayL}
          color={DARK.text}
          style={{ position: "absolute", top: 372 + 133 }}
        />
        <div
          style={{
            position: "absolute",
            top: 724,
            display: "flex",
            alignItems: "baseline",
            gap: 36,
            opacity: footer,
            transform: `translate3d(0, ${(14 * (1 - footer)).toFixed(3)}px, 0)`,
          }}
        >
          <span style={{ fontFamily: MONO, fontWeight: 500, fontSize: 44, color: DARK.mint, letterSpacing: 0 }}>npx bell-pr</span>
          <span style={{ fontFamily: SANS, fontWeight: 560, fontSize: 30, color: DARK.secondary, fontOpticalSizing: "auto" }}>
            Free to start · Runs on your machine
          </span>
        </div>
        {product.homepageUrl ? (
          <div style={{ position: "absolute", top: 806, fontFamily: SANS, fontWeight: 500, fontSize: 28, color: DARK.secondary, opacity: footer }}>
            {product.homepageUrl.replace(/^https?:\/\//, "")}
          </div>
        ) : null}
        <div
          style={{
            position: "absolute",
            top: 968,
            fontFamily: SANS,
            fontWeight: 450,
            fontSize: 22,
            letterSpacing: "0.005em",
            color: DARK.muted,
            opacity: legal,
          }}
        >
          BELL PR is independent and not affiliated with GitHub, OpenAI or Anthropic.
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
