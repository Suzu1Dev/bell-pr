# BELL PR landing site

A static site with no build step, no third-party requests, no analytics and
no inline script. Every page carries a Content Security Policy that only
allows files from the site itself, so the policy can also be sent as an HTTP
header. Light theme only; the layout works from 390 to 1440 px.

| Path | What it is |
| --- | --- |
| `index.html` | Hero with the `npx bell-pr` command, video, how it works, features, Free vs Pro, privacy and trust, FAQ |
| `pricing.html` | Plans, the purchase button, the comparison table, licensing questions |
| `install.html` | Requirements, platforms, npm, Docker, Windows through WSL2 |
| `legal/*.html` | Placeholders for the legal documents (7B generates them) |
| `site.css`, `site.js` | Styles, and the copy buttons (the pages work without the script) |
| `assets/brand/` | Logo, favicons and the social preview image, copied from `public/` |
| `assets/fonts/` | Self-hosted DM Sans and IBM Plex Mono (SIL Open Font License 1.1, licenses included) |
| `media/` | The promo video, gitignored; see [Media](#media) |
| `README.md`, `check-site.mjs` | This file and the site checks; they are not part of the site |

## Working on the site

- **Generated regions.** The Free/Pro table and every link to a product URL
  or e-mail address are generated from `shared/plans.ts`,
  `shared/i18n/plans.en.ts` and `shared/product.ts`. Never edit the text
  between `<!-- generated:… -->` and `<!-- /generated:… -->` by hand. After
  changing one of those sources, run
  `npx tsx scripts/render-generated-regions.ts --write`; CI runs `--check`.
  The script finds tracked files with regions by itself, so a new page only
  needs the markers.
- **Brand files.** `assets/brand/` and `assets/fonts/` are written by
  `npx tsx src/brand/render-assets.ts`; `src/brand/Logo.test.ts` fails when
  the brand copies drift from `public/`. See `docs/brand.md`.
- **Checks.** `node site/check-site.mjs` checks links, resources and the
  no-inline-script rule. `node site/check-site.mjs --browser --port <port>
  --without-media` also loads every page in Chromium at 1440 and 390 px:
  no horizontal scroll, no request outside the local server, no console
  error, the fonts load, and the video keeps a 16:9 box without its files.
  Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to use an installed Chromium build;
  `--screenshots <dir>` saves full-page screenshots for review.
- **Preview.** Any static file server works, for example
  `python3 -m http.server --bind 127.0.0.1 <port> --directory site`.

## Open items

### Owner decisions ([OWNER])

Each one is marked on the page, as a visible `[OWNER: …]` placeholder or as
an HTML comment.

1. **Tagline** (`index.html`, the hero heading; an HTML comment marks it).
   The page uses candidate 1 until the owner chooses:
   1. "Contribute to open source with an AI team, and understand every line
      you ship."
   2. "Your AI contribution team. Your review. Your pull request."
   3. "From unfamiliar repo to reviewed Draft PR, on your own machine."
   4. "Learn the codebase while the agents do the legwork."
   5. "Local-first AI pair-contributing: no BELL cloud, no telemetry, you
      approve every change."
2. **Pro price** (`pricing.html`, `[OWNER: price]`).
3. **Billing period, currency and taxes** (`pricing.html`).
4. **License key delivery**, instant from a key pool or by hand within N
   business days (`pricing.html`, licensing questions).
5. **Refund window** (`pricing.html`, licensing questions).
6. **Docker image name** (`install.html`, the `IMAGE` placeholder).
7. **Legal pages** (`legal/eula.html`, `legal/privacy.html`,
   `legal/terms.html`, `legal/refund.html`, `legal/security.html`): each is
   a visible `[OWNER]` placeholder until the documents pass review.
8. **Seller name in the footer**: there is no copyright line until the
   legal entity is decided.
9. **Domain and hosting**: set `homepageUrl` in `shared/product.ts`; the
   Open Graph URL and image tags then appear (see below).

### Work for later waves (TODO)

- 7B: generate `legal/*.html` from the final Markdown documents, add the
  screenshots to `assets/`, and finish the copy. Docker is labelled "beta"
  on `install.html` with the security options from `docs/docker.md` (3A);
  keep the two in step.
- 7C: render the video files into `media/` (below).

## Hidden while a product value is empty

These elements are generated regions. They render nothing at all while the
value in `shared/product.ts` is `""`, and appear after the owner sets it and
someone runs `render-generated-regions.ts --write`.

| Value | Where | What appears |
| --- | --- | --- |
| `purchaseUrl` | `pricing.html`, Pro plan | The "Buy Pro" button. Until then the page says "Purchasing opens soon."; the note hides itself once the button exists |
| `supportEmail` | Footer of every page | "Support" (mailto) |
| `securityEmail` | Footer of every page | "Report a vulnerability" (mailto) |
| `publicRepoUrl` | Footer of every page | "Report an issue" (`<publicRepoUrl>/issues`) |
| `docsUrl` | Footer of every page | "Documentation" |
| `homepageUrl` | `<head>` of `index.html`, `pricing.html`, `install.html` | `og:url` and `og:image` (absolute URLs, which social networks need) |

While all four footer contact links are empty, the footer hides the whole
"Contact" column.

## Media

`media/` is gitignored and filled by the promo video work (7C,
`marketing/promo-video/scripts/copy-to-site.mjs`). The owner deploys these
files together with the site. Until they exist, the video keeps its 16:9 box
and shows only the player controls.

- `media/bell-pr-promo.webm` (TODO, 7C)
- `media/bell-pr-promo.mp4` (TODO, 7C)
- `media/poster.jpg` (TODO, 7C)
- `media/captions.en.vtt` (TODO, 7C). The captions are also burned into
  the picture, so the text track is offered but not shown by default.

## Hosting

The owner hosts the site (for example Cloudflare Pages or GitHub Pages) and
never needs a build step: deploy `site/` as it is, plus `media/`, but
without `README.md` and `check-site.mjs`. Recommended HTTP headers:

```text
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; media-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```
