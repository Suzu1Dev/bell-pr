# Getting started

This guide takes you from installing BELL PR to your first Draft PR. Finish
**Before you start**, then walk the sample tour before you touch a real
project.

## Before you start

You need:

- **Node.js 22 or later** ([nodejs.org](https://nodejs.org/en)).
- **Git**. Syncing a run onto the latest target branch needs Git 2.40 or
  later. Set your name and e-mail once:
  `git config --global user.name "Your Name"` and
  `git config --global user.email "you@example.com"`.
- **The GitHub CLI** (`gh`), signed in with `gh auth login`
  ([cli.github.com](https://cli.github.com/)), to import from GitHub,
  publish pull requests and find projects.
- **An AI coding CLI**, installed and signed in as the same user that runs
  BELL PR. Either one is enough; usage counts against **your own** account:
  - Codex CLI: `npm install -g @openai/codex`, then `codex login`.
  - Claude Code: `npm install -g @anthropic-ai/claude-code`, then
    `claude auth login` (Claude plan or Anthropic API key).
- **On Linux, bubblewrap and socat**, so Claude Code agents that edit files
  run in the OS sandbox (`sudo apt-get install bubblewrap socat` on
  Debian/Ubuntu). macOS has its sandbox built in.

BELL PR runs on **macOS** and **Linux**, and on Windows inside **WSL2**
([install WSL](https://learn.microsoft.com/windows/wsl/install); install
everything above inside WSL). WSL2 itself is **untested** for 1.0.0-rc.1
browser and agent runs.

`bell-pr doctor` checks all of this and prints the command that fixes each
problem. `bell-pr start` listens only when every required check passes.
The Welcome screen runs the same check.

### With no AI provider configured

`provider-ready` is a **required** doctor check. With neither Codex CLI nor
Claude Code installed and signed in:

- `bell-pr doctor` exits non-zero and reports **Not ready**.
- `bell-pr start` exits non-zero before it listens, and prints each failed
  required check with the command that fixes it.
- `bell-pr start --force` starts anyway and prints a warning. `/api/status`
  then shows `ready: false`.
- Welcome lets you continue. You can take the **sample tour** (no AI call,
  no GitHub). Import is offered; starting a **real** agent run is refused
  until a provider is ready. Discovery needs a signed-in GitHub CLI.

### Cost of a sample run

<!-- TODO(Suzu / Product Tester): After one real end-to-end contribution
     (not the offline Sample project), record: provider, model, input and
     output tokens the run reported, and the billed amount from the
     provider invoice or dashboard. Paste the measured numbers below.
     Do NOT invent estimates. -->

Agent usage is billed by **your** Codex or Claude account. BELL PR does not
set prices. Measured tokens and cost for a typical first contribution are
**not published yet**.

## Start BELL PR

```sh
npx bell-pr
```

or install once and start by name:

```sh
npm install -g bell-pr
bell-pr
```

It prints its address and opens the browser:

```text
BELL PR 1.0.0-rc.1 → http://127.0.0.1:4311
```

That line appears only when every required doctor check passed, or when
you passed `--force`. Otherwise `bell-pr start` exits first and prints the
fixes. `--force` is how the sample tour opens with no AI provider signed in.

Keep the terminal open (Ctrl+C stops it). BELL PR has **no sign-in of its
own**: anyone who can reach its address can use everything it can do,
including starting agents with your Codex or Claude Code account and
publishing with your `gh` sign-in. By default it listens on `127.0.0.1`, so
only this computer can reach it. See [Security model](security-model.md).

> **Lost the address?** Run `bell-pr open` (or `npx bell-pr open`). See
> [Troubleshooting](troubleshooting.md#i-lost-the-address).

`bell-pr start --port <port>` picks another port. For a service, Docker or
a reverse proxy, see [Self-hosting](self-hosting.md) and [Docker](docker.md).

## The Welcome steps

1. **Language** — English or Traditional Chinese (Taiwan). Change later in
   Settings.
2. **Environment** — same check as `bell-pr doctor`, with copyable fix
   commands. You can continue and finish fixes in **Settings → Environment**.
3. **AI provider** — if one CLI is ready, agents use it; if both are, you
   choose. With none ready, start with `bell-pr start --force`; Welcome
   then says you can still take the sample tour.
4. **Get started** — sample tour, import a repository, or find a project
   (Discovery needs `gh`).

## Try the sample project

A finished contribution to a small HTTP client: fictional project rules,
plan, diffs, explanations, understanding check and PR draft. **No tools,
no account, no AI call, nothing sent to GitHub.** Open from Home (**Try the
sample project**) or **Sample** in the sidebar. Use it before a real repo.

## 1. Import a repository

On **Repositories**, import as `owner/repo`, a GitHub URL, or a local Git
path (on Windows, the path **inside WSL**, e.g. `/mnt/c/projects/repo`).

BELL PR keeps its own full clone under the data directory; your folder is
never changed. Clones longer than 10 minutes stop — clone yourself and
import the folder. Later, **Update to the latest version** refreshes a
GitHub project's default branch.

## 2. Understand the project

**Before you contribute** (project overview) quotes the project's own rules
(file + line): AI policy, disclosure, own-words descriptions, newcomer
issues, open-issue-first, and whether pull requests are open to you. Facts
BELL PR could not read show as "Couldn't check" / "Couldn't read" — never
as a pass. **Check again** re-reads them.

**Analyze the project** runs a read-only agent: what the project does, who
uses it, how parts fit, where to start reading, and up to five contribution
directions with verified quotes. **Generate 5 more** adds more (cap 30).

## 3. Choose a direction

Describe who benefits, what changes for users, what must not change, and
what counts as done. Optionally link one GitHub issue. **Before you start**
under the issue field shows open/closed, assignees, competing PRs,
newcomer labels and your open-PR budget — none of that blocks local
practice; publishing re-checks.

Set team size (2–4 teammates), plan approval, and efficiency mode. Agent,
model and reasoning effort are shared across projects.

## 4. Let the agent team work

**Generate the team plan** or **Start the agent team**. In **Agent
activity**: the Lead plans (with a premise check), you may approve or send
the plan back (up to 3 times), Teammates work in parallel worktrees, then
Reviewer and Test analyst report. Agents must not change your machine; any
missing setup appears under "Setup this machine needs from you" for you to
run yourself. Failed subtasks can be retried. Concurrent runs follow
**Settings → Performance** (default 2).

## 5. Review every change

In **Code changes**: each file's diff plus a plain-language explanation,
optional **Ask** on a line, reviews, **Walkthrough**, and your notes. Mark
each file **Reviewed**. **Try first** prompts ask you to answer before the
reveal, then **you** grade yourself. You can edit files under the run's
`worktrees/` folder and **Refresh the diff**.

Explanations come from an AI and can be wrong — check them against the code.

## 6. Explain it back

When every file is Reviewed, **Explain it back** opens a short closed-book
check next to the diff (explanations and agent Q&A hidden; diff stays):

1. Explain the change in 2–4 sentences of your own (≥15 words).
2. Answer up to three questions on the riskiest files (scaled by size) and,
   when source changed, what you did not test.
3. Compare each answer to its reference and **grade yourself** (Got it /
   Partly / Missed). No AI model grades you; the check makes no AI call.
4. Correct anything graded Partly or Missed.
5. Optionally predict what a maintainer will question.

The result is a receipt, not a score. The check is on by default; you can
turn it off under **Settings → Learning** (runs then marked "Check off").
Every file must still be Reviewed, you still approve, and project-rule /
issue / pacing checks still apply.

## 7. Prepare and publish the pull request

On **PR draft**, edit the suggested title, description and commit message
(each with rule sources). **Use my explanation** / **Add my not-tested
answer to Testing** insert your words only when you click. Review the
reviewability snapshot and maintainer checklist. Credentials and unfinished
placeholders block publish; local paths, CI changes and non-noreply commit
e-mails need confirmation.

**Approve and prepare the PR**, then **Submit Draft PR**: GitHub facts are
read again, the branch is pushed (to a fork if needed) and a **Draft** PR
opens. Nothing is force-pushed. Blocks and confirms are listed in
[Troubleshooting](troubleshooting.md#publishing-was-blocked-by-a-project-rule-an-issue-or-pacing).

## 8. After publishing

- **Sync** to the latest target branch (review again any files the target
  changed; conflicts by hand or with the agent).
- **Read feedback** once when you ask — no polling. Answer on GitHub in
  your own words.
- Tag comments against your forecast; start a **follow-up round** after you
  restate each selected comment in your own words; review and push as one
  commit.
- **Commit history** lists every commit on the PR.

## Keep learning

**Learning notes**, **Practice** (1 / 3 / 7 / 21 days), plain counts (never
scores), **Coach debrief**, **Export learning record**, and **Explore
contributions** (newcomer issues marked Learn by hand).

## Shortcuts

- **Ctrl+K** (⌘K on macOS) — quick switch between projects and runs.
- **?** outside a text field — guide.
- Workspace tabs — arrow keys, Home, End.

Next: [Configuration](configuration.md), [Troubleshooting](troubleshooting.md),
[FAQ](faq.md).
