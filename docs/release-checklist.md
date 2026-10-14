# Release checklist

What a BELL PR release must pass before the owner tags it, and what the
release-candidate QA found. Items marked **OWNER** need the owner's
machines, accounts or decisions; nobody else runs them. Nothing in this
list publishes, pushes or tags anything.

## 1.0.0-rc.1 (2026-10-14)

Checked on branch `ws/6A-rc-hardening` (wave 6), Linux x64, Node.js
22.22.1, npm 9.2.0, Docker Engine 29.7, Claude Code 2.1.292, codex-cli
0.159.0, gh 2.46.0.

### Release gates (local)

All run on Linux with Node.js 22. The CI matrix on GitHub (macOS, Node.js
24) runs only after a push: **OWNER**.

| Gate | Result |
| --- | --- |
| `npm run lint` | passed: 0 errors, 57 warnings (the same count as before the release-candidate changes) |
| `npm run build` (type-checks `scripts/` and `tools/` too) | passed |
| `npm test` | passed: 1036 tests |
| `npm run test:e2e` (`BELLPR_E2E_PORT=4561`) | passed: 185 tests, the screenshot set included |
| `node scripts/check-i18n.mjs` | passed: 246 files, nothing to translate |
| `node scripts/check-personal-info.mjs`, `--pack`, `--self-test` | passed |
| `node scripts/generate-third-party-notices.mjs --check` | passed: 79 bundled, 123 server packages |
| `node scripts/audit.mjs` | passed: 0 high or critical advisories |
| `npx tsx scripts/render-generated-regions.ts --check` | passed: 41 regions in 8 files |
| `node scripts/check-pack.mjs` | passed: 965.6 kB packed, 69 files, startup JS chunk 97.8 kB gzip, all JS 350.0 kB gzip (budget 370 kB) |
| `node scripts/sync-package-meta.mjs --check` | passed: `homepage`, `bugs` and `repository` absent while `shared/product.ts` leaves them empty |
| `node scripts/tokenize-css.mjs --check` | passed |
| `node scripts/release-dry-run.mjs` | passed: build, test, pack, check-pack, SHA256SUMS, release notes from `[1.0.0-rc.1]`, `npm publish --dry-run --tag next`, `docker build`. Nothing was published |
| `docker buildx build --platform linux/amd64,linux/arm64 .` (no `--push`) | **OWNER**: buildx is installed, but QEMU emulation for arm64 is not |
| `grep -rnw Github src`; `git grep -nE "agentEnvironment\(\)" -- server ':!*.test.ts'`; `git grep -nE "BEGIN (PRIVATE\|ED25519)" -- .` | all empty |

### Real-agent QA

Six sessions, the most the plan allows. Each session is one BELL PR
operation that starts agent CLIs. The fixtures were three small JavaScript
projects (three source files and a `node:test` test each), committed in
throwaway Git repositories without an `origin` remote, so runs used the
local branch and never fetched. The server ran from the packed build with
`start --no-open --port 4562` and a temporary data directory, the real
`HOME` (for the CLI sign-ins) and a stand-in `gh` first on `PATH` that logs
each call and exits 1.

| # | Session | Provider and locale | Setup | Agent processes | Result |
| --- | --- | --- | --- | --- | --- |
| 1 | Claude sandbox canary | Claude Code 2.1.292 | `agent-sandbox-canary.mjs --real --provider claude --decoy-home` | 1 | passed |
| 2 | Codex canary | codex-cli 0.159.0 | `--real --provider codex --decoy-home` | 1 | passed |
| 3 | Team run: fix two bugs and add tests | Codex, **en** | CLI default model (gpt-6.1-sol), effort low, 2 teammates, no plan approval | 9 | in review after 3 min 51 s: 3 subtasks done, 3 files explained, PR draft prepared |
| 4 | Team run: add Kelvin conversion | Claude Code (Sonnet), **zh-TW** | effort low, 2 teammates, no plan approval | 8 | in review after 2 min 11 s: 2 subtasks done, 3 files explained, PR draft prepared |
| 5 | Project analysis | Claude Code (Sonnet), **en** | effort low | 1 | 3 recommendations, none dropped by the evidence check |
| 6 | Spare: Claude canary with web access on | Claude Code 2.1.292 | `--real --provider claude --decoy-home --web` | 1 | passed; WebFetch allow rules did not open the shell sandbox's network |

The spare session answered the open question of whether Claude Code's
`WebFetch(domain:…)` allow rules widen the sandbox's network allowlist. A
draft preparation in English already ran inside session 3 (the team run
prepares the PR draft and the explanations itself), so it needed no session
of its own; a follow-up chat question was not run live (see below). Two
requests were refused before any agent started and are not sessions: a
Claude Code reasoning effort with the CLI's default model (the API asked to
choose a model from the catalog), and an analysis request sent without a
JSON body (415).

**Metrics** (objective definitions from the plan):

| Metric | Session 3 (Codex, en) | Session 4 (Claude Code, zh-TW) | Session 5 (Claude Code, en) | Target |
| --- | --- | --- | --- | --- |
| Han ratio in agent-written fields (reports, explanations, draft guidance, team plan, tasks and messages, agent log lines, insights) | **0.00 %** (0 of 37,062 characters) | 45.1 % (10,843 of 24,037) | **0.00 %** (0 of 4,192) | en < 1 %; zh-TW prose > 30 % |
| PR title and description in English | yes: "Fix truncate boundaries and whitespace word counting" | yes: "Add Kelvin temperature conversion and formatting" (0 Han characters in 2,248) | n/a | English |
| `agent.output_retry` events in `<data>/logs/*.log` | 0 | 0 | 0 | 0 |
| "format incomplete" errors on any run or analysis | none | none | none | none |

- Session count: **6** (limit 6).
- Stand-in `gh` log: three calls, all `gh --version` from the environment
  doctor; every call exited 1, so no network-bound `gh` command ran, let
  alone succeeded.

**Cap pressure** (the longest value of each capped agent-output field, in
characters):

| Field (cap) | Session 3 en | Session 4 zh-TW | Session 5 en |
| --- | --- | --- | --- |
| Explanation paragraph (1,800) | 276 (15 %) | 147 (8 %) | |
| Explanation lookup term (80) | 23 (29 %) | 18 (23 %) | |
| Draft title (180) | 52 (29 %) | 48 (27 %) | |
| Draft body (60,000) | 1,263 (2 %) | 1,280 (2 %) | |
| Draft summary (2,400) | 796 (33 %) | 254 (11 %) | |
| Draft checklist item (1,200) | 298 (25 %) | 147 (12 %) | |
| Team plan summary (6,000) | 883 (15 %) | 617 (10 %) | |
| Team task title (200) / description (4,000) | 44 (22 %) / 434 (11 %) | 17 (9 %) / 398 (10 %) | |
| Team message (2,000) | 212 (11 %) | 216 (11 %) | |
| Agent report (24,000) | 2,916 (12 %) | | |
| Insights text (2,400) | | | 573 (24 %) |
| Recommendation title (160) | | | 72 (45 %) |
| Evidence quote (600) | | | 128 (21 %) |

No English output reached 80 % of a cap, so no cap was raised in this
release (the rule: raise by 1.5x, within the lenient read caps, only at
80 % or more).

**Coverage limits.** The plan's full matrix (at least three runs per
provider and locale) does not fit in six sessions; it is covered offline by
the prompt-language tests (`server/prompt-language.test.ts` and the prompt
tests in `server/{team,insights,explanations,drafts,discovery,followups,sync}.test.ts`,
with stand-in CLIs). Not run live in this release candidate: a follow-up
chat question, discovery and follow-up rounds (they need GitHub), and
publishing (**OWNER**, below).

### Sandbox canary

Linux results, with the CLI versions, are in
[security-model.md](security-model.md#results). No exfiltration attempt
succeeded on Claude Code 2.1.292, so Claude write mode stays on by default
inside its sandbox. The macOS canary is **OWNER**.

### Docker smoke

- [x] `docker build -t bell-pr:rc .` (also built by the release dry run).
- [x] Run on `127.0.0.1:4567:4311` with temporary volumes; the container
  reported healthy within seconds, and the log showed
  `BELL PR 1.0.0-rc.1` with its sign-in link.
- [x] `docker exec … bell-pr open --print` printed a one-time link; it
  signed in once (200, then 401), and `/api/status` answered 200 with the
  session.
- [x] After `docker restart`, the old session cookie answered 401 and a new
  `bell-pr open --print` link signed in.
- [x] `bwrap`, `socat`, `codex`, `gh` and git 2.47.3 are in the image;
  `bell-pr doctor` runs in it.
- [x] Codex sandbox probe from [docker.md](docker.md) (no model call):
  with the default options `bwrap: No permissions to create a new
  namespace`; with the three `--security-opt` options the agent writes in
  its workspace, and a write to `/home/node` fails with "Read-only file
  system". The table in docker.md still holds, so the Docker **beta** label
  stays.
- Found and fixed: inside Docker the session cookie was named after the
  container's port (4311), so it still collided with an `npx` server on
  4311. The cookie is now named after the port in the browser's address.
- [ ] A real agent run in Docker with Codex (an API key or a dedicated
  login): **OWNER**. The QA did not mount the owner's CLI credentials into
  a container, to avoid OAuth token-rotation conflicts.

### License activation

- [x] With a throwaway Ed25519 key pair made by `tools/license/keygen.ts`
  in a temporary directory and one key from `tools/license/issue.ts`,
  injected through the test seam (`publicKeys`), never committed:
  `bell-pr license activate -` (the key on standard input) answered
  "License activated. Plan: Pro", `status --json` reported `pro`, and
  `deactivate` returned to Free. In the UI, Settings > License took the key,
  showed PRO with the license id, licensee, "Expires: never" and "Updates
  until Oct 14, 2027", the sidebar chip read PRO after a reload, and
  `license.json` was mode 0600. The key never appeared in any output.
- [ ] Real key activation: **OWNER GATE pending** (G3). The production
  public key is not in `server/license-keys.ts`, so 1.0.0-rc.1 ships with
  an empty key list: no license key unlocks Pro; the 14-day trial works.

### Screenshots

- [x] `e2e/screenshots.spec.ts` captured all 19 routes (Home, the sample
  run's four tabs, Repositories, the sample project, Discover, Agent team,
  Learning notes, the eight Settings sections and About) in English and
  zh-TW at 1280, 1440 and 390 px: 114 images in
  [`docs/images/en/`](images/en/) and [`docs/images/zh-TW/`](images/zh-TW/),
  with the sample project in presentation mode and a frozen clock.
  `expectNoOverflow` passed on every view, and the "Sample project" badge
  covers nothing in the top bar there and at 768 and 1024 px.
- Found and fixed: at 1280 px the diff toolbar's branch label and the file
  name were cut off in the narrow diff pane; the presentation "Sample
  project" badge covered the Approve button, and once moved to the top
  center, the page name at phone and tablet widths. It now sits in the top
  bar's own row.
- [ ] Visual review of the set by the product lead: **OWNER SIGN-OFF**.

### Manual QA

- [ ] macOS: **OWNER**.
- [x] Linux: everything in this section.
- [ ] Windows (WSL2), if a machine is available: **OWNER**.
- [x] `npx ./bell-pr-1.0.0-rc.1.tgz`: `--version` printed
  `BELL PR 1.0.0-rc.1 (built 2026-10-14)`; `start --no-open --port 4564`
  served `/api/health`, answered a page without a session with 401, and
  signed in with the printed link (the page then answered 200 text/html).
- [x] Global install into a temporary prefix
  (`npm install -g --prefix <dir> ./bell-pr-1.0.0-rc.1.tgz`): both
  `bell-pr` and `bellpr` run; the server signed in with the cookie
  `bellpr_session_4565`.
- [x] Docker: above.
- [x] Upgrade from 1.0.0-beta.0 with an existing data directory. The beta
  was packed from the last main commit whose `package.json` says
  `1.0.0-beta.0`, in a temporary worktree that was removed afterwards. The
  beta wrote a data directory (an imported project, a failed run, the
  trial, the zh-TW language, model settings); 1.0.0-rc.1 opened it with the same
  project, run, trial, language and settings and no recovery notice.
- [x] Downgrade readability: the beta opened that data directory again
  after 1.0.0-rc.1 had used it, and also opened the real-agent QA data
  directory after 1.0.0-rc.1 (two team runs with explanations and PR
  drafts, one analysis with three recommendations): every run, explanation,
  draft and recommendation read back, with no recovery notice.
- [x] `bell-pr open` after a restart: while stopped it exits 1 and says how
  to start; after the restart the old session cookie answers 401 and a new
  `bell-pr open --print` link signs in.
- [x] Lost sign-in link: `bell-pr open --print --data-dir <dir>` printed a
  one-time link that worked once (200, then 401); the page shown without a
  session names `bell-pr open` and `bell-pr open --print`.

### Defects fixed in the release candidate

- The session cookie is named after the port in the browser's address, so
  `npx` and Docker on one computer no longer sign each other out.
- Recovery notes on interrupted runs follow the language saved in the app,
  not `BELLPR_LOCALE`.
- Re-check in Settings > Environment looks for bubblewrap and socat again.
- "Measure again" in Settings > Data & privacy measures again instead of
  showing the minute-old report.
- The AI-disclosure switch shows what the description holds until a choice
  is saved; the suggestion keeps the line that the setting or the project's
  rules ask for, so applying it adds the line.
- The message for a local project that cannot be updated says what to do
  now that BELL PR clones local projects.
- GitHub projects are cloned in full, so private repositories and
  sandboxed agents can read old file contents.
- The diff toolbar and the file name fit a narrow diff pane; the
  presentation badge sits in the top bar's row, covering neither the
  Approve button nor the page name; the sample run shows its efficiency
  mode.
- The command palette, the learning page and the task and model dialogs
  load on demand (startup chunk 106.3 kB to 97.8 kB gzip); the welcome
  screen has its own error boundary; the document title is left to the app
  shell, and the start and Welcome screens carry the app's title in the
  reader's language.
- The license CLI uses the locale's colon; log files stop when the
  Workbench shuts down; a flaky store test is deterministic.
- The real sandbox canary can run against a decoy home, check web access,
  and list token variable names only.
- The deprecated demo aliases and re-exports are gone.

### Owner verification before the release

- [ ] Publish one Draft PR against a disposable public repository with a
  test GitHub account, then close it.
- [ ] One live discovery run with the trial.
- [ ] The GitHub Actions CI matrix (macOS, Node.js 24) and the release
  workflow's `workflow_dispatch` `dry_run`, after pushing main to the
  private origin.
- [ ] The macOS sandbox canary and an app run on macOS; a WSL2 run if a
  machine is available.
- [ ] A Docker run with a real Codex agent (an API key or a dedicated
  login).
- [ ] Real license key activation (G3).
- [ ] The multi-architecture image build (`docker buildx build --platform
  linux/amd64,linux/arm64 .`, without `--push`).
- [ ] Review the screenshot set in `docs/images/`.
