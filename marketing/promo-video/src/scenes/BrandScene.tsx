/**
 * S2: the brand, on the riser into the beat drop. "Meet" and the logo on the
 * brand green; the cut to the product comes with the drop.
 */
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { fonts, logos } from "../brand.ts";
import { timeline, type Shot } from "../timeline.ts";

export const BrandScene: React.FC<{ shot: Shot }> = ({ shot }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const duration = shot.to - shot.from;
  const cue = timeline.captions.find(
    (each) => each.style === "title" && each.from >= shot.from && each.to <= shot.to,
  );
  const cueFrom = (cue?.from ?? shot.from) - shot.from;
  const kicker = spring({ frame: frame - cueFrom, fps, config: { damping: 200 }, durationInFrames: 14 });
  const logo = spring({ frame: frame - cueFrom - 6, fps, config: { damping: 200 }, durationInFrames: 18 });
  const push = interpolate(frame, [0, duration], [0.96, 1.04]);
  return (
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(1300px 760px at 50% 45%, var(--color-brand-600) 0%, var(--color-brand-700) 70%, #11402e 100%)",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: fonts.sans,
      }}
    >
      <div style={{ transform: `scale(${push})`, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div
          style={{
            opacity: kicker,
            transform: `translateY(${(1 - kicker) * 16}px)`,
            color: "var(--color-brand-200)",
            fontSize: 52,
            fontWeight: 600,
            letterSpacing: "0.01em",
            marginBottom: 36,
          }}
        >
          Meet
        </div>
        <Img
          src={staticFile(logos.onDark)}
          style={{ height: 196, opacity: logo, transform: `scale(${0.9 + 0.1 * logo})` }}
        />
      </div>
    </AbsoluteFill>
  );
};
