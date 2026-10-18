# Frame review

The film is checked twice: by the scripts after every capture and render,
and by people before it is published. Frame numbers are film frames (30 a
second) of the 86.8 s cut (2604 frames); the cut itself is in
[`script.md`](script.md).

## Automated: enforced on every run

`npm run capture` (`scripts/capture.mjs`) fails unless, at every named
state of every VIDEO.md §4 state it films:

- the page text breaks no privacy rule (`scripts/lib/privacy.mjs`): no
  owner user, host or tailnet name or handle, no `/home/`, `/Users/` or
  `/tmp/` path and no e-mail address. A guard in the page checks the text
  after every DOM change while a clip is filmed, and the capture checks it
  again at each named state. **There is no exemption.**
- the "Sample project" badge is visible;
- the licensed MP3 matches its MD5 before anything starts.

`out/capture.log` holds the capture behind this cut: 13 states, 50 named
states each "privacy ok; sample badge visible", "every named state passed
the privacy and badge checks (no exemption)". Twelve states were filmed on
2026-10-15 at device scale 4 on the same product commit; `v-draft-your-words`
was filmed again on 2026-10-18 to add the establishing still `top` (its clip
came out pixel-identical to the earlier one: mean absolute difference 0.0
on frames 0, 100 and 200).

`npm run check` (`scripts/check-output.mjs`; `-- --web-only` while the 4K
master is not rendered) fails unless:

- every video lasts the composition's 86.8 s ± 0.1 s (inside 75-90 s) at
  30/1 fps: the web MP4 1920x1080 H.264 + AAC and the WebM VP9 + Opus,
  each at most 20 MB, and the 4K master 3840x2160 H.264 + AAC;
- `poster.jpg` is 1920x1080 and at most 500 KB;
- `captions.en.vtt` holds the cues of `src/timeline.ts`, in order, without
  overlap, within the caption rules, all ending inside the video;
- every video measures -15 to -13 LUFS integrated with a true peak of at
  most -1 dBTP (the bundled ffmpeg's `loudnorm` analysis);
- the music's final hit, measured again in the MP4's audio inside
  81.1-84.0 s, is where the analysis records it, and the end-card logo
  locks within ±0.25 s of the final chord.

`npm test` (50 tests) keeps the cut honest against the **loaded** analysis
file: anchored shots on their events, every other cut and every take on a
beat, shot lengths inside their limits in seconds, the flex rules on altered
analyses (S10 merged, S8 dropped, S9 held, a missing accent on a bar line),
captions of at most 42 characters a line and 2 lines, on screen at least
1.8 s (one line) or 2.6 s (two lines) and starting on the half-beat grid,
the owner's headline on the end card, no "automatic", "autonomous" or
"proves", every establishing window whole in frame (four edges at least
40 px inside, scale at most 1), no take above 2.0 output px per capture px
(one DPR-4 pixel per pixel of the 4K master), readable UI never faster than
8 px a frame once settled, no jump cut inside one captured state, no sliver
of studio under 60 px at a frame edge, a sidebar cropped by the frame edge
always in the soft plane, the logo moments, the breath before the hit, and
the sound effects' placement and levels.

## Visual QA by the engineer

`npm run review` extracts frames from the web MP4 into `out/review/` and
writes the frame index `out/review/index.tsv` (frame, seconds, shot, take,
file, why) and `out/contact-sheet.png` (the middle of every take, the first
hit and the end-card landing). The 249 frames: every shot and take midpoint
(38), every caption midpoint (20), two frames either side of every cut and
the cut frame itself (between shots and between takes: 63), the breath
before the hit (255, 273, 286, 290), the hit (291), the measured final hit
(2438), the logo landing (2452), the last frame, and every 15th frame of
every product take (122 frames of push-ins, 25 of floating windows), which
is where jitter, smear and inconsistent zoom show. Every one was looked at,
in 3x3 sheets at 640 px and then at full size where anything was in doubt;
4K stills (`npm run stills -- <frame> --scale=2`) of 408, 1011, 1680 and 2316
were looked at in 1200x800 crops at full resolution.

Four rounds: each one rendered the web files again, extracted the 249
frames again and looked at all of them.

### Round 1 (renders of 2026-10-18 16:46 and 16:59): found and fixed

Before the first render, on stills of every take: the queue's cards were
laid out off the frame (fixed the layout); push-ins showed slivers of
studio at a frame edge (pushes now cover the frame unless they show a
window edge on purpose); the captured pointer's white disc vanished on the
white UI (now an ink disc with a white ring); captions sat over busy UI
(now a frosted card on a soft pool of light); S11 opened on the draft
scrolled away from the "Sample project" badge (filmed the draft from the
top, `v-draft-your-words/top`); S13 started inside a scroll (later start).

On the renders:

| Found | Frames | Fix |
| --- | --- | --- |
| The light studio banded after x264: concentric rings at 10x contrast, longest flat runs 208-594 px | 291, 300, 408 | the light plate carries a static coarse ±2 LSB grain like the dark one (variant B's measured fix); flat runs now 17-28 px; +9% bits on the light beats |
| An empty white frame between the logo and the window | 344 | the logo fades through the last frame of its take, and the window's top edge is in frame on the cut (345) |
| The caption card showed empty, then glyph tops, for its first 2-3 frames | 381, 471, 1677, 1893 | the lines are on from the card's first frame, starting 70% risen under the card's own fade |
| The end card's cut frame was empty | 2438 | the logo's focus pull starts as if two frames before the cut, so 2438 already shows the soft logo |
| The rise's shutter blur smeared the UI into streaks | 347-352 | a shorter shutter (about 90°, capped at 8 px) |
| Near-identical framings across a cut inside one state read as jump cuts | 721/723, 1063/1065, 1207/1209, 1675/1677 | each cut now changes magnification by at least 15% or moves to another part of the screen (a test asserts it) |
| A line of text sat half in and half out of focus under the published card | 2181-2268 | reframed; the focus ramp falls in the gap under the card |
| The ticks and the keyboard bed sat 35-40 dB under the music: inaudible | (sound) | raised to 25-30 dB under; a tick alone now peaks under -20 dBTP |
| The MP4 at CRF 23 was 20.14 MB, over the 20 MB budget | | CRF 24: 18.5 MB, no visible change on UI text at full size |

### Round 2 (renders of 2026-10-18 17:09 and 17:15): found and fixed

| Found | Frames | Fix |
| --- | --- | --- |
| Sharp half-words of the app's sidebar cut by the frame edge | 723-865 (board), 2019-2089 (checklist), 2271-2359 (feedback) | those pushes put the sidebar in the soft plane (a test asks for it whenever a push crops the sidebar) |
| Slivers of studio, 3-54 px, along a frame edge while a tilted window was pushed | 561 (14-24 px), 957, 1065, 1119, 1569, 1677, 1749, 2091 | `push()` places the window on its projected corners (the tilt's perspective included), covering each edge by 20 px or showing one edge on purpose; framings too small to cover went up to 1.42 or more; a test allows no gap between 1 and 60 px |
| The WebM render ran Chrome out of memory at concurrency 6 | | concurrency 4 for both web renders |

### Round 3 (renders of 2026-10-18 17:51 and the WebM after it): found and fixed

| Found | Frames | Fix |
| --- | --- | --- |
| The WebM banded on the dark stage although the MP4 did not: VP9 at CRF 35 flattened the 2x2 px grain (flat runs 240-620 px; contour rings at 6x contrast), worst on the end card, which VP9 coded as inter frames off a light-studio keyframe | 2470, 2521 (WebM) | the dark plate's grain is ±2.5 LSB in 5x5 px cells (VP9 keeps it; x264 kept either), and the WebM gets a keyframe on each dark/light cut (`remotion.config.ts`); WebM flat runs on the dark stage now 51-68 px |

### Round 4 (renders of 2026-10-18 18:11 and 18:32): verdicts

Nothing a viewer would notice remains. The MP4 is 17.7 MB, the WebM
17.1 MB with keyframes on the cuts at 291 and 2438; `npm run check -- --web-only`
passes. Banding on decoded frames
(longest flat run on a gradient, pass ≤ 120 px): MP4 dark stage 30-47 px
(30, 111, 240, 2470, 2521, 2590), light studio 17-28 px (291, 300, 400);
WebM dark stage 48-64 px (30, 240, 2438, 2470, 2521). In the WebM the light studio keeps one-level steps
near white (flat runs about 175 px at levels 245-255, under 0.5% each):
invisible at viewing contrast, seen only at 8x contrast; the MP4 has none.

| Shot | Frames looked at | Verdict |
| --- | --- | --- |
| S1 Problem | 39, 73, 111, 145, 147 | ok: the soft queue of identical cards on the dark stage, no names, numbers or platform chrome; the reviewer's round pointer pings on the beat; both lines pull into focus, "Reviewing them still" racks soft while "isn’t." stays sharp. Banding 30: 30 px MP4, 64 px WebM. |
| S2 Turn | 149, 210, 219, 255, 273, 286, 289, 290 | ok: the question pulls into focus line by line; the queue halts; one card lifts out, turns to face the viewer and lights up on the stop; 258 and 270 are the same picture (mean absolute difference 0.018 levels, encoder noise); the exhale; 287-290 dark on purpose (max level 3). Banding 240: 30 px MP4, 63 px WebM. |
| S3 Rules first | 291, 293, 343, 345, 347, 360-465, 469-559 | ok: "lights on" at 291, the wordmark crisp (brand green decoded at (30.4, 107.8, 79.8) for #1f6d50), held 54 frames, gone by 344; the window rises in on 345 and turns to face the viewer, all four edges, the contact shadow, the badge; the push onto "Before you contribute", the three quoted rules with their `CONTRIBUTING.md` lines, sharp at every 15th frame. |
| S4 Still yours | 561-649, 651-721 | ok: the task dialog glides to "Before you start #42 (sample)"; the push lands on the green chips with the rest of the dialog soft; "Check the issue is still yours." beside, not over, the chips; the plan waiting for approval. |
| S5 Legwork | 723-865 | ok: a step wider than the plan before it, the cropped sidebar soft; the pointer approves, the plan folds, tasks move, the team's messages arrive; the caption sits top right over the run's phase row, clear of the board. |
| S6 Try first | 867-955, 957-1063, 1065-1117 | ok: the review screen turns to face the viewer while the answer types; the push onto the quiz card ("Think so", Show answer, the AI-written reference, "Got it") with the diff soft behind; a step back to the plain-language example. |
| S7 Taste | 1119-1207, 1209-1315 | ok: the guess types, "Show the alternative"; a closer framing for the alternative, "Keep this approach" and the why. |
| S8 Ask | 1317-1369, 1371-1441 | ok: lines 10-15 selected with the pointer's clicks in focus; "Explain this code"; the camera eases to the panel as the question with its diff block and the answer arrive. |
| S9 Explain it back | 1443-1513, 1515-1567, 1569-1675, 1677-1747 | ok: the closed-book check as the floating window; the summary types; the `retry.ts` answer at "Think so", the not-tested answer; the reveal, "Partly" and the correction, the closest framing of the film. |
| S10 Predict | 1749-1873 | ok: "Tests", the forecast line, then the saved prediction beside the result line "You explained the change and answered 2 questions. You missed 1 and corrected it." |
| S11 Your words | 1875-1945, 1947-2017, 2019-2089 | ok: the calm section, half the establishing turn; "Use my explanation" and "Add my not-tested answer to Testing" under their captions; the maintainer checklist with every row OK, the cropped sidebar soft, nothing over it. |
| S12 Send one | 2091-2179, 2181-2269 | ok: the publish dialog right of centre with "Your open PRs here: 0 of 1" and "Every check passes."; "Open the sample Draft PR"; "Draft PR opened · Sample: not created on GitHub" sharp, the rest soft. |
| S13 Learn | 2271-2359, 2361-2436 | ok: "Your forecast: Tests" beside the sample maintainer's comments, "Saw it coming", "Changes requested", the cropped sidebar soft; the practice item, "Got it", "Next review in 3 days". |
| S14 End | 2438, 2440, 2452, 2521, 2536, 2603 | ok: the cut to the dark stage on the measured hit with the logo already pulling in; locked on the chord at 2452; the headline beat by beat, "From"/"to" near white, "vibe coding" dim and slightly soft, "knowing why." mint; `npx bell-pr` · "Free to start · Runs on your machine"; the non-affiliation line; no homepage (`shared/product.ts` has none). Banding 2470/2521: 37/47 px MP4, 55/68 px WebM. |

Every frame: no blank or loading frame other than the four intended dark
ones (287-290); no cropped half-word at a frame edge in a sharp plane; no
caption over the subject of its shot; no double exposure; no Apple fonts,
devices, window buttons or "9:41" (the capture clock reads 10:24); no
GitHub, OpenAI or Anthropic logo; only the fictional sample.

4K: the 4K stills of 408 (the window at M 0.93), 1011 (the quiz card at
M 1.9), 1680 and 2316 have crisp UI text at full resolution: the DPR 4
captures give at least one source pixel per 4K output pixel everywhere.

### The look-dev's must-fix list (COMPARISON.md), as fixed here

| # | Must-fix | Fixed, frames |
| --- | --- | --- |
| C1 | Title sweep drew a misregistered ghost copy of "knowing why." | The sweep is drawn inside the letters of the same element (`background-clip: text` on the word itself), so it cannot misregister; it crosses "knowing why." over 2513-2537 (2521 in the review: no ghost). The logo's sweep is masked by the logo itself (2456-2480). |
| C2 | Title contrast: "From"/"to" dimmed, "vibe coding" left blurred | "From" and "to" stay #f4f7f3; only "vibe coding" dims (#56695d) and softens, at most 1.6 px; "knowing why." turns mint. 2521, 2536, 2603 and the poster (2590) read as stills. |
| C3 | The bell alone on an empty white frame during the match cut; a rotated smear | No traveling bell: the wordmark holds (291-326), lifts and dissolves (327-344), and the window's top edge is already in frame on 345; no empty frame (343, 345 in the review). |
| C4 | No establishing shot of the whole window | Every product section opens on the whole floating window, four edges in frame, contact shadow, scale ≤ 1: 345-470, 867-956, 1443-1514, 1875-1946 (test). |
| C5 | Shutter blur and depth of field smeared the UI during the dolly | Push-ins move at most 8 px a frame and carry no shutter blur; depth of field is a pre-blurred back copy under a mask, so the sharp plane never doubles: 471-546, 957-1062, 1569-1747 sharp at every 15th frame. |
| C6 | Supporting line: glyph tops at its start, over blurred code, covering the diff | Captions sit on a frosted card over a soft pool of light, beside the subject; the lines show whole from the first frame: 381, 471, 885, 1461, 1677, 1893. |
| C7 | Soft 4K product frames (DPR 2) | DPR 4 captures; magnification ≤ 2.0 (test); 4K crops of 408, 1011, 1680, 2316 are crisp. **The 4K master render (`npm run render:master`) is the next step**, after this 1080p cut. |
| C8 | Sound needs a listen; the swell may be inaudible | Measured: swell 16.7 dB, whooshes 17-25 dB, glint 20 dB, ticks and keyboard 25-30 dB under the music at their moments; effects alone peak at -16.2 dBTP (ticks under -20); the mix measures the same integrated loudness as the music alone. **The listen is an owner sign-off.** |
| C9 | Grain and bitrate | Coarse static grain on both plates (the light one added in round 1, the dark one coarsened for VP9 in round 3); MP4 17.7 MB, WebM 17.1 MB, inside 20 MB. |
| B | Hand-off ghosting in the light wipe | No wipe and no cross-dissolve between the logo and the window: the logo has gone before the window enters (A's rule). |

## By people: OWNER SIGN-OFF (not an agent gate)

- [ ] The cut by eye and by ear (music edit at the join at 50.5 s, the
      sound effects' levels).
- [ ] `"reviewed": true` in `music/track.analysis.json` after listening.
- [ ] The music licence conditions in `MUSIC-LICENSE.md` (the credit on the
      tiers that need it, Content ID).
- [ ] The Mixkit User Terms read before publishing (`SFX-LICENSES.md`).
- [ ] Remotion's company licence, if it applies (README.md).
