/**
 * S1: the problem. The home page, blurred and slowly pushed in, behind the
 * two opening title cards (the title cues of S1 in timeline.json).
 */
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Footage } from "../components/Footage.tsx";
import { TitleCard } from "../components/TitleCard.tsx";
import { footageFile } from "../footage.ts";
import { cameraAt } from "../lib/camera.ts";
import { timeline, type Shot } from "../timeline.ts";

export const ProblemScene: React.FC<{ shot: Shot }> = ({ shot }) => {
  const frame = useCurrentFrame();
  const duration = shot.to - shot.from;
  const camera = cameraAt(shot.camera ?? [{ f: 0, x: 720, y: 405, zoom: 1 }], frame);
  const blur = interpolate(frame, [0, duration], [9, 6]);
  const cues = timeline.captions.filter(
    (cue) => cue.style === "title" && cue.from >= shot.from && cue.to <= shot.to,
  );
  return (
    <AbsoluteFill style={{ backgroundColor: "var(--color-bg)" }}>
      <Footage
        src={footageFile(shot.id, "home.png")}
        camera={camera}
        imageStyle={{ filter: `blur(${blur}px) saturate(0.9)` }}
      />
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(1100px 620px at 50% 50%, rgb(250 251 249 / 84%) 0%, rgb(250 251 249 / 62%) 60%, rgb(238 246 240 / 70%) 100%)",
        }}
      />
      {cues.map((cue) => (
        <TitleCard key={cue.from} from={cue.from - shot.from} to={cue.to - shot.from}>
          {cue.text}
        </TitleCard>
      ))}
    </AbsoluteFill>
  );
};
