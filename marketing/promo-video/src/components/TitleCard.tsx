/**
 * A full-frame title: one or two lines that rise in and fade out, with an
 * optional kicker above them. `from` and `to` are frames relative to the
 * enclosing sequence.
 */
import type { ReactNode } from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { fonts } from "../brand.ts";

export interface TitleCardProps {
  from: number;
  to: number;
  children: ReactNode;
  kicker?: ReactNode;
  /** Text color; dark ink by default. */
  color?: string;
  kickerColor?: string;
  size?: number;
}

export const TitleCard: React.FC<TitleCardProps> = ({
  from,
  to,
  children,
  kicker,
  color = "var(--color-text)",
  kickerColor = "var(--color-brand-600)",
  size = 92,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < from || frame >= to) return null;
  const enter = spring({ frame: frame - from, fps, config: { damping: 200 }, durationInFrames: 18 });
  const exit = interpolate(frame, [to - 8, to], [1, 0], { extrapolateLeft: "clamp" });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: "0 8%" }}>
      <div
        style={{
          opacity: Math.min(enter, exit),
          transform: `translateY(${(1 - enter) * 28}px)`,
          textAlign: "center",
          fontFamily: fonts.sans,
        }}
      >
        {kicker && (
          <div
            style={{
              color: kickerColor,
              fontSize: Math.round(size * 0.42),
              fontWeight: 600,
              letterSpacing: "0.02em",
              marginBottom: Math.round(size * 0.3),
            }}
          >
            {kicker}
          </div>
        )}
        <div
          style={{
            color,
            fontSize: size,
            fontWeight: 700,
            lineHeight: 1.12,
            letterSpacing: "-0.025em",
            whiteSpace: "pre-line",
          }}
        >
          {children}
        </div>
      </div>
    </AbsoluteFill>
  );
};
