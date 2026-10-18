/**
 * Remotion settings for the film (npx remotion render|still|studio).
 *
 * The renderer uses the local Chrome headless shell named by
 * REMOTION_BROWSER_EXECUTABLE; without it, Remotion downloads its own on
 * first use (see README.md). PNG intermediates (lookdev STYLE-GUIDE §0.2:
 * smaller and cleaner than JPEG at the same CRF) and BT.709 tagging.
 */
import { Config } from "@remotion/cli/config";

Config.setEntryPoint("src/index.ts");
Config.setBrowserExecutable(process.env.REMOTION_BROWSER_EXECUTABLE || null);
Config.setVideoImageFormat("png");
Config.setColorSpace("bt709");
Config.setOverwriteOutput(true);
