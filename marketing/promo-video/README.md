# BELL PR launch film

The 88-second English launch film for BELL PR v1.1 (the 86.8 s music edit,
then the complete end card held and faded over 1.2 s), built with
[Remotion](https://www.remotion.dev/) from real footage of the product's
sample project. This package is separate from the product: it has its own
`package.json` and lockfile and is never published.

- Storyboard, captions and timing: [`script.md`](script.md)
- Music and its licence conditions: [`MUSIC-LICENSE.md`](MUSIC-LICENSE.md)
- Sound effects and their licence: [`SFX-LICENSES.md`](SFX-LICENSES.md)
- The visual QA record: [`review.md`](review.md)
- The beat analysis the cut is laid on: [`music/track.analysis.json`](music/track.analysis.json)

## Prerequisites

- Node 22 and this repository checked out with its root dependencies
  installed (`npm ci` at the root): the capture builds the product with the
  root `npm run build` and reads its demo drivers
  (`e2e/helpers/sample-states.ts`) and English copy.
- The licensed music file at `public/music/rock-sport-top.mp3`, or
  `PROMO_MUSIC_FILE` set to its path (`MUSIC-LICENSE.md`); its MD5 is
  checked first.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE`: a local Chrome or Chrome headless shell
  for the capture and the contact sheet, for example Playwright's
  `chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell`
  in the Playwright browser cache. `playwright-core` never downloads one.
- `REMOTION_BROWSER_EXECUTABLE`: the Chrome headless shell Remotion renders
  with (the same file works). Without it Remotion downloads its own on
  first use.
- Port 4651 on 127.0.0.1 free during the capture (`PROMO_CAPTURE_PORT`
  changes it). The capture's temporary HOME and data dir go under
  `/tmp/claude-1000/` (or `TMPDIR`) and are removed when it ends.
- Remotion's temporary files need about 3 GB for the WebM (measured: VP9
  keeps the rendered frames until it encodes them). Where `/tmp` is a
  RAM-backed tmpfs, point `TMPDIR` at a disk folder for the renders (for
  example `out/tmp`, gitignored), or Chrome's page crashes part-way.
- Network access to `assets.mixkit.co` the first time `npm run assets`
  runs (it downloads the six sound effects of `SFX-LICENSES.md` and checks
  their MD5s; `--offline` refuses to download).

No system ffmpeg is needed: Remotion ships its own (`npx remotion ffmpeg`,
`npx remotion ffprobe`).

## Commands

```sh
npm ci                  # this package's dependencies
npm run build           # capture, assets, hit, render (4K master, then the web files from it), check
npm run capture         # footage only: builds the product, films the 13 states at DPR 4
npm run assets          # music copy, brand SVGs, stage plates, sound effects, footage proxies
npm run hit             # measure the final hit in the source against the analysis
npm run render:master   # the 4K master (--scale=2); the web files are made from it
npm run render:web      # 1080p MP4 + WebM from the master (Lanczos), poster, captions
npm run render:draft    # a quick 1x preview, out/draft-1080p.mp4 (not a deliverable)
npm run check           # check every output (`-- --web-only` for the 1080p files only)
npm run review          # QA frames, index, contact sheet, the per-frame scans and the depth-of-field check (exit 1 on a finding)
npm run moments         # the bell's landing and hand-off, and the end card's lines, measured in rendered frames (exit 1 on a finding)
npm run pointer         # the drawn pointer measured in the web MP4: every click on target, no pop (exit 1 on a finding; `-- --strips=<dir>` writes the frame strips)
node scripts/measure-bell.mjs   # where the app's own bell is in the capture the bell lands on
npm run stills -- 291 1011 2452   # quick stills of chosen frames
npm run site            # copy the 1080p web files into site/media/
npm run studio          # Remotion Studio
npm test                # timeline, music, look, logo, bell, end-card, sound and script tests; the depth-of-field and bell-position checks when the footage is there
npm run typecheck
```

`npm run capture -- --skip-build --only=v-check,v-publish` re-films some
states against the existing product build.

## How it works

1. **Capture** (`scripts/capture.mjs`) starts the product with
   `bell-pr start --no-open --port 4651` on a temporary HOME and data dir,
   with stand-in `codex`, `claude` and `gh` first on `PATH` (they answer
   the setup checks and fail everything else, so no agent and no GitHub
   request can run), signs in, and marks onboarding done and the EULA
   accepted. It films each state of plan `direction-v1.1/VIDEO.md` §4 in a
   1440x810 window at device scale 4 (5760x3240 pixels), with the page
   clock installed and paused at 2026-10-14 10:24 UTC and GPU off, so the
   frames are deterministic: PNG stills and frame-stepped clips (the clock
   moves 1/30 s per frame). Two things the page clock does not drive are
   pinned in `v-line-ask`: the demo answer's random pause before it types
   (a queued `Math.random` value, 560 ms) and the chat's smooth scroll,
   which runs on Chrome's real-time clock (the answer take holds the
   "reread" frame the capture reaches with its own page-clock scroll). It
   reaches each state with the drivers
   `e2e/promo-states.spec.ts` checks. The demo-only "Fill with the sample
   answer" controls are hidden while filming (`visibility: hidden` on
   those buttons only; they are still clicked to type the sample text), so
   no frame shows a fill link under the box where the person answers.
   Every named state must pass the privacy check (no owner identifier, home or temp path or e-mail address
   in the page text; **no exemption**) and show the "Sample project" badge,
   or the capture fails. The log goes to `out/capture.log`.
2. **Assets** (`scripts/prepare-assets.mjs`): the checked music copy, the
   product's brand SVGs, pre-dithered stage plates (`scripts/make-stage.mjs`:
   no CSS gradient for a large slow ramp, so no banding after x264), the
   sound effects, the DPR 2 footage proxy for shots that need no more
   (`scripts/make-proxies.mjs`); then every click the film shows is checked
   against the footage: inside its recorded target, and that target where
   the footage shows the control (`scripts/pointer-spots.mjs`).
3. **The cut** (`src/timeline.ts`) lays the 14 shots on the music's events
   from `music/track.analysis.json` with the flex rules of VIDEO.md §3, in
   seconds: shot cuts on bar lines (else half-bars, else a beat), takes on
   half-bars, a cut on every crash downbeat the analysis lists;
   `src/music.ts` is the only place a music number lives.
   **Swapping the track** means replacing the gitignored audio and that JSON
   file, then `npm test` and `npm run check`.
4. **The look** (`src/look/`, `src/scenes/`, `src/shots.ts`): the dark stage
   with focus-pull type for the opening and the end card; a hard
   "lights on" cut to the light studio on the first hit, the wordmark with
   the product's one-line description under it, whose bell then flies on one
   eased arc into the first floating window and lands exactly on the app's
   own sidebar bell, drawn through the window's own transform, then
   cross-dissolves into the footage (`src/bell.ts`, `src/look/BellFlight.tsx`;
   `scripts/measure-bell.mjs` finds that bell in the capture by its moments,
   `scripts/check-moments.mjs` measures the landing in rendered frames);
   each product section opens
   on the whole floating window (no title bar, no window buttons, no
   device; layered and contact shadows), each with its own move, then cuts
   on the beat to push-ins. In a push the component the shot is about (a
   card, a row, a dialog's section) is lifted out of the page, cropped on
   its own border, a little larger and with a soft shadow, while the rest
   drops back, blurred 3.5 px under a veil of the studio's colour
   (`src/look/dof.ts`; `scripts/check-dof.mjs` checks every box against the
   footage). Every camera leaves its cut moving and drifts to the next one
   (`src/takes.ts`); pushes are flat. The drawn pointer (`src/look/pointer.ts`:
   a neutral ring centred on its hotspot, never an OS arrow) fades in just
   outside what it clicks, travels on one eased path, presses on the
   capture's own click point in the plane of the lifted component, stays half
   a second and fades out; `npm run pointer` measures it in the rendered film. The climax opens with a bar of display
   type on the dark stage; captions (DM Sans 56 px, bottom-left or top-left)
   sit on a frosted glass card over a soft pool of light, never on a lifted
   component. Moves use `transform` only; a push never exceeds 2.0 output
   pixels per capture pixel (one DPR-4 pixel per pixel of the 4K master), a
   macro 2.6 (at least 1.5 source pixels per output pixel at 1080p; the 4K
   master upsamples those few frames by up to 1.3x).
5. **Sound** (`src/Soundtrack.tsx`, `src/sfx.ts`): the music edit (two
   segments, -4.5 dB, an equal-power crossfade before the join) and the
   Mixkit effects, placed from the cut.
6. **Render and check**: the 4K master renders the composition at
   `--scale=2`; `scripts/web-from-master.mjs` makes the 1080p web files
   from it with a Lanczos downscale (x264 slow at CRF 21; VP9 at CRF 30
   with a keyframe on every cut where a stage plate first shows), sharper
   than a 1x render. `scripts/check-output.mjs` checks duration, sizes,
   codecs, loudness and true peak, the captions file against the timeline,
   the final hit measured again in the render and the end-card logo on the
   final chord.

## Outputs

In `out/` (gitignored):

| File | What |
| --- | --- |
| `bell-pr-promo-en-2160p.mp4` | the 4K master: H.264 CRF 16 + AAC 320 kb/s, no size cap |
| `bell-pr-promo-en-1080p.mp4` | web, from the master: H.264 CRF 21 + AAC 192 kb/s, at most 20 MB |
| `bell-pr-promo-en-1080p.webm` | web, from the master: VP9 CRF 30 + Opus 160 kb/s, at most 20 MB |
| `poster.jpg` | the complete end card, sharp (frame 2610), at most 500 KB |
| `captions.en.vtt`, `captions.en.srt` | the captions, the same cues as the film |
| `review/`, `contact-sheet.png` | the QA frames, their index and `review/scans.tsv` (`npm run review`) |
| `review/moments.tsv`, `review/moments/` | the bell's landing and hand-off and the end card's lines, measured (`npm run moments`) |
| `review/pointer.tsv`, `review/pointer-opacity.tsv` | every click's hotspot against the click point, and the pointer's opacity on every frame, measured (`npm run pointer`) |
| `capture.log` | the capture's privacy and badge checks |

`npm run site` copies the 1080p web files to `site/media/bell-pr-promo.mp4`,
`bell-pr-promo.webm`, `poster.jpg` and `captions.en.vtt` (also gitignored;
it refuses a tracked target). Footage, proxies, stage plates, the music copy,
the sound effects and the renders are never committed.

## Text to publish with the film (owner)

The film says what BELL PR is in one line under the wordmark; every
platform description should lead with the same line and carry the facts the
film cannot (owner copy; the music credit only on the Patreon tiers that
require it, `MUSIC-LICENSE.md`):

> BELL PR: a learning workbench for AI-assisted open-source contributions.
> An AI agent team does the legwork in isolated worktrees on your machine;
> you understand every change, explain it back, and send one Draft PR that
> follows the project's rules. Uses the Codex or Claude Code CLI you
> installed and signed in to; usage counts against your own account. The
> project, maintainer and replies in the film are a fictional sample.
> Music: Rock Sport Top, MUSIC4VIDEO (@musicforvideolibrary).

## Licences

- **Remotion** is not free for every company: its licence is free for
  individuals and companies with up to 3 employees; larger companies need a
  company licence before the film is published (owner action).
- **Music:** [`MUSIC-LICENSE.md`](MUSIC-LICENSE.md): the owner's Patreon
  licence and its conditions (credit on the tiers that require it,
  individual creators only, Content ID).
- **Sound effects:** [`SFX-LICENSES.md`](SFX-LICENSES.md): Mixkit Sound
  Effects Free License, no attribution.
- **Fonts:** DM Sans and IBM Plex Mono (SIL Open Font License), bundled
  through @fontsource.

## Dependencies

| Package | Why |
| --- | --- |
| `remotion`, `@remotion/cli` (4.0.531, exact) | the composition, rendering, and the bundled ffmpeg/ffprobe |
| `@remotion/bundler`, `@remotion/renderer` (4.0.531, exact) | `scripts/stills.mjs` renders chosen frames from one bundle and one browser |
| `react`, `react-dom` | Remotion renders React |
| `playwright-core` | drives Chrome for the capture and the contact sheet |
| `@fontsource-variable/dm-sans`, `@fontsource/ibm-plex-mono` | the brand fonts (DM Sans with its optical-size axis), bundled |
| `tsx` | loads the product's TypeScript and `src/*.ts` from the Node scripts, and runs the tests |
| `typescript`, `@types/react`, `@types/node` | type checking |
