# Frame review

The film is checked twice: by the scripts after every capture and render,
and by people before it is published. Frame numbers are film frames (30 a
second) of the 89.0 s cut (2670 frames: the 86.8 s music edit and the end
card's 2.2 s hold); the cut itself is in [`script.md`](script.md). Rounds 1-4
below were made on the first cut; round 5 re-cut the film after three
reviewers' findings, and its verdicts are the current ones.

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
the privacy and badge checks (no exemption)". Seven states were filmed on
2026-10-15 at device scale 4 on the same product commit;
`v-draft-your-words` was filmed again on 2026-10-18 to add the establishing
still `top` (its clip came out pixel-identical to the earlier one: mean
absolute difference 0.0 on frames 0, 100 and 200); and in round 5
`v-quiz-attempt`, `v-road-choice`, `v-check`, `v-forecast` and
`v-practice` were filmed again with the demo-only "Fill with the sample
answer" controls hidden (same frame counts, same marks; the frames differ
only where the fill links were, checked on frames 30-400 of each), and
`v-practice` with a right answer.

`npm run check` (`scripts/check-output.mjs`; `-- --web-only` while the 4K
master is not rendered) fails unless:

- every video lasts the composition's 89.0 s ± 0.1 s (inside 75-90 s) at
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

`npm test` (55 tests) keeps the cut honest against the **loaded** analysis
file: anchored shots on their events, section changes on bar lines (else
half-bars; the one beat-2 cut, S10, proven to be the only legal one), takes
on half-bars, a cut on every crash downbeat of the analysis, shot lengths inside their limits in seconds, the flex rules on altered
analyses (S10 merged, S8 dropped, S9 held, a missing accent on a bar line),
captions of at most 42 characters a line and 2 lines, on screen at least
1.8 s (one line) or 2.6 s (two lines) and starting on the half-beat grid,
the owner's headline on the end card, no "automatic", "autonomous" or
"proves", every establishing window whole in frame for two beats or more
(four edges at least 40 px inside, scale at most 1), no push above 2.0
output px per capture px (one DPR-4 pixel per pixel of the 4K master) and
no macro above 2.6, the sharp plane never faster than 8 px a frame once
settled, no jump cut inside one captured state, no sliver of studio under
60 px at a frame edge, a sidebar cropped by the frame edge always in the
soft plane, **no caption card within 12 px of the sharp plane**, the logo
moments (the end-card logo under 72% eight frames after the cut and
resolved on the chord), the breath before the hit, and the sound effects'
placement (whooshes peaking a frame before their downbeat, the glint on the
chord) and levels.

`npm run review` also scans **every frame** of the MP4 (one decode) and
exits 1 on a finding: a mean luma step above 8 between two frames that are
not a cut (nor the UI's answer to an on-screen click) is a jump inside a
take; more than 8 sharp-edge pixels in the ring 6-18 px round a settled
caption card (its box measured in Chrome in the film's font) is UI text
running into the card. Findings go to `out/review/scans.tsv`.

## Visual QA by the engineer

`npm run review` extracts frames from the web MP4 into `out/review/` and
writes the frame index `out/review/index.tsv` (frame, seconds, shot, take,
file, why) and `out/contact-sheet.png` (the middle of every take, the first
hit and the end-card landing). In round 5, 271 frames: every shot and take
midpoint, every caption midpoint, two frames either side of every cut and
the cut frame itself, the breath before the hit (255, 273, 286, 290), the
hit (291), the measured final hit (2438), the logo landing (2452), the last
frame, and every 15th frame of every product take (123 frames of push-ins,
22 of floating windows). Every one was looked at, in 4x3 sheets at 640 px
and then at full size where anything was in doubt, and the whole contact
sheet; the 4K master was looked at in full-resolution crops (below).

Five rounds: each one rendered the web files again, extracted the frames
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

### Round 5 (renders of 2026-10-18 20:02, 20:08 and the 4K master): three reviewers' findings, the re-cut, verdicts

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

### The look-dev's must-fix list (COMPARISON.md), as fixed here

| # | Must-fix | Fixed, frames |
| --- | --- | --- |
| C1 | Title sweep drew a misregistered ghost copy of "knowing why." | The sweep is drawn inside the letters of the same element (`background-clip: text` on the word itself), so it cannot misregister; it crosses "knowing why." over 2531-2555 (no ghost). The logo's sweep is masked by the logo itself (2451-2475). |
| C2 | Title contrast: "From"/"to" dimmed, "vibe coding" left blurred | "From" and "to" stay #f4f7f3; only "vibe coding" dims (#56695d) and softens, at most 1.6 px, for one beat, then resolves to sharp (from 2559); "knowing why." turns mint. 2578, the hold to 2657 and the poster (2640) read as stills. |
| C3 | The bell alone on an empty white frame during the match cut; a rotated smear | No traveling bell: the wordmark holds at full strength (291-334), lifts and dissolves (335-344), and the window's top edge is already in frame on 345; no empty frame (343, 345, 347 in the review). |
| C4 | No establishing shot of the whole window | Every product section opens on the whole floating window, four edges in frame, contact shadow, scale ≤ 1, for two beats or more: 352-470, 867-902, 1515-1568 (then the push), 1875-1946 (test). |
| C5 | Shutter blur and depth of field smeared the UI during the dolly | The sharp plane moves at most 8 px a frame once a take has settled (test) and carries no shutter blur; depth of field is a pre-blurred, veiled back copy under a mask, so the sharp plane never doubles: 471-577, 903-1118, 1587-1748 sharp at every 15th frame. |
| C6 | Supporting line: glyph tops at its start, over blurred code, covering the diff | Captions sit on a frosted card over a soft pool of light, over the soft plane or the studio (test and scan), beside the subject; the lines show whole from their first frames: 381, 471, 903, 1308, 1659, 1893. |
| C7 | Soft 4K product frames (DPR 2) | DPR 4 captures; pushes ≤ 2.0 (test). The 4K master is rendered and checked (round 5): crops of 408, 1623, 1839 and 2217 are crisp; the macros (≤ 2.6) are upsampled up to 1.3x in it, a slight softening at 100%. |
| C8 | Sound needs a listen; the swell may be inaudible | Measured: swell 16.7 dB, whooshes 17-25 dB, glint about 24 dB, ticks and keyboard 25-30 dB under the music at their moments; effects alone peak at -16.2 dBTP (ticks under -20); the mix measures the same integrated loudness as the music alone. **The listen is an owner sign-off.** |
| C9 | Grain and bitrate | Coarse static grain on both plates (the light one added in round 1, the dark one coarsened for VP9 in round 3, the light one darkened in round 5); MP4 14.55 MB, WebM 14.11 MB, inside 20 MB. |
| B | Hand-off ghosting in the light wipe | No wipe and no cross-dissolve between the logo and the window: the logo has gone before the window enters (A's rule). |

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
- [ ] Copy left as VIDEO.md has it: "on your own machine" (S5), and no new
      captions for S4's plan or S11's checklist, no descriptor under the
      wordmark and no "replies prewritten" lower third (round 5).
- [ ] The site's video figure (`site/index.html`, outside this package):
      the music credit if the tier needs it, and its `<track
      kind="captions">`, which doubles the captions burned into the picture.
