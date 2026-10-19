/**
 * The v1.1 launch film: the fourteen shots of src/timeline.ts on the music
 * of music/track.analysis.json, the captions over them, the soundtrack under
 * them. 1920x1080 at 30 fps; the 4K master is the same composition rendered
 * with --scale=2.
 */
import { AbsoluteFill, Sequence } from "remotion";
import type { Footage } from "./footage.ts";
import "./look/fonts.ts";
import { GlassCaptions } from "./look/Captions.tsx";
import { HANDOFF } from "./bell.ts";
import { TEXT_LEAVE } from "./logo.ts";
import { BellFlight } from "./look/BellFlight.tsx";
import { BrandHit } from "./scenes/BrandHit.tsx";
import { ClimaxTitle, climaxTitle } from "./scenes/ClimaxTitle.tsx";
import { EndCard } from "./scenes/EndCard.tsx";
import { Opening } from "./scenes/Opening.tsx";
import { ProductShot } from "./scenes/ProductShot.tsx";
import { Soundtrack } from "./Soundtrack.tsx";
import { shotById, takeOf, timeline } from "./timeline.ts";

export interface PromoProps {
  [key: string]: unknown;
  /** From calculateMetadata: the captured footage's metadata. */
  footage: Footage | null;
  /** Level checks render the music or the effects alone. */
  music?: boolean;
  sfx?: boolean;
  /**
   * The bell's landing check (scripts/check-moments.mjs) renders the flying bell alone (the footage's bell patched
   * out on every frame) or the footage's bell alone (no flying bell, no patch), and compares the two.
   */
  bellProbe?: "flight" | "footage";
}

const opening = { from: shotById("s1-problem").from, to: shotById("s2-turn").to };
const s3 = shotById("s3-rules");
const logo = takeOf(s3, "logo");
const end = shotById("s14-end");

export const Promo: React.FC<PromoProps> = ({ footage, music = true, sfx = true, bellProbe }) => {
  if (!footage) throw new Error('The footage metadata did not load; run "npm run capture".');
  return (
    <AbsoluteFill style={{ backgroundColor: "#020403" }}>
      <Sequence from={opening.from} durationInFrames={opening.to - opening.from} name="S1-S2 opening">
        <Opening />
      </Sequence>
      {timeline.shots
        .filter((shot) => shot.from >= opening.to && shot.id !== end.id)
        .map((shot) => (
          <Sequence key={shot.id} from={shot.from} durationInFrames={shot.to - shot.from} name={`${shot.id}: ${shot.title}`}>
            <ProductShot
              shot={shot}
              footage={footage}
              skip={["logo", "title"]}
              bellProbe={bellProbe}
              // The first-hit lockup sits on the studio, under the window that rises in as it dissolves.
              under={
                shot.id === s3.id ? (
                  <Sequence durationInFrames={TEXT_LEAVE.to - logo.from} name="S3 lockup on the hit">
                    <BrandHit />
                  </Sequence>
                ) : undefined
              }
            />
          </Sequence>
        ))}
      <Sequence from={logo.from} durationInFrames={HANDOFF.bell.to - logo.from} name="S3 the bell's flight">
        <BellFlight from={logo.from} probe={bellProbe} />
      </Sequence>
      <Sequence from={climaxTitle.from} durationInFrames={climaxTitle.to - climaxTitle.from} name="S9 title on the dark stage">
        <ClimaxTitle />
      </Sequence>
      <Sequence from={end.from} durationInFrames={end.to - end.from} name="S14 end card">
        <EndCard />
      </Sequence>
      <GlassCaptions />
      <Soundtrack footage={footage} withMusic={music} withSfx={sfx} />
    </AbsoluteFill>
  );
};
