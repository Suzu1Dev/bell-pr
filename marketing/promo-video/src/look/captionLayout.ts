/**
 * Where a caption card sits and how big it is (pure, no fonts or CSS, so the
 * layout tests can use it): src/look/Captions.tsx draws the card from the
 * same numbers, with the real text measured in the page.
 */
import type { Caption } from "../timeline.ts";

/**
 * The caption role of the type scale: a step above Supporting (lookdev STYLE-GUIDE §3.2), so the line still reads
 * at about 11-12 px in a phone-width embed of the 1080p film (review round 6).
 */
export const CAPTION_ROLE = { size: 56, weight: 560, tracking: -0.012, lineHeight: 1.18 } as const;

export const CARD_MARGIN = { x: 96, y: 80 } as const;
export const CARD_PAD = { x: 38, top: 26, bottom: 28 } as const;
export const CARD_LINE = CAPTION_ROLE.size * CAPTION_ROLE.lineHeight;

/**
 * A generous estimate of a caption line's width (DM Sans 560 at 56 px, about
 * 0.53 em a character, rounded up) for the layout tests, where no font is
 * loaded; the film measures the real text.
 */
export const estimateWidth = (line: string) => line.length * CAPTION_ROLE.size * 0.53;

/** The card's box for a cue: its corner of the frame and its size (src/look.test.ts checks it against the sharp plane). */
export function cardBox(cue: Pick<Caption, "lines" | "place">, measure: (line: string) => number = estimateWidth) {
  const width = Math.ceil(Math.max(...cue.lines.map(measure)) + 2 * CARD_PAD.x);
  const height = Math.ceil(cue.lines.length * CARD_LINE + CARD_PAD.top + CARD_PAD.bottom);
  return { ...cardPlace(cue.place, width, height), width, height };
}

/** The top-left corner of a card of this size at its place. */
export function cardPlace(place: Caption["place"], width: number, height: number) {
  const left = place.endsWith("right") ? 1920 - CARD_MARGIN.x - width : place === "bottom" ? (1920 - width) / 2 : CARD_MARGIN.x;
  const top = place.startsWith("top") ? CARD_MARGIN.y : 1080 - CARD_MARGIN.y - height;
  return { left, top };
}
