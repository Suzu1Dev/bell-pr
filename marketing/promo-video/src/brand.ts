/**
 * The product's brand for the cards and captions: its design tokens
 * (src/theme/tokens.css, as CSS variables) and its fonts, bundled from
 * @fontsource so the render makes no font request. Rendering waits until
 * the fonts are ready.
 */
import "../../../src/theme/tokens.css";
import "@fontsource-variable/dm-sans/wght.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import { continueRender, delayRender } from "remotion";

export const fonts = {
  sans: '"DM Sans Variable", "DM Sans", system-ui, sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, monospace',
} as const;

/** A design token, such as color("brand-600"), from src/theme/tokens.css. */
export const color = (name: string) => `var(--color-${name})`;

/** The SVG logos that scripts/capture.mjs copies from public/brand/. */
export const logos = {
  mark: "brand-assets/logo-mark.svg",
  wordmark: "brand-assets/logo-wordmark.svg",
  onDark: "brand-assets/logo-on-dark.svg",
} as const;

const waiting = delayRender("Loading the brand fonts");
Promise.all([
  document.fonts.load(`500 48px ${fonts.sans}`),
  document.fonts.load(`700 48px ${fonts.sans}`),
  document.fonts.load(`400 32px ${fonts.mono}`),
  document.fonts.load(`500 32px ${fonts.mono}`),
])
  .then(() => continueRender(waiting))
  .catch((error: Error) => {
    throw new Error(`The brand fonts did not load: ${error.message}`);
  });
