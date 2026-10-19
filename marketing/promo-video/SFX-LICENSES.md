# Sound effects: sources and licence

Six sound effects, all from Mixkit under the **Mixkit Sound Effects Free
License**. The files live in `public/sfx/` (gitignored, never committed);
`npm run assets` downloads each from Mixkit's own asset URL and checks its
MD5. They are unmodified downloads: `src/sfx.ts` trims, fades and levels
them in Remotion, and places each from the cut, so the frames below follow
the timeline.

The licence text renders client-side, so it was read in a browser (Chrome
headless shell 1243 through Playwright, the "Sound Effects · Free License"
modal of <https://mixkit.co/license/>) on the day of download. The item
titles were read in Mixkit's listing pages, in the card that holds each
item id.

## Licence key terms (verbatim, retrieved 2026-10-18 from <https://mixkit.co/license/#sfxFree>)

> Sound Effects Free License
>
> Sound Effects under the Free license can be used in
> YouTube videos / Social Media video posts / Online marketing ads /
> Educational Purposes / Music videos / Commercial projects / Filmmaking /
> Video games / TV & Radio broadcasts / CDs & DVDs

> Items under the Mixkit Sound Effects Free License can be used in your
> commercial and non-commercial projects for free.

> You are licensed to use the Item to create an End Product that
> incorporates the Item as well as other things, so that it is larger in
> scope and different in nature than the Item. You’re permitted to download,
> copy, modify, distribute and publicly perform the Sound Effect Items on
> any web or social media platform, in podcasts and in video games, as well
> as in films and presentations distributed on CDs, DVDs, via TV or radio
> broadcast or internet based video on demand services.

> You can’t redistribute the Item on its own, as stock, in a tool or
> template, or with source files. You’re also not allowed to claim them as
> your own or register them on any rights management service.

> There are some important limits to these rights, described in our User
> Terms.

What this means here: the effects may be used inside the film (an end
product larger in scope than the item) wherever the film is published; no
attribution is required; the WAV files are never published on their own
(they stay gitignored) and never registered with a rights-management
service. The Mixkit User Terms (<https://mixkit.co/terms/>) are an owner
read before publishing.

## The files

| File (`public/sfx/`) | Mixkit item | Listed at | Format | MD5 |
| --- | --- | --- | --- | --- |
| `mixkit-vacuum-swoosh-transition-1465.wav` | "Vacuum swoosh transition", 1465 | <https://mixkit.co/free-sound-effects/swoosh/> | PCM 16-bit, 44.1 kHz stereo, 2.26 s | `ef44f36fe821092b514092e1579609ef` |
| `mixkit-air-woosh-1489.wav` | "Air woosh", 1489 | <https://mixkit.co/free-sound-effects/whoosh/> | PCM 24-bit, 44.1 kHz stereo, 2.32 s | `7237076096e8772ecc9219f79dcf4315` |
| `mixkit-cinematic-wind-swoosh-1471.wav` | "Cinematic wind swoosh", 1471 | <https://mixkit.co/free-sound-effects/swoosh/> | PCM 24-bit, 44.1 kHz stereo, 1.45 s | `ff341012fc5a78bf22efa0c425440fdf` |
| `mixkit-fairy-magic-sparkle-871.wav` | "Fairy magic sparkle", 871 | <https://mixkit.co/free-sound-effects/sparkle/> | PCM 16-bit, 44.1 kHz stereo, 1.30 s | `749017de847d7846002812a8e5bb58ec` |
| `mixkit-clear-mouse-clicks-2997.wav` | "Clear mouse clicks", 2997 | <https://mixkit.co/free-sound-effects/click/> | PCM 16-bit, 44.1 kHz stereo, 1.05 s | `f85d3fac793cb7528d62aa8efb6b57a7` |
| `mixkit-typing-on-a-laptop-keyboard-2531.wav` | "Typing on a laptop keyboard", 2531 | <https://mixkit.co/free-sound-effects/click/> | PCM 16-bit, 44.1 kHz stereo, 19.63 s | `09a19557818475ec115cd7d64526bdd3` |

Every file: download URL `https://assets.mixkit.co/active_storage/sfx/<id>/<id>.wav`
(the file behind the item's download modal, `https://mixkit.co/free-sound-effects/download/<id>/`);
licence Mixkit Sound Effects Free License, <https://mixkit.co/license/#sfxFree>;
downloaded 2026-10-18; attribution not required (the licence sets no
credit condition).

## Where each is used (the cut on the current analysis)

| File | Used at (film frames) | Gain | How |
| --- | --- | --- | --- |
| 1465 vacuum swoosh | 273-290 | -15.5 dB | the air swell through the exhale of the stop; it starts 0.97 s into the file so its loudest frame would fall on the first hit, and the sequence ends one frame before the hit (nothing is stacked on the crash); 4-frame fade-in, 1-frame fade-out |
| 1489 air woosh | 341-391, 1493-1543 | -17 dB | peaks on the frame before S3's window lands from its rise (363) and before the "lights on" cut to S9's floating window (1515) |
| 1471 wind swoosh | 854-895, 1862-1903 | -17 dB, -21 dB (the calm section) | peaks on the frame before the cuts to S6's and S11's floating windows (867, 1875) |
| 2997 clear mouse clicks | the first click only (5 frames), at every on-screen click: 759, 952, 971, 1006, 1186, 1219, 1314, 1337, 1364, 1646, 1691, 1766, 1968, 2001, 2161, 2359 | -19.5 dB | a quiet, dry tick under the drawn pointer's press; alone it peaks under -20 dBTP |
| 2531 laptop keyboard | 879-932, 1120-1166, 1228-1278, 1530-1573, 1589-1623, 1776-1794 | -19 dB | a sparse bed while an answer types out (the file itself is a soft -20.5 LUFS), a different stretch of the file each time, 3-frame fade-in, 4-frame fade-out |
| 871 fairy magic sparkle | 2446-2481 | -24 dB | the one glint: its onset on the final chord (2451), as the end-card logo locks there; quieter than before (a touch of air under the chord). Whether it suits the film, or a softer tonal shimmer should replace it, is for the owner's listen |

Levels sit well under the music, measured against a music-only render at
each moment: the swell 16.7 dB under, the whooshes 17-25 dB, the glint
about 24 dB, the ticks and the keyboard bed 25-30 dB. Alone, no effect peaks above
-16.2 dBTP and no tick above -20 dBTP; the full mix measures the same
integrated loudness as the music alone (-14.01 LUFS). The mix by ear is an
owner sign-off.
