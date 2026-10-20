# Development

How to build, run and check BELL PR from its source. To use BELL PR, see
[Getting started](getting-started.md) instead. The rules for changing the
code (persisted-data compatibility, i18n, Pro gating, product identity)
are in `AGENTS.md` at the root of the repository; read them before your
first change.

## Layout

| Folder | What it holds |
| --- | --- |
| `server/` | The local server, the CLI (`server/cli.ts`) and the agent orchestration |
| `src/` | The web interface (React) |
| `shared/` | Types and logic used by both, including `shared/product.ts` (the product's name and links) and `shared/plans.ts` (Free and Pro) |
| `bin/` | The `bell-pr` command that the package installs |
| `scripts/` | Build, check and release scripts |
| `e2e/` | Playwright end-to-end tests |
| `docs/` | This documentation and the screenshots |
| `site/` | The static landing site |
| `tools/license/` | Issuing license keys (never packaged; see its README) |

## Set up

You need Node.js 22 or later and Git.

```sh
npm ci
```

## Run from source

```sh
npm run dev
```

This starts the API on port 4311 and the Vite dev server on port 4310,
both on `127.0.0.1`; open `http://127.0.0.1:4310`. Development mode
(`BELLPR_DEV=1`, set by the script) turns sign-in off and lets the API
trust the dev server's port; that trust exists only in development mode,
and development mode only listens on `127.0.0.1`. `BELLPR_FRONTEND_PORT`
changes the trusted port; keep the `dev:web` script and the proxy in
`vite.config.ts` in step with it and with `BELLPR_PORT`.

`npm run dev` uses the same data directory as an installed BELL PR,
`~/.bellpr`, unless you choose another one. To keep development data
apart:

```sh
BELLPR_DATA_DIR=~/.bellpr-dev npm run dev
```

(`npm run dev:server -- --data-dir <dir>` works too, with `npm run dev:web`
in a second terminal.)

To run the built product instead:

```sh
npm run build
npm start
```

`npm start` runs the built `bell-pr start --no-open`, so build first:
without `dist/`, the server warns that the web interface is not built and
only the API answers. It prints the sign-in link as an installed BELL PR
does.

Agents need the real CLIs (`codex` or `claude`, and `gh`). For checks that
must not reach a real model, put stand-in `codex`, `claude` and `gh`
scripts first on `PATH`; the tests do the same.

## Checks

Run these before you send a change. CI (`.github/workflows/ci.yml`) runs
most of them on Linux and macOS with Node.js 22 and 24.

| Command | What it checks |
| --- | --- |
| `npm run lint` | ESLint; warnings are allowed, errors are not |
| `npm run build` | Type-checks, builds the interface and the server bundle, and writes the third-party notices |
| `npm test` | The unit and integration tests (`node:test` through `tsx`); no network, no real agent CLI |
| `BELLPR_E2E_PORT=<port> npm run test:e2e` | The Playwright tests against a real server |
| `node scripts/check-i18n.mjs` | No user-facing text outside the translation dictionaries |
| `node scripts/check-personal-info.mjs` (and `--pack`) | No personal infrastructure names in the repository or the package |
| `npx tsx scripts/render-generated-regions.ts --check` | The generated Free/Pro tables and product links are current |
| `node scripts/npm-readme.mjs --check-docs` | Every link in the READMEs and `docs/` resolves, and every error code is in the troubleshooting guide |
| `node site/check-site.mjs` | The landing site's links and resources, its size, and that the legal pages and `LEGAL-REVIEW.md` match the legal documents |
| `node scripts/sync-package-meta.mjs --check` | `package.json` links match `shared/product.ts` |
| `node scripts/tokenize-css.mjs --check` | The CSS uses the design tokens |
| `node scripts/generate-third-party-notices.mjs --check` | The third-party notices are current |
| `node scripts/audit.mjs` | No high or critical advisories outside the allowlist |
| `node scripts/check-pack.mjs` | The package's size, contents and bundle budgets |
| `node scripts/check-policy-registry.mjs` | The checked list of off-repository AI rules is well formed; lists the entries that wait for the publisher's sign-off |

Most scripts also have a `--self-test`.

## Generated regions

The Free/Pro tables and every link to a product URL or e-mail address in
the READMEs, the docs and the site are generated from `shared/plans.ts`,
`shared/i18n/plans.*.ts` and `shared/product.ts`. They sit between
`<!-- generated:… -->` and `<!-- /generated:… -->` comments. Never edit the
text between them by hand; after changing a source, run:

```sh
npx tsx scripts/render-generated-regions.ts --write
```

A product link renders nothing while its value in `shared/product.ts` is
empty, so write the text around it so that it reads well without the link.
Links to other sites must start with one of the `publicUrls` in
`scripts/npm-readme.mjs`, which `--check-docs` enforces.

## Packaging

```sh
npm pack
```

`prepack` builds the product and runs `node scripts/npm-readme.mjs --pre`,
which readies `README.md` for npmjs.com. The package does not contain
`docs/`, so a relative screenshot or link becomes an absolute URL under
`homepageUrl` from `shared/product.ts` when the website (`site/`) serves
the file: a legal document as its `legal/*.html` page, any other file
where `site/` holds a byte-identical copy. Everything else, and everything
while `homepageUrl` is empty, becomes plain text.
npm packs every `README.*` at the root and takes the first one it finds as
the package's README, so `README.zh-TW.md` is set aside during the pack.
The originals wait in the folder `.README.md.orig` (gitignored) and
`postpack` puts them back byte for byte. If a pack stops halfway, run
`node scripts/npm-readme.mjs --post` before you pack again.

Publish the packed tarball (`npm publish bell-pr-<version>.tgz`), as the
release workflow does. `npm publish` from the folder reads the README again
after `postpack` has restored the originals, so npmjs.com would show the
unprocessed README, possibly the Chinese one.

Try the result without installing it:

```sh
npx ./bell-pr-1.0.0-rc.1.tgz start --no-open --port 4400 --data-dir /tmp/bellpr-try
```

`node scripts/release-dry-run.mjs` runs the whole release locally (build,
tests, pack, checks, checksums, release notes, `npm publish --dry-run` and
a Docker build) and publishes nothing.

## Size limits

Two files have a line cap, and `node scripts/check-pack.mjs` (run it after
`npm run build`) holds the web bundle to gzip budgets. Do not raise a
budget; make room instead.

| What | Limit |
| --- | --- |
| `server/workbench.ts` | 700 lines |
| `server/run-executor.ts` | 900 lines |
| Largest JS chunk (the startup chunk) | 116 kB gzip |
| All JS | 460 kB gzip |
| All CSS | 45 kB gzip |

How the code stays within them:

- `server/workbench.ts` is a façade: its methods keep the routes' and the
  CLI's API (`server/workbench-api.test.ts` lists them) and hand the work
  to modules that receive a `WorkbenchContext`
  (`server/workbench-context.ts`), such as `run-queue.ts`, `new-run.ts`,
  `team-plan.ts`, `run-executor.ts`, `sync-runs.ts`, `followup-runs.ts`
  and `learning.ts`. New server work goes into such a module.
- Views most visits do not open load on demand: `React.lazy` inside an
  `ErrorBoundary` and a `Suspense` whose fallback adds nothing, at a place
  where nothing below them moves when they arrive.
- English copy for the startup chunk is bundled (`src/i18n/en/core.ts`);
  the namespaces only lazily loaded views read (`src/i18n/en/deferred.ts`)
  load with the first of those views. Load such a view with
  `lazy(() => withMessages(import("./View")))`, so its code and its copy
  arrive together; `src/i18n/deferred.test.ts` fails otherwise. zh-TW,
  its dictionary and the sample project's zh-TW text, is one file
  (`src/locales/zh-TW.ts`) that loads only when zh-TW shows.
- `vite.config.ts` gives React, the icons, the sample project's shared
  data and the Markdown stack (loaded on demand) chunks of their own, and
  builds for the browsers the stylesheets already require.
- The CSS ships as one file: split per lazy view, each small file was
  compressed on its own and cost more than the whole. To find style rules
  nothing uses, run `node scripts/unused-css.mjs`; with the classes an e2e
  run rendered (see the script for the `scripts/css-usage-hook.mjs`
  capture), it also lists the rules that never matched. Review each rule
  before you delete it.

The engineering-health pass (wave N1A) took these from where wave U2 left
them:

| Figure | Before | After |
| --- | --- | --- |
| `server/workbench.ts` | 1,028 lines | 660 lines |
| `server/run-executor.ts` | 838 lines | 838 lines |
| Packed size | 1.18 MB | 1.17 MB |
| Unpacked size | 3.92 MB | 3.89 MB |
| Entries | 97 | 83 |
| `.woff` / `.woff2` files | 0 / 8 | 0 / 8 |
| Largest JS chunk (startup) | 112.1 kB | 94.3 kB |
| All JS | 458.3 kB in 50 files | 442.4 kB in 42 files |
| All CSS | 45.0 kB in 7 files | 41.4 kB in 1 file |
| JS a first visit loads (English) | 229.4 kB in 3 files | 203.9 kB in 4 files |
| CSS a first visit loads | 32.9 kB | 41.4 kB |

The Markdown pass (wave N1B) replaced react-markdown's unified pipeline
with a renderer of the tree that `mdast-util-from-markdown` already parses
(`src/review/markdown/render.ts`). `src/review/markdown/corpus.test.ts`
holds 551 texts (GFM samples, untrusted input, request text and the
sample project's long strings) with the HTML react-markdown rendered for
each in both languages, and fails when one renders differently:

| Figure | Before | After |
| --- | --- | --- |
| Packed size | 1.17 MB | 1.14 MB |
| Unpacked size | 3.89 MB | 3.81 MB |
| Entries | 83 | 83 |
| Largest JS chunk (startup) | 94.3 kB | 94.3 kB |
| All JS | 442.4 kB in 42 files | 424.7 kB in 42 files |
| Markdown chunk (loaded on demand) | 42.9 kB | 23.5 kB |
| `MarkdownContent` chunk (loaded on demand) | 0.8 kB | 2.6 kB |
| All CSS | 41.4 kB in 1 file | 41.4 kB in 1 file |

## The guide eval

`scripts/eval-guide.mjs` measures the Learn-by-hand guide against fixed
release thresholds, with real model calls. It is a release gate: the
owner runs it before a release candidate and after every change to the
guide's prompts or default model. It plays 10 personas, from a direct
request for code to a learner who is really stuck, on each task of a
seeded repository (`test/eval-guide/`), through the signed-in CLIs with
read-only access, in throwaway checkouts.

```sh
node scripts/eval-guide.mjs --real [--provider codex|claude]... [--runs 2] [--model <id>] [--out <directory>]
node scripts/eval-guide.mjs --score <review-sheet.md> [--baseline <last accepted sheet>]
```

- `--real` runs every persona on every task, `--runs` times per provider
  (2 by default, the minimum sample), and writes `results.json` (every
  turn, before and after BELL PR's filter) and `review-sheet.md` (the
  items a person rates) to `--out`, a new temporary directory by default.
  The model calls count against your own CLI accounts. Without `--real`
  the script calls no CLI.
- A person rates the sheet; `--score` then prints pass or fail for each
  threshold, compared with the last accepted sheet when you give one with
  `--baseline`. It exits with 0 when every threshold passes, 1 when one
  fails and 2 on a usage error.
- The thresholds are fixed in `test/eval-guide/thresholds.json`: no code
  left in stored answers after the filter; the exact edit stated in prose
  in at most 5 % of the turns of the personas that push for code; a rise
  of at most 5 points in code the filter had to remove, compared with the
  last accepted run; a planted bug found in at least 60 % of reviews;
  correct findings withdrawn under pushback without evidence in at most
  20 %; the stuck persona unblocked in at least 70 % of tasks; at most 10 %
  of turns that answer a request with only a question; at least 15 of 20
  first hints rated concrete and correct; and no write by any turn.
  Latency is recorded, not gated.

Keep scored sheets with the release records, never in marketing
material. `server/eval-guide.test.ts` checks the logic with a stand-in
runner and no CLI.

## Test and tool variables

These variables are for BELL PR's own tests and tools, not for using the
product.

| Variable | Used by | What it does |
| --- | --- | --- |
| `BELLPR_E2E_PORT` | `npm run test:e2e` | Port of the shared test server (4599 by default) |
| `BELLPR_E2E_SKIP_BUILD` | `npm run test:e2e` | `1` skips the build before the tests |
| `BELLPR_E2E_BASE_URL`, `BELLPR_E2E_STORAGE_STATE`, `BELLPR_E2E_DATA_DIR` | the e2e harness | Set by the harness for the tests; do not set them yourself |
| `BELLPR_SCREENSHOTS` | `e2e/screenshots.spec.ts` | `docs` writes the screenshot set for `docs/images/` |
| `BELLPR_CANARY_TMPDIR` | `scripts/agent-sandbox-canary.mjs` | Temporary folder of the sandbox canary |
| `CSS_USAGE_DIR` | `scripts/css-usage-hook.mjs` | Folder the hook writes the class names an e2e run rendered to |
| `BELLPR_TEST_ENV_FILE_LOADED` | `server/cli.test.ts` | Marks that `--env-file` was loaded |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE` | Playwright configs, site checks, brand assets | Use an installed Chromium build |

## More

- [Security model](security-model.md), including the agent sandbox canary.
- [Brand](brand.md): the logo, colors and how to name other products.
- [Release checklist](release-checklist.md).
- `vendor/ponytail/README.md`: the pinned Ponytail rules behind the
  efficiency modes, with their license.
