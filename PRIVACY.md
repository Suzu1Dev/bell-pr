# BELL PR Privacy Policy

> **DRAFT, pending counsel review.** This is a working draft. It is not in
> force and it is not legal advice. Do not publish it until counsel has
> reviewed it and every owner placeholder below is filled in.

## Owner placeholders

Fill in each item, then delete this list. Each item appears exactly once in
the text below, as a bracketed placeholder that starts with OWNER.

- [ ] **Seller** (Who we are): the seller's legal name, legal form and
  postal address.
- [ ] **Merchant of Record** (Buying a Pro license): the payment provider.
- [ ] **Order record retention** (Buying a Pro license): how long order
  records are kept.
- [ ] **Privacy contact** (Your rights): an e-mail address or form for
  privacy requests.

---

## Summary

- BELL PR runs on your computer. There is no BELL PR cloud service and no
  BELL PR account. <!-- claim:PRIV-01 -->
- BELL PR sends no telemetry, analytics or crash reports, and there is no
  license server. The app never contacts us. <!-- claim:PRIV-02 -->
- Your code and your questions go only to the services you set up yourself:
  the AI provider behind the coding CLI you choose, and GitHub. They go
  there under your own accounts and those services' privacy policies. <!-- claim:PRIV-03 -->
- Web access for agents is off unless you turn it on. <!-- claim:PRIV-04 -->
- Everything BELL PR stores stays in its data directory on your computer,
  and you can delete it from the app. <!-- claim:PRIV-05 -->

## Who we are

[OWNER: seller legal name, legal form and address] ("we") makes BELL PR.
This policy explains what the BELL PR app does with data on your computer,
and what we do with data when you buy a Pro license or contact us. <!-- claim:PRIV-06 -->

## What BELL PR does not do

- It sends no telemetry, usage analytics, crash reports or diagnostics to us
  or to anyone else. It does not check for updates either. <!-- claim:PRIV-07 -->
- It uses no license server. License keys are checked offline on your
  computer; activating a key, removing it or starting the trial sends
  nothing anywhere. <!-- claim:PRIV-08 -->
- Its web interface loads nothing from other sites. Fonts and icons are
  bundled with the app (self-hosted), and its content security policy
  blocks requests to other sites. <!-- claim:PRIV-09 -->
- It does not store the passwords and tokens of the tools it runs. git, the
  GitHub CLI, the Codex CLI and Claude Code keep their own sign-ins; BELL PR
  only asks them whether you are signed in. <!-- claim:PRIV-10 -->

## What leaves your computer, and where it goes

BELL PR runs command-line tools that you installed and signed in to. Those
tools send data to their providers under your accounts. Each provider's own
terms and privacy policy decide what it keeps, for how long, and whether it
may use the data to train models. <!-- claim:PRIV-11 -->
The tools may also send their own usage data to their providers; BELL PR
neither adds to that data nor turns it off. BELL PR starts each agent CLI
with only the environment variables it needs to run and sign in, and starts
the Codex CLI without its `config.toml`, so a usage-data setting that you
made in another environment variable, or in that file, does not reach the
agents BELL PR runs. <!-- claim:PRIV-12 -->

### The AI coding CLI you choose

Contribution runs, project analysis, discovery, explanations, follow-up
questions, pull request drafts, maintainer-feedback coaching, conflict
resolution and follow-up rounds use the OpenAI Codex CLI or Claude Code. The CLI sends data to its
provider: OpenAI for the Codex CLI, and Anthropic for Claude Code, or the
cloud platform you set Claude Code up to use, such as Amazon Bedrock,
Google Vertex AI or Microsoft Foundry. <!-- claim:PRIV-13 -->
It sends:

- the instructions BELL PR writes for each task, including the contribution
  direction you describe and the plan you approved; <!-- claim:PRIV-14 -->
- source code and other files of the repository you imported: the files the
  agents open, the excerpts BELL PR selects for project analysis, diffs, and
  the project's contribution guidelines and pull request template; <!-- claim:PRIV-15 -->
- the output of the commands the agents run in the working copy, such as
  builds and tests; <!-- claim:PRIV-16 -->
- the questions you ask about a change, with the diff, explanation and
  review reports they refer to; <!-- claim:PRIV-17 -->
- the review comments and check results of your pull request, when you ask
  for maintainer-feedback coaching or start a follow-up round; <!-- claim:PRIV-18 -->
- for discovery, your search interests and the public details, documents,
  open issues and comments of the GitHub repositories that the search
  found. <!-- claim:PRIV-19 -->

Before BELL PR saves run logs, agent answers, your questions and team
messages, it masks text shaped like a credential, such as GitHub tokens, API
keys, license keys and private keys. It does the same with the context of a
pull request draft before an agent sees it. <!-- claim:PRIV-20 -->

### GitHub, through the GitHub CLI and git

Under your GitHub account, BELL PR:

- clones and fetches the repositories you import, and reads their details,
  issues, contribution guidelines and templates; <!-- claim:PRIV-21 -->
- searches GitHub for projects, when you run discovery; <!-- claim:PRIV-22 -->
- reads the review comments and check results of your pull requests, when
  you ask for maintainer-feedback coaching; <!-- claim:PRIV-23 -->
- writes only after you approve: it creates a fork when needed, pushes a
  branch and opens a draft pull request with the title, description and
  commits you approved, and later pushes only the follow-up commits you
  approved. It never force-pushes. <!-- claim:PRIV-24 -->

Commits carry the git name and e-mail address you configured, and they
become public on GitHub. <!-- claim:PRIV-25 -->
The app asks you to confirm, once per address, before it publishes a commit
e-mail address that is not a GitHub no-reply address. <!-- claim:PRIV-26 -->

### Web access for agents (off by default)

Web access is a Pro feature that you turn on in the AI provider settings. <!-- claim:PRIV-27 -->
While it is on, the agents that work on a contribution (the team, the
mentor that answers your follow-up questions, conflict resolution and
follow-up rounds) can search the web and read web pages through the AI
CLI's own web tools. Project analysis, discovery, explanations and pull
request drafts never get it. <!-- claim:PRIV-28 -->
Search queries go to the provider's search service. With Claude Code,
agents may open pages only on github.com, docs.github.com and
raw.githubusercontent.com; the Codex CLI uses OpenAI's own web search. <!-- claim:PRIV-29 -->
The run log records the queries and addresses, not the page contents. <!-- claim:PRIV-30 -->
Agents are told not to put repository contents, file paths or secrets into
queries, but that is an instruction to an AI model, not a guarantee: leave
web access off for confidential code. <!-- claim:PRIV-31 -->

## What BELL PR stores on your computer

BELL PR keeps its data in one data directory: `~/.bellpr` by default, or the
directory you choose with `--data-dir` or `BELLPR_DATA_DIR`. <!-- claim:PRIV-32 -->
BELL PR keeps the directory at permissions 0700, so other user accounts
cannot read anything in it, and creates its files readable by your user
account only. <!-- claim:PRIV-33 -->

| Item | What it holds |
| --- | --- |
| `state.json`, with `state.json.bak.1` to `.bak.3`, `state.quarantine.json` and `state.json.corrupt-<time>` | The repositories you imported and your runs: contribution directions, plans, agent logs and reports, review progress, explanations, follow-up questions and answers, notes and pull request drafts. A damaged file is kept aside, never silently dropped. |
| `repositories/` | BELL PR's own clones of the repositories you imported, from GitHub or from a folder on your computer. |
| `worktrees/` and `team-worktrees/` | A working copy for each run and each teammate, with the changes the agents made. |
| `insights/` | Each project's cached analysis, recommendations and contribution preferences. |
| `model-settings.json` | The agent tool, model, reasoning effort and web access setting you chose. |
| `discovery.json` | Discovery preferences, jobs and results. |
| `license.json` | The license key you activated, when you activated it, the latest time the app saw (to notice a clock that was set back), and the trial start date. |
| `app-settings.json` | Language, limits, onboarding status, the version of the license terms you accepted, safety settings, the AI-assistance note setting and the retention period. |
| `author-emails.json` | SHA-256 fingerprints of the commit e-mail addresses you confirmed when publishing, so the app asks only once per address. |
| `children.json` | Process IDs of the agent tools that are running, so that BELL PR can stop leftovers after a crash. |
| `logs/` | Daily log files, at most 7 files and 50 MB in total. Secret-shaped text is masked, and BELL PR does not write prompts or page contents to them. |
| `bellpr.lock` and `run/` | The running instance's process ID, address, port, version and start time, and the one-time sign-in link for `bell-pr open`, which that command deletes as soon as it has read it. |

<!-- claim:PRIV-34 -->

While a run works, Git may also keep short-lived temporary files in the
data directory. BELL PR deletes them when the step is done, or at the next
start after a crash. <!-- claim:PRIV-35 -->

Your browser also keeps some data for this local site only: the language you
chose, the contribution you opened last, layout preferences and the sample
project's progress (in local storage), a note that the page reloaded once
after an update (in session storage), and a sign-in cookie that is valid for
30 days. <!-- claim:PRIV-36 -->

If you set `BELLPR_LICENSE_KEY`, the key is also wherever you set that
variable. <!-- claim:PRIV-37 -->

The working copies of cancelled and failed runs are removed automatically
14 days after their last activity, or after the retention period you set in
Settings (1 to 365 days). Runs in review, approved runs and published runs
keep their working copy until you free it, because reviews, follow-up rounds
and syncing need it. <!-- claim:PRIV-38 -->
The run records stay until you delete them. <!-- claim:PRIV-39 -->

## Deleting your data

In the app you can free a run's working copy, delete a run, and remove an
imported repository together with BELL PR's clone and its cached analysis. <!-- claim:PRIV-40 -->
"Delete all data" in Settings erases every project, run, analysis,
discovery result, log and backup at once; it keeps your settings, your
license and the running server's own files. <!-- claim:PRIV-41 -->
To remove everything, stop BELL PR, delete the data directory, and clear
the site data that your browser keeps for BELL PR's address. <!-- claim:PRIV-42 -->

Data you sent to GitHub or to an AI provider is under that service's
control. Delete it there under that service's policies, for example by
closing a pull request or deleting a fork. We never receive your project
data, so we cannot delete it for you. <!-- claim:PRIV-43 -->

## License keys

A license key is checked offline against a public key built into the app. <!-- claim:PRIV-44 -->
The key contains a license ID, the plan, the number of seats, and dates:
the issue date, and either the end of the update period or, for
subscriptions, the expiry date. <!-- claim:PRIV-45 -->
It contains a name and an e-mail address only if the seller embeds them
when issuing the key; keys from a pre-issued pool contain neither. <!-- claim:PRIV-46 -->
The key stays on your computer, in `license.json` or in
`BELLPR_LICENSE_KEY`. The app shows its name and e-mail address, when it
has them, in the License section of Settings, in the About dialog and in
`bell-pr license status`. <!-- claim:PRIV-47 -->
Logs record only the license ID and the plan. <!-- claim:PRIV-48 -->

## Buying a Pro license

Pro licenses are sold through our Merchant of Record,
[OWNER: provider], which processes your payment, taxes and invoices under
its own privacy policy. We do not receive your payment card details. <!-- claim:PRIV-49 -->

From the Merchant of Record we receive what we need to deliver and support
your license: your name, e-mail address, country, order number and the
license ID we issued. We use this information to deliver license keys,
handle refunds and revocations, answer your support requests, and meet our
tax and accounting obligations. <!-- claim:PRIV-50 -->
We keep these order records for
[OWNER: retention period for order records]. We do not sell them or use them
for advertising. <!-- claim:PRIV-51 -->

## Contacting us

If you contact us, we receive what you send, and we use it only to answer
you. <!-- claim:PRIV-52 -->
The About dialog can copy a diagnostics report to your clipboard: the app
and Node.js versions, the operating system, the versions and sign-in status
of the tools BELL PR uses, its limits, the size of the data directory and
the number of projects and runs, and up to 500 recent log lines. Secrets,
paths and your GitHub user name are masked in it. <!-- claim:PRIV-53 -->
It reaches us only if you choose to send it, so check it before you do. <!-- claim:PRIV-54 -->

## Your rights

Depending on where you live, you may have the right to access, correct or
delete the personal data we hold about you (in practice, order and support
records), to object to or restrict its use, and to receive a copy of it. To
make a request, contact [OWNER: privacy contact]. You may also complain to
your data protection authority. <!-- claim:PRIV-55 -->

## Children

BELL PR is a developer tool and is not directed at children. <!-- claim:PRIV-56 -->

## Changes to this policy

We publish changes to this policy with the release notes of the app. Each
release ships with the version of this policy that applies to it. <!-- claim:PRIV-57 -->
