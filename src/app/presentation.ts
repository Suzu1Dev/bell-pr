/**
 * Presentation and recording mode: query flags in the address that set up
 * a demo, a screen share or the promo-video capture without touching any
 * setting.
 *
 *   demo=play    the sample project plays its scripted timeline
 *   present=1    presenting: the GitHub login reads "you", paths lose
 *                their folders
 *   locale=en    the UI language for this page load (applied in main.tsx,
 *                never saved); zh-TW works too
 *   speed=1..4   how fast the playback runs
 *   cursor=1     a synthetic cursor follows the mouse
 *   capture=1    the capture tooling is recording: `data-capture` is set
 *                on <html>, and the shell's CSS hides scrollbars and the
 *                caret blink for it
 *
 * The flags ride on any route, for example
 * `#/runs/demo-run/activity?demo=play&speed=4&present=1&locale=en`.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { parseLocale, type Locale } from "../../shared/i18n/locale";
import {
  currentRouteHash,
  hashQuery,
  subscribeToRoute,
} from "../navigation/route";

export const minPlaybackSpeed = 1;
export const maxPlaybackSpeed = 4;

export interface PresentationFlags {
  /** `demo=play`: the sample project plays its scripted timeline. */
  play: boolean;
  /** `present=1`: names and paths are masked. */
  present: boolean;
  /** `locale=`: absent when the address names no supported locale. */
  locale?: Locale;
  /** `speed=`, clamped to 1-4; 1 when absent or not a number. */
  speed: number;
  /** `cursor=1`: the synthetic cursor overlay. */
  cursor: boolean;
  /** `capture=1`: the capture tooling is recording. */
  capture: boolean;
}

/** On for `1`, `true` or a bare name (`?present`); off for anything else. */
function isOn(value: string | undefined) {
  return value !== undefined && ["", "1", "true"].includes(value.toLowerCase());
}

/** The presentation flags in a hash such as `#/home?present=1&locale=en`. */
export function parsePresentationFlags(hash: string): PresentationFlags {
  const query = hashQuery(hash);
  const speed = Number(query.speed);
  const locale = parseLocale(query.locale);
  return {
    play: query.demo?.toLowerCase() === "play",
    present: isOn(query.present),
    ...(locale ? { locale } : {}),
    speed:
      query.speed && Number.isFinite(speed)
        ? Math.min(maxPlaybackSpeed, Math.max(minPlaybackSpeed, speed))
        : minPlaybackSpeed,
    cursor: isOn(query.cursor),
    capture: isOn(query.capture),
  };
}

// One flags object per address, so React sees the same snapshot until the
// flags change.
const noFlags = parsePresentationFlags("");
let cachedHash: string | undefined;
let cachedFlags = noFlags;

function flagsNow(): PresentationFlags {
  const hash = currentRouteHash();
  if (hash !== cachedHash) {
    cachedHash = hash;
    cachedFlags = parsePresentationFlags(hash);
  }
  return cachedFlags;
}

/** Whether the address asks for presentation mode (`present=1`) now. */
export function isPresenting(): boolean {
  return flagsNow().present;
}

/** What a masked GitHub login, account or e-mail address reads. */
export const maskedUser = "you";

/**
 * A login or account name to show: "you" while presenting, else the name
 * itself. An empty name stays empty, so the caller's fallback still shows.
 */
export function maskUser(login: string, presenting = isPresenting()): string {
  return presenting && login ? maskedUser : login;
}

const separator = /[\\/]/;

/** `/a/b/` as `/a/b`; the root stays `/`. */
function trimEnd(path: string) {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed || path.slice(0, 1);
}

/** POSIX, home-relative (`~/`) and Windows drive or UNC paths. */
function isAbsolute(path: string) {
  return /^(?:[\\/]|~(?:[\\/]|$)|[A-Za-z]:[\\/])/.test(path);
}

/**
 * A file system path to show. While presenting, a path inside `worktreeRoot`
 * becomes relative to it and any other absolute path becomes `…/` plus its
 * last segment, so no user name or home folder is on screen. Relative paths
 * and every path outside presentation mode are shown as they are.
 */
export function maskPath(
  path: string,
  worktreeRoot?: string,
  presenting = isPresenting(),
): string {
  if (!presenting || !path) return path;
  const full = trimEnd(path);
  const root = worktreeRoot ? trimEnd(worktreeRoot) : "";
  if (
    root &&
    !separator.test(root.slice(-1)) &&
    full.startsWith(root) &&
    separator.test(full.charAt(root.length))
  )
    return full.slice(root.length + 1);
  if (!isAbsolute(full)) return path;
  const name = full.split(separator).pop();
  return name && name !== "~" ? `…/${name}` : "…";
}

/** Sets or removes `data-capture` on <html> for the capture flag. */
export function applyCaptureAttribute(
  flags: Pick<PresentationFlags, "capture">,
  root: Pick<Element, "toggleAttribute"> | undefined = typeof document ===
  "undefined"
    ? undefined
    : document.documentElement,
) {
  root?.toggleAttribute("data-capture", flags.capture);
}

export interface Presentation extends PresentationFlags {
  /** maskUser() for the current flags. */
  maskUser(login: string): string;
  /** maskPath() for the current flags. */
  maskPath(path: string, worktreeRoot?: string): string;
}

/**
 * The presentation flags in the address, with maskUser/maskPath bound to
 * them; renders again when they change. It also keeps `data-capture` on
 * <html> in step with `capture=1`.
 */
export function usePresentation(): Presentation {
  const flags = useSyncExternalStore(subscribeToRoute, flagsNow, () => noFlags);
  useEffect(() => applyCaptureAttribute(flags), [flags]);
  return useMemo(
    () => ({
      ...flags,
      maskUser: (login: string) => maskUser(login, flags.present),
      maskPath: (path: string, worktreeRoot?: string) =>
        maskPath(path, worktreeRoot, flags.present),
    }),
    [flags],
  );
}
