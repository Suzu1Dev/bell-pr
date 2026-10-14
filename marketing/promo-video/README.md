# BELL PR promo video

The 75-second English promo for BELL PR, built with [Remotion](https://www.remotion.dev/)
from real footage of the product's sample playback. This package is
separate from the product: it has its own `package.json` and lockfile and
is never published.

- Storyboard and captions: [`script.md`](script.md)
- Music and its license terms: [`MUSIC-LICENSE.md`](MUSIC-LICENSE.md)
- Frame-review checklist: [`review.md`](review.md)
- Shot, camera and caption timing: [`src/timeline.json`](src/timeline.json)

## Prerequisites

- Node 22 and this repository checked out; the capture builds the product
  with the repository's own `npm run build`, so the root needs its
  dependencies installed (`npm ci` at the root).
- The licensed music file: put `mixkit-ramp-it-up-69.mp3` in
  `public/music/`, or set `PROMO_MUSIC_FILE` to its path. The capture checks
  its MD5 first.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE`: a local Chrome or Chrome headless shell
  for the capture, for example Playwright's
  `chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell`
  in the Playwright browser cache. `playwright-core` (pinned here) never
  downloads a browser.
- `REMOTION_BROWSER_EXECUTABLE`: the Chrome headless shell Remotion renders
  with (the same file works). When it is not set, Remotion downloads its own
  headless shell on first use; that is the fallback, not the default.
- Port 4573 on 127.0.0.1 free during the capture (`PROMO_CAPTURE_PORT`
  changes it).

No system ffmpeg is needed: Remotion ships its own (`npx remotion ffmpeg`,
`npx remotion ffprobe`).

## Commands

```sh
npm ci                 # this package's dependencies
npm run build          # capture, then render
npm run capture        # footage only (builds the product first)
npm run render         # MP4, WebM, poster, captions, then the checks
npm run check          # check the outputs again
npm run review         # QA frames and the contact sheet (see review.md)
npm run site           # copy the outputs into site/media/
npm run studio         # Remotion Studio, to preview and tune the timeline
npm test               # unit tests (timeline, camera, cursor, music, captions)
npm run typecheck
```

`npm run capture -- --skip-build --only=s7-explain,s8-review` re-films some
shots against the existing product build.

## How it works

1. **Capture** (`scripts/capture.mjs`) starts the product with
   `bell-pr start --no-open --port 4573` on a temporary HOME and data dir,
   with stand-in `codex`, `claude` and `gh` commands first on `PATH` (they
   answer the setup checks and fail everything else, so no agent and no
   GitHub request can run). It signs in, marks onboarding done and the EULA
   accepted, and films each shot in a 1440x810 window at device scale 2:
   PNG stills, CDP screencast clips (JPEG quality 100, every frame with its
   timestamp) or frame-stepped clips (the page clock moves 1/30 s per frame
   and each frame is screenshot). `src/timeline.json` names each shot's
   method. Every captured state must pass the privacy check (no owner
   identifier, home or temp path, or e-mail address in the page text) and,
   in workspace shots, show the "Sample project" badge; otherwise the
   capture fails. The log goes to `out/capture.log`.
2. **Composition** (`src/`) plays the stills and clips through a virtual
   camera (eased pans and zooms), draws the cursor and the captions, adds
   the title and end cards in the product's brand and fonts, and lays the
   music edit under it all (`src/music.ts`).
3. **Render** writes the outputs below, and `scripts/check-output.mjs`
   checks them with the bundled ffprobe: duration, size, frame rate,
   codecs, audio, file sizes, caption timings, loudness and the end-card
   logo against the music's measured final hit.

## Outputs

In `out/` (gitignored):

| File | What |
| --- | --- |
| `bell-pr-promo-en-1080p.mp4` | H.264 + AAC 192 kb/s, at most 20 MB |
| `bell-pr-promo-en-1080p.webm` | VP9 + Opus 192 kb/s, at most 20 MB |
| `poster.jpg` | the end card, at most 500 KB |
| `captions.en.vtt`, `captions.en.srt` | the captions, same cues as the burned-in ones |
| `contact-sheet.png`, `review/` | QA frames (`npm run review`) |
| `capture.log` | the capture's privacy and badge checks |

`npm run site` copies them to `site/media/bell-pr-promo.mp4`,
`bell-pr-promo.webm`, `poster.jpg` and `captions.en.vtt`, which are also
gitignored. Footage (`public/footage/`), the music copy (`public/music/`)
and the renders are never committed.

## Licenses

- **Remotion** is not free for every company: its license is free for
  individuals and companies with up to 3 employees, and larger companies
  need a company license. Confirm which applies before the video is
  published (owner action).
- **Music:** see [`MUSIC-LICENSE.md`](MUSIC-LICENSE.md). Never register the
  music or the video's audio with YouTube Content ID or any
  rights-management service, and never publish the MP3 on its own.

## Dependencies

| Package | Why |
| --- | --- |
| `remotion`, `@remotion/cli` (4.0.531, the same exact version) | the composition, rendering, and the bundled ffmpeg/ffprobe |
| `react`, `react-dom` | Remotion renders React |
| `playwright-core` | drives Chrome for the capture and the contact sheet |
| `@fontsource-variable/dm-sans`, `@fontsource/ibm-plex-mono` | the brand fonts, bundled, with no font request at render time |
| `tsx` | loads the product's TypeScript (its English copy, `shared/product.ts`, `src/music.ts`) from the Node scripts, and runs the unit tests |
| `typescript`, `@types/react`, `@types/node` | type checking |
