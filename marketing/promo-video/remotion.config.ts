/**
 * Remotion settings for the promo render (npx remotion render|still|studio).
 *
 * The renderer uses the local Chrome headless shell named by
 * REMOTION_BROWSER_EXECUTABLE. Without it, Remotion downloads its own
 * headless shell on first use (see README.md).
 */
import { Config } from "@remotion/cli/config";

Config.setEntryPoint("src/index.ts");
Config.setBrowserExecutable(process.env.REMOTION_BROWSER_EXECUTABLE || null);
// UI text is the subject: keep the intermediate frames close to lossless.
Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(95);
Config.setOverwriteOutput(true);
