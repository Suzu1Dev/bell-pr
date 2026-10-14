# Frequently asked questions

## The idea

### Does BELL PR open pull requests by itself?

No. Nothing reaches GitHub until you have reviewed every changed file and
approved the exact title, description and commit, on every plan. Even then
BELL PR opens a **Draft** PR, which you mark ready on GitHub when you are.
It never force-pushes, never replies to maintainers for you and never ticks
a template's checkboxes for you.

### Then what is it for?

Learning while you contribute. BELL PR is for developers who want to help
unfamiliar open-source projects and still understand every line they
submit. An agent team does the legwork in isolated worktrees, and BELL PR
explains every change in plain language, with an example, alternatives and
a question to test yourself, and answers your follow-up questions. You
review, you decide, and the pull request is yours. It is not a tool for
mass-producing automatic PRs; maintainers' time is precious.

### Will maintainers know that AI helped?

That is your decision, within the project's rules. BELL PR mentions AI
assistance only when the project's rules require a disclosure (the draft's
checklist then quotes the rule) or when you turn the AI-assistance note on,
for one draft or for all of them under **Settings → Agent safety**. Some
projects do not accept AI-assisted contributions at all; read their rules
before you start. Discovery leaves out projects that say so.

## AI providers and costs

### Which AI does BELL PR use?

The AI coding CLI you installed and signed in to: the OpenAI Codex CLI or
Claude Code. BELL PR starts the CLI on your computer for each agent turn;
it has no model of its own and no BELL PR cloud.

### Do I need an API key? What does it cost?

BELL PR uses the sign-in your CLI already has. With the Codex CLI: BELL PR
uses the Codex CLI you installed and signed in to, and usage counts
against your own account. With Claude Code: BELL PR uses the Claude Code
CLI you installed and signed in to (Claude plan or Anthropic API key), and
usage counts against your own account. Your provider's prices and usage
limits apply. Agent teams run several agents at once, which uses your
limits faster; **Settings → Performance** sets how many run at the same
time.

Each run shows the usage the provider reported, as tokens and calls. BELL
PR does not convert it into money, and usage a provider does not report is
shown as unknown.

### Which models can I use?

The models your CLI offers. Choose the agent, the model and the reasoning
effort in the model settings; they are shared by every project, and each
run records the ones it started with. On Free you can choose efforts up to
high; leaving the effort on "Default" uses the model's own default on every
plan. xhigh, max and ultra need Pro.

## Privacy and safety

### Does my code leave my computer?

Only to the services you set up yourself: your AI provider, through its
CLI, receives the instructions, the code the agents read and your
questions; GitHub receives what you import, search and publish. BELL PR's
maker receives nothing. There is no telemetry, no analytics and no license
server. Details: [Privacy and your data](privacy-and-data.md).

### Can I use BELL PR on private repositories?

Yes, if your GitHub CLI account can access them. Remember that the agents
send the code they read to your AI provider; do not import a project whose
code your provider must not see.

### Can the agents harm my computer?

Agents run the imported project's code, its tests and build scripts, on
your computer, so import only projects you are willing to run. BELL PR
limits what they can do: agents that write code run in their CLI's
operating-system sandbox, which keeps their writes in the run's working
copy and closes the network; every agent is denied your SSH keys, the
GitHub CLI's sign-in and BELL PR's own data; and the project's own agent
instructions and settings are never loaded. Codex's sandbox does not limit
reading. If you allow unsandboxed Claude Code agents, they have your full
user rights, and those runs are marked. The [security model](security-model.md)
explains every protection and its limits.

### Why do I need a sign-in link for a program on my own computer?

BELL PR is a local web server. The link proves that the browser belongs to
you and not to another user of the computer, another machine or a web page
you visit. Lost it? Run `bell-pr open`.

## Plans

### What is free?

The whole contribution loop: importing, project analysis with five
recommendations, an agent team of a Lead, two teammates, a Reviewer and a
Test analyst, review with explanations and questions, PR drafts, publishing
and syncing, one contribution at a time. Pro adds bigger and parallel
teams, discovery, more recommendations, maintainer-feedback coaching and
follow-up rounds, learning-record export, web access and deep reasoning
efforts. The full table is in [Licensing](licensing.md#free-and-pro).

### Does the trial need an account or a card?

No. **Settings → License → Start 14-day trial** (or `bell-pr license
trial`) starts it on your computer; nothing is sent anywhere. Each data
directory gets one trial.

### What happens when the trial or the license ends?

BELL PR returns to Free. You lose nothing: runs, analyses, discovery
results, notes and the learning page stay readable, and runs that already
started can be continued or cancelled.

## Using it

### Which platforms does it run on?

macOS, Linux, and Windows through WSL2. It needs Node.js 22 or later, Git,
the GitHub CLI and the Codex CLI or Claude Code. There is also a Docker
image, in beta: [Docker](docker.md).

### Does it work with GitLab or Bitbucket?

Not for publishing: BELL PR imports from GitHub and opens pull requests
there. You can import a local Git repository without a GitHub remote to
analyze it, run agents and review the changes, but such runs cannot be
published.

### Can I change the agents' code myself?

Yes. **Code changes** shows the run's worktree path with a copy button.
Edit the files in your own editor (do not commit; BELL PR does that when
you publish), then choose **Refresh the diff**. Changed files get new
explanations and need another review.

### Can several people use one BELL PR?

No. BELL PR is a single-user tool: it works with one person's Git, GitHub
and AI sign-ins. Each person runs their own. To reach your BELL PR from
another of your machines, put an HTTPS reverse proxy in front of it, as
[Self-hosting](self-hosting.md) describes; never expose it to the internet
without one.

### Can I run two BELL PRs on one computer?

Yes, with different data directories and ports, for example
`bell-pr start --data-dir ~/bellpr-work --port 4400`. Each data directory
allows one running BELL PR, and the sign-in cookies of different ports do
not interfere.

### Which languages does it speak?

English and Traditional Chinese (Taiwan). The language you choose applies
to the interface and to what agents write for you. Pull request titles and
descriptions stay in English unless the project's rules ask for another
language.

### Can I show BELL PR in a talk or a screen share?

Yes. Add `?present=1` to the address after the `#/…` part, for example
`#/home?present=1`: your GitHub login then reads "you" and paths lose their
folders. The sample project can play its whole run as a timeline with
`#/runs/demo-run/activity?demo=play`; `speed=1` to `4` sets the pace, and
`locale=en` or `locale=zh-TW` sets the language for that page load only.

### Where is my data, and how do I delete it?

In `~/.bellpr` unless you chose another data directory. **Settings → Data &
privacy** shows its size, frees the files of single runs and deletes
everything. See [Privacy and your data](privacy-and-data.md#deleting-data).

### Does BELL PR change my Git or CLI configuration?

No. BELL PR never changes the global configuration of Git, the GitHub CLI,
the Codex CLI or Claude Code. It runs them with its own options for each
command. The fix commands it suggests (for example `git config --global
user.email …`) are for you to run.
