# Privacy and your data

BELL PR runs on your computer. There is no BELL PR cloud service, no BELL
PR account, no telemetry, no analytics and no crash reporting: the app
never contacts a server run by its maintainers, because there is none.
Its web interface loads nothing from other sites, and its content security
policy blocks requests to them.

This page describes what BELL PR stores, what leaves your computer and how
to delete it. BELL PR is community-maintained open-source software, and no
BELL PR operator receives your data. You run it, so you are the controller
of the data it holds: where it is stored, who can read it and when it is
deleted are decisions you make.

## What leaves your computer

BELL PR works through tools you installed and signed in to yourself. They
send data to their providers under your own accounts, and each provider's
privacy policy decides what it keeps and for how long.

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
  refer to, and the review comments on that file once you have read your
  pull request's feedback;
- for a follow-up round, the review comments you selected, with your
  restatement of each one;
- for a coach debrief (only when you ask for one), your own records
  for that project: your explanations and answers from the understanding
  check with your grades and corrections, the approaches you chose and
  why, your forecasts, and the maintainers' comments with your tags;
- for discovery, summaries of the GitHub projects the search found.

Your understanding checks, try-first answers, practice grades and
forecasts are never sent to the AI provider except in a coach debrief you
ask for. The check itself makes no AI call: you grade your own answers.

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

### What BELL PR reads from GitHub before you publish

To check that a pull request is welcome, BELL PR makes these read-only
calls through `gh api`, on your computer and under your GitHub account.
It never posts anything with them, nothing polls GitHub, and the answers
feed the checks and are stored with the project or the run. The first
three are never sent to your AI provider. Feedback you read reaches it
only as listed above: the comments on a file you ask a question about,
the comments you select for a follow-up round, and the comments in a
coach debrief you ask for. A project without a GitHub
origin never runs `gh`.

| What it reads | When |
| --- | --- |
| The repository's pull request settings (`has_pull_requests`, `pull_request_creation_policy`, `archived`, `disabled`), your permission level in it and your GitHub login, and the sizes of its last 3 merged pull requests | When you import a project from GitHub, update it or choose **Check again** on its **Before you contribute** card, when the publish dialog opens, and when you publish |
| The linked issue: its state and why it was closed, whether it is locked, its labels and assignees, its latest 50 comments (to find claims, the latest maintainer comment and whether you commented) and the pull requests that would close it or refer to it | Once per issue link in the task dialog, when the publish dialog opens, and when you publish |
| Three counts of your own pull requests in that repository: open (drafts included), merged, and open with changes requested more than 7 days ago, with links to up to 10 of those waiting on your answer | When you link an issue in the task dialog, when the publish dialog opens, and when you publish |
| Your pull request's reviews, comments, review threads, CI results, labels, state, whether it was merged and its review decision | When you choose **Read feedback** |

The project's own rule files are read from BELL PR's clone, without the
network, except the default contribution files of the project's account
(its `.github` repository), which BELL PR reads through `gh api` as it
does for pull request drafts.

**Web access for agents** (off until you turn it on). While you have it on,
agents in contribution runs and follow-up chat can search the web and read
pages through the AI CLI's own web tools. Search queries go to the
provider's search service and pages are fetched from the sites that host
them. The run log records the queries and addresses, never the page
contents. Project analysis and discovery never get web access. Leave it
off for confidential code.

### The AI CLIs' own usage data

The Codex CLI and Claude Code may send their own usage data, such as
telemetry and error reports, to their providers. BELL PR neither adds to it
nor turns it off. It starts each agent with only the environment variables
that CLI needs, plus these opt-outs when they are set in the environment
BELL PR runs in:

- `DO_NOT_TRACK`, passed to both CLIs;
- for Claude Code, the variables it documents: `DISABLE_TELEMETRY`,
  `DISABLE_ERROR_REPORTING`, `DISABLE_BUG_COMMAND`,
  `CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY`, and
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, which turns off all of its
  non-essential traffic.

BELL PR starts each Codex agent with `codex exec --ignore-user-config`, which
does not load `$CODEX_HOME/config.toml` (sign-in still uses `CODEX_HOME`). This
keeps your personal Codex settings out of the agents' work, but it also
means that a setting you made only in that file, such as
`[analytics] enabled = false`, does not apply to the agents BELL PR runs:
Codex's built-in defaults apply instead.

## What BELL PR stores

Everything lives in one data directory: `~/.bellpr` by default, or the
directory you chose with `--data-dir` or `BELLPR_DATA_DIR`. BELL PR creates
it readable by your user only (mode 0700), and the files that hold secrets
with mode 0600.

| Item | What it holds |
| --- | --- |
| `state.json` | Your projects and runs: contribution directions, plans, agent logs and reports, review progress, explanations, follow-up questions and answers, notes, PR drafts and the links between a run and the parts split from it. Also your learning records: your understanding checks (explanation, answers, confidence, grades, corrections, forecast and how long each check took), try-first answers and the approaches you chose, your tags and lessons on maintainer comments, your restatements for follow-up rounds, your practice schedule (grades and due dates only; practice answers are never saved), the reasons you gave for weakened tests or for publishing past someone else's pull request, and coach debriefs. And the GitHub facts BELL PR read: the rules quoted from each project's files, its pull request settings and recent merged pull request sizes, and for each run the linked issue's facts (including the GitHub logins of people assigned to it, claiming it or with a pull request for it, and the latest maintainer comment) and your pull request counts there, with links to up to 10 of your pull requests waiting on your answer. Token-shaped strings are masked in logs and questions before they are saved. |
| `state.json.bak.1` to `.bak.3`, `state.quarantine.json` | The last three versions of `state.json`, and records a damaged file could not load, so a crash or a bad write loses nothing. |
| `repositories/` | BELL PR's own clones of the projects you imported. A project imported from a folder on your computer is cloned too; your folder is never changed. |
| `worktrees/`, `team-worktrees/` | A working copy for each run and each teammate, with the changes the agents made. A part split from a run gets its own working copy, started from the same base commit and holding its own files. |
| `insights/` | Project analyses and recommendations. |
| `discovery.json` | Discovery preferences and results. |
| `model-settings.json` | The agent, model, reasoning effort and web-access choice. |
| `app-settings.json` | Language, limits, onboarding progress, safety settings and the retention period. |
| `api-token` | The installation's API token, also used to authorize browser sessions. Rotating it invalidates every existing session and old token URL. |
| `author-emails.json` | SHA-256 digests of the commit e-mail addresses you confirmed when publishing, never the addresses themselves. |
| `logs/` | Daily log files, at most 7 files and 50 MB, with secrets redacted. Prompts and page contents are never logged. |
| `children.json`, `bellpr.lock` | The agent processes that are running (so a crash leaves none behind), and the running instance's process id and port, with the computer's uptime (on Linux also its host name, PID namespace and boot id). |

Your browser keeps, for this local site only: the language you chose,
layout preferences such as the code font size and the collapsed sidebar,
and the sample project's review progress, check answers and drafts. None of
this reaches the server's data directory.

The browser also stores an HttpOnly access cookie, shared by tabs at the
same address. Its default session lasts at most 12 hours; choosing to
remember this browser keeps it for 30 days. **Settings → General → Browser
access** lets you sign out of this browser or revoke all access. An API token
left in session storage by an older build is exchanged for the cookie once,
then removed.

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
| A run's working files | **Settings → Data & privacy → Storage → Free space**, or **Free disk space** in the contributions list. The record and notes stay. While a follow-up round is open, push or discard it first. |
| A run | **Delete run** in the contributions list (Workbench → View all contributions). |
| A project | **Delete repository** on the Repositories page. Its runs, notes and analysis go too, and so does BELL PR's clone. A folder you imported from your computer stays where it is. |
| Everything | **Settings → Data & privacy → Delete all data**, then type `ERASE`. Every project, run, analysis, discovery result, log and backup is deleted; your settings stay. Stop running work first. |
| The sample project's progress | **Settings → General → Reset sample project** (this browser only). |
| BELL PR itself | Stop it, delete the data directory (`~/.bellpr` by default), and uninstall with `npm uninstall -g bell-pr`. A copy run through `npx` sits in npm's cache. |

Data you sent to GitHub or to your AI provider is under that service's
control: delete it there, for example by closing a pull request or deleting
a fork, under that service's policies. BELL PR has no server that keeps
your project data, so there is nothing to delete on its side.

## Diagnostics you choose to share

The About dialog can copy a diagnostics report to your clipboard: the app
version, the operating system, the versions and sign-in status of the
tools, the data directory size and recent log lines. Secrets, paths and
your GitHub login are replaced. It goes nowhere unless you paste it
somewhere, so read it before you send it.

See also the [security model](security-model.md) for what agents may read
and how the local server is protected.
