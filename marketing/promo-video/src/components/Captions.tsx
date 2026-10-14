/**
 * The burned-in captions: each cue of timeline.json (other than the title
 * cues, which their scenes draw) on a semi-opaque brand-dark pill. The pill
 * sits in the lower third inside the 90% title-safe area, or near the top
 * when the cue asks for it. scripts/export-captions.mjs writes the same cues
 * to captions.en.vtt and .srt, so both carry identical timings.
 */
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { fonts } from "../brand.ts";
import { timeline, type Caption } from "../timeline.ts";

const fadeFrames = 6;

/** The cue on screen at composition frame `frame`, if any (title cues excluded). */
export function captionAt(captions: readonly Caption[], frame: number): Caption | undefined {
  return captions.find((cue) => cue.style !== "title" && frame >= cue.from && frame < cue.to);
}

export const Captions: React.FC = () => {
  const frame = useCurrentFrame();
  const { height } = useVideoConfig();
  const cue = captionAt(timeline.captions, frame);
  if (!cue) return null;
  const opacity = Math.min(
    interpolate(frame, [cue.from, cue.from + fadeFrames], [0, 1], { extrapolateRight: "clamp" }),
    interpolate(frame, [cue.to - fadeFrames, cue.to], [1, 0], { extrapolateLeft: "clamp" }),
  );
  const rise = interpolate(frame, [cue.from, cue.from + fadeFrames], [14, 0], {
    extrapolateRight: "clamp",
  });
  const top = cue.position === "top";
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: top ? "flex-start" : "flex-end",
        padding: `${Math.round(height * 0.065)}px ${Math.round(height * 0.1)}px`,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          opacity,
          transform: `translateY(${top ? -rise : rise}px)`,
          maxWidth: "90%",
          padding: "16px 34px 18px",
          borderRadius: 22,
          background: "rgb(23 41 32 / 86%)",
          boxShadow: "0 10px 40px rgb(22 43 36 / 28%)",
          color: "#ffffff",
          fontFamily: fonts.sans,
          fontWeight: 600,
          fontSize: 46,
          lineHeight: 1.25,
          letterSpacing: "-0.01em",
          textAlign: "center",
          whiteSpace: "pre-line",
        }}
      >
        {cue.text}
      </div>
    </AbsoluteFill>
  );
};
