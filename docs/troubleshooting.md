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

- [I lost the address](#i-lost-the-address)
- [Error codes](#error-codes), one section per code
- [Publishing was blocked by a project rule, an issue or pacing](#publishing-was-blocked-by-a-project-rule-an-issue-or-pacing)
- [BELL PR does not start](#bell-pr-does-not-start)
- [Runs that wait, stop or cannot be reviewed](#runs-that-wait-stop-or-cannot-be-reviewed)
- [Collecting details for a support request](#collecting-details-for-a-support-request)

## I lost the address

`bell-pr open` prints the address of the BELL PR that runs with the data
directory and opens it in your browser. Run it on the computer where BELL PR
runs, as the same user:

```sh
bell-pr open
```

- **Started with `npx`:** run `npx bell-pr open`.
- **No browser on that machine** (a server, SSH): `bell-pr open --print`
  only prints the address; open it in a browser that reaches BELL PR.
- **Another data directory:** `bell-pr open --data-dir <dir>`, with the
  directory you started BELL PR with.
- **Docker:** `docker exec <container> bell-pr open --print`.
- **systemd service:** run `bell-pr open` in a terminal on that machine.

If `bell-pr open` says that no BELL PR is running with that data directory,
start BELL PR (`bell-pr`) and use the address it prints.

## Error codes

The errors below carry a stable code (`code` in the API's JSON body;
`server_unreachable` comes from the app itself), and many come with the
commands that fix them, which the app shows with a copy button. Text in
quotes is the English message; the app shows it in your language.

### `server_unreachable`

"Cannot reach the local BELL PR service. Is it still running?" The page
lost its connection to the server: BELL PR stopped, crashed or is
restarting, or it now runs on another port.

- Look at the terminal (or `docker logs <container>`, or
  `journalctl --user -u bell-pr` for the systemd service) to see whether it
  is still running.
- Start it again with `bell-pr`, then use the address it prints.
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

### `git_config_unsafe`

"This repository's Git configuration sets …, which can make Git run other
programs or send credentials elsewhere." (HTTP 409). The project's own
`.git/config` (or a worktree's `config.worktree`) defines a filter, a diff
or merge driver, a signing program, a credential helper, protocol rules,
URL rewrites or an include. BELL PR's own clones never have them, so
someone or something changed the clone by hand. BELL PR runs no Git
command in it until they are gone.

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

## Publishing was blocked by a project rule, an issue or pacing

Before a pull request reaches the maintainers, BELL PR checks it against
the project's own rules, the linked issue and your pace in that
repository. The Draft tab's maintainer checklist shows these checks while
you work, and the publish dialog lists them again under **Before it
reaches the maintainers**, grouped by topic. When the dialog opens, BELL
PR reads the GitHub facts once, and **Submit Draft PR** reads them again
live, so a publish never relies on old facts. The understanding-check
switch in **Settings → Learning** never turns one of them off.

A **block** stops publishing until its cause is gone. A **confirm** asks
you to tick it before you publish: it lists what BELL PR found, with the
file and line of a quoted rule or the GitHub field it read. Each check
also says in one sentence why maintainers care. Nothing here ever stops
you from starting a run or practising on a change locally.

**"Couldn't check".** When BELL PR cannot read a fact from GitHub (the
GitHub CLI is signed out, GitHub did not answer in time, the rate limit
was reached, or the project has no GitHub origin), the dialog says which
fact and why. An unknown fact is never counted as a pass: it is a confirm,
and you check the fact on GitHub yourself before you publish. The same
goes for the project's rules when BELL PR has not read them yet, or could
not read one of its rule files or the account's default files: an AI ban
or a required disclosure may be in them. Fix the cause (for example
`gh auth login`) and open the dialog again, or use **Check again** on the
project's **Before you contribute** card.

Each block has an id, which the dialog does not show; the headings below
use it.

### `pr-closed`

"This repository does not take pull requests from you right now." GitHub
reports that pull requests are turned off, that the repository is archived
or disabled, or that only collaborators may open pull requests and you are
not one. GitHub would refuse the pull request anyway, so there is no
override. Keep practising on the change locally, or ask the maintainers on
an issue how they accept contributions.

### `ai-ban`

"The project's rules do not accept AI-assisted contributions." A rule
quoted from the project's files says that it does not accept AI-generated
or AI-assisted contributions, and the same sentence is about pull
requests, patches or contributions. AI agents wrote this change, so BELL
PR will not publish it, with no override. You can keep practising on it
locally. A rule that mentions AI without that context is only a confirm:
you read the quote and decide whether it applies.

### `ai-disclosure`

"The project asks contributors to disclose AI assistance, and the
description does not say so yet." Write the disclosure in your own words
where the project's rule asks for it, or turn on the AI-assistance line on
the Draft tab, then save the draft. BELL PR never adds a disclosure that
you did not choose; it only waits for one that the project requires.

### `own-words`

"The project asks for descriptions in the contributor's own words, and
this one is still BELL PR's suggested text." Rewrite the description
before you publish; **Use my explanation** on the Draft tab puts your
explanation from the understanding check at its start, as a beginning. On
a project without such a rule, a description that is still the suggested
wording only asks you to confirm.

### `issue-closed`

"The linked issue is closed." Work on a closed issue usually repeats a fix
or goes against a decision the maintainers made. Link an open issue, or
remove the link if your work is about something else. There is no
override.

### `issue-has-pr`

"Someone else's open pull request would already close the linked issue."
Review or test their pull request instead: that often helps the
maintainers more than a second one. If you still have a good reason to
publish yours (for example, a maintainer asked for an alternative), type
it in the dialog, 20 to 200 characters. The reason is saved on the run and
appears in its complete learning record. This is the only block you can
lift.

### `area-reserved`

"The project keeps issues like this one for people learning to contribute
without AI." The linked issue carries a label for newcomers (such as
"good first issue"), and a rule quoted from the project's files reserves
those issues. BELL PR will not publish a change for it, with no override.
Practise on it locally, or pick a help-wanted issue instead.

### `tests-weakened`

"This change weakens a test." The change deletes a test file, skips a test
(`.skip(`, `.only`, `xit`, `pytest.mark.skip`, `xfail`, `@Ignore`,
`#[ignore]`, `t.Skip(` and similar) or removes an `assert` or `expect(`
line in a test file that no assertion in the same hunk replaces (a loose
one, such as `toBeDefined()` or `assert True`, replaces only another
loose one). In **How reviewable is this change?** on the Draft
tab, give each flagged item a one-line reason of at least 3 words and save
the reasons; the block clears when every item has one. The reasons are
offered for the description's Testing section, so the maintainers can
check them.

### `pacing-max`

"You already have N open pull requests in this repository, at least twice
BELL PR's budget for you here." The budget is 1 open pull request before
your first one is merged in that repository and 2 after (BELL PR defaults;
draft pull requests count). Finish or close one of your open pull requests
there, then publish again. There is no override.
At the budget itself, and when a maintainer has waited more than 7 days
for your answer to a review there, publishing only asks you to confirm.
Repositories you can write to are not paced.

**GitHub's own limit.** Some repositories also limit how many pull
requests one person may have open. BELL PR cannot read that limit
beforehand; when GitHub refuses a pull request because of it, BELL PR
says so in plain words. Finish or close one of your open pull requests
there, then publish again.

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

- **A run is queued**: only as many contributions execute at once as
  **Settings → Performance → Runs at a time** allows
  (`BELLPR_MAX_ACTIVE_RUNS`, 1 to 8, 2 by default). The others wait in the
  queue and start by themselves.
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
  links, new files over 512 KB, and sensitive files (such as `.env` files)
  need a manual review. Blocks common token formats and private keys before publishing.
  Remove them from the changes, or handle them outside BELL PR.
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
- **"The AI analysis came back incomplete"**: the log line `agent.output_retry`
  for that analysis (or for **Generate 5 more**) has a `problem` field. It
  lists the fields that did not fit and the kind of problem, such as
  `recommendations: too_big`, or `json_syntax` when the answer was not JSON.
  It never contains the answer's text. Analyze again; the previous result is
  kept.

<!-- generated:product-link key=supportEmail text="Contact support by e-mail" -->
<!-- /generated:product-link -->
<!-- generated:product-link key=publicRepoUrl path=issues text="Report an issue" -->
[Report an issue](https://github.com/Suzu1Dev/bell-pr/issues)
<!-- /generated:product-link -->
