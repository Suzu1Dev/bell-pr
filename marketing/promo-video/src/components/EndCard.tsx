/**
 * The closing card: the logo lands on the music's measured final hit, then
 * the install command, the plans and the non-affiliation line follow on the
 * next beats. The homepage shows only once shared/product.ts names one.
 */
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { product, productLink } from "../../../../shared/product.ts";
import { fonts, logos } from "../brand.ts";

export interface EndCardProps {
  /** Sequence frame at which the logo lands (the hit). */
  land: number;
  /** Sequence frames of the beats the other lines arrive on. */
  beats: [number, number, number];
}

/** 0 → 1 as an element arrives at `at`, easing in over 9 frames. */
function useArrival(at: number) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - at + 9, fps, config: { damping: 200 }, durationInFrames: 12 });
}

export const EndCard: React.FC<EndCardProps> = ({ land, beats }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // The logo drops in over the frames before the hit and settles on it.
  const drop = spring({ frame: frame - land + 5, fps, config: { damping: 11, stiffness: 170, mass: 0.6 } });
  const logoScale = interpolate(drop, [0, 1], [1.3, 1]);
  const logoOpacity = interpolate(frame, [land - 5, land - 2], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const command = useArrival(beats[0]);
  const plans = useArrival(beats[1]);
  const notice = useArrival(beats[2]);
  const homepage = productLink("homepageUrl");
  const rise = (p: number) => ({ opacity: p, transform: `translateY(${(1 - p) * 18}px)` });
  return (
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(1200px 700px at 50% 42%, var(--color-surface) 0%, var(--color-brand-50) 62%, var(--color-brand-100) 100%)",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: fonts.sans,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: -40 }}>
        <Img
          src={staticFile(logos.wordmark)}
          style={{
            height: 150,
            opacity: logoOpacity,
            transform: `scale(${logoScale})`,
          }}
        />
        <div
          style={{
            ...rise(command),
            marginTop: 64,
            padding: "18px 40px 20px",
            borderRadius: 18,
            background: "var(--color-text)",
            color: "#ffffff",
            fontFamily: fonts.mono,
            fontWeight: 500,
            fontSize: 48,
            letterSpacing: "-0.01em",
            boxShadow: "0 16px 48px rgb(22 43 36 / 22%)",
          }}
        >
          <span style={{ color: "var(--color-brand-300)", marginRight: 22 }}>$</span>
          npx {product.npmPackage}
        </div>
        <div
          style={{
            ...rise(plans),
            marginTop: 40,
            color: "var(--color-text-secondary)",
            fontSize: 40,
            fontWeight: 600,
            letterSpacing: "-0.005em",
          }}
        >
          Free · Pro · 14-day trial
        </div>
        {homepage && (
          <div style={{ ...rise(plans), marginTop: 18, color: "var(--color-brand-700)", fontSize: 34, fontWeight: 600 }}>
            {homepage.replace(/^https?:\/\//, "")}
          </div>
        )}
      </div>
      <div
        style={{
          ...rise(notice),
          position: "absolute",
          bottom: 64,
          color: "var(--color-text-muted)",
          fontSize: 25,
          fontWeight: 500,
        }}
      >
        {product.name} is independent and not affiliated with GitHub, OpenAI or Anthropic.
      </div>
    </AbsoluteFill>
  );
};
