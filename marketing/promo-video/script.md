# Promo storyboard and caption script

**Status: draft for OWNER SIGN-OFF.** The video is built from this script.
`src/timeline.json` holds the exact frames of every shot, camera move and
caption; this page describes them. 1920x1080, 30 fps, 75.28 s (2259
frames), English captions, no voice-over, music "Ramp It Up" (see
`MUSIC-LICENSE.md`).

Every product shot is real UI footage of the sample project
(`openfetch-sample/open-fetch`, fictional) playing its scripted demo, with
the presentation flags `present=1&locale=en&capture=1`. Nothing reaches
GitHub or an AI model. The cursor is drawn by the video (the in-app
`cursor=1` ring is not used, so stills and clips share one cursor that
eases between the recorded targets).

## Shots

| Shot | Video time | Music | State and route | Footage | Caption (on screen) |
| --- | --- | --- | --- | --- | --- |
| S1 Problem | 0.0-6.0 | soft intro, fade-in | `#/home` | DPR-2 still, blurred, slow push-in; two title cards | "Want to contribute to open source?" → "Unfamiliar code slows you down." (title cards) |
| S2 Brand | 6.0-8.0 | riser 6.0 | React title card on brand green: "Meet" over the logo | none | "Meet BELL PR" (title card) |
| S3 Import | 8.0-14.0 | **drop 8.0** | `#/repos?demo=play&speed=2`: click "Import repository", type `openfetch-sample/open-fetch`, import progress, the repository page with its overview | frame-stepped clip (page clock) | "Bring a GitHub project." |
| S4 Overview | 14.0-24.0 | build | `#/runs/demo-run/overview?demo=play&speed=2`: the analysis lines, the project card, scroll to the contribution directions | frame-stepped clip | "AI reads the codebase with you" → "and suggests where to start." |
| S5 Direction | 24.0-30.0 | **lift 24.0** | the directions: "Start with this direction", the task dialog with "Fix a bug" chosen and "Let me approve the plan before development" on, "Play the sample team" | three stills with the video's cursor | "Pick a direction. You stay in charge." |
| S6 Team | 30.0-40.0 | | `#/runs/demo-run/activity?demo=play&speed=2`: the plan waits for approval, "Approve the plan and start development", the tasks move across the board, the team's messages arrive | frame-stepped clip | "An agent team plans, codes and tests" → "after you approve the plan." |
| S7 Explain | 40.0-54.0 | **climax 40.0** | `#/runs/demo-run/changes?file=src/utils/retry.ts&demo=play`: the plain-language example (before/after), select lines 10-15, "Explain this code", the answer types out, then the Reviews tab with the Reviewer's report | CDP screencast clip | "Every change, in plain language." → "Ask about any line." → "See what reviewers will look for." |
| S8 Review | 54.0-59.0 | **accent 54.0** | three files reviewed; tick "Reviewed" on the test file and the README, the progress fills to 5/5, "Approve and prepare the PR" opens the PR preview | frame-stepped clip | "You review every file." |
| S9 Draft | 59.0-64.0 | | `#/runs/demo-run/draft`: the contribution guide ("Follows the project's rules", what the draft is based on, what to confirm), then the final checklist ("One last look before you submit.") | two stills, cut on the bar at 62.0 | "A PR draft that follows / the project's rules." (top of frame) |
| S10 Publish | 64.0-70.0 | | the PR preview dialog scrolls to the description; "Open the sample Draft PR"; the card "Draft PR opened · Sample: not created on GitHub" | frame-stepped clip | "Nothing is published until you approve it." |
| S11 End | 70.0-75.28 | **final hit 70.0** (measured), tail | React end card: the logo lands on the hit; `npx bell-pr`; "Free · Pro · 14-day trial"; the homepage only when `shared/product.ts` sets one (empty today); "BELL PR is independent and not affiliated with GitHub, OpenAI or Anthropic." | none | (none) |

Cuts between shots land on the music's events (frames 180, 240, 720, 1200
and 1620). The lead's event list put the final hit at about 72.0 s; the
waveform puts it at 70.0 s (frame 2099, the largest per-frame level rise in
69.5-73.0 s), and at 72.0 s the track falls into its tail. The end card
starts on that hit and its logo lands 5 frames later.

## Captions

At most 42 characters a line and 2 lines a caption; each stays at least
1.8 s (one line) or 2.6 s (two lines). The burned-in captions and
`captions.en.vtt`/`.srt` come from the same cues in `src/timeline.json`.
A caption is timed or placed so it never covers what the shot is about,
for example the button the cursor is about to click.

## Differences from the first draft

- The UI's own labels are used: "Play the sample team" (the sample's
  version of "Generate the team plan"), "Approve the plan and start
  development", "Approve and prepare the PR", and "Open the sample Draft
  PR".
- S6 plays at `speed=2` (the draft said 3) so each task move is readable;
  S7-S10 play at `speed=1` so the answer types out at reading speed.
- S9 does not stage the AI-disclosure line, which is off by default; it
  shows the rule-aware guidance and the final checklist instead.
- The S3, S4, S6, S8 and S10 clips are frame-stepped instead of screencast:
  with 2x pixels and no GPU, Chrome paints full-window changes (scrolls,
  dialogs over a blurred backdrop) at 6-8 frames per second, while
  frame stepping gives an even 30.

## Wording rules

Never "automatic PRs". No GitHub, OpenAI or Anthropic logos. Providers are
named only in plain text ("works with Codex CLI or Claude Code"). "No BELL
cloud" if the cloud is mentioned.
