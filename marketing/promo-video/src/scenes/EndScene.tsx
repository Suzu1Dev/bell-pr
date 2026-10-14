/** S11: the end card, its logo landing on the measured final hit. */
import { EndCard } from "../components/EndCard.tsx";
import { events, logoLandFrame } from "../music.ts";
import type { Shot } from "../timeline.ts";

/** The beats after the hit that the end card's lines arrive on (70.5, 71.0, 71.5 s). */
const beatFrames = [2115, 2130, 2145] as const;

export const EndScene: React.FC<{ shot: Shot }> = ({ shot }) => (
  <EndCard
    land={logoLandFrame - shot.from}
    beats={beatFrames.map((beat) => beat - shot.from) as [number, number, number]}
  />
);

// The hit the logo lands on must fall inside this shot.
if (events.finalHit < 2090 || events.finalHit > 2259) throw new Error("The final hit is outside the end card.");
