# BELL PR landing site

A static site with no build step, no third-party requests, no analytics and
no inline script. Every page carries a Content Security Policy that only
allows files from the site itself, so the policy can also be sent as an HTTP
header. Light theme only; the layout works from 390 to 1440 px.

| Path | What it is |
| --- | --- |
| `index.html` | Hero with the `npx bell-pr` command, video, how it works, screenshots, features, Free vs Pro, privacy and trust, FAQ |
| `pricing.html` | Plans, the purchase button, licensing questions, the comparison table |
| `install.html` | Requirements, platforms, npm, sign-in and `bell-pr open`, Docker, next steps |
| `legal/*.html` | The legal documents, generated from `LICENSE.md`, `PRIVACY.md`, `TERMS.md`, `REFUND.md` and `SECURITY.md` |
| `site.css`, `site.js` | Styles, and the copy buttons (the pages work without the script) |
| `assets/brand/` | Logo, favicons and the social preview image, copied from `public/` |
| `assets/fonts/` | Self-hosted DM Sans and IBM Plex Mono (SIL Open Font License 1.1, licenses included) |
| `assets/screenshots/` | Screens of the sample project, copied from `docs/images/en/`; the landing page shows four of them |
| `media/` | The promo video, gitignored; see [Media](#media) |
| `README.md`, `check-site.mjs`, `build-legal.mjs` | This file, the site checks and the legal page builder; they are not part of the site |

## Working on the site

- **Generated regions.** The Free/Pro table and every link to a product URL
  or e-mail address are generated from `shared/plans.ts`,
  `shared/i18n/plans.en.ts` and `shared/product.ts`. Never edit the text
  between `<!-- generated:… -->` and `<!-- /generated:… -->` by hand. After
  changing one of those sources, run
  `npx tsx scripts/render-generated-regions.ts --write`; CI runs `--check`.
  The script finds tracked files with regions by itself, so a new page only
  needs the markers.
- **Legal pages.** `legal/*.html` are generated: edit the Markdown document
  in the repository root, then run `node site/build-legal.mjs`, and
  `npx tsx scripts/render-generated-regions.ts --write` if a region changed.
  The builder keeps the DRAFT banners, the owner placeholder lists and every
  `[OWNER: …]` placeholder visible, drops HTML comments such as the claim
  markers, and keeps what the region script wrote into the head and footer.
  `node site/build-legal.mjs --check` also checks every claim marker against
  `LEGAL-REVIEW.md` and each document's owner placeholder list;
  `--self-test` tests the builder.
- **Screenshots.** `assets/screenshots/` holds byte-identical copies of
  images in `docs/images/en/`. After the documentation images are
  captured again, copy them again, for example
  `cp docs/images/en/run-changes-1440.png site/assets/screenshots/`; the
  site check fails while a copy differs.
- **Brand files.** `assets/brand/` and `assets/fonts/` are written by
  `npx tsx src/brand/render-assets.ts`; `src/brand/Logo.test.ts` fails when
  the brand copies drift from `public/`. See `docs/brand.md`.
- **Checks.** `node site/check-site.mjs` checks links, resources, the
  no-inline-script rule, the video sources, the screenshot copies, the
  5 MB size budget (without `media/`), and runs `build-legal.mjs --check`.
  `node site/check-site.mjs --browser --port <port> --without-media` also
  loads every page in Chromium at 1440 and 390 px: no horizontal scroll, no
  text cut off or out of its box, no request outside the local server, no
  console error, the fonts load, every image decodes, and the video keeps a
  16:9 box without its files. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to use
  an installed Chromium build; `--screenshots <dir>` saves full-page
  screenshots for review.
- **Preview.** Any static file server works, for example
  `python3 -m http.server --bind 127.0.0.1 <port> --directory site`.

## Open items

### Owner decisions ([OWNER])

Each one is marked on the page, as a visible `[OWNER: …]` placeholder or as
an HTML comment.

1. **Tagline: decided.** The owner chose the headline on 2026-10-15, so the
   hero heading of `index.html` no longer carries an HTML comment. The v1.1
   lines, with where each one is used:
   - **"From vibe coding to knowing why."** (zh-TW: 從「憑感覺寫」到「知道為什麼」。)
     The headline: the hero heading, the READMEs' tagline, the app's Home
     and the npm description, and the promo's end card once the video is
     cut again. Chosen by the owner.
   - "Ship only what you can explain." (只送出你講得清楚的程式碼。) Introduces
     the Explain-it-back feature (the features grid), never as the
     headline.
   - "Let AI do the legwork. Keep the understanding." (讓 AI 跑腿，理解留給自己。)
     The "How it works" heading.
   - "Train your taste on real code." (在真實的程式碼裡，練出品味。) The
     second pillar; not on the site yet.
   - "Be the PR a maintainer is glad to open." (成為維護者樂意打開的那個 PR。)
     The third pillar and the heading of `docs/contributing-responsibly.md`.
2. **Pro price** (`pricing.html`, `[OWNER: price]`).
3. **Billing period, currency and taxes** (`pricing.html`).
4. **License key delivery**, instant from a key pool or by hand within N
   business days (`pricing.html`, licensing questions; `REFUND.md`).
5. **Refund window** (`pricing.html`, licensing questions; `REFUND.md`).
6. **Docker image name** (`install.html`, the `IMAGE` placeholder).
7. **Legal documents** (`legal/*.html`, generated from the Markdown): the
   placeholders each document lists at its top, and counsel's review. Each
   page keeps its DRAFT banner until the owner confirms that review; the
   claims behind the texts are mapped in `LEGAL-REVIEW.md`.
8. **Seller name in the footer**: there is no copyright line until the
   legal entity is decided.
9. **Domain and hosting**: set `homepageUrl` in `shared/product.ts`; the
   absolute Open Graph URL and image tags then appear (see below). The npm
   package's README then links to this site too, but only to what it
   serves: the legal documents become links to `legal/*.html`, and an
   image or file becomes a link only when `site/` holds a byte-identical
   copy of it (`scripts/npm-readme.mjs`). Every other screenshot stays the
   text "Screenshot: …" and every other link its text, so to show the
   README's screenshots on npmjs.com, copy those files from `docs/images/en/`
   into `site/assets/screenshots/`.

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
| `homepageUrl` | `<head>` of every page | `og:url` and an absolute `og:image` (social networks need absolute URLs) |

While all four footer contact links are empty, the footer hides the whole
"Contact" column. Every page also names the social preview image with a
relative `og:image`, after the generated one, for services that resolve it
against the page's address.

## Media

`media/` is gitignored. The promo video work (7C,
`marketing/promo-video/scripts/copy-to-site.mjs`) renders these files into
it, and **the owner deploys them together with the site**; they are never
committed. Without them the video keeps its 16:9 box and shows only the
player controls.

- `media/bell-pr-promo.webm`: the video (VP9 and Opus), gitignored.
- `media/bell-pr-promo.mp4`: the video (H.264 and AAC), gitignored.
- `media/poster.jpg`: the still shown before playback, gitignored.
- `media/captions.en.vtt`: the captions, gitignored. The captions are also
  burned into the picture, so the text track is offered but not shown by
  default.

## Hosting

The owner hosts the site (for example Cloudflare Pages or GitHub Pages) and
never needs a build step: deploy `site/` as it is, plus `media/`, but
without `README.md`, `check-site.mjs` and `build-legal.mjs`. Recommended
HTTP headers:

```text
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; media-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```
