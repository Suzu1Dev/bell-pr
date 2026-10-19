# Frame review

The film is checked twice: by the scripts after every capture and render,
and by people before it is published. Frame numbers are film frames (30 a
second) of the 88.0 s cut (2640 frames: the 86.8 s music edit and the end
card's 1.2 s hold and fade); the cut itself is in [`script.md`](script.md).
Rounds 1-4 below were made on the first cut; round 5 re-cut the film after
three reviewers' findings, round 6 answered a second set of three reviews
and round 7 a third. Round 8 rebuilt everything from a clean state (a new
capture of all 13 states included) and made that rebuild repeat the
reviewed film. Round 9 answers the owner's feedback on that cut (the bell
flies into the first window; `npx bell-pr` on a line of its own); round 7's
verdicts stand for every frame round 9 did not change. Round 10 answers the
owner's feedback on the pointer (it did not seem to click where it should,
and sometimes vanished): every click and every frame the pointer shows is
measured in the rendered film; nothing else changes.

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

`out/capture.log` holds the capture behind this cut: one run of
`npm run capture` from a clean state on 2026-10-19 (round 8), 13 states at
device scale 4, 51 named states each "privacy ok; sample badge visible",
the in-page guard reporting "no finding" for every state, and "every named
state passed the privacy and badge checks (no exemption)". Rounds 5-7 were
reviewed on footage filmed on 2026-10-15 (seven states) and 2026-10-18 (six
states, the demo-only "Fill with the sample answer" controls hidden and
`v-practice` with a right answer); round 8 checks that the clean capture
gives the same pictures (below).

`npm run check` (`scripts/check-output.mjs`; `-- --web-only` while the 4K
master is not rendered) fails unless:

- every video lasts the composition's 88.0 s ± 0.1 s (inside 75-90 s) at
  30/1 fps: the web MP4 1920x1080 H.264 + AAC and the WebM VP9 + Opus,
  each at most 20 MB, and the 4K master 3840x2160 H.264 + AAC;
- `poster.jpg` is 1920x1080 and at most 500 KB;
- `captions.en.vtt` holds the cues of `src/timeline.ts`, in order, without
  overlap, within the caption rules, all ending inside the video;
- every video measures -15 to -13 LUFS integrated with a true peak of at
  most -1 dBTP (the bundled ffmpeg's `loudnorm` analysis);
- the music's final hit, measured again in the MP4's audio inside
  81.1-84.0 s, is where the analysis records it, and the end-card logo
  locks within ±0.25 s of the final chord (it locks on 2451, -0.018 s).

`npm test` (80 tests) keeps the cut honest against the **loaded** analysis
file: anchored shots on their events, section changes on bar lines (else
half-bars; S9's nominal counted in the track's own bars, so S10 starts on
the bar-25 downbeat), takes
on half-bars, a cut on every crash downbeat of the analysis, shot lengths inside their limits in seconds, the flex rules on altered
analyses (S10 merged, S8 dropped, S9 held, a missing accent on a bar line),
captions of at most 42 characters a line and 2 lines, on screen at least
1.8 s (one line) or 2.6 s (two lines) and starting on the half-beat grid,
the owner's headline on the end card, no "automatic", "autonomous" or
"proves", every establishing window whole in frame for two beats or more
(four edges at least 40 px inside, scale at most 1), no push above 2.0
output px per capture px (one DPR-4 pixel per pixel of the 4K master) and
no macro above 2.6, the sharp plane never faster than 8 px a frame once
settled, **a camera that moves on every frame of every product take** and
an on-cut move that covers at most 60% of its travel in its first beat,
flat pushes (no tilt at 1.4x or closer), a lift that comes forward inside
a take racking in 12-18 frames, no jump cut inside one captured state, no
sliver of studio under 60 px at a frame edge, a sidebar in frame always
wholly dropped back (no lift reaches into it), **no caption card within
12 px of a lifted component**, **the pointer** (`src/look/pointer.ts`: at
every press its hotspot on the capture's click point, carried as the
footage's lifted layer is, inside the recorded box, at full opacity and at
rest; no pointer on a take's first frame; opacity steps of at most 1/12 a
frame; on full from two frames before each press to half a second after
it; a take that cuts with the pointer on cuts 10 frames or more after the
press and never while it travels), the logo moments (the first-hit
lockup readable whole for 1.2 s, pushing at 1.00-1.04 in 53 frames with the
six-frame flare, its name gone within 9 frames of the flight's start; the
end-card logo under 72% eight frames after the cut, its last fifth and its
settle on the three frames before the chord), **the bell's flight**
(`src/bell.test.ts`: lift-off on a half-bar after 1.2 s of the lockup,
landing on the bar-6 downbeat, 0.8-1.4 s; every point of the bell's
outline within 0.01 px of the app's own bell through the window's
transform on every frame from the landing to the end of the hold, its
size within 0.1%; one rise and fall of speed with no reversal, near rest
at both ends; an arc bowing 5-15% of its length; the window shown only
once the lockup's name has gone and the bell has left its place, and
whole by mid-flight; the bell never over the app's "BELL PR" or
"WORKSPACE" on its way in; the footage's bell patched until the landing,
then a cross-dissolve of at least 6 frames inside the hold), **the end
card's lines** (`src/endCard.test.ts`: logo, headline, `npx bell-pr`
alone, the facts alone and the footer never touching, with at least 64,
24 and 80 px clear above the command, the facts and the footer, all inside
a 60 px margin to the last frame), the line under the first-hit wordmark
being the site's own description, the breath before the hit, and the
sound effects' placement (whooshes peaking a frame before their downbeat,
the glint on the chord) and levels. With the footage in place it also runs
the depth-of-field check below against the captured pictures, and checks
that the film's box for the app's bell is where `scripts/measure-bell.mjs`
finds it in the capture (within 0.1 capture px), and that every click the
film shows lies inside its recorded target and that target is where the
footage shows the control on the frame of the press: its outline on an
edge of the picture for at least 70% of its length
(`scripts/pointer-spots.mjs`; 91-100% on the 13 clicks, and every box
moved 9-12 px fails it).

`npm run pointer` (`scripts/check-pointer.mjs`) measures the drawn pointer
in the rendered film and exits 1 on a finding. Every frame of the 12 takes
that show a click is rendered three times at 1080p, losslessly: as the
film, without the pointer and with it at full opacity; in those frames,
and again in the web MP4, the pointer's opacity on every frame is a
least-squares fit of the film's difference from the pointer-less frame on
the full pointer's, and at every press its centre is a circle fitted to its
ring in the pixels, while the point the capture clicked is found in the
pointer-less frame by matching the captured picture round it (footage-2x
at the shot's magnification). Findings: a hotspot more than 4 px from its
click or outside its target's box (render or MP4); an opacity step above
0.13 between two frames of one take; a pointer on a take's first frame; a
take that cuts with the pointer on less than 10 frames after a press or
while it travels; the render more than 0.05 from the model; the MP4 more
than 0.12 from the render. Results go to `out/review/pointer.tsv` and
`out/review/pointer-opacity.tsv` (run it after `npm run review`, which
empties `out/review/`); `-- --strips=<dir>` writes every click's frames and
every appearance and disappearance, cropped 2x, with a contact sheet per
take.

`npm run moments` (`scripts/check-moments.mjs`) measures the same two
moments in rendered frames and exits 1 on a finding: every frame from the
landing to the end of the hand-off rendered three ways (the film, the
flying bell alone with the footage's bell patched out, the footage's bell
alone), the bell's centre and size from the brand green's coverage: the
flying bell within 1 px and 2% of the footage's bell, the film's bell
within 0.25 px and 2% of it on every frame of the cross-dissolve (no jump),
and identical to it after; and on the complete end card (frame 2610) the
rows of ink, top to bottom, with the clear space between them and the
command and the facts centred. Results go to `out/review/moments.tsv`.

`npm run review` also scans **every frame** of the MP4 (one decode) and
exits 1 on a finding: a mean luma step above 8 between two frames that are
not a cut (nor the UI's answer to an on-screen click, a fast camera move or
the board's own in-place updates) is a jump inside a take; more than 8
sharp-edge pixels in the ring 6-18 px round a settled caption card (its
box measured in Chrome in the film's font) is UI text running into the
card; a card that comes in must show its text on its second frame (no
empty frosted box). A fourth check runs on the footage itself
(`scripts/check-dof.mjs`), at every third frame of every take, moving or
settled: no lifted box crops a glyph (each ends on its component's border
or in a gutter), no lifted line is cut by a frame or window edge, and every
floating window ends in a gutter. Findings go to `out/review/scans.tsv`.

## Visual QA by the engineer

`npm run review` extracts frames from the web MP4 into `out/review/` and
writes the frame index `out/review/index.tsv` (frame, seconds, shot, take,
file, why) and `out/contact-sheet.png` (the middle of every take, the first
hit and the end-card landing). In round 7, 276 frames: every shot and take
midpoint, every caption midpoint, two frames either side of every cut and
the cut frame itself, the breath before the hit (255, 273, 286, 290), the
hit (291), the measured final hit (2438), the logo landing (2452), the last
frame, and every 15th frame of every product take. Every one was looked
at, in 4x4 sheets at 490 px and then at full size where anything was in
doubt, and the whole contact sheet; the 4K master was looked at in
full-resolution crops (below).

Seven rounds: each one rendered the web files again, extracted the frames
again and looked at all of them.

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

### Round 4 (renders of 2026-10-18 18:11 and 18:32): verdicts on the first cut (superseded by round 5)

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

### Round 5 (renders of 2026-10-18 20:02, 20:08 and the 4K master): three reviewers' findings, the re-cut, verdicts (superseded by round 6)

Three reviewers looked at the round-4 cut frame by frame. Every high and
medium finding is fixed below, or explained where it would break the spec
or an owner decision; the cheap low ones are fixed too. The film was
re-cut, rendered again (1080p MP4 and WebM, poster, captions, and the 4K
master), the 271 review frames were extracted and looked at, and both new
per-frame scans ran over all 2670 frames with no finding.

**Fixed** (the frames are the new cut's):

| Finding | Fix | Frames now |
| --- | --- | --- |
| S12: the publish dialog closed mid-take (2169-2180), words half sharp, "Draft PR op\|ened" | The dialog take ends on the bar-31 crash, the clip slowed so the click on "Open the sample Draft PR" lands two frames before it and the dialog's own close falls after the cut; the published card starts on the crash. `npm run review` now scans every frame for jumps inside a take (it would have caught this) | 2091-2162, 2161 click, 2163 cut |
| S14: the logo locked 7 frames before the final chord; sweep and glint 150 ms late; an empty frame on the chord | The logo is the hero on the chord, centred and 520 px wide, resolving on an even curve (68% eight frames after the cut, whole on 2451, settling 1.02 → 1.0 there); the sweep and the glint's onset start on 2451; a beat later the logo moves up to its slot as "From vibe coding" enters. Decoded MP4: the logo still changes up to 2451 (step 0.49) and is still from 2452 | 2438-2451, 2451-2475 sweep, 2469-2487 move |
| Cut grid: 11 of 27 cuts on beats 2/4, the bar-9 and bar-23 crashes mid-shot | Shot cuts snap to bar lines, else half-bars, else beats (only where the limits leave nothing else); takes to half-bars; the analysis lists the crash downbeats and a test puts a cut on each: 291, 579, 1443, 1587, 2163. Two shot cuts take beat 3 (S7 1119, S13 2271: a bar line breaks S6-S8's or S12-S13's limits) and one beat 2 (S10 1749: S9 ≥ 10 s and S10 ≥ 4 s in a 14.4 s gap leave only that beat; the test proves no bar line or half-bar fits). The rise at 345 is the one take on beat 4: it anticipates the bar-6 downbeat it lands on | all cuts |
| S8: the caption card over the selected lines; "Explain this code" in the soft plane | The caption goes top-left; the selection sits mid-frame with the window's bottom edge over the studio, the selection bar ("7 lines selected · Explain this code") inside the sharp plane and pressed on screen; then the panel racks from the question's diff block down to the answer | 1299-1370, 1364 click, 1371-1442 |
| S6-S10: one composition for 30 s, no push on the climax | One beat-locked push a section (S3 rules, S4 chips and plan, S6 answer, S7 guess, S9 lights-on push landing on the 1587 crash, S10 chips, S12 dialog and card, S13 compare and next); macros (M 2.1-2.6) on the decisive lines: the reference and "Got it", "Keep this approach", the question and "Think so", "Partly", the result, the prediction line, "Draft PR opened", "Next review in 3 days"; S7 with the window on the left and the caption right; S11 entering from the left with the captions right; a cut every bar inside the climax (1443, 1515, 1587, 1659, 1695) | 867-1874 |
| The climax had no signature beat | On the climax crash, one bar of display type on the dark stage ("Before it ships, explain it back.", "Before it ships," racking soft), then a hard "lights on" cut on the music's join to the closed-book check (no explanation tabs, the diff stays) as the floating window | 1443-1514, 1515 |
| "Fill with the sample answer" sharp under the person's answers (S6, S7, S9, S10) | The capture hides the demo-only fill controls while filming (`visibility: hidden` on `.tf-fill` and `.check-fill`, nothing else; they are still clicked to type the sample text; the capture fails if one shows) and the five states were filmed again. The reviewers preferred the product to do it under `capture=1`; the product is outside this package's files, so the capture does it, the same way the product's own `capture=1` CSS hides scrollbars and the caret | 903-1298, 1515-1874 |
| S14: the call to action arrived in pieces and held 1.3 s | The headline in two beats, then `npx bell-pr` · "Free to start · Runs on your machine" and the non-affiliation line together on the next beat (2523); the composition runs 2.2 s past the music's last sound, so the complete card holds 3.9 s (2541-2657; "vibe coding" sharp again from 2559), then fades to black over the last 12 frames; 89.0 s, inside 75-90 s | 2523-2669 |
| S4: the chips take opened on the dialog's own scroll | The take starts on the bar-9 crash after the scroll (clip 2.55 s), the facts already settled, pushing 1.55 → 1.85 onto the chips | 579-650 |
| In-take scrolls (S9 grade, S11 words, S13 practice) and the plan fold off the grid | Each take starts after the capture's scroll and ends (or freezes, `clipTo`) before the next; the fold now follows the approve click on beat 3 (759); the per-frame scan finds no jump left (the fold and the card collapse after "Got it" are the UI's answers to on-screen clicks) | 759, 1695-1748, 1947-2018, 2343-2378 |
| Caption cards slicing sharp UI text (S5, S3, S13) | A test keeps every card 12 px clear of the projected sharp plane, and the per-frame scan checks the decoded ring round each card; S5's card moved bottom-left over the soft lower board, S3's sharp plane ends in the gap under the third rule | 741-866, 471-578, 2280-2437 |
| Masks cutting through tokens; 8 px blur on readable text | Right-panel masks start at the panel's own card edge (capture x 1099) with a 14 px ramp inside its padding; the back plane is a milder pre-blur (1/5 scale, about 3 px on screen at the pushes) under a 42% light veil, so soft text recedes instead of smearing | 903-1874 |
| White-on-white light studio | The studio plate is 13-18 levels darker (#eff1ed centre, #dde2da edge; decoded 224-242 against the window's 255), the shadow stack deeper (40/100 px layers .20/.26), the contact shadow .30, a 2 px top rim | 345-470, 867-902, 1515-1586, 1875-1946 |
| S3 hand-off: an empty white moment, a smeared rise landing between beats | The wordmark holds at full strength to 335 and is gone by 344; the window rises from 345 (heroGlide over one beat) and lands on the bar-6 downbeat (363), the shutter streak capped at 4 px | 291-470 |
| S6: "Answer first." over a wide shot where the answer was unreadable | The establishing turn is two beats; the push starts on beat 3 (903) and the answer types out inside it at 1.6 → 1.92 | 867-974 |
| Caption hand-overs blinked (S6, S11) | A cue that follows another in the same shot keeps the card: the old lines drop out, the card eases to the new size, the new lines rise | 975, 1191, 2001 |
| Whooshes trailing their downbeats; the glint late | Each whoosh peaks on the frame before its window's downbeat (362, 866, 1514, 1874); the glint's onset is on the chord (2451), 4 dB quieter | sound |
| "AI" read as "Al" | +0.045em after the A wherever display type says "AI" | 147-290 |
| S1 did not read as overload | Cards (pull-request glyph, title bars, green/red diff stat; fill #18261f, bars #7d9387) drop in on the beats and pile up three rows deep; the reviewer (a pointer with a ring) opens the centre card, clears it, and another takes its place; "Reviewing them still" stays on, racked soft, to the cut; the lifted card lights to a light fill | 0-290 |
| The pointer hid the words it clicked | The disc is drawn 9/11 capture px right of and below its hotspot (an arrow's tip), at 70%, and has gone six frames after each click; the green ring marks the click point | every click |
| Product glitches shown sharp (raw backticks, "Exponential backoff The wait…", the S8 disclaimers) | Framed out or racked soft where the shot allows: S8 stops before the answer's heading and keeps "Sample · prewritten, no AI call" and "Demo replies are prewritten…" in the soft plane; S12's demo notice is soft. The maintainer comments in S13 (the subject) still show `retry.delay` as plain quotes: a product fix (known issues) | 1371-1442, 2091-2162 |
| S13: the practice item answered wrong and graded "Got it" | The capture answers it right ("4 seconds: 1 s doubled twice. Full jitter picks a random wait below that."); "Learn from what they actually said." runs through the practice and ends on "Next review in 3 days" | 2343-2437 |
| S11: the words never seen landing | The take frames the card over the description, so the summary is seen filling the description's opening on "Use my explanation" | 1947-2018 |
| Payoffs too small for a phone | The macros take the decisive lines from about 13 px to about 30 px type (M 2.1-2.6; measured on 1689: 48 px line pitch). 48 px type would need M 3-3.5, which the DPR-4 capture cannot hold sharp in the 4K master (known issues) | as above |
| No 4K master | Rendered (`npm run render:master`) and checked (`npm run check`, no `--web-only`) | below |
| Poster blurred | "vibe coding" resolves to sharp a beat after its rack (keeping its dim); the poster is frame 2640 of the complete card | poster.jpg |

**Not done, and why:**

- *New caption lines* ("Open-source PRs with an AI agent team." under the
  wordmark, a "Sample project · real UI · replies prewritten" lower third,
  captions for S4's plan or S11's checklist, "Days later, it comes back to
  practice."): VIDEO.md §3's caption list is binding; new copy is an owner
  decision. Within it, S13's caption now runs through the practice item,
  and "And what you didn't test." runs from the Testing insert through the
  checklist.
- *Product changes* (hide the fill controls under `capture=1` in the
  product, render inline code in maintainer comments, the sample answer's
  heading, label the checklist's sample GitHub facts as sample): outside
  this package's files (spec: `marketing/promo-video/**` only). The capture
  hides the fill controls itself; the rest are framed out where the shot
  allows and listed as known issues.
- *The site's video figure* (the music credit if the tier needs it; the
  `<track kind="captions">` that doubles the burned-in captions):
  `site/index.html` is outside this package; recorded in
  `MUSIC-LICENSE.md` and the known issues for the owner.
- *"on your own machine"* (S5) is VIDEO.md copy: kept; the owner decides.
- *The glint's sound*: kept quieter and on the chord; whether a softer
  tonal shimmer should replace the sparkle is for the owner's listen.

**Verdicts on the re-cut** (round-5 renders: MP4 14.55 MB, WebM 14.11 MB,
`npm run check` passes; banding on decoded frames, longest flat run on a
gradient, pass ≤ 120 px: light studio 18-40 px on 291 and 347 (levels
224-242), dark stage 26-27 px on 39 and 2554):

| Shot | Frames looked at | Verdict |
| --- | --- | --- |
| S1 Problem | 39, 73, 111, 145 | ok: the queue reads as pull requests piling up (glyph, title bars, diff stats; three rows by 145); the reviewer's ringed pointer on the open card, pinging; "Reviewing them still" racked soft through 145. |
| S2 Turn | 147, 149, 210, 219, 255, 273, 286, 289, 290 | ok: the question pulls in line by line ("AI" reads as A-I); the lifted card lights up and faces the viewer on the stop; the freeze; 287-290 dark on purpose. |
| S3 Rules first | 291, 293, 343, 345, 347, 360-470, 471-577 | ok: lights on, the wordmark crisp and full to 335, a faint trace on 343, the window's edge in frame on 345 (no empty white), landing on 363 with a short streak; the window separates from the darker studio along every edge; the rules push sharp, the caption over the soft section below them. |
| S4 Still yours | 579-650, 651-722 | ok: the crash cut lands on the settled facts; the push onto the green chips, the rest soft; the plan push ends on S5's framing. |
| S5 Legwork | 723-866 | ok: the same picture across the cut, the approve click on 759 (ring at the click point, the disc beside it), the plan folds and the board moves a beat apart; the caption over the soft lower board; the stepper and counters clear. |
| S6 Try first | 867-902, 903-974, 975-1010, 1011-1118 | ok: two beats of turn-to-face; the answer types inside the push at 1.9x; the macro on the reference and "Got it"; the example card. No fill link anywhere. |
| S7 Taste | 1119-1190, 1191-1226, 1227-1298 | ok: the window on the left, the caption on the studio at the right; the guess, "Show the alternative"; the macro on the three choices and "Keep this approach"; the why types and saves. The pointer crosses the soft paragraph for a few frames on its way to the choice. |
| S8 Ask | 1299-1370, 1371-1442 | ok: the caption top-left over soft code; the selection mid-frame with its bar sharp and "Explain this code" pressed on screen (1364); the question's diff block, then the rack down to the answer; the demo's "prewritten" lines soft; the answer's heading never in frame. |
| S9 Explain it back | 1443-1514, 1515-1586, 1587-1658, 1659-1694, 1695-1748 | ok: the dark title bar, "Before it ships," racked soft; lights on to the closed book, pushing in to the crash; the macro on the question answered and "Think so"; the reference and "Partly"; the settled result with the correction whole for 54 frames. |
| S10 Predict | 1749-1802, 1803-1874 | ok: the chips and "Tests", the forecast typing; the prediction line alone sharp. |
| S11 Your words | 1875-1946, 1947-2018, 2019-2090 | ok: the window from the left, the caption right; the summary seen landing in the description; the add on the caption change (2001); the checklist, every row OK. |
| S12 Send one | 2091-2162, 2163-2270 | ok: the dialog's checks and the click two frames before the crash; no frame of the dialog closing (scan); the published card in a macro from the crash. |
| S13 Learn | 2271-2342, 2343-2378, 2379-2437 | ok: the forecast beside the maintainers' comments, "Saw it coming"; days later the question, answered right, "Got it"; the macro ending on "Next review in 3 days". |
| S14 End | 2438, 2440, 2452, 2554, 2578, 2640 (poster), 2669 | ok: the cut on the measured hit with a soft logo; resolved on 2451 (decoded: still changing to 2451, step 0.49, then still); the move up, the headline, the whole call to action from 2541, "vibe coding" dim and sharp from 2559, held to 2657, black on the last frame. |

4K master (`out/bell-pr-promo-en-2160p.mp4`, rendered in 13 min at
concurrency 3): 85.83 MB, 3840x2160 at 30/1, -14.03 LUFS, true peak
-3.35 dBTP; `npm run check` (all three videos) passes. Full-resolution crops
of 408 (the floating window, M 0.93), 1623 (the question macro, M 2.4),
1839 (the prediction line, M 2.58) and 2217 (the published card, M 2.4):
the UI text is crisp; in the macros the 1.2-1.3x upsampling of the DPR-4
capture shows only as a slight softening of glyph edges at 100%.

Every frame (the 271 review frames and both scans over all 2670): no blank
or loading frame other than the four intended dark ones and the closing
fade; no jump inside a take; no caption card on sharp UI; no cropped
half-word at a frame edge in a sharp plane; no fill link; no double
exposure; no Apple fonts, devices, window buttons or "9:41"; no GitHub,
OpenAI or Anthropic logo; only the fictional sample.

### Round 6 (renders of 2026-10-18 21:50 and 22:22 and the 4K master): a second set of three reviews, verdicts (superseded by round 7)

Three reviewers looked at the round-5 cut again. Every high and medium
finding is fixed below, or explained where it would break the spec or an
owner decision; the cheap low ones are fixed too. The web files, poster,
captions and the 4K master were rendered again, the 276 review frames
were extracted and looked at, and the three checks (jumps inside a take,
UI against a caption card, the depth of field against the footage) ran
over every frame with no finding.

**Fixed** (the frames are the new cut's):

| Finding | Fix | Frames now |
| --- | --- | --- |
| S2: a dark smudge down the lifted card's right edge through the freeze (the next card's blur and shadow painted over it) | The lifted card is drawn after the whole queue, before the reviewer. Decoded 273: 229 across the card to its edge (it was 193 at the edge) | 219-286; 255, 273 at full size |
| S8: the answer unreadable, cut mid-sentence by the mask, 90% of the frame soft | S8 is three takes: the selection growing to lines 10-15 and "Explain this code" pressed (1299); a macro of the centred panel on the question's diff block, sharp for 36 frames (1335); then the answer's first paragraph, complete and sharp, held 72 frames at M 2.3-2.45 (1371-1442): "If many users fail and retry at the same moment, the server is flooded again. Spreading the retries out breaks that chain reaction." The paragraph under it (whose heading runs into its body, a product glitch) stays soft | 1299-1442; 1353, 1407 |
| WebM: VP9 at CRF 35 flattened the darkened light plate's grain (flat runs 543-649 px, contour rings) | The light plate's grain is ±2.5 LSB in 4x4 px cells (8x8 at 4K; it was ±2 in 2x2), the WebM renders at CRF 30, and it gets a keyframe on every cut where a stage plate first shows (`src/keyframes.ts`: the stage cuts and every take that opens on the studio, 16 in all; VP9 had coded 1515 and 1875 as inter frames and flattened the plate there, 425-490 px runs even at CRF 30). Decoded WebM, longest flat run on studio-only lines (pass ≤ 120 px): 300 and 330: 20-40 px, 1530: 32-75 px, 1890: 41-133 px (the 133 px run is in the moving window's shadow during the establishing turn, below); MP4: 10-33 px on all three | 300, 1530, 1890 |
| The depth of field read as a flat mask laid on in post: milky blur, visible boxes (1839: 255 against 251), half-veiled labels, mush at M 2-2.6 | The back plane is the same picture blurred 3.5 px on screen at every magnification (the blur shrinks in capture px as the camera pushes in; the 1/5-scale pre-blur grew with M) and is no longer veiled, so both planes have the same brightness and no rectangle shows. Each sharp plane is the whole component the shot is about (a card, a panel, the dialog's checks), each feather in a gutter of the UI, and `scripts/check-dof.mjs` (in `npm run review` and `npm test`) fails on any glyph in a feather. The windows keep their small tilts; a falloff that follows a tilt would cut text rows diagonally, which the no-half-word rule forbids | every push; 1839, 2307 at full size |
| S13 practice: the mask started in the sidebar ("ready", "PRO", "…aches" sharp) | The practice take is the whole card, sharp from capture x 264 with its feather in the gutter after the sidebar (242-264); a test asks every take with the sidebar in frame to keep every feather at x 240 or more | 2343-2437 |
| S7: "It depends" cut by the panel's sticky footer in the sharp macro | The keep take's sharp plane is the question and its first row of choices (626-690); "It depends" and the footer that cuts it are in the soft plane, the window's bottom edge 146-150 px above the frame's | 1227-1262 |
| S7: the trade-off never legible; the pointer over the soft paragraph | A new take, 2.4 s at M 2.0-2.1, on the revealed alternative, whole and sharp ("Another option is a fixed interval with a little random jitter … a fixed interval would be the better choice."), before the pointer moves; the guess take is two beats from late in its typing to "Show the alternative" | 1155-1226; 1191, 1209 |
| S12: the preview's last line half sharp and sliced by its scroll box | The sharp plane starts at y 582 (ramp 570-582 in the gap above "Before it reaches the maintainers"); the sliced line is wholly soft | 2091-2162; 2127 |
| Pushes on downbeat cuts eased with `drift` (zero velocity on the cut) | Every push that starts on a cut uses `arrive` (fast in, long settle), and so does every establishing turn; `drift` is kept for S5's moves inside its take. The sharp plane stays under 8 px a frame (the test; fastest now 7.2 px) | 471, 579, 651, 903, 975, 1011, 1119-1298, 1299-1442, 1587-1874, 1947-2090, 2091-2437 |
| S11: "And what you didn't test." over the maintainer checklist; S11's checklist showed the sample GitHub facts and "GitHub read … 1:35 AM" sharp, against "nothing was read from GitHub" in S3 and S4; the rows that close the story blurred | The takes are swapped: the checklist plays under "Your words. The project's rules." (1947-2018), held on the frame where the capture's scroll passes its last rows, "A reviewable change", "Disclosing AI help" with `CONTRIBUTING.md:9` and "Understanding check: You explained the change back", all OK and sharp; the header with its read times and the rows with the GitHub facts are out of frame. "And what you didn't test." starts with the cut to the "Your words in the PR" card (2019), whole and sharp, as "Add my not-tested answer to Testing" is pressed, ending on its "In the description" | 1947-2090; 1983, 2055 |
| S13: raw backticks sharp in the maintainers' comments, the subject of the take | The compare take frames "Your forecast: Tests" and "Changes requested" with the first comment's tags ("Tests", "Saw it coming") sharp, two planes; the comments' text is soft. The product fix (render inline code) is a known issue | 2271-2342; 2307 |
| S13: "Learn from what they actually said." over the practice item (your own check, not the maintainers) | The cue ends at 2343 (2.1 s); the practice item plays 3.2 s without a caption, on the Learning page's "Sample practice" header and the card's "From your understanding check", answered right, the reference, "What you had wrong last time" and "Next review in 3 days", the whole card sharp | 2280-2343, 2343-2437 |
| S10: the line take repeated the forecast, smaller, alone | The macro holds the check's result line and the saved prediction under it, both sharp | 1803-1874; 1839 |
| Pointer: a sharp disc over the soft plane far from any click; the ring outlasting the fold; the disc on a word | The disc shows at most 12 frames before its click and is gone six frames after; the ring lasts at most 8 frames, and where the UI replaces what was clicked (the plan folding at 761, a dialog closing, a layout shift: `scripts/pointer-spots.mjs` finds the frame) the ring ends there and the disc fades within two frames; its timings scale with the clip's rate; it fades out over 40 capture px beyond the sharp plane; and for each click the film shows, `scripts/pointer-spots.mjs` places the disc beside the hotspot where it covers no glyph before or after the click (two clicks in S6, on a dense chip row, cover a single edge pixel at best) | every click: 759, 952, 971, 1006, 1154, 1247, 1303, 1330, 1646, 1691, 1766, 2064, 2161 |
| A caption card widened while the old line was still on (469-471) | A kept card holds the old size while the old lines leave, then eases to the new size from the new cue's first frame, over 93% of the way there, as the new line rises (no frame of an empty card) | 471, 975, 1191, 2019 |
| Caption cards in three corners; 46 px type, about 11 px in a phone embed | Two positions only (bottom-left, top-left: S7, S8, S12), DM Sans at 56 px; the establishing windows rest slightly smaller and higher so the larger cards clear them | every cue |
| S14: 2.2 s of silent hold after the chord's tail | 0.8 s of hold, then the 12-frame fade: 88.0 s (inside 75-90 s); the complete call to action holds 2.9 s from 2541; the poster is frame 2610 | 2541-2639 |
| Frame 0 an empty dark stage (a black thumbnail) | The first line's focus pull and the front row's fade start as if four frames before the film: frame 0 shows them, soft | 0 |
| S6: after "Got it" the panel's sample notice slid under the sticky footer, sliced, for the take's last frames | The take holds at 6.13 s, as "Got it" is pressed, before the card collapses | 975-1010 |

**Not done, and why:**

- *The WebM during the establishing turns:* VP9 smooths the window's
  moving shadow (a CSS gradient over the plate) into one-level steps: flat
  runs up to 133 px at 1890 and 150-180 px inside the shadow on S11's turn
  (1875-1946), against 16-33 px in the MP4. No contour ring shows at
  viewing contrast; at 10x contrast the shadow's falloff shows steps. CRF
  27 only cut the worst run to 123-149 px for 17% more bits, so the WebM
  stays at CRF 30 (16.32 MB). Listing the MP4 first in `site/index.html`
  (outside this package) would serve the MP4 to every browser that plays
  it; for the owner.
- *S9 to S10 on beat 2 (1749):* cutting on the bar line at 1731 makes S9
  9.6 s, under its nominal 10 s (5 bars at 120 BPM; the 5/6 scaling the
  addendum allows also gives 10 s), and VIDEO.md's flex rule 2 says never
  to shorten S9 below nominal. Kept; whether 1749 lands on the snare is for
  the owner's listen.
- *S9's correction typing before the result (1692-1695):* the correction
  types at clip 10.8-11.7 s and the result follows a scroll at 12.9 s; one
  take cannot hold both without the scroll inside it. The result take keeps
  the one-line correction whole for 54 frames.
- *Product fixes* (render inline code in maintainer comments; a separator
  between the alternative's heading and body in the explanation; label the
  checklist's sample GitHub facts and read times as sample under
  `capture=1`): outside this package's files (spec: `marketing/promo-video/**`
  and `site/media/**` only). Each is framed out or held in the soft plane
  (S13's comments, S8's second paragraph, S11's header and GitHub rows) and
  listed in the known issues.
- *New copy* ("Agents do the legwork, / in your own worktrees."; "Days
  later, it comes back to practice."): VIDEO.md's captions are binding;
  owner decisions. S13's caption now ends where its subject ends.
- *The site's video figure* (the `<track kind="captions">` that doubles the
  burned-in captions, the WebM listed first, the music credit):
  `site/index.html` is outside this package; for the owner, with the credit
  in every platform description where the tier needs it
  (`MUSIC-LICENSE.md`).
- *Text at an establishing window's bottom edge (408):* that edge is the
  app viewport's own bottom, as in any window; the text there is about
  12 px in the whole-window picture and not a sharp-plane subject.
- *A pixel test for scroll-container edges:* `scripts/check-dof.mjs` checks
  frame and window edges; a scroll box's edge cannot be told from a card's
  border in the pixels, so those cases are handled by framing (S6, S7, S12)
  and by the look at every review frame.

**Verdicts on the round-6 cut** (renders: MP4 12.95 MB, WebM 16.32 MB,
`npm run check` passes; the three scans over all 2640 frames find nothing):

| Shot | Frames looked at | Verdict |
| --- | --- | --- |
| S1 Problem | 0, 39, 73, 111, 145 | ok: frame 0 shows the soft first line and the front row; the queue piles up three rows deep; the reviewer's ringed pointer on the open card. |
| S2 Turn | 147, 149, 210, 219, 255, 273, 286, 289, 290 | ok: the question pulls in line by line; the lifted card clean to its edges through the freeze (255, 273 at full size); 287-290 dark on purpose. |
| S3 Rules first | 291, 293, 343, 345, 347, 360-470, 471-577 | ok: lights on, the wordmark, the window rising in and landing on 363; the push on the whole rules card, its feather in the gap under the third rule, the caption over the soft "files read" line. |
| S4 Still yours | 579-650, 651-722 | ok: the crash cut on the settled facts, the "Before you start" box sharp; the plan card sharp, its feathers in the gaps above and below it. |
| S5 Legwork | 723-866 | ok: the approve click on 759, the ring and the disc gone as the plan folds (761); the plan folds, the board's columns sharp in two planes meeting in the gutter between "In progress" and "Done", the stepper and the run's card soft; the caption over the emptied columns' soft lower half. |
| S6 Try first | 867-902, 903-974, 975-1010, 1011-1118 | ok: the turn leaves the cut moving; the answer types inside the push; the reference and "Got it", held as it is pressed; the example card. |
| S7 Taste | 1119-1154, 1155-1226, 1227-1262, 1263-1298 | ok: the guess and "Show the alternative"; the alternative whole and sharp for 2.4 s under "Taste grows by weighing trade-offs."; "Keep this approach" pressed, "It depends" and the footer soft; the why types out and is saved. |
| S8 Ask | 1299-1334, 1335-1370, 1371-1442 | ok: the selection and "Explain this code"; the question's diff block sharp in a centred macro; the answer's first paragraph complete and sharp, held to the cut. |
| S9 Explain it back | 1443-1514, 1515-1586, 1587-1658, 1659-1694, 1695-1748 | ok: the dark title bar; lights on to the closed book; the question answered and "Think so"; the reference and "Partly"; the result with the correction. |
| S10 Predict | 1749-1802, 1803-1874 | ok: "Tests" and the forecast typing; the result line and the saved prediction, both sharp. |
| S11 Your words | 1875-1946, 1947-2018, 2019-2090 | ok: the window turning to face; the checklist's last rows, disclosure and understanding check OK, no GitHub fact or read time in frame; the words card with the not-tested answer going into the description under "And what you didn't test." |
| S12 Send one | 2091-2162, 2163-2270 | ok: the checks and the click before the crash, the preview's sliced line soft; the published card. |
| S13 Learn | 2271-2342, 2343-2437 | ok: the forecast and the maintainer's tags sharp, the comments soft; the practice card, whole, under the Learning page's header, without a caption. |
| S14 End | 2438, 2440, 2452, 2539, 2563, 2610 (poster), 2639 | ok: the soft logo on the measured hit, resolved on the chord; the complete card from 2541, held to 2627, black on the last frame. |

4K master (`out/bell-pr-promo-en-2160p.mp4`, rendered again in 13 min at
concurrency 3): 73.57 MB, 3840x2160 at 30/1, -14.03 LUFS, true peak
-3.35 dBTP; `npm run check` (all three videos) passes. Full-resolution
crops of 273 (the lifted card, clean to its edges), 1209 (the alternative
at M 2.1), 1407 (the answer at M 2.45), 1839 and 2307: the UI text is
crisp; in the macros the 1.2-1.3x upsampling of the DPR-4 capture shows
only as a slight softening of glyph edges at 100%.

Every frame (the 276 review frames and the scans over all 2640): no
blank or loading frame other than the four intended dark ones and the
closing fade; no jump inside a take; no caption card on sharp UI; no glyph
in a depth-of-field feather; no sharp line cut by a frame or window edge;
no fill link; no double exposure; no Apple fonts, devices, window buttons
or "9:41"; no GitHub, OpenAI or Anthropic logo; only the fictional sample.

### Round 7 (the 4K master of 2026-10-19 and the web files made from it): a third set of three reviews, verdicts

Three reviewers looked at the round-6 cut frame by frame again. Every high
and medium finding is fixed below, or explained where it would break the
spec or an owner decision; the cheap low ones are fixed too. The 4K master
was rendered again and the web files are now made from it; the review
frames were extracted and looked at, and the four checks (jumps inside a
take, UI against a caption card, empty caption cards, the lifts against
the footage) ran over every frame.

**Fixed** (the frames are the new cut's):

| Finding | Fix | Frames now |
| --- | --- | --- |
| The camera stopped dead after the first 20-40% of every take (`arrive` over 2-4 beats, no drift; held clip frames became stills) | Every camera is two parts (`src/takes.ts`): a move that leaves the cut moving and covers at most 60% of its travel in its first beat (`push`, bezier 0.4, 0.4, 0.7, 1: at the cut it moves at its average speed), and a linear drift through the whole take, +2% scale and 12 px a bar by default, on held frames too. A test asks every frame of every product take to move (at least 0.25 px at a frame corner or the centre; 0.1 for the floating windows, whose S9 wide is locked off on purpose) and every on-cut move to cover at most 60% in its first beat; the sharp plane still never moves faster than 8 px a frame. Decoded, the mean difference between frames 15 apart is now 2.4-10 levels where it was 0.01-0.3 (649: 3.5, 721: 4.4, 901: 9.7, 1116: 4.4, 1225: 5.3, 1441: 3.2, 2260: 4.9, 2420: 10.0) | every take, S3-S13 |
| The depth of field read as a blur box drawn on the flat page, and cut through cards (687 plan card, 828 task-4 card, 1983 "Your own words", 2307 the comments) | Depth of field is now a lift (`src/look/dof.ts`): the component the take is about is cropped on its own border (or, in a run of unbordered text, a gutter), 2.5% larger, with a soft layered shadow, while the rest of the window drops back, blurred 3.5 px on screen under a 25% veil of the studio's colour. The whole plan card, the board's four whole columns, every checklist row including "Your own words", the whole first maintainer comment. `scripts/check-dof.mjs` checks every third frame of every take that no lifted box crops a glyph (it checked only settled frames, so S5's sliding mask was never checked) | 651-722, 723-866, 1947-2018, 2271-2342 |
| S7 and S8: a dead slab of studio on the right third of the frame (x 1268-1920) | The right-hand panel pushes keep the window's edge 120 px inside the frame (6% of the width; `EDGE` in `src/shots.ts`), the panel centre-right, the diff soft on the left; S7's captions move bottom-left over the dropped-back page | 1119-1442 |
| S13 compare: the maintainer comments soft under "Learn from what they actually said."; "2. Please add a test for the exhausted case…" (the forecast coming true) unreadable; the empty lower left | "Your forecast: Tests" and the whole first comment are lifted together for a beat and a half (1.7x); then the forecast drops back and the camera pushes onto the comment, 2.11x on the out-cut: its header, "2. Please add a test for the exhausted case: after `maxRetries`, the last error should be thrown.", its "Tests" tag and "Saw it coming". The forecast and the comment together are 1047 capture px wide, too wide for one frame at 2x without splitting a card. The inline code stays as raw backticks (Markdown, as developers read it; the product's rendering is outside this package) | 2271-2342 |
| S5: the sharp rectangle slid across the board for five beats, cutting card titles and text | The plan card is lifted until it folds (763, the click on 759); the board's four columns come forward together over 15 frames (a test fails any rack outside 12-18 frames), then hold while the camera eases to the whole board and drifts; the caption starts once they are forward (777), top-left over the dropped-back stepper | 723-866 |
| The film never said what BELL PR is | Under the first-hit wordmark, the product's own published description: "A learning workbench for AI-assisted open-source contributions." (`site/index.html`'s description, so no new positioning; a test keeps it the site's words), 44 px, leaving with the wordmark. Owner sign-off. README.md gives the text to lead every platform description with | 291-344 |
| S9 climax: the crash landed on a near-black frame; the line unreadable until 1447 | The focus pull is pre-rolled six frames (on 1443 the line is 90% of the way, about 2 px of blur, and reads at full size) and the line settles from 1.05 over nine frames on the crash; 104 px (a step above the opening's 88 px) | 1443-1452 |
| Lights on: 45 frames of a still slide | The lockup pushes linearly 1.00 to 1.04 over 291-344; the studio flares about 6 levels brighter on 291 (decoded frame mean 238.2 on 291, 233.3 from 294) and settles by 297; the wordmark crisp on 291. Every frame of the flare (291-297) is a WebM keyframe: coded over the frame before, VP9 had lost the plate's grain under the fading wash (flat runs of 168-672 px at 292-300; now 65-122) | 291-344 |
| S9 to S10 on beat 2 of bar 25 (1749) | S9's nominal is counted in the track's own bars (5 bars at 120 BPM are 4.17 here, rounded to the half-bar grid: 4 bars, 9.6 s), so S10 starts on the bar-25 downbeat (1731) with its two bars; the test that proved 1749 the only legal beat now checks the bar-line cut | 1731 |
| S13 practice: 3.2 s of a dense card, the camera dead, "Next review in 3 days" about 18 px in a corner | The whole card for two beats, then a second key pushes down to 1.94x onto the reference, "What you had wrong last time" and "Next review in 3 days", still drifting into the end card's cut | 2343-2437 |
| The web MP4 at CRF 24 from a 1x render: 979 kb/s, measurably softer than the master | The web files are made from the 4K master (`scripts/web-from-master.mjs`): a Lanczos downscale, x264 slow at CRF 21 (17.26 MB; it was 12.95 MB at 979 kb/s of video), VP9 at CRF 30 with the stage-cut keyframes (14.65 MB). Against the master scaled to 1080p, the web MP4 is now within 1.6-15.7% of its Laplacian energy (940, 1407, 1990, 2307, 2420) at a PSNR of 44.6-47.3 dB (it was 23-30% less and 34-36 dB) | every frame |
| S12: 3.6 s of a near-static card on the most energetic bars; "Then stay for the review" had no picture | The published card holds one bar from the crash, then on bar 32 the draft waiting for the review (`v-forecast-vs-reality` before reading): "Maintainer feedback" with "Read feedback" and the saved forecast beside the empty "What the maintainers said"; "Read feedback" is pressed four frames before the cut to what they said | 2163-2270 |
| S9: the person's explanation typed only inside the whole-window turn, about 13 px | A locked-off wide for two beats (the summary still empty), then a push onto "1. Explain" as the summary types (the clip delayed and run at 1.2x), lifted, landing at 1.98x on the 1587 crash | 1515-1586 |
| S4's chips about 20 px | A macro at 2.32-2.4x on the whole "Before you start" box, both chip rows | 579-650 |
| The end-card logo 95% resolved by 2447; the sweep visible only on the green bell, peaking 9 frames after the chord | The logo pulls in on one accelerating curve: every frame changes more than the one before, the last fifth of the resolve comes on the two frames that end on the chord, the settle from 1.02 on the last three, and the chord frame (2451) carries the largest change of the whole pull (a test; decoded: steps of 1.7, 2.4, 2.5, 3.6 and 5.0 levels over 2447-2451, then 0.07), then it is still; the sweep is gone (on the near-white wordmark it could not be seen) | 2438-2451 |
| All four sections opened with the same move | S3 rises from below; S6 comes in from the left, turning the other way; S9 is a locked-off wide, then the push; S11 pulls back from close on the draft to the whole window | 345, 867, 1515, 1875 |
| S1/S2: middle-row cards overlapping, a diff stat between two front cards | Each row sits wholly above the one in front of it on a fixed grid | 0-290 |
| "AI made" read "A Imade" | +0.02em after the A, the space after "AI" 0.1em wider, display lines' word spaces +0.06em | 147-290, 291-344 |
| Text under the translucent sticky header beside the sharp plane (1155, 1407) | S7's alternative is framed below the header (its top edge in the gap under it, the zoom drifting about that edge); in S8's answer the header and the line under it are on the dropped-back page, under the veil, away from the lifted paragraph | 1155-1226, 1371-1442 |
| Window roll and yaw sloping long lines in the macros | Every push is flat (a test: no tilt once the camera is at 1.4x or closer); only the floating windows tilt | every push |
| The caption card showed empty for a frame (382, 589, 742, 2281) | A new card's lines rise with the card from its first frame; `npm run review` fails on a card that shows without its text on its second frame | every cue |
| Text sliced by the window's bottom edge (408, 1890) | Each floating window ends in a gutter shared by the sidebar and the page (S3 at capture y 783, S6 and S9 at 802, S11 at 790); `scripts/check-dof.mjs` checks it | 345-470, 867-902, 1515-1586, 1875-1946 |
| `npx bell-pr` at 44 px | 60 px, its line at 32 px | 2523-2627 |
| The click ring on glyphs (2064-2068) | The ring grows round the disc (it was round the hotspot, on the label clicked), and pointer-spots.mjs weighs the glyphs under it | every click |
| S11: "Your own words" the one soft row under "Your words." | Every row lifted, "Your own words" (OK) included | 1947-2018 |

**Not done, and why:**

- *"Agents do the legwork, on your own machine." and "Runs on your
  machine"*: VIDEO.md's caption and the end card's line are binding copy;
  the owner decides ("in your own worktrees" is the reviewers'
  suggestion). README.md's platform text names the person's own Codex or
  Claude Code CLI and account, as AGENTS.md rule 10 words it.
- *"Days later, it comes back to practice."*: new caption copy, an owner
  decision; the practice beat is now legible on its own (the push to the
  reference, what you had wrong and "Next review in 3 days").
- *The approve click's disc on the button and a pressed state*: the
  button's text fills it (no flat area the disc fits in), and a drawn
  pressed state would be UI the product did not show; the disc sits
  beside the button, off its text, and has gone as the plan folds.
- *Inline code in maintainer comments, the site's video figure (MP4 first,
  the music credit)*: outside this package's files (spec:
  `marketing/promo-video/**` and `site/media/**`); for the owner. The
  WebM is now made from the master too.
- *The music grid by ear*: `"reviewed": false` until the owner listens.

**Verdicts on the round-7 cut** (the 4K master and the web files made
from it: MP4 17.26 MB, WebM 14.65 MB, `npm run check` passes; the four scans
over all 2640 frames find nothing):

| Shot | Frames looked at | Verdict |
| --- | --- | --- |
| S1 Problem | 0, 39, 73, 111, 145 | ok: the queue in three clean rows, each wholly above the one in front; no card in pieces between front cards; the reviewer's ringed pointer on the open card. |
| S2 Turn | 147, 149, 210, 219, 255, 273, 286, 289, 290 | ok: "What if AI made you better," reads A-I with the space after it the wider one; the lifted card through the freeze; 287-290 dark on purpose. |
| S3 Rules first | 291, 293, 318, 343, 345, 347, 360-470, 471-577 | ok: lights on with the wordmark crisp and the product's own description under it, the flare settling by 297, the lockup still pushing on 343; the window rises in, its bottom in the gutter under "Pull requests: open to you"; the three quoted rules lifted, each on its own border, the headings and the card round them dropped back, the caption over the dropped-back "Files BELL PR read". |
| S4 Still yours | 579-650, 651-722 | ok: the crash on the "Before you start" box at 2.3-2.4x, both chip rows at about 30 px, lifted; the whole plan card lifted, "Send back with feedback" and its box inside it. |
| S5 Legwork | 723-866 | ok: the plan card lifted, the approve click on 759, the fold on 763 and the four columns coming forward together over 15 frames as the camera eases to the whole board; task cards whole in their columns at every frame; the caption top-left from 777 over the dropped-back stepper and run card. |
| S6 Try first | 867-902, 903-974, 975-1010, 1011-1118 | ok: the window in from the left, turning the other way from S3, its bottom in a gutter; the quiz card lifted while the answer types, "Think so", Show answer; the reference and "Got it"; the example card, the panel centre-right with 120 px of studio. |
| S7 Taste | 1119-1154, 1155-1226, 1227-1262, 1263-1298 | ok: the guess card, "Show the alternative"; the alternative whole and lifted at 2.4x, the frame's top in the gap under the sticky header; "For this project, which would you choose?" with its first row lifted, "Keep this approach" pressed, the window's edge over the studio clear of the caption card; the why types and saves. No slab of studio: 120 px at the right. |
| S8 Ask | 1299-1334, 1335-1370, 1371-1442 | ok: the selected lines and the selection bar lifted, "Explain this code" pressed; the question's diff block in a macro; the answer's first paragraph lifted, held with the camera drifting, the sticky header and the line under it dropped back. |
| S9 Explain it back | 1443-1514, 1515-1586, 1587-1658, 1659-1694, 1695-1730 | ok: the crash frame already reads (104 px, about 2 px of blur on 1443, settling from 1.05), "Before it ships," racking soft on beat 3 (1479); lights on to the locked-off wide with the summary still empty, then the push onto "1. Explain" as the summary types, 2x on the 1587 crash; the question answered and "Think so"; the reference and "Partly"; the result with the correction. |
| S10 Predict | 1731-1802, 1803-1874 | ok: from the bar-25 downbeat, "Tests" picked and the forecast typing; the result line and the saved prediction lifted. |
| S11 Your words | 1875-1946, 1947-2018, 2019-2090 | ok: the pull-back reveal from close on the draft to the whole window, its bottom in a gutter, in the calm bars; four checklist rows lifted, "Your own words" (OK) first, under "Your words. The project's rules."; the words card whole under "And what you didn't test.". |
| S12 Send one | 2091-2162, 2163-2234, 2235-2270 | ok: the dialog's checks and "Open the sample Draft PR" lifted, the preview dropped back; the published card for a bar from the crash; the draft waiting for the review, "Maintainer feedback" and "Read feedback" lifted with the saved forecast, "Read feedback" pressed just before the cut. |
| S13 Learn | 2271-2342, 2343-2437 | ok: the forecast and the whole first comment lifted together, then the forecast drops back as the camera pushes onto the comment, "2. Please add a test for the exhausted case …" and "Saw it coming" at 2.1x on the out-cut; the practice card whole for two beats, then the push down to "What you had wrong last time" and "Next review in 3 days", still moving into the cut. |
| S14 End | 2438, 2440, 2444-2452, 2539, 2563, 2610 (poster), 2639 | ok: the soft logo on the measured hit, the accelerating pull locking on the chord (2451) with the largest step there, then still; the complete card with `npx bell-pr` at 60 px from 2541, held to 2627; black on the last frame. |

4K master (`out/bell-pr-promo-en-2160p.mp4`, rendered in 13 min at
concurrency 3): 82.03 MB, 3840x2160 at 30/1, -14.03 LUFS, true peak
-3.35 dBTP; `npm run check` (all three videos) passes. Full-resolution
crops of 1983 (the checklist rows), 2330 (the maintainer comment) and 2420 (the practice card): the lifted UI text is crisp, the shadow under each lift
soft and even; in the macros the 1.2-1.3x upsampling of the DPR-4 capture
shows only as a slight softening of glyph edges at 100%.

Banding on decoded frames (longest flat run on studio-only rows, pass
≤ 120 px): MP4 light studio 24-56 px (292, 295, 300, 330, 1530, 1890), dark stage 42-51 px (39, 2554); WebM light studio 53-122 px (the flare frames 291-297 at 65-122, 330 at 70, 1530 at 53, 1890 at 121, the last in the moving window's shadow during the establishing move, as in round 6), dark stage 57-84 px. The flat runs of 420-435 px at 400 (both files) are
inside the caption's light pool (a near-white CSS gradient under the
frosted card, unchanged since round 1); no contour shows at viewing
contrast.

Every frame (the 276 review frames and the scans over all 2640): no
blank or loading frame other than the four intended dark ones and the
closing fade; no jump inside a take; no caption card on a lifted
component, none shown empty; no lift cropping a glyph; no lifted line cut
by a frame or window edge; no dead third of studio; no fill link; no
double exposure; no Apple fonts, devices, window buttons or "9:41"; no
GitHub, OpenAI or Anthropic logo; only the fictional sample.

### Round 8 (the clean rebuild of 2026-10-19): a capture that repeats the reviewed film

From a clean state (`node_modules` and `out/` removed, the MP3 in place),
`npm ci`, `npm run build` (the capture of all 13 states, assets, hit, the 4K
master, the web files, check) and `npm run check` exit 0, and so do
`npm test` (65 tests, the depth-of-field check against the new footage
included) and `npm run review` (no finding in the four scans over all 2640
frames).

**Found:** the first clean rebuild filmed `v-line-ask` with its answer 0.1 s
late (the "answer" mark at 4.333 s instead of 4.233 s, 197 frames instead of
194), so S8's answer take (1371-1442), which held clip time 4.27 s, showed
the question's diff block lifted instead of the answer's first paragraph.
`npm run check`, `npm test` and the scans passed (a tidy but wrong
component is nothing they look for); looking at frame 1407 of the 4K master
caught it. Two things in that state do not run on the page clock:

- the demo's prewritten answer waits a random 300-899 ms before it types
  (the product's `answerTyping` calls `Math.random`);
- when the reply finishes, the chat's `scrollIntoView({ behavior: "smooth" })`
  runs on Chrome's real-time clock, so clip frame 128 caught it at a
  different position on each capture (three captures with the same pause:
  two of them 1.6 levels off the reviewed frame on average, the text up to
  15 px lower).

**Fixed** (b430e09, 0581cf3): the capture pins the pause at 560 ms (a queued
`Math.random` value; it fails if the answer did not take it), so the answer
types from clip frame 92 as before, after the frames the question take
shows; and once the reply has settled it tweens the chat back 57 px on the
page clock, to the position the take was framed on, and marks "reread"
(6.967 s). The answer take holds 6.97 s. The reread frame is pixel-identical
to the reviewed frame 128 (mean and largest difference 0).

**The second clean rebuild against the reviewed film:**

- footage: `v-plan`, `v-board`, `v-quiz-attempt`, `v-road-choice`,
  `v-check`, `v-forecast`, `v-draft-your-words` and
  `v-forecast-vs-reality` byte-identical to the footage rounds 5-7 were
  reviewed on; `v-rules-card` and `v-publish` within 1-7 levels; in
  `v-before-you-start` only clip frames 26-30 differ, a transition caught at
  other moments, before the 2.55 s the film starts that clip from;
  `v-practice` differs in its JPEG bytes, with no difference in the film
  (below);
- the web MP4 against the round-7 web MP4, every frame decoded (480x270
  luma): 0.022 levels apart on average; above 0.05 only on 830-902 (at most
  0.37: render noise of at most 13 levels on a few dozen pixels in S5's last
  beat and S6's floating window) and 1227-1442 (at most 0.71, on 1333: in
  S8's select take the dropped-back chat behind the selection, blurred under
  the veil, where the scroll after "Explain this code", clip frames 76-78,
  still lands a few px apart from capture to capture); S13's practice card
  under 0.05; the poster and the captions file byte-identical;
- the two clean rebuilds' 4K masters: 13 of 14 frames sampled in both
  bit-identical, the 14th S8's answer (1407), the fix.

**4K master, looked at in full** (12 frames, whole and in native-resolution
crops): 39, 291, 400, 649, 828, 1011, 1155, 1407, 1623, 1983, 2330, 2610.
The wordmark and the lifted text in pushes are crisp (291, 1407, 1983);
the macro on the chips (649) and the push onto the maintainer's comment
(2330) show the known slight softening of glyph edges where the 4K master
upsamples the DPR-4 capture; the end card's type and grain are clean; no smear, ghosting, cropped UI, empty frame or caption on
a subject. Banding (STYLE-GUIDE B.7, longest flat run on studio-only
regions, in 4K px, pass at most 240): dark stage 41-48 (39, 2554, 2610),
light studio 26-54 (291 top and bottom, 400, 1530).

### Round 9 (2026-10-19): the owner's feedback on the round-8 cut

The owner, on the round-8 cut: the BELL PR bell should fly **smoothly** at
the transition onto the next shot's demo screen, and on the final card
`npx bell-pr` should be on a line of its own ("otherwise it looks messy").
Nothing else in the film changes: every shot, take, caption and sound
cue keeps its frames except S3's internal timing below (the logo take now
ends on beat 3 of bar 5, 327, where the window's take starts; S3's cuts,
the caption at 381 and the bar-6 downbeat whoosh are where they were).

**The bell's flight** (`src/bell.ts`, `src/look/BellFlight.tsx`;
`src/scenes/BrandHit.tsx` now draws the lockup's name and descriptor
without the bell):

| Frames | What happens |
| --- | --- |
| 291-326 | The lockup as before: lights on, the six-frame flare, the slow push (the reviewed rate, 1.00 to 1.04 in 53 frames), readable whole for 1.2 s. The name and the descriptor are the reviewed cut's own column and wordmark image, clipped to the name; the bell is drawn on its own in the wordmark's place, on the same push. In the 4K master, like for like against round 8's (frames 291, 300, 320): name and descriptor within 0.01 px, the bell within 0.1 px. |
| 327 | Beat 3 of bar 5: the bell lifts off. |
| 327-333 | "BELL PR" and the descriptor dissolve (69% on 330, 10% on 332, gone on 333-334; a little blur and lift). |
| 331-340 | The window (`v-rules-card` overview) fades in under the flying bell (4% on 332, 50% on 335, whole on 340, before mid-flight), rising from 640 px below its landing place and turning towards the viewer (17°/-23° to 9°/-14°); its top edge stays under the bell's place in the lockup until the bell has left it (336) and under the descriptor until the descriptor has gone; it settles by 359, so the bell docks into a window at rest. |
| 327-363 | The flight: one quadratic arc from the lockup to the app's own bell, bowed 10% of its length to the lower left with its bend a quarter of the way towards the landing (`ARC`, `SKEW`), so the bell leaves its name moving left and up and comes into the window's sidebar from the left, never across the app's "BELL PR"; eased in and out (`ease.flight`, a cubic Bezier 0.3/0/0.2/1, zero speed at both ends, no overshoot), peak 30.5 px a frame; its size and its tilt on the same eased curve (from 141 px wide to the app's 18.5 px, from flat to the window's tilt). A crisp vector the whole way: the brand path as inline SVG laid out at its on-screen size each frame, no motion blur. |
| 363 | The bar-6 downbeat (the whoosh peaks on 362): the bell is on the app's own bell. |
| 363-381 | A beat's hold. On 363 the patch that hid the footage's bell during the flight gives way to the same paper carried under the flying bell; 365-375 the flying bell and its paper fade out together, a per-pixel cross-dissolve from the vector to the footage. |
| 381-435 | The window turns to face the viewer and settles at rest as the caption comes in (381); the light sweep on 435, as before. |

How the landing point is found and hit: `scripts/measure-bell.mjs` finds
the app's bell in the capture by its moments (the brand green's coverage
over the sidebar's paper against the brand path's own area and centroid):
its 64-unit box at (23.258, 30.572) capture px, 29.971 px square; the
sidebar's CSS puts it at (23.25, 30.5), 30 px (27 px in, 30 px high,
centred in the 35 px brand row): 0.07 px apart, which `scripts/bell.test.mjs`
holds to 0.1. The film uses the CSS box. The flying bell is then drawn
through the window's own transform: from the landing on, its centre is
the app's bell's centre in the stage's 3D space (`place()` in
`src/look/camera.ts`, the window's CSS transform applied to that point),
with the window's tilt and scale and the same perspective, so the two are
one shape on screen. During the flight the arc ends on that point and the
window's last few px of travel are taken up as the bell arrives (t^6), so
the meeting is exact on every frame without the window's rise bending the
arc. `src/bell.test.ts` checks every point of the outline within 0.01 px
from the landing to the end of the hold.

**Found and fixed while making it** (stills of every frame 317-391,
looked at whole and in 2-8x crops round the bell):

| Found | Fix |
| --- | --- |
| Interpolated in log space, the bell's size halved in five frames and it reached the window as a 20 px dot that drifted for 20 frames | the size runs linear on the same eased curve: it reads as the logo until the window is there, then comes down to the app's size as it docks |
| A window rising from wholly below the frame needed 100 px a frame and, still far below when the bell was half way, bent its arc into a dip (y 436, 397, then 406) | the window fades in from 330 as it rises 640 px and settles by 359; the arc is aimed at the landing point itself, the window's remaining travel added as t^6 |
| Bowed up and to the right, the arc brought the bell into its place from the right, across the app's "BELL PR" (frames 349-357 in 2x crops) | bowed to the lower left, it comes in from the left; a test checks the bell's box against the projected name and "WORKSPACE" on every frame |
| The first hand-off faded the patch out under the bell, then the bell: for a few frames both bells showed and their union read 7% heavier | a true cross-dissolve (the flying bell carries the paper): the film's bell stays within 0.11 px and 0.6% of the app's on every frame |
| Laid out afresh (absolute positions tuned on 1x stills), the lockup sat 0.5 px (wordmark) and 1.0 px (descriptor) higher than round 8's in the 4K master: Chrome puts replaced boxes and text on the device pixel, which differs at the master's 2x | BrandHit keeps the reviewed cut's own column and wordmark image (clipped to the name, the mark drawn by BellFlight at the box's drawn top, 348); in the master, like for like, name and descriptor now match round 8 to 0.01 px and the bell to 0.1 px. The end card's footer likewise keeps line-height normal (0.00 px) |

**The end card** (`src/scenes/endCardLayout.ts`): `npx bell-pr` alone on
its line, centred, IBM Plex Mono 500 at 60 px in mint, its baseline at 772
(87 px clear under the headline on the rendered card); "Free to start ·
Runs on your machine" on its own line under it, DM Sans 500 at 30 px in the
secondary green, baseline 838 (33-34 px clear); the non-affiliation line at
the foot where it was (132 px clear). Logo, headline and its focus
treatment, the footer and the logo's landing on the chord (2451) are as
before. Each line is placed by its baseline from the fonts' own metrics, so
the test and the pixel check agree with the render.

**Renders and checks** (the 4K master of 2026-10-19 and the web files
made from it; the round-8 files kept aside for the comparison):

- `npm run check`: every check passes. 88.021 s (MP4s) / 88.029 s (WebM);
  MP4 17.32 MB, WebM 14.71 MB, 4K master 81.95 MB; -14.12 / -14.02 /
  -14.03 LUFS, true peak -2.49 / -3.05 / -3.35 dBTP; poster 124 KB; the 20
  caption cues; the final hit at 2438; the end-card logo locking on 2451
  (-0.018 s from the chord). The sound is unchanged (the S3 whoosh still
  peaks on 362, now the frame before the bell lands).
- `npm test`: 77 tests pass (65 before; the bell's flight, the end card's
  lines, the lockup's new timing, the bell's box against the capture);
  `npm run typecheck` passes.
- `npm run review`: 278 frames and the contact sheet; the per-frame scans
  over all 2640 frames found nothing (`out/review/scans.tsv` is empty).
- `npm run moments` (`out/review/moments.tsv`, and `--scale=2` on the 4K
  master's pixels, `moments@4k.tsv`): the flying bell against the app's own
  bell, every frame 363-374: centres 0.02-0.12 px apart (4K: 0.03-0.06),
  sizes within 0.8% (4K: 0.4%); the film's bell through the cross-dissolve
  within 0.09 px and 0.8% of the app's bell on every frame 363-375 (no
  jump; the mean level difference round the bell, vector against footage
  raster, 4.5 at 363, blended to 0 by 375); after it, the film is the
  footage (0.000). The complete end card: six rows of ink, the command
  87 px under the headline, the facts 33-34 px under the command, the
  footer 132 px under the facts; command and facts centred within 1.5 px.
- The new web MP4 against round 8's, every frame decoded (480x270 luma):
  frames above 0.5 levels apart only in 329-470 (the flight, the window's
  new entrance and turn) and 2525-2634 (the call to action); everywhere
  else 0.009 levels on average (at most 0.49, on 292: encoder noise on the
  flare's keyframe). The lockup (291-326) and S3's push (471-578) are
  unchanged; in the 4K masters, like for like, the lockup's name and
  descriptor are within 0.01 px of round 8's and its bell within 0.1 px;
  the end card's logo, headline and footer within 0.12 px.

**Verdicts** (looked at whole and in 1.6-8x crops: every frame 310-395 and
every 6th of the end card from the web MP4, the 4K stills of the landing,
the contact sheet; `bell-pr-product-assets/film-rerun/v2/frames/` holds
the labelled sheets):

| Moment | Frames | Verdict |
| --- | --- | --- |
| The lockup | 291-326 | ok: as round 8 (lights on, flare, push, the descriptor), readable for 1.2 s. |
| Lift-off | 327-334 | ok: the bell leaves its name moving up and to the left; "BELL PR" and the descriptor blur out behind it; at no frame is the frame studio and bell alone (the window is coming in under the name's last 10%). |
| The flight | 335-362 | ok: one smooth arc, fast out of the lockup (peak 30.5 px a frame, 334-335), slowing all the way in; a crisp vector at every size (141 px to 18.5 px), no smear or doubling; the window is whole from 340 and settled by 359; the bell crosses the window's left edge on 345-347 and comes in from the left, never over "BELL PR", "FREE", "BETA" or "WORKSPACE". |
| The landing | 363 | ok: on the bar-6 downbeat the bell sits on the app's bell, one shape at 8x. |
| Hold and hand-off | 363-381 | ok: no visible change while the vector gives way to the footage (365-375); the eye has a beat with the logo in the app before the turn and the caption (381). |
| The turn | 381-470 | ok: as before, a little shorter (from a nearer, less tilted landing framing): the window turns to rest by 435, the light sweep, whole window for 130 frames. |
| End card | 2438-2639 | ok: the logo pull and lock on 2451, the headline and its rack as before; on 2523-2541 `npx bell-pr` and, under it, "Free to start · Runs on your machine" rise in with the footer; the complete card (2541-2627) reads in three groups (logo; headline; command with its subline) with the footer at the foot; nothing crowded; the fade. |


### Round 10 (2026-10-19): the owner's feedback on the pointer

The owner, on the round-9 cut (translated): "In the current cut the cursor
doesn't seem to click where it should, and sometimes it suddenly
disappears." Both were so. Measured on the round-9 cut (its pointer model
replayed frame by frame with its depth-of-field fade, and its frames):

**Found: off target.** The disc was drawn beside its hotspot, at the offset
`scripts/pointer-spots.mjs` chose to keep it off every glyph (9-40 capture
px right and down), and the click's ring was drawn round the disc. At 12 of
the 14 presses the film showed, the disc sat outside the control it pressed,
35-79 px from the point clicked: on "Approve the plan and start
development" (759) it sat 74 px away, on the dotted rule under the button;
on "Open the sample Draft PR" (2162), 79 px. The position itself followed
the window's transform and the lift exactly; the offset was the miss.

**Found: vanishing.** It came in at most 12 frames before a click (over 6
frames) and was gone 4-6 frames after it, within 2 frames where the UI
answered the click; it was faded with the depth of field, so it jumped in as
it crossed into a lifted component; and five takes cut 1-5 frames after a
press with it on. Every abrupt appearance and disappearance of the round-9
cut, and what happens there now:

| Round 9 | What happened | Now |
| --- | --- | --- |
| S5 761-763 | gone 2-4 frames after "Approve" (1.0, 0.8, 0.3, 0) as the plan folds | stays on the click through the fold (in the plan's plane, held as at the press), 0.5 s, fades out 774-786 |
| S6 954-956 | gone 3-5 frames after "Think so" (0.7, 0.2, 0) | stays and travels on to "Show answer" (948-958) |
| S6 971 | back at full on the "Show answer" press (0 to 1), cut 4 frames later | on since 921, pressed at 960, 15 frames to the cut |
| S6 1006 | in at full on the "Got it" press (0 to 1), cut 5 frames later | fades in from the cut (975-987) above the card, pressed at 996, 15 frames to the cut |
| S7 1146-1147 | jumps in as it crosses into the lifted card (0.25 to 0.90); cut 1 frame after "Show the alternative" | fades in at rest on the card (1119-1131), pressed at 1139, 16 frames to the cut |
| S7 1248-1251 | in at full on the "Keep this approach" press, gone 3 frames later | fades in at rest above the row (1227-1239), pressed at 1248, 15 frames to the cut |
| S8 1299 | on at full on the cut-in, travelling | fades in from the cut (1299-1311) at rest |
| S8 1305-1308 | gone 2-5 frames after the line-15 click | that click is now just before the take (the take opens on lines 10-15 selected) |
| S8 1319-1324 | jumps in into the lifted selection bar (0.54 to 0.91); cut 5 frames after "Explain this code" at 0.34 | pressed at 1320, 15 frames to the cut |
| S9 1641-1652 | jumps in (0.21 to 0.75); gone 2-6 frames after "Think so" | fades in at rest (1623-1635), pressed at 1647, on to the cut 12 frames later |
| S9 1684-1694 | jumps in (0 to 0.42 to 0.88); cut 4 frames after "Partly", mid-fade | fades in from the cut (1659-1671), pressed at 1680, 15 frames to the cut |
| S10 1745-1760 | jumps in (0.26 to 0.72); gone 2-6 frames after "Tests" | fades in (1731-1743), pressed at 1754, stays to 1769, fades out by 1781 |
| S11 2066-2070 | gone 2-6 frames after "Add my not-tested answer to Testing" | stays on the click (now "In the description") to 2079, fades out to the cut |
| S12 2162 | cut 1 frame after "Open the sample Draft PR" | pressed on the beat before the crash (2145), 18 frames to the cut |
| S12 2267-2270 | cut 4 frames after "Read feedback", mid-fade | pressed at 2256, 15 frames to the cut |

**Fixed** (`src/look/pointer.ts`, `src/look/ProductWindow.tsx`,
`src/scenes/ProductShot.tsx`):

- **On target.** The pointer is a neutral ring (24 px: a white ring between
  two ink hairlines round a 16% ink tint, a round shadow; STYLE-GUIDE §5.5,
  no OS or Apple arrow) whose centre is its hotspot, and at every press the
  hotspot is the capture's own click point. The click's ring spreads from
  that point (24 to 60 px over 14 frames). It is drawn inside the window's
  own transform, so camera, drift and tilt carry it like the footage, and
  the lifted component that holds its target carries it (the same scale
  about the same centre as the footage's lifted layer) from its first frame
  to its last, so it never jumps as it crosses a lift's edge; after a press
  it keeps the plane as it was at the press, so a lift that ends (the plan
  that folds) does not move it.
- **No pop.** Per click, in film frames (a slowed or held clip keeps the
  rhythm): it fades in over 12 frames at rest just outside what it clicks
  (160 px out on screen and 40 px clear of the target's box, towards where
  the capture's pointer came from), starting 6 frames before it moves;
  travels on one eased path (the capture's move, 12-18 frames); settles on
  the click point 2 frames before the press; presses; stays 15 frames
  (0.5 s); fades out over 12 frames. A click that follows soon after keeps it
  on screen: it travels from the click before (S6's "Think so" to "Show
  answer"). The depth of field no longer fades it.
- **No cut on a click.** Seven takes now start or hold their clip so every
  press is 12 frames or more before the take's cut (cuts, captions, music,
  the bell's flight and the end card are unchanged):

| Take | Clip was | Clip now | Press, frames to the cut |
| --- | --- | --- | --- |
| S6 answer | 1.20 s, held at 4.08 s | 1.66 s, held at 4.08 s ("Show answer" pressed, the frame before the reveal replaces the card) | "Think so" 952 to 941; "Show answer" 971 to 960, 4 to 15 |
| S6 reveal | 5.05 s, held at 6.13 s | 5.367 s, held at 6.13 s | "Got it" 1006 to 996, 5 to 15 |
| S7 guess | 1.75 s, held at 3.18 s | 2.37 s (the guess typed), held at 3.18 s | "Show the alternative" 1154 to 1139, 1 to 16 |
| S8 select | 1.45 s | 1.767 s (lines 10-15 already selected) | "Explain this code" 1330 to 1320, 5 to 15 |
| S9 partly | 8.75 s | 9.10 s, held at 10.17 s (before the scroll to the correction) | "Partly" 1691 to 1680, 4 to 15 |
| S12 dialog | 2.30 s | 2.642 s, held at 3.80 s (pressed, before the dialog closes) | "Open the sample Draft PR" 2162 to 2145 (the beat before the crash), 1 to 18 |
| S12 waiting | 0 s | 0.275 s, held at 1.00 s (before the page scrolls) | "Read feedback" 2267 to 2256, 4 to 15; the first comment now comes in beside the forecast before the cut |

  The UI tick of each click moves with it (`src/sfx.ts` places it from the
  footage); S8's tick for the line-15 click and S7's 15-frame keyboard bed
  (the guess's last characters) are gone with those moments, S6's keyboard
  bed is 19 frames instead of 30.
- **The click targets, checked.** `scripts/pointer-spots.mjs` no longer
  places a disc: it checks every click the film shows against the footage
  (inside its recorded target, and that target's outline on an edge of the
  frame of the press for 91-100% of its length). No re-capture was needed.
- **Measured in the film.** `scripts/check-pointer.mjs` (`npm run
  pointer`, above).

**Measured** (the 4K master and the web files made from it, rendered once
from this source; `npm run pointer` on the web MP4, its references rendered
at 2x and brought to 1080p with the web files' own Lanczos filter; the
1x `render:draft` cut measured the same way with `--scale=1` while
iterating):

| Press | Take | Target | Hotspot to click, render / MP4 (px) | Inside the box | On before / after the press (frames) | Ends |
| --- | --- | --- | --- | --- | --- | --- |
| 759 | S5 board | Approve the plan and start development | 0.66 / 0.27 | yes | 25 / 27 | faded |
| 941 | S6 answer | Think so | 0.38 / 0.32 | yes | 19 / 34 | travels on to the next click |
| 960 | S6 answer | Show answer | 0.57 / 0.36 | yes | 38 / 15 | with the cut |
| 996 | S6 reveal | Got it | 0.63 / 0.53 | yes | 20 / 15 | with the cut |
| 1139 | S7 guess | Show the alternative | 0.46 / 0.07 | yes | 19 / 16 | with the cut |
| 1248 | S7 keep | Keep this approach | 0.24 / 0.33 | yes | 20 / 15 | with the cut |
| 1320 | S8 select | Explain this code | 0.13 / 0.12 | yes | 20 / 15 | with the cut |
| 1647 | S9 question | Think so | 0.09 / 0.15 | yes | 23 / 12 | with the cut |
| 1680 | S9 partly | Partly | 0.45 / 0.64 | yes | 20 / 15 | with the cut |
| 1754 | S10 tests | Tests | 0.39 / 0.30 | yes | 22 / 27 | faded |
| 2064 | S11 words | Add my not-tested answer to Testing | 0.26 / 0.34 | yes | 25 / 27 | with the cut (fading, 0.08) |
| 2145 | S12 dialog | Open the sample Draft PR | 0.37 / 0.04 | yes | 25 / 18 | with the cut |
| 2256 | S12 waiting | Read feedback | 0.20 / 0.17 | yes | 20 / 15 | with the cut |

- Every hotspot within 0.7 px of the point the capture clicked (limit 4),
  inside its target's box; the click point is found in the frames by
  matching the captured picture (match 0.95-0.99).
- Opacity (out/review/pointer-opacity.tsv, every frame of the 12 takes):
  largest step 0.096 a frame in the render (limit 0.13), at most 0.016 from
  the model; no pointer on a take's first frame; every take that cuts with
  the pointer on cuts 12-18 frames after the press, the pointer at rest.
  In the web MP4 the pointer measures 0.82-1.33 times the render's where it
  is whole (median 0.94): the master's own path (JPEG frames, H.264, Lanczos,
  H.264) renders the thin ring half a 4K pixel apart and sharpens it over a
  dark button, so the MP4's "opacity" jumps (up to 0.43) as the pointer
  crosses from white onto a green or blue button; looked at frame by frame
  in the strips, no change shows there. The check holds the MP4 to 0.5-1.5
  times the render (a lost or a stray pointer).
- `npm run check`: every check passes. 88.021 s (MP4s) / 88.029 s (WebM);
  MP4 17.39 MB, WebM 14.79 MB, 4K master 82.11 MB; -14.13 / -14.02 /
  -14.03 LUFS, true peak -1.99 / -3.05 / -3.35 dBTP (the ticks moved with
  their clicks); poster and captions byte-identical to round 9's; the final
  hit at 2438; the end-card logo locks on 2451 (-0.018 s).
- `npm test`: 80 tests pass (the pointer's synthetic run, every click on
  its target, no pop, and the click targets against the footage);
  `npm run typecheck` passes.
- `npm run review`: 278 frames and the contact sheet; the scans over all
  2640 frames found nothing. The card-edge scan first flagged S8's last
  frame (1334: 10 sharp px, limit 8) on the window's own bottom edge 6-18 px
  right of the caption card, which round 9's web file had one step under
  the threshold (the two 4K masters agree there to 2 levels): the scan now
  leaves out the window's projected outline (2 px), which is a frame edge,
  not UI running into a card.
- Against round 9's web MP4, every frame decoded (480x270 luma): S1-S3
  with the bell's flight (0-470), S13 and S14 identical (0.000); above 0.5
  levels only inside the retimed takes (943-953, 1299-1304, 1322-1333,
  1691-1694, 2091-2092, 2259-2269); elsewhere at most 0.42, the encoder's
  noise carried through the frames after a changed take: lossless renders
  of 600, 897, 1050, 1190, 1400, 1710, 1850 and 2200 from round 9's and this
  source are pixel-identical.

**Verdicts** (looked at in `bell-pr-product-assets/film-rerun/v3/pointer-frames/`:
the 12 contact sheets of the web MP4, every click from 14 frames before its
press to 20 after, every 2nd frame, and every appearance and
disappearance, cropped 2x with the click point marked; and the contact
sheet):

| Take | Verdict |
| --- | --- |
| S5 board (734-786) | ok: comes in over the plan's text under the button, rises onto "Approve the plan and start development" and presses on its centre; stays through the fold (over the board's "Team conversation" header) and fades. |
| S6 answer (921-974) | ok: comes in beside "Show answer", onto "Think so", presses as the chip fills, travels down to "Show answer", presses; held pressed to the cut. |
| S6 reveal (975-1010) | ok: fades in over the soft heading above the grades, comes down into the "Got it" card, presses on it, the ring spreads; held to the cut. |
| S7 guess (1119-1154) | ok: fades in on the "Look up" chips, up onto "Show the alternative", presses; held to the cut. |
| S7 keep (1227-1262) | ok: from the soft paragraph above, down onto "Keep this approach", presses as it turns blue. |
| S8 select (1299-1334) | ok: fades in over the soft code above the selection bar, onto "Explain this code", presses. |
| S9 question (1623-1658) | ok: from the soft row below, up onto "Think so", presses as it turns green. |
| S9 partly (1659-1694) | ok: from the soft answer below, up onto "Partly", presses as it turns green. |
| S10 tests (1731-1781) | ok: from below, onto "Tests", presses as it turns green, stays, fades. |
| S11 words (2038-2090) | ok: from the heading above, down onto "Add my not-tested answer to Testing", presses; the button becomes "In the description" under it; fades to the cut. |
| S12 dialog (2119-2162) | ok: comes in just right of "Open the sample Draft PR" (outside it), slides onto it, presses on the beat before the crash; held to the cut. |
| S12 waiting (2235-2270) | ok: comes in left of "Read feedback", onto it, presses; the button becomes "Read feedback again" and the first comment arrives beside the forecast; held to the cut. |

The label under a button is legible through the ring at every press; the
ring sits on it for the half second after the click (it is a 16% tint, the
glyphs show through), then fades. No frame shows a pointer appear or vanish
except by its 12-frame fades and at the ten cuts that end it (12-18 frames
after a press).

### The look-dev's must-fix list (COMPARISON.md), as fixed here

| # | Must-fix | Fixed, frames |
| --- | --- | --- |
| C1 | Title sweep drew a misregistered ghost copy of "knowing why." | The sweep is drawn inside the letters of the same element (`background-clip: text` on the word itself), so it cannot misregister; it crosses "knowing why." over 2531-2555 (no ghost). The logo's own sweep was dropped in round 7 (it could only be seen on the green bell). |
| C2 | Title contrast: "From"/"to" dimmed, "vibe coding" left blurred | "From" and "to" stay #f4f7f3; only "vibe coding" dims (#56695d) and softens, at most 1.6 px, for one beat, then resolves to sharp (from 2559); "knowing why." turns mint. 2578, the hold to 2627 and the poster (2610) read as stills. |
| C3 | The bell alone on an empty white frame during the match cut; a rotated smear | Round 9 (the owner asked for the traveling bell): the bell flies as a crisp vector (no directional blur, no rotation smear: its only tilt is the window's, taken up on the same curve), and no frame is studio and bell alone: the window fades in as the name goes (332: name 10%, window 4%; 334: name gone, window 25%); the window is whole by 340, before mid-flight and the bell lands on the app's own bell (round 9 below). |
| C4 | No establishing shot of the whole window | Every product section opens on the whole floating window, four edges in frame (its bottom in a gutter), contact shadow, scale ≤ 1, for two beats or more, each with its own move: 341-470 (rising in under the flying bell), 867-902 (in from the left), 1515-1550 (locked off, then the push), 1890-1946 (pull-back) (test). |
| C5 | Shutter blur and depth of field smeared the UI during the dolly | The sharp plane moves at most 8 px a frame once a take has settled (test) and carries no shutter blur; depth of field is a lift (round 7): the component cropped on its own border, 2.5% larger, with a soft shadow, over the same picture blurred 3.5 px under a 25% studio veil, so no card or line is ever half sharp and the sharp plane never doubles (checked against the footage at every third frame): 471-577, 903-1118, 1587-1730 sharp at every 15th frame. |
| C6 | Supporting line: glyph tops at its start, over blurred code, covering the diff | Captions sit on a frosted card over a soft pool of light, over the soft plane or the studio (test and scan), beside the subject; the lines show whole from their first frames: 381, 471, 903, 1308, 1659, 1893. |
| C7 | Soft 4K product frames (DPR 2) | DPR 4 captures; pushes ≤ 2.0 (test). The 4K master is rendered and checked (rounds 5-7), and since round 7 the web files are made from it: crops of 408, 1407, 1623, 1839 and 2217 are crisp; the macros (≤ 2.6) are upsampled up to 1.3x in it, a slight softening at 100%. |
| C8 | Sound needs a listen; the swell may be inaudible | Measured: swell 16.7 dB, whooshes 17-25 dB, glint about 24 dB, ticks and keyboard 25-30 dB under the music at their moments; effects alone peak at -16.2 dBTP (ticks under -20); the mix measures the same integrated loudness as the music alone. **The listen is an owner sign-off.** |
| C9 | Grain and bitrate | Coarse static grain on both plates (the light one added in round 1, the dark one coarsened for VP9 in round 3, the light one darkened in round 5 and coarsened for VP9 in round 6); MP4 12.95 MB, WebM 16.32 MB, inside 20 MB in round 6; round 7 makes both from the 4K master (MP4 x264 slow CRF 21: 17.26 MB, WebM VP9 CRF 30: 14.65 MB). |
| B | Hand-off ghosting in the light wipe | No wipe: the lockup's name and descriptor have dissolved before the window comes in under them, and the window covers the bell's place in the lockup only after the bell has left it (test); the one cross-dissolve is the bell's own hand-off to the footage's bell, a true per-pixel blend of two bells within 0.12 px of each other (round 9). |

## By people: OWNER SIGN-OFF (not an agent gate)

- [ ] The cut by eye and by ear (music edit at the join at 50.5 s, the
      sound effects' levels).
- [ ] `"reviewed": true` in `music/track.analysis.json` after listening.
- [ ] The music licence conditions in `MUSIC-LICENSE.md` (the credit on the
      tiers that need it, Content ID).
- [ ] The Mixkit User Terms read before publishing (`SFX-LICENSES.md`).
- [ ] Remotion's company licence, if it applies (README.md).
- [ ] The glint on the chord: keep the (quieter) sparkle or swap it for a
      softer tonal shimmer (`SFX-LICENSES.md`).
- [ ] Copy left as VIDEO.md has it: "on your own machine" (S5) and
      "Runs on your machine" (end card); reviewers suggest "in your own
      worktrees", or keeping the lines and naming the user's own Codex or
      Claude Code CLI and account in the video description (README.md
      gives that text). No new captions for S4's plan or S11's checklist,
      no "replies prewritten" lower third (round 5), no "Days later, it
      comes back to practice." (rounds 6 and 7).
- [ ] The line under the first-hit wordmark (round 7): "A learning
      workbench for AI-assisted open-source contributions.", the
      product's own description from `site/index.html`, so the film says
      what BELL PR is; keep it, or take it out (`DESCRIPTOR` in
      `src/logo.ts`).
- [ ] The S9 to S10 cut, now on the bar-25 downbeat (1731, round 7): S9
      is 4 bars (its 5 bars at 120 BPM counted at this tempo); by ear,
      does it land?
- [ ] The platform descriptions: lead with the film's descriptor and
      carry the CLI and account sentence and, on the tiers that need it,
      the music credit (README.md).
- [ ] The site's video figure (`site/index.html`, outside this package):
      list the MP4 source before the WebM, the music credit if the tier
      needs it, and its `<track kind="captions">`, which doubles the
      captions burned into the picture.
- [ ] A product change, if wanted: render inline code in maintainer
      comments (S13 shows the comment's backticks raw, as Markdown).
