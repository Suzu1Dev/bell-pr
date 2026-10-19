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
 *   1-2), and the call to action comes in at once: `npx bell-pr` alone on
 *   its line, "Free to start · Runs on your machine" on its own line under
 *   it, smaller and quieter (owner's feedback after round 8: the two on one
 *   row read as clutter), the homepage only when shared/product.ts sets
 *   one, and the non-affiliation line (src/scenes/endCardLayout.ts);
 * - "vibe coding" then resolves back to sharp (it keeps its dim), so the
 *   complete card holds sharp for over three seconds, past the music's last
 *   sound, and the picture fades to black on the last frames.
 */
import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";
import { MONO, SANS } from "../look/fonts.ts";
import { blurCss, ease, tween } from "../look/motion.ts";
import { DARK, StageImage } from "../look/Stage.tsx";
import { FocusLine, ROLES, words } from "../look/type.tsx";
import { endLogoPlace, endLogoState } from "../logo.ts";
import { music } from "../music.ts";
import { FADE_OUT_FRAMES, shotById } from "../timeline.ts";
import { product } from "../../../../shared/product.ts";
import { END_CARD, lineTop, type CardLine } from "./endCardLayout.ts";

const shot = shotById("s14-end");
const beat = music.beatFrames;
const LOGO_RATIO = 64 / 196;
/** The call to action's size: the one command a viewer must read, about 12 px even in a phone-width embed. */
export const CTA_SIZE = END_CARD.command.size;

/** One centred line of the card, its box placed so its baseline lands where src/scenes/endCardLayout.ts puts it. */
const Line: React.FC<{ line: CardLine; opacity: number; rise?: number; style: CSSProperties; children: ReactNode }> = ({ line, opacity, rise = 0, style, children }) => (
  <div
    style={{
      position: "absolute",
      left: 0,
      right: 0,
      top: lineTop(line),
      height: line.normal ? undefined : line.lineHeight,
      lineHeight: line.normal ? "normal" : `${line.lineHeight}px`,
      fontSize: line.size,
      textAlign: "center",
      whiteSpace: "pre",
      opacity,
      transform: rise ? `translate3d(0, ${rise.toFixed(3)}px, 0)` : undefined,
      ...style,
    }}
  >
    {children}
  </div>
);

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
  const rise = 14 * (1 - footer);
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
          style={{ position: "absolute", top: END_CARD.headlineTops[0] }}
        />
        <FocusLine
          words={words("to knowing why.", { 0: "base", 1: "key", 2: "key" })}
          frame={f}
          enter={line2}
          rack={{ at: rack, dimTo: DARK.dim, keyTo: DARK.mint, frames: 14 }}
          sweepAt={rack + 8}
          role={ROLES.displayL}
          color={DARK.text}
          style={{ position: "absolute", top: END_CARD.headlineTops[1] }}
        />
        {/* The call to action: the command alone on its line, the facts on their own line under it, quieter. */}
        <Line line={END_CARD.command} opacity={footer} rise={rise} style={{ fontFamily: MONO, fontWeight: 500, color: DARK.mint, letterSpacing: 0 }}>
          npx bell-pr
        </Line>
        <Line line={END_CARD.facts} opacity={footer} rise={rise} style={{ fontFamily: SANS, fontWeight: 500, color: DARK.secondary, fontOpticalSizing: "auto" }}>
          Free to start · Runs on your machine
        </Line>
        {product.homepageUrl ? (
          <Line line={END_CARD.homepage} opacity={footer} rise={rise} style={{ fontFamily: SANS, fontWeight: 500, color: DARK.secondary }}>
            {product.homepageUrl.replace(/^https?:\/\//, "")}
          </Line>
        ) : null}
        <Line line={END_CARD.footer} opacity={footer} style={{ fontFamily: SANS, fontWeight: 450, letterSpacing: "0.005em", color: DARK.muted }}>
          BELL PR is independent and not affiliated with GitHub, OpenAI or Anthropic.
        </Line>
      </AbsoluteFill>
      <AbsoluteFill style={{ backgroundColor: "#000000", opacity: black }} />
    </AbsoluteFill>
  );
};
