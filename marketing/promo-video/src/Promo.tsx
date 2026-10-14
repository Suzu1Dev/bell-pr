/**
 * The 75-second promo: every shot of timeline.json in its sequence, the
 * captions over them and the music under them.
 */
import { AbsoluteFill, Sequence } from "remotion";
import "./brand.ts";
import { Captions } from "./components/Captions.tsx";
import { Music } from "./components/Music.tsx";
import type { Footage } from "./footage.ts";
import { BrandScene } from "./scenes/BrandScene.tsx";
import { EndScene } from "./scenes/EndScene.tsx";
import { FootageScene } from "./scenes/FootageScene.tsx";
import { ProblemScene } from "./scenes/ProblemScene.tsx";
import { timeline, type Shot } from "./timeline.ts";

export interface PromoProps {
  [key: string]: unknown;
  /** From calculateMetadata: the captured footage's metadata. */
  footage: Footage | null;
}

function Scene({ shot, footage }: { shot: Shot; footage: Footage }) {
  switch (shot.scene) {
    case "problem":
      return <ProblemScene shot={shot} />;
    case "brand":
      return <BrandScene shot={shot} />;
    case "end":
      return <EndScene shot={shot} />;
    default: {
      const shotFootage = footage[shot.id];
      if (!shotFootage) throw new Error(`No footage for ${shot.id}; run "npm run capture".`);
      return <FootageScene shot={shot} footage={shotFootage} />;
    }
  }
}

export const Promo: React.FC<PromoProps> = ({ footage }) => {
  if (!footage) throw new Error('The footage metadata did not load; run "npm run capture".');
  return (
    <AbsoluteFill style={{ backgroundColor: "var(--color-bg)" }}>
      {timeline.shots.map((shot) => (
        <Sequence key={shot.id} from={shot.from} durationInFrames={shot.to - shot.from} name={`${shot.id}: ${shot.title}`}>
          <Scene shot={shot} footage={footage} />
        </Sequence>
      ))}
      <Captions />
      <Music />
    </AbsoluteFill>
  );
};
