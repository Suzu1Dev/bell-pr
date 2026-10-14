# Getting started

This guide takes you from installing BELL PR to your first Draft PR. It
takes a few minutes to set up, and the sample project lets you try every
step before you touch a real project.

## Before you start

You need:

- **Node.js 22 or later** ([nodejs.org](https://nodejs.org/en)).
- **Git**. Syncing a run onto the latest target branch needs Git 2.40 or
  later. Set your name and e-mail address once:
  `git config --global user.name "Your Name"` and
  `git config --global user.email "you@example.com"`.
- **The GitHub CLI** (`gh`), signed in with `gh auth login`, to import from
  GitHub, publish pull requests and find projects
  ([cli.github.com](https://cli.github.com/)).
- **An AI coding CLI**, installed and signed in, as the same user that runs
  BELL PR. Either one is enough:
  - the Codex CLI: `npm install -g @openai/codex`, then `codex login`.
    BELL PR uses the Codex CLI you installed and signed in to. Usage counts
    against your own account.
  - Claude Code: `npm install -g @anthropic-ai/claude-code`, then
    `claude auth login`. BELL PR uses the Claude Code CLI you installed and
    signed in to (Claude plan or Anthropic API key). Usage counts against
    your own account.
- **On Linux, bubblewrap and socat**, so Claude Code agents that edit files
  run in the operating-system sandbox (`sudo apt-get install bubblewrap
  socat` on Debian and Ubuntu). macOS has its sandbox built in.

BELL PR runs on macOS and Linux, and on Windows inside WSL2
([install WSL](https://learn.microsoft.com/windows/wsl/install), then
install everything above inside your WSL distribution).

`bell-pr doctor` checks all of this and prints the command that fixes each
problem. You can also skip it: the Welcome screen runs the same check.

## Start BELL PR

```sh
npx bell-pr
```

or install it once and start it by name:

```sh
npm install -g bell-pr
bell-pr
```

BELL PR starts on your computer, prints your plan and a sign-in link, and
opens BELL PR in your browser, signed in with a one-time link:

```text
Plan: Free. Start the 14-day Pro trial in Settings or with `bell-pr license trial`.
BELL PR 1.0.0-rc.1 → http://127.0.0.1:4311/auth?t=…
```

Keep the terminal open: BELL PR runs until you stop it with Ctrl+C. The
printed link signs a browser in until BELL PR restarts; treat it like a
password.

> **Lost the sign-in link?** Run `bell-pr open` (or `npx bell-pr open`) on
> the same computer. It opens a new one-time link. More in
> [Troubleshooting](troubleshooting.md#i-lost-the-sign-in-link).

BELL PR listens on `127.0.0.1:4311`, so only this computer can reach it.
`bell-pr start --port <port>` picks another port. To run it as a service,
in Docker or behind a reverse proxy, see [Self-hosting](self-hosting.md)
and [Docker](docker.md).

## The Welcome steps

The first time you open BELL PR, a short Welcome takes you through:

1. **Language**: English or Traditional Chinese (Taiwan). It sets the
   interface and the language agents write their reports and explanations
   in. You can change it later in Settings.
2. **License**: read the End User License Agreement and accept it. A short
   summary comes first; the full text decides.
3. **Environment**: the same check as `bell-pr doctor`, with a copy button
   for every fix command. You can continue and fix the rest later in
   **Settings → Environment**.
4. **AI provider**: if one agent CLI is ready, your agents use it; if both
   are, you choose. You can change it later in the model settings.
5. **Get started**: take the sample tour, import a repository, or find a
   project to contribute to.

## Try the sample project

The sample project is a finished contribution to a small HTTP client, with
the agent team's plan, the code changes, their explanations and the PR
draft. It needs no tools and no account, makes no AI call and sends nothing
to GitHub. Its review progress and draft stay in your browser. The sample
also shows the Pro features with sample data, so you can see them before
you decide on a trial.

Open it from Home (**Try the sample project**) or from **Sample** in the
sidebar.

## 1. Import a repository

On **Repositories**, import a project in any of these forms:

- `owner/repo`, for a project on GitHub;
- a GitHub link, such as `https://github.com/owner/repo`;
- the path of a Git folder on your computer.

BELL PR makes its own full clone in its data directory. Your own folder is
never changed: runs never add branches or worktrees to it. A clone that
takes longer than 10 minutes stops; clone such a project yourself and
import your folder instead. Later, for a project from GitHub, **Update to
the latest version** brings BELL PR's clone up to the latest commit of the
default branch.

## 2. Understand the project

Open the project and choose **Analyze the project**. An agent reads a
sample of the source code, read-only, and writes what the project does,
who uses it, how its parts fit together and where to start reading. It
also suggests up to five contribution directions. Each one quotes the code
or documents it is based on, and BELL PR checks that every quote really is
in the files the agent read; a recommendation whose quotes do not match is
dropped and listed.

With Pro, **Generate 5 more** adds recommendations, up to 30 per project.
When the code changes, the analysis is marked out of date; analyze again to
refresh it.

## 3. Choose a direction

**Choose a contribution direction**, or start from a recommendation. Pick
one main direction (fix a bug, add a feature, improve performance, user
experience, add tests, improve docs or maintenance) and describe:

- who will benefit;
- what will be different for users when it is done;
- the boundaries: what must not change;
- what counts as done, one observable result or test per line;
- optionally, the related GitHub issue.

The same form sets the team size (Free: 2 teammates; Pro: up to 4), whether
you approve the plan before development, and the efficiency mode. The
agent, model and reasoning effort are shared by every project; each run
records the ones it started with.

## 4. Let the agent team work

Start the run with **Generate the team plan** (with plan approval) or
**Start the agent team**. Everything happens in **Agent activity**:

- The **Lead** splits the work into tasks, each with the files it may
  change and what it depends on.
- With plan approval on, you read the plan first. **Approve the plan and
  start development**, or **Send back with feedback** for a new plan (up
  to 3 times).
- **Teammates** work at the same time, each in its own Git worktree, and
  share findings through the team inbox. You can message the Lead, one
  task or everyone.
- The work is integrated, then a **Reviewer** and a **Test analyst** check
  the result. Their reports are independent static reviews; the commands
  the teammates really ran are listed separately.
- A failed subtask can be retried; finished subtasks are kept.

Free runs one contribution at a time; the next one waits in the queue.

## 5. Review every change

When the team is done, the run waits for your review in **Code changes**:

- The diff of each file, unified or side by side, with a file list you can
  sort in the suggested review order.
- Beside it, an **explanation** of the file in plain language: a concrete
  example of the behavior before and after, what changed and why, the
  concepts involved, what to check, another way it could have been done and
  a question to test yourself.
- **Ask the agent**: click a line (Shift for several) and ask about it.
  Answers are saved with the run.
- **Reviews**: the Lead's summary and the Reviewer's and Test analyst's
  reports, with the parts about this file marked. **Run the review again**
  after you changed something.
- **My understanding**: write a note in your own words, then mark the file
  as **Reviewed**.

You can also change the code yourself: copy the worktree path, edit the
files in your editor, then **Refresh the diff**. Changed files get new
explanations and need another review.

Explanations and answers come from an AI and can be wrong. Check them
against the code.

## 6. Prepare and publish the pull request

The **PR draft** tab reads the project's contribution rules, its pull
request template, its agent guides (`AGENTS.md`, `CLAUDE.md`) and the
workflows that check pull requests, and suggests a title, a description and
a commit message, each with the source it follows. You decide what to
apply, and you edit everything:

- The title and the description, in English unless the project asks for
  another language.
- The commit message. A `Signed-off-by` line, if the project requires it,
  is yours to write; BELL PR never signs for you.
- The GitHub branch name, if the project has naming rules.
- The template's checkboxes: you tick them yourself.

Before you can approve, BELL PR checks what will be sent: a credential in
the text, or placeholders such as `TODO:` or an empty `Fixes #`, block it;
a path from your computer, a change to CI workflows and a commit e-mail
address that is not your GitHub no-reply address need your confirmation.
The description mentions AI assistance only if the project's rules require
it or you turn the note on.

Once every file is reviewed, choose **Approve and prepare the PR**. The
last dialog shows the branch and the exact description GitHub will
receive. **Submit Draft PR** pushes the branch (to a fork under your
account when you cannot push to the project) and opens a Draft PR. Nothing
is ever force-pushed.

## 7. After publishing

- **Sync to the latest target branch** when the project moved on: BELL PR
  merges the latest target branch into your work (for a published PR, as
  one merge commit). Files the target branch changed need another review.
  Conflicts can be resolved by hand or with **Ask the agent to resolve the
  conflicts**; an unpublished run's sync can be undone.
- **Maintainer feedback** (Pro): **Read feedback** reads the reviews,
  comments and CI results of your PR once, and explains them file by file.
  BELL PR never replies for you; you answer on GitHub.
- **Follow-up rounds** (Pro): tick the comments you want handled and an
  agent changes the code. You review each file and push the round as one
  new commit to the same PR.

## Keep learning

- **Learning notes** collects the explanations of every contribution, with
  a search, so you can come back to a concept later.
- With Pro, **Export learning record (Markdown)** saves a contribution's
  task, plan, file explanations, questions and answers, pull request link
  and usage as one document.
- **Explore contributions** (Pro) searches GitHub for projects and issues
  that match what you want to work on.

## Shortcuts

- **Ctrl+K** (⌘K on macOS) opens the quick switch between projects and
  contributions.
- **?** outside a text field opens the guide.
- The workspace tabs follow the arrow keys, Home and End.

Next: [Configuration](configuration.md), [Troubleshooting](troubleshooting.md)
and [FAQ](faq.md).
