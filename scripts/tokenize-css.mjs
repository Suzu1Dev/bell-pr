#!/usr/bin/env node
// Moves the stylesheets onto the design tokens in src/theme/tokens.css and
// checks that they stay there (zero dependencies).
//
//   node scripts/tokenize-css.mjs                  dry run: report what --write would change
//   node scripts/tokenize-css.mjs --write          rewrite every src/**/*.css outside src/theme/
//   node scripts/tokenize-css.mjs --check          exit 1 when a stylesheet outside src/theme/
//                                                  has a color literal, a font size below 11px,
//                                                  a hard-coded font stack or a webfont CDN link
//   node scripts/tokenize-css.mjs --check-contrast WCAG contrast of every text token on every
//                                                  background token (informative; add --json)
//
// The rewrite:
// - maps each color literal (hex, rgb(), `white`, `black`) to the nearest token by
//   CIEDE2000 distance in CIELAB, choosing only among the tokens meant for
//   the declaring property (see `pools`). Text colors therefore always land on
//   a text token, and every text token meets 4.5:1 on the light backgrounds;
//   a light grey stays grey (see `greyChroma`). A non-text color farther than
//   `maxDeltaE` from every candidate stays as it is and is reported as
//   unmapped;
// - replaces translucent shadows with --shadow-1/2/3 by blur radius, and
//   translucent fills with --color-overlay or a color-mix() of a token;
// - folds component-level custom properties that hold a color or a font
//   stack (the old --green, --mission-ink, --review-border, ...) into the
//   theme token they match, deletes their definitions and rewrites their uses;
// - replaces font stacks with var(--font-sans) or var(--font-mono), font
//   sizes below 11px with var(--text-2xs), and sizes on the type scale with
//   their token.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const tokensPath = "src/theme/tokens.css";

/**
 * Fill and line colors farther than this (CIEDE2000) from every candidate
 * stay as they are and are reported. Text and control colors always map
 * (see `greyChroma` for grey text that has no close match).
 */
export const maxDeltaE = 12;
/** Text at least this light (CIELAB L*) sits on a dark fill. */
const inverseTextLightness = 81;
/**
 * Text below this chroma (CIELAB C*) is grey. A light sage grey that has to
 * darken to 4.5:1 is about as far from --color-accent-600 as from
 * --color-text-muted, so when no text token is within `maxDeltaE` and the
 * nearest one is an accent, it maps to a neutral text token (`pools.grey`):
 * muted text stays grey instead of turning olive.
 */
const greyChroma = 20;

// Candidate tokens per kind of property, without the --color- prefix.
// Order breaks ties between tokens that share a value.
export const pools = {
  text: [
    "text",
    "text-secondary",
    "text-muted",
    "brand-700",
    "brand-600",
    "accent-700",
    "accent-600",
    "warning",
    "danger",
    "info",
    "violet",
  ],
  inverse: ["text-inverse", "text-inverse-muted"],
  grey: ["text", "text-secondary", "text-muted"],
  surface: [
    "surface",
    "bg",
    "surface-sunken",
    "surface-muted",
    "surface-inverse",
    "brand-50",
    "brand-100",
    "brand-200",
    "brand-300",
    "brand-500",
    "brand-600",
    "brand-700",
    "accent-50",
    "accent-100",
    "accent-200",
    "accent-300",
    "accent-500",
    "warning-bg",
    "warning-500",
    "danger-bg",
    "danger",
    "info-bg",
    "info",
    "violet-bg",
    "diff-add-bg",
    "diff-del-bg",
    "diff-selected",
  ],
  border: [
    "border-subtle",
    "border",
    "border-strong",
    "brand-200",
    "brand-300",
    "brand-500",
    "brand-600",
    "brand-700",
    "accent-200",
    "accent-300",
    "accent-500",
    "accent-700",
    "warning-border",
    "warning-500",
    "danger-border",
    "danger",
    "info-border",
    "violet-border",
  ],
  control: ["brand-600"],
};
// Rings drawn with box-shadow and scrollbar colors are fills or lines.
pools.decoration = [...new Set([...pools.surface, ...pools.border])];

// Deliberate exceptions to the nearest-color rule. `selector` is tested
// against the innermost selector of the rule (whitespace collapsed).
export const overrides = [
  // Code tokens and diff signs keep their own semantic tokens.
  { selector: /\.rv-token-keyword$/, property: "color", token: "syntax-keyword" },
  { selector: /\.rv-token-string$/, property: "color", token: "syntax-string" },
  { selector: /\.rv-token-number$/, property: "color", token: "syntax-number" },
  { selector: /\.rv-token-comment$/, property: "color", token: "syntax-comment" },
  { selector: /^\.rv-line-added$/, property: "background", token: "diff-add-bg" },
  { selector: /^\.rv-line-removed$/, property: "background", token: "diff-del-bg" },
  { selector: /^\.rv-line-selected(:hover)?$/, property: "background", token: "diff-selected" },
  { selector: /\.rv-line-added .rv-sign$/, property: "color", token: "diff-add-fg" },
  { selector: /\.rv-line-removed .rv-sign$/, property: "color", token: "diff-del-fg" },
  { selector: /(^|[ .])(rv-)?additions$/, property: "color", token: "diff-add-fg" },
  { selector: /(^|[ .])(rv-)?deletions$/, property: "color", token: "diff-del-fg" },
  // Line numbers stay neutral on added and removed lines.
  { selector: /^\.rv-line-(added|removed) \.rv-gutter$/, property: "color", token: "text-muted" },
  // Status dots and meters.
  { selector: /^\.mission-confidence-medium > span$/, property: "background", token: "warning-500" },
  { selector: /^\.mission-confidence-low > span$/, property: "background", token: "border-strong" },
  { selector: /\.command-palette-status-failed .command-palette-run-detail i$/, property: "background", token: "danger" },
  { selector: /^\.language-dot$/, property: "background", token: "info" },
  // The chevrons between workflow steps are decoration, not text.
  { selector: /^\.step-chevron$/, property: "color", token: "border-strong" },
  // Toasts are dark fills: neutral, or red for errors.
  { selector: /^\.toast$/, property: "background", token: "surface-inverse" },
  { selector: /^\.toast$/, property: "border", token: "accent-700" },
  { selector: /^\.toast-error$/, property: "background", token: "danger" },
  { selector: /^\.toast-error$/, property: "border-color", token: "danger" },
  // Markdown files keep a grey badge next to the blue badge of code files.
  { selector: /^\.file-type\.markdown$/, property: "color", token: "text-muted" },
  { selector: /^\.file-type\.markdown$/, property: "background", token: "surface-sunken" },
  { selector: /^\.file-type\.markdown$/, property: "border", token: "border" },
  // What is typed in a field stays darker than its placeholder
  // (--color-text-muted), so a filled field never looks empty.
  { selector: /^\.file-search input$/, property: "color", token: "text" },
  { selector: /^\.text-input$/, property: "color", token: "text" },
  { selector: /^\.draft-textarea$/, property: "color", token: "text" },
  { selector: /^\.mission-form-field > (input|select|textarea)$/, property: "color", token: "text" },
  { selector: /^\.team-message-form textarea$/, property: "color", token: "text" },
  { selector: /^\.team-plan-revise textarea$/, property: "color", token: "text" },
  { selector: /^\.explain-note-input$/, property: "color", token: "text" },
  { selector: /^\.explain-panel \.explain-input-box textarea$/, property: "color", token: "text" },
  // Text selection has its own token.
  { selector: /^::selection$/, property: "background", token: "selection" },
];

// ---------------------------------------------------------------- colors

/** `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` to channels (a in 0..1). */
export function parseHex(hex) {
  let digits = hex.replace(/^#/, "").toLowerCase();
  if (!/^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(digits))
    return undefined;
  if (digits.length <= 4)
    digits = [...digits].map((digit) => digit + digit).join("");
  const channel = (index) => parseInt(digits.slice(index, index + 2), 16);
  return {
    r: channel(0),
    g: channel(2),
    b: channel(4),
    a: digits.length === 8 ? channel(6) / 255 : 1,
  };
}

function linear(value) {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2 relative luminance. */
export function luminance({ r, g, b }) {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG 2 contrast ratio of two opaque colors. */
export function contrastRatio(first, second) {
  const [light, dark] = [luminance(first), luminance(second)].sort(
    (x, y) => y - x,
  );
  return (light + 0.05) / (dark + 0.05);
}

/** sRGB to CIELAB (D65 white). */
export function toLab({ r, g, b }) {
  const [R, G, B] = [linear(r), linear(g), linear(b)];
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const f = (t) =>
    t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116;
  return { L: 116 * f(y) - 16, a: 500 * (f(x) - f(y)), b: 200 * (f(y) - f(z)) };
}

/** CIEDE2000 color difference of two CIELAB colors. */
export function deltaE2000(first, second) {
  const rad = Math.PI / 180;
  const pow7 = (value) => value ** 7;
  const cBar = (Math.hypot(first.a, first.b) + Math.hypot(second.a, second.b)) / 2;
  const g = 0.5 * (1 - Math.sqrt(pow7(cBar) / (pow7(cBar) + pow7(25))));
  const a1 = (1 + g) * first.a;
  const a2 = (1 + g) * second.a;
  const c1 = Math.hypot(a1, first.b);
  const c2 = Math.hypot(a2, second.b);
  const hue = (b, a) => {
    if (a === 0 && b === 0) return 0;
    const degrees = Math.atan2(b, a) / rad;
    return degrees < 0 ? degrees + 360 : degrees;
  };
  const h1 = hue(first.b, a1);
  const h2 = hue(second.b, a2);
  const chromatic = c1 * c2 !== 0;

  let dh = 0;
  if (chromatic) {
    dh = h2 - h1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dL = second.L - first.L;
  const dC = c2 - c1;
  const dH = 2 * Math.sqrt(c1 * c2) * Math.sin((dh / 2) * rad);

  const lBar = (first.L + second.L) / 2;
  const cBarPrime = (c1 + c2) / 2;
  let hBar = h1 + h2;
  if (chromatic) {
    if (Math.abs(h1 - h2) > 180) hBar += hBar < 360 ? 360 : -360;
    hBar /= 2;
  }
  const t =
    1 -
    0.17 * Math.cos((hBar - 30) * rad) +
    0.24 * Math.cos(2 * hBar * rad) +
    0.32 * Math.cos((3 * hBar + 6) * rad) -
    0.2 * Math.cos((4 * hBar - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hBar - 275) / 25) ** 2));
  const rC = 2 * Math.sqrt(pow7(cBarPrime) / (pow7(cBarPrime) + pow7(25)));
  const sL = 1 + (0.015 * (lBar - 50) ** 2) / Math.sqrt(20 + (lBar - 50) ** 2);
  const sC = 1 + 0.045 * cBarPrime;
  const sH = 1 + 0.015 * cBarPrime * t;
  const rT = -Math.sin(2 * dTheta * rad) * rC;
  return Math.sqrt(
    (dL / sL) ** 2 +
      (dC / sC) ** 2 +
      (dH / sH) ** 2 +
      rT * (dC / sC) * (dH / sH),
  );
}

// ---------------------------------------------------------------- tokens

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    comment.replace(/[^\n]/g, " "),
  );
}

/**
 * The custom properties of the `:root` blocks in tokens.css, with aliases
 * (`var(--other)`) resolved. Opaque hex values also get `rgb` and `lab`.
 */
export function parseTokens(css) {
  const raw = new Map();
  for (const block of stripComments(css).matchAll(/:root\s*\{([^}]*)\}/g))
    for (const [, name, value] of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g))
      raw.set(name, value.trim().replace(/\s+/g, " "));
  const resolve = (name, seen = new Set()) => {
    if (seen.has(name)) throw new Error(`Token alias cycle at ${name}.`);
    seen.add(name);
    const value = raw.get(name);
    const alias = value && /^var\((--[\w-]+)\)$/.exec(value);
    return alias ? resolve(alias[1], seen) : value;
  };
  const tokens = new Map();
  for (const name of raw.keys()) {
    const value = resolve(name);
    if (value === undefined)
      throw new Error(`Token ${name} refers to an undefined token.`);
    const rgb = parseHex(value);
    tokens.set(name, {
      name,
      value,
      rgb: rgb && rgb.a === 1 ? rgb : undefined,
      lab: rgb && rgb.a === 1 ? toLab(rgb) : undefined,
    });
  }
  return tokens;
}

export function loadTokens(file = path.join(root, tokensPath)) {
  const tokens = parseTokens(readFileSync(file, "utf8"));
  for (const pool of Object.values(pools))
    for (const name of pool)
      if (!tokens.get(`--color-${name}`)?.lab)
        throw new Error(`Pool token --color-${name} is not an opaque color.`);
  for (const { token } of overrides)
    if (!tokens.has(`--color-${token}`))
      throw new Error(`Override token --color-${token} is not defined.`);
  return tokens;
}

/** The nearest token of `pool` to an opaque color, with its distance. */
export function nearestToken(rgb, pool, tokens) {
  const lab = toLab(rgb);
  let best;
  for (const name of pool) {
    const token = tokens.get(`--color-${name}`);
    const distance = deltaE2000(lab, token.lab);
    if (!best || distance < best.distance - 1e-9)
      best = { name: token.name, distance };
  }
  return best;
}

// ------------------------------------------------------------------- css

/**
 * Splits a stylesheet into declarations. Each has `property`, `value`, the
 * offsets of the value in `css`, the innermost `selector`, and the offsets
 * of the whole declaration. Comments, strings and parentheses are skipped.
 */
export function declarations(css) {
  const text = stripComments(css);
  const found = [];
  const selectors = [];
  let start = 0;
  let depth = 0;
  let quote;
  const finish = (end, terminator) => {
    const segment = text.slice(start, end);
    if (terminator === "{") {
      selectors.push(segment.trim().replace(/\s+/g, " "));
      return;
    }
    const colon = segment.indexOf(":");
    const trimmed = segment.trim();
    if (colon > 0 && trimmed && !trimmed.startsWith("@")) {
      const name = segment.slice(0, colon).trim();
      // Custom property names are case-sensitive; other properties are not.
      const property = name.startsWith("--") ? name : name.toLowerCase();
      const valueOffset = start + colon + 1;
      const rawValue = text.slice(valueOffset, end);
      const leading = rawValue.length - rawValue.trimStart().length;
      const value = rawValue.trim();
      if (value && /^-?-?[a-z][\w-]*$/i.test(property))
        found.push({
          property,
          value,
          afterColon: valueOffset,
          valueStart: valueOffset + leading,
          valueEnd: valueOffset + leading + value.length,
          start: start + (segment.length - segment.trimStart().length),
          end: terminator === ";" ? end + 1 : end,
          selector: selectors.at(-1) ?? "",
        });
    }
    if (terminator === "}") selectors.pop();
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quote) {
      if (char === "\\") index++;
      else if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "(") depth++;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && (char === ";" || char === "{" || char === "}")) {
      finish(index, char);
      start = index + 1;
    }
  }
  return found;
}

/** The entries of a selector list (overrides use plain selectors). */
function selectorList(selector) {
  return selector.split(/\s*,\s*/);
}

function overrideFor(selector, property, tokens) {
  const kind = property.replace(/-(color|top|right|bottom|left)$/, "");
  for (const rule of overrides) {
    if (rule.property !== property && rule.property !== kind) continue;
    if (selectorList(selector).every((entry) => rule.selector.test(entry)))
      return tokens.get(`--color-${rule.token}`).name;
  }
  return undefined;
}

function poolFor(property) {
  if (["color", "caret-color", "-webkit-text-fill-color"].includes(property))
    return "text";
  if (property.startsWith("background")) return "surface";
  if (/^(border|outline|column-rule|text-decoration)/.test(property))
    return "border";
  if (property === "box-shadow" || property === "text-shadow") return "shadow";
  if (property === "accent-color") return "control";
  if (property === "scrollbar-color") return "decoration";
  return undefined;
}

const colorLiteral =
  /#[0-9a-fA-F]{3,8}\b|\brgba?\([^()]*\)|(?<![\w-])(?:white|black)(?![\w-])/gi;

/** `rgb(r g b / a)` or `rgba(r, g, b, a)` with numbers or percentages. */
export function parseRgbFunction(literal) {
  const match = /^rgba?\(([^()]*)\)$/i.exec(literal.trim());
  if (!match) return undefined;
  const parts = match[1].trim().split(/\s*[,/]\s*|\s+/);
  if (parts.length < 3 || parts.length > 4) return undefined;
  const number = (part, scale) =>
    part.endsWith("%") ? (parseFloat(part) / 100) * scale : parseFloat(part);
  const [r, g, b] = parts.slice(0, 3).map((part) => number(part, 255));
  const a = parts[3] === undefined ? 1 : number(parts[3], 1);
  if ([r, g, b, a].some((value) => !Number.isFinite(value))) return undefined;
  return { r: Math.round(r), g: Math.round(g), b: Math.round(b), a };
}

function literalRgb(literal) {
  const lower = literal.toLowerCase();
  if (lower === "white") return { r: 255, g: 255, b: 255, a: 1 };
  if (lower === "black") return { r: 0, g: 0, b: 0, a: 1 };
  return lower.startsWith("rgb") ? parseRgbFunction(lower) : parseHex(lower);
}

/** The largest blur radius in a shadow list, in px. */
function largestBlur(value) {
  let largest = 0;
  for (const shadow of splitTopLevel(value)) {
    const lengths = shadow
      .replace(/#[0-9a-f]+|rgba?\([^)]*\)|var\([^)]*\)/gi, " ")
      .split(/\s+/)
      .filter((part) => /^-?\d*\.?\d+(px)?$/.test(part))
      .map((part) => parseFloat(part));
    largest = Math.max(largest, lengths[2] ?? 0);
  }
  return largest;
}

function splitTopLevel(value) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index++) {
    if (value[index] === "(") depth++;
    else if (value[index] === ")") depth--;
    else if (value[index] === "," && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts.map((part) => part.trim());
}

export function shadowToken(value) {
  const blur = largestBlur(value);
  return blur <= 3 ? "--shadow-1" : blur <= 20 ? "--shadow-2" : "--shadow-3";
}

const typeScale = new Map([
  [11, "--text-2xs"],
  [12, "--text-xs"],
  [13, "--text-sm"],
  [14, "--text-md"],
  [16, "--text-lg"],
  [20, "--text-xl"],
  [28, "--text-2xl"],
  [36, "--text-3xl"],
]);

/** The type-scale token for a px size: below 11px rounds up to 11px. */
export function sizeToken(px) {
  if (px < 11) return "var(--text-2xs)";
  const token = typeScale.get(px);
  return token ? `var(${token})` : undefined;
}

/** var(--font-mono) or var(--font-sans) for a hard-coded font stack. */
export function fontStackToken(stack) {
  if (/var\(--font-/.test(stack) || /^(inherit|initial|unset)$/.test(stack))
    return undefined;
  if (/\bmonospace\b|\bMono\b|Consolas|Menlo/i.test(stack))
    return "var(--font-mono)";
  if (/sans-serif|DM Sans|Noto Sans/i.test(stack)) return "var(--font-sans)";
  return undefined;
}

/** A component custom property holding a color or a font stack. */
function legacyTarget(name, value, tokens) {
  const font = fontStackToken(value);
  if (font) return { token: font.slice(4, -1), distance: 0 };
  const rgb = parseHex(value);
  if (!rgb || rgb.a !== 1) return undefined;
  const pool = /ink|text|muted|secondary/.test(name)
    ? "text"
    : /border/.test(name)
      ? "border"
      : "surface";
  const best = nearestToken(rgb, pools[pool], tokens);
  return { token: best.name, distance: best.distance };
}

/**
 * Finds the component custom properties (`--green: #1f6d50;`) across all
 * stylesheets, so their uses can be rewritten in any file.
 */
export function findLegacyProperties(sources, tokens) {
  const legacy = new Map();
  for (const { css } of sources)
    for (const declaration of declarations(css)) {
      if (!declaration.property.startsWith("--")) continue;
      const target = legacyTarget(
        declaration.property,
        declaration.value,
        tokens,
      );
      if (target) legacy.set(declaration.property, target);
    }
  return legacy;
}

/** Rewrites uses of component custom properties, with or without a fallback. */
function rewriteLegacyUses(value, legacy, notes) {
  return value.replace(
    /var\((--[\w-]+)(?:\s*,[^()]*(?:\([^()]*\)[^()]*)*)?\)/g,
    (match, name) => {
      const target = legacy.get(name);
      if (!target) return match;
      notes.push({ kind: "legacy", from: match, to: `var(${target.token})` });
      return `var(${target.token})`;
    },
  );
}

/** Font stacks and sizes in font-family, font-size and the font shorthand. */
function rewriteFonts(property, value, notes) {
  if (property === "font-family") {
    const stack = value.replace(/\s*!important$/, "");
    const token = fontStackToken(stack);
    if (!token) return value;
    notes.push({ kind: "font", from: stack, to: token });
    return value.replace(stack, token);
  }
  if (property === "font-size") {
    const size = /^(\d+(?:\.\d+)?)px(\s*!important)?$/.exec(value);
    const token = size && sizeToken(parseFloat(size[1]));
    if (!token) return value;
    notes.push({ kind: "size", from: `${size[1]}px`, to: token });
    return token + (size[2] ?? "");
  }
  if (property !== "font") return value;
  // [style/weight ...] size[/line-height] family
  const shorthand =
    /^((?:[\w-]+\s+)*?)(\d+(?:\.\d+)?px|var\(--text-[\w-]+\))((?:\s*\/\s*[\w.%-]+)?\s+)([\s\S]+)$/.exec(
      value,
    );
  if (!shorthand) return value;
  const [, prefix, matchedSize, middle, matchedStack] = shorthand;
  let size = matchedSize;
  let stack = matchedStack;
  const px = /^(\d+(?:\.\d+)?)px$/.exec(size);
  const sizeReplacement = px && sizeToken(parseFloat(px[1]));
  if (sizeReplacement) {
    notes.push({ kind: "size", from: size, to: sizeReplacement });
    size = sizeReplacement;
  }
  const stackReplacement = fontStackToken(stack.trim());
  if (stackReplacement) {
    notes.push({ kind: "font", from: stack.trim(), to: stackReplacement });
    stack = stackReplacement;
  }
  return prefix + size + middle + stack;
}

/** The token for one opaque color of a declaration, or an override. */
function colorToken(rgb, pool, declaration, tokens) {
  const override = overrideFor(declaration.selector, declaration.property, tokens);
  if (override) return { name: override, distance: 0, override: true };
  if (pool !== "text") return nearestToken(rgb, pools[pool], tokens);
  const lab = toLab(rgb);
  if (lab.L >= inverseTextLightness)
    return nearestToken(rgb, pools.inverse, tokens);
  const best = nearestToken(rgb, pools.text, tokens);
  const lightGrey =
    Math.hypot(lab.a, lab.b) < greyChroma && best.distance > maxDeltaE;
  return lightGrey && best.name.startsWith("--color-accent-")
    ? nearestToken(rgb, pools.grey, tokens)
    : best;
}

/**
 * Color literals of one declaration value. Translucent shadows become a
 * --shadow- token; other translucent colors become --color-overlay (dark)
 * or a color-mix() of the nearest token.
 */
function rewriteColors(declaration, value, tokens, notes, unmapped) {
  const property = declaration.property;
  const literals = [...value.matchAll(colorLiteral)].map(([literal]) => literal);
  const pool = poolFor(property);
  if (!literals.length) return value;
  const report = (literal, reason) => unmapped.push({ ...declaration.at, selector: declaration.selector, property, literal, reason });
  if (pool === "shadow" && literals.some((literal) => literalRgb(literal)?.a < 1)) {
    const token = `var(${shadowToken(value)})`;
    notes.push({ kind: "shadow", from: value, to: token });
    return token;
  }
  const colorPool = pool === "shadow" ? "decoration" : pool;
  return value.replace(colorLiteral, (literal) => {
    const rgb = literalRgb(literal);
    if (!rgb) {
      report(literal, "not a color");
      return literal;
    }
    if (!colorPool) {
      report(literal, "the property has no token pool");
      return literal;
    }
    if (rgb.a < 1) {
      const opaque = { ...rgb, a: 1 };
      if (toLab(opaque).L < 30) {
        notes.push({ kind: "color", from: literal, to: "var(--color-overlay)" });
        return "var(--color-overlay)";
      }
      const best = colorToken(opaque, colorPool, declaration, tokens);
      const mixed = `color-mix(in srgb, var(${best.name}) ${Math.round(rgb.a * 100)}%, transparent)`;
      notes.push({ kind: "color", from: literal, to: mixed, distance: best.distance });
      return mixed;
    }
    const best = colorToken(rgb, colorPool, declaration, tokens);
    const alwaysMaps = colorPool === "text" || colorPool === "control";
    if (!alwaysMaps && !best.override && best.distance > maxDeltaE) {
      report(literal, `nearest is ${best.name} at ΔE ${best.distance.toFixed(1)}`);
      return literal;
    }
    notes.push({ kind: "color", from: literal, to: `var(${best.name})`, distance: best.distance });
    return `var(${best.name})`;
  });
}

/**
 * Rewrites one stylesheet. Returns the new text, the changes and the
 * literals left unmapped, for the report.
 */
export function tokenizeCss(css, tokens, legacy = new Map(), file = "") {
  const edits = [];
  const changes = [];
  const unmapped = [];
  const line = (offset) => css.slice(0, offset).split("\n").length;

  for (const declaration of declarations(css)) {
    const { property, value, valueStart, selector } = declaration;
    const at = { file, line: line(valueStart) };

    // A component custom property: drop its definition line.
    if (legacy.has(property)) {
      let start = css.lastIndexOf("\n", declaration.start) + 1;
      let end = declaration.end;
      if (css.slice(start, declaration.start).trim()) start = declaration.start;
      else if (css[end] === "\n") end++;
      edits.push({ start, end, text: "" });
      changes.push({ ...at, selector, kind: "legacy", from: `${property}: ${value}`, to: `var(${legacy.get(property).token})` });
      continue;
    }

    const notes = [];
    let next = rewriteLegacyUses(value, legacy, notes);
    next = rewriteFonts(property, next, notes);
    next = rewriteColors({ ...declaration, at }, next, tokens, notes, unmapped);
    if (next === value) continue;
    for (const note of notes) changes.push({ ...at, selector, property, ...note });
    // A value that was wrapped onto its own lines and now fits on one line
    // moves up next to the property.
    const wrapped = css.slice(declaration.afterColon, valueStart).includes("\n");
    edits.push(
      wrapped && !next.includes("\n")
        ? { start: declaration.afterColon, end: declaration.valueEnd, text: ` ${next}` }
        : { start: valueStart, end: declaration.valueEnd, text: next },
    );
  }

  let output = css;
  for (const edit of edits.sort((x, y) => y.start - x.start))
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  return { output, changes, unmapped };
}

// ---------------------------------------------------------------- checks

/**
 * Problems that must not come back once the stylesheets use tokens: color
 * literals, font sizes below 11px, hard-coded font stacks and webfont CDNs.
 */
export function checkCss(css, file = "") {
  const problems = [];
  const text = stripComments(css);
  const line = (offset) => text.slice(0, offset).split("\n").length;
  if (/fonts\.(googleapis|gstatic)\.com/.test(text))
    problems.push({ file, line: 1, problem: "loads a webfont from a CDN" });
  for (const declaration of declarations(css)) {
    const { property, value, valueStart } = declaration;
    const at = { file, line: line(valueStart) };
    for (const [literal] of value.matchAll(colorLiteral))
      problems.push({ ...at, problem: `color literal ${literal} (use a --color- token)` });
    for (const [literal] of value.matchAll(/\b(?:hsla?|hwb|lab|lch|oklab|oklch)\(/gi))
      problems.push({ ...at, problem: `color function ${literal}...) (use a --color- token)` });
    const sizes =
      property === "font-size"
        ? [value]
        : property === "font"
          ? [/(?:^|\s)(\d*\.?\d+px)(?=\s*\/|\s)/.exec(value)?.[1] ?? ""]
          : [];
    for (const size of sizes) {
      const px = /^(\d*\.?\d+)px/.exec(size);
      if (px && parseFloat(px[1]) < 11)
        problems.push({ ...at, problem: `font size ${px[0]} is below 11px (use var(--text-2xs))` });
    }
    if (property === "font-family" || property === "font") {
      if (/["']|\b(sans-serif|monospace|serif)\b/.test(value.replace(/var\([^)]*\)/g, "")))
        problems.push({ ...at, problem: `hard-coded font stack (use var(--font-sans) or var(--font-mono))` });
    }
    if (property.startsWith("--") && fontStackToken(value) !== undefined)
      problems.push({ ...at, problem: `component font token ${property}` });
  }
  return problems;
}

/** Text tokens on background tokens, for --check-contrast. */
export const contrastPairs = {
  text: [
    "text",
    "text-secondary",
    "text-muted",
    "brand-700",
    "brand-600",
    "accent-700",
    "accent-600",
    "success",
    "warning",
    "danger",
    "info",
    "violet",
    "diff-add-fg",
    "diff-del-fg",
    "syntax-keyword",
    "syntax-string",
    "syntax-number",
    "syntax-comment",
  ],
  backgrounds: [
    "surface",
    "bg",
    "surface-sunken",
    "surface-muted",
    "brand-50",
    "brand-100",
    "accent-50",
    "accent-100",
    "success-bg",
    "warning-bg",
    "danger-bg",
    "info-bg",
    "violet-bg",
    "diff-add-bg",
    "diff-del-bg",
    "diff-selected",
  ],
  inverseText: ["text-inverse", "text-inverse-muted"],
  inverseBackgrounds: ["surface-inverse", "brand-700", "brand-600", "danger"],
};

export function contrastReport(tokens) {
  const pairs = [];
  const add = (foregrounds, backgrounds) => {
    for (const fg of foregrounds)
      for (const bg of backgrounds) {
        const a = tokens.get(`--color-${fg}`);
        const b = tokens.get(`--color-${bg}`);
        if (!a?.rgb || !b?.rgb)
          throw new Error(`--color-${!a?.rgb ? fg : bg} is not an opaque color.`);
        pairs.push({ fg, bg, ratio: contrastRatio(a.rgb, b.rgb) });
      }
  };
  add(contrastPairs.text, contrastPairs.backgrounds);
  add(contrastPairs.inverseText, contrastPairs.inverseBackgrounds);
  return pairs;
}

// ------------------------------------------------------------------ main

function stylesheets() {
  return readdirSync(path.join(root, "src"), { recursive: true })
    .map((entry) => path.join("src", String(entry)).split(path.sep).join("/"))
    .filter((file) => file.endsWith(".css") && !file.startsWith("src/theme/"))
    .sort();
}

function printContrast(tokens, json) {
  const pairs = contrastReport(tokens);
  if (json) {
    const rounded = pairs.map((pair) => ({ ...pair, ratio: Number(pair.ratio.toFixed(2)) }));
    console.log(JSON.stringify(rounded, null, 2));
    return;
  }
  const ratio = (fg, bg) => pairs.find((pair) => pair.fg === fg && pair.bg === bg).ratio;
  const format = (value) => `${value < 4.5 ? "!" : ""}${value.toFixed(2)}`;
  const { text, backgrounds, inverseText, inverseBackgrounds } = contrastPairs;
  console.log(`WCAG 2 contrast of each --color- text token on the ${backgrounds.length} light background tokens`);
  console.log("(full matrix: --check-contrast --json; ! marks a pair below 4.5:1)\n");
  console.log(`${"text token".padEnd(20)}${"surface".padStart(8)}${"bg".padStart(8)}   lowest`);
  for (const fg of text) {
    const lowest = backgrounds
      .map((bg) => ({ bg, value: ratio(fg, bg) }))
      .sort((x, y) => x.value - y.value)[0];
    console.log(
      `${fg.padEnd(20)}${format(ratio(fg, "surface")).padStart(8)}${format(ratio(fg, "bg")).padStart(8)}   ${format(lowest.value)} on ${lowest.bg}`,
    );
  }
  console.log("\nOn dark fills:");
  for (const fg of inverseText)
    console.log(`${fg.padEnd(20)}${inverseBackgrounds.map((bg) => `${bg} ${format(ratio(fg, bg))}`).join(", ")}`);
  const failing = pairs.filter((pair) => pair.ratio < 4.5).length;
  console.log(`\n${pairs.length} pairs, ${failing} below 4.5:1.`);
}

function main(args) {
  const tokens = loadTokens();
  if (args.includes("--check-contrast")) {
    printContrast(tokens, args.includes("--json"));
    return 0;
  }
  const files = stylesheets();
  const sources = files.map((file) => ({ file, css: readFileSync(path.join(root, file), "utf8") }));

  if (args.includes("--check")) {
    const problems = sources.flatMap(({ file, css }) => checkCss(css, file));
    for (const { file, line, problem } of problems) console.log(`${file}:${line}: ${problem}`);
    console.log(problems.length ? `\n${problems.length} problem(s). Run node scripts/tokenize-css.mjs to see the rewrite.` : `${files.length} stylesheets use the design tokens.`);
    return problems.length ? 1 : 0;
  }

  const write = args.includes("--write");
  const legacy = findLegacyProperties(sources, tokens);
  const allChanges = [];
  const allUnmapped = [];
  for (const { file, css } of sources) {
    const { output, changes, unmapped } = tokenizeCss(css, tokens, legacy, file);
    allChanges.push(...changes);
    allUnmapped.push(...unmapped);
    if (write && output !== css) writeFileSync(path.join(root, file), output);
  }

  const count = (kind) => allChanges.filter((change) => change.kind === kind).length;
  console.log(`${write ? "Rewrote" : "Would rewrite"} ${files.length} stylesheets:`);
  console.log(`  ${count("color")} colors, ${count("shadow")} shadows, ${count("size")} font sizes, ${count("font")} font stacks, ${count("legacy")} component custom properties`);
  for (const [name, target] of legacy)
    console.log(`  ${name} -> ${target.token}${target.distance ? ` (ΔE ${target.distance.toFixed(1)})` : ""}`);

  const usage = new Map();
  for (const change of allChanges.filter((item) => item.kind === "color"))
    usage.set(change.to, (usage.get(change.to) ?? 0) + 1);
  console.log("\nToken use:");
  for (const [token, uses] of [...usage].sort((x, y) => y[1] - x[1]))
    console.log(`  ${String(uses).padStart(4)}  ${token}`);

  const shifts = allChanges
    .filter((change) => change.kind === "color" && change.distance > 8)
    .sort((x, y) => y.distance - x.distance);
  console.log(`\nLargest color shifts (ΔE > 8; text moves on purpose to meet 4.5:1): ${shifts.length}`);
  for (const change of shifts.slice(0, args.includes("--verbose") ? Infinity : 25))
    console.log(`  ΔE ${change.distance.toFixed(1).padStart(4)}  ${change.from} -> ${change.to}  ${change.property}  ${change.file}:${change.line} ${change.selector}`);

  console.log(`\nUnmapped: ${allUnmapped.length}`);
  for (const item of allUnmapped)
    console.log(`  ${item.file}:${item.line} ${item.selector} { ${item.property}: ${item.literal} } ${item.reason}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
  }
}
