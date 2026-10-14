# Privacy and your data

BELL PR runs on your computer. There is no BELL PR cloud service, no BELL
PR account, no telemetry, no analytics, no crash reporting and no license
server: the app never contacts its maker. Its web interface loads nothing
from other sites, and its content security policy blocks requests to them.

This page describes what BELL PR stores, what leaves your computer and how
to delete it. The privacy policy in [PRIVACY.md](../PRIVACY.md) is the
binding text (it is a draft pending counsel review in this release).

## What leaves your computer

BELL PR works through tools you installed and signed in to yourself. They
send data to their providers under your own accounts, and each provider's
terms and privacy policy decide what it keeps and for how long.

**The AI coding CLI you choose** (the Codex CLI, or Claude Code with the
provider you set it up for). It receives:

- the instructions BELL PR writes for each task, including the
  contribution direction you describe and the plan you approved;
- source code and other files of the project you imported: the files the
  agents open, the excerpts BELL PR selects for project analysis, the
  diffs, and the project's contribution guides and templates;
- the output of the commands agents run in the working copy, such as
  builds and tests;
- your follow-up questions about a change, with the code and notes they
  refer to;
- for discovery, summaries of the GitHub projects the search found.

Do not import a project if your AI provider must not see its code.

**GitHub, through the GitHub CLI and Git.** Under your account, BELL PR
clones and fetches the projects you import, reads their issues,
contribution guides and templates, searches GitHub when you run
discovery, and reads review comments and check results when you ask for
maintainer feedback. It writes only after you approve: it creates a fork
when needed, pushes a branch and opens a Draft PR with the title,
description and commit you approved. Commits carry the Git name and e-mail
address you configured and become public; BELL PR asks once before it
publishes an address that is not a GitHub no-reply address.

**Web access for agents** (Pro, off by default). While you have it on,
agents in contribution runs and follow-up chat can search the web and read
pages through the AI CLI's own web tools. Search queries go to the
provider's search service and pages are fetched from the sites that host
them. The run log records the queries and addresses, never the page
contents. Project analysis and discovery never get web access. Leave it
off for confidential code.

## What BELL PR stores

Everything lives in one data directory: `~/.bellpr` by default, or the
directory you chose with `--data-dir` or `BELLPR_DATA_DIR`. BELL PR creates
it readable by your user only (mode 0700), and the files that hold secrets
with mode 0600.

| Item | What it holds |
| --- | --- |
| `state.json` | Your projects and runs: contribution directions, plans, agent logs and reports, review progress, explanations, follow-up questions and answers, notes and PR drafts. Token-shaped strings are masked in logs and questions before they are saved. |
| `state.json.bak.1` to `.bak.3`, `state.quarantine.json` | The last three versions of `state.json`, and records a damaged file could not load, so a crash or a bad write loses nothing. |
| `repositories/` | BELL PR's own clones of the projects you imported. A project imported from a folder on your computer is cloned too; your folder is never changed. |
| `worktrees/`, `team-worktrees/` | A working copy for each run and each teammate, with the changes the agents made. |
| `insights/` | Project analyses and recommendations. |
| `discovery.json` | Discovery preferences and results. |
| `model-settings.json` | The agent, model, reasoning effort and web-access choice. |
| `app-settings.json` | Language, limits, onboarding progress, the license-agreement version you accepted, safety settings and the retention period. |
| `license.json` | The license key you activated, when you activated it, the latest time BELL PR saw (to notice a clock set back) and the trial's start date. |
| `author-emails.json` | SHA-256 digests of the commit e-mail addresses you confirmed when publishing, never the addresses themselves. |
| `logs/` | Daily log files, at most 7 files and 50 MB, with secrets redacted. Prompts and page contents are never logged. |
| `children.json`, `bellpr.lock`, `run/` | The agent processes that are running (so a crash leaves none behind), the running instance's process id and port, and a one-time sign-in link that is deleted as soon as `bell-pr open` reads it. |

The session secret and the one-time sign-in tokens live only in the
memory of the running server and are never written to disk.

Your browser keeps, for this local site only: the language you chose,
layout preferences such as the code font size and the collapsed sidebar,
the sample project's review progress and drafts, and the sign-in cookie
(30 days). None of this reaches the server's data directory.

## How long it is kept

- Runs, notes and analyses stay until you delete them.
- The working files of **cancelled and failed** runs are removed after 14
  days without activity (**Settings → Data & privacy → Automatic cleanup**,
  or `BELLPR_RETENTION_DAYS`). The run's record, reports, explanations and
  notes stay.
- Runs in review, approved runs and published runs keep their working
  files until you free them: maintainers may answer weeks later, and
  syncing and follow-up rounds need the checkout.
- Logs rotate daily and keep at most 7 files and 50 MB.

## Deleting data

| To delete | Do this |
| --- | --- |
| A run's working files | **Settings → Data & privacy → Storage → Free space**, or **Free disk space** in the contributions list. The record and notes stay. |
| A run | **Delete run** in the contributions list (Workbench → View all contributions). |
| A project | **Delete repository** on the Repositories page. Its runs, notes and analysis go too, and so does BELL PR's clone. A folder you imported from your computer stays where it is. |
| Everything | **Settings → Data & privacy → Delete all data**, then type `ERASE`. Every project, run, analysis, discovery result, log and backup is deleted; your settings and license stay. Stop running work first. |
| The sample project's progress | **Settings → General → Reset sample project** (this browser only). |
| BELL PR itself | Stop it, delete the data directory (`~/.bellpr` by default), and uninstall with `npm uninstall -g bell-pr`. A copy run through `npx` sits in npm's cache. |

Data you sent to GitHub or to your AI provider is under that service's
control: delete it there, for example by closing a pull request or deleting
a fork, under that service's policies. BELL PR's maker never receives your
project data, so it cannot delete it for you.

## Diagnostics you choose to share

The About dialog can copy a diagnostics report to your clipboard: the app
version, the operating system, the versions and sign-in status of the
tools, the data directory size and recent log lines. Secrets, paths and
your GitHub login are replaced. It goes nowhere unless you paste it
somewhere, so read it before you send it.

See also the [security model](security-model.md) for what agents may read
and how the local server is protected.
