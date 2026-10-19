/**
 * The end card's vertical layout (owner's feedback after round 8: `npx
 * bell-pr` on a line of its own), as numbers the card, the tests and the
 * pixel check share: each line placed by its baseline, with the ink each
 * one covers from its font's own metrics (DM Sans and IBM Plex Mono, read
 * from the bundled font files), so src/endCard.test.ts can prove the lines
 * never touch and scripts/check-moments.mjs can find the same rows in the
 * rendered card. Screen px at 1080p, before the card's slow drift (+0.8% a
 * bar about 45% of the height).
 */
import { END_LOGO } from "../logo.ts";
import { ROLES } from "../look/roles.ts";

/** Vertical metrics (em) of the two faces: line box ascent and descent (hhea), and the ink of the glyphs the card sets. */
export const FONT_METRICS = {
  sans: { ascent: 0.992, descent: 0.31, inkTop: 0.72, inkBottom: 0.232 },
  mono: { ascent: 1.025, descent: 0.275, inkTop: 0.74, inkBottom: 0.2 },
} as const;

type Face = keyof typeof FONT_METRICS;

/** A line of type: its face, size and baseline; `lineHeight` in px (the line box the element gets). */
export interface CardLine {
  name: string;
  face: Face;
  size: number;
  baseline: number;
  lineHeight: number;
  /** Set with line-height normal (the face's own ascent and descent, which `lineHeight` then equals), as the reviewed card set it. */
  normal?: boolean;
}

/** The top of a line's box, so that its baseline lands where the layout puts it (CSS: half-leading above the ascent). */
export const lineTop = (line: CardLine) => {
  const m = FONT_METRICS[line.face];
  return line.baseline - (line.lineHeight - (m.ascent + m.descent) * line.size) / 2 - m.ascent * line.size;
};

/** The rows of ink a line covers. */
export const lineInk = (line: CardLine) => {
  const m = FONT_METRICS[line.face];
  return { top: line.baseline - m.inkTop * line.size, bottom: line.baseline + m.inkBottom * line.size };
};

const headline = ROLES.displayL;
/** The headline's two lines, at the tops the reviewed card has them (FocusLine boxes of displayL). */
const HEADLINE_TOPS = [372, 505] as const;
const headlineBaseline = (top: number) => {
  const m = FONT_METRICS.sans;
  const box = headline.size * headline.lineHeight;
  return top + (box - (m.ascent + m.descent) * headline.size) / 2 + m.ascent * headline.size;
};

export const END_CARD = {
  headlineTops: HEADLINE_TOPS,
  /** `npx bell-pr`, alone on its line: the one command a viewer must read (60 px, about 12 px even in a phone-width embed). */
  command: { name: "command", face: "mono", size: 60, baseline: 772, lineHeight: 72 } satisfies CardLine,
  /** "Free to start · Runs on your machine", on its own line under the command: smaller and quieter. */
  facts: { name: "facts", face: "sans", size: 30, baseline: 838, lineHeight: 40 } satisfies CardLine,
  /** The homepage, under the facts, only when shared/product.ts sets one (none today). */
  homepage: { name: "homepage", face: "sans", size: 28, baseline: 884, lineHeight: 36 } satisfies CardLine,
  /** The non-affiliation line at the foot of the frame. */
  footer: { name: "footer", face: "sans", size: 22, baseline: 968 + 0.992 * 22, lineHeight: 0.992 * 22 + 0.31 * 22, normal: true } satisfies CardLine,
  /** The complete card, sharp (the poster's frame), where scripts/check-moments.mjs measures it. */
  checkFrame: 2610,
} as const;

/**
 * The rows of ink on the complete card, top to bottom, with the least clear space each must keep above it: the logo
 * in its slot, the headline's two lines, the command, the facts and the footer. The headline's lines are one block
 * (their descenders and ascenders come within a few px), the command stands apart from it, the facts sit close
 * under the command as its subline, and the footer is set off at the foot.
 */
export function endCardRows(withHomepage = false) {
  const logoHeight = (END_LOGO.slot.width * 64) / 196;
  const logoTop = END_LOGO.slot.cy - logoHeight / 2;
  const unit = logoHeight / 64;
  const lines = [
    { name: "logo", top: logoTop + 3.3 * unit, bottom: logoTop + 60.5 * unit, gapAbove: 0 },
    ...HEADLINE_TOPS.map((top, i) => {
      const baseline = headlineBaseline(top);
      return {
        name: `headline ${i + 1}`,
        top: baseline - FONT_METRICS.sans.inkTop * headline.size,
        bottom: baseline + FONT_METRICS.sans.inkBottom * headline.size,
        gapAbove: i === 0 ? 60 : 0,
      };
    }),
    { name: "command", ...lineInk(END_CARD.command), gapAbove: 64 },
    { name: "facts", ...lineInk(END_CARD.facts), gapAbove: 24 },
    ...(withHomepage ? [{ name: "homepage", ...lineInk(END_CARD.homepage), gapAbove: 12 }] : []),
    { name: "footer", ...lineInk(END_CARD.footer), gapAbove: 80 },
  ];
  return lines;
}
