/**
 * Remotion settings for the film (npx remotion render|still|studio).
 *
 * The renderer uses the local Chrome headless shell named by
 * REMOTION_BROWSER_EXECUTABLE; without it, Remotion downloads its own on
 * first use (see README.md). PNG intermediates (lookdev STYLE-GUIDE §0.2:
 * smaller and cleaner than JPEG at the same CRF) and BT.709 tagging.
 */
import { Config } from "@remotion/cli/config";
import analysis from "./music/track.analysis.json";

Config.setEntryPoint("src/index.ts");
Config.setBrowserExecutable(process.env.REMOTION_BROWSER_EXECUTABLE || null);
Config.setVideoImageFormat("png");
Config.setColorSpace("bt709");
Config.setOverwriteOutput(true);

/**
 * VP9 places a keyframe every 128 frames and codes a cut in between as an
 * inter frame: the dark end card then inherited a light-studio keyframe and
 * its dithered gradient came out in contour rings (flat runs of 400 px). A
 * keyframe on each cut between the dark stage and the light studio (the
 * first hit and the final hit) keeps the grain, so the WebM does not band.
 */
// Half a frame early, so the keyframe falls on the cut frame itself (frame rule: floor(t * 30)).
const stageCuts = [analysis.events.firstHit, analysis.events.finalHit].map((seconds) => (Math.floor(seconds * 30 + 1e-6) - 0.5) / 30);
Config.overrideFfmpegCommand(({ type, args }) => {
  if (type !== "stitcher" || !args.includes("libvpx-vp9")) return args;
  const output = args.length - 1;
  return [...args.slice(0, output), "-force_key_frames", stageCuts.map((t) => t.toFixed(4)).join(","), args[output]];
});
