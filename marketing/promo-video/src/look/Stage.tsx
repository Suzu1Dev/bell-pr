/** The two stages (lookdev STYLE-GUIDE §6) as pre-dithered plates (scripts/make-stage.mjs). */
import type { CSSProperties } from "react";
import { Img, staticFile } from "remotion";

export const DARK = {
  edge: "#020403",
  text: "#f4f7f3",
  secondary: "#a9bcb1",
  muted: "#7d9387",
  dim: "#56695d",
  mint: "#b9dcc6",
  brand300: "#8dbb9f",
  brand500: "#3f8a69",
} as const;

export const LIGHT = {
  mid: "#f6f7f4",
  ink: "#111a15",
  inkSecondary: "#46564b",
  inkDim: "#6b7a70",
  brand: "#1f6d50",
  brandDeep: "#175a40",
} as const;

/** True when rendering with --scale=2 (the 4K master): pick the 2x raster assets. */
export const hiDpi = () => typeof window !== "undefined" && window.devicePixelRatio > 1;

export const StageImage: React.FC<{ kind: "dark" | "light"; style?: CSSProperties }> = ({ kind, style }) => (
  <Img
    src={staticFile(`stage/${kind}${hiDpi() ? "@2x" : ""}.png`)}
    style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, display: "block", ...style }}
  />
);
