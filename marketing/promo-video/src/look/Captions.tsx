/**
 * The captions of the product shots, on variant B's frosted-glass card
 * (lookdev STYLE-GUIDE §6.2): white 58% with a 28 px backdrop blur, a 1 px
 * inner light edge and an outer ink hairline, a soft tinted shadow.
 *
 * - A card comes in fast (opaque in 6 frames, settling 16 px) and its lines
 *   mask-rise from 70% risen on the same frames, fully opaque inside the
 *   card from its first visible frame, so the card is never seen empty (a
 *   frame of empty card came back in round 7 when the lines started two
 *   frames late) and no glyph tops show alone (COMPARISON.md must-fix 6).
 * - A cue that follows another one in the same shot keeps the same card:
 *   the old lines drop out over their last 6 frames at the old size; then,
 *   on the new cue's first frame, the card eases to the new text's size as
 *   the new lines rise (K2), so the card never blinks and never shows the
 *   old text off-centre in a resized card; a card that grows uncovers the
 *   end of the rising line as it opens (the card eases out fast, over 93% of
 *   the way on the new cue's first frame, where the line starts rising,
 *   still faint: no frame of an empty card).
 * - A cue that ends on a cut leaves with the cut.
 *
 * The title cues (S1, S2, S9's first line, S14) are drawn by their scenes
 * as display type. scripts/export-captions.mjs writes every cue to
 * captions.en.vtt/.srt.
 */
import { spring, useCurrentFrame } from "remotion";
import { fps } from "../music.ts";
import { timeline, type Caption, type CaptionPlace } from "../timeline.ts";
export { cardBox } from "./captionLayout.ts";
import { ease, mix, springs, tween } from "./motion.ts";
import { LIGHT } from "./Stage.tsx";
import { SANS } from "./fonts.ts";
import { ROLES, roleStyle } from "./type.tsx";
import { CARD_PAD, cardBox, cardPlace, estimateWidth } from "./captionLayout.ts";

/** Frames over which a kept card eases to the new cue's size, from its first frame. */
const SWAP = 5;

const widths = new Map<string, number>();
/** The rendered width of a caption line, measured once in the page with the loaded font. */
function measureLine(line: string) {
  const known = widths.get(line);
  if (known !== undefined) return known;
  if (typeof document === "undefined") return estimateWidth(line);
  const probe = document.createElement("span");
  const role = ROLES.caption;
  probe.style.cssText = [
    "position: absolute",
    "visibility: hidden",
    "left: 0",
    "top: 0",
    "white-space: pre",
    `font: ${role.weight} ${role.size}px ${SANS}`,
    `letter-spacing: ${role.tracking}em`,
    "font-optical-sizing: auto",
    "font-kerning: normal",
  ].join("; ");
  probe.textContent = line;
  document.body.appendChild(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  if (document.fonts.check(`${ROLES.caption.weight} ${ROLES.caption.size}px "Promo DM Sans"`)) widths.set(line, width);
  return width;
}

/** The cue in the same shot that hands over to `cue` on its first frame. */
const before = (cue: Caption, cues: readonly Caption[]) =>
  cues.find((other) => other !== cue && other.style === "card" && other.shot === cue.shot && other.to === cue.from);
const after = (cue: Caption, cues: readonly Caption[]) =>
  cues.find((other) => other !== cue && other.style === "card" && other.shot === cue.shot && other.from === cue.to);

/** Card opacity and lift for a cue at `frame`; zero outside it. A hand-over keeps the card. */
export function cardState(cue: Caption, frame: number, cues: readonly Caption[] = timeline.captions) {
  if (frame < cue.from || frame >= cue.to) return { opacity: 0, rise: 0 };
  if (before(cue, cues)) return { opacity: 1, rise: 0 };
  const enter = tween(frame, cue.from, cue.from + 6, ease.softArrive);
  const settle = spring({ frame: frame - cue.from, fps, config: springs.heroSettle });
  return { opacity: enter, rise: 16 * (1 - settle) };
}

export const GlassCaptions: React.FC = () => {
  const frame = useCurrentFrame();
  const cue = timeline.captions.find((c) => c.style === "card" && frame >= c.from && frame < c.to);
  if (!cue) return null;
  const { opacity, rise } = cardState(cue, frame);
  const from = before(cue, timeline.captions);
  const next = after(cue, timeline.captions);
  const box = cardBox(cue, measureLine);
  // A hand-over keeps the card: it holds the old size while the old lines leave, then eases to the new size from
  // the new cue's first frame, as the new lines rise.
  let width = box.width;
  let height = box.height;
  if (from) {
    const old = cardBox(from, measureLine);
    const swap = ease.arrive(Math.min(1, (frame - cue.from + 2) / SWAP));
    width = mix(old.width, box.width, swap);
    height = mix(old.height, box.height, swap);
  }
  const { left, top } = cardPlace(cue.place, width, height);
  // Lines leave over the cue's last frames when the next cue keeps the card.
  const leave = next ? tween(frame, cue.to - 6, cue.to, ease.depart) : 0;
  return (
    <>
      <LightPool place={cue.place} opacity={opacity} />
      <div
        style={{
          position: "absolute",
          left,
          top,
          width,
          height,
          transform: `translate3d(0, ${rise.toFixed(3)}px, 0)`,
          opacity,
          borderRadius: 26,
          overflow: "hidden",
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
        <div style={{ position: "absolute", left: CARD_PAD.x, top: CARD_PAD.top }}>
          {cue.lines.map((line, index) => (
            <MaskRise key={`${cue.from}-${index}`} frame={frame} enter={cue.from + index * (from ? 4 : 0)} solid={!from} leave={leave}>
              <div style={{ ...roleStyle(ROLES.caption), color: LIGHT.ink }}>{line}</div>
            </MaskRise>
          ))}
        </div>
      </div>
    </>
  );
};

/**
 * A soft pool of studio light behind the card, so the caption sits on a quiet
 * area rather than over busy UI (COMPARISON.md must-fix 6).
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

/**
 * K2 mask rise, starting 70% risen with an opacity ramp, so no glyph tops show
 * alone (COMPARISON.md: B's empty card at 364-368, C's glyph tops at
 * 366-368); `leave` (0..1) drops the line out again (X2).
 */
const MaskRise: React.FC<{ frame: number; enter: number; leave: number; solid?: boolean; children: React.ReactNode }> = ({
  frame,
  enter,
  leave,
  solid = false,
  children,
}) => {
  const rise = spring({ frame: frame - enter, fps, config: springs.typeRise });
  const y = (1 - rise) * 0.3 + 1.05 * leave;
  // A new card's lines are as opaque as the card itself from its first frame (the card's own fade carries them in);
  // a handed-over card's new lines fade up over it.
  const opacity = frame < enter ? 0 : (solid ? 1 : 0.35 + 0.65 * tween(frame, enter, enter + 6, ease.softArrive)) * (1 - leave);
  return (
    <div style={{ overflow: "hidden", paddingTop: "0.08em", marginTop: "-0.08em", paddingBottom: "0.16em", marginBottom: "-0.16em" }}>
      <div style={{ transform: `translate3d(0, ${y.toFixed(4)}em, 0)`, opacity }}>{children}</div>
    </div>
  );
};
