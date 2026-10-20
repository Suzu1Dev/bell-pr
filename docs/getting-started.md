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
- **A current browser** for the web interface: Chrome or Edge 111,
  Firefox 113 or Safari 16.2, or later.

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
practise locally. For an issue labelled for newcomers, the dialog starts
on Learn by hand, unless the project's rules ban AI-assisted
contributions or keep such issues for people learning without AI tools;
when you start an agent team on such an issue anyway, the start button
explains first why these issues matter to newcomers.

The same form asks **Who writes the code?**: **The agent team writes it**
(steps 4 and 5 below) or **You write it (Learn by hand)** ([Learn by
hand](#learn-by-hand-write-it-yourself)). It sets the team size (Free: 2
teammates; Pro: up to 4), whether you approve the plan before
development, and the efficiency mode. The agent, model and reasoning
effort are shared by every project; each run records the ones it started
with.

## 4. Let the agent team work

Start the run with **Generate the team plan** (with plan approval) or
**Start the agent team**. (A Learn-by-hand run starts with **Plan with the
guide** instead: see [Learn by hand](#learn-by-hand-write-it-yourself).)
Everything happens in **Agent activity**:

- The **Lead** splits the work into tasks, each with the files it may
  change and what it depends on. Before it plans, it checks any
  assumption the request states (often marked "Assumption" or
  "unverified") against the code: the **premise check** says whether the
  assumption holds, does not hold or is unclear, citing the lines it read,
  and every role is told. A long plan or task description shows its first
  lines with a button for the rest; a plan waiting for your approval is
  always shown in full.
- With plan approval on, you read the plan first. **Approve the plan and
  start development**, or **Send back with feedback** for a new plan (up
  to 3 times).
- **Teammates** work at the same time, each in its own Git worktree, and
  share findings through the team inbox. You can message the Lead, one
  task or everyone.
- The work is integrated, then a **Reviewer** and a **Test analyst** check
  the result. Their reports are independent static reviews; the commands
  the teammates really ran are listed separately. The Lead's summary owns
  the overall conclusion; the Reviewer opens by saying whether it agrees
  and adds only what the summary lacks, and the Test analyst keeps the one
  list of checks still to run.
- Agents are told never to change your machine: no `sudo`, no global or
  user-level installs. When a check needs something the machine lacks, the
  teammate reports it, and **Overview & motivation** lists it under "Setup
  this machine needs from you" with a suggested command and who reported
  it. Check the command against the project's documentation before you run
  it; BELL PR never runs it.
- **Run details** folds the model and the AI usage: its line names the
  agent, the model, the calls and the input and output tokens, marks
  partial reports and says when usage was not reported, never 0.
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
- **Ask**: click a line (Shift for several) and ask the agent about it.
  Answers are saved with the run.
- **Reviews**: the Lead's summary and the Reviewer's and Test analyst's
  reports, with the parts about this file marked. **Run the review again**
  after you changed something.
- **Walkthrough**: for a modified code file, the functions around
  each change, step by step, each with the lines it covers (click them to
  mark those lines in the diff), what calls it and what it calls, another
  way to see it and a question to check yourself. A function the change adds whole has no
  earlier version to walk through, so it points to the explanation
  instead. Walkthroughs are written one file at a time, the selected file
  first, and are kept for that version of the diff. With try-first
  prompts on (the default), each function's **Check yourself** question
  asks for your answer and how sure you are before its answer shows, then
  for your grade, as the explanation's question does (below); showing the
  answer with an empty field skips it. BELL PR keeps up to 12 of these
  answers per file version; past that, the card still asks first but
  doesn't save the answer. In an agent run, a graded walkthrough answer
  can count as the file's understanding-check question ("Answered during
  review") when you have not graded the explanation's own question; in a
  Learn-by-hand run it counts toward nothing. With the prompts off, the
  question and its answer sit behind a plain reveal and nothing is
  recorded. After publishing, saved answers are read-only.
- **Unchanged code**: the bar between two changes says how many unchanged
  lines it hides; show 20 more above or below, or all of them, and
  **Whole file** shows the whole file between the changes. The lines are
  read from the run's base commit and are marked as context; you can
  select them and ask about them too.
- Above the diff, one row holds the **premise check**, folded to its
  verdict and the assumption, and the **worktree** path with a copy button
  (hover for the editing hint).
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
counts toward the understanding check, so you are not asked it twice. A
saved answer is final: it stays as you gave it before the answer showed,
even from another tab.
Very small files (lockfiles, generated files, whitespace-only changes and
tiny docs edits) get no prompts. **Settings → Learning → Try-first prompts
during review** turns the prompts off; the answers then sit behind a plain
reveal button.

You can also change the code yourself: copy the worktree path, edit the
files in your editor, then **Refresh the diff**. Changed files get new
explanations and need another review.

Explanations and answers come from an AI and can be wrong. Check them
against the code.

**Overview & motivation** leads with this contribution's brief: the premise
check, the problem and the motivation, before and after, and how to
validate it, in Markdown as written. The project's analysis follows as its
background, and the directions come last. On a finished run you can check
the premise again (or for the first time, on a run made before premise
checks); a changed verdict has the walkthroughs written again, and the
explanations you have not answered from yet.

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

The **PR draft** tab opens with the editor; the contribution guide and the
reviewability snapshot follow, then the target-branch sync. (After you
publish, the tab leads with the sync and the review rounds instead.) It
reads the project's contribution rules, its pull
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
  conflicts**; an unpublished run's sync can be undone. A sync never
  overwrites a file you save while it runs: "A file in the run's folder
  changed while BELL PR was syncing, so nothing moved. Sync again." When
  a published PR's branch has new commits on GitHub that change a file
  you saved meanwhile, it says "Changes saved in the run's folder touch
  files that the new commits on … change, so nothing moved. Commit or
  discard those changes first."
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
- **Follow-up rounds** (Pro, agent runs): tick the comments you want
  handled and, for each one, write in your own words what the maintainer
  is asking for (at least 3 words). The agent gets your words as its task and the
  maintainer's comment only as context, then changes the code. You review
  each file, explain the round back (while the understanding check is on),
  and push the round as one new commit to the same PR.
- **Commit history**: the tab lists every commit of the pull request,
  oldest first, labelled by where it came from (the first push, a review
  round, a sync with the target branch, a commit taken over from GitHub),
  with its author, date and changed lines, and linked to the pull request.
  A commit opens to its files and a file to its diff; sensitive files are
  named but not shown.
- **Can't continue?** Close the pull request yourself on GitHub, with a
  short note in your own words.

A Learn-by-hand run has no AI follow-up rounds and no conflict agent: see
[After publishing](#after-publishing) in the Learn-by-hand section.

## Learn by hand: write it yourself

In a Learn-by-hand run you write every line of the change yourself, in
your own editor, and BELL PR's agents only read. The run's Lead becomes
**the guide**: it reads the project, asks about your plan, points and
hints without code, reviews your change when you ask, and explains
failures of the tests BELL PR runs for you. The run keeps the same tabs
and every check of any other run, with one more gate, **Ready for
review**; this section walks through what is different. Learn by hand is
Free. It works on your own projects: the sample shows the agent team
only.

### Choose it

In the task dialog, **Who writes the code?** offers **The agent team
writes it** (the default) and **You write it (Learn by hand)**. Learn by
hand hides the team size, keeps plan approval on ("Always on in Learn by
hand: you confirm your own plan before you write.") and names the dialog
and its start button **Plan with the guide**. The choice holds for the
whole run: the run carries a **Learn by hand** badge, the sidebar and the
contributions list mark it with a hand, and its status reads **Your
turn** until you first mark the change ready. The dialog starts on Learn
by hand when you came from discovery's **Start learning by hand** or the
linked issue is labelled for newcomers, but never before BELL PR has read
the project's rules, and never on a project whose rules ban AI-assisted
contributions or keep issues for newcomers.

Before you write a line, the dialog says what the project's rules mean
for publishing a learn-by-hand run, and when you start, **Before you
write** says it once more:

- When no AI rule of the project applies, there is nothing to say:
  publishing runs the usual checks.
- When the project's rules restrict AI help itself, BELL PR can't tell
  what a rule covers, or the linked issue is kept for people learning
  without AI tools, the dialog says "BELL PR won't publish a learn-by-hand
  run here: …" and "The guide still gives every kind of help.", and
  **Before you write** offers **Practise by hand locally**.
- When the project declines AI-generated content and its own text says
  which uses of AI are fine, you choose between **Fit the guide to the
  project's rules** (preselected) and **Every kind of help, practise
  locally**. A fitted run's guide offers only the kinds of help that text
  names, for the whole run, and publishing asks you to confirm the
  project's quoted rule ([Contributing
  responsibly](contributing-responsibly.md#when-the-projects-own-text-says-some-uses-of-ai-are-fine)
  lists every condition); **Before you write** says so and offers
  **Start anyway**. A run with every kind of help won't be published
  there, and **Before you write** offers **Practise by hand locally**. If the project's rules changed since the dialog read
  them, starting a fitted run is refused: "BELL PR can't fit this run to
  the project's rules any more: …". Check the rules again, or start with
  every kind of help.

### Plan with the guide

Your plan lives in **Agent activity**, which in Learn by hand shows the
run details and your plan, not an agent team. The guide reads the project
first, read-only, and checks the request's premise, so a refuted premise
reaches you before you write a line. Then:

- **Write your own steps first.** Each **Step N** has a title and,
  optionally, its files and "What you'll do here". Add **How will you test
  it?**, **What are you unsure about?** and one prediction before you read
  the code: which function would you change, and why? "No idea yet" is a
  fine answer.
- **Read these first, in your editor**: the code ranges the guide points
  to, as `path:line` you can copy.
- **The guide's steps** stay folded until you save a step of your own.
  **I don't know where to start** shows its step names earlier, and the
  record notes that you asked. After your first draft, **Show the guide's
  step names** reveals them, and **Compare with the guide's steps**
  ("Where your plan and the guide's differ") puts both plans side by side.
  The guide's outline is never run: no agent works from it.
- **Questions on my plan** (up to 3 per run, while you plan): the guide
  reads your plan, not its own, and asks about missing steps, risky
  assumptions, the scope and missing tests. It is told never to give you
  its own plan.
- **This is my plan** confirms it (it needs at least one step you wrote)
  and takes you to **Code changes**. Your answers are then read-only, but
  you can still edit your steps while you write, until you mark the change
  ready for review.

Until you confirm your plan, **Code changes** says that the guide is
reading the code, then that you write your own plan in **Agent activity**
first. In a fitted run whose project text doesn't name planning help, the
guide's step names and **Questions on my plan** stay closed (you still see
its summary and the ranges to read first); your own plan works as usual.
"Send back with feedback" is not offered: the plan is yours. A retry
before you confirm the plan takes the run back to planning with the
guide.

### Your turn

Before your first change, **Code changes** shows **Your turn** with the
run's folder and a copy button: "Open this folder in your editor, make
your first step's change, save, and come back." BELL PR reads the diff again when you come back to
the window (2 seconds after it gets the focus, one read at a time) and
when a test run ends; **Refresh the diff** works too. You don't need to
commit: when you publish, BELL PR makes one commit of the files you
reviewed.

Beside the diff, **The guide** panel shows your steps with **Done** and
**Park**, and, while the run's history is clean, "BELL PR's agents can't
edit files in this run." A banner says when BELL PR won't publish this run
here ("Practise freely."), or that the run is fitted to the project's
rules and which kinds of help the guide offers.

- **Ask the guide** about **Setup and tools**, **This project** or **A
  concept**, or about **My change**, which goes to the next hint of the
  step. Select lines in the diff and choose **Ask the guide about these
  lines** to ask about them. An optional fold takes "What I tried · what I
  expected · what happened".
- **Hints**, one rung at a time per step: **Where to look**, **What
  applies**, **Options** (two or three ways forward with their
  trade-offs, never ranked; you choose one and say why) and **An example
  in this project**. There is no rung with code. After the first hint on a
  step, the next one waits for an attempt: a new edit, a test run BELL PR
  ran, or at least five words on what you tried that differ from last
  time. Otherwise: "Try something first: change the code, run the tests,
  or say what you tried." After **Options** or an example, **Done** on
  that step asks "Why does your change for this step work?"
- **Answers**, newest first: each points to `path:line` and shows code
  only as quotes labelled **From the repository** or **From your change**,
  which BELL PR cuts from the files itself; a pointer to a file that isn't
  in the run's checkout is dropped. When BELL PR removed code from an
  answer, it says "BELL PR removed code from this answer." The panel
  reminds you: "The guide can be wrong. Check its pointers against the
  code and your tests." When a turn fails, it says "The guide couldn't
  answer: …" and gives your question back.
- **I'm stuck** opens the exits, in this order: **Ask a human** (the
  issue and the project's own places to talk, with a note you fill in
  yourself), **Make this step smaller**, **Talk it through** (what you are
  trying, what you expect and what you see, with a short checklist; no AI
  call), **Park this step**, and **Hand this task to the agent team**,
  which starts a new agent run from the task dialog; your edits stay in
  this run's folder.

One guide turn runs at a time per run, and none while your tests run. In
a fitted run, help the project's text doesn't name isn't offered: "Not
offered in this run: the project's text it is fitted to doesn't name …".

### Your tests

BELL PR runs your project's tests only with a command you confirmed, and
only when you click. The **Tests** card suggests a command from the
project's files (`npm test`, `pnpm test` or `yarn test` from
`package.json`; `python -m pytest`, or `python3 -m pytest` when only
`python3` is installed; `cargo test`; `go test ./...`; `make test`), which
you edit and confirm with **Use this command**. It stays confirmed for
the project; every change is a new confirmation. Pick a prediction
(**Pass**, **Fail** or **Not sure**), optionally name the test you expect
to fail, and choose **Run the tests**. **Output so far**
follows the run, **Stop** ends it, and the result reads, for example, "You
predicted Fail; it failed." Files your tests created are named, because
they change the diff.

- **Explain this failure** asks the guide where to look in the output and
  the code.
- **Record my result** records a run in your own terminal, marked
  "reported by you".
- When the same failure comes three runs in a row, the panel suggests
  stepping back to the exits, once per step and failing run.

[Security model](security-model.md#bell-pr-runs-your-test-command)
describes how the command runs and what it can reach.

### Ready for review

While you write, the guide doesn't review your change, and BELL PR writes
no explanation or walkthrough of it. When the change is ready, choose
**Ready for review** in the footer ("Write a change first" while the diff
is empty). The dialog shows the files and lines you
changed and your last test run at this version, or "Not run since your
last edit. It isn't required; the tests are the judge.", and asks what
you are least sure about. **Ask the guide to review it** (on by default)
has the guide read your change and your last test run and point out up to
three problems, each with its evidence, as a question when it has none,
while a test analyst names in words what your tests might not catch.
Neither writes the fix. "The review takes about 2 agent turns." When the
project's rules say something about AI, the dialog reminds you to check
them before you ask for an AI review. A second review needs a test run,
or a result you recorded, at this version since the last review: "Run
your tests on this version first; the tests are the judge." In a fitted
run whose project text doesn't name AI review, the dialog has no review
box and says why, and **Run the review again** isn't shown; without
planning help, the Draft tab doesn't offer **Ask how to split it**.
**Mark it ready** records the version you declared ready; the footer
reads "The guide is reviewing" while the guide reviews it.

The review appears in **Reviews**, under the name "The guide". If you
change the code afterwards, a notice says so, and the review and the check
wait until you mark it ready again; approval needs the version you marked
ready. **Run the review again** opens the same dialog. While the reviewed
version is the ready one, the **Ask** tab takes your questions about a
file or the review; after a new edit, the guide panel's **Ask the guide
about the review** does.

### Explain it back

The understanding check works as in every run (step 6 above), with the
guide hidden, and opens once the change is ready. Its file questions are
fixed: "You wrote the change to <path>. Why this way rather than
another, and what would break if it were wrong?" You compare your answers
with **Your own words** (your plan's steps and the reasons you gave) and
**The guide's review**, shown apart.

### How a reader sees your change

After Ready, a file's explanation and walkthrough are written only when
you ask, with **Show how a reader sees it**: that file only, in up to two
agent turns, and only once your Explain-it-back answer for that file is
saved (for a file without its own question, once every answer is saved;
with the check off, straight away). BELL PR filters them like every guide
answer. Read them as a reader of your pull request would, and compare
them with what you meant. When BELL PR can't read your check, the panel
says why and offers **Try again**.

### Your words in the pull request

In Learn by hand, BELL PR doesn't draft the pull request: the title starts
empty, and the Draft tab says "Write the pull request's title and
description in your own words: in Learn by hand, BELL PR doesn't draft
them, and approval needs both." It offers no AI draft, no AI-assistance
line and no suggested commit message, and when a saved description holds
BELL PR's own AI-assistance line word for word (from an older version,
for example), BELL PR removes it; a line you reworded stays. Approval
waits for both the title and the description: the footer reads "Write the
PR title and description first" and leads to the PR draft tab. Instead:

- **Start from the project's template** puts the project's pull request
  template in at your cursor, or into an empty description, verbatim; it
  never replaces your text. A template that is a symbolic link isn't
  offered.
- **Use my explanation** works as in every run.
- **Facts for an AI note** lists the CLI and model the guide ran on, the
  kinds of help you used, the claim when the run's history is clean, what
  BELL PR can't see and the project's disclosure rule when it has one.
  BELL PR never puts them into the description. With **Always add an
  AI-assistance note to my pull requests** on (**Settings → Agent
  safety**), the tab says "Write your AI note in your own words."

### The record

The publish dialog shows **Learn by hand record**: the kinds of help you
used and how often, BELL PR's runs of your tests and how often your first
prediction after each change was right, how many answers BELL PR removed
code from, and, for a fitted run, the kinds of help it was fitted to.
When the run's history is clean, it says: "BELL PR's agents had no write
access and gave you no code for this change. The guide showed only quotes
of the project's code and of your own edits." Otherwise it says why BELL
PR makes no Learn-by-hand claim for the run. It always says "BELL PR
can't see other tools you used, such as editor autocomplete or another
chat." and "This record is for you. It isn't proof of who wrote the
code." When the quoted confirm applies, it stands right after the record,
and the confirm counts only for the words you saw: if they change, the
tick is cleared. A line in your text saying that no AI helped, in a run
the guide helped with, is quoted beside your help record under **Your
words and reviewability**, for you to confirm or reword. When BELL PR
can't read its checks for the run, the dialog says so and offers **Try
again**, and **Submit Draft PR** stays off. The learning page shows the
run with a **Learn by hand** badge and the same counts, never the claim;
the complete learning record export (Pro) has a Learn-by-hand section.

### After publishing

Reading maintainer feedback works as in every run. When a fitted run was
published through the quoted confirm, the Draft tab's rules row says "You
confirmed the project's quoted rule when you published. The maintainers
decide whether your change fits."

AI follow-up rounds aren't offered: push follow-up commits from the run's
folder with your own Git; BELL PR takes them over at the next feedback
read. Taking over means BELL PR records them as the pull request's
commits; it doesn't check or review them. It does so only when the run's
folder has no uncommitted changes, is on the run's own branch, and its
latest commit is the head of the pull request's branch on GitHub.
Otherwise nothing in the folder moves and the feedback is still read;
when GitHub can't be reached, the run log says so, and in the other cases
it says what to do first:

- "Push your commits first; BELL PR takes them over once they are on the
  pull request's branch."
- "Commit or discard your changes in the run's folder first."
- "The run's folder isn't on its branch …. Switch back to it first; BELL
  PR takes over commits only from that branch."
- "The pull request's branch has commits the run's folder doesn't have
  yet. Pull them into the run's folder first; …"

A sync of the pull request onto the latest target branch refuses with the
same words, and, like every sync, never overwrites a file you save while
it runs (see [After publishing](#8-after-publishing)). When the pull
request's history was rewritten, BELL PR refuses as it does for every run. Conflicts are yours to resolve: there is no
conflict agent. "Resolve the markers by hand; BELL PR re-checks them when
you refresh the diff on the Code changes tab." Approval waits until every
marker is gone, and changed files need another review.

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
  hand: write this one yourself", with **Open the issue** and **Start
  learning by hand**. Where the project keeps such issues for people
  learning without AI tools, the card says so and offers no start; where
  it closes AI-generated pull requests for them, the card says that BELL
  PR can publish a learn-by-hand run only through the project's own text,
  and the task dialog shows whether it can.

## Shortcuts

- **Ctrl+K** (⌘K on macOS) opens the quick switch between projects and
  contributions.
- **?** outside a text field opens the guide.
- The workspace tabs follow the arrow keys, Home and End.

Next: [Configuration](configuration.md), [Troubleshooting](troubleshooting.md)
and [FAQ](faq.md).
