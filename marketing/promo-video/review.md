# Frame review

The promo is checked twice: by the scripts after every capture and render,
and by people before it is published.

## Automated: enforced on every run

`npm run capture` (`scripts/capture.mjs`) fails unless, at every captured
state of every shot:

- the page text breaks no privacy rule (`scripts/lib/privacy.mjs`): no owner
  user, host or tailnet name or handle, no `/home/`, `/Users/` or `/tmp/`
  path and no e-mail address. A guard in the page checks the text after
  every DOM change while a clip is filmed, and the capture checks it again
  at each named state. The only exception is the product's own fictional
  example path `/home/you/projects/repository` in the import dialog;
- the "Sample project" badge is visible in every workspace shot (S3-S10);
- the licensed MP3 matches its MD5 before anything starts.

`npm run render` ends with `npm run check` (`scripts/check-output.mjs`),
which fails unless:

- both videos last 75.28 ± 0.3 s (inside 60-90 s) at 1920x1080 and 30/1
  fps, the MP4 is H.264 + AAC and the WebM VP9 + Opus, and each is at most
  20 MB;
- `poster.jpg` is 1920x1080 and at most 500 KB;
- `captions.en.vtt` holds the cues of `src/timeline.json`, in order, without
  overlap, all ending inside the video;
- the integrated loudness is -15 to -13 LUFS (the bundled ffmpeg has no
  `ebur128`, so its `loudnorm` analysis measures it), and the gain math
  agrees;
- the end-card logo lands within 0.25 s of the final hit measured in the
  MP4's audio.

`npm test` keeps the timeline honest: contiguous shots, cuts on the music's
events, cameras inside the capture and clear of the sidebar, captions of
at most 42 characters a line and 2 lines, shown at least 1.8 s (one line)
or 2.6 s (two lines).

## Visual QA by the engineer (render of 2026-10-14)

After every render, `npm run review` extracts the frames below from the MP4
into `out/review/` (with `index.txt`) and draws `out/contact-sheet.png`
(24 frames). Each frame was looked at full size. "Fixed" names a problem an
earlier render had and how it was fixed before this one.

| Shot | Frames | Verdict |
| --- | --- | --- |
| S1 Problem | 49, 90, 132, 178 | ok: blurred home page behind the title cards; one empty frame between the two cards and a short breath before the brand (intended). Fixed: the blur was so heavy the UI read as a blank page; it now reads as the product behind glass. |
| S2 Brand | 182, 210, 238 | ok: "Meet" then the logo, on brand green; the cut to S3 lands on the drop. |
| S3 Import | 242, 285, 330, 374, 378, 418 | ok: the import button, typing, progress lines, then the repository page. Fixed: the repository page painted half-loaded for 10 frames after the import (the capture now cuts over the load); a sliver of the sidebar showed at the frame's left edge (cameras keep the whole sidebar or none of it); the caption covered the import button while the cursor moved to it (it now ends first). |
| S4 Overview | 422, 502, 570, 646, 718 | ok: analysis lines, the project card, the scroll to the directions. Fixed: the second caption covered the "Start with this direction" links (it now sits at the top). |
| S5 Direction | 722, 763, 767, 810, 815, 823, 827, 898 | ok: the cursor clicks "Start with this direction", rests on "Fix a bug", passes "Let me approve the plan…" and clicks "Play the sample team". The change between the two dialog stills dissolves over 8 frames. Fixed: a hard cut there read as a jump inside the dialog; the S4 end and S5 start showed different scroll positions. |
| S6 Team | 902, 979, 1050, 1123, 1198 | ok: establishing view, push in to the approval, the click, tasks moving, team messages, "Team work is complete". |
| S7 Explain | 1202, 1273, 1410, 1421, 1543, 1618 | ok: the plain-language example, six selected lines, the typed answer, the Reviewer's report. Fixed: the captions covered the selected lines and the report's text (the capture scrolls the diff up five lines and the captions sit on the left); the camera cut the file header in half. |
| S8 Review | 1622, 1695, 1698, 1768 | ok: the last two files ticked, 5 / 5, "Approve and prepare the PR", the PR preview. Fixed: a dialog opened a second time scrolled to its buttons (the capture keeps it at its title). |
| S9 Draft | 1772, 1818, 1845, 1858, 1862, 1918 | ok: "Follows the project's rules", what the draft is based on, what to confirm; then the final checklist (cut on the bar at 62.0 s). The AI-disclosure line is off, as it is by default, and not staged. Fixed: the checklist view cut off the side column; the stepper showed half cut at the top. |
| S10 Publish | 1922, 1992, 1996, 2010, 2049, 2098 | ok: the PR preview scrolls to the description, "Open the sample Draft PR", the top of the page with the Sample project badge, "Draft PR opened · Sample: not created on GitHub". Fixed: the clip scrolled through the whole draft to reach the card (it now cuts as the dialog closes); a sliver of the top bar and a cut-off "Smart GET retries". |
| S11 End | 2099, 2102, 2104, 2179 | ok: the logo drops in on the measured hit (frame 2099) and settles at 2104; `npx bell-pr`, "Free · Pro · 14-day trial" and the non-affiliation line arrive on the next beats; no homepage while `shared/product.ts` has none. Balanced on the card. |

Every frame: no blank, white or loading frame; no scrollbar or caret; no
real login, e-mail address, token, host name or home path (the import
dialog's hint shows the product's fictional `/home/you/projects/repository`);
text readable at 1080p (UI at 1.2-1.46x of its 1440 px layout).

## Human: before publishing (OWNER SIGN-OFF)

Look at every frame of the final cut at full size, and on a phone.

- [ ] No real GitHub login, avatar, e-mail address, token, hostname or
      `/home` path in any frame. (The import dialog's hint shows the
      product's fictional example `/home/you/projects/repository`; decide
      whether that is acceptable.)
- [ ] The "Sample project" badge, the "Interactive demo" chip or "Sample
      data" is visible in the workspace shots (S3-S10).
- [ ] Only fictional repositories (`openfetch-sample/open-fetch`).
- [ ] No GitHub, OpenAI or Anthropic logos; providers only in plain text.
- [ ] Captions are readable at 1080p and on a phone, and never cover what
      the shot is about.
- [ ] The cuts land on the beats; the end-card logo lands on the final hit
      (confirm by ear).
- [ ] The storyboard (`script.md`) and the final cut are approved.
- [ ] The Remotion license fits the owner's company (see `README.md`).
- [ ] Nothing is registered with Content ID or any rights-management
      service, and the MP3 is never published on its own
      (`MUSIC-LICENSE.md`).
