# Troubleshooting

Start with the environment check. It tests every tool BELL PR needs and
prints the command that fixes each problem:

```sh
bell-pr doctor
```

The same check is in the app under **Settings → Environment**, with a
**Re-check** button. `bell-pr doctor --json` prints the report as JSON, for
scripts and support requests. The command exits with 0 when every required
check passes (Node.js, Git, an AI provider and the data directory) and with
1 otherwise. Add `--data-dir <dir>` if your BELL PR uses a data directory
other than `~/.bellpr`; when you started it with `npx`, run
`npx bell-pr doctor`. Its BELL PR line shows the port of the BELL PR that
runs with that data directory, even one started with `--port`, or, while
none runs, the port that a start would use.

Contents:

- [I lost the sign-in link](#i-lost-the-sign-in-link)
- [Error codes](#error-codes), one section per code
- [BELL PR does not start](#bell-pr-does-not-start)
- [Runs that wait, stop or cannot be reviewed](#runs-that-wait-stop-or-cannot-be-reviewed)
- [Collecting details for a support request](#collecting-details-for-a-support-request)

## I lost the sign-in link

BELL PR has no accounts and no passwords. A browser signs in with a link
that the server prints when it starts:

```text
BELL PR 1.0.0-rc.1 → http://127.0.0.1:4311/auth?t=…
```

That printed link works until BELL PR restarts. Once a browser has signed
in, its session cookie lasts 30 days, but every restart of BELL PR signs
all browsers out.

To get a new link at any time, run this on the computer where BELL PR runs,
as the same user:

```sh
bell-pr open
```

It asks the running BELL PR for a one-time link and opens it in your
browser. The link works once, within two minutes.

- **Started with `npx`:** run `npx bell-pr open`.
- **No browser on that machine** (a server, SSH): `bell-pr open --print`
  only prints the link; open it in a browser that reaches BELL PR.
- **Another data directory:** `bell-pr open --data-dir <dir>`, with the
  directory you started BELL PR with.
- **Docker:** `docker exec <container> bell-pr open --print`.
- **systemd service:** the service never opens a browser. Run
  `bell-pr open` in a terminal on that machine after every start or
  restart.
- **Windows:** `bell-pr open` works inside WSL2, where BELL PR runs, not in
  a Windows terminal.

When the session ends while the app is open, BELL PR shows a "Your session
ended" message with the command to run. Your page stays as it is, so you
can copy anything you typed before you sign in again.

If `bell-pr open` says that no BELL PR is running with that data directory,
start BELL PR (`bell-pr`) and use the link it prints.

## Error codes

The errors below carry a stable code (`code` in the API's JSON body;
`server_unreachable` comes from the app itself), and many come with the
commands that fix them, which the app shows with a copy button. Text in
quotes is the English message; the app shows it in your language.

### `pro_required`

"… needs a Pro license." You used a Pro feature on the Free plan, after the
trial ended, or with a license that no longer covers this build (HTTP 402).

- Start the 14-day Pro trial: **Settings → License**, or
  `bell-pr license trial`.
- Or activate a license key: **Settings → License**, or
  `bell-pr license activate <key>`. See [Licensing](licensing.md).
- If the model settings still ask for web access or an xhigh, max or ultra
  reasoning effort from your Pro time, choose **Use Free settings** in the
  dialog: it turns web access off and sets the effort to Default. Nothing
  is downgraded silently.

You never lose access to what you already have: runs, diffs, analyses,
discovery results, notes and the learning page stay readable on every
plan, and a run that already started can always be continued or cancelled.

### `auth_required`

"Sign in to BELL PR first …" The browser has no valid session (HTTP 401),
because BELL PR restarted, the cookie is older than 30 days, or the browser
opened BELL PR at another address or port. Get a new link as described in
[I lost the sign-in link](#i-lost-the-sign-in-link).

### `server_unreachable`

"Cannot reach the local BELL PR service. Is it still running?" The page
lost its connection to the server: BELL PR stopped, crashed or is
restarting, or it now runs on another port.

- Look at the terminal (or `docker logs <container>`, or
  `journalctl --user -u bell-pr` for the systemd service) to see whether it
  is still running.
- Start it again with `bell-pr`, then sign in with the new link.
- `curl http://127.0.0.1:4311/api/health` answers
  `{"name":"bell-pr","version":"…"}` while BELL PR runs on port 4311.

### `git_missing`

"Git is not installed, or BELL PR cannot find it on its PATH."

- macOS: `xcode-select --install`
- Debian and Ubuntu: `sudo apt install git`
- Windows: run BELL PR inside WSL2 (`wsl --install`) and install Git
  there.

Syncing a run onto the latest target branch needs Git 2.40 or later; the
environment check warns about an older Git. See
[git-scm.com](https://git-scm.com/downloads) for other systems. A service
(systemd, Docker) only sees the `PATH` it was started with.

### `git_identity_missing`

"Git does not know your name and e-mail address, and every commit needs
them." Set them once:

```sh
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

The address is published with every commit. To keep yours private, use
your GitHub no-reply address, which the environment check suggests once
the GitHub CLI is signed in (`<id>+<login>@users.noreply.github.com`). See
GitHub's guide to
[setting your commit e-mail address](https://docs.github.com/en/account-and-profile/how-tos/email-preferences/setting-your-commit-email-address).
Before it publishes an address that is not a GitHub no-reply address, BELL
PR asks you to confirm it once.

### `gh_missing`

"The GitHub CLI (gh) is not installed, or BELL PR cannot find it on its
PATH." BELL PR needs the GitHub CLI to import from GitHub, publish pull
requests, read maintainer feedback and run discovery.

- macOS: `brew install gh`
- Debian and Ubuntu: `sudo apt install gh`

Then sign in with `gh auth login`. Other systems:
[cli.github.com](https://cli.github.com/).

### `gh_unauthenticated`

"The GitHub CLI is not signed in, or its sign-in expired." Sign in again,
as the same user that runs BELL PR:

```sh
gh auth login
```

`gh auth status` shows the current sign-in.

### `gh_workflow_scope`

"This change edits GitHub Actions workflows (.github/workflows), and your
GitHub sign-in is not allowed to push them." Add the permission, then
publish again:

```sh
gh auth refresh -h github.com -s workflow
```

If the environment check reports that your sign-in cannot push to
repositories at all, add that permission the same way:
`gh auth refresh -h github.com -s repo`.

### `github_auth_required`

"GitHub asked for a sign-in." Git asked for a user name while it fetched or
pushed. BELL PR gives Git the GitHub CLI's credentials only, so the GitHub
CLI is signed out, or the account it uses cannot reach the repository (for
example a private repository it has no access to). Sign in with an account
that can, then retry:

```sh
gh auth login
```

### `codex_missing`

"The Codex CLI is not installed, or BELL PR cannot find it on its PATH."

```sh
npm install -g @openai/codex
codex login
```

See the [Codex CLI](https://github.com/openai/codex) for other ways to
install it. You need the Codex CLI or Claude Code, not both.

### `codex_unauthenticated`

"Codex is not signed in, or its sign-in expired." Sign in again:

```sh
codex login
```

On a machine without a browser, `codex login --device-auth` signs in with a
code instead. BELL PR uses the Codex CLI you installed and signed in to;
usage counts against your own account.

### `claude_missing`

"Claude Code is not installed, or BELL PR cannot find it on its PATH."

```sh
npm install -g @anthropic-ai/claude-code
claude auth login
```

See the [Claude Code documentation](https://code.claude.com/docs/en/overview)
for other ways to install it. BELL PR uses the Claude Code CLI you installed
and signed in to (Claude plan or Anthropic API key). Usage counts against
your own account.

### `claude_unauthenticated`

"Claude Code is not signed in, or its sign-in expired." Sign in again:

```sh
claude auth login
```

### `claude_sandbox_unavailable`

A Claude Code agent that edits files and runs commands needs the operating
system's sandbox, and the sandbox is not available, so the run stops before
the agent starts (HTTP 503). Pick one:

- **Linux:** install bubblewrap and socat, then start the run again.
  Debian and Ubuntu: `sudo apt-get install bubblewrap socat`. macOS has its
  sandbox (`sandbox-exec`) built in.
- **Docker:** bubblewrap is in the image but cannot start a sandbox with
  Docker's default security settings. Start the container with the three
  `--security-opt` options in [Running BELL PR in Docker](docker.md#agent-sandbox-in-docker).
- **Use Codex** for this work: sign in to the Codex CLI and choose it as
  the agent in the model settings. Its sandbox is separate.
- **Allow unsandboxed Claude Code agents** under **Settings → Agent
  safety**, or start BELL PR with `BELLPR_ALLOW_UNSANDBOXED_AGENTS=1`. The
  agents then run with your full user rights: they can read and change
  anything your account can, such as other projects, SSH keys and the
  sign-ins of your tools. Every run that used this carries a "Ran without
  sandbox" badge. Use it only for projects you trust.

`bell-pr doctor` shows whether the sandbox works ("Claude Code sandbox").
See the [security model](security-model.md) for what the sandbox allows.

### `clone_timeout`

"Cloning took longer than 10 minutes, so it was stopped." The repository is
too large or the connection too slow for an import. Clone it yourself, then
import the folder of your clone (Repositories → import, with the path):

```sh
git clone https://github.com/<owner>/<repo>.git
```

BELL PR then clones your folder into its data directory, which is fast
because it is local. Runs still fetch from GitHub when your clone's `origin`
points there.

### `already_running`

The work you asked for is already running (HTTP 409): "This project is
already being analyzed" or "A discovery is already running". Wait until it
finishes, or cancel the discovery, then try again. Each project runs one
analysis at a time (and at most two projects are analyzed at once), and
BELL PR runs one discovery search at a time.

The command line says the same when you start BELL PR twice: "BELL PR is
already running at …" means that a BELL PR already uses that port or that
data directory. Use the running one (`bell-pr open` signs you in), or stop
it first. See [BELL PR does not start](#bell-pr-does-not-start).

### `workspace_removed`

"Files for this run were cleaned up to free disk space. Reports and notes
are kept." (HTTP 410). The run's working files were removed, by you under
**Settings → Data & privacy** or by the automatic cleanup of stopped and
failed runs (`BELLPR_RETENTION_DAYS`, 14 days by default). Its record,
reports, explanations and notes stay readable, but its changes can no
longer be reviewed, published, synced or given a follow-up round here.

- Start a new contribution for the same work.
- For a published pull request, update its branch on GitHub directly.

Published runs are never cleaned up automatically; only you can free them.

### `license_invalid`

The license key cannot unlock Pro (HTTP 400). The message says why:

- "This is not a BELL PR license key." Paste the whole key, which starts
  with `BELLPR1.`; line breaks do not matter.
- "This license key is not valid." Part of the key is missing or changed.
  Copy it again from your purchase e-mail.
- "This build of BELL PR cannot check this license key." Update BELL PR
  (see [Upgrading](upgrading.md)).
- "This license key has been revoked."
- "This license key expired on …"
- "This license key covers BELL PR builds released until …" Your license's
  update period ended before this build was released. Keep using a build
  released within the period, or renew the license.

See [Licensing](licensing.md).

### `license_env_locked`

"The license key is set with the BELLPR_LICENSE_KEY environment variable."
While that variable is set, the key can only change there (HTTP 409).
Change or remove the variable, then restart BELL PR. Activating or removing
a key in the app or with `bell-pr license` is refused until then.

### `trial_unavailable`

"This data directory has already used its 14-day Pro trial", or "A Pro
license is active, so there is no trial to start." (HTTP 409). Each data
directory gets one trial. Activate a license key to keep Pro.

### `git_config_unsafe`

"This repository's Git configuration sets …, which can make Git run other
programs or send credentials elsewhere." (HTTP 409). The project's own
`.git/config` (or a worktree's `config.worktree`) defines a filter, a diff
or merge driver, a credential helper, protocol rules, URL rewrites or an
include. BELL PR's own clones never have them, so someone or something
changed the clone by hand. BELL PR runs no Git command in it until they are
gone.

- Remove the settings the message names from that repository's
  configuration, for example with
  `git -C <repository path> config --unset <name>`. BELL PR's clones live
  in `<data dir>/repositories/`.
- Or delete the project in BELL PR and import it again.

Your global and system Git configuration are not checked. See the
[security model](security-model.md#repositories-and-git).

### `understanding_check_required`

"Explain the change back before you approve or publish …" (HTTP 409).
BELL PR asks you to explain each change back before you approve it: the
understanding check. It is on by default, and the server holds approval
and publishing until it is done for the latest version of the changes. It
is a check you grade yourself; no AI model grades your answers.

- Open the check from the Changes tab once every file is marked Reviewed:
  explain the change in a few sentences, answer the questions about the
  riskiest files and what you did not test, compare each answer with the
  reference, grade it, and correct what you missed.
- If the changes moved since you took it (a follow-up round, a sync or an
  edit), confirm that your explanation still fits and answer the questions
  about the files that changed.
- To turn the check off, use **Settings → Learning**. Every file must
  still be reviewed and you still approve the pull request yourself, and
  runs approved without the check are marked "Check off". Turning it back
  on holds runs that are already approved to it before they are published.
- When `BELLPR_REQUIRE_UNDERSTANDING_CHECK=1` is set (for example on a
  classroom or shared computer), the setting is locked on. The variable can
  only keep the check on; no variable turns it off. See
  [Configuration](configuration.md#environment-variables).

## BELL PR does not start

- **"BELL PR needs Node.js 22 or later"**: install the current Node.js LTS
  from [nodejs.org](https://nodejs.org/en) (or `nvm install 22`).
- **"Port 4311 is already in use by another program"**: start on a free
  port, `bell-pr start --port <port>`, or set `BELLPR_PORT`.
- **"BELL PR is already running at …"** or **"… already running with the
  data directory …"**: one BELL PR runs per data directory. Use it with
  `bell-pr open`, or stop that process first. A lock left behind by a crash
  is detected and replaced at the next start.
- **"The data directory … belongs to another user"**: start BELL PR as that
  user, or choose your own directory with `--data-dir`.
- **"To listen on …, set BELLPR_PUBLIC_URL …"** or **"BELLPR_PUBLIC_URL
  must be the address browsers use …"**: BELL PR listens on 127.0.0.1 by
  default. To reach it from other machines, put an HTTPS reverse proxy in
  front and set `BELLPR_PUBLIC_URL`, as [Self-hosting](self-hosting.md)
  describes.
- **"Could not load the settings file …"**: check the path given to
  `--env-file`.
- **"The web interface is not built"**: only when running from a source
  checkout. Run `npm run build`, then start again. See
  [Development](development.md).
- **A setting is out of range**, for example
  "BELLPR_MAX_ACTIVE_RUNS must be between 1 and 8": fix or remove the
  variable. [Configuration](configuration.md) lists every range.

## Runs that wait, stop or cannot be reviewed

- **"Queued: Free runs one contribution at a time"**: on Free, one run
  executes and the others wait in the queue; they start by themselves.
  Pro runs as many as you set under **Settings → Performance**.
- **"Up to 8 runs can be queued or in progress at once"**: the queue is
  full. The limit is 8 or twice the runs-at-a-time setting, whichever is
  larger.
- **An agent turn timed out**: large projects and high reasoning efforts
  need more time. Raise the agent timeout multiplier under **Settings →
  Performance** (or `BELLPR_AGENT_TIMEOUT_SCALE`), lower the effort, or
  choose a faster model. Failed subtasks can be retried from the task
  board.
- **Agents wait for each other**: every agent is one CLI process, and
  **Settings → Performance** limits how many run at once across all runs,
  analyses and discovery (3 by default).
- **"The changes cover more than 150 files"** or **"… larger than 2 MB"**:
  make the task smaller and run it again.
- **A file is held back from the pull request**: binary files, symbolic
  links, new files over 512 KB, sensitive files (such as `.env` files and
  private keys) and changes that look like credentials need a manual
  review. Remove them from the changes, or handle them outside BELL PR.
- **A run stopped when BELL PR restarted**: a restart stops the agents.
  Interrupted runs show what happened; retry the failed subtasks from the
  task board.
- **Your AI provider's usage limit**: many agents at once use your account
  faster. The run shows the provider's own message; lower the agent
  processes or wait for your limit to reset.

## Collecting details for a support request

- In the app, open the About dialog (**Settings → About → About BELL PR**)
  and choose **Copy diagnostics**. Secrets, paths and your GitHub login are
  replaced, so you can paste the report into a support request. Read it
  before you send it.
- `bell-pr doctor --json` and `bell-pr version` print the versions and the
  environment.
- Logs: `<data dir>/logs/bell-pr-YYYY-MM-DD.log`, at most 7 files and
  50 MB, with secrets redacted. Start BELL PR with `BELLPR_LOG_LEVEL=debug`
  for more detail.

<!-- generated:product-link key=supportEmail text="Contact support by e-mail" -->
<!-- /generated:product-link -->
<!-- generated:product-link key=publicRepoUrl path=issues text="Report an issue" -->
<!-- /generated:product-link -->
