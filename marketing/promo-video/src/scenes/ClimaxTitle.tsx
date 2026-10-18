/**
 * S9's first bar, the climax's signature beat: on the climax crash the film
 * cuts back to the dark stage for one bar, and "Before it ships, explain it
 * back." pulls into focus as display type (K3); on beat 3 "Before it
 * ships," racks soft and dim while "explain it back." stays sharp and turns
 * mint (K5). Then a hard "lights on" cut to the floating window on the next
 * downbeat (which also covers the music edit's join).
 */
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { DARK, StageImage } from "../look/Stage.tsx";
import { FocusLine, ROLES, words } from "../look/type.tsx";
import { music } from "../music.ts";
import { shotById, takeOf } from "../timeline.ts";

const shot = shotById("s9-explain-back");
export const climaxTitle = takeOf(shot, "title");
const cue = shot.captions[0];

export const ClimaxTitle: React.FC = () => {
  const f = useCurrentFrame() + climaxTitle.from;
  const drift = 1 + (0.012 * (f - climaxTitle.from)) / music.barFrames;
  return (
    <AbsoluteFill style={{ backgroundColor: DARK.edge }}>
      <StageImage kind="dark" />
      <AbsoluteFill style={{ alignItems: "center", transform: `scale(${drift.toFixed(5)})`, transformOrigin: "50% 45%" }}>
        <FocusLine
          words={words(cue.text, { 0: "soft", 1: "soft", 2: "soft", 3: "key", 4: "key", 5: "key" })}
          frame={f}
          enter={cue.from}
          rack={{ at: cue.from + 2 * music.beatFrames, dimTo: DARK.secondary, keyTo: DARK.mint, soften: 2, frames: 12 }}
          role={ROLES.displayM}
          color={DARK.text}
          style={{ position: "absolute", top: 452 }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
