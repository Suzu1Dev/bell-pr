/**
 * Type (lookdev STYLE-GUIDE §3): the roles of the type scale, variant C's
 * focus-pull line (K3 in, K5 rack focus, X3 defocus out) and the K6 light
 * sweep, drawn INSIDE the letters it crosses: the word's own glyphs carry the
 * band through `background-clip: text`, so the sweep can never misregister
 * against them (COMPARISON.md must-fix 1: the look-dev drew a second copy of
 * the letters, which landed 20 px off under the focus pull's scale).
 */
import type { CSSProperties } from "react";
import { interpolateColors } from "remotion";
import { CAPTION_ROLE } from "./captionLayout.ts";
import { SANS } from "./fonts.ts";
import { blurCss, ease, tween } from "./motion.ts";

export interface TypeRole {
  size: number;
  weight: number;
  tracking: number;
  lineHeight: number;
}

export const ROLES = {
  displayL: { size: 128, weight: 600, tracking: -0.02, lineHeight: 1.04 },
  displayM: { size: 88, weight: 600, tracking: -0.018, lineHeight: 1.08 },
  title: { size: 64, weight: 560, tracking: -0.015, lineHeight: 1.12 },
  supporting: { size: 52, weight: 500, tracking: -0.012, lineHeight: 1.15 },
  caption: CAPTION_ROLE,
  label: { size: 28, weight: 600, tracking: 0, lineHeight: 1.2 },
  legal: { size: 22, weight: 450, tracking: 0.005, lineHeight: 1.35 },
} satisfies Record<string, TypeRole>;

export const roleStyle = (r: TypeRole): CSSProperties => ({
  fontFamily: SANS,
  fontSize: r.size,
  fontWeight: r.weight,
  letterSpacing: `${r.tracking}em`,
  lineHeight: r.lineHeight,
  fontOpticalSizing: "auto",
  fontKerning: "normal",
  whiteSpace: "pre",
});

/** K3: blur 24 -> 0, scale 1.06 -> 1, opacity 0 -> 1 over 18 f (`arrive`). */
export const focusPull = (f: number, start: number, frames = 18) => {
  const p = tween(f, start, start + frames, ease.arrive);
  return { opacity: p, blur: 24 * (1 - p), scale: 1.06 - 0.06 * p };
};

/** X3: blur 0 -> 16 and opacity -> 0, finishing on `end`. */
export const defocusOut = (f: number, start: number, end: number) => {
  const p = tween(f, start, end, ease.standard);
  return { opacity: 1 - p, blur: 16 * p };
};

/** key: stays sharp (may take a color); soft: softens and dims in the rack; quiet: steps to a secondary color; base. */
export type Tone = "base" | "key" | "soft" | "quiet";
export interface Word {
  text: string;
  tone: Tone;
}

export const words = (text: string, tones: Record<number, Tone> = {}): Word[] =>
  text.split(" ").map((t, i) => ({ text: t, tone: tones[i] ?? "base" }));

export interface Rack {
  at: number;
  dimTo: string;
  keyTo?: string;
  quietTo?: string;
  /** px of blur on the softened words (K5: 3; capped at 2 where the frame must work as a still). */
  soften?: number;
  frames?: number;
}

export const FocusLine: React.FC<{
  words: Word[];
  frame: number;
  enter: number;
  exit?: { start: number; end: number };
  rack?: Rack;
  /** K6: the frame the sweep starts crossing the key words (24 f). */
  sweepAt?: number;
  role: TypeRole;
  color: string;
  style?: CSSProperties;
}> = ({ words: list, frame, enter, exit, rack, sweepAt, role, color, style }) => {
  const k3 = focusPull(frame, enter);
  const x3 = exit ? defocusOut(frame, exit.start, exit.end) : { opacity: 1, blur: 0 };
  const opacity = k3.opacity * x3.opacity;
  const r = rack ? tween(frame, rack.at, rack.at + (rack.frames ?? 12), ease.standard) : 0;
  const sweep = sweepAt === undefined ? undefined : tween(frame, sweepAt, sweepAt + 24, ease.sweep);
  const sweepOn = sweep !== undefined && sweep > 0 && sweep < 1;
  return (
    <div
      style={{
        ...roleStyle(role),
        color,
        opacity,
        filter: blurCss(k3.blur + x3.blur),
        transform: `scale(${k3.scale.toFixed(5)})`,
        transformOrigin: "50% 55%",
        wordSpacing: DISPLAY_WORD_SPACING,
        visibility: opacity <= 0.001 ? "hidden" : undefined,
        ...style,
      }}
    >
      {list.map((w, i) => {
        const tone =
          rack && w.tone === "soft"
            ? interpolateColors(r, [0, 1], [color, rack.dimTo])
            : rack && w.tone === "key" && rack.keyTo
              ? interpolateColors(r, [0, 1], [color, rack.keyTo])
              : rack && w.tone === "quiet" && rack.quietTo
                ? interpolateColors(r, [0, 1], [color, rack.quietTo])
                : color;
        const soft = rack && w.tone === "soft" ? (rack.soften ?? 3) * r : 0;
        const swept = sweepOn && w.tone === "key";
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              // The space after "AI" opens a little more than the others (spaced()).
              wordSpacing: w.text.includes("AI") ? `calc(${DISPLAY_WORD_SPACING} + ${AI_AIR.space}em)` : undefined,
              color: swept ? "transparent" : tone,
              filter: blurCss(soft),
              ...(swept
                ? {
                    backgroundImage: `linear-gradient(105deg, rgba(255,255,255,0) 44%, rgba(255,255,255,0.75) 50%, rgba(255,255,255,0) 56%), linear-gradient(${tone}, ${tone})`,
                    backgroundSize: "300% 100%, 100% 100%",
                    backgroundPosition: `${((1 - sweep!) * 100).toFixed(2)}% 0, 0 0`,
                    backgroundRepeat: "no-repeat",
                    WebkitBackgroundClip: "text",
                    backgroundClip: "text",
                  }
                : null),
            }}
          >
            {spaced(w.text)}
            {i < list.length - 1 ? " " : ""}
          </span>
        );
      })}
    </div>
  );
};

/**
 * In DM Sans a capital I and a lowercase l are the same plain stem, so "AI"
 * reads as "Al" at display sizes: a little air after the A (+0.02em) keeps
 * the pair apart, and the space after the word opens by 0.1em, so the pair
 * never sits as far apart as the words round it ("A Imade", review round 7).
 */
export const AI_AIR = { pair: 0.02, space: 0.1 } as const;
export const spaced = (text: string) => {
  const at = text.indexOf("AI");
  if (at < 0) return text;
  const end = at + 2;
  const space = text[end] === " " || text[end] === "-" ? 1 : 0;
  return (
    <>
      {text.slice(0, at)}
      <span style={{ letterSpacing: `${AI_AIR.pair}em` }}>A</span>
      {text.slice(at + 1, end)}
      {space ? <span style={{ wordSpacing: text[end] === " " ? `${AI_AIR.space}em` : undefined }}>{text[end]}</span> : null}
      {text.slice(end + space)}
    </>
  );
};

/** Display lines open their word spaces a little (+0.06em): the display cut's tight default reads crowded at 88 px. */
export const DISPLAY_WORD_SPACING = "0.06em";
