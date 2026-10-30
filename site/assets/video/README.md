# Promo video assets

- `poster.jpg` and `captions.en.vtt` are tracked here.
- The self-hosted `bell-pr-promo-en-1080p.webm` and `.mp4` binaries are
  deploy-only (they exceed the site's 5 MB check budget). Production serves
  them at https://bell-pr.suzu.tw/assets/video/.
- The landing pages reference those filenames with relative `<source>` tags so
  a full deploy tree (this folder plus the two binaries) is self-contained.
  `check-site.mjs` treats missing `.mp4`/`.webm` under this folder as optional.
