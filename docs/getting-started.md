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
the project's (fictional) contribution rules, the agent team's plan, the
code changes, their explanations, the understanding check and the PR
draft. It needs no tools and no account, makes no AI call and sends nothing
to GitHub. Its review progress, your check answers and the draft stay in
your browser. The sample also shows the Pro features with sample data, so
you can see them before you decide on a trial.

Open it from Home (**Try the sample project**) or from **Sample** in the
sidebar.

## 1. Import a repository

On **Repositories**, import a project in any of these forms:

- `owner/repo`, for a project on GitHub;
- a GitHub link, such as `https://github.com/owner/repo`;
- the path of a Git folder on your computer, such as
  `~/projects/repository` (`~/` is your home directory). On Windows, use
  the path inside WSL2, where BELL PR runs; a Windows folder is under
  `/mnt/c/`, for example `/mnt/c/projects/repository`.

BELL PR makes its own full clone in its data directory. Your own folder is
never changed: runs never add branches or worktrees to it. A clone that
takes longer than 10 minutes stops; clone such a project yourself and
import your folder instead. Later, for a project from GitHub, **Update to
the latest version** brings BELL PR's clone up to the latest commit of the
default branch.

## 2. Understand the project

### Before you contribute

On the project overview, the **Before you contribute** card shows what
the project asks of contributors, quoted from its own files
with the file and line: its rules on AI-assisted contributions, on
disclosing AI help, on explaining your change, on descriptions in your
own words, on issues kept for newcomers and on opening an issue first,
and notes addressed to AI agents. Each rule says what publishing does
about it: blocks, asks you to confirm, or only informs. The card also says
whether the project takes pull requests from you ("Pull requests: open to
you", or collaborators only, turned off or archived, where you can
practise but not publish).

BELL PR reads these files from its own clone, at import and when you
update the project, and asks GitHub for the pull request facts; **Check
again** reads them anew. When it finds no rule, it says which files it
read: some projects publish their rules on a website or wiki, so check
there before you publish. A GitHub fact it could not read shows as
"Couldn't check" with the reason, and a rule file it could not read (or
the account's default files) as "Couldn't read", in words; neither is
ever counted as a pass.

### The analysis

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

When you link a GitHub issue, **Before you start** under the issue field
reads it once from GitHub and shows whether it is open or closed, who is
assigned to it or has claimed it, whether someone else's pull request
would already close it, the latest maintainer comment, labels for
newcomers, and your open pull requests in that repository against BELL
PR's budget (see [Contributing
responsibly](contributing-responsibly.md#the-numbers-bell-pr-uses)).
Nothing here stops you from starting: when a fact means BELL PR will not
publish the change (a closed issue, a project that does not take pull
requests from you, rules that do not accept AI-assisted contributions,
an issue the project keeps for newcomers, someone else's pull request, or
twice your budget), the start button asks once, and you can start and
practise locally. For an issue labelled for newcomers, the dialog also
explains why such issues are best written by hand.

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

**Try first.** On a file's explanation, the "Quiz yourself" question asks
for your answer before it shows one: write a sentence or two, choose how
sure you are (**Sure**, **Think so** or **Guessing**), then **Show
answer** and grade yourself (**Got it**, **Partly** or **Missed**).
Showing the answer with an empty field skips the question. In the same
way you can guess how else the change could be done before the
alternative shows, then choose **Keep this approach**, **Prefer the
other** or **It depends** for this project, with an optional why. An
answer you gave before the reveal, on the current version of the file,
counts toward the understanding check, so you are not asked it twice.
Very small files (lockfiles, generated files, whitespace-only changes and
tiny docs edits) get no prompts. **Settings → Learning → Try-first prompts
during review** turns the prompts off; the answers then sit behind a plain
reveal button.

You can also change the code yourself: copy the worktree path, edit the
files in your editor, then **Refresh the diff**. Changed files get new
explanations and need another review.

Explanations and answers come from an AI and can be wrong. Check them
against the code.

## 6. Explain it back

When every file is marked Reviewed, the footer's button reads **Explain it
back**. It opens a short check next to the diff; **Take the check now** in
the Changes header opens it earlier if you want to test yourself first
(the Reviewed ticks are still required). While it is open the check is
closed book: the explanations, notes and questions to the agent are
hidden, and the diff and the file list stay. A maintainer will ask you
about your change without your AI in the room.

1. **Explain.** In 2 to 4 sentences: what problem does this solve, what
   does the change do, and what could break? At least 15 words.
2. **Answer.** Up to three questions about the riskiest files, scaled to
   the size of the change: none up to 15 changed lines, 1 up to 100, 2 up
   to 400, 3 above (lockfiles, generated files and tiny docs edits are not
   counted). When source code changed, one more question: "What did you
   not test, and why?" Each answer needs at least 3 words, or **I don't
   know**, which counts as missed, and how sure you are. **Lock my
   answers** saves them; they cannot be edited afterwards.
3. **Compare and grade.** Each answer appears beside its reference: the
   file's AI-written answer, the Test analyst's report for what you did
   not test, or, without a reference, the diff itself. Grade each answer
   **Got it**, **Partly** or **Missed**. What you did not test is not
   graded.
4. **Correct.** For each answer graded Partly or Missed, write what you
   had wrong, in at least 3 words.
5. **Predict the maintainer** (optional). Pick what the maintainer will
   most likely question (scope, simplicity, naming, project conventions,
   tests, risk, the description, or whether it is worth the review time)
   and add a line if you like. It stays on your computer, and you compare
   it with the maintainers' real review later.

The result is a receipt, not a score, for example "You explained the
change and answered 2 questions. You missed 1 and corrected it." The
footer then reads "You explained it back. Ready to approve." No AI model
grades you and the check makes no AI call; an answer that copies the
AI-written text word for word does not count. **Start over** clears the
check; checks you passed stay in the run's history.

If the change moves after you passed (you edit a file, sync the run or
start a follow-up round), the check asks again only about the files that
changed, and asks you to confirm that your explanation is **Still
accurate** or to edit it.

**What is mandatory.** The check is on by default and Free, and the
server holds approval and publishing until you have done it for the
latest version of the change (error code
[`understanding_check_required`](troubleshooting.md#understanding_check_required)).
You can turn it off in **Settings → Learning**, after a confirmation that
says what changes; runs approved without it are then marked "Check off"
for good, in the workspace, on the learning page and in the learning
record. Whatever the switch says, every file must be marked Reviewed, you
approve the pull request yourself, the pull request is a Draft, and every
project-rule, issue and pacing check applies.

## 7. Prepare and publish the pull request

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

**Your words in the PR.** **Use my explanation** puts the explanation from
your understanding check at the start of the description's first section,
and **Add my not-tested answer to Testing** adds your answer about what
you did not test under the description's testing heading (or as a "Not
tested" paragraph at the end). Nothing goes in until you click, and you
edit it from there. When your words contain Chinese, Japanese or Korean
characters and the project does not ask for another language, the card
shows them beside the editor with a copy button instead, so that you write
the English description yourself.

**How reviewable is this change?** The snapshot shows the changed lines
(without lockfiles and generated files), the files, whether a test file
changed, new dependencies, files outside every task of the plan,
whitespace-only changes, and the sizes of the project's last 3 merged pull
requests for comparison. The size bands are BELL PR defaults. If the
change does several things, **Ask how to split it** asks the agent how it
could be split. A skipped, deleted or loosened test is listed here; give
each one a one-line reason of at least 3 words, which is offered for your
Testing section.

**The maintainer checklist** shows, row by row, the project's rules,
whether pull requests are open to you, the linked issue, your pace in this
repository, your own words, reviewability, disclosing AI help and the
understanding check, each with its source and one sentence on why
maintainers care.

Before you can approve, BELL PR checks what will be sent: a credential in
the text, or placeholders such as `TODO:` or an empty `Fixes #`, block it;
a path from your computer, a change to CI workflows and a commit e-mail
address that is not your GitHub no-reply address need your confirmation.
The description mentions AI assistance only if the project's rules require
it or you turn the note on; when the project requires a disclosure,
publishing waits until the description has one.

Once every file is reviewed and you explained the change back, choose
**Approve and prepare the PR**. The last dialog shows the branch and the
exact description GitHub will receive, and under **Before it reaches the
maintainers** it lists the checks grouped by topic: Couldn't check, the
project's rules, the issue, your pace here, your words and reviewability,
and safety. When the dialog opens, BELL PR reads the GitHub facts once.

- A **block** stops publishing until its cause is gone: the project does
  not take pull requests from you, its rules do not accept AI-assisted
  contributions, a required disclosure or your own words are missing, the
  linked issue is closed or kept for newcomers, a weakened test has no
  reason, or you have twice your budget of open pull requests here.
  [Troubleshooting](troubleshooting.md#publishing-was-blocked-by-a-project-rule-an-issue-or-pacing)
  explains each.
- **One block can be lifted:** when someone else's open pull request would
  already close the linked issue, you can review or test theirs instead, or
  give your reason to publish anyway (20 to 200 characters). The reason is
  saved on the run.
- A **confirm** asks you to tick it: a rule for you to decide on, an issue
  that someone else is assigned to or has claimed, a change that may be
  hard to review, your pace in this repository, or a fact BELL PR
  **couldn't check**. An unknown fact is never counted as a pass.

**Submit Draft PR** reads the GitHub facts again, then pushes the branch
(to a fork under your account when you cannot push to the project) and
opens a Draft PR. Nothing is ever force-pushed.

## 8. After publishing

- **Sync to the latest target branch** when the project moved on: BELL PR
  merges the latest target branch into your work (for a published PR, as
  one merge commit). Files the target branch changed need another review.
  Conflicts can be resolved by hand or with **Ask the agent to resolve the
  conflicts**; an unpublished run's sync can be undone.
- **Maintainer feedback**: **Read feedback** reads the reviews, comments
  and CI results of your PR once, when you press it, on every plan, and
  shows them file by file with the PR's state. Nothing polls GitHub. BELL
  PR never replies for you; you answer on GitHub, in your own words. When
  a maintainer asked for changes, the run says so.
- **Your forecast and what the maintainers said**: your prediction from
  the understanding check sits beside the maintainers' own comments. Tag
  each comment with what it raised and whether you **Saw it coming** or it
  **Surprised me**; a surprise asks for one "Lesson for next time" and goes
  to your practice deck. The outcome line states facts only, such as
  "Merged" or "No response yet".
- **Follow-up rounds** (Pro): tick the comments you want handled and, for
  each one, write in your own words what the maintainer is asking for (at
  least 3 words). The agent gets your words as its task and the
  maintainer's comment only as context, then changes the code. You review
  each file, explain the round back (while the understanding check is on),
  and push the round as one new commit to the same PR.
- **Can't continue?** Close the pull request yourself on GitHub, with a
  short note in your own words.

## Keep learning

- **Learning notes** in the sidebar collects the explanations and your
  notes from every contribution, with a search, so you can come back to a
  concept later.
- **Practice** brings questions from your own contributions back after 1,
  3, 7 and 21 days, up to 5 at a time and mixed across projects: answers
  you missed while you were sure of them, maintainer comments that
  surprised you, and questions you never tried. Answer from memory, show
  the answer and grade yourself. It never sends reminders.
- **Plain counts** from your own records appear once there is enough to
  count, for example "When you said Sure, you were right 14 of 18 times."
  They are facts about your records, never a score or a goal, and they are
  counted on your computer.
- With Pro, **Coach debrief** reads your records for one project (your
  explanations, misses and corrections, the approaches you chose, your
  forecasts and the maintainers' comments) and names what its maintainers
  raised most, quoting your records, with up to 3 practice drills and one
  next step. It describes the work, never you. Debriefs you already have
  stay readable on every plan.
- With Pro, **Export learning record (Markdown)** saves a contribution's
  complete record as one document: the task, plan, file explanations,
  questions and answers, your notes, your understanding check, the
  approaches you chose, your forecast and feedback tags, any check you
  lifted with its reason, the pull request link and usage.
- **Explore contributions** (Pro) searches GitHub for projects and issues
  that match what you want to work on. For the agent team it looks for
  help-wanted issues; an issue labelled for newcomers is marked "Learn by
  hand: write this one yourself".

## Shortcuts

- **Ctrl+K** (⌘K on macOS) opens the quick switch between projects and
  contributions.
- **?** outside a text field opens the guide.
- The workspace tabs follow the arrow keys, Home and End.

Next: [Configuration](configuration.md), [Troubleshooting](troubleshooting.md)
and [FAQ](faq.md).
