# BELL PR landing site

The project's public web page: what BELL PR is, how it works, screenshots,
what it does with your data, and how to install it. BELL PR is free,
open-source software under the Apache License 2.0 and the site says so.

It is a static site with no build step, no third-party requests, no
analytics and no inline script. Every page carries a Content Security Policy
that only allows files from the site itself, so the policy can also be sent
as an HTTP header. Light theme only; the layout works from 390 to 1440 px.

| Path | What it is |
| --- | --- |
| `index.html` | Hero with the `npx bell-pr` command, 90-second demo video, how it works, screenshots, features, the open-source license, privacy and trust, FAQ |
| `install.html` | Requirements, platforms, npm, the address and `bell-pr open`, Docker, next steps |
| `zh-tw/index.html`, `zh-tw/install.html` | Traditional Chinese (Taiwan) counterparts of the homepage and install guide |
| `site.css`, `site.js` | Styles, and the copy buttons (the pages work without the script) |
| `assets/brand/` | Logo, favicons and the social preview image, copied from `public/` |
| `assets/fonts/` | Self-hosted DM Sans and IBM Plex Mono (SIL Open Font License 1.1, licenses included) |
| `assets/screenshots/` | Screens of the sample project, copied from `docs/images/en/`; the landing page shows four of them |
| `assets/video/` | Promo poster and English captions; the `.webm`/`.mp4` binaries are deploy-only (see that folder's README) and served in production at https://bell-pr.suzu.tw/assets/video/ |
| `README.md`, `check-site.mjs` | This file and the site checks; they are not part of the site |

## Working on the site

- **Generated regions.** Every link to a product URL or e-mail address, and
  the absolute Open Graph tags, are generated from `shared/product.ts`.
  Never edit the text between `<!-- generated:… -->` and
  `<!-- /generated:… -->` by hand. After changing a value there, run
  `npx tsx scripts/render-generated-regions.ts --write`; CI runs `--check`.
  The script finds tracked files with regions by itself, so a new page only
  needs the markers. Only the keys `homepageUrl`, `docsUrl`, `publicRepoUrl`,
  `supportEmail` and `securityEmail` exist.
- **Screenshots.** `assets/screenshots/` holds byte-identical copies of
  images in `docs/images/en/`. After the documentation images are
  captured again, copy them again, for example
  `cp docs/images/en/run-changes-1440.png site/assets/screenshots/`; the
  site check fails while a copy differs.
- **Brand files.** `assets/brand/` and `assets/fonts/` are written by
  `npx tsx src/brand/render-assets.ts`; `src/brand/Logo.test.ts` fails when
  the brand copies drift from `public/`. See `docs/brand.md`.
- **Checks.** `node site/check-site.mjs` checks links, resources, the
  no-inline-script rule, the screenshot copies and the 5 MB size budget.
  Missing `.mp4`/`.webm` under `assets/video/` are allowed (deploy-only) and
  those extensions do not count toward the size budget.
  `node site/check-site.mjs --browser --port <port>` also loads every page in
  Chromium at 1440 and 390 px: no horizontal scroll, no text cut off or out
  of its box, no request outside the local server, no failed request, no
  console error, the fonts load and every image decodes. Set
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to use an installed Chromium build;
  `--screenshots <dir>` saves full-page screenshots for review.
- **Preview.** Any static file server works, for example
  `python3 -m http.server --bind 127.0.0.1 <port> --directory site`.
- **The npm package's README.** `scripts/npm-readme.mjs` links an image or
  file from the package's README to this site only when `site/` holds a
  byte-identical copy of it, such as the files in `assets/screenshots/`.
  Every other screenshot stays the text "Screenshot: …" and every other
  link its text. To show a README screenshot on npmjs.com, copy it from
  `docs/images/en/` into `site/assets/screenshots/`.

## Hidden while a product value is empty

These elements are generated regions. They render nothing at all while the
value in `shared/product.ts` is `""`, and appear after a maintainer sets it
and runs `render-generated-regions.ts --write`.

| Value | Where | What appears |
| --- | --- | --- |
| `publicRepoUrl` | Footer of every page | "Source" (`<publicRepoUrl>`), "Apache-2.0 license" (`<publicRepoUrl>/blob/main/LICENSE`) and "Report an issue" (`<publicRepoUrl>/issues`) |
| `supportEmail` | Footer of every page | "Support" (mailto) |
| `securityEmail` | Footer of every page | "Report a vulnerability" (mailto) |
| `docsUrl` | Footer of every page | "Documentation" |
| `homepageUrl` | `<head>` of every page | `og:url` and an absolute `og:image` (social networks need absolute URLs) |

While every link of a footer column is empty, the footer hides the whole
column. Every page also names the social preview image with a relative
`og:image`, after the generated one, for services that resolve it against
the page's address. The license link assumes the repository's default
branch is `main`; if it is not, change `path=blob/main/LICENSE` on both
pages.


## Allowed absolute URLs

These absolute addresses may appear on the site (hreflang alternates). The
site check allows them when they are named here:

- https://bell-pr.suzu.tw/
- https://bell-pr.suzu.tw/zh-tw/
- https://bell-pr.suzu.tw/install.html
- https://bell-pr.suzu.tw/zh-tw/install.html
- https://bell-pr.suzu.tw/assets/video/
- https://bell-pr.suzu.tw/#demo
- https://bell-pr.suzu.tw/zh-tw/#demo

## Hosting

Host the site anywhere that serves static files (for example Cloudflare
Pages or GitHub Pages). It needs no build step: deploy `site/` as it is,
without `README.md` and `check-site.mjs`. Set `homepageUrl` in
`shared/product.ts` to the site's address so the absolute Open Graph tags
appear. Recommended HTTP headers:

```text
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; media-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```
