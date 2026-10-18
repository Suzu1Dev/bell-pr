/**
 * S14 End on the dark stage, the bookend of the opening:
 *
 * - a hard cut on the measured final hit (the pushed kick); the logo, large
 *   and centred, pulls into focus and locks ON the final chord: the last of
 *   its resolve and its settle from 1.02 happen on the three frames before
 *   the chord, with the glint (a sweep across the near-white wordmark could
 *   not be seen, so there is none: review round 7);
 * - one beat later it moves up to its slot, and the owner's headline comes
 *   in beat by beat: "From vibe coding" / "to knowing why.";
 * - on the next beat "vibe coding" racks soft and dim while "knowing why."
 *   turns mint and "From"/"to" stay near white (COMPARISON.md must-fixes
 *   1-2), and the call to action comes in at once: `npx bell-pr`, "Free to
 *   start · Runs on your machine", the homepage only when shared/product.ts
 *   sets one, and the non-affiliation line;
 * - "vibe coding" then resolves back to sharp (it keeps its dim), so the
 *   complete card holds sharp for over three seconds, past the music's last
 *   sound, and the picture fades to black on the last frames.
 */
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";
import { MONO, SANS } from "../look/fonts.ts";
import { blurCss, ease, tween } from "../look/motion.ts";
import { DARK, StageImage } from "../look/Stage.tsx";
import { FocusLine, ROLES, words } from "../look/type.tsx";
import { endLogoPlace, endLogoState } from "../logo.ts";
import { music } from "../music.ts";
import { FADE_OUT_FRAMES, shotById } from "../timeline.ts";
import { product } from "../../../../shared/product.ts";

const shot = shotById("s14-end");
const beat = music.beatFrames;
const LOGO_RATIO = 64 / 196;
/** The call to action's size: the one command a viewer must read, about 12 px even in a phone-width embed. */
export const CTA_SIZE = 60;

/** The beats of the end card, from the headline's first line. */
export const endBeats = (() => {
  const line1 = shot.captions[0].from;
  const rack = line1 + 2 * beat;
  return { line1, line2: line1 + beat, rack, footer: rack, sharpFrom: rack + beat, sharp: rack + 2 * beat, fade: shot.to - FADE_OUT_FRAMES };
})();

export const EndCard: React.FC = () => {
  const f = useCurrentFrame() + shot.from;
  const { line1, line2, rack, footer: footerAt, sharpFrom, sharp, fade } = endBeats;
  const logo = endLogoState(f);
  const place = endLogoPlace(f);
  const footer = tween(f, footerAt, footerAt + beat, ease.softArrive);
  const drift = 1 + (0.008 * (f - shot.from)) / music.barFrames;
  // "vibe coding" softens with the rack and resolves to sharp a beat later, keeping its dim.
  const soften = 1.6 * (1 - tween(f, sharpFrom, sharp, ease.standard));
  const black = tween(f, fade, shot.to - 1, ease.standard);
  const logoHeight = place.width * LOGO_RATIO;
  return (
    <AbsoluteFill style={{ backgroundColor: DARK.edge }}>
      <StageImage kind="dark" />
      <AbsoluteFill style={{ alignItems: "center", transform: `scale(${drift.toFixed(5)})`, transformOrigin: "50% 45%" }}>
        <div
          style={{
            position: "absolute",
            top: place.cy - logoHeight / 2,
            width: place.width,
            height: logoHeight,
            opacity: logo.opacity,
            filter: blurCss(logo.blur),
            transform: `scale(${logo.scale.toFixed(5)})`,
          }}
        >
          <Img src={staticFile("brand-assets/logo-on-dark.svg")} style={{ width: "100%", display: "block" }} />
        </div>
        <FocusLine
          words={words("From vibe coding", { 0: "base", 1: "soft", 2: "soft" })}
          frame={f}
          enter={line1}
          rack={{ at: rack, dimTo: DARK.dim, soften: f >= sharpFrom ? soften : 1.6, frames: 14 }}
          role={ROLES.displayL}
          color={DARK.text}
          style={{ position: "absolute", top: 372 }}
        />
        <FocusLine
          words={words("to knowing why.", { 0: "base", 1: "key", 2: "key" })}
          frame={f}
          enter={line2}
          rack={{ at: rack, dimTo: DARK.dim, keyTo: DARK.mint, frames: 14 }}
          sweepAt={rack + 8}
          role={ROLES.displayL}
          color={DARK.text}
          style={{ position: "absolute", top: 372 + 133 }}
        />
        <div
          style={{
            position: "absolute",
            top: 712,
            display: "flex",
            alignItems: "baseline",
            gap: 36,
            opacity: footer,
            transform: `translate3d(0, ${(14 * (1 - footer)).toFixed(3)}px, 0)`,
          }}
        >
          <span style={{ fontFamily: MONO, fontWeight: 500, fontSize: CTA_SIZE, color: DARK.mint, letterSpacing: 0 }}>npx bell-pr</span>
          <span style={{ fontFamily: SANS, fontWeight: 560, fontSize: 32, color: DARK.secondary, fontOpticalSizing: "auto" }}>
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
            opacity: footer,
          }}
        >
          BELL PR is independent and not affiliated with GitHub, OpenAI or Anthropic.
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{ backgroundColor: "#000000", opacity: black }} />
    </AbsoluteFill>
  );
};
