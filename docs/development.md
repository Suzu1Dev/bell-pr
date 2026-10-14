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
| `BELLPR_TEST_ENV_FILE_LOADED` | `server/cli.test.ts` | Marks that `--env-file` was loaded |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE` | Playwright configs, site checks, brand assets | Use an installed Chromium build |

## More

- [Security model](security-model.md), including the agent sandbox canary.
- [Brand](brand.md): the logo, colors and how to name other products.
- [Release checklist](release-checklist.md).
- `vendor/ponytail/README.md`: the pinned Ponytail rules behind the
  efficiency modes, with their license.
