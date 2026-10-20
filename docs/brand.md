# BELL PR brand guidelines

How to use the BELL PR name, logo, colors and type, and how to name the
tools BELL PR works with. The BELL PR name, logo and brand files are not
under the Apache-2.0 license that covers the source code.
[TRADEMARKS.md](../TRADEMARKS.md) is the trademark policy: it says what you
may do without asking, when you need permission and what to change in a
fork. This page describes the assets and how to use them.

## Name

- Write the product name as **BELL PR**: capitals, one space. Not "Bell
  PR", "BellPR" or "BELL-PR". The npm package and the commands are
  `bell-pr` and `bellpr`; write those only as code.
- Never translate the name. In Traditional Chinese text it stays "BELL PR".
- The name and the public links live only in `shared/product.ts`. Code,
  docs and the site read them from there, which keeps a rename cheap: the
  name, the brand files and `site/`.

## Logo

The mark is a bell whose clapper is a pull-request merge node: a branch
merges into the main line, which runs down through the bell to the node.
The wordmark lockup sets the name after the mark.

| File | Use |
| --- | --- |
| `public/brand/logo-mark.svg` | The mark in brand green, on light backgrounds |
| `public/brand/logo-wordmark.svg` | Mark and name, on light backgrounds. The default logo |
| `public/brand/logo-on-dark.svg` | Mark and name for dark backgrounds (`#24342b` or darker) |
| `public/brand/logo-mark-mono.svg` | The mark in one color (`currentColor`): embossing, stamps, a white mark on brand green |
| `public/favicon.svg` | The mark; it lightens to `#8dbb9f` when the browser chrome is dark |
| `public/brand/favicon-32.png` | 32 px favicon for browsers without SVG icons |
| `public/brand/logo-mark-512.png` | 512 px mark with a transparent background (app manifest, press) |
| `public/apple-touch-icon.png` | 180 px, the white mark on an opaque brand-green tile (iOS fills transparency with black) |
| `public/og-image.png` | 1200 x 630 social preview |
| `public/manifest.webmanifest` | Web app manifest; the name comes from `shared/product.ts` |

In the app, use the `<Logo variant="mark" | "wordmark" size={height} />`
component from `src/brand/Logo.tsx` instead of an `<img>`. It draws the
same paths inline, names itself after the product (`aria-label`), and takes
`title=""` when visible text next to it already names the product.

### Construction

- Everything sits on a 64-unit grid. The mark's box is 64 x 64; the
  wordmark is 196 x 64, so a mark and a wordmark at the same `size` show
  the bell at the same size.
- The merge lines are 3.2 units wide with round ends; the node is a ring
  with an outer radius of 6.5 and an inner radius of 3.
- "BELL" is DM Sans Bold (wght 700) and "PR" DM Sans at wght 450, both at
  the opsz 24 optical size, converted to outlines. The cap height is 26
  units, the baseline sits on the bell's lip (y = 45), "BELL" is tracked
  -0.02 em, and a 0.25 em space separates the words. The mark's lip starts
  at x = 0 and the name 12 units after the mark.
- The artwork is filled shapes only, with no strokes, masks or text, so it
  scales and converts cleanly. The merge lines and the node's hole are cut
  out, so the background shows through.

### Clear space

Keep at least **a quarter of the logo's height** free on every side of the
logo's box (16 units of the 64-unit grid). No text, edge or other graphic
inside that space.

### Minimum sizes

| Logo | Screen | Print |
| --- | --- | --- |
| Mark | 16 px (favicons only); 24 px elsewhere | 6 mm high |
| Wordmark | 24 px high | 8 mm high |

Below 24 px, use the mark alone: the merge lines close up, but the bell
still reads.

### Do

- Use the files as they are, scaled proportionally.
- Use the color logo on white or the light page colors (`#fafbf9`,
  `#f4f6f1`, `#eef6f0`), and `logo-on-dark.svg` on `#24342b` or darker.
- On brand green, use the mono mark in white.
- Keep the lockup together: the mark always comes before the name.

### Don't

- Recolor parts of the logo, or use colors outside this page.
- Set the name in another typeface, retype it, or change the weights.
- Stretch, skew, rotate, outline, shadow or add a gradient to the logo.
- Put the color logo on photos, patterns or mid-tone backgrounds (the green
  mark on `#24342b` has only 2.1:1 contrast).
- Rearrange the lockup, or put the name above or below the mark.
- Combine the logo with another company's logo, or use the bell as an icon
  for anything other than BELL PR.

## Colors

Every brand color is a design token in `src/theme/tokens.css`; the site
repeats the same values in `site/site.css`.

| Role | Token | Hex | Notes |
| --- | --- | --- | --- |
| Brand green | `--color-brand-600` | `#1f6d50` | The mark, primary buttons, links. 6.25:1 on white |
| Deep green | `--color-brand-700` | `#175a40` | Hover and link text |
| Ink | `--color-text` | `#24342b` | "BELL", body text, dark backgrounds. 13.1:1 on white |
| Light green | `--color-brand-300` | `#8dbb9f` | The mark on dark backgrounds. 6.1:1 on `#24342b` |
| Pale green | `--color-brand-200` | `#c4dccb` | "PR" on dark backgrounds. 9.0:1 on `#24342b` |
| Tint | `--color-brand-100`, `--color-brand-50` | `#e0eee4`, `#eef6f0` | Large decorative marks and soft backgrounds |
| Page | `--color-bg` | `#fafbf9` | Light page background |
| White | `--color-text-inverse` | `#ffffff` | "BELL" on dark backgrounds, the mark on brand green |

The mid tones (`-500`, `-300`, `-200`) are for fills, borders and logos,
never for body text on light backgrounds.

## Type

- **DM Sans** (variable weight) for the interface, headings and the
  wordmark. Headings use 650-750 with slightly tight tracking (-0.02 em).
- **IBM Plex Mono** for commands and code, such as `npx bell-pr`.
- Both are under the SIL Open Font License 1.1 and are self-hosted; nothing
  is loaded from a font service. Traditional Chinese uses the system CJK
  fonts.

## Naming the tools BELL PR works with

BELL PR is independent. Copy, the site and the docs follow these
rules:

- **Plain text only.** Name other products in words, never with their
  logos, icons, mascots or brand colors.
- **Descriptive wording.** Say "works with", "uses" or "for": "Works with
  the OpenAI Codex CLI or Claude Code you installed and signed in to."
- **Use the owners' spelling:** GitHub, GitHub CLI, OpenAI, Codex CLI,
  Anthropic, Claude, Claude Code. Not "Github" or "ClaudeCode".
- **Never** "official", "partner", "certified", "approved", "endorsed",
  "integration partner", or "powered by <brand>", in words or as a badge or
  logo. Never imply that GitHub, OpenAI or Anthropic made, sponsor or
  support BELL PR.
- **Never** put another company's mark in a product name, a feature name, a
  domain, an app icon or the BELL PR logo.
- **Claude Code wording** stays neutral: "Uses the Claude Code CLI you
  installed and signed in to (Claude plan or Anthropic API key). Usage
  counts against your own account." Never write "subscription, not API
  billing" or "no API billing".
- **Non-affiliation notice.** Every page of the site carries it:

  > BELL PR is an independent product and is not affiliated with, endorsed
  > by, or sponsored by GitHub, Inc., OpenAI, or Anthropic PBC. GitHub,
  > OpenAI, Codex, Anthropic, Claude and Claude Code are trademarks of their
  > respective owners; BELL PR names them only to say which tools it works
  > with.

## Changing the brand files

1. The geometry, colors and file contents live in
   `src/brand/brand-assets.ts`.
2. Run `npx tsx src/brand/render-assets.ts`. It writes the SVG files, the
   favicon and the manifest, renders the PNGs with Playwright's Chromium
   (set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to use an installed build), and
   copies the files the site uses into `site/assets/`. `--svg` skips the
   PNGs.
3. Run `npm test`: `src/brand/Logo.test.ts` fails when a committed file,
   the site copies or the manifest no longer match.

To change the wordmark, outline the new text in any vector editor (or with
fontTools' instancer and SVG path pen at the settings above) and paste the
paths into `brand-assets.ts`.
