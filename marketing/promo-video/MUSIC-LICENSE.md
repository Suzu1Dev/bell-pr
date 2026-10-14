# Music license: promo video soundtrack

The BELL PR promo video uses one music track. The MP3 file is licensed for
use inside the video only. It is **not** part of this repository, the npm
package, a press kit or the website.

## The track

| | |
| --- | --- |
| Title | Ramp It Up |
| Artist | Ahjay Stelino |
| Source | Mixkit Free Stock Music, Mixkit item 69 (listed at <https://mixkit.co/free-stock-music/tag/technology/>) |
| Download URL | <https://assets.mixkit.co/music/69/69.mp3> |
| License | Mixkit Stock Music Free License, <https://mixkit.co/license/#musicFree> |
| User Terms | <https://mixkit.co/terms/> |
| Downloaded | 2026-10-13 |
| File | `mixkit-ramp-it-up-69.mp3`, MP3, 256 kbps, 44.1 kHz stereo, 102.13 s |
| MD5 | `eea11c69fe4b634318f2a2d8d393d589` |
| Attribution | Not required. The license grants its rights with no credit condition. |

## Key license terms (verbatim, retrieved 2026-10-13)

From the Mixkit Stock Music Free License:

> Allowed: Podcasts · Social Media video posts · Online marketing ads ·
> Educational Purposes · YouTube videos*
>
> Not Allowed: CDs & DVDs · TV & Radio Broadcasts · Video Games

> "Items under the Mixkit Stock Music Free License can be used in your
> commercial and non-commercial projects for free."

> "You're permitted to download, copy, modify, distribute and publicly
> perform the Music Items on any web or social media platform, including
> internet-based video on demand services, podcasts and advertisements."

> "You're not allowed to use them in CDs or DVDs, video games or tv or radio
> broadcast. You're also not allowed to remix them (or incorporate in a
> music-only track), claim them as your own or register them on any rights
> management service."

> "* If you receive a claim, please forward the details to team@mixkit.co
> for assistance."

From the Mixkit User Terms: "by downloading Items on Mixkit you are only
receiving a non-exclusive license to use that Item. You do not acquire any
rights of ownership in that Item."

## What this means for the promo

- **Allowed:** commercial use of the promo on the web, on social media,
  as an online ad and on the product's landing page; trimming, cutting and
  fading the track to fit the video.
- **Never** register the music, or the video's audio, with YouTube Content
  ID or any other rights-management service.
- **Never** redistribute the MP3 on its own, and never publish a
  music-only edit or remix of it.
- **Never** use the promo in TV or radio broadcasts, on CDs or DVDs, or in
  games.
- **If a claim appears** (for example on YouTube), forward its details to
  team@mixkit.co.

## The edit used

The video uses two segments of the track, cut on bar starts of its 120 BPM
grid (see `src/music.ts`):

1. source 9.146-49.146 s (bars 5-24) at video 0-40 s, with a 0.5 s fade-in;
2. source 65.146 s (bar 33) to the track's natural end at 100.43 s, at
   video 40-75.28 s, joined to the first with a 2-frame crossfade.

The edit plays at -4.2 dB, about -14 LUFS integrated.

## Where the file goes

Put the licensed file at:

```text
marketing/promo-video/public/music/mixkit-ramp-it-up-69.mp3
```

or set `PROMO_MUSIC_FILE` to its path; `npm run capture` copies it there.
Either way the capture checks the MD5 above before it starts.

`public/music/`, every `*.mp3`, and the rendered `*.mp4` and `*.webm`
files are gitignored. Never commit them, and never publish the MP3 or the
renders outside the uses listed above.
