# The v1.1 launch film: storyboard, captions and timing

**Status: OWNER SIGN-OFF pending** (the cut by ear and eye, and
`"reviewed": true` in `music/track.analysis.json` after listening).

1920x1080 at 30 fps (the 4K master is the same composition at
`--scale=2`), **86.8 s (2604 frames)**, English captions, no voice-over,
music "Rock Sport Top" (Short A, 100 BPM; `MUSIC-LICENSE.md`). The brief is
plan `direction-v1.1/VIDEO.md` (§3 storyboard, §4 demo states, §5 honesty
rules and the lead addenda); the look is the owner's choice from the
look-dev: variant C (Cinematic hybrid) with variant B's floating window and
frosted caption card.

Every product picture is real UI of the fictional sample project
`openfetch-sample/open-fetch` in demo playback (`present=1&locale=en&capture=1`),
filmed at device scale 4 (`scripts/capture.mjs`). Nothing reaches GitHub or
an AI model. The pointer is drawn by the film from the capture's recorded
moves and clicks: a neutral round disc, never an operating-system arrow.

## How the cut is made

`src/timeline.ts` lays the shots on the music's events
(`music/track.analysis.json`): an anchored shot starts on its event, the
shots between two anchors share the gap by their nominal seconds (VIDEO.md's
bars at 120 BPM, restated in seconds as the lead's addendum asks), every
cut snaps to a beat, and captions and takes are placed in beats from their
shot's first beat. `npm test` checks every rule against the loaded
analysis. With this track no flex step is needed: all fourteen shots are in,
S8 is kept and S10 is not merged; S6, S7 and S9 are at or above nominal.
The opening is the "tighter opening" the addendum accepts: S1 runs from the
intro to the riser (4.9 s) and S2 from the riser through the 2-beat stop to
the first hit (4.8 s).

## Shots

| Shot | Frames | Seconds | Anchor | Takes (first frame) | Picture |
| --- | --- | --- | --- | --- | --- |
| S1 Problem | 0-146 | 0.00-4.90 | intro | queue 0 | Dark stage. A soft, endless queue of identical pull-request cards (no names, numbers or platform chrome) drifts left; one reviewer's round pointer hovers and pings on every other beat. The lines pull into focus (K3); on beat 3 of bar 2 "Reviewing them still" racks soft and dim while "isn’t." stays sharp (K5). |
| S2 Turn | 147-290 | 4.90-9.70 | riser | lift 147 | On the riser the queue slows to a halt over two beats; the question pulls into focus line by line; on the kick one card lifts out of the queue, turns to face the viewer and lights up, landing on the stop (255). Everything freezes for a beat, exhales (273-286), and the stage is dark for the four frames before the hit. |
| S3 Rules first | 291-560 | 9.70-18.70 | firstHit | logo 291, establish 345, rules 471 | "Lights on": a hard cut to the light studio with the wordmark already crisp (settling from 1.02); two beats later it lifts and dissolves away, gone before the window enters. The floating window (`v-rules-card`, the overview with the "Sample project" badge) rises in, turns to face the viewer and lands with its contact shadow; one light sweep. Cut on the beat to a push-in on "Before you contribute": "Pull requests: open to you" and the three quoted rules with their `CONTRIBUTING.md` lines. |
| S4 Still yours | 561-722 | 18.70-24.10 | | chips 561, plan 651 | `v-before-you-start`: the task dialog glides to "Before you start #42 (sample)"; the camera pushes onto the green chips (Open, Unassigned, No other open PR, the maintainer's "PRs welcome", "Your open PRs here: 0 of 1") while the rest of the dialog racks soft. Then `v-plan`: the plan waiting for approval. |
| S5 Legwork | 723-866 | 24.10-28.90 | | board 723 | `v-board`: the pointer approves the plan, the plan folds away, the camera eases back as tasks move across the board and the team's messages arrive. |
| S6 Try first | 867-1118 | 28.90-37.30 | lift | establish 867, answer 957, example 1065 | The review screen as the floating window, turning to face the viewer while the answer types out (`v-quiz-attempt`, `src/client.ts`). Push-in on the quiz card: "Think so", Show answer, the reference labelled AI-written, "Got it". Then the plain-language example card. |
| S7 Taste | 1119-1316 | 37.30-43.90 | | guess 1119, keep 1209 | `v-road-choice` on `src/utils/retry.ts`: "What if it were done differently?", the guess types, "Show the alternative" (fixed interval with jitter); then "Keep this approach" and the why types out. |
| S8 Ask | 1317-1442 | 43.90-48.10 | | select 1317, answer 1371 | `v-line-ask`: lines 10-15 of the diff selected; "Explain this code"; the question bubble with its diff block and the answer, the camera easing from the diff to the panel. |
| S9 Explain it back | 1443-1748 | 48.10-58.30 | climax | establish 1443, summary 1515, answer 1569, grade 1677 | The closed-book check as the floating window (`v-check`). Push-ins: the summary types; the `retry.ts` question is answered at "Think so"; "What did you not test?" is answered; the reveal, "Partly", and the one-line correction. |
| S10 Predict | 1749-1874 | 58.30-62.50 | | forecast 1749 | `v-forecast`: the "Tests" chip, "They'll ask whether the retry cap is tested." types, and the saved prediction beside the result line "You explained the change and answered 2 questions. You missed 1 and corrected it." |
| S11 Your words | 1875-2090 | 62.50-69.70 | accent | establish 1875, words 1947, checklist 2019 | The calm section, half-speed camera: the draft tab as the floating window (the contribution guide, "Follows the project's rules"); "Use my explanation" and "Add my not-tested answer to Testing"; the maintainer checklist, every row OK. |
| S12 Send one | 2091-2270 | 69.70-75.70 | | dialog 2091, published 2181 | `v-publish`: the publish dialog, its checks ("Your open PRs here: 0 of 1", "Every check passes."), "Open the sample Draft PR"; the card "Draft PR opened · Sample: not created on GitHub". |
| S13 Learn | 2271-2437 | 75.70-81.27 | | compare 2271, practice 2361 | `v-forecast-vs-reality`: "Your forecast: Tests" beside the sample maintainer's comments, "Saw it coming", "Changes requested"; quick cut to `v-practice`: "Got it", "Next review in 3 days". |
| S14 End | 2438-2603 | 81.27-86.80 | finalHit | end-card 2438 | A hard cut back to the dark stage on the measured hit; the logo pulls into focus and locks on the final chord (2452) with one light sweep inside its letters; "From vibe coding" / "to knowing why." beat by beat, "vibe coding" racked soft and dim, "knowing why." turning mint, "From" and "to" near white; `npx bell-pr` · "Free to start · Runs on your machine"; "BELL PR is independent and not affiliated with GitHub, OpenAI or Anthropic." No homepage: `shared/product.ts` sets none. |

## Captions

At most 42 characters a line and 2 lines; on screen at least 1.8 s (one
line) or 2.6 s (two lines); each starts on the half-beat grid. The title
lines (S1, S2, S14) are the display type itself; the others sit on the
frosted caption card, on a soft pool of studio light, where the shot leaves
room (never over what the shot is about). `captions.en.vtt` and `.srt` are
written from the same cues (`npm run captions`).

| Shot | Frames | Seconds | Caption |
| --- | --- | --- | --- |
| S1 | 3-75 | 0.10-2.50 | Vibe coding made pull requests cheap. |
| S1 | 75-147 | 2.50-4.90 | Reviewing them still isn’t. |
| S2 | 147-273 | 4.90-9.10 | What if AI made you better, / not just faster? |
| S3 | 381-471 | 12.70-15.70 | First, read the project’s rules. |
| S3 | 471-561 | 15.70-18.70 | Every rule, quoted from its source. |
| S4 | 579-651 | 19.30-21.70 | Check the issue is still yours. |
| S5 | 741-867 | 24.70-28.90 | Agents do the legwork, / on your own machine. |
| S6 | 885-975 | 29.50-32.50 | Answer first. |
| S6 | 975-1119 | 32.50-37.30 | Then see the explanation. |
| S7 | 1128-1209 | 37.60-40.30 | Which way would you do it? |
| S7 | 1209-1317 | 40.30-43.90 | Taste grows by weighing trade-offs. |
| S8 | 1326-1443 | 44.20-48.10 | Stuck on a line? Ask about it. |
| S9 | 1461-1677 | 48.70-55.90 | Before it ships, explain it back. |
| S9 | 1677-1749 | 55.90-58.30 | Missed something? Fix it in a line. |
| S10 | 1758-1875 | 58.60-62.50 | Predict what the maintainer will ask. |
| S11 | 1893-1965 | 63.10-65.50 | Your words. The project’s rules. |
| S11 | 1965-2019 | 65.50-67.30 | And what you didn’t test. |
| S12 | 2109-2271 | 70.30-75.70 | One Draft PR. Then stay for the review. |
| S13 | 2280-2361 | 76.00-78.70 | Learn from what they actually said. |
| S14 | 2469-2604 | 82.30-86.80 | From vibe coding to knowing why. (the end card's headline) |

## Honesty

Only shipped behaviour of the sample, unretouched (cropped, lit, tilted and
focused only). No real projects, maintainers or numbers; no PR count rising;
never "automatic", "autonomous" or "proves" (`npm test` checks the captions);
no GitHub, OpenAI or Anthropic logos; S1 is a metaphor, not data; no Apple
fonts, devices, window buttons or "9:41" (the capture clock reads 10:24).
