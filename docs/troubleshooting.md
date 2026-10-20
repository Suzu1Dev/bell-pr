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
- [Publishing was blocked by a project rule, an issue or pacing](#publishing-was-blocked-by-a-project-rule-an-issue-or-pacing)
- [Learn by hand](#learn-by-hand): Ready for review, the guide, your
  tests, fitted runs, the quoted confirm and follow-up commits
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

## Publishing was blocked by a project rule, an issue or pacing

Before a pull request reaches the maintainers, BELL PR checks it against
the project's own rules, the linked issue and your pace in that
repository. The Draft tab's maintainer checklist shows these checks while
you work, and the publish dialog lists them again under **Before it
reaches the maintainers**, grouped by topic. When the dialog opens, BELL
PR reads the GitHub facts once, and **Submit Draft PR** reads them again
live, so a publish never relies on old facts. The checks are the same on
every plan, and the understanding-check switch in **Settings → Learning**
never turns one of them off.

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
you read the quote and decide whether it applies. So is a rule against
crediting AI as a commit's co-author, against AI-written commit messages
or against large AI-generated pull requests. In a Learn-by-hand run the
block says what the rule covers: see [BELL PR won't publish my
learn-by-hand run](#bell-pr-wont-publish-my-learn-by-hand-run).

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
Practise on it locally, or pick a help-wanted issue instead. In a
Learn-by-hand run the block says what the rule covers: see [BELL PR won't
publish my learn-by-hand run](#bell-pr-wont-publish-my-learn-by-hand-run).

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
your first one is merged in that repository and 2 after (BELL PR defaults,
the same on every plan; draft pull requests count). Finish or close one of
your open pull requests there, then publish again. There is no override.
At the budget itself, and when a maintainer has waited more than 7 days
for your answer to a review there, publishing only asks you to confirm.
Repositories you can write to are not paced.

**GitHub's own limit.** Some repositories also limit how many pull
requests one person may have open. BELL PR cannot read that limit
beforehand; when GitHub refuses a pull request because of it, BELL PR
says so in plain words. Finish or close one of your open pull requests
there, then publish again.

## Learn by hand

In a Learn-by-hand run you write the change and BELL PR's agents only
read (see [Getting started](getting-started.md#learn-by-hand-write-it-yourself)).
None of its refusals has an error code of its own: the app shows the
server's message where you acted.

### Ready for review is greyed out

The footer's **Ready for review** waits while:

- the diff is empty: it reads "Write a change first". Save your edits in
  the run's folder; BELL PR reads the diff again when you come back to the
  window, or choose **Refresh the diff**;
- the guide reviews your last ready version: it reads "The guide is
  reviewing";
- another action of the run is still running.

Before you confirm your plan with **This is my plan**, the footer has no
**Ready for review** at all. In the dialog, **Mark it ready** can still
be refused:

- "The change moved since you opened this. Look at it again, then mark it
  ready.": you saved an edit after the dialog opened.
- "The guide is already working on this run. Wait for it to finish, or
  stop it.": you asked for a review while a guide turn or your tests run.
- "Run your tests on this version first; the tests are the judge.": a
  second review needs a test run, or a result you recorded, at this
  version since the last review. The dialog shows the **Tests** card for
  it; or untick **Ask the guide to review it**.

### "Mark your changes ready for review first."

Explanations, walkthroughs, the premise check's **Check again**, **Run
the review again** and approval wait until you mark the change ready, so
the guide never explains half-written code. After you edit the code
again, they wait for the next **Ready for review**. When you save an edit
while the premise check or a walkthrough runs, nothing is stored: mark
the change ready again, then ask again.

"Answer this file's Explain-it-back question first; then you can see how
a reader sees your change." means that **Show how a reader sees it** waits
for your own answer for that file in the understanding check.

### The guide says "Try something first"

"Try something first: change the code, run the tests, or say what you
tried." After the first hint on a step, the next one needs an attempt
since the last hint: an edit that changes the diff, a test run BELL PR
ran (a result you recorded doesn't count), or at least five words in
"What I tried · what I expected · what happened" that differ from what you
wrote last time. Hints come one rung at a time ("Ask for the hints of this
step in order, one rung at a time."). After **Options** or an example,
**Done** on that step needs one sentence on why your change works. When
the same failure came three test runs in a row, **An example in this
project** needs no new attempt; **I'm stuck** lists the other ways out.

### The guide doesn't offer a hint or a review

- **A run fitted to the project's rules** gets only the kinds of help
  that the project's text names, for the whole run, and the panel says
  "Not offered in this run: the project's text it is fitted to doesn't
  name …". Answers to questions and **Where to look** are answers;
  **What applies** and the explanations and walkthroughs of **Show how a
  reader sees it** are explanations; **Options**, **An example in this
  project**, the guide's outline and **Questions on my plan** are
  planning help; **Explain this failure** is help with tests; the review
  at **Ready for review** is a review. When the next rung is not offered,
  the guide says so and points to the exits. On such a project, a run
  started with every kind of help gets them all, and BELL PR won't
  publish it there.
- **No rung left:** "There is no hint after an example in this project."
  Try an exit: ask a human, make the step smaller or talk it through.
- **One thing at a time:** "The guide is already working on this run.
  Wait for it to finish, or stop it." and "Your tests are running. Ask the
  guide when they finish." The guide gives hints and answers questions
  while you write, not while the run plans or publishes.
- **A failed turn:** "The guide couldn't answer: …" gives your question
  back; "The guide's answer was not in the expected form, so nothing was
  stored. Try again." means the model's answer could not be read.
  **Explain this failure** needs a failed test run: "There is no failed
  test run to explain. Run your tests first."

### BELL PR can't fit this run to the project's rules any more

"BELL PR can't fit this run to the project's rules any more: …. Check the
rules again, or start with every kind of help." When you start a run with
**Fit the guide to the project's rules**, BELL PR reads the case again
from the project's stored rules; when they changed after the task dialog
read them (for example after **Check again** or **Update to the latest
version**), the fit no longer holds. Open the task dialog again and
choose again, or choose **Every kind of help, practise locally**, which
BELL PR won't publish on that project. When the reason is "the project's
rules have no AI rule to fit the guide to", start a Learn-by-hand run
without the fit: nothing needs it.

### BELL PR won't publish my learn-by-hand run

A Learn-by-hand run gets the same checks as every run. When its history
is clean, its `ai-ban` and `area-reserved` blocks say what the project's
rule covers:

- "The project's rules restrict AI help itself, so BELL PR won't publish a
  run its guide helped with." The rule is about AI help itself, not only
  AI-written code, and Learn by hand doesn't change that. Keep practising
  locally, or ask the project's people how newcomers can work on it.
- "The project keeps this issue for people learning without AI tools, so
  BELL PR won't publish a run its guide helped with." Pick a help-wanted
  issue for Learn by hand, or ask the project's people.
- "The project's rules decline AI-generated content. BELL PR's agents had
  no write access and gave you no code for this change. BELL PR publishes
  here only through the project's own text, and …" or "The project closes
  AI-generated pull requests for issues like this one. BELL PR publishes
  them only through the project's own text, and …": the rule could allow
  the quoted confirm, and the words after "and" name the condition that
  failed.

| The block ends with | What to do |
| --- | --- |
| its rule restricts AI help itself, or BELL PR can't tell what it covers | Nothing in BELL PR lifts it. Ask the project's people. |
| its text doesn't say which uses of AI are fine | The project names no use of AI as fine, so BELL PR won't publish a learn-by-hand run there. |
| its text doesn't name … | This run used a kind of help that the project's text doesn't name. A new run fitted to the project's rules when it starts offers only the kinds the text names. |
| its text doesn't name explanations and answers | The guide can't work without them, so BELL PR won't publish a learn-by-hand run there. |
| BELL PR's checked list entry is more than 90 days old (…) | The rule comes from BELL PR's checked list, and its quotes were last checked more than 90 days ago: it still blocks, but it can't lead to the confirm. |
| its rules weren't read since this run started (check them again) | Choose **Check again** on the block in the publish dialog: BELL PR reads the project's rules and then its checks again. **Check again** on the project's **Before you contribute** card works too; then open the publish dialog again. |
| this run wasn't fitted to its rules when it started | A run started with every kind of help can't be fitted later. Start a new run and choose **Fit the guide to the project's rules**. |
| its rules changed since this run started | The quotes this run was fitted to are no longer in the project's rules. Check the rules again; if they changed for good, start a new fitted run. |
| another of its AI rules applies | This rule could lead to the confirm, but another AI rule of the project blocks; its own block says why. |

A run whose history isn't clean (BELL PR saw a file change from an agent
or a shell command from Claude Code, or a teammate, a team task, an AI
follow-up round or an agent conflict resolution joined it) gets the agent
run's checks and words. See
[Contributing
responsibly](contributing-responsibly.md#when-the-projects-own-text-says-some-uses-of-ai-are-fine)
for every condition of the quoted confirm.

### Publishing asks me to confirm the project's rule

This is the quoted confirm of a Learn-by-hand run fitted to the project's
rules: "The project declines AI-generated contributions, and its own text
says some uses of AI are fine. BELL PR is quoting the project, not
deciding for it: the maintainers decide whether your change fits." (for a
reserved issue: "The project closes AI-generated pull requests for issues
like this one, …"). It stands right after the run's record and quotes the
rule, the project's text on which uses are fine ("The same rules say:
…"), up to two other AI rules of the same document ("They also say:
…") and the help you used.

It is not an override and asks for no reason: it says that you read the
project's words beside your help record. If you're not sure your change
fits, ask the project's people before you publish. Publishing without the
tick is refused with the confirm's words. The tick counts only for the
words you saw: when BELL PR reads different words (the rules changed, or
another tab read them again), the tick is cleared and you read and tick
again.

### My tests pass in my terminal but fail in BELL PR

BELL PR runs your confirmed command differently from your terminal:

- variables whose names look like secrets, and those of BELL PR, GitHub
  and the AI CLIs, are removed (the full rule is in the [security
  model](security-model.md#bell-pr-runs-your-test-command)), and so is
  what npm added when npm started BELL PR;
- `CI=1` and `NO_COLOR=1` are set, and some test runners behave
  differently in CI;
- there is no standard input and no terminal (TTY);
- the command runs in the run's folder, not in your own clone, with a
  10-minute limit, and processes it leaves in the background end when it
  ends.

When your tests need what BELL PR leaves out, run them in your own
terminal and choose **Record my result**: the result is marked "reported
by you" and counts as a test of that version for a second review, though
not as an attempt for the next hint. "did not finish" means that the
tests wrote more than 50 MB of output or the command could not start; the
run log in **Agent activity** says which. "Confirm a test command for this
project first." means that no command is confirmed: choose **Use this
command** on the **Tests** card.

### BELL PR doesn't take over my follow-up commits

In a published Learn-by-hand run you push follow-up commits from the
run's folder with your own Git, and BELL PR takes them over at the next
feedback read. It does so only when the run's folder has no uncommitted
changes, is on the run's own branch, and its latest commit is the head of
the pull request's branch on GitHub. Otherwise nothing moves, the
feedback is still read, and the run log says what to do first:

- "Push your commits first; BELL PR takes them over once they are on the
  pull request's branch." Push them (also when the branch is gone on
  GitHub, this is the message).
- "Commit or discard your changes in the run's folder first."
- "The run's folder isn't on its branch …. Switch back to it first; BELL
  PR takes over commits only from that branch."
- "The pull request's branch has commits the run's folder doesn't have
  yet. Pull them into the run's folder first; …"

A sync of the pull request refuses with the same words. Like every sync,
it never overwrites a file you save while it runs: "A file in the run's
folder changed while BELL PR was syncing, so nothing moved. Sync again.",
or, when the pull request's branch has new commits that change a file
you saved meanwhile, "Changes saved in the run's folder touch files that
the new commits on … change, so nothing moved. Commit or discard those
changes first." When the pull request's history was rewritten (a force
push), BELL PR refuses as it does for every run. Taking commits over records them as the pull
request's; BELL PR doesn't check or review them.

When you discard a round of such a run, BELL PR never drops your commits
or deletes your files: "You committed in the run's folder after this
round started, …" or "These files in the run's folder aren't this
round's: …" asks you to move them first.

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
  analyses and discovery (3 by default). In a Learn-by-hand run the run
  log says "The guide waits for a free agent CLI process (… queued)."
- **"Too long or too deeply nested to show formatted, so it shows as
  plain text."**: BELL PR shows a text without its Markdown formatting
  when it is longer than 24,000 characters, has more than 1,000 lines of
  text outside code blocks, nests quotes or lists more than 16 levels
  deep, or packs too much formatting into one paragraph; between 12,000
  and 24,000 characters, also when a line is indented past 16 columns or
  holds more than 2,000 characters without a space. This keeps the page
  responsive with an agent's long report or a long PR description. The
  whole text is still shown, and BELL PR's checks of a PR description
  still read it.
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
