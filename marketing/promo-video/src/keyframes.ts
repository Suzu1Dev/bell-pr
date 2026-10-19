/**
 * The cuts where the WebM gets a keyframe (remotion.config.ts). VP9 places
 * one every 128 frames and codes a cut in between as an inter frame, which
 * flattens the stage plates' static grain wherever the plate first shows on
 * that cut: the gradient then contours (review rounds 3 and 6: flat runs of
 * 400-650 px on the light studio). A keyframe on every cut between the dark
 * stage and the light studio, and on every product take whose first frame
 * shows the studio round the window, keeps the grain. Pure, so the tests
 * can check it.
 */
import { corners } from "./look/camera.ts";
import { FLARE_FRAMES } from "./logo.ts";
import { music } from "./music.ts";
import { looks } from "./shots.ts";
import { takeView } from "./takes.ts";
import { timeline } from "./timeline.ts";

/** Whether the window covers the whole frame in this view (no studio shows). */
const covers = (look: Parameters<typeof takeView>[0]) => {
  const [tl, tr, br, bl] = corners(takeView(look, 0));
  return Math.max(tl.x, bl.x) <= 0 && Math.min(tr.x, br.x) >= 1920 && Math.max(tl.y, tr.y) <= 0 && Math.min(bl.y, br.y) >= 1080;
};

/** Film frames of the cuts that need a keyframe, in order. */
export function keyframeCuts(): number[] {
  // The first hit and every frame of its lights-on flare, to the frame it settles on: VP9 codes the flare's fading
  // wash as a smooth residual over the frame before and loses the plate's grain (review round 7: flat runs of
  // 670 px), so each of those few frames is coded whole.
  const flare = Array.from({ length: FLARE_FRAMES + 1 }, (_, i) => music.events.firstHit + i);
  const frames = new Set<number>([...flare, music.events.finalHit]);
  for (const shot of timeline.shots)
    for (const take of shot.takes) {
      if (take.id === "title") {
        // The climax's bar of display type on the dark stage, and the lights-on cut after it.
        frames.add(take.from);
        frames.add(take.to);
        continue;
      }
      const look = looks[shot.id]?.[take.id];
      if (look && !covers(look)) frames.add(take.from);
    }
  return [...frames].filter((frame) => frame > 0 && frame < timeline.durationInFrames).sort((a, b) => a - b);
}
