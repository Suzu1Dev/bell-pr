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
  BELL PR account.
- BELL PR sends no telemetry, analytics or crash reports, and there is no
  license server. The app never contacts us.
- Your code and your questions go only to the services you set up yourself:
  the AI provider behind the coding CLI you choose, and GitHub. They go
  there under your own accounts and those services' privacy policies.
- Web access for agents is off unless you turn it on.
- Everything BELL PR stores stays in its data directory on your computer,
  and you can delete it from the app.

## Who we are

[OWNER: seller legal name, legal form and address] ("we") makes BELL PR.
This policy explains what the BELL PR app does with data on your computer,
and what we do with data when you buy a Pro license or contact us.

## What BELL PR does not do

- It sends no telemetry, usage analytics, crash reports or diagnostics to us
  or to anyone else.
- It uses no license server. License keys are checked offline on your
  computer; activating a key, removing it or starting the trial sends
  nothing anywhere.
- Its web interface loads nothing from other sites. Fonts and icons are
  bundled with the app (self-hosted), and its content security policy
  blocks requests to other sites.
- It does not read or store the passwords and tokens of the tools it runs.
  git, the GitHub CLI, the Codex CLI and Claude Code keep their own
  sign-ins.

## What leaves your computer, and where it goes

BELL PR runs command-line tools that you installed and signed in to. Those
tools send data to their providers under your accounts. Each provider's own
terms and privacy policy decide what it keeps, for how long, and whether it
may use the data to train models.

### The AI coding CLI you choose

Contribution runs, project analysis, discovery, explanations, follow-up
questions and pull request drafts use the OpenAI Codex CLI or Claude Code.
The CLI sends data to its provider: OpenAI for the Codex CLI, and Anthropic
for Claude Code, or the cloud platform you set Claude Code up to use, such
as Amazon Bedrock or Google Vertex AI. It sends:

- the instructions BELL PR writes for each task, including the contribution
  direction you describe and the plan you approved;
- source code and other files of the repository you imported: the files the
  agents open, the excerpts BELL PR selects for project analysis, diffs, and
  the project's contribution guidelines and pull request template;
- the output of the commands the agents run in the working copy, such as
  builds and tests;
- the questions you ask about a change, with the code and notes they refer
  to;
- for discovery, summaries of the GitHub repositories that the search found.

### GitHub, through the GitHub CLI and git

Under your GitHub account, BELL PR:

- clones and fetches the repositories you import, and reads their details,
  issues, contribution guidelines and templates;
- searches GitHub for projects, when you run discovery;
- reads the review comments and check results of your pull requests, when
  you ask for maintainer-feedback coaching;
- writes only after you approve: it creates a fork when needed, pushes a
  branch and opens a draft pull request with the title, description and
  commits you approved.

Commits carry the git name and e-mail address you configured, and they
become public on GitHub. The app asks you to confirm before it publishes an
e-mail address that is not a GitHub no-reply address.

### Web access for agents (off by default)

Web access is a Pro feature that you turn on in Settings. While it is on,
agents in contribution runs and follow-up chat can search the web and read
web pages through the AI CLI's own web tools. Search queries go to the
provider's search service, and pages are fetched from the sites that host
them. The run log records the queries and addresses, not the page contents.
Agents are told not to put repository contents or secrets into queries, but
that is an instruction to an AI model, not a guarantee: leave web access off
for confidential code.

## What BELL PR stores on your computer

BELL PR keeps its data in one data directory: `~/.bellpr` by default, or the
directory you choose with `--data-dir` or `BELLPR_DATA_DIR`. The directory
has permissions 0700, so other user accounts cannot read anything in it, and
the files BELL PR writes itself have permissions 0600.

| Item | What it holds |
| --- | --- |
| `state.json`, with `state.json.bak.1` to `.bak.3` and `state.quarantine.json` | The repositories you imported and your runs: contribution directions, plans, agent logs and reports, review progress, explanations, follow-up questions and answers, notes and pull request drafts. Token-shaped strings are masked in logs and questions before they are saved. |
| `repositories/` | Clones of the repositories you imported. |
| `worktrees/` and `team-worktrees/` | A working copy for each run and each teammate, with the changes the agents made. |
| `insights/` | Cached project analyses and recommendations. |
| `model-settings.json` | The agent tool, model, reasoning effort and web access setting you chose. |
| `discovery.json` | Discovery preferences, jobs and results. |
| `license.json` | The license key you activated, when you activated it, the latest time the app saw (to notice a clock that was set back), and the trial start date. |
| `app-settings.json` | Language, limits, onboarding status, the version of the license terms you accepted, safety settings and the retention period. |
| `children.json` | Process IDs of the agent tools that are running, so that BELL PR can stop leftovers after a crash. |
| `logs/` | Daily log files, at most 7 files and 50 MB. Secrets are redacted, and prompts and page contents are never logged. |
| `bellpr.lock` and `run/` | The running instance's process ID and port, and a one-time sign-in link that is deleted as soon as it is read. |

Your browser also keeps some data for this local site only: the language you
chose, layout preferences, the sample project's review progress and drafts
(in localStorage), and a sign-in cookie that is valid for 30 days.

If you set `BELLPR_LICENSE_KEY`, the key is also wherever you set that
variable.

The working copies of finished, cancelled and failed runs are removed
automatically after 14 days, or after the retention period you set in
Settings. The run records stay until you delete them.

## Deleting your data

In the app you can free a run's working copy, delete a run, and remove an
imported repository together with its clone and cached analyses. Settings
can erase all BELL PR data at once. To remove everything after you
uninstall BELL PR, delete the data directory.

Data you sent to GitHub or to an AI provider is under that service's
control. Delete it there under that service's policies, for example by
closing a pull request or deleting a fork. We never receive your project
data, so we cannot delete it for you.

## License keys

A license key is checked offline against a public key built into the app.
The key contains a license ID, the plan, the number of seats, and dates: the
issue date, the end of the update period and, for subscriptions, the expiry
date. It contains a name and an e-mail address only if the seller embeds
them when issuing the key; keys from a pre-issued pool contain neither. The
key stays on your computer, in `license.json` or in `BELLPR_LICENSE_KEY`,
and the app can show its name and e-mail address in Settings. Logs record
only the license ID and the plan.

## Buying a Pro license

Pro licenses are sold through our Merchant of Record,
[OWNER: provider], which processes your payment, taxes and invoices under
its own privacy policy. We do not receive your payment card details.

From the Merchant of Record we receive what we need to deliver and support
your license: your name, e-mail address, country, order number and the
license ID we issued. We use this information to deliver license keys,
handle refunds and revocations, answer your support requests, and meet our
tax and accounting obligations. We keep these order records for
[OWNER: retention period for order records]. We do not sell them or use them
for advertising.

## Contacting us

If you contact us, we receive what you send, and we use it only to answer
you. The app can copy a diagnostics report to your clipboard: the app
version, the operating system, the versions and sign-in status of the CLI
tools, the data directory size and recent redacted log lines. It reaches us
only if you choose to send it, so check it before you do.

## Your rights

Depending on where you live, you may have the right to access, correct or
delete the personal data we hold about you (in practice, order and support
records), to object to or restrict its use, and to receive a copy of it. To
make a request, contact [OWNER: privacy contact]. You may also complain to
your data protection authority.

## Children

BELL PR is a developer tool and is not directed at children.

## Changes to this policy

We publish changes to this policy with the release notes of the app. Each
release ships with the version of this policy that applies to it.
