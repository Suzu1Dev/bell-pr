# Contributing to BELL PR

Thank you for helping. BELL PR is a tool that asks people to contribute
responsibly, so it asks the same of you: small, understood, honest changes.

By taking part, you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- **Open an issue first** for anything bigger than a typo or a one-file bug
  fix. Say what problem you want to solve and for whom. This avoids work
  that cannot be merged.
- Search the existing issues and pull requests, so nobody does the same work
  twice.
- **Security problems** do not go in public issues. Follow
  [SECURITY.md](SECURITY.md).

## Set up

You need Node.js 22 or later and Git. See
[docs/development.md](docs/development.md) for the layout, how to run from
source and the checks.

```sh
npm ci
npm run dev
```

## What a good pull request looks like

- **One purpose.** Keep it reviewable: no formatting-only changes, no
  repository-wide reformatting, no unrelated cleanups.
- **You understand every line.** If AI tools helped write it, say so in the
  description, and be ready to explain why the change is right. Do not send
  changes you cannot explain.
- **Tests that tell the truth.** Add or update a test for the behavior you
  change. Never weaken, skip or delete a test to make a check pass.
- **Docs move with the code.** The READMEs and `docs/` describe shipped
  behavior; update them in the same pull request.
- Say how you checked it: the commands you ran and what you saw.

## Checks to run

```sh
npm run lint
npm run build
npm test
node scripts/check-i18n.mjs
```

Run the end-to-end tests (`npm run test:e2e`) when you change the interface.
[docs/development.md](docs/development.md) lists every check.

## Project rules

1. No user-facing text outside the i18n dictionaries (English and
   Traditional Chinese). Run `node scripts/check-i18n.mjs`.
2. Product identity, URLs and e-mail addresses come only from
   `shared/product.ts`. An empty value hides the link; never invent one.
3. Data written to disk must stay readable by older builds: every new field
   in `state.json` and the other stored files is optional, and the shared
   type, the server schema and the frontend type change in the same commit.
   See [AGENTS.md](AGENTS.md).
4. Understanding and maintainer-respect checks are never gated and are never
   weakened: they are the point of the project.
5. A new dependency needs a stated reason in the pull request.
6. No personal infrastructure names, paths or addresses in tracked files.
   Run `node scripts/check-personal-info.mjs`.

## Sign your work (DCO)

Add a `Signed-off-by` line to every commit with `git commit -s`. It states
that you wrote the change or have the right to submit it under this
project's license, as in the
[Developer Certificate of Origin](https://developercertificate.org/).

By submitting a contribution you license it under the
[Apache License 2.0](LICENSE), the same license as the project, as section 5
of that license says.

## Using BELL PR on other projects

BELL PR checks a project's own contribution rules before you publish. Read
them yourself too. Some projects do not accept AI-assisted contributions at
all. See [docs/contributing-responsibly.md](docs/contributing-responsibly.md).
