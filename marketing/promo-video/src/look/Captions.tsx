/**
 * The captions of the product shots, on variant B's frosted-glass card
 * (lookdev STYLE-GUIDE §6.2): white 55% with a 28 px backdrop blur, a 1 px
 * inner light edge and an outer ink hairline, a soft tinted shadow. The card
 * fades and rises in (12 f) while its lines mask-rise (K2: they start partly
 * risen with an opacity ramp, so no glyph tops show alone, COMPARISON.md
 * must-fix 6). A cue that ends on a cut leaves with the cut; one that hands
 * over to the next cue in the same shot fades out over 6 frames first.
 *
 * The title cues (S1, S2, S14) are drawn by their scenes as display type.
 * scripts/export-captions.mjs writes every cue to captions.en.vtt/.srt.
 */
import { spring, useCurrentFrame } from "remotion";
import { fps } from "../music.ts";
import { timeline, type Caption, type CaptionPlace } from "../timeline.ts";
import { ease, springs, tween } from "./motion.ts";
import { LIGHT } from "./Stage.tsx";
import { ROLES, roleStyle } from "./type.tsx";

const MARGIN = { x: 96, y: 80 };

const placeStyle = (place: CaptionPlace): React.CSSProperties => {
  switch (place) {
    case "bottom-right":
      return { right: MARGIN.x, bottom: MARGIN.y };
    case "top-left":
      return { left: MARGIN.x, top: MARGIN.y };
    case "top-right":
      return { right: MARGIN.x, top: MARGIN.y };
    case "bottom":
      return { left: "50%", bottom: MARGIN.y, transform: "translateX(-50%)" };
    default:
      return { left: MARGIN.x, bottom: MARGIN.y };
  }
};

/** Card opacity and lift for a cue at `frame`; zero outside it. */
export function cardState(cue: Caption, frame: number, cues: readonly Caption[] = timeline.captions) {
  if (frame < cue.from || frame >= cue.to) return { opacity: 0, rise: 0 };
  const handsOver = cues.some((other) => other !== cue && other.shot === cue.shot && other.from === cue.to);
  const enter = tween(frame, cue.from, cue.from + 12, ease.softArrive);
  const leave = handsOver ? 1 - tween(frame, cue.to - 6, cue.to, ease.depart) : 1;
  const settle = spring({ frame: frame - cue.from, fps, config: springs.heroSettle });
  return { opacity: Math.min(enter, leave), rise: 28 * (1 - settle) };
}

export const GlassCaptions: React.FC = () => {
  const frame = useCurrentFrame();
  const cue = timeline.captions.find((c) => c.style === "card" && frame >= c.from && frame < c.to);
  if (!cue) return null;
  const { opacity, rise } = cardState(cue, frame);
  const place = placeStyle(cue.place);
  const baseTransform = typeof place.transform === "string" ? `${place.transform} ` : "";
  return (
    <>
      <LightPool place={cue.place} opacity={opacity} />
      <div
      style={{
        position: "absolute",
        ...place,
        transform: `${baseTransform}translate3d(0, ${rise.toFixed(3)}px, 0)`,
        opacity,
        borderRadius: 26,
        padding: "26px 38px 28px",
        background: "rgba(255,255,255,0.58)",
        backdropFilter: "blur(28px) saturate(1.25)",
        WebkitBackdropFilter: "blur(28px) saturate(1.25)",
        boxShadow: [
          "inset 0 0 0 1px rgba(255,255,255,0.7)",
          "inset 0 1px 0 rgba(255,255,255,0.95)",
          "0 0 0 1px rgba(17,26,21,0.06)",
          "0 2px 6px rgba(22,43,36,0.05)",
          "0 24px 60px rgba(22,43,36,0.14)",
        ].join(", "),
      }}
    >
      {cue.lines.map((line, index) => (
        <MaskRise key={index} frame={frame} enter={cue.from + 2 + index * 6}>
          <div style={{ ...roleStyle(ROLES.caption), color: LIGHT.ink }}>{line}</div>
        </MaskRise>
      ))}
      </div>
    </>
  );
};

/**
 * A soft pool of studio light behind the card, so the caption sits on a quiet
 * area rather than over blurred UI (COMPARISON.md must-fix 6).
 */
const LightPool: React.FC<{ place: CaptionPlace; opacity: number }> = ({ place, opacity }) => {
  const right = place.endsWith("right");
  const top = place.startsWith("top");
  const centre = place === "bottom";
  return (
    <div
      style={{
        position: "absolute",
        left: centre ? 160 : right ? 760 : -240,
        width: centre ? 1600 : 1400,
        top: top ? -260 : 640,
        height: 700,
        opacity,
        background: `radial-gradient(ellipse 50% 50% at ${centre ? 50 : right ? 62 : 38}% ${top ? 44 : 56}%, rgba(247,248,245,0.9) 0%, rgba(247,248,245,0.62) 42%, rgba(247,248,245,0) 100%)`,
      }}
    />
  );
};

/** K2 mask rise, starting 45% risen under an opacity ramp. */
const MaskRise: React.FC<{ frame: number; enter: number; children: React.ReactNode }> = ({ frame, enter, children }) => {
  const rise = spring({ frame: frame - enter, fps, config: springs.typeRise });
  const y = (1 - rise) * 0.55;
  const opacity = tween(frame, enter, enter + 8, ease.softArrive);
  return (
    <div style={{ overflow: "hidden", paddingTop: "0.08em", marginTop: "-0.08em", paddingBottom: "0.16em", marginBottom: "-0.16em" }}>
      <div style={{ transform: `translate3d(0, ${y.toFixed(4)}em, 0)`, opacity }}>{children}</div>
    </div>
  );
};
