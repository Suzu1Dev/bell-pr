import { product } from "../../shared/product";
import { logoColors, markPath, markSize, wordmark } from "./brand-assets";

export type LogoVariant = "mark" | "wordmark";

export interface LogoProps {
  /** The bell mark alone, or the mark followed by the name. */
  variant: LogoVariant;
  /** Height in CSS pixels; the wordmark's width follows from it. */
  size: number;
  /**
   * The accessible name; the product name by default. Pass "" when visible
   * text next to the logo already names the product, which hides the logo
   * from assistive technology.
   */
  title?: string;
  className?: string;
}

/** Rounds to 2 decimals so the markup stays short. */
const px = (value: number) => Math.round(value * 100) / 100;

/** The BELL PR logo as inline SVG, drawn from the same paths as public/brand/. */
export function Logo({ variant, size, title, className }: LogoProps) {
  const label = title ?? product.name;
  const a11y = label
    ? { role: "img", "aria-label": label }
    : { "aria-hidden": true as const };
  if (variant === "wordmark")
    return (
      <svg
        className={className}
        width={px((size * wordmark.width) / wordmark.height)}
        height={size}
        viewBox={`0 0 ${wordmark.width} ${wordmark.height}`}
        {...a11y}
      >
        <path fill={logoColors.green} d={wordmark.markPath} />
        <path fill={logoColors.ink} d={wordmark.namePath} />
        <path fill={logoColors.green} d={wordmark.suffixPath} />
      </svg>
    );
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${markSize} ${markSize}`}
      {...a11y}
    >
      <path fill={logoColors.green} d={markPath} />
    </svg>
  );
}
