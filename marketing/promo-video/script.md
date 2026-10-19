# The v1.1 launch film: storyboard, captions and timing

**Status: OWNER SIGN-OFF pending** (the cut by ear and eye, and
`"reviewed": true` in `music/track.analysis.json` after listening).

1920x1080 at 30 fps (the 4K master is the same composition at
`--scale=2`), **88.0 s (2640 frames)**: the 86.8 s music edit, then the
complete end card held 0.8 s past the music's last sound and faded to
black over 12 frames (no silent dead air before a loop). English captions, no voice-over, music "Rock Sport Top" (Short A,
100 BPM; `MUSIC-LICENSE.md`). The brief is plan `direction-v1.1/VIDEO.md`
(§3 storyboard, §4 demo states, §5 honesty rules and the lead addenda); the
look is the owner's choice from the look-dev: variant C (Cinematic hybrid)
with variant B's floating window and frosted caption card.

Every product picture is real UI of the fictional sample project
`openfetch-sample/open-fetch` in demo playback (`present=1&locale=en&capture=1`),
filmed at device scale 4 (`scripts/capture.mjs`). Nothing reaches GitHub or
an AI model. The demo-only "Fill with the sample answer" controls (they
stand in for the person typing; a real run has none) are hidden while
filming, so no frame suggests that AI fills in the person's answers. The
pointer is drawn by the film from the capture's recorded moves and clicks:
a neutral round disc beside its hotspot, never an operating-system arrow.
It shows only around a click (at most 12 frames before it, gone a few
frames after), moves with a lifted component and fades out over the page
behind it, and sits beside each click where the footage leaves it, and the
click's ring round it, off every glyph (`scripts/pointer-spots.mjs`).

## Depth of field and the camera

In every push the component the shot is about (a card, a checklist row, a
dialog's section, a block of quoted text, the board's columns) is lifted
out of the page: the same picture cropped on the component's own border (or,
in a run of unbordered text, in the gutter round it), 2.5% larger, with a
soft layered shadow under it, while the rest of the window drops back,
blurred 3.5 px on screen under a 25% veil of the studio's colour. A card,
row or line is never half sharp: `npm run review` and `npm test` check the
footage at every third frame of every take that no lifted box crops a glyph,
and that no lifted line is cut by a frame or window edge on a take's last
frame (`scripts/check-dof.mjs`). A component that comes forward inside a
take (the board after the plan folds) racks in over 15 frames.

Every camera has two parts: a move that leaves the cut already moving and
covers at most 60% of its travel in its first beat (`push`: no lurch, then
freeze), and a linear drift through the whole take (about +2% scale and
12 px a bar), so the camera is still moving on the out-cut, on a held clip
frame as much as on a moving one. Pushes are flat (no tilt at 1.4x and
closer). In the right-hand panel shots the window's edge is at most 120 px
inside the frame. `npm test` checks all of it.

## How the cut is made

`src/timeline.ts` lays the shots on the music's events
(`music/track.analysis.json`): an anchored shot starts on its event, the
shots between two anchors share the gap by their nominal seconds (VIDEO.md's
bars at 120 BPM, restated in seconds as the lead's addendum asks), and
every cut snaps to the grid: a bar line first, else a half-bar, else a beat
only where the limits leave nothing else. Takes sit on half-bars, and every
crash downbeat of the track (bars 5, 9, 21, 23 and 31 of the edit) is a cut.
`npm test` checks every rule against the loaded analysis. With this track
no flex step is needed: all fourteen shots are in, S8 is kept and S10 is
not merged; S6, S7 and S9 are at or above nominal, counted in the track's
own bars (the 120 BPM nominal scaled to 100 BPM and rounded to the
half-bar grid: S9's 5 bars are 4.17 bars here, so 4 bars, 9.6 s). Two shot
cuts are not on a bar line: S7 and S13 start on beat 3 (a bar line would
break S6-S8's or S12-S13's limits). S10 starts on the bar-25 downbeat
(1731). The opening is the "tighter opening" the
addendum accepts: S1 runs from the intro to the riser (4.9 s) and S2 from
the riser through the 2-beat stop to the first hit (4.8 s).

## Shots

| Shot | Frames | Seconds | Anchor | Takes (first frame) | Picture |
| --- | --- | --- | --- | --- | --- |
| S1 Problem | 0-146 | 0.00-4.90 | intro | queue 0 | Dark stage. A queue of identical pull-request cards (a generic pull-request glyph, title bars, a green and red diff stat; no names, numbers or platform chrome) grows faster than it is reviewed: cards drop in on the beats into three receding rows, each row wholly above the one in front, while the one reviewer (a round pointer with a ring) opens the centre card, clears it, and sees another take its place. The lines pull into focus (K3); on beat 3 of bar 2 "Reviewing them still" racks soft and dim while "isn’t." stays sharp (K5), through the cut. |
| S2 Turn | 147-290 | 4.90-9.70 | riser | lift 147 | The question pulls into focus line by line; on the kick the card in the reviewer's slot lifts out, turns to face the viewer and lights up, landing on the stop (255). Everything freezes for a beat, exhales (273-286), and the stage is dark for the four frames before the hit. |
| S3 Rules first | 291-578 | 9.70-19.30 | firstHit | logo 291, establish 327, rules 471 | "Lights on": a hard cut to the light studio with the wordmark already crisp and, under it, the product's own description, "A learning workbench for AI-assisted open-source contributions."; the studio flares a little brighter for six frames and the lockup pushes slowly (1.00 to 1.04 in 53 frames), readable whole for 1.2 s. **The bell's flight** (`src/bell.ts`, owner's feedback after round 8): on beat 3 of bar 5 (327) the wordmark's bell lifts off and flies, on one eased arc (an ease-in-out, a gentle bow of 10% of its length to the lower left), into the floating window, while "BELL PR" and the descriptor dissolve in 7 frames and the window (`v-rules-card`, the overview with the "Sample project" badge, its bottom in a gutter) rises and fades in under it from below once the bell has left its place (330-340, whole by mid-flight), turning towards the viewer and settling by 359. The bell stays a crisp vector, shrinks on the same curve, comes into the window from the lower left (never across the app's own "BELL PR") and lands on the bar-6 downbeat (363) exactly on the app's own sidebar bell: the same place, size, colour and tilt, drawn through the window's own transform (measured: 0.02-0.12 px apart, sizes within 0.8%). It holds a beat (363-381) while it cross-dissolves into the footage's bell (365-375), then the window turns to face the viewer and settles with its contact shadow; one light sweep (435). Cut on beat 3 to a push on "Before you contribute": the three quoted rules, each with its `CONTRIBUTING.md` line and what publishing does about it, lifted. |
| S4 Still yours | 579-722 | 19.30-24.10 | | chips 579, plan 651 | On the bar-9 crash: `v-before-you-start` with the facts already settled, a macro (2.3-2.4x) on the whole "Before you start #42 (sample)" box and its green chips (Open, Unassigned, No other open PR, the maintainer's "PRs welcome", "Your open PRs here: 0 of 1"), lifted, the dialog round it dropped back. Then `v-plan`: the whole plan card waiting for approval, lifted. |
| S5 Legwork | 723-866 | 24.10-28.90 | | board 723 | The same picture across the section cut: the pointer approves the plan on beat 3 (759, the person's call); the plan folds (763) and the board's four columns come forward together over 15 frames as the camera eases to the whole board; the tasks move a beat apart and the team's messages arrive (`v-board` at 0.62x); the caption over the dropped-back stepper and run card. |
| S6 Try first | 867-1118 | 28.90-37.30 | lift | establish 867, answer 903, reveal 975, example 1011 | The review screen as the floating window, coming in from the left and turning to face the viewer for two beats (`v-quiz-attempt`, `src/client.ts`). On beat 3 a push onto the quiz card, lifted, while the answer types out, "Think so", Show answer; a macro on the AI-written reference and "Got it" (held as it is pressed); then the plain-language example card. |
| S7 Taste | 1119-1298 | 37.30-43.30 | | guess 1119, alternative 1155, keep 1227, why 1263 | `v-road-choice` on `src/utils/retry.ts`, the panel centre-right, the window's edge 120 px inside the frame: the guess card, "Show the alternative"; a macro on the revealed alternative, whole and lifted for 2.4 s, framed under the panel's sticky header ("Another option is a fixed interval with a little random jitter … With very few retries and a hard response deadline, a fixed interval would be the better choice."); "For this project, which would you choose?" with its first row of choices lifted and the click on "Keep this approach"; the why types and is saved. |
| S8 Ask | 1299-1442 | 43.30-48.10 | | select 1299, question 1335, answer 1371 | `v-line-ask`: the selection grows to lines 10-15 and "Explain this code" is pressed (the selected lines and the selection bar lifted); the question's diff block in a macro while the agent reads; then the answer's first paragraph, complete and lifted, held 2.4 s with the camera drifting (the capture's "reread" frame, the same on every capture): "If many users fail and retry at the same moment, the server is flooded again. Spreading the retries out breaks that chain reaction." |
| S9 Explain it back | 1443-1730 | 48.10-57.70 | climax | title 1443, establish 1515, question 1587, partly 1659, result 1695 | On the climax crash a cut back to the dark stage for one bar: "Before it ships, explain it back." at 104 px, its focus pull pre-rolled so the crash frame already shows the type, settling from 1.05; "Before it ships," racks soft on beat 3. "Lights on" on the next downbeat (the music's join): the closed-book check as a locked-off floating window for two beats, then a push onto "1. Explain" as the summary types, landing at 2x on the loudest downbeat (1587); a macro on the `retry.ts` question being answered and "Think so"; on bar 24 the reference and "Partly"; then the result: "You explained the change and answered 2 questions. You missed 1 and corrected it." with the one-line correction. |
| S10 Predict | 1731-1874 | 57.70-62.50 | | tests 1731, line 1803 | On the bar-25 downbeat, `v-forecast`: a macro on the taste-dimension chips, "Tests" picked, "They'll ask whether the retry cap is tested." types; then a macro on the check's result line with the saved prediction under it. |
| S11 Your words | 1875-2090 | 62.50-69.70 | accent | establish 1875, checklist 1947, words 2019 | The calm section, half-speed camera: a slow pull-back from close on the draft to the whole floating window (its bottom in a gutter); the maintainer checklist's last rows, every one OK and lifted: "Your own words", "A reviewable change", "Disclosing AI help" with the project's rule (`CONTRIBUTING.md:9`), "Understanding check: You explained the change back"; the rows with the sample GitHub facts and the header with its read times out of frame; then the "Your words in the PR" card, whole and lifted: the not-tested answer and "Add my not-tested answer to Testing" pressed, ending on its "In the description". |
| S12 Send one | 2091-2270 | 69.70-75.70 | | dialog 2091, published 2163, waiting 2235 | `v-publish`: a macro on the publish dialog's checks ("Your open PRs here: 0 of 1 (first contribution here)", "Every check passes.") and "Open the sample Draft PR", pressed two frames before the bar-31 crash; on the crash, the card "Draft PR opened · Sample: not created on GitHub" in a macro for a bar; on bar 32 the draft waiting for the review (`v-forecast-vs-reality` before reading): "Maintainer feedback" with "Read feedback", and the saved forecast beside the empty "What the maintainers said"; "Read feedback" is pressed just before the cut. |
| S13 Learn | 2271-2437 | 75.70-81.27 | | compare 2271, practice 2343 | `v-forecast-vs-reality`: "Your forecast: Tests" beside the first maintainer comment, both lifted whole for a beat and a half; then the forecast drops back and the camera pushes onto the comment, 2.1x on the out-cut: "2. Please add a test for the exhausted case: after `maxRetries`, the last error should be thrown." with its "Tests" tag and "Saw it coming" (the comment's inline code shows raw backticks, as Markdown). On beat 3, without a caption, `v-practice`: the Learning page's "Sample practice", the item "From your understanding check" coming back, answered right, the whole card lifted for two beats; then a push down to 1.95x onto the reference, "What you had wrong last time" and "Next review in 3 days", still drifting into the end card's cut. |
| S14 End | 2438-2639 | 81.27-88.00 | finalHit | end-card 2438 | A hard cut back to the dark stage on the measured hit; the logo, large and centred, pulls into focus on an accelerating curve, the last fifth of its resolve and its settle from 1.02 coming on the frames that end on the final chord, so it locks ON it (2451, the largest change of the pull) with the glint; a beat later it moves up as "From vibe coding" / "to knowing why." come in beat by beat; then "vibe coding" racks dim (it resolves back to sharp, keeping its dim), "knowing why." turns mint, "From" and "to" stay near white, and the call to action comes in with the footer (2523): `npx bell-pr` alone on its own line, centred, IBM Plex Mono 60 px in mint, 87 px clear under the headline; "Free to start · Runs on your machine" on its own line under it, DM Sans 30 px in the quieter secondary green, 33-34 px clear (owner's feedback after round 8: the two on one row read as clutter); and "BELL PR is independent and not affiliated with GitHub, OpenAI or Anthropic." at the foot, 132 px clear (`src/scenes/endCardLayout.ts`; measured on the rendered card). The complete card holds sharp to 2627 and fades to black over the last 12 frames. No homepage: `shared/product.ts` sets none. |

## Captions

At most 42 characters a line and 2 lines; on screen at least 1.8 s (one
line) or 2.6 s (two lines); each starts on the half-beat grid. The title
lines (S1, S2, S9's first line and S14) are the display type itself; the
others sit on the frosted caption card, on a soft pool of studio light,
over the dropped-back page or the studio (a test keeps every card 12 px
clear of any lifted component). A new card's lines are on from its first
frame; a cue that follows another in the same shot keeps the card: the
old lines leave at the old size, then the card eases to the new size as
the new lines rise. Cards sit bottom-left or top-left only (top-left in S5
and S12), in DM Sans at 56 px. The descriptor under the wordmark (S3) is
part of the logo lockup, not a caption cue (it dissolves as the bell lifts off). `captions.en.vtt` and `.srt`
are written from the same cues (`npm run captions`).

| Shot | Frames | Seconds | Caption |
| --- | --- | --- | --- |
| S1 | 3-75 | 0.10-2.50 | Vibe coding made pull requests cheap. |
| S1 | 75-147 | 2.50-4.90 | Reviewing them still isn’t. |
| S2 | 147-273 | 4.90-9.10 | What if AI made you better, / not just faster? |
| S3 | 381-471 | 12.70-15.70 | First, read the project’s rules. |
| S3 | 471-579 | 15.70-19.30 | Every rule, quoted from its source. |
| S4 | 588-651 | 19.60-21.70 | Check the issue is still yours. |
| S5 | 777-867 | 25.90-28.90 | Agents do the legwork, / on your own machine. |
| S6 | 903-975 | 30.10-32.50 | Answer first. |
| S6 | 975-1119 | 32.50-37.30 | Then see the explanation. |
| S7 | 1128-1191 | 37.60-39.70 | Which way would you do it? |
| S7 | 1191-1299 | 39.70-43.30 | Taste grows by weighing trade-offs. |
| S8 | 1308-1443 | 43.60-48.10 | Stuck on a line? Ask about it. |
| S9 | 1443-1515 | 48.10-50.50 | Before it ships, explain it back. (display type on the dark stage) |
| S9 | 1659-1731 | 55.30-57.70 | Missed something? Fix it in a line. |
| S10 | 1740-1875 | 58.00-62.50 | Predict what the maintainer will ask. |
| S11 | 1911-2019 | 63.70-67.30 | Your words. The project’s rules. |
| S11 | 2019-2091 | 67.30-69.70 | And what you didn’t test. |
| S12 | 2109-2271 | 70.30-75.70 | One Draft PR. Then stay for the review. |
| S13 | 2280-2343 | 76.00-78.10 | Learn from what they actually said. |
| S14 | 2487-2640 | 82.90-88.00 | From vibe coding to knowing why. (the end card's headline) |

## Honesty

Only shipped behaviour of the sample, unretouched (cropped, lit, tilted,
focused and lifted only; the demo-only fill controls hidden while filming, nothing
else changed). No real projects, maintainers or numbers; no PR count
rising; never "automatic", "autonomous" or "proves" (`npm test` checks the
captions); no GitHub, OpenAI or Anthropic logos; S1 is a metaphor, not data;
no Apple fonts, devices, window buttons or "9:41" (the capture clock reads
10:24). The "Sample project" badge is in every establishing window.
