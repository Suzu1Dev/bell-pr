/**
 * The version and build date of this BELL PR build.
 *
 * scripts/build-server.mjs replaces the two constants below with esbuild
 * defines when it bundles build/cli.mjs. Run from source (tsx, tests), they
 * are not defined, and the values come from ../package.json instead: the
 * version, and `bellpr.releaseDate` or else today's date (UTC).
 */
import { readFileSync } from "node:fs";

declare const __BELLPR_VERSION__: string;
declare const __BELLPR_BUILD_DATE__: string;

interface PackageMeta {
  version: string;
  bellpr?: { releaseDate?: string };
}

/** True in the bundled build/cli.mjs; false when run from source. */
export const bundled = typeof __BELLPR_VERSION__ === "string";

const meta: PackageMeta | undefined = bundled
  ? undefined
  : JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

/** The app version, such as 1.0.0-beta.0. */
export const version: string = bundled ? __BELLPR_VERSION__ : meta!.version;

/** The release or build day, YYYY-MM-DD. */
export const buildDate: string = bundled
  ? __BELLPR_BUILD_DATE__
  : (meta!.bellpr?.releaseDate ?? new Date().toISOString().slice(0, 10));
