# Music license: the launch film's soundtrack

The BELL PR v1.1 launch film uses one music track. The MP3 file is licensed
for use inside the video only. It is **not** part of this repository, the npm
package, the site repository or a press kit.

<a id="rock-sport-top"></a>

## Rock Sport Top (in use)

| | |
| --- | --- |
| Title | Rock Sport Top (928, Short A edit) |
| Artist | 2BStudio, publishing as MUSIC FOR VIDEO LIBRARY (MUSIC4VIDEO); the same track is sold on AudioJungle as "Fast Rock" (item 53584223) |
| Source | the creator's Patreon, post 928 "Rock Sport Top" |
| Licence | the creator's Patreon usage rights for patrons (paid tiers) |
| Owner's confirmation | 2026-10-15: the owner downloaded the track from the creator's Patreon and holds the right to use it; it is **not** a publication blocker (plan README §17.0 Q1) |
| File | `rock-sport-top.mp3` (Short A), MP3, 320 kbps, 44.1 kHz stereo, 92.55 s |
| MD5 | `b410171cd89e53948a9abda31136ff6f` |
| Beat analysis | [`music/track.analysis.json`](music/track.analysis.json) (tracked, path-free; `reviewed: false` until the owner has listened) |

### Conditions to observe

- **Credit on tiers that require it.** On the Free, Beginner, Basic and
  MEGA tiers, put "@musicforvideolibrary" in the description of every
  video that carries the track. On Advanced and above no credit is
  required. Check which tier the licence was obtained on before
  publishing (owner). If the credit is required, the line is
  "Music: Rock Sport Top, MUSIC4VIDEO (@musicforvideolibrary)": in every
  platform description, and in the caption of the site's video figure
  (`site/index.html`, outside this package; it has no credit today).
- **Individual creators only.** The creator's terms grant usage to
  individual content creators; companies are not allowed. Re-check the
  licence if the product is later sold by a company.
- **Content ID.** The creator registers every track with Elite Alliance
  Content ID, so copies uploaded to YouTube and similar platforms can
  receive claims. Ask the creator to whitelist the channel (EXCLUSIVE
  tier), or dispute claims while the subscription is active (claims can
  only be released while subscribed). The site's self-hosted
  `site/media/` files are not affected by Content ID.
- **The MP3 never travels on its own.** It and the renders never enter
  git, the npm package, the site repository or a press kit. Never publish
  a music-only edit.
- The receipt, the account and any order id stay private; nothing of them
  is recorded here.

### The edit used

`src/music.ts` reads every number from `music/track.analysis.json`:

1. source 0-50.5 s at video 0-50.5 s, with a 2-frame fade-in;
2. source 55.3-91.6 s at video 50.5-86.8 s: bars 22-23 (one cycle of the
   2-bar riff) are cut, so both sides stay on the 100 BPM grid; the join
   is an equal-power crossfade over the 2 frames before it, so the
   downbeat after it is the second segment's alone.

The edit plays at -4.5 dB: about -14 LUFS integrated, true peak about
-3.4 dBTP in the render. The final hit is measured
(`scripts/measure-hit.mjs`, the largest per-frame level rise in video
81.1-84.0 s: frame 2438, 81.267 s); the end-card logo resolves on the
final E chord 0.45 s later (81.718 s: frame 2451, the frame whose interval
holds it; the lead's rounded frame is 2452). After the music's last sound
(86.8 s) the picture holds the complete end card 2.2 s in silence and
fades to black, so the film is 89.0 s; the music edit itself is unchanged.

### Where the file goes

Put the licensed file at:

```text
marketing/promo-video/public/music/rock-sport-top.mp3
```

or set `PROMO_MUSIC_FILE` to its path; `npm run assets` (and
`npm run capture`) copies it there. Both check the MD5 above first.
`public/music/`, every `*.mp3`, and the rendered `*.mp4` and `*.webm` files
are gitignored.

## Ramp It Up (no longer used)

The v1 promo used "Ramp It Up" by Ahjay Stelino (Mixkit item 69, Mixkit
Stock Music Free License). The v1.1 film no longer uses it: nothing in this
package reads it, and its copy can be deleted from `public/music/`. Its
terms (no Content ID registration, no standalone redistribution) applied
only to that track.
