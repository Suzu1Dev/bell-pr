/** The roles of the type scale (lookdev STYLE-GUIDE §3), pure so layout code and tests can use them without fonts. */
import { CAPTION_ROLE } from "./captionLayout.ts";

export interface TypeRole {
  size: number;
  weight: number;
  tracking: number;
  lineHeight: number;
}

export const ROLES = {
  displayL: { size: 128, weight: 600, tracking: -0.02, lineHeight: 1.04 },
  displayM: { size: 88, weight: 600, tracking: -0.018, lineHeight: 1.08 },
  title: { size: 64, weight: 560, tracking: -0.015, lineHeight: 1.12 },
  supporting: { size: 52, weight: 500, tracking: -0.012, lineHeight: 1.15 },
  caption: CAPTION_ROLE,
  label: { size: 28, weight: 600, tracking: 0, lineHeight: 1.2 },
  legal: { size: 22, weight: 450, tracking: 0.005, lineHeight: 1.35 },
} satisfies Record<string, TypeRole>;
