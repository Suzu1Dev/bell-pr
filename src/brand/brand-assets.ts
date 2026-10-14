/**
 * The BELL PR brand assets: one source for the <Logo/> component, the vector
 * files in public/brand/, the favicon and the web app manifest, which
 * `render-assets.ts` writes from this module. `Logo.test.ts` fails when a
 * committed file no longer matches.
 *
 * The mark is a bell whose clapper is a pull-request merge node: a branch
 * (the curve) merges into the main line, which runs down through the bell
 * to the node. Everything is drawn on a 64-unit grid and filled, with no
 * strokes or masks, so the files scale, recolor and convert cleanly. The
 * merge lines and the node's hole are real cut-outs, not white paint.
 *
 * The wordmark lockup puts the mark before the name. "BELL" is DM Sans
 * Bold (wght 700) and "PR" DM Sans at wght 450, both at opsz 24, converted
 * to outlines: the cap height is 26 units, the baseline sits on the bell's
 * lip (y = 45), "BELL" is tracked -0.02 em, and a 0.25 em space separates
 * the two words. docs/brand.md has the full guidelines.
 */

import { product } from "../../shared/product";

/** Brand colors; each is a token in src/theme/tokens.css. */
export const logoColors = {
  /** --color-brand-600, the brand green. */
  green: "#1f6d50",
  /** --color-text, for "BELL" on light backgrounds. */
  ink: "#24342b",
  /** --color-brand-300, the mark on dark backgrounds. */
  greenOnDark: "#8dbb9f",
  /** --color-text-inverse, for "BELL" on dark backgrounds. */
  inkOnDark: "#ffffff",
  /** --color-brand-200, for "PR" on dark backgrounds. */
  accentOnDark: "#c4dccb",
} as const;

/** The mark on its 64 x 64 grid. */
export const markPath =
  "M32 3.3A3.2 3.2 0 1 1 32 9.7A3.2 3.2 0 1 1 32 3.3ZM32 9C42.5 9 48 16.5 48 26V32C48 36 49.6 38.8 51.6 40H53.5A2.5 2.5 0 0 1 53.5 45H33.6V32.73A4.47 4.47 0 0 1 36.91 28.41A7.67 7.67 0 0 0 42.6 21V17.5A1.6 1.6 0 0 0 39.4 17.5V21A4.47 4.47 0 0 1 36.09 25.32A7.67 7.67 0 0 0 33.6 26.5V17.5A1.6 1.6 0 0 0 30.4 17.5V45H10.5A2.5 2.5 0 0 1 10.5 40H12.4C14.4 38.8 16 36 16 32V26C16 16.5 21.5 9 32 9ZM32 47.5A6.5 6.5 0 1 1 32 60.5A6.5 6.5 0 1 1 32 47.5ZM32 51A3 3 0 1 0 32 57A3 3 0 1 0 32 51Z";

export const markSize = 64;

/**
 * The wordmark lockup: the same 64-unit height as the mark, with the mark
 * moved left so its lip touches x = 0.
 */
export const wordmark = {
  width: 196,
  height: 64,
  markPath:
    "M24 3.3A3.2 3.2 0 1 1 24 9.7A3.2 3.2 0 1 1 24 3.3ZM24 9C34.5 9 40 16.5 40 26V32C40 36 41.6 38.8 43.6 40H45.5A2.5 2.5 0 0 1 45.5 45H25.6V32.73A4.47 4.47 0 0 1 28.91 28.41A7.67 7.67 0 0 0 34.6 21V17.5A1.6 1.6 0 0 0 31.4 17.5V21A4.47 4.47 0 0 1 28.09 25.32A7.67 7.67 0 0 0 25.6 26.5V17.5A1.6 1.6 0 0 0 22.4 17.5V45H2.5A2.5 2.5 0 0 1 2.5 40H4.4C6.4 38.8 8 36 8 32V26C8 16.5 13.5 9 24 9ZM24 47.5A6.5 6.5 0 1 1 24 60.5A6.5 6.5 0 1 1 24 47.5ZM24 51A3 3 0 1 0 24 57A3 3 0 1 0 24 51Z",
  /** "BELL" */
  namePath:
    "M62.49 45V19H73.15Q75.85 19 77.71 19.85Q79.57 20.7 80.52 22.21Q81.48 23.71 81.48 25.7Q81.48 27.66 80.63 29Q79.78 30.33 78.37 31.05Q76.97 31.77 75.32 31.89L75.91 31.48Q77.69 31.54 79.08 32.43Q80.47 33.31 81.27 34.75Q82.07 36.19 82.07 37.91Q82.07 39.98 81.07 41.59Q80.08 43.19 78.17 44.1Q76.26 45 73.51 45ZM67.5 40.92H72.72Q74.75 40.92 75.87 39.98Q76.98 39.04 76.98 37.31Q76.98 35.58 75.83 34.59Q74.67 33.59 72.65 33.59H67.5ZM67.5 29.84H72.34Q74.3 29.84 75.33 28.95Q76.37 28.05 76.37 26.42Q76.37 24.83 75.33 23.92Q74.3 23.02 72.29 23.02H67.5ZM85.33 45V19H102.44V23.04H90.34V29.84H101.32V33.76H90.34V40.96H102.44V45ZM106.13 45V19H111.14V41.1H122.56V45ZM126 45V19H131.02V41.1H142.43V45Z",
  /** "PR" */
  suffixPath:
    "M156.12 45V19H164.86Q167.93 19 169.91 20.01Q171.89 21.03 172.85 22.75Q173.8 24.47 173.8 26.65Q173.8 28.77 172.87 30.5Q171.93 32.22 169.95 33.26Q167.96 34.3 164.86 34.3H159.54V45ZM159.54 31.44H164.75Q167.72 31.44 169.01 30.14Q170.31 28.85 170.31 26.65Q170.31 24.35 169.01 23.09Q167.72 21.83 164.75 21.83H159.54ZM177.81 45V19H186.42Q189.48 19 191.43 20.03Q193.38 21.06 194.32 22.78Q195.26 24.5 195.26 26.67Q195.26 28.75 194.3 30.5Q193.35 32.26 191.37 33.31Q189.39 34.35 186.28 34.35H181.23V45ZM191.52 45 185.85 33.41H189.65L195.51 45ZM181.23 31.72H186.18Q189.04 31.72 190.38 30.32Q191.73 28.92 191.73 26.73Q191.73 24.5 190.42 23.19Q189.11 21.88 186.15 21.88H181.23Z",
} as const;

/** The vector files in public/brand/ plus the favicon. */
export const logoFiles = [
  "brand/logo-mark.svg",
  "brand/logo-mark-mono.svg",
  "brand/logo-wordmark.svg",
  "brand/logo-on-dark.svg",
  "favicon.svg",
] as const;
export type LogoFile = (typeof logoFiles)[number];

function svg(width: number, height: number, body: string[]): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    ...body.map((line) => `  ${line}`),
    "</svg>",
    "",
  ].join("\n");
}

function wordmarkSvg(mark: string, name: string, suffix: string): string {
  return svg(wordmark.width, wordmark.height, [
    `<path fill="${mark}" d="${wordmark.markPath}"/>`,
    `<path fill="${name}" d="${wordmark.namePath}"/>`,
    `<path fill="${suffix}" d="${wordmark.suffixPath}"/>`,
  ]);
}

/** The exact content of a committed logo file. */
export function logoSvg(file: LogoFile): string {
  const c = logoColors;
  switch (file) {
    case "brand/logo-mark.svg":
      return svg(markSize, markSize, [`<path fill="${c.green}" d="${markPath}"/>`]);
    case "brand/logo-mark-mono.svg":
      // One color that follows the surrounding text when inlined; black as
      // an image. Recolor it freely, but keep it to one color.
      return svg(markSize, markSize, [`<path fill="currentColor" d="${markPath}"/>`]);
    case "brand/logo-wordmark.svg":
      return wordmarkSvg(c.green, c.ink, c.green);
    case "brand/logo-on-dark.svg":
      return wordmarkSvg(c.greenOnDark, c.inkOnDark, c.accentOnDark);
    case "favicon.svg":
      // The mark, lightened where the browser chrome is dark.
      return svg(markSize, markSize, [
        `<style>@media (prefers-color-scheme: dark) { path { fill: ${c.greenOnDark}; } }</style>`,
        `<path fill="${c.green}" d="${markPath}"/>`,
      ]);
  }
}

/** The web app manifest; the name comes from shared/product.ts. */
export function manifest(): string {
  const value = {
    name: product.name,
    short_name: product.name,
    start_url: "./",
    scope: "./",
    display: "standalone",
    background_color: "#fafbf9",
    theme_color: logoColors.green,
    icons: [
      { src: "favicon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "brand/logo-mark-512.png", sizes: "512x512", type: "image/png" },
      { src: "apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** The PNG renditions in public/, with their pixel sizes. */
export const pngFiles = {
  "brand/favicon-32.png": [32, 32],
  "brand/logo-mark-512.png": [512, 512],
  "apple-touch-icon.png": [180, 180],
  "og-image.png": [1200, 630],
} as const satisfies Record<string, readonly [number, number]>;

/** Files the landing site serves from site/assets/brand/, copied from public/. */
export const siteBrandFiles = {
  "logo-mark.svg": "brand/logo-mark.svg",
  "logo-wordmark.svg": "brand/logo-wordmark.svg",
  "favicon.svg": "favicon.svg",
  "favicon-32.png": "brand/favicon-32.png",
  "apple-touch-icon.png": "apple-touch-icon.png",
  "og-image.png": "og-image.png",
} as const;
